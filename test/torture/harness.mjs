// test/torture/harness.mjs -- zero-box driving machinery for the torture tiers.
//
// Rules (ROADMAP section 5): seeded xorshift32 held in an Int32Array slot; the
// key matrix and all driver scalars live in typed-array slots (a local
// `t += 1.5` would box); an Int32Array sink absorbs every measured result;
// failure messages are built only on failure. No library code lives here.

import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';

// ---- seeded xorshift32 ----------------------------------------------------
// State in an Int32Array(1); operations stay in int32, the return is uint32.
const RNG = new Int32Array(1);

export function seedRng(seed) {
    // never seed 0 (xorshift32 fixpoint); fold to a non-zero int32
    RNG[0] = (seed | 0) === 0 ? 0x9e3779b9 | 0 : seed | 0;
}

export function nextU32() {
    let x = RNG[0];
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    RNG[0] = x;
    return x >>> 0;
}

// uniform in [0, n)
export function randBelow(n) {
    return nextU32() % n;
}

export function currentSeed() {
    return RNG[0];
}

// Pick and install the seed. TORTURE_SEED replays a prior run. A seed must be an
// integer representable as int32 OR uint32 (i.e. in [-2^31, 2^32 - 1]); a value
// out of that range would silently wrap under `| 0` and could not be replayed
// from its printed form, so it is rejected (exit 2), never wrapped.
export function installSeed() {
    const env = process.env.TORTURE_SEED;
    let seed;
    if (env !== undefined && env !== '') {
        const trimmed = env.trim();
        if (!/^-?\d+$/.test(trimmed)) {
            console.error('torture: TORTURE_SEED must be an integer, got "' + env + '".');
            process.exit(2);
        }
        const n = Number(trimmed);
        if (!Number.isSafeInteger(n) || n < -(2 ** 31) || n > (2 ** 32 - 1)) {
            console.error('torture: TORTURE_SEED must be an integer in [-2147483648, 4294967295], got "' + env + '".');
            process.exit(2);
        }
        seed = n | 0;
    } else {
        seed = (Date.now() ^ (process.hrtime.bigint ? Number(process.hrtime.bigint() & 0xffffffffn) : 0)) | 0;
        if (seed === 0) seed = 0x1234567 | 0;
    }
    seedRng(seed);
    return seed;
}

// Collects EVERY occurrence of each semi-space pin from NODE_OPTIONS (first) and
// execArgv. Returns an array of value strings per flag (empty if absent). The
// caller requires >= 1 occurrence and every occurrence === '4' (pinsOk).
// A substring test ('includes') is wrong: `--min-semi-space-size=44` contains
// `min-semi-space-size=4`. Reading only the FIRST occurrence is also wrong: V8
// applies the LAST occurrence, so `=4 ... =64` would run under 64 MB yet read
// '4'. V8 also accepts the underscore spelling (`--min_semi_space_size`), so the
// flag name is normalised `_` -> `-` before matching. Handles `--flag=4` and
// `--flag 4`.
export function semiSpacePins() {
    const tokens = [];
    const no = process.env.NODE_OPTIONS;
    if (no) for (const t of no.split(/\s+/)) if (t) tokens.push(t);
    for (const t of process.execArgv) tokens.push(t);
    const collect = (flag) => {
        const dash = '--' + flag;
        const out = [];
        for (let i = 0; i < tokens.length; i++) {
            const raw = tokens[i];
            const eq = raw.indexOf('=');
            const name = (eq === -1 ? raw : raw.slice(0, eq)).replace(/_/g, '-');
            if (name !== dash) continue;
            out.push(eq === -1 ? (tokens[i + 1] === undefined ? '' : tokens[i + 1]) : raw.slice(eq + 1));
        }
        return out;
    };
    return { min: collect('min-semi-space-size'), max: collect('max-semi-space-size') };
}

// True only if each pin appears at least once and EVERY occurrence is exactly '4'.
export function pinsOk(pins) {
    const all4 = (a) => a.length >= 1 && a.every((v) => v === '4');
    return all4(pins.min) && all4(pins.max);
}

// Human-readable detail for the guard's error message.
export function pinsDetail(pins) {
    return 'min=[' + pins.min.join(',') + '] max=[' + pins.max.join(',') + ']';
}

// Build the replay line for a failing op. Cold path -- allocates on failure only.
export function replayLine(seed, opIndex) {
    return 'TORTURE_SEED=' + (seed >>> 0) + ' npm run torture # op ' + opIndex;
}

// ---- the key matrix (C9) --------------------------------------------------
// Six lanes. Signed lanes (0, 1<<30, -1, -2^31) survive mutation and are gated.
// Unsigned-double lanes (0xFFFFFFFF, 2**31) are read-only and printed, not gated.
export const LANE_VALUES = new Float64Array([
    0,
    1 << 30,          // 1073741824
    -1,               // all bits, signed
    -(2 ** 31),       // -2147483648, signed form of bit 31
    0xFFFFFFFF,       // 4294967295, unsigned double
    2 ** 31           // 2147483648, unsigned double
]);
// Int32Array companion for the signed lanes (bit-pattern identical).
export const LANE_INT32 = new Int32Array([0, 1 << 30, -1, -(2 ** 31), 0, 0]);
export const LANE_SIGNED = Uint8Array.from([1, 1, 1, 1, 0, 0]);
export const LANE_NAMES = ['0', '1<<30', '-1', '-2^31', '0xFFFFFFFF', '2**31'];

// ---- zero-box sink --------------------------------------------------------
// Every measured op writes its integer result here so V8 cannot sink the store.
export const SINK = new Int32Array(4);

// ---- rangeMask via a loop (no library idiom) ------------------------------
export function rangeMask(start, end) {
    let m = 0;
    for (let i = start; i <= end; i++) m |= (1 << i);
    return m >>> 0;
}

// ---- new-space reader -----------------------------------------------------
// V8 new-space used-size in bytes. Called ONCE per window, never inside the
// measured K-loop.
export function newSpaceUsed() {
    const spaces = v8.getHeapSpaceStatistics();
    for (let i = 0; i < spaces.length; i++) {
        if (spaces[i].space_name === 'new_space') return spaces[i].space_used_size;
    }
    return 0;
}

// ---- scavenge watcher -----------------------------------------------------
// Classifies by entry.detail.kind ONLY. The top-level entry.kind accessor is
// deprecated (DEP0152: node <= 24 prints a DeprecationWarning on first read),
// so it is never read. An entry whose detail is missing, or whose detail.kind
// is not a number, is counted as UNKNOWN -- never as minor or major. Fail
// closed: runWindow discards a window with any unknown entry (as it does a
// scavenge) and measureScavenges returns NaN if one arrived in its window
// (callers gate with !(scav <= n), so NaN fails).
const MINOR = new Int32Array(1);
const GC_UNKNOWN = new Int32Array(1);
let OBS = null;
export function startScavengeWatch() {
    if (OBS) return;
    OBS = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (let i = 0; i < entries.length; i++) {
            const d = entries[i].detail;
            const kind = d === null || d === undefined ? undefined : d.kind;
            // kind 1 === NODE_PERFORMANCE_GC_MINOR (scavenge)
            if (typeof kind !== 'number') GC_UNKNOWN[0] = (GC_UNKNOWN[0] + 1) | 0;
            else if (kind === 1) MINOR[0] = (MINOR[0] + 1) | 0;
        }
    });
    OBS.observe({ entryTypes: ['gc'], buffered: true });
}
export function stopScavengeWatch() {
    if (OBS) { OBS.disconnect(); OBS = null; }
}
export function minorCount() {
    return MINOR[0];
}
// GC entries the watcher could not classify (no detail / no numeric kind).
export function unknownGcCount() {
    return GC_UNKNOWN[0];
}

// ---- young-GC detector self-validation controls ---------------------------
// Positive control: a bounded escaping ring that forces new-space churn, so a
// working young-GC watcher MUST register scavenges. The ring keeps every object
// reachable long enough that V8 cannot scalar-replace or elide it; the ring is
// returned so the caller holds it live past the measurement.
export function churnPositive(iters) {
    const RING = new Array(4096).fill(null);
    let acc = 0;
    for (let i = 0; i < iters; i++) {
        const o = { a: i, b: i + 1 };
        RING[i & 4095] = o;
        acc = (acc + o.a) | 0;
    }
    return { RING, acc };
}
// Negative control: pure int32 arithmetic, zero allocation -> zero scavenges.
export function churnNegative(iters) {
    let acc = 0;
    for (let i = 0; i < iters; i++) acc = (acc + i) | 0;
    return acc;
}
// Any --minor-ms occurrence (name normalised `_`->`-`, NODE_OPTIONS + execArgv).
// MinorMS reports young GCs as perf_hooks kind 2, not 1, which blinds the
// scavenge watcher; the entry refuses it. Returns every occurrence (unsupported
// regardless of last-wins, so all are reported).
export function youngGcModeFlags() {
    const tokens = [];
    const no = process.env.NODE_OPTIONS;
    if (no) for (const t of no.split(/\s+/)) if (t) tokens.push(t);
    for (const t of process.execArgv) tokens.push(t);
    const hits = [];
    for (const raw of tokens) {
        const eq = raw.indexOf('=');
        const name = (eq === -1 ? raw : raw.slice(0, eq)).replace(/_/g, '-');
        if (name === '--minor-ms') hits.push(raw);
    }
    return hits;
}
// Flattened view of the GC-relevant flags, for a fail-closed error message.
export function gcFlagsLine() {
    const parts = [...process.execArgv];
    if (process.env.NODE_OPTIONS) parts.push('NODE_OPTIONS=' + process.env.NODE_OPTIONS);
    return parts.join(' ');
}

export function settle(ms = 10) {
    return new Promise((r) => setTimeout(r, ms));
}

// ---- shared megamorphic call site -----------------------------------------
// Four FastBit32 look-alikes with the same method names but distinct hidden
// classes. A single call site that dispatches across >= 5 shapes cannot be
// inlined, so a box crossing the boundary stays visible (zero-box-law control).
class LookAlikeA { constructor(v) { this.value = v >>> 0; } hasAll(m) { return (~this.value & m) === 0; } forEach(cb) { let v = this.value; while (v !== 0) { const b = Math.clz32(v & -v) ^ 31; cb(b); v &= v - 1; } } }
class LookAlikeB { constructor(v) { this.val = v >>> 0; this.k = 1; } hasAll(m) { return (~this.val & m) === 0; } forEach(cb) { let v = this.val; while (v !== 0) { const b = Math.clz32(v & -v) ^ 31; cb(b); v &= v - 1; } } }
class LookAlikeC { constructor(v) { this.w = v >>> 0; this.a = 0; this.b = 0; } hasAll(m) { return (~this.w & m) === 0; } forEach(cb) { let v = this.w; while (v !== 0) { const b = Math.clz32(v & -v) ^ 31; cb(b); v &= v - 1; } } }
class LookAlikeD { constructor(v) { this.z = v >>> 0; this.p = 'x'; } hasAll(m) { return (~this.z & m) === 0; } forEach(cb) { let v = this.z; while (v !== 0) { const b = Math.clz32(v & -v) ^ 31; cb(b); v &= v - 1; } } }

export const LOOKALIKES = [LookAlikeA, LookAlikeB, LookAlikeC, LookAlikeD];

// The shared call site: ONE function body that every lane routes through.
export function sharedHasAll(obj, m) {
    return obj.hasAll(m);
}
export function sharedForEach(obj, cb) {
    return obj.forEach(cb);
}

// Warm the shared call site with every look-alike shape so it is polymorphic
// before FastBit32 is measured through it.
export function warmShared(FB) {
    const ms = [1, 2, 4];
    const noop = () => {};
    for (let r = 0; r < 64; r++) {
        for (let i = 0; i < LOOKALIKES.length; i++) {
            const inst = new LOOKALIKES[i](r);
            sharedHasAll(inst, ms[r % 3]);
            sharedForEach(inst, noop);
        }
        const fb = new FB(r);
        sharedHasAll(fb, ms[r % 3]);
        sharedForEach(fb, noop);
    }
}

// ---- verified optimization (T6 measures TurboFan code, never a guess) -----
// Under host load the CONCURRENT tier-up of a measured op (or of a method it
// calls without inlining) may not finish before the windows run, and
// unoptimized code boxes every unsigned-double value: one non-inlined
// unoptimized callee reads exactly 16.000 B/op (.handoff/evidence/t6-fix/
// repro.log). So measureBop FORCES optimization synchronously
// (%OptimizeFunctionOnNextCall compiles on the next call, on this thread, so
// host load cannot delay it) and VERIFIES it before and after every window.
// The natives are compiled lazily through `new Function` so this module still
// PARSES without --allow-natives-syntax (plain `node --test` files import it);
// without the flag measureBop fails closed with a "needs" reason.
//
// %GetOptimizationStatus has TWO bit layouts across the V8 versions we run.
// Every OPT_* constant below and every status the harness reads or prints is
// in the V8 14 layout; a V8 11.3-13.6 word is normalized into it first.
//
// Layout 0 -- V8 14.x (Node 26.8.2 / V8 14.6.202.34; d8 15.7 agrees: forced
// TurboFan 0x29), decoded empirically (.handoff/evidence/t6-fix/status-bits.log):
// 0x1 is-function,
// 0x2 never-optimize (seen under --jitless; %NeverOptimizeFunction does not set
// it here, its op reads 0x4001 / 0x41), 0x8 optimized (any tier), 0x10 Maglev, 0x20 TurboFan,
// 0x40 interpreted, 0x80 marked for optimization on next call, 0x1000 lite
// mode (--jitless), 0x2000 marked for deoptimization, 0x4000 Sparkplug, 0x20000
// lazy (never compiled). Maglev does NOT count: only the TurboFan bit verifies.
//
// Layout 1 -- V8 11.3-13.6 (Node 20 / 22 / 24): bit 2 (0x4) is still
// kAlwaysOptimize, so every bit above 0x2 sits ONE position higher. Measured
// with `new Function` probes (.handoff/research/ci4/status-bits.out): V8 12.4 and
// 13.6 forced TurboFan 0x51, interpreted 0x81, marked-for-opt 0x181, after
// deopt 0x81, Maglev (13.6) 0x31; CI run 42066992411 printed 0x51 for the
// forced probe on V8 11.3 (Node 20.20.2). V8 14.6 reads 0x29 / 0x41 / 0xc1 /
// 0x41 / 0x19 for the same probes. normalizeStatus drops old bit 2 and shifts
// the rest down one; the bits above 0x100 (lite, deopt-marked, Sparkplug,
// lazy) are assumed to move the same way -- they were not probed on layout 1.
//
// natives() detects the layout ONCE (decodeStatusLayout on a forced-TurboFan
// probe and an interpreted probe); an unknown layout fails closed
// (optimizationUnavailable returns a reason, measureBop never measures).
export const OPT_NEVER = 0x2;
export const OPT_MAGLEV = 0x10;
export const OPT_TURBOFAN = 0x20;
export const OPT_INTERPRETED = 0x40;
export const OPT_MARKED = 0x80;
export const OPT_LITE = 0x1000;
export const OPT_DEOPT_MARKED = 0x2000;
export const OPT_BASELINE = 0x4000;
export const NATIVES_REMEDY = 'node --allow-natives-syntax --expose-gc --min-semi-space-size=4 --max-semi-space-size=4 test/torture.mjs';

// Which layout a (forced-TurboFan, interpreted) probe pair was read in:
// 0 = V8 14.x, 1 = V8 11.3-13.6 (kAlwaysOptimize at bit 2), null = neither or
// both (unknown -- the caller fails closed). Pure.
export function decodeStatusLayout(tfWord, interpWord) {
    const l0 = (tfWord & 0x8) !== 0 && (tfWord & 0x20) !== 0 && (tfWord & 0x40) === 0 &&
        (interpWord & 0x40) !== 0 && (interpWord & 0x8) === 0 && (interpWord & 0x20) === 0;
    const l1 = (tfWord & 0x10) !== 0 && (tfWord & 0x40) !== 0 && (tfWord & 0x80) === 0 &&
        (interpWord & 0x80) !== 0 && (interpWord & 0x10) === 0 && (interpWord & 0x40) === 0;
    if (l0 === l1) return null;
    return l0 ? 0 : 1;
}

// A raw status word re-expressed in the V8 14 layout. shift 0: unchanged;
// shift 1: keep bits 0-1, drop old bit 2 (kAlwaysOptimize), move the rest down
// one. Pure, int32 only (no allocation).
export function normalizeStatus(raw, shift) {
    return shift === 1 ? (raw & 0x3) | ((raw >>> 1) & ~0x3) : raw;
}

const STATUS_RAW = new Int32Array(1);      // raw word of the LAST N.status read
let NATIVES = null;                        // null = not tried, false = unavailable
function natives() {
    if (NATIVES === null) {
        let prep, opt, never, raw;
        try {
            prep = new Function('f', '%PrepareFunctionForOptimization(f);');
            opt = new Function('f', '%OptimizeFunctionOnNextCall(f);');
            never = new Function('f', '%NeverOptimizeFunction(f);');
            raw = new Function('f', 'return %GetOptimizationStatus(f);');
        } catch (e) {
            NATIVES = false;
            return NATIVES;
        }
        // Layout probes: distinct source text from each other and from the
        // optimizationUnavailable probe, so no compilation-cache sharing.
        const tfProbe = new Function('x', 'return (x + 1) | 0; // t6 layout probe: forced turbofan');
        prep(tfProbe);
        tfProbe(1); tfProbe(2);
        opt(tfProbe);
        tfProbe(3);
        const interpProbe = new Function('x', 'return (x + 1) | 0; // t6 layout probe: interpreted');
        interpProbe(1);
        const tfWord = raw(tfProbe);
        const interpWord = raw(interpProbe);
        const shift = decodeStatusLayout(tfWord, interpWord);
        const sh = shift === null ? 0 : shift;   // unknown: raw words, and every consumer refuses
        NATIVES = {
            prep, opt, never, raw,
            shift, tfWord, interpWord,
            // normalized (V8 14 layout) word; the raw word stays in STATUS_RAW[0]
            status: (f) => {
                STATUS_RAW[0] = raw(f);
                return normalizeStatus(STATUS_RAW[0], sh);
            }
        };
    }
    return NATIVES;
}

// The detected layout, for tests and diagnostics (cold). null when natives are
// unavailable (no --allow-natives-syntax); else { shift: 0 | 1 | null, tfWord,
// interpWord, v8 }.
export function statusLayout() {
    const N = natives();
    if (N === false) return null;
    return { shift: N.shift, tfWord: N.tfWord, interpWord: N.interpWord, v8: process.versions.v8 };
}

function layoutUnknownReason(N) {
    return 'the %GetOptimizationStatus layout is unknown on V8 ' + process.versions.v8 +
        ' (forced-TurboFan probe raw 0x' + N.tfWord.toString(16) + ', interpreted probe raw 0x' + N.interpWord.toString(16) +
        '; neither the V8 14 nor the V8 11.3-13.6 layout fits), so TurboFan cannot be verified -- failing closed' +
        ' (if --no-opt / --jitless / --max-opt is set, remove it)';
}

// describeOptStatus for the word the LAST N.status call returned, plus the raw
// word when it was normalized (cold path).
function describeRead(N, s) {
    if (N.shift === 0) return describeOptStatus(s);
    return describeOptStatus(s) + ' (raw 0x' + STATUS_RAW[0].toString(16) + ', ' + (N.shift === 1 ? 'V8 <= 13 layout' : 'unknown layout') + ')';
}

// Decode a status word for a failure message (cold path).
export function describeOptStatus(s) {
    const parts = [];
    if (s & OPT_TURBOFAN) parts.push('turbofan');
    if (s & OPT_MAGLEV) parts.push('maglev');
    if (s & OPT_BASELINE) parts.push('sparkplug');
    if (s & OPT_INTERPRETED) parts.push('interpreted');
    if (s & OPT_MARKED) parts.push('marked');
    if (s & OPT_DEOPT_MARKED) parts.push('marked-for-deopt');
    if (s & OPT_NEVER) parts.push('never-optimize');
    if (s & OPT_LITE) parts.push('jitless');
    return '0x' + s.toString(16) + ' ' + parts.join('+');
}

// null when T6 can force and verify TurboFan here; else the reason (the entry
// guard prints it with NATIVES_REMEDY). The probe is a fresh function forced to
// TurboFan, so --no-opt / --jitless / a disabled TurboFan are refused too.
export function optimizationUnavailable() {
    const N = natives();
    if (N === false) return '--allow-natives-syntax is not set: T6 must force and verify TurboFan optimization of every measured op (needs --allow-natives-syntax).';
    if (N.shift === null) return 'T6 cannot run: ' + layoutUnknownReason(N) + '.';
    const probe = new Function('x', 'return (x + 1) | 0; // t6 natives probe');
    N.prep(probe);
    probe(1); probe(2);
    N.opt(probe);
    probe(3);
    const s = N.status(probe);
    if ((s & OPT_TURBOFAN) === 0) return 'TurboFan is unavailable (forced probe status ' + describeRead(N, s) + '; remove --no-opt / --jitless / --max-opt): T6 measures verified-optimized code only.';
    return null;
}

// CI-5, maintainer ruling 2026-11-05: "T6 needs V8 >= 14; named SKIP". On V8
// 12.4 / 13.6 the measured op and its callees stay Sparkplug / Maglev after a
// forced optimization (raw 0x8401 / 0x31, .handoff/research/ci4/), and
// %OptimizeFunctionOnNextCall after %NeverOptimizeFunction is a fatal CHECK. So
// below V8 14 torture runs every tier except T6 and prints this reason, the T6
// controls skip the same way (like the d8 lane), the B/op claims stay gated on
// Node 26.x, and making T6 work on V8 11-13 is backlog research.
// Pure: null when the V8 major is >= 14, else the one-line ASCII SKIP reason.
// An unparseable version THROWS TypeError (fail closed: never a skip on a
// version string this cannot read). optimizationUnavailable() stays layout-only.
export function t6Floor(v8Version) {
    const m = typeof v8Version === 'string' && !/[^\x21-\x7e]/.test(v8Version) ? /^(\d+)\.\d+/.exec(v8Version) : null;
    if (m === null) {
        throw new TypeError('t6Floor: unparseable V8 version ' + (typeof v8Version === 'string' ? JSON.stringify(v8Version) : '(' + typeof v8Version + ')') +
            ' (want "<major>.<minor>..." in printable ASCII) -- failing closed, T6 is never skipped on an unreadable version');
    }
    if (Number(m[1]) >= 14) return null;
    return 'T6 SKIP: verified-TurboFan forcing needs V8 >= 14 (Node 26+); this V8 is ' + v8Version;
}

// Every function-valued own property (methods, getters, setters) of each class
// AND of its prototype, walking both chains (so a control subclass contributes
// its overrides AND the base methods); constructors and builtins excluded.
export function collectMethods(...classes) {
    const out = new Set();
    const take = (o, stop) => {
        for (let p = o; p !== null && p !== stop; p = Object.getPrototypeOf(p)) {
            for (const k of Reflect.ownKeys(p)) {
                if (k === 'constructor' || k === 'prototype') continue;
                const d = Object.getOwnPropertyDescriptor(p, k);
                for (const f of [d.value, d.get, d.set]) {
                    if (typeof f === 'function' && !/^class[\s{]/.test(Function.prototype.toString.call(f))) out.add(f);
                }
            }
        }
    };
    for (const C of classes) {
        take(C, Function.prototype);
        take(C.prototype, Object.prototype);
    }
    return [...out];
}

// Verify the tracked set. opFn and baselineFn must carry the TurboFan bit. A
// callee must carry it OR still be marked (marked = never entered unoptimized
// since forcing: it was inlined, or this op does not reach it; its first
// non-inlined call compiles it synchronously). Nothing may be marked for
// deoptimization. Returns null or the reason (cold).
function verifyTracked(N, opFn, baselineFn, callees, when) {
    const so = N.status(opFn);
    if ((so & OPT_TURBOFAN) === 0 || (so & OPT_DEOPT_MARKED) !== 0) return 'op ' + when + ' (status ' + describeRead(N, so) + ')';
    const sb = N.status(baselineFn);
    if ((sb & OPT_TURBOFAN) === 0 || (sb & OPT_DEOPT_MARKED) !== 0) return 'baseline ' + when + ' (status ' + describeRead(N, sb) + ')';
    for (let i = 0; i < callees.length; i++) {
        const s = N.status(callees[i]);
        if ((s & (OPT_TURBOFAN | OPT_MARKED)) === 0 || (s & OPT_DEOPT_MARKED) !== 0) {
            return 'callee ' + (callees[i].name || '#' + i) + ' ' + when + ' and not inlined (status ' + describeRead(N, s) + ')';
        }
    }
    return null;
}

// ---- steady-state B/op measurement ----------------------------------------
// new-space delta over K ops with no scavenge in the window, minus an
// empty-loop baseline. Minimum over windows 1..n-1; window 0 printed, never
// floored on. < 3 valid windows => FAIL (perOp = NaN). Every window measures
// VERIFIED TurboFan code (see "verified optimization" above): an unverified
// lane returns perOp NaN and a `status` reason, never a number.
const K = 65536;
const WINDOWS = 8;
const WARM = 1024;
const BOP_OPTS = ['callees', 'withhold'];

// A window reads `after` SYNCHRONOUSLY (right after the K-op loop, before any
// allocation the scavenge count could hide), THEN awaits a settle so the
// PerformanceObserver delivers this window's GC entries, THEN reads the scavenge
// delta. A window with any scavenge is discarded by the caller -- without the
// settle the sync count is always 0 and such windows are never discarded,
// pulling the minimum low (reviewer probe: 2e6 object allocs read sync delta 0,
// 15 after settle(10)).
async function runWindow(opFn) {
    const before = newSpaceUsed();
    const m0 = minorCount();
    const u0 = GC_UNKNOWN[0];
    for (let i = 0; i < K; i++) opFn(i);
    const after = newSpaceUsed();
    await settle(10);
    // an unclassifiable GC entry counts toward the discard, never as zero
    return { delta: after - before, scav: (minorCount() - m0) + (GC_UNKNOWN[0] - u0) };
}

// opFn(i) writes its int result into SINK. baselineFn(i) does the loop + sink
// write with no op. Both measured across WINDOWS windows.
// opts.callees: every function opFn may reach (collectMethods of the classes
//   it touches, plus local callbacks). Each is force-marked and verified, so a
//   callee TurboFan does not inline still runs TurboFan code.
// opts.withhold: control only (bop-unoptimized) -- %NeverOptimizeFunction on
//   opFn before forcing; the lane MUST fail closed with "op not optimized".
// runWindow itself is not forced: its loop passes a Smi `i` (< K) and calls
// opFn and baselineFn through the same site, so its own cost cancels in
// net = op - baseline.
export async function measureBop(opFn, baselineFn, opts) {
    const o0 = opts === undefined ? {} : opts;
    for (const k of Object.keys(o0)) if (!BOP_OPTS.includes(k)) throw new TypeError('measureBop: unknown option "' + k + '" (known: ' + BOP_OPTS.join(', ') + ')');
    const callees = o0.callees === undefined ? [] : o0.callees;
    const fail = (why) => ({ perOp: NaN, valid: 0, window0: NaN, status: 'not verified-optimized: ' + why });
    const N = natives();
    if (N === false) return fail('needs --allow-natives-syntax (' + NATIVES_REMEDY + ')');
    if (N.shift === null) return fail(layoutUnknownReason(N));
    if (o0.withhold === true) N.never(opFn);
    if (o0.withhold === 'callee') N.never(callees[0]);
    N.prep(opFn);
    N.prep(baselineFn);
    for (let i = 0; i < callees.length; i++) N.prep(callees[i]);
    for (let i = 0; i < WARM; i++) { baselineFn(i); opFn(i); }
    N.opt(opFn);
    N.opt(baselineFn);
    for (let i = 0; i < callees.length; i++) N.opt(callees[i]);
    baselineFn(0);
    opFn(0);
    const pre = verifyTracked(N, opFn, baselineFn, callees, 'not optimized');
    if (pre !== null) return fail(pre);
    const perWindow = [];
    let window0 = NaN;
    let valid = 0;
    for (let w = 0; w < WINDOWS; w++) {
        const b = await runWindow(baselineFn);
        const o = await runWindow(opFn);
        const mid = verifyTracked(N, opFn, baselineFn, callees, 'deoptimized during measurement (window ' + w + ')');
        if (mid !== null) return fail(mid);
        const net = o.delta - b.delta;
        const perOp = net / K;
        if (w === 0) { window0 = perOp; continue; }
        // discard a window that scavenged (its new-space delta is meaningless)
        // or went negative; NaN-safe by construction.
        if (!(o.delta >= 0) || !(b.delta >= 0) || o.scav > 0 || b.scav > 0) continue;
        perWindow.push(perOp);
        valid++;
    }
    let min = Infinity;
    for (let i = 0; i < perWindow.length; i++) if (perWindow[i] < min) min = perWindow[i];
    return { perOp: valid >= 3 ? min : NaN, valid, window0, status: 'optimized' };
}

export { K as BOP_K, WINDOWS as BOP_WINDOWS };

// ---- scavenge-count lane --------------------------------------------------
// A per-op closure that ESCAPES (stored, kept live past the op) is NOT reclaimed
// within the window, so the B/op delta lane DOES see it (a persistent ~16 B/op
// box reads ~16). But a per-op closure/box that dies young is scavenged before
// the next window boundary, so the delta lane can miss it while young-gen churns.
// Counting minor GCs over a large op count is the reliable detector for that
// transient case (torture-harness skill). Returns the scavenge
// delta over N ops after a warmup, with async settle so perf_hooks delivers.
export async function measureScavenges(opFn, N = 2000000, warm = 100000) {
    for (let i = 0; i < warm; i++) opFn(i);
    await settle(50);
    const m0 = minorCount();
    const u0 = GC_UNKNOWN[0];
    for (let i = 0; i < N; i++) opFn(i);
    await settle(50);
    if (GC_UNKNOWN[0] !== u0) return NaN;  // unclassifiable GC in the window: no verdict
    return minorCount() - m0;
}
