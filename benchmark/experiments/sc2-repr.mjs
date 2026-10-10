/**
 * SC-2 experiment -- signed-canonical vs unsigned-constructed representation.
 *
 *     node --expose-gc --min-semi-space-size=4 --max-semi-space-size=4 \
 *          benchmark/experiments/sc2-repr.mjs
 *
 * ROADMAP SC-2 / FB-03: the constructor and fromArray store `initial >>> 0`
 * (UNSIGNED -- a heap double for any word with bit 31 set), while every mutator
 * stores a signed int32. Does the unsigned-stored form cost time or allocation
 * per op? This is the Node half of the SC-2 vote (the browser half is the
 * demo's #measure mode, S7). MEASUREMENT ONLY -- FastBit32.js is NOT touched.
 *
 * ONE PROCESS PER REPRESENTATION. In one process, constructing the unsigned
 * instance generalizes the shared FastBit32 map's `value` field to a double, and
 * the signed instance migrates onto it -- the two "representations" then are
 * one. So the driver spawns a child per representation (same flags plus
 * --allow-natives-syntax) and the child ASSERTS its representation with
 * %DebugPrint before and after the measurement: `signed` must print the field as
 * a bare Smi, `unsigned` as `<HeapNumber ...>`. A failed assertion exits 1.
 *
 * Both hold the SAME set {5, 17, 31}:
 *   signed   = new FastBit32(0).add(5).add(17).add(31)        (negative Smi)
 *   unsigned = new FastBit32((1<<5 | 1<<17 | 1<<31) >>> 0)    (HeapNumber field)
 *
 * Lanes (each counted in scavenges at N and 8N, pinned semi-space, steady state
 * = MIN over windows 1..W-1 -- window 0 is printed, never used):
 *   inlined   a monomorphic read-op mix + serialize() sunk into a Float64Array:
 *             V8 inlines it, so 0 here only proves escape analysis worked.
 *   shared    serialize() through ONE call site shared by >= 5 classes (four
 *             look-alikes + FastBit32, the t6 `sharedHasAll` pattern): it cannot
 *             inline, so a double crossing the return boundary must box.
 *   sharedInt count() through the same kind of shared site (an int32 result):
 *             the read itself, without a double return.
 *   control   a look-alike whose serialize() returns a FRACTIONAL double,
 *             through the shared site: one box per call. It MUST scale N -> 8N
 *             (8N >= 4x N and N >= 4 scavenges) or the lane is blind: exit 1.
 */

import { PerformanceObserver, constants } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FastBit32 } from '../../FastBit32.js';

const SELF = fileURLToPath(import.meta.url);
const PIN_FLAGS = ['--expose-gc', '--min-semi-space-size=4', '--max-semi-space-size=4'];
const N = 2000000;
const WINDOWS = 4;

// --- fail closed: the pins and --expose-gc must be present ------------------
function assertEnv(needNatives) {
  const argv = process.execArgv.join(' ');
  const hasMin = /--min-semi-space-size=4\b/.test(argv);
  const hasMax = /--max-semi-space-size=4\b/.test(argv);
  if (typeof globalThis.gc !== 'function') throw new Error('SC-2: run with --expose-gc');
  if (!hasMin || !hasMax) {
    throw new Error('SC-2: pin BOTH --min-semi-space-size=4 and --max-semi-space-size=4 (got: ' + argv + ')');
  }
  if (needNatives && !/--allow-natives-syntax\b/.test(argv)) throw new Error('SC-2 child: needs --allow-natives-syntax');
}

// ============================ child ==========================================
const FSINK = new Float64Array(1);
const ISINK = new Int32Array(1);

// four look-alikes with distinct hidden classes; serialize() returns a Smi.
class LookA { constructor(v) { this.a = v | 0; } serialize() { return this.a; } count() { return this.a & 7; } }
class LookB { constructor(v) { this.b = v | 0; this.k = 1; } serialize() { return this.b; } count() { return this.b & 3; } }
class LookC { constructor(v) { this.c = v | 0; this.p = 0; this.q = 0; } serialize() { return this.c; } count() { return this.c & 1; } }
class LookD { constructor(v) { this.d = v | 0; this.s = 'x'; } serialize() { return this.d; } count() { return this.d & 15; } }
// the boxing control: a FRACTIONAL double return -> one HeapNumber per call.
class Boxer { constructor(v) { this.f = v + 0.5; } serialize() { return this.f; } count() { return 1; } }

// the shared call sites (one body each; megamorphic after warmShared).
function sharedSerialize(obj) { return obj.serialize(); }
function sharedCount(obj) { return obj.count(); }

function warmShared(inst) {
  const looks = [new LookA(1), new LookB(2), new LookC(3), new LookD(4), new Boxer(5)];
  for (let r = 0; r < 2000; r++) {
    for (let i = 0; i < looks.length; i++) { FSINK[0] = sharedSerialize(looks[i]); ISINK[0] = sharedCount(looks[i]); }
    FSINK[0] = sharedSerialize(inst); ISINK[0] = sharedCount(inst);
  }
}

function mixInlined(inst) {
  let acc = 0;
  acc += inst.count();
  acc += inst.has(5) ? 1 : 0;
  acc += inst.lowest();
  acc += inst.highestClearBit();
  ISINK[0] = acc | 0;
  FSINK[0] = inst.serialize();
}

let minorCount = 0;
function startObserver() {
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.detail && e.detail.kind === constants.NODE_PERFORMANCE_GC_MINOR) minorCount++;
    }
  });
  obs.observe({ entryTypes: ['gc'] });
  return obs;
}
const settle = () => new Promise((r) => setTimeout(r, 30));

// one lane: W windows at `steps`; returns per-window scavenges + ns/op.
async function windows(step, steps) {
  const sc = [], ns = [];
  for (let w = 0; w < WINDOWS; w++) {
    globalThis.gc();
    await settle();
    minorCount = 0;
    const t0 = performance.now();
    step(steps);
    const ms = performance.now() - t0;
    await settle(); // GC entries arrive async -- settle before reading
    sc.push(minorCount);
    ns.push(ms * 1e6 / steps);
  }
  const steady = Math.min(...sc.slice(1));
  const nsSteady = Math.min(...ns.slice(1));
  return { windows: sc, steady, nsSteady };
}

async function child(rep) {
  assertEnv(true);
  // eslint-disable-next-line no-new-func
  const debugPrint = new Function('o', '%DebugPrint(o);');
  const inst = rep === 'signed'
    ? new FastBit32(0).add(5).add(17).add(31)
    : new FastBit32(((1 << 5) | (1 << 17) | (1 << 31)) >>> 0);
  const boxer = new Boxer(7);
  process.stdout.write('ASSERT-BEGIN\n');
  debugPrint(inst);
  process.stdout.write('ASSERT-END\n');

  // The shared lanes read their receiver from a mutable array slot: a receiver
  // captured as a closure constant lets TurboFan constant-fold its map and
  // inline the method straight through the shared site (measured: the control
  // read [7,7,0,0] -- boxing in windows 0-1 only -- until this was done).
  const POOL = [inst, boxer];
  const lanes = {
    inlined: (s) => { for (let i = 0; i < s; i++) mixInlined(inst); },
    shared: (s) => { for (let i = 0; i < s; i++) FSINK[0] = sharedSerialize(POOL[0]); },
    sharedInt: (s) => { for (let i = 0; i < s; i++) ISINK[0] = sharedCount(POOL[0]); },
    control: (s) => { for (let i = 0; i < s; i++) FSINK[0] = sharedSerialize(POOL[1]); },
  };
  warmShared(inst);
  for (const k of Object.keys(lanes)) lanes[k](50000); // warm every lane
  const obs = startObserver();
  const out = { rep, value: inst.value, lanes: {} };
  for (const k of Object.keys(lanes)) {
    const a = await windows(lanes[k], N);
    const b = await windows(lanes[k], 8 * N);
    out.lanes[k] = { N: a, N8: b };
  }
  obs.disconnect();
  process.stdout.write('ASSERT-BEGIN\n');
  debugPrint(inst);
  process.stdout.write('ASSERT-END\n');
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\n');
}

// ============================ driver =========================================
function parseChild(text, rep) {
  const prints = [];
  const re = /ASSERT-BEGIN\n([\s\S]*?)ASSERT-END/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const line = m[1].split('\n').find((l) => l.includes('#value:'));
    prints.push(line ? line.trim() : '(no #value line)');
  }
  const resLine = text.split('\n').find((l) => l.startsWith('RESULT '));
  if (!resLine || prints.length !== 2) throw new Error('SC-2 ' + rep + ': child output incomplete');
  return { prints, res: JSON.parse(resLine.slice(7)) };
}

function assertRepresentation(rep, prints) {
  for (const p of prints) {
    const boxed = /<HeapNumber /.test(p);
    const smi = /#value: -?\d+ \(/.test(p);
    const ok = rep === 'unsigned' ? boxed : (smi && !boxed);
    console.log('  ' + rep.padEnd(8) + ' field: ' + p.replace(/^.*#value: /, '').replace(/ @ .*$/, '') + '  -> ' + (ok ? 'asserted' : 'WRONG'));
    if (!ok) return false;
  }
  return true;
}

async function driver() {
  assertEnv(false);
  console.log('env ok: ' + process.execArgv.join(' ') + '  node ' + process.version);
  const results = {};
  let bad = false;
  for (const rep of ['signed', 'unsigned']) {
    const text = execFileSync(process.execPath, [...PIN_FLAGS, '--allow-natives-syntax', SELF, '--child', rep], {
      encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    const { prints, res } = parseChild(text, rep);
    if (!assertRepresentation(rep, prints)) bad = true;
    results[rep] = res;
  }

  console.log('\nscavenges at N=' + N + ' / 8N=' + 8 * N + ' (steady = min over windows 1..' + (WINDOWS - 1) + '; [all windows]), ns/op steady');
  console.log('rep       lane        N steady [windows]        8N steady [windows]       ns/op N   ns/op 8N');
  for (const rep of ['signed', 'unsigned']) {
    for (const [k, l] of Object.entries(results[rep].lanes)) {
      console.log(rep.padEnd(9) + ' ' + k.padEnd(10) + ' ' +
        String(l.N.steady).padStart(4) + ' [' + l.N.windows.join(',') + ']'.padEnd(10) + '  ' +
        String(l.N8.steady).padStart(6) + ' [' + l.N8.windows.join(',') + ']'.padEnd(10) + '  ' +
        l.N.nsSteady.toFixed(3).padStart(7) + '  ' + l.N8.nsSteady.toFixed(3).padStart(8));
    }
  }

  // the boxing control MUST scale in both processes, or the lane is blind.
  for (const rep of ['signed', 'unsigned']) {
    const c = results[rep].lanes.control;
    const scales = c.N.steady >= 4 && c.N8.steady >= 4 * c.N.steady;
    console.log('control (' + rep + ' process): ' + c.N.steady + ' -> ' + c.N8.steady + ' scavenges ' + (scales ? 'scales ok' : 'DOES NOT SCALE -- lane blind'));
    if (!scales) bad = true;
  }
  if (bad) {
    console.log('\nSC-2: an assertion failed (representation or control) -- no verdict.');
    process.exitCode = 1;
    return;
  }
  const s = results.signed.lanes, u = results.unsigned.lanes;
  const scalesU = u.shared.N.steady >= 4 && u.shared.N8.steady >= 4 * u.shared.N.steady;
  const zeroS = s.shared.N8.steady === 0;
  console.log('\nVERDICT (SC-2 Node half, measured):');
  console.log('  inlined mix: signed ' + s.inlined.N8.steady + ', unsigned ' + u.inlined.N8.steady +
    ' scavenges at 8N (escape analysis removes the box when serialize() inlines).');
  console.log('  shared-site serialize(): signed ' + s.shared.N.steady + ' -> ' + s.shared.N8.steady +
    ', unsigned ' + u.shared.N.steady + ' -> ' + u.shared.N8.steady + ' scavenges (N -> 8N).');
  console.log('  shared-site count(): signed ' + s.sharedInt.N8.steady + ', unsigned ' + u.sharedInt.N8.steady + ' scavenges at 8N.');
  if (scalesU && zeroS) {
    console.log('  -> the UNSIGNED representation boxes once per serialize() that crosses a non-inlined call;');
    console.log('     the signed one does not. Per-op tax exists, but only at the double-returning edge.');
  } else {
    console.log('  -> no representation-dependent box observed at the shared serialize() site on this Node.');
  }
}

if (process.argv[2] === '--child') {
  await child(process.argv[3]);
} else {
  await driver();
}
