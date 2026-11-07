// test/FastBit64SabSkip.test.mjs -- B.B1b, SPEC-fastbit64 X-10 / A1: the T3 FastBit64 SAB race row
// gates on hosts with os.availableParallelism() >= 3; with fewer cores it prints a named SKIP line that
// states the count. DETERMINISTIC: no race runs here (only the SKIP path, the pure skip rule and the
// MEASURE line format, cross-checked against the soak-lane checker).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fb64SabSkip, fb64SabMeasureLine, fb64SabRow } from './torture/t3-adversarial.mjs';
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
            'MEASURE soak live=0 findings=0 postDrainKB=[1,2,3,4] growthKB=15', 'ok']);
    const c = { d8: 'skip', cycles: 4096 };
    assert.deepEqual(checkTortureLog(base.concat([ran]).join('\n') + '\n', c), []);
    const p = checkTortureLog(base.concat([fb64SabMeasureLine({ skip: fb64SabSkip(2) })]).join('\n') + '\n', c);
    assert.ok(p.some((x) => x.includes(SKIP2)), p.join(' | '));
});
