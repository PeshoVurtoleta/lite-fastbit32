// Unit B1t (witness warm-up, 2026-10-23): assertion A1 (delta5, addendum 31-5).
// Written from the assertion only, independent of the coder's run-one.mjs edit.
//
// Each count case spawns test/witness/run-one.mjs with test/fixtures/count-now.mjs preloaded
// (it counts performance.now() calls and prints `COUNT_NOW performance.now <n>` to stderr
// at exit). Expected count = (warm + rounds) x P x reps x 3, with
//   warm = ceil(12 / P) for mode "slot" on lane HOT, else 0; reps = 2.
// The formula is computed here and pinned against a literal 8-number table.
// Also asserted: child exit 0, and res.rounds is exactly `rounds` arrays of length P.
// Override the run-one path with env WARMUP_RUN_ONE (absolute) to test a frozen copy;
// against the frozen 435e748 build exactly cases 1-4 (108, 180, 576, 18) and the stepped-clock case must fail.
// Last case (stepped fake clock, test/fixtures/step-now.mjs): the warm-up passes feed NONE of
// the recorded raw / floor values (every recorded now() call steps 1000 ms, warm-up ones 1 ms).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COUNT_NOW = join(ROOT, 'test', 'fixtures', 'count-now.mjs');
const STEP_NOW = join(ROOT, 'test', 'fixtures', 'step-now.mjs');
const RUN_ONE = process.env.WARMUP_RUN_ONE || join(ROOT, 'test', 'witness', 'run-one.mjs');

const P32 = [];
for (let i = 0; i < 32; i++) P32.push(i);
const SLOT6 = [0, 1, 15, 16, 30, 31];

function slot(lane, params, rounds) {
  return { subject: 'fb1024', op: 'nextClearBit', lane, mode: 'slot', params, outer: 8, reps: 2, rounds };
}

const CASES = [
  { name: 'slot HOT, P 6, rounds 3', pin: 180, spec: slot('HOT', SLOT6, 3) },
  { name: 'slot HOT, P 6, rounds 5', pin: 252, spec: slot('HOT', SLOT6, 5) },
  { name: 'slot HOT, P 32, rounds 3', pin: 768, spec: slot('HOT', P32, 3) },
  { name: 'slot HOT, P 1', pin: 90, spec: slot('HOT', [0], 3) },
  // P 0: must not hang (frozen passes; a warm-up loop of ceil(12/0) cells would spin). 0 x anything = 0.
  { name: 'slot HOT, P 0', pin: 0, spec: slot('HOT', [], 3) },
  { name: 'slot PRESSURE, P 6', pin: 108, spec: slot('PRESSURE', SLOT6, 3) },
  { name: 'scalar HOT, P 8', pin: 144, spec: { subject: 'fb', op: 'count', lane: 'HOT', mode: 'density',
    params: [0, 4, 8, 12, 16, 20, 24, 32], outer: 8, reps: 2, rounds: 3 } },
  { name: 'slope HOT, P 4', pin: 72, spec: { subject: 'fb', op: 'forEach', lane: 'HOT', mode: 'slope',
    params: [1, 8, 16, 32], ops: 1000, reps: 2, rounds: 3 } },
];

function expected(s) {
  const P = s.params.length;
  const warm = (s.mode === 'slot' && s.lane === 'HOT' && P > 0) ? Math.ceil(12 / P) : 0;
  return (warm + s.rounds) * P * s.reps * 3;
}

describe('witness warm-up: performance.now() call count per run-one spawn', () => {
  CASES.forEach((c, idx) => {
    it(c.name, () => {
      // formula typo guard: the formula must reproduce the literal table
      for (const k of CASES) assert.equal(expected(k.spec), k.pin, 'formula vs pin: ' + k.name);
      const want = expected(c.spec);
      assert.equal(want, c.pin);

      const r = spawnSync(process.execPath, ['--import', COUNT_NOW, RUN_ONE, JSON.stringify(c.spec)],
        { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
      assert.equal(r.signal, null, 'child not killed (timeout/hang)');
      assert.equal(r.status, 0, 'child exit code (stderr: ' + r.stderr + ')');
      const m = /^COUNT_NOW performance\.now (\d+)$/m.exec(r.stderr);
      assert.ok(m, 'COUNT_NOW line present in stderr');
      assert.equal(Number(m[1]), want, c.name + ': performance.now call count');

      const res = JSON.parse(r.stdout.trim().split('\n').pop());
      assert.ok(Array.isArray(res.rounds), 'res.rounds is an array');
      assert.equal(res.rounds.length, c.spec.rounds, 'res.rounds length');
      for (const row of res.rounds) {
        assert.ok(Array.isArray(row), 'round is an array');
        assert.equal(row.length, c.spec.params.length, 'round length = P');
      }
    });
  });
});

// Stepped clock: slot HOT, P 6, rounds 3 -> warm = ceil(12/6) = 2 passes. The warm-up makes
// 2 passes x P 6 x reps 2 x 3 now() calls per rep = 72 calls; STEP_AFTER=72 steps exactly those
// by 1 ms. Every recorded call (call 73 on) steps 1000 ms, so each rep's op ms = floor ms = 1000
// and ns/op = 1000 * 1e6 / totalOps, totalOps = corpus 2048 x outer 8 = 16384. Any warm-up call
// leaking into a recorded rep would give a 1 ms interval and a far smaller min.
describe('witness warm-up: warm-up passes feed no recorded raw / floor (stepped clock)', () => {
  it('slot HOT, P 6, rounds 3: every raw / floor is exactly 1000 ms per pass', () => {
    const env = { ...process.env, STEP_AFTER: '72' };
    delete env.NODE_OPTIONS;
    delete env.NODE_V8_COVERAGE;
    const spec = slot('HOT', SLOT6, 3);
    const r = spawnSync(process.execPath, ['--import', STEP_NOW, RUN_ONE, JSON.stringify(spec)],
      { cwd: ROOT, encoding: 'utf8', timeout: 10000, env });
    assert.equal(r.signal, null, 'child not killed (timeout/hang)');
    assert.equal(r.status, 0, 'child exit code (stderr: ' + r.stderr + ')');
    const res = JSON.parse(r.stdout.trim().split('\n').pop());
    const want = 1000 * 1e6 / 16384;
    assert.ok(Array.isArray(res.raw) && res.raw.length === 6, 'res.raw length = P');
    assert.ok(Array.isArray(res.floor) && res.floor.length === 6, 'res.floor length = P');
    for (let i = 0; i < 6; i++) {
      assert.strictEqual(res.raw[i], want, 'raw[' + i + ']');
      assert.strictEqual(res.floor[i], want, 'floor[' + i + ']');
    }
  });
});
