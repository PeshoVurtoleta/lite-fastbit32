// test/WitnessConfirm.test.mjs -- in-process checks of the witness driver's
// cold path (no timing, no child processes):
//   - golden replay: every gate function (laneNoise, gateFlat, gateRed,
//     gateSubset, gateCells, subsetRow, slopeVerdict, gateSlope) returns, prints
//     and records BYTE-IDENTICALLY to the frozen efbb377 build on the vectors in
//     fixtures/witness-gates-golden.json (cut from that build, not this file);
//   - advisory(la): the load line is advice, never a gate; busy above 5;
//   - hostFails(): a failure set made ONLY of lane NOISE cap failures (a NOISE
//     was measured; noise/floor > cap) is a HOST verdict (run() exits 2); any
//     other failure, a NOISE that measured nothing included, is a finding (1).
//   - ONE intentional golden delta (addendum 10b): a malformed PRESSURE density
//     subset is a harness fault -- FAIL, never relabelled HOST (exit 1). The
//     fixture keeps the frozen cut; the test states the expected new output;
//   - cellMedian(rows) and the slope confirm (confirmSlope / ctlConfirmSlope)
//     with a stub respawn: exactly 2 re-measures, one verdict, fail closed
//     (cellMedian also fails closed on an even row count).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

delete process.env.WITNESS_CALIBRATE;   // CALIBRATE disables every verdict
delete process.env.WITNESS_FAST;

const HERE = dirname(fileURLToPath(import.meta.url));
// inputs decoded (NUM:/UNDEFINED -> values); expected outputs kept ENCODED, so
// the comparison is text against text (an undefined field decodes to "absent").
const TEXT = readFileSync(join(HERE, 'fixtures', 'witness-gates-golden.json'), 'utf8');
const GOLDEN = JSON.parse(TEXT, (k, v) => (v === 'UNDEFINED' ? undefined : typeof v === 'string' && v.startsWith('NUM:') ? Number(v.slice(4)) : v));
const EXPECT = JSON.parse(TEXT).cases.map((c) => JSON.stringify(c.out));

// The driver keeps lane state (NOISE, EPS, HOST_BAD, fails) at module level.
// A distinct specifier = a distinct module instance = clean state per case.
let seq = 0;
const fresh = () => import('./witness.mjs?confirm=' + (++seq));

// --- encoding + replay: verbatim the cutter's (frozen build, efbb377) -------
const enc = (x) => JSON.parse(JSON.stringify(x, (k, v) => (v === undefined ? 'UNDEFINED'
  : typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0)) ? 'NUM:' + (Object.is(v, -0) ? '-0' : String(v)) : v)));
const WHY = (m) => 'why ratio=' + m.ratio + ' spread=' + m.spread + ' min=' + m.min + ' max=' + m.max;
async function replay(steps) {
  const w = await fresh();
  const ret = [];
  for (const { fn, args } of steps) {
    const a = args.map((x) => (x === '$WHY' ? WHY : x));
    ret.push(w[fn](...a));
  }
  return enc({ ret, lines: w.lines, fails: w.fails, hostSuppressed: w.hostSuppressed, NOISE: w.NOISE, EPS: w.EPS, HOST_BAD: w.HOST_BAD });
}

// THE ONE INTENTIONAL GOLDEN DELTA (addendum 10b; delta 1 (a)). Frozen efbb377
// relabelled a malformed PRESSURE density subset HOST in a lane whose NOISE cap
// failed, so a run could exit 2 on a harness fault. Now it is a finding: the
// gate line reads FAIL and the message goes to fails, not hostSuppressed. The
// fixture keeps the FROZEN cut of this case; this is its expected new output.
const DELTA_10B = 'gateSubset PRESSURE HOST_BAD malformed + negative';
function delta10b(frozenText) {
  const o = JSON.parse(frozenText);
  const MAL = 'host mal [PRESSURE]: density gate subset d1..d31 empty, malformed or misaligned -- no verdict (fail closed)';
  const HOSTED = / HOST\(no verdict: lane NOISE failed\)$/;
  assert.deepEqual(o.hostSuppressed, ['PRESSURE: ' + MAL], 'frozen cut: suppressed into HOST');
  assert.match(o.lines[1], HOSTED);
  o.lines[1] = o.lines[1].replace(HOSTED, ' FAIL');
  o.hostSuppressed = [];
  o.fails.push(MAL);
  return JSON.stringify(o);
}

describe('golden replay -- gate functions byte-identical to frozen efbb377', () => {
  it('the fixture is the frozen build and covers every gate function', () => {
    assert.match(GOLDEN.source, /sha256 db61915e/);
    const fns = new Set(GOLDEN.cases.flatMap((c) => c.steps.map((s) => s.fn)));
    for (const f of ['laneNoise', 'gateFlat', 'gateRed', 'gateSubset', 'gateCells', 'subsetRow', 'slopeVerdict', 'gateSlope']) {
      assert.ok(fns.has(f), f);
    }
    assert.equal(GOLDEN.cases.filter((c) => c.name.startsWith('slopeVerdict forEach')).length >= 24, true);
  });
  it('exactly one case carries the intentional 10b delta', () => {
    assert.equal(GOLDEN.cases.filter((c) => c.name === DELTA_10B).length, 1);
  });
  GOLDEN.cases.forEach((c, i) => {
    const delta = c.name === DELTA_10B;
    it(c.name + (delta ? ' [INTENTIONAL DELTA 10b: malformed subset FAILS, never HOST]' : ''), async () => {
      // byte for byte against the fixture's encoded `out` (10b: its stated delta)
      assert.equal(JSON.stringify(await replay(c.steps)), delta ? delta10b(EXPECT[i]) : EXPECT[i]);
    });
  });
});

describe('advisory(la) -- load line, not a gate', () => {
  it('advisory(3): quiet note, says it is not a gate', async () => {
    const { advisory } = await fresh();
    const s = advisory(3);
    assert.match(s, /advisory, not a gate/);
    assert.match(s, /load average 3\.00/);
    assert.doesNotMatch(s, /busy host/);
  });
  it('advisory(6): busy-host note (threshold 5)', async () => {
    const { advisory } = await fresh();
    const s = advisory(6);
    assert.match(s, /advisory, not a gate/);
    assert.match(s, /load average 6\.00 -- busy host/);
  });
  it('advisory(6): the busy-host text is exact and never says "not a finding" (10c)', async () => {
    const { advisory } = await fresh();
    assert.equal(advisory(6), '  (advisory, not a gate) load average 6.00 -- busy host: a NOISE cap failure here is a HOST verdict (exit 2)');
    assert.doesNotMatch(advisory(6), /not a finding/);
  });
  it('advisory(5) is not busy (strictly above 5); advisory(5.01) is', async () => {
    const { advisory } = await fresh();
    assert.doesNotMatch(advisory(5), /busy host/);
    assert.match(advisory(5.01), /busy host/);
  });
  it('a non-finite load is not read as quiet (fail closed)', async () => {
    const { advisory } = await fresh();
    for (const la of [NaN, Infinity, undefined]) assert.match(advisory(la), /busy host/, String(la));
  });
});

// rows as spawn() returns them; [1, 1 + s] spreads s, floor 1 ns
const row = (lane, net, extra = {}) => ({
  lane, mode: 'position', net, params: net.map((_, i) => i), disp: net.map(() => 0.01),
  floor: net.map(() => 1), valid: true, label: 'synthetic', ...extra,
});
const quiet = (w, lane) => w.laneNoise(lane, [row(lane, [1, 1.05])]);   // NOISE 0.05, ok
const noisy = (w, lane) => w.laneNoise(lane, [row(lane, [1, 1.5])]);    // 0.5 > cap: HOST
const step = (lane) => row(lane, [1, 1, 1, 9]);                         // a finding

describe('hostFails() -- exit 2 only when EVERY failure is a NOISE cap failure', () => {
  it('a clean run is not a HOST verdict (exit 0)', async () => {
    const w = await fresh();
    quiet(w, 'HOT');
    w.gateFlat(row('HOT', [1, 1.01]), 'flat');
    assert.equal(w.fails.length, 0);
    assert.equal(w.hostFails(), false);
  });
  it('NOISE failure only (its lane gates relabelled HOST): true', async () => {
    const w = await fresh();
    noisy(w, 'HOT');
    w.gateFlat(step('HOT'), 'step under HOST');   // -> hostSuppressed, not fails
    assert.equal(w.fails.length, 1);
    assert.equal(w.hostSuppressed.length, 1);
    assert.equal(w.hostFails(), true);
  });
  it('NOISE failures in both lanes: true', async () => {
    const w = await fresh();
    noisy(w, 'HOT');
    noisy(w, 'PRESSURE');
    assert.equal(w.fails.length, 2);
    assert.equal(w.hostFails(), true);
  });
  it('NOISE failure plus a finding in the other lane: false (exit 1)', async () => {
    const w = await fresh();
    noisy(w, 'HOT');
    quiet(w, 'PRESSURE');
    w.gateFlat(step('PRESSURE'), 'step');
    assert.equal(w.fails.length, 2);
    assert.equal(w.hostFails(), false);
  });
  it('a finding only: false', async () => {
    const w = await fresh();
    quiet(w, 'HOT');
    w.gateFlat(step('HOT'), 'step');
    assert.equal(w.hostFails(), false);
  });
  it('a failure pushed outside laneNoise (spawn malformed row) is a finding: false', async () => {
    const w = await fresh();
    noisy(w, 'HOT');
    w.fails.push('fb/count HOT density: malformed or non-finite result');
    assert.equal(w.hostFails(), false);
  });
  // A NOISE failure that measured nothing is a harness bug, never host noise:
  // only the noise/floor CAP failing is a HOST verdict.
  it('zero-spread rows (NOISE 0: quantized timer, constant cells) are a finding: false', async () => {
    const w = await fresh();
    w.laneNoise('HOT', [row('HOT', [1, 1]), row('HOT', [2, 2]), row('HOT', [3, 3])]);
    w.gateFlat(step('HOT'), 'step under NOISE 0');   // suppressed: HOST_BAD as before
    assert.equal(w.HOST_BAD.HOT, true);
    assert.equal(w.hostSuppressed.length, 1);
    assert.equal(w.fails.length, 1);
    assert.equal(w.hostFails(), false);
  });
  it('invalid rows only (no NOISE measured) are a finding: false', async () => {
    const w = await fresh();
    w.laneNoise('HOT', [row('HOT', [1, 1.05], { valid: false }), row('HOT', [1, 1.5], { valid: false })]);
    assert.equal(w.fails.length, 1);
    assert.equal(w.hostFails(), false);
  });
  it('a non-finite or non-positive floor is a finding: false', async () => {
    for (const fl of [NaN, 0, -1, Infinity]) {
      const w = await fresh();
      w.laneNoise('HOT', [row('HOT', [1, 1.05], { floor: [fl, fl] })]);
      assert.equal(w.fails.length, 1, String(fl));
      assert.equal(w.hostFails(), false, String(fl));
    }
  });
  it('a non-finite NOISE (a valid row spreading [1, Infinity]) is a finding: false', async () => {
    const w = await fresh();
    w.laneNoise('HOT', [row('HOT', [1, Infinity])]);
    assert.equal(w.fails.length, 1);
    assert.equal(w.HOST_BAD.HOT, true);
    assert.equal(w.hostFails(), false);
  });
  it('a cap failure in one lane plus a no-measurement NOISE failure in the other: false', async () => {
    const w = await fresh();
    noisy(w, 'HOT');
    w.laneNoise('PRESSURE', []);
    assert.equal(w.fails.length, 2);
    assert.equal(w.hostFails(), false);
  });
  it('a NOISE-looking string that laneNoise did not record is a finding: false', async () => {
    const w = await fresh();
    w.fails.push('NOISE HOT: 0.500 ns vs floor 1.000 -- host too noisy');
    assert.equal(w.hostFails(), false);
  });
});

describe('10b -- a malformed PRESSURE density subset is a finding, never HOST', () => {
  const mal = (net = [1, 1]) => row('PRESSURE', net, { mode: 'density', params: [0, 32] });
  for (const red of [false, true]) {
    it(`${red ? 'RED' : 'FLAT'}: under a PRESSURE NOISE cap failure it FAILS and hostFails() is false (exit 1; bcaba149: 2)`, async () => {
      const w = await fresh();
      noisy(w, 'PRESSURE');
      assert.equal(w.HOST_BAD.PRESSURE, true);
      w.gateSubset(mal(red ? [1, 9] : [1, 1]), 'mal', red ? () => 'why' : undefined);
      const l = w.lines.at(-1);
      assert.match(l, /gate subset d1\.\.d31 empty, malformed or misaligned \(params \[0,32\]\) FAIL$/);
      assert.doesNotMatch(l, /HOST/);
      assert.deepEqual(w.hostSuppressed, []);
      assert.equal(w.fails.length, 2);
      assert.match(w.fails[1], /^mal \[PRESSURE\]: density gate subset d1\.\.d31 empty, malformed or misaligned -- no verdict \(fail closed\)$/);
      assert.equal(w.hostFails(), false);
    });
  }
  it('in a quiet lane it fails exactly as before (one finding)', async () => {
    const w = await fresh();
    quiet(w, 'PRESSURE');
    w.gateSubset(mal(), 'mal');
    assert.equal(w.fails.length, 1);
    assert.match(w.lines.at(-1), / FAIL$/);
  });
});

// --- cellMedian + slope confirm ----------------------------------------------
const KF = Array.from({ length: 17 }, (_, i) => i * 2);   // 0, 2, .., 32
const lin = (j = 0) => KF.map((k, i) => 0.5 + k + 0.05 * (((i + j) * 7) % 3));
const srow = (net, extra = {}) => ({
  subject: 'fb', op: 'forEach', lane: 'HOT', mode: 'slope', params: KF, net, disp: KF.map(() => 0.01),
  floor: KF.map(() => 1), valid: true, label: 'synthetic slope', flags: [], spec: { synthetic: true }, ...extra,
});
const mrow = (net, extra = {}) => ({ ...row('HOT', net), ...extra });
// a stub respawn: hands out `rows` in order, counts its calls, takes no argument.
function stub(...rows) {
  const f = (...args) => { f.args.push(args); return rows[f.calls++]; };
  f.calls = 0; f.args = [];
  return f;
}

describe('cellMedian(rows) -- cellwise median of an odd count >= 3, fail closed', () => {
  it('drops a 1-of-3 outlier (outlier in row 0: not rows[0])', async () => {
    const { cellMedian } = await fresh();
    const m = cellMedian([mrow([1, 9, 3]), mrow([1.1, 2, 3]), mrow([1, 2.1, 3.1])]);
    assert.equal(m.valid, true);
    assert.deepEqual(m.net, [1, 2.1, 3]);
    assert.deepEqual(m.params, [0, 1, 2]);
  });
  it('keeps a 3-of-3 step and a 2-of-3 step', async () => {
    const { cellMedian } = await fresh();
    assert.deepEqual(cellMedian([mrow([1, 1, 5]), mrow([1, 1, 5.1]), mrow([1, 1, 4.9])]).net, [1, 1, 5]);
    assert.deepEqual(cellMedian([mrow([1, 1, 1]), mrow([1, 1, 5]), mrow([1, 1, 5.2])]).net, [1, 1, 5]);
  });
  it('medians disp and floor too, keeps row 0 identity, unions flags', async () => {
    const { cellMedian } = await fresh();
    const m = cellMedian([mrow([1, 1], { disp: [0.3, 0.1], floor: [2, 1], flags: ['a'] }), mrow([1, 1], { disp: [0.1, 0.2], flags: ['b', 'a'] }), mrow([1, 1], { disp: [0.2, 0.3] })]);
    assert.deepEqual(m.disp, [0.2, 0.2]);
    assert.deepEqual(m.floor, [1, 1]);
    assert.deepEqual(m.flags, ['a', 'b']);
    assert.equal(m.label, 'synthetic');
    assert.equal(m.lane, 'HOT');
  });
  it('fails closed: < 3 rows, invalid row, differing params, misaligned or non-finite arrays', async () => {
    const { cellMedian } = await fresh();
    const ok = () => mrow([1, 2]);
    const bad = {
      'not an array': null,
      empty: [],
      'one row': [ok()],
      'two rows': [ok(), ok()],
      'a null row': [ok(), null, ok()],
      'row 0 null': [null, ok(), ok()],
      'invalid row': [ok(), mrow([1, 2], { valid: false }), ok()],
      'valid not true': [ok(), ok(), mrow([1, 2], { valid: 1 })],
      'params differ': [ok(), mrow([1, 2], { params: [0, 2] }), ok()],
      'params longer': [ok(), mrow([1, 2, 3]), ok()],
      'params not array': [ok(), mrow([1, 2], { params: null }), ok()],
      'empty params': [mrow([]), mrow([]), mrow([])],
      'net short': [ok(), mrow([1, 2], { net: [1] }), ok()],
      'disp missing': [ok(), mrow([1, 2], { disp: undefined }), ok()],
      'floor short': [ok(), ok(), mrow([1, 2], { floor: [1] })],
      'NaN net': [ok(), mrow([1, NaN]), ok()],
      'Infinity net': [ok(), ok(), mrow([1, Infinity])],
      'NaN disp': [ok(), mrow([1, 2], { disp: [0.1, NaN] }), ok()],
      'Infinity floor': [mrow([1, 2], { floor: [1, Infinity] }), ok(), ok()],
    };
    for (const [k, rows] of Object.entries(bad)) {
      const m = cellMedian(rows);
      assert.equal(m.valid, false, k);
      assert.deepEqual(m.net, [], k);
    }
    assert.equal(cellMedian([ok(), ok(), ok()]).valid, true);
  });
  it('fails closed on an EVEN row count (no upper-middle pick); odd 3 and 5 give the true median', async () => {
    const { cellMedian } = await fresh();
    // cell 0 carries 1/2/9/10: an upper-middle pick on 4 rows would return 9
    const even = {
      'two rows': [mrow([1, 5]), mrow([2, 5])],
      'four rows': [mrow([1, 5]), mrow([2, 5]), mrow([9, 5]), mrow([10, 5])],
      'six rows': [mrow([1, 5]), mrow([2, 5]), mrow([9, 5]), mrow([10, 5]), mrow([3, 5]), mrow([4, 5])],
    };
    for (const [k, rows] of Object.entries(even)) {
      const m = cellMedian(rows);
      assert.equal(m.valid, false, k);
      assert.deepEqual(m.net, [], k);
      assert.deepEqual(m.disp, [], k);
      assert.deepEqual(m.floor, [], k);
      assert.deepEqual(m.flags, [], k);
    }
    const m3 = cellMedian([mrow([9, 5]), mrow([1, 5.2]), mrow([2, 4.8])]);
    assert.equal(m3.valid, true);
    assert.deepEqual(m3.net, [2, 5]);
    const m5 = cellMedian([mrow([10, 5]), mrow([1, 4]), mrow([9, 7]), mrow([2, 6]), mrow([3, 3])]);
    assert.equal(m5.valid, true);
    assert.deepEqual(m5.net, [3, 5]);   // sorted 1,2,3,9,10 -> 3; 3,4,5,6,7 -> 5
    assert.deepEqual(m5.params, [0, 1]);
  });
});

describe('confirmSlope(res, name, respawn) -- one confirmation, exactly 2 re-measures', () => {
  it('a passing row: 0 respawns, output byte-identical to gateSlope', async () => {
    const w = await fresh(), g = await fresh();
    quiet(w, 'HOT'); quiet(g, 'HOT');
    const r = stub();
    const c = w.confirmSlope(srow(lin()), 'forEach', r);
    g.gateSlope(srow(lin()), 'forEach', false);
    assert.equal(r.calls, 0);
    assert.equal(c.confirmed, false);
    assert.equal(c.linear, true);
    assert.deepEqual(w.lines, g.lines);
    assert.deepEqual(w.fails, []);
    assert.equal(w.lines.filter((l) => /^ {2}CONFIRM/.test(l)).length, 0);
  });
  it('a 1st-process resid outlier: exactly 2 respawns -> linear, a CONFIRM note, no finding', async () => {
    const w = await fresh();
    quiet(w, 'HOT');
    const bump = lin().map((v, i) => (KF[i] === 16 ? v + 8 : v));
    const r = stub(srow(lin(1)), srow(lin(2)));
    const c = w.confirmSlope(srow(bump), 'forEachMaskDiff', r);
    assert.equal(r.calls, 2);
    assert.deepEqual(r.args, [[], []]);
    assert.equal(c.confirmed, true);
    assert.equal(c.one.linear, false);
    assert.equal(c.linear, true);
    assert.deepEqual(w.fails, []);
    const conf = w.lines.filter((l) => /^ {2}CONFIRM HOT +forEachMaskDiff +one process not linear\(resid\)/.test(l));
    assert.equal(conf.length, 1, w.lines.join('\n'));
    assert.match(w.lines.at(-1), /^ {2}SLOPE HOT +forEachMaskDiff .* ok$/);
  });
  it('a step in all 3 processes: exactly 2 respawns -> FAIL (a finding)', async () => {
    const w = await fresh();
    quiet(w, 'HOT');
    const st = (j) => lin(j).map((v, i) => (KF[i] >= 16 ? v + 16 : v));
    const r = stub(srow(st(1)), srow(st(2)));
    const c = w.confirmSlope(srow(st(0)), 'forEach', r);
    assert.equal(r.calls, 2);
    assert.equal(c.linear, false);
    assert.equal(w.fails.length, 1);
    assert.match(w.fails[0], /^SLOPE forEach: /);
    assert.match(w.lines.at(-1), /^ {2}SLOPE HOT +forEach .* FAIL\(/);
    assert.equal(w.hostFails(), false);
  });
  it('a step in 2 of 3 (process 1 + one re-measure): the median keeps it, FAIL', async () => {
    const w = await fresh();
    quiet(w, 'HOT');
    const st = (j) => lin(j).map((v, i) => (KF[i] >= 16 ? v + 16 : v));
    const r = stub(srow(lin(1)), srow(st(2)));
    w.confirmSlope(srow(st(0)), 'forEach', r);
    assert.equal(r.calls, 2);
    assert.equal(w.fails.length, 1);
  });
  it('a 1st-process FAIL that the median does not clear: still exactly 2 respawns (no loop until linear)', async () => {
    const w = await fresh();
    quiet(w, 'HOT');
    const bump = (j) => lin(j).map((v, i) => (KF[i] === 16 ? v + 8 : v));
    // 2 bumped re-measures, then clean rows a looping confirm would reach
    const r = stub(srow(bump(1)), srow(bump(2)), srow(lin(3)), srow(lin(4)), srow(lin(5)));
    const c = w.confirmSlope(srow(bump(0)), 'forEachMaskDiff', r);
    assert.equal(r.calls, 2);
    assert.equal(c.linear, false);
    assert.equal(w.fails.length, 1);
  });
  for (const [k, bad] of Object.entries({
    'invalid': srow(lin(1), { valid: false }),
    'misaligned': srow(lin(1).slice(0, 5)),
    'non-finite': srow(lin(1).map((v, i) => (i === 3 ? NaN : v))),
    'other params': srow(lin(1), { params: KF.map((x) => x + 1) }),
    'undefined': undefined,
  })) {
    it(`a malformed re-measure (${k}): FAIL, no verdict, a finding`, async () => {
      const w = await fresh();
      quiet(w, 'HOT');
      const st = lin().map((v, i) => (KF[i] === 16 ? v + 8 : v));
      const r = stub(bad, srow(lin(2)));
      const c = w.confirmSlope(srow(st), 'forEachMaskDiff', r);
      assert.equal(r.calls, 2);
      assert.equal(c.valid, false);
      assert.equal(c.linear, false);
      assert.deepEqual(w.fails, ['SLOPE forEachMaskDiff: confirm re-measure malformed or misaligned -- no verdict (fail closed)']);
      assert.match(w.lines.at(-1), /^ {2}SLOPE HOT +forEachMaskDiff +median of 3: .* FAIL\(no verdict\)$/);
      assert.equal(w.hostFails(), false);
    });
  }
  it('HOST_BAD.HOT: 0 respawns, the single-process line reads HOST, no new finding', async () => {
    const w = await fresh(), g = await fresh();
    noisy(w, 'HOT'); noisy(g, 'HOT');
    const st = lin().map((v, i) => (KF[i] >= 16 ? v + 16 : v));
    const r = stub(srow(st), srow(st));
    w.confirmSlope(srow(st), 'forEach', r);
    g.gateSlope(srow(st), 'forEach', false);
    assert.equal(r.calls, 0);
    assert.deepEqual(w.lines, g.lines);
    assert.match(w.lines.at(-1), /HOST\(no verdict: lane NOISE failed\)$/);
    assert.equal(w.fails.length, 1);   // the NOISE failure only
    assert.equal(w.hostFails(), true);
  });
  it('CALIBRATE: 0 respawns, no verdict', async () => {
    process.env.WITNESS_CALIBRATE = '1';
    let w;
    try { w = await fresh(); } finally { delete process.env.WITNESS_CALIBRATE; }
    quiet(w, 'HOT');
    const st = lin().map((v, i) => (KF[i] >= 16 ? v + 16 : v));
    const r = stub(srow(st), srow(st));
    const c = w.confirmSlope(srow(st), 'forEach', r);
    assert.equal(r.calls, 0);
    assert.equal(c.confirmed, false);
    assert.deepEqual(w.fails, []);
    assert.equal(w.lines.filter((l) => /^ {2}CONFIRM/.test(l)).length, 0);
  });
  it('an invalid single-process row: 0 respawns (spawn already failed it), gated as before', async () => {
    const w = await fresh(), g = await fresh();
    quiet(w, 'HOT'); quiet(g, 'HOT');
    const r = stub(srow(lin(1)), srow(lin(2)));
    w.confirmSlope(srow(lin(), { valid: false }), 'forEach', r);
    g.gateSlope(srow(lin(), { valid: false }), 'forEach', false);
    assert.equal(r.calls, 0);
    assert.deepEqual(w.lines, g.lines);
    assert.deepEqual(w.fails, g.fails);
  });
  it('quiet mode prints and records nothing', async () => {
    const w = await fresh();
    quiet(w, 'HOT');
    const st = lin().map((v, i) => (KF[i] >= 16 ? v + 16 : v));
    const n = w.lines.length;
    const c = w.confirmSlope(srow(st), 'forEach', stub(srow(st), srow(st)), true);
    assert.equal(c.linear, false);
    assert.equal(w.lines.length, n);
    assert.deepEqual(w.fails, []);
  });
});

describe('ctlConfirmSlope -- foilIterStep judged as a real iterator must end non-linear', () => {
  const stepNet = (j) => lin(j).map((v, i) => (KF[i] >= 16 ? v + 16 : v));
  it('a step in all 3: ok, exactly 2 respawns, no finding', async () => {
    const w = await fresh();
    quiet(w, 'HOT');
    const r = stub(srow(stepNet(1)), srow(stepNet(2)));
    w.ctlConfirmSlope(srow(stepNet(0)), r);
    assert.equal(r.calls, 2);
    assert.deepEqual(w.fails, []);
    assert.match(w.lines.at(-1), /^ {2}CTRL confirm-slope foilIterStep as a real iterator: process 1 not linear\(resid\); median of 3 resid=[0-9.]+xslope ok\(non-linear: resid\)$/);
    assert.doesNotMatch(w.lines.at(-1), /FAIL/);   // a passing CTRL line never says FAIL
  });
  it('the median clears it (re-measures linear): FAIL, confirm-slope has no teeth', async () => {
    const w = await fresh();
    quiet(w, 'HOT');
    const r = stub(srow(lin(1)), srow(lin(2)));
    w.ctlConfirmSlope(srow(stepNet(0)), r);
    assert.equal(r.calls, 2);
    assert.deepEqual(w.fails, ['confirm-slope has no teeth']);
    assert.match(w.lines.at(-1), /FAIL\(ended linear: no teeth\)$/);
  });
  it('process 1 already linear: 0 respawns, FAIL', async () => {
    const w = await fresh();
    quiet(w, 'HOT');
    const r = stub(srow(stepNet(1)), srow(stepNet(2)));
    w.ctlConfirmSlope(srow(lin()), r);
    assert.equal(r.calls, 0);
    assert.deepEqual(w.fails, ['confirm-slope has no teeth']);
    assert.match(w.lines.at(-1), /process 1 linear; not re-measured FAIL\(ended linear: no teeth\)$/);
  });
  it('a malformed re-measure: FAIL', async () => {
    const w = await fresh();
    quiet(w, 'HOT');
    w.ctlConfirmSlope(srow(stepNet(0)), stub(srow(stepNet(1), { valid: false }), srow(stepNet(2))));
    assert.deepEqual(w.fails, ['confirm-slope has no teeth']);
    assert.match(w.lines.at(-1), /median of 3 malformed FAIL\(malformed re-measure: no teeth\)$/);
  });
  it('HOST_BAD.HOT: not run, 0 respawns, the line reads HOST', async () => {
    const w = await fresh();
    noisy(w, 'HOT');
    const r = stub(srow(stepNet(1)), srow(stepNet(2)));
    w.ctlConfirmSlope(srow(stepNet(0)), r);
    assert.equal(r.calls, 0);
    assert.equal(w.fails.length, 1);
    assert.match(w.lines.at(-1), /^ {2}CTRL confirm-slope foilIterStep as a real iterator: not run \(HOST\(no verdict: lane NOISE failed\)\)$/);
  });
});
