// test/fixtures/count-now.mjs -- test-only preload: counts performance.now() calls.
//
//     node --import ./test/fixtures/count-now.mjs test/witness/run-one.mjs '<json-spec>'
//
// Wraps globalThis.performance.now with a counting shim (the original is called with the
// original receiver, so the clock values are unchanged) and writes exactly ONE line to stderr
// when the process exits:
//
//     COUNT_NOW performance.now <n>
//
// A reader matches /^COUNT_NOW performance\.now (\d+)$/m. Fail closed: if performance.now is
// not a function or the shim cannot be installed (or read back), the preload throws at load,
// so the child exits non-zero and no count line is printed. stdout is never touched (run-one
// writes its one JSON line there). Never shipped; never imported by the library or a gate.

const perf = globalThis.performance;
const orig = perf && perf.now;
if (typeof orig !== 'function') throw new Error('count-now: globalThis.performance.now is not a function');

let calls = 0;
function countedNow() {
  calls++;
  return orig.call(perf);
}
Object.defineProperty(perf, 'now', { value: countedNow, writable: true, configurable: true, enumerable: true });
if (perf.now !== countedNow) throw new Error('count-now: could not install the performance.now shim');

process.on('exit', () => {
  process.stderr.write('COUNT_NOW performance.now ' + calls + '\n');
});
