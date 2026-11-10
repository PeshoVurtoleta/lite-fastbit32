// test/FastBit64TortureQA.test.mjs -- qa (GROUP B + FB64-PC + FB64-SAB-CI): deterministic rows for two gaps
// the torture lanes leave open. DETERMINISTIC: source text and module exports only; no race, no worker, no d8.
//
// R16 (NEXT.md FILLERS): SPEC-fastbit64 A19 says the dwell verdict and ctx.measures (dwellN, dwellK) take the
// COUNTED reads / bursts from fb64SabDwellSample, never the constants. The pure verdict and the sampler are
// pinned in FastBit64SabSkip.test.mjs, but fb64SabRow's own wiring is not: reverting
// `fb64SabDwellFail(d.neg, d.reads, d.mixed, d.bursts)` to `(d.neg, FB64_SAB_DWELL_N, d.mixed, FB64_SAB_DWELL_K)`
// (or `dwellN: d.reads` to `dwellN: FB64_SAB_DWELL_N`) passed npm test. These rows read fb64SabRow's body.
//
// A17 (3): CONTROL_NAMES grew 52 -> 53 with fb64-sab-flip; no test pinned the count or the nine FastBit64 names.

import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

import { CONTROL_NAMES } from './torture/controls.mjs';

const T3 = new URL('./torture/t3-adversarial.mjs', import.meta.url);

// fb64SabRow's body, line comments dropped (the body's strings hold no '//').
function rowBody() {
    const src = readFileSync(T3, 'utf8');
    const head = 'export async function fb64SabRow(';
    const at = src.indexOf(head);
    assert.ok(at >= 0, 'fb64SabRow not found in t3-adversarial.mjs');
    assert.equal(src.indexOf(head, at + 1), -1, 'fb64SabRow declared twice');
    const end = src.indexOf('\n}\n', at);
    assert.ok(end > at, 'fb64SabRow has no closing brace at column 0');
    return src.slice(at, end + 2).split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
}

const count = (s, needle) => s.split(needle).length - 1;

test('R16 fb64SabRow samples once, then gives the verdict the COUNTED reads and bursts (A19)', () => {
    const b = rowBody();
    assert.equal(count(b, 'fb64SabDwellSample('), 1, 'one sampler call');
    assert.match(b, /const d = fb64SabDwellSample\(src, ctl\);/);
    // mutant: verdict fed FB64_SAB_DWELL_N / FB64_SAB_DWELL_K (a sampler that reads short would pass)
    assert.equal(count(b, 'fb64SabDwellFail('), 1, 'one verdict call');
    assert.match(b, /fb64SabDwellFail\(\s*d\.neg\s*,\s*d\.reads\s*,\s*d\.mixed\s*,\s*d\.bursts\s*\)/);
    assert.ok(b.indexOf('fb64SabDwellSample(') < b.indexOf('fb64SabDwellFail('), 'sample before verdict');
    // mutant: the verdict is computed but never reported
    assert.match(b, /if \(dwellFail !== null\) F\(dwellFail\);/);
});

test('R16 fb64SabRow records the COUNTED reads and bursts in ctx.measures.fb64Sab (A19)', () => {
    const b = rowBody();
    const m = /ctx\.measures\.fb64Sab = \{ shipped:[^\n]*\};/.exec(b);
    assert.ok(m, 'the ran-shape measures record is missing');
    const rec = m[0];
    // mutant: dwellN / dwellK recorded from the constants (the MEASURE line then always reads /200000 and /20)
    assert.match(rec, /\bdwell: d\.neg\b/);
    assert.match(rec, /\bdwellN: d\.reads\b/);
    assert.match(rec, /\bdwellMixed: d\.mixed\b/);
    assert.match(rec, /\bdwellK: d\.bursts\b/);
});

test('R16 fb64SabRow names no dwell constant (every dwell count comes from the sampler)', () => {
    const b = rowBody();
    for (const k of ['FB64_SAB_DWELL_N', 'FB64_SAB_DWELL_K', 'FB64_SAB_DWELL_BURST', 'FB64_SAB_DWELL_MIN', 'FB64_SAB_DWELL_MIXED']) {
        assert.equal(count(b, k), 0, k + ' appears in fb64SabRow'); // mutant: any constant re-enters the row
    }
});

test('A17 (3) CONTROL_NAMES is 53: the 44 of 1.6.1 plus nine FastBit64 controls, fb64-sab-flip among them', () => {
    assert.equal(CONTROL_NAMES.length, 53);
    assert.equal(new Set(CONTROL_NAMES).size, 53, 'duplicate control name');
    const fb64 = CONTROL_NAMES.filter((n) => n.startsWith('fb64-')).sort();
    assert.deepEqual(fb64, ['fb64-bop-box', 'fb64-noinline-flag-drop', 'fb64-poison-opts-drop', 'fb64-poison-row-drop',
        'fb64-sab-blind', 'fb64-sab-flip', 'fb64-sab-reread', 'fb64-soak-retain', 'fb64-u32-storage']);
});
