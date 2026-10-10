// test/Witness.test.mjs -- the constant-time witness's PURE decision logic,
// fed synthetic series (no timing, no child processes). Regression-tests the
// gate verdicts of test/witness.mjs: slopeVerdict, metrics, negativeCells,
// laneNoise, gateFlat / gateRed / gateSlope and the HOST relabelling invariant.
// The constants below are the FROZEN gate (witness.mjs header); a test here
// that moves means the gate moved.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.WITNESS_CALIBRATE;   // CALIBRATE disables every verdict
delete process.env.WITNESS_FAST;

import { slopeVerdict, metrics, negativeCells } from './witness.mjs';

// The driver keeps lane state (NOISE, EPS, HOST_BAD, fails) at module level.
// A distinct specifier = a distinct module instance = clean state per test.
let seq = 0;
const fresh = () => import('./witness.mjs?case=' + (++seq));

const K_FULL = Array.from({ length: 17 }, (_, i) => i * 2);   // 0, 2, .., 32
const ITERS = [
  'forEach', 'forEachArray', 'forEachObject', 'forEachMapped',
  'forEachMappedObject', 'forEachMaskPair', 'forEachMaskDiff', 'forEachMaskUnion',
];
const N = 0.05;                                  // a typical NOISE HOT (ns)
const series = (f, ks = K_FULL) => ks.map(f);
// deterministic, bounded jitter (|j| <= 0.15 ns at slope 1 ns/bit)
const jit = (k) => 0.15 * Math.sin(k * 1.7);
const failed = (v) => Object.keys(v.checks).filter((k) => !v.checks[k]);

// a row as spawn() returns it
const row = (lane, net, extra = {}) => ({
  lane, net, params: net.map((_, i) => i), disp: net.map(() => 0.01),
  floor: net.map(() => 1), valid: true, label: 'synthetic', ...extra,
});
// rows whose median cell-to-cell spread is exactly `n`, floor `fl`
const noiseRows = (lane, n, fl = 1) => [row(lane, [0, n], { floor: [fl, fl] })];

describe('slopeVerdict -- synthetic series', () => {
  it('a clean linear series (with bounded jitter) passes for every iterator', () => {
    const net = series((k) => 0.5 + 1.0 * k + jit(k));
    for (const name of ITERS) {
      const v = slopeVerdict(name, K_FULL, net, N);
      assert.equal(v.linear, true, name + ' failed: ' + failed(v).join(','));
    }
  });

  it('convex regression 0.3 + 0.9k + 0.05k^2 has curvature 0.64 and is red by curvature for all eight', () => {
    const net = series((k) => 0.3 + 0.9 * k + 0.05 * k * k);
    for (const name of ITERS) {
      const v = slopeVerdict(name, K_FULL, net, N);
      assert.ok(Math.abs(v.s.curv - 0.64) < 1e-9, name + ' curv ' + v.s.curv);
      assert.equal(v.checks.curv, false, name);
      assert.equal(v.linear, false, name);
    }
  });

  it('a step of >= 12 callbacks at k >= 16 is red for every iterator (residual)', () => {
    for (const step of [12, 16, 32, 64]) {
      const net = series((k) => 0.5 + 1.0 * k + (k >= 16 ? step : 0));
      for (const name of ITERS) {
        const v = slopeVerdict(name, K_FULL, net, N);
        assert.equal(v.linear, false, `${name} +${step} callbacks passed as linear`);
        assert.equal(v.checks.resid, false, `${name} +${step}: resid check did not fire (${failed(v)})`);
      }
    }
  });

  it('an O(k^2) series is red (curvature)', () => {
    const net = series((k) => 0.2 + 0.25 * k * k);
    for (const name of ITERS) {
      const v = slopeVerdict(name, K_FULL, net, N);
      assert.equal(v.linear, false, name);
      assert.equal(v.checks.curv, false, name);
      assert.ok(v.s.curv > 0.9, name + ' curv ' + v.s.curv);
    }
  });

  it('a fixed 32-step scan (large intercept) is red (intercept)', () => {
    const net = series((k) => 32 * 0.3 + 0.3 * k + jit(k) * 0.3);
    for (const name of ITERS) {
      const v = slopeVerdict(name, K_FULL, net, N);
      assert.equal(v.linear, false, name);
      assert.equal(v.checks.icpt, false, name);
      assert.ok(v.s.intercept / v.s.slope > 6, name);
    }
  });

  it('the intercept bound is two-sided: a large NEGATIVE intercept is red', () => {
    const net = series((k) => -10 + 1.0 * k);
    const v = slopeVerdict('forEach', K_FULL, net, N);
    assert.equal(v.checks.icpt, false);
    assert.equal(v.linear, false);
  });

  it('a series with one NaN cell is red for every iterator that judges that cell', () => {
    for (const at of [0, 8, 16]) {           // k = 0, 16, 32: phase-0 cells, judged by all eight
      const net = series((k) => 0.5 + k);
      net[at] = NaN;
      for (const name of ITERS) {
        assert.equal(slopeVerdict(name, K_FULL, net, N).linear, false, `${name} NaN@k=${K_FULL[at]}`);
      }
    }
  });

  it('forEachArray: its allowed concavity passes; the concave floor -0.75 is enforced', () => {
    // y = b k + c k^2 with rise R = 32 ns and curvature `cv` exactly.
    const concave = (cv) => series((k) => {
      const c = (cv * 32) / 1024, b = ((1 - cv) * 32) / 32;
      return 0.2 + b * k + c * k * k;
    });
    for (const cv of [-0.22, -0.52, -0.70, -0.74]) {
      const v = slopeVerdict('forEachArray', K_FULL, concave(cv), N);
      assert.ok(Math.abs(v.s.curv - cv) < 1e-6);
      assert.equal(v.linear, true, `forEachArray curv ${cv}: ${failed(v)}`);
    }
    for (const cv of [-0.76, -0.80, -1.2]) {
      const v = slopeVerdict('forEachArray', K_FULL, concave(cv), N);
      assert.equal(v.checks.curv, false, `forEachArray curv ${cv} passed the -0.75 floor`);
      assert.equal(v.linear, false);
    }
    // the -0.75 floor is forEachArray's alone: the plain iterators stop at -0.60
    const v70 = slopeVerdict('forEach', K_FULL, concave(-0.70), N);
    assert.equal(v70.checks.curv, false, 'forEach accepted curvature -0.70');
    assert.equal(slopeVerdict('forEach', K_FULL, concave(-0.59), N).checks.curv, true);
    // convex side is still 0.60 for forEachArray
    assert.equal(slopeVerdict('forEachArray', K_FULL, concave(0.62), N).checks.curv, false);
  });

  it('forEachArray takes its residual against the QUADRATIC fit, the others against the line', () => {
    const net = series((k) => 0.2 + 1.7 * k - 0.021875 * k * k);   // curv -0.70
    const a = slopeVerdict('forEachArray', K_FULL, net, N);
    const f = slopeVerdict('forEach', K_FULL, net, N);
    assert.ok(a.s.maxResid < 1e-9, 'quad residual of an exact quadratic is 0');
    assert.ok(f.s.maxResid > 3, 'linear residual of the same series is large');
  });

  it('forEachMapped is judged on its k = 0 mod 4 phase only', () => {
    // phase-2 cells wild (bimodal +20 ns / NaN): forEachMapped passes, forEach is red
    const wild = series((k) => (k % 4 === 2 ? 0.5 + k + 20 : 0.5 + k));
    const nanPhase2 = series((k) => (k % 4 === 2 ? NaN : 0.5 + k + jit(k)));
    for (const net of [wild, nanPhase2]) {
      const m = slopeVerdict('forEachMapped', K_FULL, net, N);
      assert.equal(m.linear, true, 'forEachMapped: ' + failed(m));
      assert.equal(m.s.K, 32);
      assert.equal(slopeVerdict('forEach', K_FULL, net, N).linear, false);
    }
    // a step on the phase-0 cells is still caught
    const stepped = series((k) => 0.5 + k + (k >= 16 && k % 4 === 0 ? 16 : 0));
    assert.equal(slopeVerdict('forEachMapped', K_FULL, stepped, N).linear, false);
  });

  it('rise floor: slope x kmax must reach 20 N', () => {
    const net = (slope) => series((k) => 0.1 + slope * k);
    // 20 N = 1.0 ns at N = 0.05 -> slope 1/32 at K = 32
    assert.equal(slopeVerdict('forEach', K_FULL, net(0.032), N).checks.rise, true);
    assert.equal(slopeVerdict('forEach', K_FULL, net(0.030), N).checks.rise, false);
  });

  it('R^2 floor 0.90 binds on a noisy-but-linear series', () => {
    // alternating +/- 3.3 ns zigzag on slope 1: residual 3.49 < 3.5, R^2 0.898
    const net = series((k, i) => 0.5 + k + (i % 2 ? 3.3 : -3.3));
    const v = slopeVerdict('forEach', K_FULL, net, N);
    assert.ok(v.s.r2 < 0.90, 'r2 ' + v.s.r2);
    assert.equal(v.checks.r2, false);
    assert.deepEqual(failed(v), ['r2'], 'only R^2 should bind here');
    assert.equal(v.linear, false);
  });

  it('boundaries fail closed: empty, one point, flat, descending, NaN/0/-0 noise, Infinity cell', () => {
    const lin = series((k) => 0.5 + k);
    assert.equal(slopeVerdict('forEach', [], [], N).linear, false, 'empty');
    assert.equal(slopeVerdict('forEach', [16], [16.5], N).linear, false, 'one point');
    assert.equal(slopeVerdict('forEach', K_FULL, series(() => 3), N).linear, false, 'flat (O(1) is not O(k))');
    assert.equal(slopeVerdict('forEach', K_FULL, series((k) => 40 - k), N).linear, false, 'descending');
    assert.equal(slopeVerdict('forEach', K_FULL, lin, NaN).linear, false, 'NaN NOISE');
    assert.equal(slopeVerdict('forEach', K_FULL, lin, undefined).linear, false, 'undefined NOISE');
    const inf = lin.slice(); inf[5] = Infinity;
    assert.equal(slopeVerdict('forEach', K_FULL, inf, N).linear, false, 'Infinity cell');
    // NOISE 0 / -0 make the rise check vacuous: laneNoise must never let that through
    assert.equal(slopeVerdict('forEach', K_FULL, lin, 0).checks.rise, true);
    assert.equal(slopeVerdict('forEach', K_FULL, lin, -0).checks.rise, true);
  });

  it('unknown op names get the common gate (no accidental pinned shape)', () => {
    const net = series((k) => 0.2 + 1.7 * k - 0.021875 * k * k);   // curv -0.70
    assert.equal(slopeVerdict('foilIterQuad', K_FULL, net, N).checks.curv, false);
    assert.equal(slopeVerdict('__proto__', K_FULL, net, N).checks.curv, false);
  });
});

describe('metrics -- ratio (EPS-clamped) and spread (unclamped)', () => {
  it('ratio = max/min with cells clamped up to EPS; spread is raw max - min', () => {
    const m = metrics([1, 2, 3], 0.5);
    assert.equal(m.ratio, 3); assert.equal(m.spread, 2); assert.equal(m.min, 1); assert.equal(m.max, 3);
    const c = metrics([0.1, 0.2, -0.3], 1);       // all clamp to EPS
    assert.equal(c.ratio, 1);
    assert.ok(Math.abs(c.spread - 0.5) < 1e-12);
    assert.equal(metrics([0.05, 1], 0.2).ratio, 5);  // min clamped 0.05 -> 0.2
  });

  it('single cell, -0, large magnitudes (2^31, 2^32, 2^53)', () => {
    assert.deepEqual(metrics([7], 1), { ratio: 1, spread: 0, min: 7, max: 7 });
    assert.equal(metrics([-0, 0], 1).spread, 0);
    assert.equal(metrics([2 ** 31 - 1, 2 ** 31], 1).spread, 1);
    assert.equal(metrics([2 ** 32 - 1, 2 ** 32], 1).spread, 1);
    assert.equal(metrics([2 ** 53 - 1, 2 ** 53], 1).spread, 1);
  });

  it('NaN cells are invisible to metrics (the NaN guard is negativeCells + spawn validity)', () => {
    assert.equal(metrics([1, NaN, 2], 0.1).spread, 1);
    assert.deepEqual(negativeCells([1, NaN, 2], 0.1), [1]);
  });
});

describe('negativeCells -- broken floor subtraction', () => {
  it('flags cells at or below -EPS, NaN, and -Infinity; keeps -0 and cells just above -EPS', () => {
    assert.deepEqual(negativeCells([0, -0, 0.5, -0.19], 0.2), []);
    assert.deepEqual(negativeCells([-0.2, -0.21, NaN, -Infinity, undefined, 1], 0.2), [0, 1, 2, 3, 4]);
    assert.deepEqual(negativeCells([], 0.2), []);
  });

  it('EPS NaN (NOISE never established) flags every cell', () => {
    assert.deepEqual(negativeCells([1, 2], NaN), [0, 1]);
  });

  it('EPS 0 / -0: a -0 cell is flagged (fail closed at zero tolerance)', () => {
    assert.deepEqual(negativeCells([-0, 0, 1e-12], 0), [0, 1]);
    assert.deepEqual(negativeCells([-0], -0), [0]);
  });
});

describe('laneNoise -- the NOISE precondition', () => {
  it('a quiet lane: NOISE = median row spread, EPS = EPS_K x NOISE, no failure', async () => {
    const w = await fresh();
    w.laneNoise('HOT', noiseRows('HOT', 0.05, 0.3));
    assert.equal(w.NOISE.HOT, 0.05);
    assert.ok(Math.abs(w.EPS.HOT - 0.2) < 1e-12);       // EPS_K HOT 4
    assert.equal(w.HOST_BAD.HOT, false);
    assert.deepEqual(w.fails, []);
    w.laneNoise('PRESSURE', noiseRows('PRESSURE', 0.05, 1));
    assert.ok(Math.abs(w.EPS.PRESSURE - 0.35) < 1e-12); // EPS_K PRESSURE 7
  });

  it('NOISE_FLOOR_MAX boundaries: HOT 0.27, PRESSURE 0.08 (equal passes, above fails)', async () => {
    for (const [lane, max] of [['HOT', 0.27], ['PRESSURE', 0.08]]) {
      const ok = await fresh();
      ok.laneNoise(lane, noiseRows(lane, max, 1));
      assert.equal(ok.HOST_BAD[lane], false, lane + ' at the cap');
      const bad = await fresh();
      bad.laneNoise(lane, noiseRows(lane, max * 1.001, 1));
      assert.equal(bad.HOST_BAD[lane], true, lane + ' above the cap');
      assert.equal(bad.fails.length, 1);
      assert.match(bad.fails[0], new RegExp('^NOISE ' + lane));
    }
  });

  it('fails closed on zero noise, no rows, only invalid rows, NaN floor', async () => {
    const cases = [
      [row('HOT', [1, 1, 1])],                              // NOISE 0
      [row('HOT', [-0, 0])],                                // NOISE -0 vs 0
      [],                                                   // no rows
      [row('HOT', [0, 0.05], { valid: false })],           // only invalid rows
      [row('HOT', [0, 0.05], { floor: [NaN, NaN] })],      // floor NaN
    ];
    for (const rs of cases) {
      const w = await fresh();
      w.laneNoise('HOT', rs);
      assert.equal(w.HOST_BAD.HOT, true, JSON.stringify(rs));
      assert.equal(w.fails.length, 1);
    }
  });

  it('median takes the upper middle of an even row count; invalid rows do not vote', async () => {
    const w = await fresh();
    w.laneNoise('HOT', [row('HOT', [0, 0.01]), row('HOT', [0, 0.03]), row('HOT', [0, 9], { valid: false })]);
    assert.equal(w.NOISE.HOT, 0.03);
  });
});

describe('gateFlat / gateRed -- the frozen flatness verdicts', () => {
  const setup = async () => {
    const w = await fresh();
    w.laneNoise('HOT', noiseRows('HOT', 0.05, 1));          // N 0.05, EPS 0.2
    w.laneNoise('PRESSURE', noiseRows('PRESSURE', 0.05, 1)); // N 0.05, EPS 0.35
    w.fails.length = 0; w.lines.length = 0;
    return w;
  };

  it('HOT spread bound 6 N: 5.8 N passes, 6.2 N fails', async () => {
    const w = await setup();
    w.gateFlat(row('HOT', [1.0, 1.29]), 'okop');
    assert.deepEqual(w.fails, []);
    w.gateFlat(row('HOT', [1.0, 1.31]), 'badop');
    assert.equal(w.fails.length, 1);
    assert.match(w.fails[0], /^badop \[HOT\]/);
  });

  it('PRESSURE spread bound 4.5 N and NO ratio gate', async () => {
    const w = await setup();
    w.gateFlat(row('PRESSURE', [0.4, 0.62]), 'p-ok');   // 4.4 N
    assert.deepEqual(w.fails, []);
    w.gateFlat(row('PRESSURE', [0.4, 0.63]), 'p-bad');  // 4.6 N
    assert.equal(w.fails.length, 1);
  });

  it('the negative-cell check alone fails a row that is otherwise flat', async () => {
    const w = await setup();
    w.gateFlat(row('HOT', [0, 0.05, -0.19]), 'near-zero ok');  // spread 4.8 N, no neg
    assert.deepEqual(w.fails, []);
    w.gateFlat(row('HOT', [0, 0.05, -0.21]), 'neg');           // spread 5.2 N, neg @2
    assert.equal(w.fails.length, 1);
    assert.match(w.fails[0], /negative cells @2/);
  });

  it('an invalid row (spawn found a non-finite cell) never passes flat', async () => {
    const w = await setup();
    w.gateFlat(row('HOT', [1, 1], { valid: false }), 'invalid');
    assert.equal(w.fails.length, 1);
  });

  it('HOT ratio > 2.5 always implies spread > 6 N (the HOT ratio gate never binds alone)', async () => {
    // documents the redundancy: EPS 4 N, ratio 2.5 -> max >= 10 N, spread >= 6 N
    const w = await setup();
    for (let i = 0; i < 2000; i++) {
      const a = (i * 0.0137) % 1.2 - 0.19, b = (i * 0.0911) % 1.6;
      const m = w.metrics([a, b], w.EPS.HOT);
      if (m.ratio > 2.5) assert.ok(m.spread > 6 * w.NOISE.HOT, `ratio ${m.ratio} spread ${m.spread}`);
    }
  });

  it('gateRed: spread above 7 N HOT / 5.5 N PRESSURE is red; below it the foil FAILS the run', async () => {
    const w = await setup();
    w.gateRed(row('HOT', [0.3, 0.66]), 'foil-7.2N', () => 'hot foil flat');
    w.gateRed(row('PRESSURE', [0.3, 0.58]), 'foil-5.6N', () => 'pressure foil flat');
    assert.deepEqual(w.fails, []);
    w.gateRed(row('HOT', [0.3, 0.64]), 'foil-6.8N', () => 'hot foil flat');
    w.gateRed(row('PRESSURE', [0.3, 0.57]), 'foil-5.4N', () => 'pressure foil flat');
    assert.deepEqual(w.fails, ['hot foil flat', 'pressure foil flat']);
  });

  it('gateRed: an invalid foil row is never counted as red', async () => {
    const w = await setup();
    w.gateRed(row('HOT', [0, 100], { valid: false }), 'invalid-foil', () => 'invalid foil');
    assert.deepEqual(w.fails, ['invalid foil']);
  });

  it('gateRed: an empty row is not red', async () => {
    const w = await setup();
    w.gateRed(row('HOT', []), 'empty-foil', () => 'empty foil');
    assert.deepEqual(w.fails, ['empty foil']);
  });

  it('gateFlat: an empty row should not pass flat (unreachable from run(): sweeps are constant and non-empty)',
    { todo: 'finding: metrics([]) gives ratio NaN / spread -Infinity, both read as within bounds' }, async () => {
      const w = await setup();
      w.gateFlat(row('HOT', []), 'empty');
      assert.equal(w.fails.length, 1);
    });
});

describe('HOST relabelling invariant', () => {
  const hostRun = async () => {
    const w = await fresh();
    // HOT: noise/floor 0.10 / 0.30 = 0.33 > 0.27 -> NOISE FAIL, lane relabelled
    w.laneNoise('HOT', noiseRows('HOT', 0.10, 0.30));
    // PRESSURE: quiet
    w.laneNoise('PRESSURE', noiseRows('PRESSURE', 0.02, 1));
    return w;
  };

  it('a failed NOISE check fails the run: fails is non-empty (exit status 1)', async () => {
    const w = await hostRun();
    assert.equal(w.HOST_BAD.HOT, true);
    assert.equal(w.HOST_BAD.PRESSURE, false);
    assert.equal(w.fails.length, 1);
    assert.match(w.fails[0], /^NOISE HOT: .*host too noisy/);
  });

  it('relabelled gate lines go to hostSuppressed and NEVER under FAILURES', async () => {
    const w = await hostRun();
    w.gateFlat(row('HOT', [0, 5]), 'flatop-regressed');
    w.gateRed(row('HOT', [1, 1]), 'foil-came-flat', () => 'FOIL foil-came-flat no teeth');
    w.gateSlope(row('HOT', series((k) => 0.5 + k), { params: K_FULL }), 'foilIterQuad', true);
    w.gateSlope(row('HOT', series(() => 3), { params: K_FULL }), 'forEach', false);
    w.fail('HOT', 'broken-floor control [HOT]: did not fire');
    assert.equal(w.hostSuppressed.length, 5);
    assert.ok(w.hostSuppressed.every((h) => h.startsWith('HOT: ')));
    assert.equal(w.fails.length, 1, 'only the NOISE line is a finding: ' + w.fails.join(' | '));
    for (const h of w.hostSuppressed) {
      const msg = h.slice('HOT: '.length);
      assert.ok(!w.fails.includes(msg), 'relabelled line leaked into FAILURES: ' + msg);
    }
    assert.ok(w.fails.every((f) => !/no teeth|flatop|foil|broken-floor|SLOPE/.test(f)));
    // the printed gate lines carry the HOST tag, not a FAIL verdict
    const gateLines = w.lines.filter((l) => /^ {2}(FLAT|RED|SLOPE) /.test(l));
    assert.equal(gateLines.length, 4);
    for (const l of gateLines) assert.match(l, /HOST\(no verdict: lane NOISE failed\)$/);
  });

  it('the healthy lane keeps its verdicts while the other lane is HOST', async () => {
    const w = await hostRun();
    w.gateFlat(row('PRESSURE', [0, 5]), 'pressure-regressed');
    assert.equal(w.fails.length, 2);
    assert.match(w.fails[1], /^pressure-regressed \[PRESSURE\]/);
    assert.equal(w.hostSuppressed.length, 0);
  });

  it('a passing gate in a HOST lane still prints ok (relabelling only touches failures)', async () => {
    const w = await hostRun();
    w.gateFlat(row('HOT', [1, 1.01]), 'flat');
    assert.equal(w.hostSuppressed.length, 0);
    assert.match(w.lines[w.lines.length - 1], / ok$/);
  });

  it('re-entrant laneNoise: HOST_BAD is sticky -- a later quiet NOISE does not clear it', async () => {
    const w = await hostRun();
    w.laneNoise('HOT', noiseRows('HOT', 0.05, 1));
    assert.equal(w.HOST_BAD.HOT, true);
    assert.equal(w.fails.length, 1);
  });

  it('with a quiet lane nothing is relabelled: gate failures are findings', async () => {
    const w = await fresh();
    w.laneNoise('HOT', noiseRows('HOT', 0.05, 0.3));
    w.gateFlat(row('HOT', [0, 5]), 'regressed');
    w.gateSlope(row('HOT', series((k) => 0.5 + k), { params: K_FULL }), 'foilIterQuad', true);
    assert.equal(w.hostSuppressed.length, 0);
    assert.equal(w.fails.length, 2);
    assert.match(w.fails[1], /SLOPE foil foilIterQuad passed as linear/);
  });
});
