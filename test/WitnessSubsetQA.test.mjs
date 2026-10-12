// QA (witness PRESSURE density subset, 2026-10-11): written from the spec
// (CHANGELOG [Unreleased], METHODOLOGY "PRESSURE density d0/d32"), independent
// of the coder's Witness.test.mjs.
//
// 1. run() WIRING: the unit tests drive gateSubset / laneNoise directly; nothing
//    else proves run() routes the PRESSURE real ops, the two foils, SEP and the
//    NOISE through the subset, keeps HOT / position / ctlRead on every cell, and
//    spawns the kwords control. Here the REAL driver (a byte copy of
//    test/witness.mjs) runs end to end against a FAKE run-one.mjs that returns
//    synthetic, deterministic rows (no timing): one scenario per clause.
// 2. gateCells / subsetRow / gateSubset boundary matrix the shipped tests skip.
// 3. run-one `kwords` corpus mode: K / density validation and the DISTINCT rule
//    (d1 has exactly 32 words: K = 32 draws, K = 33 must throw).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONST_OPS } from './witness.mjs';   // the registry the driver loops over (main-guarded: no run on import)

delete process.env.WITNESS_CALIBRATE;
delete process.env.WITNESS_FAST;

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_ONE = join(HERE, 'witness', 'run-one.mjs');

// ---------------------------------------------------------------------------
// fake run-one: same CLI (argv[2] = JSON spec) and output shape as the real one.
// Real-op rows: 1 + {0, 0.01, 0.02} -> NOISE 0.020 ns in both lanes.
const FAKE = String.raw`
const spec = JSON.parse(process.argv[2]);
const S = process.env.WQA_SCENARIO || 'base';
const { subject, op, lane, mode, params } = spec;
const P = params.length;
const flat = () => params.map((_, i) => 1 + 0.01 * ((i * 7) % 3));
const ramp = () => params.map((d) => 1 + 0.1 * d);
let net;
if (mode === 'slope') {
  if (subject === 'foilIterQuad') net = params.map((k) => 0.2 + 0.25 * k * k);
  else if (subject === 'foilIterScan32') net = params.map((k) => 9.6 + 0.3 * k);
  else if (subject === 'foilIterStep') net = params.map((k) => 0.5 + k + (k >= 16 ? 16 : 0));
  else net = params.map((k) => 0.5 + k);
} else if (mode === 'kwords') {
  const okSpec = subject === 'fb' && op === 'select' && lane === 'PRESSURE' && spec.density === 16 &&
    JSON.stringify(params) === '[1,2,2048]';
  net = okSpec ? [0.5, 0.9, 1.0] : params.map(() => 9);
  if (S === 'kwbad') net = [0.5, 0.9];
} else if (subject === 'ctlRead' && spec.floor === 'foilKernighan') {
  net = params.map(() => -1);
} else if (mode === 'slot') {
  net = op === 'foilWordScan' ? ramp() : flat();
} else if (subject === 'foilLut16') {
  net = lane === 'PRESSURE' ? params.map((d) => 1 + 0.5 * Math.sin(Math.PI * d / 32)) : flat();
  if (S === 'lutedge' && lane === 'PRESSURE') net = flat().map((v, i) => (params[i] === 32 ? 3 : v));
} else if (subject === 'foilSubEps') {
  net = params.map((p) => 1 + (p === 32 || p === 101 ? 0.7 : 0));
} else if (subject !== 'fb' && subject !== 'ctlRead') {
  net = ramp();
  if (S === 'kernedge' && subject === 'foilKernighan' && lane === 'PRESSURE') net = flat().map((v, i) => (params[i] === 0 ? 3 : v));
} else {
  net = flat();
  const sel = subject === 'fb' && op === 'select';
  const edge = (p) => p === 0 || p === 32;
  if (S === 'dip' && subject === 'fb' && lane === 'PRESSURE' && mode === 'density') net = net.map((v, i) => (edge(params[i]) ? 0.7 : v));
  if (S === 'hotdip' && sel && lane === 'HOT' && mode === 'density') net = net.map((v, i) => (edge(params[i]) ? 0.7 : v));
  if (S === 'midstep' && sel && lane === 'PRESSURE' && mode === 'density') net = net.map((v, i) => (params[i] === 16 ? v + 0.3 : v));
  if (S === 'neg32' && sel && lane === 'PRESSURE' && mode === 'density') net = net.map((v, i) => (params[i] === 32 ? -1 : v));
  if (S === 'ctldip' && subject === 'ctlRead' && lane === 'PRESSURE' && mode === 'density') net = net.map((v, i) => (edge(params[i]) ? 0.7 : v));
  if (S === 'posdip' && sel && lane === 'PRESSURE' && mode === 'position') net = net.map((v, i) => (params[i] === 100 || params[i] === 101 ? 0.7 : v));
}
const floor = net.map(() => 1);
process.stdout.write(JSON.stringify({ subject, op, lane, mode, params, raw: net.map((v) => v + 1), floor, net,
  disp: net.map(() => 0.005), rounds: [net], flags: [] }) + '\n');
`;

let DIR;
const runs = {};
const SCEN = ['base', 'dip', 'hotdip', 'midstep', 'lutedge', 'kernedge', 'neg32', 'ctldip', 'posdip', 'kwbad'];

function runScenario(s) {
  return new Promise((res) => {
    const env = { ...process.env, WQA_SCENARIO: s };
    delete env.WITNESS_FAST; delete env.WITNESS_CALIBRATE;
    execFile(process.execPath, [join(DIR, 'witness.mjs')], { env, encoding: 'utf8', maxBuffer: 64 << 20 }, (err, stdout) => {
      const code = err ? err.code : 0;
      const i = stdout.indexOf('\nFAILURES:\n');
      const failures = i < 0 ? [] : stdout.slice(i + 11).split('\n').filter((l) => l.startsWith('  ')).map((l) => l.slice(2));
      res({ code, stdout, failures, lines: stdout.split('\n') });
    });
  });
}

describe('run() wiring -- the real driver against a synthetic run-one (no timing)', () => {
  before(async () => {
    // realpath: on macOS tmpdir() is a symlink, and the driver only runs when
    // argv[1] equals its own (real) module path.
    DIR = realpathSync(mkdtempSync(join(tmpdir(), 'fb32-wqa-')));
    mkdirSync(join(DIR, 'witness'));
    copyFileSync(join(HERE, 'witness.mjs'), join(DIR, 'witness.mjs'));
    writeFileSync(join(DIR, 'witness', 'run-one.mjs'), FAKE);
    // serial, one driver at a time (each spawns ~135 children): so npm test does
    // not load the host right before verify's timing gates.
    const t0 = Date.now();
    for (const s of SCEN) runs[s] = await runScenario(s);
    console.log('WitnessSubsetQA scenario runs wall time: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  }, { timeout: 300000 });
  after(() => { if (DIR) rmSync(DIR, { recursive: true, force: true }); });

  const noiseLine = (r, lane) => r.lines.find((l) => l.startsWith('  NOISE ' + lane));

  it('base: a clean synthetic run passes (the fake is a valid harness), SEP is d1..d31, one INFO d0/d32 line per CONST_OPS op + 2 foils', () => {
    const r = runs.base;
    assert.deepEqual(r.failures, []);
    assert.equal(r.code, 0);
    assert.ok(noiseLine(r, 'PRESSURE').includes(`NOISE PRESSURE 0.020 ns (median cell-to-cell spread of ${2 * CONST_OPS.length} real-op rows`), noiseLine(r, 'PRESSURE'));
    const info = r.lines.filter((l) => /^ {2}INFO PRESSURE .* d0=\S+ d32=\S+ ns not gated for flatness/.test(l));
    assert.equal(info.length, CONST_OPS.length + 2, info.join('\n'));   // every real op + foilLut16 + foilKernighan
    // each op routed through the subset, by name (a count alone could hide a swap)
    for (const op of [...CONST_OPS, 'foilLut16', 'foilKernighan']) {
      assert.equal(info.filter((l) => l.startsWith(`  INFO PRESSURE ${op} (density) `)).length, 1, op);
    }
    assert.equal(r.lines.filter((l) => /^ {2}INFO HOT .*not gated for flatness/.test(l)).length, 0);
    assert.ok(r.lines.some((l) => /^ {2}SEP {2}PRESSURE .*\(d1\.\.d31\).* ok$/.test(l)));
    assert.ok(r.lines.some((l) => /^ {2}RED {2}PRESSURE foilLut16 \(density\) \[d1\.\.31\]/.test(l)));
    assert.ok(r.lines.some((l) => /^ {2}RED {2}PRESSURE foilKernighan \(density\) \[d1\.\.31\]/.test(l)));
    // position rows and ctlRead in PRESSURE carry no subset tag
    assert.ok(r.lines.some((l) => /^ {2}FLAT PRESSURE select \(position\) +ratio/.test(l)));
    assert.ok(r.lines.some((l) => /^ {2}FLAT PRESSURE ctlRead \(density\) \[control\] ratio/.test(l)));
    assert.equal(r.lines.filter((l) => /^ {2}FLAT HOT .*\[d1\.\.31\]/.test(l)).length, 0);
  });

  it('base: the K = 1 / 2 / 2048 control is spawned as PRESSURE fb/select kwords d16 and printed INFO (not gated)', () => {
    const ctl = runs.base.lines.filter((l) => /^ {2}INFO PRESSURE CTRL select d16 one-word stream/.test(l));
    assert.equal(ctl.length, 1);
    // the fake answers 0.5 / 0.9 / 1.0 ONLY for the exact spec (else 9 / 9 / 9)
    assert.match(ctl[0], /K=1 0\.500 K=2 0\.900 K=2048 1\.000 ns; K=1 - K=2048 = -0\.500 ns = -25\.00N \(info, not gated/);
  });

  it('dip: a d0/d32 one-word dip on EVERY PRESSURE density real row passes, and NOISE PRESSURE ignores it', () => {
    const r = runs.dip;
    assert.deepEqual(r.failures, []);
    assert.equal(r.code, 0);
    // all-cell NOISE would be 0.320 (22 of 44 rows spread 0.32; median = sorted[22])
    assert.match(noiseLine(r, 'PRESSURE'), /NOISE PRESSURE 0\.020 ns/);
    assert.ok(r.lines.some((l) => /^ {2}INFO PRESSURE select \(density\) +d0=0\.700 d32=0\.700 ns .*negative-cell check ok/.test(l)));
  });

  it('hotdip: the same dip in HOT still FAILS (HOT keeps d0/d32)', () => {
    const r = runs.hotdip;
    assert.equal(r.code, 1);
    assert.equal(r.failures.length, 1, r.failures.join('\n'));
    assert.match(r.failures[0], /^select \(density\) \[HOT\]/);
  });

  it('midstep: a step INSIDE d1..d31 FAILS the PRESSURE density gate', () => {
    const r = runs.midstep;
    assert.equal(r.code, 1);
    assert.equal(r.failures.length, 1, r.failures.join('\n'));
    assert.match(r.failures[0], /^select \(density\) \[d1\.\.31\] \[PRESSURE\]/);
  });

  it('lutedge: a foilLut16 step ONLY at d32 is no tooth -- FOIL and SEP both FAIL', () => {
    const r = runs.lutedge;
    assert.equal(r.code, 1);
    assert.ok(r.failures.some((f) => /^FOIL foilLut16 \[PRESSURE\]/.test(f)), r.failures.join('\n'));
    assert.ok(r.failures.some((f) => /^PRESSURE separation/.test(f)), r.failures.join('\n'));
    assert.equal(r.failures.length, 2, r.failures.join('\n'));
  });

  it('kernedge: a foilKernighan PRESSURE step ONLY at d0 is no tooth -- FAILS', () => {
    const r = runs.kernedge;
    assert.equal(r.code, 1);
    assert.equal(r.failures.length, 1, r.failures.join('\n'));
    assert.match(r.failures[0], /^FOIL foilKernighan \[PRESSURE\]/);
  });

  it('neg32: a d32 cell <= -EPS still FAILS the negative-cell check through run()', () => {
    const r = runs.neg32;
    assert.equal(r.code, 1);
    assert.equal(r.failures.length, 1, r.failures.join('\n'));
    assert.match(r.failures[0], /^select \(density\) \[PRESSURE\] negative cells @d32/);
  });

  it('ctldip: ctlRead PRESSURE density keeps every cell -- a d0/d32 dip FAILS', () => {
    const r = runs.ctldip;
    assert.equal(r.code, 1);
    assert.equal(r.failures.length, 1, r.failures.join('\n'));
    assert.match(r.failures[0], /^ctlRead \(density\) \[control\] \[PRESSURE\]/);
  });

  it('posdip: a PRESSURE position row keeps words 0 / -1 (params 100/101) -- a dip there FAILS', () => {
    const r = runs.posdip;
    assert.equal(r.code, 1);
    assert.equal(r.failures.length, 1, r.failures.join('\n'));
    assert.match(r.failures[0], /^select \(position\) \[PRESSURE\]/);
  });

  it('kwbad: a malformed control row fails closed (spawn), never a silent INFO', () => {
    const r = runs.kwbad;
    assert.equal(r.code, 1);
    assert.equal(r.failures.length, 1, r.failures.join('\n'));
    assert.match(r.failures[0], /fb\/select PRESSURE kwords: malformed or non-finite result/);
  });
});

// ---------------------------------------------------------------------------
let seq = 0;
const fresh = () => import('./witness.mjs?qa-subset=' + (++seq));
const D33 = Array.from({ length: 33 }, (_, i) => i);
const drow = (net, params = D33.slice(0, net.length), extra = {}) => ({
  lane: 'PRESSURE', mode: 'density', params, net, disp: net.map(() => 0.01),
  floor: net.map(() => 1), valid: true, label: 'synthetic', ...extra,
});
const setup = async () => {
  const w = await fresh();
  w.laneNoise('HOT', [{ lane: 'HOT', net: [0, 0.05], disp: [0.01, 0.01], floor: [1, 1], params: [0, 1], valid: true }]);
  w.laneNoise('PRESSURE', [{ lane: 'PRESSURE', net: [0, 0.05], disp: [0.01, 0.01], floor: [1, 1], params: [0, 1], valid: true }]);
  w.fails.length = 0; w.lines.length = 0;
  return w;
};

describe('gateCells / subsetRow / gateSubset -- QA boundary matrix', () => {
  it('params boundary: -0 is d0 (info); 31/32/33, -1, 2^30, 2^31-1, 2^31, 2^32-1, 2^32, 2^53-1, 2^53, Infinity, null, undefined, a hole -> malformed', async () => {
    const w = await fresh();
    const z = w.gateCells('PRESSURE', 'density', [-0, 1, 2, 32]);
    assert.equal(z.ok, true);
    assert.deepEqual(z.info, [0, 3]);
    assert.equal(w.gateCells('PRESSURE', 'density', [1, 31]).ok, true);                // N-1 / N edge: d31 gated
    assert.deepEqual(w.gateCells('PRESSURE', 'density', [1, 31]).gate, [0, 1]);
    for (const bad of [33, -1, 2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 53 - 1, 2 ** 53, Infinity, -Infinity, null, undefined, 16.5, '16']) {
      assert.equal(w.gateCells('PRESSURE', 'density', [1, 2, bad]).ok, false, 'param ' + String(bad));
    }
    // eslint-disable-next-line no-sparse-arrays
    assert.equal(w.gateCells('PRESSURE', 'density', [1, , 3]).ok, false, 'hole');
    for (const p of [null, undefined, 'x', 7, {}]) assert.equal(w.gateCells('PRESSURE', 'density', p).ok, false, String(p));
    // a non-subset row passes params through untouched (HOT keeps its own checks)
    assert.equal(w.gateCells('HOT', 'density', [1, 2, 2 ** 53]).ok, true);
  });

  it('cell count: 0 / 1 gated density fails, 2 distinct passes when flat, all-info rows ([0, 32], [0, 0, 32, 32]) fail', async () => {
    const w = await setup();
    w.gateSubset(drow([], []), 'n0');
    assert.equal(w.fails.length, 1);
    w.gateSubset(drow([1], [5]), 'n1');
    assert.equal(w.fails.length, 2);
    w.gateSubset(drow([1, 1.01], [1, 31]), 'n2');
    assert.equal(w.fails.length, 2, 'two distinct densities, flat, must pass');
    w.gateSubset(drow([1, 1, 1, 1], [0, 0, 32, 32]), 'all-info');
    assert.equal(w.fails.length, 3);
  });

  it('a typed-array net (not a JSON array) on a PRESSURE density row fails closed, not open', async () => {
    const w = await setup();
    w.gateSubset(drow(Float64Array.from(D33.map(() => 1))), 'typed');
    assert.equal(w.fails.length, 1);
    assert.match(w.fails[0], /empty, malformed or misaligned/);
  });

  it('a row with valid !== true (undefined, 1, "true") never passes through the subset', async () => {
    for (const v of [undefined, 1, 'true']) {
      const w = await setup();
      w.gateSubset(drow(D33.map(() => 1), D33, { valid: v }), 'v' + String(v));
      assert.equal(w.fails.length, 1, 'valid=' + String(v));
    }
  });

  it('subsetRow / gateSubset never mutate the caller row (the research table reads all 33 cells after gating)', async () => {
    const w = await setup();
    const net = D33.map((d) => (d === 0 || d === 32 ? 0.7 : 1));
    const r = drow(net.slice());
    const before = JSON.stringify(r);
    const s = w.subsetRow(r);
    assert.equal(s.net.length, 31);
    assert.deepEqual(s.params, D33.slice(1, 32));
    w.gateSubset(r, 'pure');
    assert.equal(JSON.stringify(r), before);
    assert.deepEqual(w.fails, []);
  });

  it('duplicate gate of the same row: two FLAT lines, two INFO lines, no state carried over', async () => {
    const w = await setup();
    const r = drow(D33.map((d) => (d === 0 ? 0.7 : 1)));
    w.gateSubset(r, 'dup');
    w.gateSubset(r, 'dup');
    assert.deepEqual(w.fails, []);
    assert.equal(w.lines.filter((l) => /^ {2}INFO PRESSURE dup/.test(l)).length, 2);
    assert.equal(w.lines.filter((l) => /^ {2}FLAT PRESSURE dup \[d1\.\.31\]/.test(l)).length, 2);
    const bad = drow([1, 1], [0, 32]);
    w.gateSubset(bad, 'dup-bad');
    w.gateSubset(bad, 'dup-bad');
    assert.equal(w.fails.length, 2);
  });

  it('d0 = -0 is not a negative cell; d32 = 1e9 is INFO only (never enters the flatness metric)', async () => {
    const w = await setup();
    w.gateSubset(drow(D33.map((d) => (d === 0 ? -0 : d === 32 ? 1e9 : 1))), 'edges');
    assert.deepEqual(w.fails, []);                                                   // 1e9 at d32 is INFO only
  });

  it('adversarial: duplicated d0 / d32 entries and an unsorted sweep -- the gate picks cells by VALUE, not by index', async () => {
    const w = await setup();
    const params = [32, 5, 0, 17, 0, 31, 32, 1];
    const net = params.map((p) => (p === 0 || p === 32 ? 0.6 : 1));
    w.gateSubset(drow(net, params), 'shuffled');
    assert.deepEqual(w.fails, []);
    // the same row with a step on d17 (index 3) fails: it is gated wherever it sits
    w.gateSubset(drow(params.map((p) => (p === 17 ? 1.5 : 1)), params), 'shuffled-step');
    assert.equal(w.fails.length, 1);
    const c = w.gateCells('PRESSURE', 'density', params);
    assert.deepEqual(c.info, [0, 2, 4, 6]);
    assert.deepEqual(c.gate, [1, 3, 5, 7]);
  });

  it('HOST-bad lane: a malformed subset FAILS (10b, never HOST); only the d0/d32 negative cell is relabelled HOST -- recorded, never dropped', async () => {
    const w = await setup();
    w.HOST_BAD.PRESSURE = true;
    w.gateSubset(drow([1, 1], [0, 32]), 'host-bad-malformed');
    w.gateSubset(drow(D33.map((d) => (d === 32 ? -5 : 1))), 'host-bad-neg');
    assert.equal(w.fails.length, 1);
    assert.match(w.fails[0], /^host-bad-malformed \[PRESSURE\]: density gate subset/);
    assert.equal(w.hostSuppressed.length, 1);
  });

  it('laneNoise: the PRESSURE floor median is taken over d1..d31 as well (a d0 floor outlier does not move it)', async () => {
    const w = await fresh();
    // [0, 1, 2, 32] with d0/d32 floors at 100: an all-cell median would read 100
    const r = drow([1, 1, 1.01, 1], [0, 1, 2, 32], { floor: [100, 1, 1, 100] });
    w.laneNoise('PRESSURE', [r, r, r]);
    const l = w.lines.find((x) => x.startsWith('  NOISE PRESSURE'));
    assert.match(l, /floor 1\.000 ns/);
  });
});

// ---------------------------------------------------------------------------
const one = (spec) => {
  try {
    const out = execFileSync(process.execPath, [RUN_ONE, JSON.stringify(spec)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, res: JSON.parse(out.trim().split('\n').pop()) };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.message) };
  }
};
const KW = { subject: 'fb', op: 'select', lane: 'HOT', mode: 'kwords', corpus: 64, outer: 1, reps: 1, rounds: 1 };

describe('run-one kwords corpus mode -- validation and the DISTINCT rule', () => {
  it('valid K = 1, 2, N-1, N (corpus 64) and the driver shape [1, 2, 2048] at the default corpus give finite aligned rows', () => {
    const a = one({ ...KW, params: [1, 2, 63, 64], density: 16 });
    assert.ok(a.ok, a.err);
    assert.equal(a.res.net.length, 4);
    assert.ok(a.res.net.every(Number.isFinite));
    const b = one({ subject: 'fb', op: 'select', lane: 'PRESSURE', mode: 'kwords', params: [1, 2, 2048], density: 16, outer: 1, reps: 1, rounds: 1 });
    assert.ok(b.ok, b.err);
    assert.deepEqual(b.res.params, [1, 2, 2048]);
    assert.equal(b.res.mode, 'kwords');
    assert.ok(b.res.net.every(Number.isFinite) && b.res.disp.length === 3 && b.res.floor.length === 3);
  });

  it('density omitted defaults to 16; density 1 and 31 are accepted', () => {
    for (const extra of [{}, { density: 1 }, { density: 31 }]) {
      const r = one({ ...KW, params: [1, 2], ...extra });
      assert.ok(r.ok, JSON.stringify(extra) + ' ' + r.err);
    }
  });

  it('K out of range or not an integer throws (0, -1, N+1, 1.5, null, "2", 2^31, 2^32, 2^53)', () => {
    for (const k of [0, -1, 65, 1.5, null, '2', 2 ** 31, 2 ** 32, 2 ** 53]) {
      const r = one({ ...KW, params: [1, k], density: 16 });
      assert.equal(r.ok, false, 'K=' + String(k));
      assert.match(r.err, /kwords needs 1 <= K <= 64 and density 1\.\.31/);
    }
  });

  it('density 0, 32, -0, null, "16", 16.5, 33 throws (one-word densities cannot hold K distinct words)', () => {
    for (const d of [0, 32, -0, null, '16', 16.5, 33]) {
      const r = one({ ...KW, params: [1], density: d });
      assert.equal(r.ok, false, 'd=' + String(d));
      assert.match(r.err, /kwords needs/);
    }
  });

  it('DISTINCT: d1 has exactly 32 words -- K = 32 draws all of them, K = 33 throws (no silent repeat)', () => {
    const ok = one({ ...KW, params: [32], density: 1 });
    assert.ok(ok.ok, ok.err);
    const bad = one({ ...KW, params: [33], density: 1 });
    assert.equal(bad.ok, false);
    assert.match(bad.err, /cannot draw 33 distinct d1 words/);
    const bad31 = one({ ...KW, params: [33], density: 31 });                     // d31: also 32 words
    assert.equal(bad31.ok, false);
  });
});
