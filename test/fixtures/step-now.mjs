// test/fixtures/step-now.mjs -- test-only preload: a stepped fake performance.now().
//
//     STEP_AFTER=72 node --import ./test/fixtures/step-now.mjs test/witness/run-one.mjs '<json-spec>'
//
// Replaces globalThis.performance.now with a deterministic clock: each call advances the
// time by 1 ms for the first STEP_AFTER calls, then by 1000 ms for every later call. So the
// calls up to STEP_AFTER are "cheap" (1 ms apart) and every call after is "expensive"; a test
// can tell which calls fed a recorded value. Fail closed: a missing / negative /
// non-decimal-integer STEP_AFTER, a non-function performance.now, or a shim that cannot be read back throws at
// load, so the child exits non-zero. Never shipped; never imported by the library or a gate.

const RAW = process.env.STEP_AFTER;
if (typeof RAW !== 'string' || !/^(0|[1-9][0-9]{0,8})$/.test(RAW)) {
  throw new Error('step-now: STEP_AFTER must be a decimal integer >= 0');
}
const K = Number(RAW);
const perf = globalThis.performance;
if (!perf || typeof perf.now !== 'function') throw new Error('step-now: globalThis.performance.now is not a function');

let n = 0, t = 0;
function steppedNow() {
  return (t += (++n <= K ? 1 : 1000));
}
Object.defineProperty(perf, 'now', { value: steppedNow, writable: true, configurable: true, enumerable: true });
if (perf.now !== steppedNow) throw new Error('step-now: could not install the performance.now shim');
