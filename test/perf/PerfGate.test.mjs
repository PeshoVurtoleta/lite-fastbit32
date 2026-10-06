/**
 * @zakkster/lite-fastbit32 -- the HARD zero-allocation perf gate (@zakkster/lite-perf-gate).
 *
 * Run:  node --expose-gc --min-semi-space-size=4 --max-semi-space-size=4 --test test/perf/PerfGate.test.mjs
 *
 * A node:test-native complement to torture T6. Every hot op group is gated at N
 * and k*N with the `grows` counter (the state FastBit32's own-key count) pinned
 * at 0 across the window. The teeth (`mustFail`) is the FB-11 shape -- a
 * per-op capturing closure passed to forEach -- which MUST trip the gate. It
 * carries the SAME statsOf as the real scenarios: a mustFail without statsOf
 * would trip on a counter-plumbing complaint ("add statsOf"), not on the
 * allocation (fake teeth, C6). A separate assertion pins its reasons[0] to
 * 'scavenges:'. Never widen a budget to make this pass.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { zgcSuite, measure, verdict } from '@zakkster/lite-perf-gate';
import {
    VERSION,
    FastBit32, BitMapper,
    forEachArray, forEachObject, forEachMapped, forEachMappedObject,
    forEachMaskPair, forEachMaskDiff, forEachMaskUnion
} from '../../FastBit32.js';
import { semiSpacePins, pinsOk, pinsDetail } from '../torture/harness.mjs';

// VERSION three-place sync: the package's own export must equal package.json.
test('perf-gate: FastBit32 VERSION === package.json version', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.strictEqual(VERSION, pkg.version);
});

// Fail closed if the semi-space pins are not EXACTLY 4: without both, scavenge
// counts drift (fresh new space reads ~2x the scavenges of grown new space), so
// the numbers this file records would not be reproducible. A substring check
// would accept `=44`, and reading only the first occurrence would accept
// `=4 ... =64` (V8 uses the last); collect every occurrence instead.
test('perf-gate: both semi-space pins are exactly 4', () => {
    const pins = semiSpacePins();
    // Every occurrence of each pin (NODE_OPTIONS + execArgv, underscore spelling
    // normalised) must be exactly '4'; V8 applies the last occurrence, so a
    // trailing `=64` must not slip through. Use npm run test:perf.
    assert.ok(pinsOk(pins), 'both --min/--max-semi-space-size must be exactly 4 (use npm run test:perf), got ' + pinsDetail(pins));
});

// --- fixed input lanes (never recomputed per op) --------------------------
const MASK = 4095;
const MASKS = new Int32Array(4096);   // signed int32 mask lane
const BITS = new Int32Array(4096);    // bit indices 0..31
for (let i = 0; i < 4096; i++) {
    MASKS[i] = (i * 2654435761) | 0;  // full signed int32 range incl. bit 31
    BITS[i] = i & 31;
}

// grows = the state FastBit32's own enumerable key count (1: just `value`).
// Fixed for the object's lifetime, so the window delta must be 0.
function grows(s) { return Object.keys(s.fb).length; }

const ARR = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const KEYS = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'];
const OBJ = { k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9 };
const MAPPER = new BitMapper(KEYS);
// numeric values: a callback that reads obj[key] must not stringify. (An earlier
// draft stored strings and did `v | 0` in the callback -- ToNumber('A') builds a
// NaN HeapNumber per call, a TEST allocation that framed the library. The
// iterators themselves are 0-alloc.)
const MOBJ = { k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8, k9: 9 };

// module-scope callbacks, ONE per iterator so each gated scenario stays
// monomorphic at its callback site.
let CB_SINK = 0;
function cbBit(b) { CB_SINK = (CB_SINK + b) | 0; }
function cbArr(el, b) { CB_SINK = (CB_SINK + b + (el ? 1 : 0)) | 0; }
function cbObj(v, k, b) { CB_SINK = (CB_SINK + b + (v | 0)) | 0; }
function cbMappedObj(v, k, b) { CB_SINK = (CB_SINK + b + (v | 0)) | 0; }
function cbMapped(name, b) { CB_SINK = (CB_SINK + b + (name ? 1 : 0)) | 0; }
function cbPair(b) { CB_SINK = (CB_SINK + b) | 0; }
function cbDiff(b) { CB_SINK = (CB_SINK + b) | 0; }
function cbUnion(b) { CB_SINK = (CB_SINK + b) | 0; }

const singleBit = {
    name: 'FastBit32 single-bit add/remove/toggle/has',
    setup() { return { fb: new FastBit32(0x12345678), sink: 0 }; },
    hot(s, n) {
        const fb = s.fb; let sink = s.sink | 0;
        for (let i = 0; i < n; i++) {
            const b = BITS[i & MASK];
            fb.add(b); sink = (sink + (fb.has(b) ? 1 : 0)) | 0;
            fb.toggle(b); fb.remove(b);
        }
        s.sink = sink | 0;
    },
    statsOf(s) { return { grows: grows(s) }; }
};

const maskOps = {
    name: 'FastBit32 mask ops on a signed int32 lane',
    setup() { return { fb: new FastBit32(-1), sink: 0 }; },
    hot(s, n) {
        const fb = s.fb; let sink = s.sink | 0;
        for (let i = 0; i < n; i++) {
            const m = MASKS[i & MASK];
            sink = (sink + (fb.hasAll(m) ? 1 : 0) + (fb.hasAny(m) ? 2 : 0) + (fb.hasNone(m) ? 4 : 0)) | 0;
            fb.union(m); fb.intersect(m); fb.difference(m);
        }
        s.sink = sink | 0;
    },
    statsOf(s) { return { grows: grows(s) }; }
};

const popcount = {
    name: 'FastBit32 popcount count/countMasked/countRange',
    setup() { return { fb: new FastBit32(0xDEADBEEF | 0), sink: 0 }; },
    hot(s, n) {
        const fb = s.fb; let sink = s.sink | 0;
        for (let i = 0; i < n; i++) {
            sink = (sink + fb.count() + fb.countMasked(MASKS[i & MASK]) + fb.countRange(i & 15, 16 + (i & 15))) | 0;
        }
        s.sink = sink | 0;
    },
    statsOf(s) { return { grows: grows(s) }; }
};

const scan = {
    name: 'FastBit32 scans lowest/highest/nextClearBit (bit-31-clear word)',
    // lowest/highest/nextClearBit are 0-alloc on ANY word (nextClearBit consumes
    // `inv` as int32 via `inv & -inv`). highestClearBit is NOT here: on this
    // bit-31-clear word it boxes, and that box is pinned by an expected-red gate
    // below -- not dodged by cherry-picking a bit-31-set word.
    setup() { return { fb: new FastBit32(0x0F0F1234 | 0), sink: 0 }; },
    hot(s, n) {
        const fb = s.fb; let sink = s.sink | 0;
        for (let i = 0; i < n; i++) {
            sink = (sink + fb.lowest() + fb.highest() + fb.nextClearBit()) | 0;
        }
        s.sink = sink | 0;
    },
    statsOf(s) { return { grows: grows(s) }; }
};

const forEachHoisted = {
    name: 'FastBit32 forEach with a module-scope callback',
    setup() { return { fb: new FastBit32(0xA5A5A5A5 | 0), sink: 0 }; },
    hot(s, n) {
        const fb = s.fb;
        for (let i = 0; i < n; i++) fb.forEach(cbBit);
    },
    statsOf(s) { return { grows: grows(s) }; }
};

// The seven free iterators, each its own monomorphic scenario. All seven are
// 0-alloc (gated below, including forEachMappedObject).
function iterScenario(name, fn) {
    return {
        name,
        setup() { return { fb: new FastBit32(0x000003FF | 0), fb2: new FastBit32(0x00000555 | 0), sink: 0 }; },
        hot(s, n) { const fb = s.fb; const fb2 = s.fb2; for (let i = 0; i < n; i++) fn(fb, fb2); },
        statsOf(s) { return { grows: grows(s) }; }
    };
}
const feArray = iterScenario('free forEachArray', (fb) => forEachArray(fb, ARR, cbArr));
const feObject = iterScenario('free forEachObject', (fb) => forEachObject(fb, KEYS, OBJ, cbObj));
const feMapped = iterScenario('free forEachMapped', (fb) => forEachMapped(fb, MAPPER, cbMapped));
const feMappedObject = iterScenario('free forEachMappedObject', (fb) => forEachMappedObject(fb, MAPPER, MOBJ, cbMappedObj));
const feMaskPair = iterScenario('free forEachMaskPair', (fb, fb2) => forEachMaskPair(fb, fb2, cbPair));
const feMaskDiff = iterScenario('free forEachMaskDiff', (fb, fb2) => forEachMaskDiff(fb, fb2, cbDiff));
const feMaskUnion = iterScenario('free forEachMaskUnion', (fb, fb2) => forEachMaskUnion(fb, fb2, cbUnion));

// FB-11 teeth: the plain ROADMAP shape -- a per-op capturing closure passed to
// the real forEach (`forEach(b => { acc += b + i })`). No escape ring is needed;
// this shape churns the scavenger on its own. Same statsOf as the real
// scenarios so the gate trips on allocation, not on missing counters (C6).
const teethClosure = {
    name: 'FB-11 teeth: forEach with a per-op capturing closure (MUST allocate)',
    setup() { return { fb: new FastBit32(0x0F0F0F0F | 0), sink: 0 }; },
    hot(s, n) {
        const fb = s.fb; let sink = s.sink | 0;
        for (let i = 0; i < n; i++) {
            let acc = 0;
            fb.forEach((b) => { acc = (acc + b + i) | 0; });
            sink = (sink + acc) | 0;
        }
        s.sink = sink | 0;
    },
    statsOf(s) { return { grows: grows(s) }; }
};

// Warmup wrapper (LiteLogN `chunked` shape): run the hot body ~400k times in
// setup(), then chunk the measured window into 2048-op calls. A monolithic 200k
// hot() call tiers into Maglev mid-call, where `~value >>> 0` transiently boxes;
// chunked calls stay in the top tier. (The clear-bit scan boxing is a SEPARATE,
// genuine issue -- see the highestClearBit expected-red gate below.)
const WARM_CHUNK = 2048;
const WARM_ROUNDS = 200;
function warmed(scn) {
    return {
        name: scn.name,
        setup() { const s = scn.setup(); for (let w = 0; w < WARM_ROUNDS; w++) scn.hot(s, WARM_CHUNK); return s; },
        hot(s, n) { let done = 0; while (done < n) { const c = (n - done) < WARM_CHUNK ? (n - done) : WARM_CHUNK; scn.hot(s, c); done += c; } },
        statsOf: scn.statsOf ? (s) => scn.statsOf(s) : undefined
    };
}

const GATED = [singleBit, maskOps, popcount, scan, forEachHoisted,
    feArray, feObject, feMapped, feMappedObject, feMaskPair, feMaskDiff, feMaskUnion];

zgcSuite({
    N: 200000,
    k: 8,
    maxScavenges: 2,
    counters: { grows: 0 },
    scenarios: GATED.map(warmed),
    mustFail: [warmed(teethClosure)]
});

// B5: print minorLo/minorHi for every gated scenario (zgcSuite prints counts
// only on failure). This is a DIAGNOSTIC, not a second gate -- zgcSuite above
// is the authority; here we only surface the numbers so CHANGELOG claims are
// backed. Each must still read <= 2 (NaN fails closed).
test('perf-gate: scenario scavenge counts (diagnostic)', async () => {
    for (const scn of GATED) {
        const r = await measure(warmed(scn), { N: 200000, k: 8 });
        console.error('  ' + scn.name + ': scavenges N=' + r.minorLo + ' 8N=' + r.minorHi);
        assert.ok(Number.isFinite(r.minorHi) && r.minorHi <= 2, scn.name + ' scavenges 8N=' + r.minorHi + ' (expected finite <= 2)');
    }
});

// C6: the teeth must trip on SCAVENGES (the allocation), not on a counter
// complaint. Assert reasons[0] names scavenges, and PRINT the counts.
test('perf-gate: FB-11 teeth trips on scavenges (not a fake counter trip)', async () => {
    const result = await measure(warmed(teethClosure), { N: 200000, k: 8 });
    const v = verdict(result, { maxScavenges: 2, counters: { grows: 0 } });
    console.error('  teeth: scavenges N=' + result.minorLo + ' 8N=' + result.minorHi);
    assert.strictEqual(v.pass, false, 'teeth must fail the gate');
    // reject a fail-closed NaN trip: require a FINITE over-budget count and the
    // EXACT over-budget reason, not 'scavenges: not a number (fail closed)'.
    assert.ok(Number.isFinite(result.minorHi) && result.minorHi > 2, 'teeth must measure a finite scavenge count > 2, got ' + result.minorHi);
    assert.match(v.reasons[0], /^scavenges: \d+ > 2 \(transient allocation\)$/, 'reasons[0] must be the real over-budget reason, got: ' + v.reasons[0]);
});

// EXPECTED-RED (like an FB-01 todo row): highestClearBit() boxes a HeapNumber
// per call on a bit-31-CLEAR word -- `31 - clz32(~value >>> 0)` with the operand
// >= 2^31 -- in V8's default tier (reviewer-reproduced with %GetOptimizationStatus:
// the warmed body was NOT TurboFan and boxed; --no-maglev read 0). It is a real
// user-facing box, not dodged. A GREEN run here (box gone) must FAIL, so a later
// session (S6/SC-2) changes it on purpose. maxScavenges stays at 2.
test('perf-gate: highestClearBit boxes on a bit-31-clear word (expected-red)', async () => {
    const scn = {
        name: 'highestClearBit bit-31-clear',
        setup() { return { fb: new FastBit32(0x0F0F1234 | 0), sink: 0 }; },
        hot(s, n) { const fb = s.fb; let sink = s.sink | 0; for (let i = 0; i < n; i++) sink = (sink + fb.highestClearBit()) | 0; s.sink = sink | 0; },
        statsOf(s) { return { grows: grows(s) }; }
    };
    const result = await measure(warmed(scn), { N: 200000, k: 8 });
    const v = verdict(result, { maxScavenges: 2, counters: { grows: 0 } });
    console.error('  highestClearBit(bit-31-clear): scavenges N=' + result.minorLo + ' 8N=' + result.minorHi);
    assert.strictEqual(v.pass, false, 'highestClearBit must still box on a bit-31-clear word in 1.2.0 (zero-box hole)');
    // reject a fail-closed NaN trip (see teeth): FINITE count > 2 + exact reason.
    assert.ok(Number.isFinite(result.minorHi) && result.minorHi > 2, 'highestClearBit must measure a finite scavenge count > 2, got ' + result.minorHi);
    assert.match(v.reasons[0], /^scavenges: \d+ > 2 \(transient allocation\)$/, 'reasons[0] must be the real over-budget reason, got: ' + v.reasons[0]);
});
