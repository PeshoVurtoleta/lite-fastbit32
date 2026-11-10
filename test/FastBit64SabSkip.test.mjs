// test/FastBit64SabSkip.test.mjs -- B.B1b, SPEC-fastbit64 X-10 / A1: the T3 FastBit64 SAB race row
// gates on hosts with os.availableParallelism() >= 3; with fewer cores it prints a named SKIP line that
// states the count. DETERMINISTIC: no race runs here (only the SKIP path, the pure skip rule and the
// MEASURE line format, cross-checked against the soak-lane checker).

import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

import { fb64SabSkip, fb64SabMeasureLine, fb64SabRow } from './torture/t3-adversarial.mjs';
import { FB64_SAB_HOLD, FB64_SAB_DWELL_K, FB64_SAB_DWELL_BURST, FB64_SAB_DWELL_N, FB64_SAB_DWELL_MIN, FB64_SAB_DWELL_MIXED, fb64SabDwellFail, fb64SabDwellLine, fb64SabDwellSample } from './torture/t3-adversarial.mjs';
import { buildBaseCtx } from './torture/context.mjs';
import { checkTortureLog, TIER_NAMES, FAITHFUL_NAMES } from './nightly/soak-lane.mjs';

const SKIP2 = 'MEASURE FastBit64 T3 SAB row SKIP: availableParallelism 2 < 3';

test('X-10 fb64SabSkip: an integer below 3 skips and names the count', () => {
    assert.equal(fb64SabSkip(2), 'availableParallelism 2 < 3');
    assert.equal(fb64SabSkip(1), 'availableParallelism 1 < 3');
    assert.equal(fb64SabSkip(0), 'availableParallelism 0 < 3');
});

test('X-10 fb64SabSkip: 3 or more runs the row (boundary: >= 3, not > 3)', () => {
    assert.equal(fb64SabSkip(3), null); // mutant: floor 4 / `<=`
    assert.equal(fb64SabSkip(4), null);
    assert.equal(fb64SabSkip(12), null);
});

test('X-10 fb64SabSkip: an unreadable count runs the row (a SKIP is never the fail-closed side)', () => {
    for (const v of [NaN, undefined, null, 2.5, '2', -Infinity]) assert.equal(fb64SabSkip(v), null, String(v)); // mutant: !(n >= 3)
});

test('X-10 fb64SabRow on 2 cores: the named SKIP record, no fail, nothing else touched', async () => {
    const ctx = buildBaseCtx(1);
    // a row that did NOT skip would fail on these (no class, an unknown control variant)
    ctx.FB64 = null;
    ctx.control.fb64SabControl = 'no-such-variant';
    const fails = [];
    await fb64SabRow(ctx, (m) => fails.push(m), 2);
    assert.deepEqual(fails, []);
    assert.deepEqual(ctx.measures.fb64Sab, { skip: 'availableParallelism 2 < 3' });
    assert.equal(fb64SabMeasureLine(ctx.measures.fb64Sab), SKIP2);
});

test('X-10 fb64SabRow on 3 cores does not skip (it reaches the control build and fails closed on it)', async () => {
    const ctx = buildBaseCtx(1);
    ctx.control.fb64SabControl = 'no-such-variant';
    const fails = [];
    await fb64SabRow(ctx, (m) => fails.push(m), 3);
    assert.equal(ctx.measures.fb64Sab, undefined);
    assert.equal(fails.length, 1);
    assert.match(fails[0], /^FB64 SAB: the in-run control \(no-such-variant variant\) did not build -- fail closed: /);
});

test('X-10 the real MEASURE lines against the soak-lane checker (formats cannot drift apart)', () => {
    const ran = fb64SabMeasureLine({ shipped: 0, control: 'reread', controlOpen: 37, chunks: 2, cap: 1024, rounds: 55, calls: 40000 });
    assert.equal(ran, 'MEASURE FastBit64 T3 SAB row shipped fail-open=0 control(reread) fail-open=37 chunks=2/1024 rounds=55 calls=40000 [gated: shipped 0, control>=20 within 1024 chunks, rounds>=10]');
    const base = TIER_NAMES.map((t) => '[' + t + '] fails=0 green=0')
        .concat(FAITHFUL_NAMES.map((t) => '[' + t + ' faithful fb1024Img copy] fails=0 green=0'))
        .concat(['MEASURE FastBit1024 d8 pointer-compressed loadFrom lane SKIP: no d8 on PATH (set FASTBIT_D8)',
            'MEASURE FastBit64 d8 pointer-compressed lane SKIP: no d8 on PATH (set FASTBIT_D8)',
            'MEASURE soak live=0 findings=0 postDrainKB=[1,2,3,4] growthKB=15', 'ok']);
    const c = { d8: 'skip', cycles: 4096 };
    assert.deepEqual(checkTortureLog(base.concat([ran]).join('\n') + '\n', c), []);
    const p = checkTortureLog(base.concat([fb64SabMeasureLine({ skip: fb64SabSkip(2) })]).join('\n') + '\n', c);
    assert.ok(p.some((x) => x.includes(SKIP2)), p.join(' | '));
});

// ---- FB64-SAB-CI: writer-dwell coverage gate (SPEC-fastbit64 A17 / A18) ----
// Expected text is written out from the contract, not produced by the implementation.
const dwellMsg = (neg, n, mixed, k) => 'FB64 SAB coverage: writer dwell -- ' + neg + ' of ' + n + ' sampled reads saw the invalid high word, ' + mixed + ' of ' + k + ' bursts saw both values (need >= 20000 and >= 10) -- fail closed';

test('A18 H1 dwell constants are pinned', () => {
    assert.equal(FB64_SAB_HOLD, 64); // mutant: hold changed
    assert.equal(FB64_SAB_DWELL_K, 20); // mutant: burst count changed
    assert.equal(FB64_SAB_DWELL_BURST, 10000); // mutant: burst size changed
    assert.equal(FB64_SAB_DWELL_N, 200000); // mutant: sample count changed
    assert.equal(FB64_SAB_DWELL_MIN, 20000); // mutant: floor weakened or raised
    assert.equal(FB64_SAB_DWELL_MIXED, 10); // mutant: mixed floor weakened
    assert.equal(FB64_SAB_DWELL_BURST * FB64_SAB_DWELL_K, FB64_SAB_DWELL_N); // mutant: burst*k drifts from n
});

test('A18 H2 fb64SabDwellFail boundaries: neg axis, floor and n inclusive', () => {
    assert.equal(fb64SabDwellFail(20000, 200000, 20, 20), null); // mutant: `>` instead of `>=`
    assert.equal(fb64SabDwellFail(19999, 200000, 20, 20), dwellMsg(19999, 200000, 20, 20)); // mutant: floor off by one low
    assert.equal(fb64SabDwellFail(200000, 200000, 20, 20), null); // mutant: `< n`
    assert.equal(fb64SabDwellFail(200001, 200000, 20, 20), dwellMsg(200001, 200000, 20, 20)); // mutant: no upper bound
    assert.equal(fb64SabDwellFail(0, 200000, 20, 20), dwellMsg(0, 200000, 20, 20)); // mutant: zero treated as pass
});

test('A18 H2b fb64SabDwellFail boundaries: mixed axis', () => {
    assert.equal(fb64SabDwellFail(50000, 200000, 10, 20), null); // mutant: `>` instead of `>=` on mixed
    assert.equal(fb64SabDwellFail(50000, 200000, 9, 20), dwellMsg(50000, 200000, 9, 20)); // mutant: mixed floor off by one
    assert.equal(fb64SabDwellFail(50000, 200000, 20, 20), null); // mutant: `< k`
    assert.equal(fb64SabDwellFail(50000, 200000, 21, 20), dwellMsg(50000, 200000, 21, 20)); // mutant: no mixed upper bound
    // vacuous case: a writer parked at the invalid value (every sample negative, no burst mixed)
    assert.equal(fb64SabDwellFail(200000, 200000, 0, 20), dwellMsg(200000, 200000, 0, 20)); // mutant: neg axis alone decides
});

test('A18 H3 fb64SabDwellFail fails closed on unreadable inputs, and embeds them as given', () => {
    for (const v of [NaN, 20000.5, '20000', undefined, -1]) {
        assert.equal(fb64SabDwellFail(v, 200000, 20, 20), dwellMsg(String(v), 200000, 20, 20), String(v)); // mutant: NaN passes / Number() coerces
    }
    for (const v of [NaN, 9.5, '10', undefined]) {
        assert.equal(fb64SabDwellFail(50000, 200000, v, 20), dwellMsg(50000, 200000, String(v), 20), String(v)); // mutant: mixed not integer-checked
    }
    assert.equal(fb64SabDwellFail(50000, 199999, 15, 20), dwellMsg(50000, 199999, 15, 20)); // mutant: n unchecked
    assert.equal(fb64SabDwellFail(50000, 200001, 15, 20), dwellMsg(50000, 200001, 15, 20)); // mutant: one-sided n check
    assert.equal(fb64SabDwellFail(50000, 200000, 15, 19), dwellMsg(50000, 200000, 15, 19)); // mutant: k unchecked
    assert.equal(fb64SabDwellFail(50000, 200000, 15, 21), dwellMsg(50000, 200000, 15, 21)); // mutant: one-sided k check
    assert.equal(fb64SabDwellFail(50000, 200000, 15, 20), null); // control: right n and k pass
});

test('A18 H4 fb64SabDwellLine exact text', () => {
    assert.equal(fb64SabDwellLine({ dwell: 93000, dwellN: 200000, dwellMixed: 20, dwellK: 20 }),
        'MEASURE FastBit64 T3 SAB writer dwell=93000/200000 mixed=20/20 [gated: >= 20000, mixed >= 10]'); // mutant: field order / bracket text drift
});

test('A18 H5 the soak-lane checker accepts the dwell line after the SAB row line and still counts one SAB row', () => {
    const ran = fb64SabMeasureLine({ shipped: 0, control: 'reread', controlOpen: 37, chunks: 2, cap: 1024, rounds: 55, calls: 40000 });
    const dwell = fb64SabDwellLine({ dwell: 93000, dwellN: 200000, dwellMixed: 20, dwellK: 20 });
    const base = TIER_NAMES.map((t) => '[' + t + '] fails=0 green=0')
        .concat(FAITHFUL_NAMES.map((t) => '[' + t + ' faithful fb1024Img copy] fails=0 green=0'))
        .concat(['MEASURE FastBit1024 d8 pointer-compressed loadFrom lane SKIP: no d8 on PATH (set FASTBIT_D8)',
            'MEASURE FastBit64 d8 pointer-compressed lane SKIP: no d8 on PATH (set FASTBIT_D8)',
            'MEASURE soak live=0 findings=0 postDrainKB=[1,2,3,4] growthKB=15', 'ok']);
    const c = { d8: 'skip', cycles: 4096 };
    // mutant: checker rejects the unknown dwell line, or its SAB-row pattern also matches it (double count)
    assert.deepEqual(checkTortureLog(base.concat([ran, dwell]).join('\n') + '\n', c), []);
    assert.deepEqual(checkTortureLog(base.concat([ran]).join('\n') + '\n', c), []); // same verdict without it
    // mutant: the checker stops counting SAB row lines (two real rows pass)
    const p = checkTortureLog(base.concat([ran, dwell, ran]).join('\n') + '\n', c);
    assert.ok(p.length > 0, 'two SAB row lines must not pass');
});

test('A18 H6 test/torture.mjs prints the dwell line inside a console.error call', () => {
    const src = readFileSync(new URL('./torture.mjs', import.meta.url), 'utf8');
    // mutant: the print is dropped (the line is computed but never reaches the log, so the gate is invisible in CI)
    assert.match(src, /console\.error\([^\n]*fb64SabDwellLine\(m\.fb64Sab\)/);
});

// ---- A19: the dwell sampler and the hold knob ----
test('A19 H7 fb64SabDwellSample on a parked -1 word: all negative, no burst mixed, and the gate fails closed', () => {
    const src = new Int32Array(3);
    src[2] = -1;
    const ctl = new Int32Array(new SharedArrayBuffer(20));
    const r = fb64SabDwellSample(src, ctl);
    // expected from the contract: K=20 bursts x BURST=10000 reads = 200000 reads, every read -1, no 0xFF seen
    assert.deepEqual(r, { neg: 200000, reads: 200000, mixed: 0, bursts: 20 }); // mutant: mixed counted with `||`; reads/bursts echoed from constants while neg/mixed are miscounted
    assert.equal(fb64SabDwellFail(r.neg, r.reads, r.mixed, r.bursts), dwellMsg(200000, 200000, 0, 20)); // mutant: neg axis alone decides (vacuous pass)
});

test('A19 H7b fb64SabDwellSample on a parked 0xFF word: nothing negative, no burst mixed', () => {
    const src = new Int32Array(3);
    src[2] = 0xFF;
    const ctl = new Int32Array(new SharedArrayBuffer(20));
    assert.deepEqual(fb64SabDwellSample(src, ctl), { neg: 0, reads: 200000, mixed: 0, bursts: 20 }); // mutant: neg counts non-zero words / mixed counted with `||`
});

test('A19 H8 a set-but-invalid fb64SabHold rejects with RangeError (no worker is started)', async () => {
    for (const v of [0.5, 5000, -1, '64', null]) {
        const ctx = buildBaseCtx(1);
        ctx.control.fb64SabHold = v;
        const fails = [];
        await assert.rejects(fb64SabRow(ctx, (m) => fails.push(m), 3), RangeError, String(v)); // mutant: invalid hold silently falls back to the default 64 / is coerced
    }
});
