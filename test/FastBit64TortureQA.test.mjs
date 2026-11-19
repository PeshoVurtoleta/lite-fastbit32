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
// T7-FIX (2026-11-19): 53 -> 54 with t7-frame-pin. Its inline churn in t7-soak.mjs run() must be the same
// statements as fb32Cycle's body, so the control tests the shipped churn and cannot drift (source text only,
// no git history: LEDGER E4).

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

test('A17 (3) CONTROL_NAMES is 54: the 44 of 1.6.1, nine FastBit64 controls (fb64-sab-flip among them) and t7-frame-pin', () => {
    assert.equal(CONTROL_NAMES.length, 54);
    assert.equal(new Set(CONTROL_NAMES).size, 54, 'duplicate control name');
    assert.ok(CONTROL_NAMES.includes('t7-frame-pin'), 't7-frame-pin registered');
    const fb64 = CONTROL_NAMES.filter((n) => n.startsWith('fb64-')).sort();
    assert.deepEqual(fb64, ['fb64-bop-box', 'fb64-noinline-flag-drop', 'fb64-poison-opts-drop', 'fb64-poison-row-drop',
        'fb64-sab-blind', 'fb64-sab-flip', 'fb64-sab-reread', 'fb64-soak-retain', 'fb64-u32-storage']);
});

// T7-FIX fidelity: statements of fb32Cycle's body vs run()'s <t7-frame-pin copy> block. Normalized: line comments
// dropped (neither body has '//' inside a string), each line trimmed, inner whitespace collapsed, blank lines dropped.
const T7 = new URL('./torture/t7-soak.mjs', import.meta.url);
const stmts = (text) => text.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim().replace(/\s+/g, ' ')).filter((l) => l !== '');
function fb32CycleBody(src) {
    const head = 'function fb32Cycle(ctx, FB, Mapper, names, seg, c, tracker, stash) {\n';
    const at = src.indexOf(head);
    assert.ok(at >= 0, 'fb32Cycle not found in t7-soak.mjs');
    assert.equal(src.indexOf('function fb32Cycle(', at + 1), -1, 'fb32Cycle declared twice');
    const end = src.indexOf('\n}\n', at);
    assert.ok(end > at, 'fb32Cycle has no closing brace at column 0');
    return src.slice(at + head.length, end + 1);
}
function framePinCopy(src) {
    const open = '// <t7-frame-pin copy>\n', close = '// </t7-frame-pin copy>';
    const at = src.indexOf(open);
    assert.ok(at >= 0, 't7-frame-pin copy marker not found');
    assert.equal(src.indexOf(open, at + 1), -1, 't7-frame-pin copy marker twice');
    const end = src.indexOf(close, at);
    assert.ok(end > at, 't7-frame-pin copy has no closing marker');
    assert.equal(src.indexOf(close, end + 1), -1, 't7-frame-pin closing marker twice');
    return src.slice(at + open.length, end);
}

test('T7-FIX the t7-frame-pin inline copy is statement-identical to fb32Cycle (the control tests the shipped churn)', () => {
    const src = readFileSync(T7, 'utf8');
    const body = stmts(fb32CycleBody(src));
    const copy = stmts(framePinCopy(src));
    // teeth: the body is the churn itself, not an empty or partial match
    assert.ok(body.length >= 10, 'fb32Cycle body has ' + body.length + ' statements');
    assert.equal(body[0], 'const mapper = new Mapper(names);');
    assert.ok(body.includes('tracker.track(inst, moduleNoop, (seg * PER_SEG + c) * 64 + n, { audit: true });'), 'track row');
    assert.ok(body.includes('if (stash) STASH.push(inst);'), 'stash row');
    assert.deepEqual(copy, body); // mutant: edit one copy only (op, tag, SINK, stash) -> differs
});

test('T7-FIX run() calls fb32Cycle once, in the not-frame-pin branch, and the control flag gates the inline copy', () => {
    const src = readFileSync(T7, 'utf8');
    const at = src.indexOf('export async function run(ctx) {');
    assert.ok(at >= 0, 'run not found');
    const run = src.slice(at);
    const calls = run.split('fb32Cycle(ctx, FB, Mapper, names, seg, c, tracker, stash);').length - 1;
    assert.equal(calls, 1, 'fb32Cycle call sites in run()');
    assert.match(run, /const framePin = ctx\.control\.t7FramePin === true;/);
    assert.match(run, /if \(framePin\) \{\n[^]*?\/\/ <t7-frame-pin copy>[^]*?\/\/ <\/t7-frame-pin copy>\n\s*\} else \{\n\s*fb32Cycle\(ctx, FB, Mapper, names, seg, c, tracker, stash\);\n\s*\}/);
    // the churn appears exactly twice in the module: fb32Cycle and the control copy
    assert.equal(src.split('const inst = new FB(n * 2654435761);').length - 1, 2);
});

test('T7-FIX torture.mjs runs framePinLane exactly once, in the normal-run tier loop', () => {
    const src = readFileSync(new URL('./torture.mjs', import.meta.url), 'utf8');
    const at = src.indexOf('// ---- normal run'), end = src.indexOf('// ---- control fidelity');
    assert.ok(at >= 0 && end > at, 'normal-run section');
    assert.equal(src.split('framePinLane(ctx)').length - 1, 1, 'framePinLane call sites');
    assert.ok(src.slice(at, end).includes("if (name === 'T7') for (const f of framePinLane(ctx)) r.fails.push(f);"), 'lane call in the normal-run loop');
});
