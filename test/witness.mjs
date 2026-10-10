/**
 * @zakkster/lite-fastbit32 -- the constant-time Witness.
 *
 *     node test/witness.mjs            # full run (HOT + PRESSURE), gated
 *     WITNESS_FAST=1 node ...          # HOT lane, coarse sweep (goes in verify)
 *     WITNESS_CALIBRATE=1 node ...     # print measured metrics, DO NOT gate
 *
 * RESEARCH section 2 made executable. The anchor claim: every hot op runs in the
 * SAME time for every input word -- its ns/op is flat across bit density 0..32
 * and bit position 0..31 (+ empty, full), and forEach / the free iterators are
 * linear in popcount. Big-O is meaningless at n = 32 (a 32-step loop is also
 * O(1)); the real, falsifiable claim is NO data-dependent work, and the foils
 * below fail it.
 *
 * Each cell is measured by a SEPARATE process (test/witness/run-one.mjs), one
 * subject x op x lane, behind a monomorphic call site: ROUNDS passes, each an
 * interleaved best-of-REPS op loop minus an empty-loop floor, net = median of
 * the passes, per-cell dispersion `disp` = range of the passes, the result sunk
 * into an Int32Array slot.
 *
 * NO ABSOLUTE-ns CONSTANT GATES. Every bound below is either a dimensionless
 * ratio or a multiple of THIS run's own measured noise:
 *   NOISE(lane) = median cell-to-cell spread (max - min net) over the lane's
 *                 real-op rows (12 flat ops x 2 sweeps = 24 rows). This is the
 *                 scatter a flat op shows across cells on this host in this run.
 *                 The pass-to-pass dispersion of a repeated cell is printed too,
 *                 but it is NOT the comparator: it ran 0.015-0.033 ns HOT while
 *                 single cells sat ~0.1 ns off their row for a whole process
 *                 (corpus/JIT placement), so a dispersion-scaled spread gate
 *                 failed clean runs (count position 7.2x dispersion).
 *   EPS(lane)   = EPS_K(lane) x NOISE(lane): the ratio clamp AND the
 *                 negative-cell bound (a cell with !(net > -EPS) FAILS: broken
 *                 floor subtraction);
 *   ratio       = max/min of net, each cell clamped up to EPS;
 *   spread      = max - min of net (unclamped ns), gated in NOISE units;
 *   slope fit   = least squares; per-op R^2 floor, two-sided |intercept| <=
 *                 INTERCEPT_K x slope, rise (slope x kmax) >= RISE_K x NOISE(HOT),
 *                 SIGN-AWARE curvature -0.60 <= curv <= 0.60 (curvature = share
 *                 of the fitted rise owed to the k^2 term of a quadratic fit;
 *                 convex is the regression direction), and max |residual| <=
 *                 RESID_K x slope (per-bit units: iterator jitter scales with
 *                 the per-bit cost, 0.46-7.4 ns/bit, and the scalar NOISE is
 *                 ~100x below it). Pinned shapes (SLOPE_OP): forEachMapped is
 *                 gated on its stable phase k = 0 mod 4; forEachArray's residual
 *                 is taken against the quadratic fit, concave floor -0.75.
 *                 Same R^2 0.90 / RESID_K 3.5 for all eight.
 * The self-referential NOISE fails open only inside a BOUNDED window. The foils
 * are judged in the same units, but foilSubEps has a fixed ~0.7 ns step: NOISE
 * can inflate ~1.5-2x (to ~0.1 ns HOT) before that foil reads flat and fails the
 * run, and NOISE (a median over 24 rows) only inflates if >= 12 real-op rows
 * regress together. Inside that window a common regression of up to ~0.1 ns per
 * op could pass, and a single op is then allowed SPREAD_K x NOISE = 6 N ~ 0.6 ns
 * of spread. NOISE must also be finite, > 0 and <= NOISE_FLOOR_MAX x the lane's
 * median floor ns; NOISE_FLOOR_MAX HOT 0.27 fires before foilSubEps can flip
 * (flip at noise/floor ~0.33), so a too-noisy host gets a HOST verdict. Once a
 * lane's NOISE check fails, that lane's other gate lines print HOST (no
 * verdict) and are not reported as findings; the NOISE failure fails the run.
 * Absolute ns are printed for orientation only. The constants are
 * dimensionless; the RESOLUTION is host-dependent (NOISE is per host, per run).
 *
 * Teeth (each MUST fail; a foil that passes fails the run):
 *   HOT       Kernighan, 32-shift early-exit, naive lowest scan, Set<number>,
 *             and foilSubEps -- a branchy op with a ~0.7 ns full-word step,
 *             below the old absolute 0.8 ns clamp (the old gate read it flat:
 *             (0.95 clamp 0.8) / (0.20 clamp 0.8) = 1.19 < old FLAT_HOT 2.8).
 *   PRESSURE  16-bit LUT (flat when L1-hot, data-dependent under the stream):
 *             spread >= FOIL_SPREAD_K x NOISE AND its spread beats the worst
 *             real-op density spread of the lane by MARGIN_K_PRESSURE x NOISE.
 *             Kernighan is run and pinned red in PRESSURE too.
 *   SLOPE     foilIterQuad (O(k^2): curvature), foilIterScan32 (fixed
 *             32-step scan: intercept) and foilIterStep (forEach + a 16-callback
 *             step at k >= 16: max residual).
 *   CONTROLS  ctlRead (the harness's own null on the same corpora, d0/d32 and
 *             empty/full included) must be flat; broken-floor control (a
 *             Kernighan floor drives the net negative) must trip the
 *             negative-cell gate; repeated-cell self-check runs TWO processes
 *             and its control (count vs Kernighan) must disagree.
 *   EXPECTED-RED highestClearBit (FB-09/S3): pinned NON-flat in HOT and
 *             PRESSURE, density and position. If it comes out flat the run
 *             FAILS ("flip in S3"): S3 removes the pin deliberately, nobody
 *             else does. Shown able to fail: the S3 body `31 - clz32(~v)` in a
 *             scratch copy reads ratio 1.00 / spread 0.63 N -> 2 FAIL.
 *
 * ===========================================================================
 * FROZEN GATE (re-frozen 2026-10-10, node v26.8.2, Apple M4 Pro, darwin; D-02
 * pattern from ../LiteLogN). HOT basis: 6 round-1 runs + 8 round-2 runs.
 * PRESSURE basis: 8 full WITNESS_CALIBRATE runs at the current config (rounds 5,
 * reps 3; 84.8-87.6 s each); ranges are min..max. Table in METHODOLOGY.md.
 * Units: N = NOISE(lane).
 *
 *   NOISE HOT 0.038-0.073 ns; PRESSURE 0.046-0.081 ns (rounds 5 halved it).
 *   PRESSURE noise/floor is bimodal: quiet 0.033-0.060, under concurrent host
 *     load 0.095-0.118 (one loaded run drowned LUT16: 3.64 N, SEP 1.90 N) ->
 *     NOISE_FLOOR_MAX PRESSURE 0.08: a loaded host gets a HOST verdict.
 *     The full witness needs a quiet host.
 *   HOT real ops: spread <= 3.86 N, ratio (EPS 4N) <= 1.86.  foilSubEps spread
 *     9.34-19.96 N (ratio 2.83-4.92 -- not binding).  Other HOT foils >= 77.5 N.
 *     -> EPS_K 4, FLAT_RATIO 2.5, SPREAD_K 6, FOIL_SPREAD_K 7 (foil verdict is
 *        spread-only: ratio >= 3 would already imply spread >= 8 N).
 *     noise/floor HOT quiet max 0.243 -> NOISE_FLOOR_MAX HOT 0.27 (< flip 0.33).
 *   PRESSURE real ops: spread <= 3.50 N (countMasked density); cells down to
 *     -0.167 ns = -3.6 N (the reviewer saw -0.48 ns / 3.24 N at rounds 3).
 *     LUT16 density 8.82-18.91 N; SEP 6.89-15.40 N; Kernighan >= 84.6 N;
 *     foilSubEps 2.07-4.20 N (not resolvable: HOT-lane foil only).
 *     -> EPS_K 7 (negative bound, 1.9x the worst bias), SPREAD_K 4.5 (1.29x),
 *        FOIL_SPREAD_K 5.5 (LUT16 1.6x above), MARGIN_K 2 (SEP 3.4x above).
 *        No PRESSURE ratio gate: EPS clamps every real cell to 1.00.
 *   Self-check: two processes |a-b| <= 0.137 ns (tol 5 N = 0.19-0.37 ns);
 *     control |count - Kernighan| >= 0.535 ns.
 *   Slopes (8 runs): R^2 >= 0.954, resid/slope <= 2.57, curv -0.09..+0.24 for
 *     the six plain iterators; |a|/slope <= 4.59.  Pinned shapes, re-checked on
 *     4 fresh series each (round 3, synthetic-series harness, METHODOLOGY):
 *     forEachMapped phase k = 0 mod 4: R^2 >= 0.995, resid <= 1.28 x slope,
 *     curv -0.13..-0.16; forEachArray quadratic resid <= 2.85 x slope, curv
 *     -0.22..-0.52.  Foils: foilIterStep resid 4.51-5.13 x slope (R^2
 *     0.915-0.936 -- only resid catches it), foilIterQuad curv 0.95-0.98,
 *     foilIterScan32 a/slope 29.7-42.7.  A convex regression 0.3 + 0.9k +
 *     0.05k^2 (curv 0.64) goes red for every iterator.
 *     -> R2 0.90, RESID_K 3.5, INTERCEPT_K 6, curv in [-0.60, 0.60]
 *        (forEachArray [-0.75, 0.60]), RISE_K 20.
 * ===========================================================================
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadavg } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_ONE = join(HERE, 'witness', 'run-one.mjs');

// --- FROZEN gate constants (dimensionless; see header + METHODOLOGY) --------
const EPS_K = { HOT: 4, PRESSURE: 7 };      // EPS = EPS_K x NOISE
// PRESSURE: no ratio gate -- EPS 7 N clamps every real cell (ratio 1.00 always),
// so the ratio cannot bind there; spread is the PRESSURE flatness gate.
const FLAT_RATIO = { HOT: 2.5, PRESSURE: NaN };
const SPREAD_K = { HOT: 6, PRESSURE: 4.5 }; // real op: spread <= SPREAD_K x NOISE
// Foil verdict = spread only, in both lanes. (A HOT ratio floor of 3 was
// redundant: with EPS = 4 N, ratio >= 3 already implies spread >= 8 N > 7 N, so
// the old "ratio OR spread" verdict was exactly "spread >= 7 N".) Ratio printed.
const FOIL_SPREAD_K = { HOT: 7, PRESSURE: 5.5 }; // foil: spread >= FOIL_SPREAD_K x NOISE
const MARGIN_K_PRESSURE = 2;                // LUT16 spread - worst real spread >= 2 N
// NOISE <= NOISE_FLOOR_MAX x median floor ns. PRESSURE is bimodal on this host:
// quiet runs 0.033-0.060 (floor 1.32-1.38 ns), runs under concurrent load (load
// avg ~4.4, another node process) 0.095-0.118 (floor 1.51-1.57 ns) -- there the
// LUT16 hump drowned (3.64 N, SEP 1.90 N). 0.08 makes that a HOST verdict.
// HOT 0.27: quiet calibration max 0.243 (14 runs); foilSubEps (smallest step
// 0.70 ns) reads flat once 7 N > 0.70 ns, i.e. N > 0.100 ns = noise/floor 0.33 at
// the ~0.30 ns floor. The cap must fire BEFORE that flip: 0.243 < 0.27 < 0.33.
// (At 0.4 a loaded host reached 0.336, passed, and printed a false "no teeth".)
const NOISE_FLOOR_MAX = { HOT: 0.27, PRESSURE: 0.08 };
const REPEAT_K = 5;                         // two processes agree within 5 N per cell
const SLOPE_R2_FLOOR = 0.90;
const RESID_K = 3.5;                        // max |fit residual| <= RESID_K x slope
const INTERCEPT_K = 6;                      // |a| <= 6 x slope (6 callbacks worth)
const RISE_K = 20;                          // slope x kmax >= 20 N
// Curvature is SIGN-AWARE: convex (k^2 > 0) is the regression direction.
const CURV_CONVEX_MAX = 0.60;               // curv <= 0.60
const CURV_CONCAVE_MIN = -0.60;             // curv >= -0.60 (per-op override below)
// Pinned per-op shapes (findings, METHODOLOGY). Every other iterator: linear
// residual, all k, curvature in [-0.60, 0.60], R^2 >= 0.90, RESID_K 3.5.
//   forEachMapped: k mod 4 zigzag; the k = 2 mod 4 cells are bimodal run to run
//     (a cell jumps 9 ns), so the gate runs on the stable phase k = 0,4,..,32.
//   forEachArray: concave (curv -0.13..-0.52); residual against the QUADRATIC
//     fit (its concavity is allowed, bounded by its own concave floor -0.75).
const SLOPE_OP = {
  forEachMapped: { phase: 4 },
  forEachArray: { residFit: 'quad', curvMin: -0.75 },
};

// NOT constant time today -- the `~v >>> 0` HeapNumber slow path; S3's
// branchless body fixes it (FB-09). EXPECTED-RED: must stay non-flat.
const EXPECTED_RED = { highestClearBit: 'FB-09/S3' };

const CALIBRATE = process.env.WITNESS_CALIBRATE === '1';
const FAST = process.env.WITNESS_FAST === '1';

const CONST_OPS = [
  'count', 'countMasked', 'countRange', 'lowest', 'highest',
  'nextClearBit', 'highestClearBit', 'has', 'hasAll', 'hasAny',
  'hasNone', 'isEmpty', 'isFull',
];
const ITER_OPS = [
  'forEach', 'forEachArray', 'forEachObject', 'forEachMapped',
  'forEachMappedObject', 'forEachMaskPair', 'forEachMaskDiff', 'forEachMaskUnion',
];
const HOT_FOILS = ['foilKernighan', 'foilEarlyExit', 'foilNaiveLowest', 'foilSet', 'foilSubEps'];

const range = (n) => Array.from({ length: n }, (_, i) => i);
const DENSITY_FULL = range(33);
const DENSITY_FAST = [0, 1, 4, 8, 16, 24, 31, 32];
// position: 0..31 single bit, plus 100 (empty word) and 101 (full word).
const POSITION_FULL = [...range(32), 100, 101];
const POSITION_FAST = [0, 1, 15, 16, 30, 31, 100, 101];
const K_FULL = range(17).map((i) => i * 2);   // 0, 2, ..., 32
const K_FAST = [0, 4, 8, 12, 16, 20, 24, 28, 32];

// per-lane timing config; expensive foils run a shorter outer loop.
const CFG = { HOT: { outer: 512, reps: 4, rounds: 3 }, PRESSURE: { outer: 256, reps: 3, rounds: 5 } };
const FOIL_OUTER = { foilSet: 32, foilKernighan: 128, foilEarlyExit: 128, foilNaiveLowest: 128 };
const SLOPE_OPS = { forEachObject: 30000, forEachMappedObject: 30000, foilIterQuad: 3000, foilIterStep: 60000 };

// ---------------------------------------------------------------------------
export const fails = [];
export const lines = [];
const note = (s) => lines.push(s);
// Once a lane's NOISE precondition fails, that lane has NO verdict: its gate
// failures are relabelled HOST (counted, not reported as findings such as "no
// teeth"). The NOISE failure itself already fails the run.
export const HOST_BAD = { HOT: false, PRESSURE: false };
export const hostSuppressed = [];
export function fail(lane, msg) {
  if (HOST_BAD[lane]) hostSuppressed.push(lane + ': ' + msg);
  else fails.push(msg);
}
const hostTag = (lane, verdict) => (HOST_BAD[lane] ? 'HOST(no verdict: lane NOISE failed)' : verdict);
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : String(x));
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };

function spawn(spec) {
  const full = { ...CFG[spec.lane], ...spec };
  const text = execFileSync(process.execPath, [RUN_ONE, JSON.stringify(full)], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  const res = JSON.parse(text.trim().split('\n').pop());
  // fail closed: every cell finite, arrays aligned to params.
  const P = full.params.length;
  const label = `${full.subject}/${full.op} ${full.lane} ${full.mode}`;
  let ok = Array.isArray(res.net) && res.net.length === P && Array.isArray(res.disp) && res.disp.length === P &&
    Array.isArray(res.floor) && res.floor.length === P;
  if (ok) for (let i = 0; i < P; i++) {
    if (!Number.isFinite(res.net[i]) || !Number.isFinite(res.disp[i]) || !Number.isFinite(res.floor[i])) ok = false;
  }
  if (!ok) fails.push(`${label}: malformed or non-finite result (net/disp/floor must be finite, length ${P})`);
  res.valid = ok;
  res.label = label;
  return res;
}

function printFlags(res) {
  if (res.flags && res.flags.length) note(`      flags ${res.label}: ${res.flags.join(' ')}`);
}

// a cell meaningfully below zero = a broken floor subtraction. NaN fails.
export function negativeCells(net, eps) {
  const bad = [];
  for (let i = 0; i < net.length; i++) if (!(net[i] > -eps)) bad.push(i);
  return bad;
}

export function metrics(net, eps) {
  let mn = Infinity, mx = -Infinity, cmn = Infinity, cmx = -Infinity;
  for (const v of net) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    const c = v > eps ? v : eps;
    if (c < cmn) cmn = c;
    if (c > cmx) cmx = c;
  }
  return { ratio: cmx / cmn, spread: mx - mn, min: mn, max: mx };
}

export const NOISE = { HOT: NaN, PRESSURE: NaN };
export const EPS = { HOT: NaN, PRESSURE: NaN };

export function laneNoise(lane, results) {
  const d = [], fl = [], spreads = [];
  for (const r of results) {
    if (!r.valid) continue;
    for (const v of r.disp) d.push(v);
    for (const v of r.floor) fl.push(v);
    spreads.push(Math.max(...r.net) - Math.min(...r.net));
  }
  const n = median(spreads), floorMed = median(fl);
  const ok = spreads.length > 0 && Number.isFinite(n) && n > 0 && Number.isFinite(floorMed) && !(n > NOISE_FLOOR_MAX[lane] * floorMed);
  note(`  NOISE ${lane.padEnd(8)} ${f3(n)} ns (median cell-to-cell spread of ${spreads.length} real-op rows; pass dispersion median ` +
    `${f3(median(d))} ns), floor ${f3(floorMed)} ns, noise/floor=${f3(n / floorMed)} max=${NOISE_FLOOR_MAX[lane]} ${ok ? 'ok' : 'FAIL'}; ` +
    `EPS=${EPS_K[lane]}N=${f3(EPS_K[lane] * n)} ns`);
  if (!ok) {
    fails.push(`NOISE ${lane}: ${f3(n)} ns vs floor ${f3(floorMed)} -- host too noisy (or invalid) to resolve the claim, or >= 12 real-op rows regressed together`);
    if (!CALIBRATE) HOST_BAD[lane] = true;
  }
  NOISE[lane] = n;
  EPS[lane] = EPS_K[lane] * n;
}

// real op / control: must be flat (ratio AND spread) and have no negative cell.
export function gateFlat(res, name) {
  const lane = res.lane, N = NOISE[lane];
  const m = metrics(res.net, EPS[lane]);
  const neg = negativeCells(res.net, EPS[lane]);
  const ratioGated = Number.isFinite(FLAT_RATIO[lane]);
  const ok = CALIBRATE || (res.valid && !(ratioGated && m.ratio > FLAT_RATIO[lane]) && !(m.spread > SPREAD_K[lane] * N) && neg.length === 0);
  note(`  FLAT ${lane.padEnd(8)} ${name.padEnd(26)} ratio=${f2(m.ratio)}${ratioGated ? '/' + FLAT_RATIO[lane] : '(info)'} spread=${f3(m.spread)}ns=${f2(m.spread / N)}N/${SPREAD_K[lane]}N ` +
    `[${f3(m.min)},${f3(m.max)}] ${ok ? 'ok' : hostTag(lane, 'FAIL')}`);
  printFlags(res);
  if (!ok) {
    fail(lane, `${name} [${lane}] ratio ${f2(m.ratio)} (<= ${FLAT_RATIO[lane]}) spread ${f2(m.spread / N)}N (<= ${SPREAD_K[lane]}N)` +
      (neg.length ? ` negative cells @${neg.map((i) => res.params[i]).join(',')} (<= -EPS)` : ''));
  }
  return m;
}

// foil (or expected-red op): must FAIL flatness by a margin.
export function gateRed(res, name, why) {
  const lane = res.lane, N = NOISE[lane];
  const m = metrics(res.net, EPS[lane]);
  const red = m.spread >= FOIL_SPREAD_K[lane] * N;   // spread-only (see constants)
  const ok = CALIBRATE || (res.valid && red);
  note(`  RED  ${lane.padEnd(8)} ${name.padEnd(26)} ratio=${f2(m.ratio)}(info) spread=${f3(m.spread)}ns=${f2(m.spread / N)}N>=${FOIL_SPREAD_K[lane]}N ` +
    `${ok ? 'ok(non-flat)' : hostTag(lane, 'FAIL(came out flat)')}`);
  if (!ok) fail(lane, why(m));
  return m;
}

// least squares on [1, k] and [1, k, k^2].
function fitLinear(xs, ys) {
  const n = xs.length;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const slope = sxx === 0 ? NaN : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? NaN : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}
function fitQuad(xs, ys) {
  // normal equations, 3x3, Gaussian elimination.
  const S = [0, 0, 0, 0, 0], T = [0, 0, 0];
  for (let i = 0; i < xs.length; i++) {
    let p = 1;
    for (let k = 0; k < 5; k++) { S[k] += p; if (k < 3) T[k] += p * ys[i]; p *= xs[i]; }
  }
  const A = [[S[0], S[1], S[2], T[0]], [S[1], S[2], S[3], T[1]], [S[2], S[3], S[4], T[2]]];
  for (let c = 0; c < 3; c++) {
    for (let r = c + 1; r < 3; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = A[r][3];
    for (let k = r + 1; k < 3; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return { c0: x[0], c1: x[1], c2: x[2] };
}

export function slopeMetrics(ks, net, residFit) {
  const lin = fitLinear(ks, net);
  const q = fitQuad(ks, net);
  const K = ks[ks.length - 1];
  const rise = q.c1 * K + q.c2 * K * K;          // fitted y(K) - y(0)
  const curv = (q.c2 * K * K) / rise;            // share of the rise owed to k^2
  let maxResid = 0;                              // NaN-safe: a NaN residual -> NaN
  for (let i = 0; i < ks.length; i++) {
    const fit = residFit === 'quad' ? q.c0 + q.c1 * ks[i] + q.c2 * ks[i] * ks[i] : lin.intercept + lin.slope * ks[i];
    const r = Math.abs(net[i] - fit);
    if (!(r <= maxResid)) maxResid = r;
  }
  return { ...lin, curv, K, maxResid };
}

// Pure slope verdict (exported for the synthetic-series checks). `N` = NOISE HOT.
export function slopeVerdict(name, ksAll, netAll, N) {
  const cfg = SLOPE_OP[name] || {};
  let ks = ksAll, net = netAll;
  if (cfg.phase) {
    ks = []; net = [];
    for (let i = 0; i < ksAll.length; i++) if (ksAll[i] % cfg.phase === 0) { ks.push(ksAll[i]); net.push(netAll[i]); }
  }
  const s = slopeMetrics(ks, net, cfg.residFit);
  const checks = {
    r2: s.r2 >= SLOPE_R2_FLOOR,
    resid: s.maxResid <= RESID_K * s.slope,
    rise: s.slope * s.K >= RISE_K * N,
    icpt: Math.abs(s.intercept) <= INTERCEPT_K * s.slope,
    curv: s.curv <= CURV_CONVEX_MAX && s.curv >= (cfg.curvMin !== undefined ? cfg.curvMin : CURV_CONCAVE_MIN),
  };
  const linear = Object.values(checks).every((v) => v === true);
  return { s, checks, linear, cfg };
}

export function gateSlope(res, name, expectRed) {
  const N = NOISE.HOT;
  const { s, checks, linear, cfg } = slopeVerdict(name, res.params, res.net, N);
  const ok = CALIBRATE || (res.valid && (expectRed ? !linear : linear));
  const failed = Object.keys(checks).filter((k) => !checks[k]);
  const shape = cfg.phase ? ` [k=0 mod ${cfg.phase}]` : (cfg.residFit ? ` [${cfg.residFit} resid]` : '');
  note(`  SLOPE ${res.lane.padEnd(7)} ${(name + shape).padEnd(26)} r2=${s.r2.toFixed(4)} slope=${f3(s.slope)} a=${f3(s.intercept)}=${f2(s.intercept / s.slope)}xslope ` +
    `rise=${f2(s.slope * s.K / N)}N curv=${f3(s.curv)} resid=${f3(s.maxResid)}ns=${f2(s.maxResid / s.slope)}xslope ` +
    (expectRed ? (ok ? `ok(foil rejected by: ${failed.join(',')})` : hostTag('HOT', 'FAIL(foil passed as linear)')) : (ok ? 'ok' : hostTag('HOT', `FAIL(${failed.join(',')})`))));
  printFlags(res);
  if (!ok) fail('HOT', expectRed ? `SLOPE foil ${name} passed as linear -- the slope gate has no teeth`
    : `SLOPE ${name}: ${failed.join(',')} (r2=${s.r2.toFixed(4)} a/slope=${f2(s.intercept / s.slope)} curv=${f3(s.curv)} rise=${f2(s.slope * s.K / N)}N)`);
  return s;
}

const TABLE = {}; // RESEARCH section 2 popcount table

function run() {
  const t0 = Date.now();
  // advisory only (not a gate): the NOISE precondition is the gate.
  const la = loadavg()[0];
  note(`  (advisory) load average ${la.toFixed(2)}${la > 2 ? ' -- busy host: expect a HOST verdict (NOISE precondition), not a finding' : ''}`);
  const lanes = FAST ? ['HOT'] : ['HOT', 'PRESSURE'];

  for (const lane of lanes) {
    const dens = FAST ? DENSITY_FAST : DENSITY_FULL;
    const pos = FAST ? POSITION_FAST : POSITION_FULL;
    // 1. measure every real-op cell of the lane.
    const real = [];
    const red = [];
    for (const op of CONST_OPS) {
      for (const [mode, params] of [['density', dens], ['position', pos]]) {
        const r = spawn({ subject: 'fb', op, lane, mode, params });
        (EXPECTED_RED[op] ? red : real).push(r);
        if (op === 'count' && mode === 'density') TABLE['SWAR ' + lane] = r;
      }
    }
    // 2. this run's noise -> EPS.
    note(`--- lane ${lane} ---`);
    laneNoise(lane, real);
    // 3. gate the real ops.
    let worstSpread = { density: 0, position: 0 };
    for (const r of real) {
      const m = gateFlat(r, `${r.op} (${r.mode})`);
      if (m.spread > worstSpread[r.mode]) worstSpread[r.mode] = m.spread;
    }
    // 4. EXPECTED-RED highestClearBit: pinned non-flat until S3 flips it.
    for (const r of red) {
      gateRed(r, `${r.op} (${r.mode}) todo:${EXPECTED_RED[r.op]}`,
        (m) => `expected-red highestClearBit [${lane} ${r.mode}] came out flat (ratio ${f2(m.ratio)}, spread ${f2(m.spread / NOISE[lane])}N) -- flip in S3`);
      printFlags(r);
    }
    // 5. same-corpus control: the harness's own null must be flat at d0/d32 too.
    for (const [mode, params] of [['density', dens], ['position', pos]]) {
      gateFlat(spawn({ subject: 'ctlRead', op: 'ctlRead', lane, mode, params }), `ctlRead (${mode}) [control]`);
    }
    // 6. foils.
    if (lane === 'HOT') {
      for (const f of HOT_FOILS) {
        const r = spawn({ subject: f, op: 'count', lane, mode: 'density', params: dens, outer: FOIL_OUTER[f] || CFG.HOT.outer });
        gateRed(r, `${f} (density)`, (m) => `FOIL ${f} [HOT] ratio ${f2(m.ratio)} spread ${f2(m.spread / NOISE.HOT)}N -- the gate has no teeth`);
        if (f === 'foilKernighan') TABLE['Kernighan HOT'] = r;
      }
      // the sub-EPS foil in the position sweep too (its step is on the full word).
      const sp = spawn({ subject: 'foilSubEps', op: 'count', lane, mode: 'position', params: pos });
      gateRed(sp, 'foilSubEps (position)', (m) => `FOIL foilSubEps [HOT position] ratio ${f2(m.ratio)} spread ${f2(m.spread / NOISE.HOT)}N -- the gate has no teeth`);
      if (!FAST) TABLE['LUT16 HOT'] = spawn({ subject: 'foilLut16', op: 'count', lane, mode: 'density', params: dens });
      if (TABLE['LUT16 HOT']) {
        const m = metrics(TABLE['LUT16 HOT'].net, EPS.HOT);
        note(`  (info) foilLut16 HOT ratio=${f2(m.ratio)} spread=${f2(m.spread / NOISE.HOT)}N (flat when L1-hot)`);
      }
    } else {
      const r = spawn({ subject: 'foilLut16', op: 'count', lane, mode: 'density', params: dens });
      TABLE['LUT16 PRESSURE'] = r;
      const m = gateRed(r, 'foilLut16 (density)', (mm) => `FOIL foilLut16 [PRESSURE] ratio ${f2(mm.ratio)} spread ${f2(mm.spread / NOISE.PRESSURE)}N -- the gate has no teeth`);
      const margin = (m.spread - worstSpread.density) / NOISE.PRESSURE;
      const okM = CALIBRATE || margin >= MARGIN_K_PRESSURE;
      note(`  SEP  PRESSURE foilLut16 spread - worst real-op density spread = ${f3(m.spread - worstSpread.density)}ns = ${f2(margin)}N >= ${MARGIN_K_PRESSURE}N ${okM ? 'ok' : hostTag('PRESSURE', 'FAIL')}`);
      if (!okM) fail('PRESSURE', `PRESSURE separation: LUT16 spread beats the worst real op by only ${f2(margin)}N (< ${MARGIN_K_PRESSURE}N) -- not resolvable on this run`);
      const k = spawn({ subject: 'foilKernighan', op: 'count', lane, mode: 'density', params: dens, outer: FOIL_OUTER.foilKernighan });
      TABLE['Kernighan PRESSURE'] = k;
      gateRed(k, 'foilKernighan (density)', (mm) => `FOIL foilKernighan [PRESSURE] ratio ${f2(mm.ratio)} spread ${f2(mm.spread / NOISE.PRESSURE)}N`);
      const se = spawn({ subject: 'foilSubEps', op: 'count', lane, mode: 'density', params: dens });
      const ms = metrics(se.net, EPS.PRESSURE);
      note(`  (info) foilSubEps PRESSURE ratio=${f2(ms.ratio)} spread=${f2(ms.spread / NOISE.PRESSURE)}N (a ~0.7 ns HOT ALU step hides under the stream: not a PRESSURE foil)`);
    }
    // 7. broken-floor control: a heavier floor MUST trip the negative-cell gate.
    const bf = spawn({ subject: 'ctlRead', op: 'ctlRead', lane, mode: 'density', params: [8, 16], floor: 'foilKernighan' });
    const negBf = negativeCells(bf.net, EPS[lane]);
    const okBf = CALIBRATE || negBf.length === bf.params.length;
    note(`  CTRL ${lane.padEnd(8)} broken-floor (Kernighan floor) net=[${bf.net.map(f3).join(',')}] negative-cell gate ${okBf ? 'fired ok' : 'FAIL(did not fire)'}`);
    if (!okBf) fail(lane, `broken-floor control [${lane}]: the negative-cell gate did not fire -- no teeth`);
  }

  // --- self-check: a repeated cell agrees across TWO processes ---------------
  const rp = { subject: 'fb', op: 'count', lane: 'HOT', mode: 'density', params: [4, 8, 16] };
  const a = spawn(rp), b = spawn(rp);
  const tol = REPEAT_K * NOISE.HOT;
  const diffs = a.net.map((v, i) => Math.abs(v - b.net[i]));
  const okR = CALIBRATE || diffs.every((d) => d <= tol);
  note(`  SELF repeat count@d4,8,16 two processes |a-b|=[${diffs.map(f3).join(',')}] tol=${REPEAT_K}N=${f3(tol)} ${okR ? 'ok' : 'FAIL'}`);
  if (!okR) fail('HOT', `self-check: repeated cell drift [${diffs.map(f3).join(',')}] > ${f3(tol)}`);
  // its control: two DIFFERENT cells (count vs Kernighan) must disagree.
  const c = spawn({ ...rp, subject: 'foilKernighan', outer: FOIL_OUTER.foilKernighan });
  const cd = a.net.map((v, i) => Math.abs(v - c.net[i]));
  const okC = CALIBRATE || cd.some((d) => d > tol);
  note(`  CTRL self-check control count vs Kernighan |a-c|=[${cd.map(f3).join(',')}] ${okC ? 'disagrees ok' : 'FAIL(agreed)'}`);
  if (!okC) fail('HOT', 'self-check control: two different cells agreed -- the repeat check has no teeth');

  // --- iteration slope (O(k)) for forEach + the 7 free iterators + 2 foils ---
  note('--- slope HOT ---');
  const iterOps = FAST ? ['forEach', 'forEachMaskUnion'] : ITER_OPS;
  const ks = FAST ? K_FAST : K_FULL;
  for (const op of iterOps) {
    const s = spawn({ subject: 'fb', op, lane: 'HOT', mode: 'slope', params: ks, ops: SLOPE_OPS[op] || 150000, reps: 3 });
    gateSlope(s, op, false);
  }
  for (const f of ['foilIterQuad', 'foilIterScan32', 'foilIterStep']) {
    const s = spawn({ subject: f, op: f, lane: 'HOT', mode: 'slope', params: ks, ops: SLOPE_OPS[f] || 150000, reps: 3 });
    gateSlope(s, f, true);
  }
  if (!FAST) {
    const s = spawn({ subject: 'fb', op: 'forEach', lane: 'PRESSURE', mode: 'slope', params: K_FAST, ops: 200000 });
    const m = slopeMetrics(s.params, s.net);
    note(`  (info) forEach PRESSURE r2=${m.r2.toFixed(4)} slope=${f3(m.slope)} a=${f3(m.intercept)} curv=${f3(m.curv)}`);
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  note('');
  note(`witness ${FAST ? 'FAST ' : ''}${CALIBRATE ? 'CALIBRATE ' : ''}done in ${secs}s -- ${fails.length === 0 ? 'ok' : fails.length + ' FAIL'}`);

  if (hostSuppressed.length) {
    note(`HOST: ${hostSuppressed.length} gate line(s) in a lane whose NOISE precondition failed have NO verdict (not findings):`);
    for (const h of hostSuppressed) note('  (host) ' + h);
  }
  if (!FAST) emitResearchTable();
  process.stdout.write(lines.join('\n') + '\n');
  if (!CALIBRATE && fails.length) {
    process.stdout.write('\nFAILURES:\n' + fails.map((f) => '  ' + f).join('\n') + '\n');
    process.exitCode = 1;
  }
}

function emitResearchTable() {
  note('\n--- RESEARCH section 2 popcount table (net ns/op, median of passes) ---');
  const fmt = (r) => (r ? r.params.map((p, i) => `d${p}:${r.net[i].toFixed(2)}`).join(' ') : '(none)');
  for (const k of ['SWAR HOT', 'SWAR PRESSURE', 'LUT16 HOT', 'LUT16 PRESSURE', 'Kernighan HOT', 'Kernighan PRESSURE']) {
    note(k.padEnd(19) + fmt(TABLE[k]));
  }
}

// run only as the entry point; importing (synthetic-series checks) only exports.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
