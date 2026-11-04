// qa (C-24, 2026-11-04): C-11 HOT slot warm-up boundaries that WitnessWarmup.test.mjs does not pin.
// Written from the C-11 rule only:
//   warm = lane === 'HOT' && P > 0 ? Math.ceil(WARM_CELLS / P) : 0, WARM_CELLS 12,
//   scope: every HOT slot process, foilWordScan included (SLOT_FAST, SLOT_SLOW, SLOT_FULL).
// Expected performance.now() count per run-one spawn = (warm + rounds) x P x reps x 3
// (same counting preload and formula as WitnessWarmup.test.mjs; no timing is asserted).
//
// Gaps closed here (each fails on a named mutant of test/witness/run-one.mjs):
//   G1 P around WARM_CELLS (11 = N-1, 12 = N, 13 = N+1) and a non-divisor P 5. WitnessWarmup
//      uses P 0, 1, 6, 32 only; for those `Math.max(1, (WARM_CELLS / P) | 0)` equals ceil, so a
//      floor-with-minimum-1 mutant passes it. P 5 (ceil 3, floor 2) and P 11 (2 vs 1) catch it.
//   G2 foilWordScan (the slot teeth) gets the same warm-up as the fb1024 ops, under the lane
//      config and a SLOT_SLOW config. WitnessWarmup uses op nextClearBit only; a mutant that
//      skips the warm-up for the foil (`&& op !== 'foilWordScan'`) passes it.
// Override the run-one path with env QA_RUN_ONE (absolute) to run against a scratch mutant.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COUNT_NOW = join(ROOT, 'test', 'fixtures', 'count-now.mjs');
const RUN_ONE = process.env.QA_RUN_ONE || join(ROOT, 'test', 'witness', 'run-one.mjs');

const range = (n) => Array.from({ length: n }, (_, i) => i);
const SLOT6 = [0, 1, 15, 16, 30, 31];

function slot(op, lane, params, extra) {
  return { subject: 'fb1024', op, lane, mode: 'slot', params, outer: 8, reps: 2, rounds: 3, ...extra };
}

// pin = literal expected count, computed by hand from the C-11 rule:
//   P 5: ceil(12/5) = 3 -> (3+3) x 5 x 2 x 3 = 180
//   P 11: ceil(12/11) = 2 -> (2+3) x 11 x 6 = 330
//   P 12: 1 -> 4 x 12 x 6 = 288
//   P 13: ceil(12/13) = 1 -> 4 x 13 x 6 = 312
//   foil lane, P 6: 2 -> 5 x 6 x 6 = 180
//   foil SLOT_SLOW acquire (outer/4, reps 8, rounds 5), P 6: 2 -> 7 x 6 x 8 x 3 = 1008
//   foil PRESSURE, P 6: 0 -> 3 x 6 x 6 = 108 (out of scope: no warm-up)
const CASES = [
  { name: 'G1 slot HOT, P 5 (non-divisor of 12)', pin: 180, spec: slot('nextClearBit', 'HOT', range(5)) },
  { name: 'G1 slot HOT, P 11 (WARM_CELLS - 1)', pin: 330, spec: slot('acquire', 'HOT', range(11)) },
  { name: 'G1 slot HOT, P 12 (WARM_CELLS)', pin: 288, spec: slot('has', 'HOT', range(12)) },
  { name: 'G1 slot HOT, P 13 (WARM_CELLS + 1)', pin: 312, spec: slot('lowest', 'HOT', range(13)) },
  { name: 'G2 foilWordScan HOT lane config, P 6', pin: 180, spec: slot('foilWordScan', 'HOT', SLOT6) },
  { name: 'G2 foilWordScan HOT SLOT_SLOW acquire-est, P 6', pin: 1008,
    spec: slot('foilWordScan', 'HOT', SLOT6, { outer: 2, reps: 8, rounds: 5 }) },
  { name: 'G2 foilWordScan PRESSURE, P 6 (no warm-up)', pin: 108, spec: slot('foilWordScan', 'PRESSURE', SLOT6) },
];

function expected(s) {
  const P = s.params.length;
  const warm = (s.mode === 'slot' && s.lane === 'HOT' && P > 0) ? Math.ceil(12 / P) : 0;
  return (warm + s.rounds) * P * s.reps * 3;
}

describe('C-11 qa: HOT slot warm-up count at the WARM_CELLS boundary and on foilWordScan', () => {
  it('formula reproduces every literal pin (typo guard)', () => {
    for (const c of CASES) assert.equal(expected(c.spec), c.pin, c.name);
  });
  for (const c of CASES) {
    it(c.name, () => {
      const env = { ...process.env };
      delete env.NODE_OPTIONS;
      delete env.NODE_V8_COVERAGE;
      const r = spawnSync(process.execPath, ['--import', COUNT_NOW, RUN_ONE, JSON.stringify(c.spec)],
        { cwd: ROOT, encoding: 'utf8', timeout: 60000, env });
      assert.equal(r.signal, null, 'child not killed (timeout/hang)');
      assert.equal(r.status, 0, 'child exit code (stderr: ' + r.stderr + ')');
      const m = /^COUNT_NOW performance\.now (\d+)$/m.exec(r.stderr);
      assert.ok(m, 'COUNT_NOW line present in stderr');
      assert.equal(Number(m[1]), c.pin, c.name + ': performance.now call count');
      const res = JSON.parse(r.stdout.trim().split('\n').pop());
      assert.equal(res.op, c.spec.op);
      assert.ok(Array.isArray(res.rounds) && res.rounds.length === c.spec.rounds, 'res.rounds length = rounds');
      for (const row of res.rounds) assert.equal(row.length, c.spec.params.length, 'round length = P');
    });
  }
});
