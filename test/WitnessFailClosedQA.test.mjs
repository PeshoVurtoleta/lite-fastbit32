// QA (witness fix, 2026-10-11): gateFlat fail-closed boundary matrix.
// Written from the QA brief, independent of the coder's Witness.test.mjs.
// Pins each clause of `finite` in test/witness.mjs gateFlat that the shipped
// tests leave unpinned (Number.isFinite(N), Number.isFinite(m.ratio)), plus the
// 0 / 1 / 2-cell boundary, NaN / -0 / +-Infinity cells, null / undefined rows
// and a duplicate gate call.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.WITNESS_CALIBRATE;   // CALIBRATE disables every verdict
delete process.env.WITNESS_FAST;

let seq = 0;
const fresh = () => import('./witness.mjs?qa-failclosed=' + (++seq));

const row = (lane, net, extra = {}) => ({
  lane, net, params: net.map((_, i) => i), disp: net.map(() => 0.01),
  floor: net.map(() => 1), valid: true, label: 'synthetic', ...extra,
});
// NOISE HOT = PRESSURE = 0.05 ns (EPS 0.2 / 0.35), fails cleared
const setup = async () => {
  const w = await fresh();
  w.laneNoise('HOT', [row('HOT', [0, 0.05])]);
  w.laneNoise('PRESSURE', [row('PRESSURE', [0, 0.05])]);
  w.fails.length = 0; w.lines.length = 0;
  return w;
};
const recorded = (w) => w.fails.length + w.hostSuppressed.length;

describe('gateFlat fail-closed -- QA boundary matrix', () => {
  it('cell count 0 / 1 fail, 2 (the first judged size) passes when flat -- HOT and PRESSURE', async () => {
    for (const lane of ['HOT', 'PRESSURE']) {
      const w = await setup();
      w.gateFlat(row(lane, []), 'n0');
      assert.equal(w.fails.length, 1, lane + ' 0 cells');
      w.gateFlat(row(lane, [1]), 'n1');
      assert.equal(w.fails.length, 2, lane + ' 1 cell');
      w.gateFlat(row(lane, [1, 1.01]), 'n2');
      assert.equal(w.fails.length, 2, lane + ' 2 flat cells must pass');
      w.gateFlat(row(lane, [1, 1.01, 1.0]), 'n3');
      assert.equal(w.fails.length, 2, lane + ' 3 flat cells must pass');
    }
  });

  it('a one-cell row fails for every cell value (0, -0, NaN, 2^31, 2^53)', async () => {
    const w = await setup();
    const vals = [0, -0, NaN, 2 ** 31, 2 ** 53];
    for (const v of vals) w.gateFlat(row('HOT', [v]), 'one ' + v);
    assert.equal(w.fails.length, vals.length);
  });

  it('-0 is not a negative cell: [-0, 0] and [0, -0] pass flat', async () => {
    const w = await setup();
    w.gateFlat(row('HOT', [-0, 0]), 'mz1');
    w.gateFlat(row('HOT', [0, -0]), 'mz2');
    assert.deepEqual(w.fails, []);
  });

  it('non-finite cells never pass: [NaN, NaN], [NaN, 1], [-Inf, -Inf], [Inf, Inf], [1, Inf]', async () => {
    const w = await setup();
    const rows = [[NaN, NaN], [NaN, 1], [-Infinity, -Infinity], [Infinity, Infinity], [1, Infinity]];
    for (const r of rows) w.gateFlat(row('HOT', r), 'nf ' + r.join(','));
    assert.equal(w.fails.length, rows.length);
  });

  it('null / undefined net never passes silently (throws)', async () => {
    const w = await setup();
    assert.throws(() => w.gateFlat({ lane: 'HOT', net: null, valid: true, label: 'x' }, 'null'));
    assert.throws(() => w.gateFlat({ lane: 'HOT', net: undefined, valid: true, label: 'x' }, 'undef'));
  });

  it('duplicate gate of the same empty row records two fails (no de-dup hides a repeat)', async () => {
    const w = await setup();
    const r = row('HOT', []);
    w.gateFlat(r, 'dup');
    w.gateFlat(r, 'dup');
    assert.equal(w.fails.length, 2);
  });

  it('NOISE +Infinity via laneNoise (an infinite row) -> a flat row is NOT passed (recorded, host-relabelled)', async () => {
    const w = await fresh();
    w.laneNoise('HOT', [row('HOT', [0, Infinity])]);
    assert.equal(w.NOISE.HOT, Infinity);
    w.fails.length = 0; w.hostSuppressed.length = 0;
    const m = w.gateFlat(row('HOT', [1, 1.01]), 'inf-noise');
    assert.equal(recorded(w), 1);
    assert.ok(m);
  });

  it('adversarial state: NOISE +Infinity with a finite EPS -> fails (only Number.isFinite(N) catches it)', async () => {
    const w = await setup();
    w.NOISE.HOT = Infinity;            // EPS stays 0.2: ratio / spread / negative cells all read in-bounds
    w.gateFlat(row('HOT', [1, 1.01]), 'noise-inf');
    assert.equal(w.fails.length, 1);
  });

  it('adversarial state: EPS +Infinity with a finite NOISE -> fails (only Number.isFinite(m.ratio) catches it)', async () => {
    const w = await setup();
    w.EPS.HOT = Infinity;              // clamped ratio = Inf / Inf = NaN, no cell is "negative"
    w.gateFlat(row('HOT', [1, 1.01]), 'eps-inf');
    assert.equal(w.fails.length, 1);
  });

  it('huge but finite flat cells (2^31, 2^32 - 1, 2^53 - 1) are judged, not rejected', async () => {
    const w = await setup();
    w.gateFlat(row('HOT', [2 ** 31, 2 ** 31]), 'big31');
    w.gateFlat(row('HOT', [2 ** 32 - 1, 2 ** 32 - 1]), 'big32');
    w.gateFlat(row('HOT', [2 ** 53 - 1, 2 ** 53 - 1]), 'big53');
    assert.deepEqual(w.fails, []);
    w.gateFlat(row('HOT', [2 ** 53, 2 ** 53 + 2]), 'big53-spread');   // spread 2 ns = 40 N
    assert.equal(w.fails.length, 1);
  });
});
