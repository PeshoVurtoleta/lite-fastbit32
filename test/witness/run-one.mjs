/**
 * @zakkster/lite-fastbit32 -- witness run-one (ONE subject x op x lane / process)
 *
 *     node test/witness/run-one.mjs '<json-spec>'
 *
 * The RESEARCH section 2 harness rule, made literal: a subject is timed behind a
 * MONOMORPHIC call site in its OWN process. A shared bench(fn) site does not
 * inline (the first probe read SWAR at ~4 ns; inlined it is ~0.4 ns), so this
 * file compiles ONE loop whose op is a LITERAL expression -- no fn is ever passed
 * in and called, which would make the site polymorphic. Each process handles a
 * single op, so its one measurement loop sees exactly one shape.
 *
 * Method: ROUNDS passes over the params; in each pass every cell is timed
 * best-of-REPS (the MIN) for the op loop AND for an empty-loop FLOOR on the same
 * corpus, op and floor reps interleaved. The reported net is the MEDIAN of the
 * per-pass (op - floor) nets; the
 * per-cell dispersion `disp` is max - min of the per-pass nets -- the in-process
 * noise of THAT cell, which the driver turns into the noise floor (the flatness
 * spread is also measured in-process, so in-process dispersion is its comparator).
 * The result of every op is XORed into `acc` and sunk into an Int32Array slot
 * (SINK) at the end, so a dead-code-eliminated loop cannot read ~0 silently. The
 * PRESSURE lane also streams a 32 MB Int32Array at a 4099-word (prime) stride
 * inside both the op loop AND the floor loop, so the streaming baseline cancels
 * and only the op's own cache behaviour survives the subtraction -- to within a
 * measured NEGATIVE bias (ALU ops run up to ~0.3 ns faster than the empty loop
 * under the stream; benchmark/METHODOLOGY.md), so PRESSURE nets are relative
 * across cells, not absolute costs. The stream
 * index stays int32 (`si = (si + 4099) & SMASK`): an unmasked `si += 4099` leaves
 * int32 after ~524k iterations and deopts the loop to double arithmetic.
 *
 * Output: exactly one JSON line to stdout:
 *   {subject,op,lane,mode,params,raw,floor,net,disp,rounds,flags}
 * `raw`, `floor`, `net`, `disp` are ns-per-op arrays aligned to `params`;
 * `rounds` is the per-pass net matrix; `flags` names every cell whose net is
 * not finite or fell to <= 0 after floor subtraction (never clamped here -- the
 * driver prints every flag and fails a meaningfully negative cell).
 *
 * Timing only: no --expose-gc, no semi-space pins. GC lives in the torture lane.
 */

import {
  FastBit32,
  FastBit1024,
  forEachArray,
  forEachObject,
  forEachMapped,
  forEachMappedObject,
  forEachMaskPair,
  forEachMaskDiff,
  forEachMaskUnion,
} from '../../FastBit32.js';

// --- seeded xorshift32 (same family as the torture harness) ----------------
function makeRng(seed) {
  let s = seed | 0 || 0x9e3779b9;
  return function next() {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return s >>> 0;
  };
}

// --- corpus builders --------------------------------------------------------
// A word with exactly `d` bits set at random positions (Fisher-Yates on 0..31).
function wordOfDensity(rng, d) {
  if (d <= 0) return 0;
  if (d >= 32) return -1;
  const idx = POS_SCRATCH;
  for (let i = 0; i < 32; i++) idx[i] = i;
  for (let i = 31; i > 0; i--) {
    const j = rng() % (i + 1);
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  let w = 0;
  for (let i = 0; i < d; i++) w |= (1 << idx[i]);
  return w | 0;
}
const POS_SCRATCH = new Int32Array(32);

// A position param -> the single word it stands for.
//   0..31 -> 1 << p ;  100 -> 0 (empty) ;  101 -> -1 (full)
function wordOfPosition(p) {
  if (p === 100) return 0;
  if (p === 101) return -1;
  return (1 << p) | 0;
}

// --- 16-bit popcount LUT (the cache-pressure foil) -------------------------
function buildLut16() {
  const lut = new Uint8Array(65536);
  for (let i = 0; i < 65536; i++) {
    let v = i, c = 0;
    while (v) { v &= v - 1; c++; }
    lut[i] = c;
  }
  return lut;
}

// --- scalar op / foil statement table --------------------------------------
// Each entry is a STATEMENT that assigns the op's result to the local `r`.
// `inst` is a FastBit32 whose value is the current word `w`; `w` is the raw
// word; `sets[i]` is a prebuilt Set<number> for the Set foil; `LUT` is the
// 16-bit table. Every statement is compiled into a dedicated monomorphic loop.
const SCALAR = {
  // --- the real FastBit32 constant-time ops (the subjects under proof) ---
  count: 'r=inst.count();',
  countMasked: 'r=inst.countMasked(0x0f0f0f0f);',
  countRange: 'r=inst.countRange(4,27);',
  lowest: 'r=inst.lowest();',
  highest: 'r=inst.highest();',
  nextClearBit: 'r=inst.nextClearBit();',
  highestClearBit: 'r=inst.highestClearBit();',
  // Booleans are consumed BRANCH-FREE (`|0`). `?1:0` compiles to a branch in
  // the HARNESS: on mixed corpora it mispredicts and reads ~0.6 ns of
  // data-dependence that belongs to the consumer, not the op (measured
  // 2026-10-10: has ?1:0 spread 0.57 ns vs has |0 spread 0.04 ns, HOT density).
  has: 'r=inst.has(17)|0;',
  hasAll: 'r=inst.hasAll(0x0f0f0f0f)|0;',
  hasAny: 'r=inst.hasAny(0x0f0f0f0f)|0;',
  hasNone: 'r=inst.hasNone(0x0f0f0f0f)|0;',
  isEmpty: 'r=inst.isEmpty()|0;',
  isFull: 'r=inst.isFull()|0;',
  // S4 Tier-1. Argument shape: a LITERAL constant argument per op (one
  // monomorphic site, like countRange(4,27)); equals takes `other`, a second
  // FastBit32 of the SAME hidden class whose word (0x0f0f0f0f) never changes,
  // so the site sees one map. (equals(inst) would let V8 fold w ^ w to 0.)
  nextSetBit: 'r=inst.nextSetBit(9);',
  prevSetBit: 'r=inst.prevSetBit(22);',
  rank: 'r=inst.rank(17);',
  equals: 'r=inst.equals(other)|0;',
  isSubsetOf: 'r=inst.isSubsetOf(0x0f0f0f0f)|0;',
  equalsValue: 'r=inst.equalsValue(0x0f0f0f0f)|0;',
  // --- the floor (empty loop: just read the word) ---
  _floor: 'r=w;',
  // --- the five foils (MUST fail flatness) ---
  // Kernighan: O(popcount) -- density-dependent in every lane.
  foilKernighan: 'let v=w,c=0; while(v!==0){v&=v-1;c++;} r=c;',
  // 32-shift early-exit popcount: depends on the HIGHEST set bit.
  foilEarlyExit: 'let v=w,c=0; for(let b=v;b;b>>>=1){c+=b&1;} r=c;',
  // 16-bit LUT: flat when L1-hot, data-dependent under cache pressure.
  foilLut16: 'r=LUT[w&0xffff]+LUT[(w>>>16)&0xffff];',
  // naive forward scan for the lowest bit: depends on the LOWEST set bit.
  foilNaiveLowest: 'let idx=-1; for(let b=0;b<32;b++){ if(w&(1<<b)){idx=b;break;} } r=idx;',
  // Set<number> of indices, counted by iteration: O(popcount) + iterator alloc.
  foilSet: 'let c=0; const s=sets[i]; for(const _ of s){c++;} r=c;',
  // SUB-EPS control: a branchy op whose ONLY data dependence is one imul on the
  // loop-carried `acc` chain, taken on the full word only (w === -1: density 32
  // / position full). Measured step ~0.7 ns HOT (2026-10-10) -- below the old
  // absolute EPS_HOT clamp of 0.8 ns, so the old gate read it flat. The
  // noise-derived gate MUST fail it.
  foilSubEps: 'if(w===-1){r=Math.imul(acc|1,0x9e3779b1);}else{r=w;}',
  // same-corpus CONTROL: an op-shaped read of the instance with no work at all.
  // Any d0/d32 "artifact" an op shares with this control is the harness, not the op.
  ctlRead: 'r=inst.value|0;',
};

// The stream index is masked every step so it stays a small int32 (an unmasked
// `si += 4099` crosses 2^31 after ~524k iterations and deopts the loop), and it
// PERSISTS across calls in the SI slot: restarting at 0 every call made the
// touched footprint scale with `outer` (measured: floor 0.98 ns at outer=128 vs
// 1.34 ns at outer=1024), so a short loop never left the cache it claimed to flood.
const STREAM_STMT = 'acc=(acc+STREAM[si])|0; si=(si+4099)&SMASK;';

function makeScalarLoop(stmt, pressure, store = 'inst.value=w;') {
  const stream = pressure ? STREAM_STMT : '';
  // eslint-disable-next-line no-new-func
  return new Function(
    'inst', 'corpus', 'sets', 'LUT', 'outer', 'SINK', 'STREAM', 'SMASK', 'SI', 'other',
    'let si=SI[0], acc=0;\n' +
    'for(let o=0;o<outer;o++){\n' +
    '  for(let i=0;i<corpus.length;i++){\n' +
    '    const w=corpus[i]; ' + store + '\n' +
    '    let r;\n' +
    '    ' + stmt + '\n' +
    '    acc^=r|0;\n' +
    '    ' + stream + '\n' +
    '  }\n' +
    '}\n' +
    'SINK[0]=acc; SI[0]=si;\n'
  );
}

// --- FastBit1024 (S4b): mode 'slot', param p = word 0..31 --------------------
// ONE FastBit1024 and ONE corpus per process, RE-SHAPED per param before every
// timed pass (outside the timed loops): separate instances per param measured
// their heap placement, not the data (round-2 review: same data in 32 instances
// spread 2.50-6.54 ns; one instance per process 2.26-2.66 ns). `w` (the corpus
// entry) is the slot 32p + 17. Pool shape (acquire, nextClearBit, has,
// hasUnchecked, foilWordScan): every bit set except slot w. Set shape (lowest,
// highest): only slot w set. The loop never changes the state (acquire is
// paired with its release). hasUnchecked is has() with the fail-closed check
// removed, inlined: printed beside has to price the check (info row).
// foilWordScan is the slot-mode must-fail control: a linear scan for the first
// non-full word, O(p), gated RED in HOT.
const SLOT = {
  acquire: 'r=inst.acquire(); inst.release(r);',
  nextClearBit: 'r=inst.nextClearBit();',
  has: 'r=inst.has(w)|0;',
  hasUnchecked: 'r=((inst._data[w>>>5]&(1<<(w&31)))!==0)|0;',
  lowest: 'r=inst.lowest();',
  highest: 'r=inst.highest();',
  foilWordScan: 'r=0; while(inst._data[r]===-1) r++;',
  _floor: 'r=w;',
};
function reshapeSlot(s, op, p) {
  const free = (p << 5) + 17;
  s.clear();
  if (op === 'lowest' || op === 'highest') s.add(free);
  else for (let i = 0; i < 1024; i++) if (i !== free) s.add(i);
}

// --- iteration (slope) statement table --------------------------------------
const CB_SINK = new Int32Array(1);
function cbBit(b) { CB_SINK[0] ^= b; }
function cbVB(v, b) { CB_SINK[0] ^= b; }
function cbVKB(v, k, b) { CB_SINK[0] ^= b; }
function cbNB(n, b) { CB_SINK[0] ^= b; }

const ITER = {
  forEach: 'inst.forEach(cbBit);',
  forEachArray: 'forEachArray(inst, ARR, cbVB);',
  forEachObject: 'forEachObject(inst, KEYS, OBJ, cbVKB);',
  forEachMapped: 'forEachMapped(inst, MAPPER, cbNB);',
  forEachMappedObject: 'forEachMappedObject(inst, MAPPER, OBJ, cbVKB);',
  forEachMaskPair: 'forEachMaskPair(maskA, maskB, cbBit);',
  forEachMaskDiff: 'forEachMaskDiff(maskA, maskB, cbBit);',
  forEachMaskUnion: 'forEachMaskUnion(maskA, maskB, cbBit);',
  _floor: '',
  // --- iterator foils (MUST fail the slope gate) ---
  // O(k^2): every set bit re-walks the whole word -> k*k callbacks.
  foilIterQuad: 'let v=inst.value; while(v!==0){ let u=inst.value; while(u!==0){ cbBit(31-Math.clz32(u&-u)); u&=u-1; } v&=v-1; }',
  // fixed 32-step scan: O(32) work at every k (+ k callbacks) -> large intercept.
  foilIterScan32: 'const v=inst.value; for(let b=0;b<32;b++){ if((v&(1<<b))!==0) cbBit(b); }',
  // mid-k STEP: a correct forEach plus 16 extra callbacks once k >= 16 (the
  // corpus word (1<<k)-1 has bit 15 set exactly then) -> a ~16 ns step that a
  // linear fit absorbs into R^2 ~0.94 and small curvature; the max residual
  // check MUST catch it.
  foilIterStep: 'inst.forEach(cbBit); if((inst.value&0x8000)!==0){ for(let j=0;j<16;j++) cbBit(j); }',
};

function makeIterLoop(stmt, pressure) {
  const stream = pressure ? STREAM_STMT : '';
  // eslint-disable-next-line no-new-func
  return new Function(
    'inst', 'maskA', 'maskB', 'ARR', 'KEYS', 'OBJ', 'MAPPER',
    'forEachArray', 'forEachObject', 'forEachMapped', 'forEachMappedObject',
    'forEachMaskPair', 'forEachMaskDiff', 'forEachMaskUnion',
    'cbBit', 'cbVB', 'cbVKB', 'cbNB', 'CB_SINK', 'N', 'SINK', 'STREAM', 'SMASK', 'SI',
    'let si=SI[0], acc=0;\n' +
    'for(let o=0;o<N;o++){\n' +
    '  ' + stmt + '\n' +
    '  acc^=CB_SINK[0];\n' +
    '  ' + stream + '\n' +
    '}\n' +
    'SINK[0]=acc; SI[0]=si;\n'
  );
}

// --- the shared streaming buffer + sink -------------------------------------
const STREAM_WORDS = 8 * 1024 * 1024; // 32 MB of Int32 >> any last-level cache
const SMASK = STREAM_WORDS - 1;       // power of two
const SINK = new Int32Array(1);
const SI = new Int32Array(1);         // persistent stream index

// Op and floor reps are INTERLEAVED (op, floor, op, floor, ...) so slow drift
// (clock, memory-system state) hits both sides of the subtraction alike.
// BEST[0] = min op ms, BEST[1] = min floor ms.
const BEST = new Float64Array(2);
function bestPair(opFn, floorFn, reps) {
  let mo = Infinity, mf = Infinity;
  opFn(); floorFn(); // warm both
  for (let r = 0; r < reps; r++) {
    const t0 = performance.now();
    opFn();
    const t1 = performance.now();
    floorFn();
    const t2 = performance.now();
    if (t1 - t0 < mo) mo = t1 - t0;
    if (t2 - t1 < mf) mf = t2 - t1;
  }
  BEST[0] = mo; BEST[1] = mf;
}

function main() {
  const spec = JSON.parse(process.argv[2]);
  const { subject, op, lane, mode } = spec;
  const params = spec.params;
  const reps = spec.reps || 5;
  const pressure = lane === 'PRESSURE';
  const STREAM = pressure ? new Int32Array(STREAM_WORDS) : new Int32Array(1);
  if (pressure) for (let i = 0; i < STREAM_WORDS; i++) STREAM[i] = Math.imul(i, 0x9e3779b1);
  const rounds = spec.rounds || 2;
  const P = params.length;
  // per-cell minima across ALL passes, plus the per-pass nets for dispersion.
  const opMin = new Float64Array(P).fill(Infinity);
  const flMin = new Float64Array(P).fill(Infinity);
  const roundNets = [];

  if (mode === 'slope') {
    // Iteration slope: param = k (popcount). One setup word per k, N calls/rep.
    const N = spec.ops || 400000;
    const ARR = new Array(32); const KEYS = new Array(32); const OBJ = {};
    const names = [];
    for (let i = 0; i < 32; i++) { ARR[i] = i * 3; KEYS[i] = 'k' + i; OBJ['k' + i] = i; names.push('n' + i); }
    const MAPPER = { getName(b) { return names[b]; } };
    const inst = new FastBit32(0);
    const maskA = new FastBit32(0);
    const maskB = new FastBit32(0);
    const stmt = ITER[subject === 'fb' ? op : subject];
    if (typeof stmt !== 'string') throw new Error('run-one: unknown iterator ' + subject + '/' + op);
    const loop = makeIterLoop(stmt, pressure);
    const floorLoop = makeIterLoop(ITER._floor, pressure);
    const call = (L) => L(inst, maskA, maskB, ARR, KEYS, OBJ, MAPPER,
      forEachArray, forEachObject, forEachMapped, forEachMappedObject,
      forEachMaskPair, forEachMaskDiff, forEachMaskUnion,
      cbBit, cbVB, cbVKB, cbNB, CB_SINK, N, SINK, STREAM, SMASK, SI);
    const setK = (k) => {
      const word = k >= 32 ? -1 : (k <= 0 ? 0 : (((1 << k) - 1) | 0));
      inst.value = word;
      // pair visits A&B, diff visits A&~B, union visits A|B.
      maskA.value = word; maskB.value = (op === 'forEachMaskPair') ? word : 0;
    };
    for (let ri = 0; ri < rounds; ri++) {
      const rn = [];
      for (let pi = 0; pi < P; pi++) {
        setK(params[pi]);
        bestPair(() => call(loop), () => call(floorLoop), reps);
        const o = BEST[0] * 1e6 / N, f = BEST[1] * 1e6 / N;
        if (o < opMin[pi]) opMin[pi] = o;
        if (f < flMin[pi]) flMin[pi] = f;
        rn.push(o - f);
      }
      roundNets.push(rn);
    }
    finish(spec, opMin, flMin, roundNets);
    return;
  }

  if (mode === 'slot') {
    const CORPUS = spec.corpus || 2048;
    const outer = spec.outer || 512;
    const stmt = SLOT[op];
    if (typeof stmt !== 'string') throw new Error('run-one: unknown FastBit1024 op ' + op);
    const loop = makeScalarLoop(stmt, pressure, '');
    const floorLoop = makeScalarLoop(SLOT._floor, pressure, '');
    const totalOps = CORPUS * outer;
    const inst = new FastBit1024();
    const corpus = new Int32Array(CORPUS);
    for (let ri = 0; ri < rounds; ri++) {
      const rn = [];
      for (let pi = 0; pi < P; pi++) {
        reshapeSlot(inst, op, params[pi]);
        corpus.fill((params[pi] << 5) + 17);
        const call = (L) => L(inst, corpus, EMPTY_SETS, EMPTY_LUT, outer, SINK, STREAM, SMASK, SI, null);
        bestPair(() => call(loop), () => call(floorLoop), reps);
        const o = BEST[0] * 1e6 / totalOps, f = BEST[1] * 1e6 / totalOps;
        if (o < opMin[pi]) opMin[pi] = o;
        if (f < flMin[pi]) flMin[pi] = f;
        rn.push(o - f);
      }
      roundNets.push(rn);
    }
    finish(spec, opMin, flMin, roundNets);
    return;
  }

  // Scalar modes: density (param = d) or position (param coded, see above).
  const CORPUS = spec.corpus || 2048;
  const outer = spec.outer || 512;
  const rng = makeRng(spec.seed || 0x1234abcd);
  const inst = new FastBit32(0);
  const other = new FastBit32(0);
  other.value = 0x0f0f0f0f; // same field write as inst.value = w: one map
  const LUT = (subject === 'foilLut16') ? buildLut16() : EMPTY_LUT;
  const stmtKey = subject === 'fb' ? op : subject; // foils ignore op
  const stmt = SCALAR[stmtKey];
  if (typeof stmt !== 'string') throw new Error('run-one: unknown scalar subject ' + stmtKey);
  const loop = makeScalarLoop(stmt, pressure);
  // `spec.floor` overrides the floor statement ONLY for the driver's
  // broken-floor control (a heavier floor must drive the net negative and trip
  // the driver's negative-cell gate). Every measured subject uses `_floor`.
  const floorKey = spec.floor || '_floor';
  if (typeof SCALAR[floorKey] !== 'string') throw new Error('run-one: unknown floor ' + floorKey);
  const floorLoop = makeScalarLoop(SCALAR[floorKey], pressure);
  const totalOps = CORPUS * outer;

  // corpora are built ONCE per param, then reused by every pass.
  const corpora = [];
  const setsBy = [];
  for (const p of params) {
    const corpus = new Int32Array(CORPUS);
    if (mode === 'density') {
      for (let i = 0; i < CORPUS; i++) corpus[i] = wordOfDensity(rng, p);
    } else if (mode === 'position') {
      const w = wordOfPosition(p);
      for (let i = 0; i < CORPUS; i++) corpus[i] = w;
    } else {
      throw new Error('run-one: unknown mode ' + mode);
    }
    corpora.push(corpus);
    setsBy.push((subject === 'foilSet') ? buildSets(corpus) : EMPTY_SETS);
  }
  for (let ri = 0; ri < rounds; ri++) {
    const rn = [];
    for (let pi = 0; pi < P; pi++) {
      const corpus = corpora[pi], sets = setsBy[pi];
      const call = (L) => L(inst, corpus, sets, LUT, outer, SINK, STREAM, SMASK, SI, other);
      bestPair(() => call(loop), () => call(floorLoop), reps);
      const o = BEST[0] * 1e6 / totalOps, f = BEST[1] * 1e6 / totalOps;
      if (o < opMin[pi]) opMin[pi] = o;
      if (f < flMin[pi]) flMin[pi] = f;
      rn.push(o - f);
    }
    roundNets.push(rn);
  }
  finish(spec, opMin, flMin, roundNets);
}

// net = MEDIAN of the per-pass nets (each pass: interleaved best-of-REPS op minus
// best-of-REPS floor); disp = max - min of the per-pass nets. raw/floor are the
// minima over all passes (orientation only). The median-of-passes is robust to
// one disturbed pass (measured 2026-10-10: PRESSURE real-op spread 2.9-3.6x the
// noise vs 4.5-5.7x with min(op)-min(floor)).
function finish(spec, opMin, flMin, roundNets) {
  const { subject, op, lane, mode, params } = spec;
  const raw = [], floor = [], net = [], disp = [], flags = [];
  for (let pi = 0; pi < params.length; pi++) {
    const col = roundNets.map((rn) => rn[pi]).sort((a, b) => a - b);
    const n = col[col.length >> 1];
    const lo = col[0], hi = col[col.length - 1];
    raw.push(opMin[pi]); floor.push(flMin[pi]); net.push(n); disp.push(hi - lo);
    if (!Number.isFinite(n)) flags.push(params[pi] + ':non-finite');
    else if (!(n > 0)) flags.push(params[pi] + ':net<=0(' + n.toFixed(3) + ')');
  }
  out({ subject, op, lane, mode, params, raw, floor, net, disp, rounds: roundNets, flags });
}

const EMPTY_LUT = new Uint8Array(1);
const EMPTY_SETS = [];
function buildSets(corpus) {
  const sets = new Array(corpus.length);
  for (let i = 0; i < corpus.length; i++) {
    const s = new Set();
    let v = corpus[i] >>> 0;
    for (let b = 0; b < 32; b++) if (v & (1 << b)) s.add(b);
    sets[i] = s;
  }
  return sets;
}

function out(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

main();
