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
const MINOR = new Int32Array(1);
let OBS = null;
export function startScavengeWatch() {
    if (OBS) return;
    OBS = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (let i = 0; i < entries.length; i++) {
            // kind 1 === NODE_PERFORMANCE_GC_MINOR (scavenge)
            if (entries[i].detail && entries[i].detail.kind === 1) MINOR[0] = (MINOR[0] + 1) | 0;
            else if (entries[i].kind === 1) MINOR[0] = (MINOR[0] + 1) | 0;
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

// ---- steady-state B/op measurement ----------------------------------------
// new-space delta over K ops with no scavenge in the window, minus an
// empty-loop baseline. Minimum over windows 1..n-1; window 0 printed, never
// floored on. < 3 valid windows => FAIL (perOp = NaN).
const K = 65536;
const WINDOWS = 8;

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
    for (let i = 0; i < K; i++) opFn(i);
    const after = newSpaceUsed();
    await settle(10);
    return { delta: after - before, scav: minorCount() - m0 };
}

// opFn(i) writes its int result into SINK. baselineFn(i) does the loop + sink
// write with no op. Both measured across WINDOWS windows.
export async function measureBop(opFn, baselineFn) {
    const perWindow = [];
    let window0 = NaN;
    let valid = 0;
    for (let w = 0; w < WINDOWS; w++) {
        const b = await runWindow(baselineFn);
        const o = await runWindow(opFn);
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
    return { perOp: valid >= 3 ? min : NaN, valid, window0 };
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
    for (let i = 0; i < N; i++) opFn(i);
    await settle(50);
    return minorCount() - m0;
}
