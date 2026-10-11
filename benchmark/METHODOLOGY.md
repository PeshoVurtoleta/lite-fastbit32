# lite-fastbit32 benchmark + witness methodology

Multi-word bitset libraries (fastbitset, typedfastbitset, bitset) are compared on
their 32-bit subset only; all competitor numbers live in the S2b matrix, not here.
This file records the S2a measurement machinery: the constant-time witness and the
two settle-call experiments (SC-1 scans, SC-2 representation). None of them edit
`FastBit32.js` -- S2 is measurement; S3/S6 apply the decisions.

Calibrated 2026-10-10 on node v26.8.2, Apple M4 Pro (darwin) -- the S2a rework
after the reviewer's REJECT. **No absolute-ns constant gates.** Every bound is a
dimensionless ratio or a multiple of the run's OWN measured noise, so the
constants carry across machines; the RESOLUTION does not (a noisier host measures
a larger noise and gets a coarser gate, and the foils keep that coarseness from
passing). Absolute ns are printed for orientation only.

## The harness rule (RESEARCH section 2)

A subject is timed behind a MONOMORPHIC call site in its OWN process
(`test/witness/run-one.mjs`, one subject x op x lane). A shared `bench(fn)` site
does not inline -- the first ad-hoc probe read SWAR at ~4 ns (mostly call
overhead); inlined it is ~0.4 ns. So every op is a LITERAL expression compiled
into a dedicated loop; no function is passed in and called.

Per cell: 3 passes HOT (best-of-4 each) / 5 passes PRESSURE (best-of-3 each),
except the SLOT_SLOW rows below; in
each pass the op loop and an empty-loop FLOOR on the same corpus are timed with
their reps INTERLEAVED (op, floor, op, floor, ...)
so drift hits both sides of the subtraction. net = MEDIAN of the per-pass nets;
`disp` = range of the per-pass nets. Every result is XORed into an Int32Array sink
so a dead-code-eliminated loop cannot read ~0 silently. Every cell whose net is
<= 0 or non-finite is FLAGGED in run-one's output and the driver PRINTS every flag
(28 flagged rows per full run, almost all PRESSURE -- see the bias below); the
driver also requires every cell finite and every array aligned to `params`, and
FAILS any cell with `!(net > -EPS)` (meaningfully negative = broken floor
subtraction). Nothing is clamped silently: the EPS clamp exists only inside the
ratio metric, and the unclamped spread is gated next to it.

Harness fixes found in this rework (each changed the numbers):
- **Booleans are consumed branch-free (`|0`).** The old `r = inst.has(17) ? 1 : 0`
  compiled to a branch in the HARNESS that mispredicts on mixed corpora: `has`
  read a 0.57 ns density hump (0.11 -> 0.69 -> 0.13 ns) that `has(17) | 0` does not
  have (spread 0.04 ns). The old absolute 0.8 ns clamp hid it.
- **The stream index stays int32 and persists.** The old `si += 4099` left int32
  after ~524k iterations and deopted the PRESSURE loop to double arithmetic;
  restarting `si` at 0 every call also made the touched footprint scale with the
  loop length (floor 0.98 ns at outer=128 vs 1.34 ns at outer=1024). Now
  `si = (si + 4099) & SMASK`, kept in a slot across calls.
- **The driver spawns `process.execPath`**, not `node` from PATH.

Two cache lanes:
- **HOT** -- a tight loop over a 2048-word corpus; the op's own work only.
- **PRESSURE** -- the same, but each iteration also streams a 32 MB `Int32Array`
  at a 4099-word (prime) stride, in BOTH the op loop and the floor loop.

**Finding -- the PRESSURE floor subtraction carries a negative bias.** Under the
stream the loop is memory-bound and an op's ALU work hides in the load shadow;
the op loop then runs slightly FASTER than the empty loop (real-op cells down to
-0.48 ns in the reviewer's rounds-3 runs; -0.17 ns worst in the 8 quiet rounds-5
calibration runs, -0.32 ns under host load; it persists with every floor variant tried:
`r=w`, `r=inst.value`, `r=(w+1)|0`). So PRESSURE nets are RELATIVE across cells,
not absolute costs, and a dead-code-eliminated op would be indistinguishable from
a real one in this lane -- the HOT lane is the proof that the work is done (every
real-op HOT cell > 0). The PRESSURE EPS is sized to cover the bias (below).

## The witness gate (`test/witness.mjs`)

The anchor: every hot op runs in the SAME time for every input word.

- **NOISE(lane)** = median cell-to-cell spread (max - min net) over the lane's 44
  real-op rows (22 flat ops x density + position; 24 rows at S2a). In PRESSURE,
  density rows contribute their d1..d31 spread (see "PRESSURE density d0/d32").
  The per-cell pass dispersion
  is printed next to it but is NOT the comparator: it ran 0.015-0.033 ns HOT while
  single cells sat ~0.1 ns off their row for a whole process (corpus / JIT
  placement), so a dispersion-scaled gate failed clean runs.
- **The self-reference fails open only inside a bounded window.** The foils are
  judged in the same units, but foilSubEps has a fixed ~0.7 ns step: NOISE HOT
  can inflate ~1.5-2x (to ~0.1 ns, where 7 N passes the step) before that foil reads
  flat and fails the run, and the median only inflates if >= 19 of the 38 real-op
  rows regress together. Inside that window a common regression of up to ~0.1 ns
  per op could pass, and one op is then allowed SPREAD_K x NOISE = 6 N ~ 0.6 ns
  of spread. NOISE must also be finite, > 0 and <= NOISE_FLOOR_MAX x the lane's
  median floor ns; the failure message says "host too noisy ... or >= 19 real-op
  rows regressed together".
- **Host verdict.** NOISE_FLOOR_MAX HOT = 0.27 is derived so the precondition
  fires BEFORE foilSubEps can flip: quiet calibration max 0.243 (14 runs);
  foilSubEps (smallest step 0.70 ns) reads flat once 7 N > 0.70 ns, i.e. N >
  0.100 ns = noise/floor ~0.33 at the ~0.30 ns floor; 0.243 < 0.27 < 0.33. (At
  the old 0.4 a host at load 6-11 read 0.336, passed, and printed a false "the
  gate has no teeth".) Once a lane's NOISE check fails, every other gate line of
  that lane prints `HOST(no verdict: lane NOISE failed)` and is listed under
  "HOST ... (not findings)", never under FAILURES; the NOISE failure alone fails
  the run. Shown on a scratch copy (cap forced to 0.01, foil floor to 1000 N):
  exit 1, FAILURES = the NOISE line only, 8 foil lines relabelled HOST. An
  advisory `os.loadavg()` line is printed up front (not a gate).
- **EPS(lane)** = EPS_K x NOISE: the ratio clamp AND the negative-cell bound.
- **HOT**: a real op must pass ratio (max/min, cells clamped up to EPS) AND
  spread (unclamped max - min, in N) and have no cell <= -EPS. A foil's verdict
  is spread-only (>= FOIL_SPREAD_K x N): the former "ratio >= 3 OR spread" was
  exactly "spread >= 7 N", since with EPS = 4 N a ratio >= 3 implies spread >= 8 N.
- **PRESSURE**: spread is the flatness gate (plus the negative-cell bound). There
  is no ratio gate: EPS = 7 N clamps every real cell, so the ratio reads 1.00
  always and could never bind -- it is printed as info.
- **slope** (O(k) iterators, HOT): least squares; R^2 >= 0.90, two-sided
  `|intercept| <= INTERCEPT_K x slope`, `slope x kmax >= RISE_K x NOISE`,
  SIGN-AWARE curvature `-0.60 <= curv <= 0.60` (the share of the fitted rise owed
  to the k^2 term of a quadratic fit; convex is the regression direction), and
  **max |residual| <= RESID_K x slope**, the same for all eight iterators. Two
  pinned shapes change WHAT is fitted, not the floors: forEachMapped is gated on
  its stable phase k = 0, 4, .., 32; forEachArray's residual is taken against the
  quadratic fit and its concave floor is -0.75.
  The residual is in per-bit (slope) units, not N: iterator jitter scales with
  the per-bit cost (0.46-7.4 ns/bit) and the scalar NOISE (~0.05 ns) is ~100x
  below it.

Sweeps (full run): density 0..32 and position 0..31 + {empty, full} for the 22
constant-time ops (13 at S2a) in BOTH lanes -- empty/full are gated in PRESSURE
too (the old "endpoint artifact" was the deopted stream index); PRESSURE density
rows are gated over d1..d31 and d0/d32 print as INFO (one-word corpora, see
"PRESSURE density d0/d32"). Slopes: k = 0, 2,
.., 32 for `forEach` and the 7 free iterators.

### Frozen floors (calibration + margin, D-02 pattern)

PRESSURE basis: 8 full `WITNESS_CALIBRATE=1` runs at the current config
(PRESSURE 5 passes x best-of-3; 84.8-87.6 s each) on a quiet host. HOT and slope
basis: the same 8 runs plus the 6 round-1 runs. Ranges are min..max. N =
NOISE(lane).

| Constant | Value | Calibration basis (headroom) |
| --- | --- | --- |
| NOISE HOT / PRESSURE | measured per run | 0.038-0.073 ns / 0.046-0.081 ns (5 passes halved PRESSURE from 0.099-0.154) |
| `NOISE_FLOOR_MAX` HOT | 0.27 | quiet noise/floor <= 0.243; foilSubEps flips at ~0.33 |
| `NOISE_FLOOR_MAX` PRESSURE | 0.08 | quiet 0.033-0.060 (floor 1.32-1.38 ns); loaded 0.095-0.118 (floor 1.31-1.57 ns) -- all-cell NOISE basis (2026-10-10); since 2026-10-11 PRESSURE NOISE is over d1..d31 (11-25% lower, 7 runs), so the cap is more lenient than calibrated; not recalibrated |
| `EPS_K` HOT | 4 | real-op HOT ratio <= 1.86 |
| `EPS_K` PRESSURE | 7 | worst real cell -0.167 ns = -3.6 N (1.9x) |
| `FLAT_RATIO` HOT | 2.5 | real ops <= 1.86 (1.34x) |
| `FLAT_RATIO` PRESSURE | none | EPS clamps every real cell to 1.00; spread is the gate |
| `SPREAD_K` HOT | 6 | real ops <= 3.86 N (1.55x) |
| `SPREAD_K` PRESSURE | 4.5 | real ops <= 3.50 N (countMasked density) (1.29x) |
| `FOIL_SPREAD_K` HOT | 7 | foilSubEps 9.34-19.96 N (1.33x), other foils >= 77.5 N |
| `FOIL_SPREAD_K` PRESSURE | 5.5 | LUT16 8.82-18.91 N (1.6x), all-cell basis (2026-10-10); over d1..d31 since 2026-10-11: 6.86-11.20 N (1.25x, 7 runs) |
| `MARGIN_K_PRESSURE` | 2 | SEP (LUT16 - worst real-op density spread) 6.89-15.40 N (3.4x), all-cell basis; over d1..d31 since 2026-10-11: 3.86-9.27 N (1.93x, 7 runs) |
| `REPEAT_K` | 5 | two processes, count d4/d8/d16: \|a-b\| <= 0.137 ns (5 N = 0.19-0.37 ns); control >= 0.535 ns |
| `SLOPE_R2_FLOOR` | 0.90 (all) | 6 plain iterators >= 0.954; forEachMapped phase 0 >= 0.995; forEachArray >= 0.978 |
| `RESID_K` | 3.5 (all) | 6 plain <= 2.57 x slope; forEachMapped phase 0 <= 1.28; forEachArray (quadratic) <= 2.85; foilIterStep 4.51-5.13 |
| `SLOPE_OP` | forEachMapped phase 4; forEachArray quad resid, concave floor -0.75 | see Findings |
| `INTERCEPT_K` | 6 | real \|a\|/slope <= 4.59 (forEachArray); foilIterScan32 29.7-42.7 |
| curvature | [-0.60, 0.60]; forEachArray [-0.75, 0.60] | plain -0.09..+0.24; forEachArray -0.22..-0.52; foilIterQuad 0.953-0.980; convex regression 0.64 |
| `RISE_K` | 20 | real rise >= 190 N |

Per-run calibration (PRESSURE, 8 quiet runs, rounds 5):

| run | NOISE P (ns) | worst real spread (N) | worst cell (ns) | LUT16 (N) | SEP (N) | NOISE H (ns) | worst real H (N) | foilSubEps H (N) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| c1 | 0.054 | 2.37 countRange d | -0.119 | 11.64 | 9.26 | 0.046 | 2.92 | 14.11-14.87 |
| c2 | 0.081 | 2.07 hasAll p | -0.156 | 8.82 | 6.89 | 0.073 | 1.97 | 9.34-10.00 |
| c3 | 0.046 | 3.50 countMasked d | -0.167 | 18.91 | 15.40 | 0.038 | 3.17 | 19.92-19.96 |
| c4 | 0.053 | 3.33 countMasked d | -0.165 | 12.25 | 8.92 | 0.051 | 2.68 | 14.72-14.81 |
| c5 | 0.053 | 3.46 countRange d | -0.137 | 11.70 | 8.24 | 0.058 | 1.69 | 12.90-12.93 |
| c6 | 0.050 | 2.75 countMasked d | -0.135 | 11.92 | 9.17 | 0.057 | 2.04 | 11.12-12.96 |
| c7 | 0.052 | 3.21 countMasked d | -0.141 | 12.98 | 9.77 | 0.053 | 2.37 | 14.27-14.34 |
| c8 | 0.051 | 3.19 countRange d | -0.139 | 14.37 | 11.18 | 0.049 | 2.45 | 12.76-15.28 |

**Host-load finding.** The PRESSURE lane is sensitive to concurrent memory
traffic. Six gated runs taken while another session ran a soak benchmark (load
average 4.4-6.2) read PRESSURE NOISE 0.092-0.179 ns, and in one of them the LUT16
hump drowned (3.64 N, SEP 1.90 N). `NOISE_FLOOR_MAX` PRESSURE = 0.08 turns that
state into an explicit HOST verdict ("host too noisy") instead of a false foil
reading. **The full witness needs a quiet host.** Under that load the two
confirming runs read: run A exit 0 (NOISE P 0.092 ns, noise/floor 0.070, real
spread <= 2.44 N, LUT16 7.03 N, SEP 4.59 N); run B exit 1 on the host verdict only
(noise/floor 0.095 > 0.08; its LUT16 6.28 N and SEP 4.47 N still separated).
`witness:fast` is HOT-only and is unaffected.

### Teeth (each must FAIL; a foil that passes fails the run)

| Foil / control | Lane | Measured (8 calibration runs) | Mechanism |
| --- | --- | --- | --- |
| Kernighan `v &= v - 1` | HOT + PRESSURE | ratio 11.5-15.3, 113-218 N / 84.6-174.8 N | O(popcount) |
| 32-shift early-exit popcount | HOT | ratio 13.2-16.1, 120-242 N | highest set bit |
| naive forward lowest scan | HOT | ratio 9.6-13.6, 77.5-156 N | lowest set bit |
| `Set<number>` by iteration | HOT | ratio 13.5-15.0, 335-652 N | O(popcount) + iterator |
| foilSubEps (one imul on the full word) | HOT | 9.34-19.96 N, step ~0.7-0.8 ns | sub-old-EPS data dependence |
| 16-bit LUT (64 KB), 2 loads | PRESSURE | 8.82-18.91 N, SEP 6.89-15.40 N all-cell basis; over d1..d31 6.86-11.20 N, SEP 3.86-9.27 N, 7 runs (HOT: flat) | mixed words miss; 0x0000/0xFFFF stay cached |
| foilIterQuad | slope | curv 0.953-0.980 | O(k^2) callbacks |
| foilIterScan32 | slope | a/slope 29.7-42.7 | fixed 32-step scan |
| foilIterStep | slope | resid 4.51-5.13 x slope (R^2 0.915-0.936, \|curv\| <= 0.19) | forEach + 16 callbacks at k >= 16 |
| ctlRead (same-corpus null) | both | must be FLAT: <= 2.62 N | harness endpoint check |
| broken floor (Kernighan as floor) | both | net -1.5..-4.9 ns -> negative-cell gate fires | subtraction break |
| self-check control (count vs Kernighan) | HOT | \|a-c\| >= 0.535 ns > tol | repeat check teeth |

foilIterStep is the reviewer's case: a 16 ns step at k >= 16 passes R^2 >= 0.90
and the curvature bound; only the residual check catches it. Its first gated run
caught a bug in the gate itself (the residual check was computed but left out of
the verdict -> "FAIL(foil passed as linear)"); fixed, the foil reads
"rejected by: resid".

The old gate's blindness, measured: foilSubEps under the old absolute clamp reads
(0.95 clamp 0.8) / (0.20 clamp 0.8) = 1.19 < old FLAT_HOT 2.8 -> "flat"; the old
slope gate (one-sided `a <= 3.0`) passed foilIterQuad (R^2 0.93, a = -160).

Gates shown able to fail (scratch copies, never the tree): the S3 body
`31 - Math.clz32(~v)` in FastBit32 -> expected-red highestClearBit "came out flat
-- flip in S3" (ratio 1.00, spread 0.63 / 1.39 N, 2 FAIL); `foilLut16` replaced by
SWAR -> LUT16 FAIL(came out flat) 0.92 N and SEP -0.63 N FAIL; `NOISE_FLOOR_MAX`
exceeded -> NOISE FAIL (and live, under host load, above).

### PRESSURE resolution

The LUT16 claim IS resolvable on a quiet host: its density hump (d0 ~0, d1/d31
~0.3 ns, mid densities 0.5-0.8 ns; gated over d1..d31 since 2026-10-11: 6.86-11.20
N, SEP 3.86-9.27 N in 7 runs) beats the worst real-op spread by 6.89-15.40 N in the 8
calibration runs. A ~0.7 ns ALU step (foilSubEps) is NOT resolvable in PRESSURE
(2.07-4.20 N, inside the real-op band): it hides under the stream. PRESSURE
resolves cache behaviour, not ALU work; HOT resolves ALU work.

### Expected-red -- highestClearBit is NOT constant time (FB-09/S3)

`highestClearBit`'s body `~this.value >>> 0` makes a HeapNumber for every word
with bit 31 clear, and `31 - Math.clz32(thatDouble)` then runs a data-dependent
slow path: HOT spread 40-135 N (ratio 5.0-7.2), PRESSURE 17.6-89 N (SC-1 below
gives the absolute cost). The branchless RESEARCH-7 body `31 - Math.clz32(~v)` is
flat. The witness PINS it red in HOT and PRESSURE, density and position: if it
reads flat the run FAILS ("flip in S3"). S3 removes the pin deliberately.

### Findings -- forEachMapped zigzag, forEachArray concavity, step resolution

`forEachMapped`'s per-k cost zigzags with k mod 4, and the k = 2 mod 4 cells are
BIMODAL run to run (in 4 fresh series one cell jumped 10.5 -> 19.3 ns, another
4.5 -> 7.2 ns), so no floor on all 17 points is both stable and tight (the
round-2 per-op floors R^2 0.80 / residual 10 x slope let a step of up to 64
callbacks at k >= 16 through). The gate now runs on the stable phase k = 0, 4,
.., 32 only (R^2 >= 0.995, residual <= 1.28 x slope, curvature -0.13..-0.16)
under the common floors. The phase-2 cells are still measured and printed; their
instability is the finding (cause not investigated). `forEachArray` is concave
(curvature -0.22..-0.52): its residual is taken against the quadratic fit
(<= 2.85 x slope) under the common RESID_K 3.5, with a concave floor of -0.75;
convex curvature is held to 0.60 like every other iterator.

Synthetic-series evidence (round 3): `slopeVerdict` is exported from
`test/witness.mjs` and fed 4 fresh measured series per iterator (run-one, HOT, k
= 0, 2, .., 32) plus injected shapes. Every real series passes. The convex
regression `0.3 + 0.9k + 0.05k^2` (curvature 0.64) goes red for all eight (by
curvature). Step resolution = the smallest step at k >= t that turns ALL 4
series red (0.1 ns grid; no larger step up to 200 ns passes), in ns and
[callbacks = step / slope]:

| iterator | k >= 8 | k >= 16 | k >= 24 | k >= 30 |
| --- | --- | --- | --- | --- |
| forEach | 9.7 [9.8] | 11.8 [11.9] | 8.3 [8.4] | 6.2 [6.2] |
| forEachArray | 4.6 [10.2] | 4.2 [9.3] | 7.0 [15.6] | 3.1 [6.9] |
| forEachObject | 40.9 [9.4] | 53.7 [12.4] | 35.6 [8.2] | 24.6 [5.7] |
| forEachMapped | 5.8 [8.1] | 7.0 [9.7] | 9.2 [12.8] | 6.1 [8.5] |
| forEachMappedObject | 65.2 [9.6] | 75.6 [11.1] | 72.0 [10.6] | 44.9 [6.6] |
| forEachMaskPair | 8.8 [8.8] | 10.3 [10.3] | 9.0 [9.0] | 7.0 [7.0] |
| forEachMaskDiff | 10.0 [10.1] | 11.7 [11.8] | 9.6 [9.7] | 5.8 [5.9] |
| forEachMaskUnion | 9.8 [9.9] | 11.1 [11.2] | 9.6 [9.7] | 7.0 [7.1] |

So every iterator catches a mid-k step of about 6-16 callbacks' worth, by the
residual check (forEachArray at k >= 8 by curvature). The reviewer's holes are
closed: forEachMapped + 16 / 32 / 64 callbacks at k >= 16 -> red (resid; resid +
R^2); forEachArray + 10 / 16 callbacks at k >= 16 -> red (resid), where the
round-2 floor first caught 31.

### Verify integration

`npm run verify` runs `witness:fast` (HOT lane only; density 8 cells, position 8
cells; the 4 HOT foils + foilSubEps; ctlRead; broken-floor and self-check
controls; forEach + forEachMaskUnion + the three iterator foils): ~10 s. The full
`npm run witness` (both lanes, full sweeps incl. the PRESSURE position sweep,
all 8 iterators, the RESEARCH table) is 85-94 s and stays out of verify: it is
timing-heavy and needs a quiet host. The PRESSURE position sweep and the LUT16
PRESSURE teeth are proven by the full run only.

## SC-1 -- guarded `clz32 ^ 31` vs branchless `31 - clz32`
(`benchmark/experiments/sc1-scans.mjs`, scratch bodies, RESEARCH section 7)

Self-check first: the two variants agree on 5006 words incl 0, -1, 2^31 (0
mismatches -- the precondition for comparing speed). ns/op, floor-subtracted,
median of 3 passes (each best of 5, floor/guarded/branchless interleaved), over
empty-heavy (90% zero) / full-heavy (90% -1) / random corpora, both lanes. The
noise column is the range of the per-pass gaps; a gap inside it is `sub-noise`.

Result (`npm run bench:sc1`, node v26.8.2, 2026-10-10):
- `lowest` / `highest` / `nextClearBit`: gaps -0.064..+0.121 ns. HOT: branchless
  faster in 7 of 9 cells (+0.031..+0.121 ns), 2 sub-noise. PRESSURE: 7 of 9
  sub-noise, one +0.058 ns (branchless faster), one -0.064 ns (guarded faster).
  9 of 18 cells sub-noise overall. Uniformity, not speed, is the argument.
- `highestClearBit`: guarded **26.9 ns (empty-heavy) / 29.8 ns (random) HOT,
  46.5-64.4 ns PRESSURE**, 0.93 ns HOT on full-heavy (90% of words take the
  `inv === 0` exit) vs branchless ~0.01-0.05 ns HOT / ~0.19-0.37 ns PRESSURE (qa re-run 2026-10-10; per-cell noise 0.36-0.86 ns, so sub-noise). The
  branchless body is both uniform AND removes a data-dependent slow path.

SC-1 input to S3: option B (branchless everywhere) wins decisively on
`highestClearBit` and is free-or-better within ~0.1 ns on the other three.

## SC-2 -- signed-canonical vs unsigned-constructed representation (Node half)
(`benchmark/experiments/sc2-repr.mjs`, both semi-space pins = 4, asserted)

The earlier S2a run compared one representation with itself: in one process,
constructing the unsigned instance generalizes the shared FastBit32 map's field to
a double and the signed instance migrates onto it; its "negative Smi" label was
hardcoded; its mix inlined (0 scavenges only proved escape analysis); and its
scavenges came from window 0 only. Its "no per-op allocation tax" is WITHDRAWN.

Reworked: ONE PROCESS PER REPRESENTATION, the representation ASSERTED with
`%DebugPrint` before and after (signed must print a bare Smi, unsigned
`<HeapNumber ...>`; exit 1 otherwise). Lanes: `inlined` (the old mix), `shared`
(`serialize()` through one call site shared by 4 look-alike classes + a boxer +
FastBit32, receiver read from an array slot so its map cannot be constant-folded),
`sharedInt` (`count()` through the same kind of site), and a boxing `control` (a
fractional double through the shared site) that MUST scale N -> 8N (exit 1
otherwise). Scavenges per lane at N = 2e6 and 8N, 4 windows each, steady = min
over windows 1..3; all windows printed.

Result (`npm run bench:sc2`, node v26.8.2, 2026-10-10):

| process | inlined | shared serialize() | shared count() | control |
| --- | --- | --- | --- | --- |
| signed (Smi asserted) | 0 / 0 | **0 / 0** | 0 / 0 | 7 / 61 |
| unsigned (HeapNumber asserted) | 0 / 0 | **7 / 61** | 0 / 0 | 7 / 61 |

(scavenges at N / 8N; every window equal.) The UNSIGNED representation boxes once
per `serialize()` that crosses a non-inlined call; the signed one does not. The
~16 B/op figure is INFERRED, not measured: the lane's scavenge counts match the
HeapNumber control exactly (7 / 61), and 2e6 x 16 B / 4 MB semi-space ~ 8; no
byte-level allocation counter ran. Reads that return int32
(`count()`) do not box in either form, and an inlined caller pays nothing (escape
analysis). So the Node per-op tax EXISTS, but only at the double-returning edge.
SC-2's option B (canonical signed int32) removes it as well as fixing serialize
stability / equality / hashing (FB-03). ns/op is printed but not compared (the
shared-site windows vary 5.6-10.4 ns run to run). **Unexplained observation, not a
claim:** the inlined mix reads faster for the UNSIGNED instance in every run --
2.19 vs 0.29 ns (reviewer), 1.93 vs 0.72 and 0.75 vs 0.32 ns (ours) -- although
the box is elided in both. Not investigated (candidates: field constness --
unsigned prints `const data field`, signed `data field` -- and per-process code
layout). The browser
pointer-compression half is the demo's `#measure` mode (S7).

## FastBit1024 slot rows (S4b, 2026-10-11)

`test/witness/run-one.mjs` mode `slot`: param p = the word (0..31) holding the one free slot 32p + 17 (pool shape:
acquire, nextClearBit, has) or the one set slot (lowest, highest). ONE instance and one corpus per process,
re-shaped per param outside the timed loop. Separate instances per param measured heap placement: the same data
in 32 instances spread 2.50-6.54 ns, and reversing the allocation order moved the slow cells.

- Teeth: `foilWordScan` (`r=0; while(inst._data[r]===-1) r++;`, O(p)) is gated RED in HOT under the lane config
  and under both SLOT_SLOW configs (165-221 N measured).
- SLOT_SLOW (acquire and has only): median of 5 passes of best-of-8 reps at outer / 4 (acquire) or outer / 2 (has).
  This is an estimator change, not a threshold change. The foil and a deliberate word step read the same with and
  without it.
- REJECTED 2026-10-11: a SELECT_SLOW estimator for the HOT FastBit32 `select` rows (the witness:fast flake). On a
  quiet host (load 1.1-1.7) div 1 (best of 8, median of 5, full outer) did not lower the probe's median spread vs
  the lane config and still failed witness:fast 2/23 (HEAD 7/28). A div 4 trial under a decision rule fixed in
  advance failed it (probe density max 0.150 vs 0.144 ns lane; witness:fast select FAILs 1/10 vs HEAD 0/10). The
  flake is not select-specific: HEAD failed 11/28 quiet witness:fast runs, FastBit1024 rows included. It belongs to
  the dedicated witness-stability session (ROADMAP). A ~0.15 ns step added to select (off its dependent chain) was
  gated red in only 3-4/8 runs under either config: at ~3 ns the 6 N bound is ~9% of the op, and that is the
  gate's resolution for this row.
- PRESSURE density d0/d32 (2026-10-11): those two corpora repeat ONE word in all 2048 slots (d0 = 0, d32 = -1;
  every other density cell is 2048 distinct random words). On this M4 Pro, under the PRESSURE stream, a one-word
  stream makes every op cheaper, more so the longer its dependent chain (likely load value prediction; a JS probe
  cannot separate it from a same-value store effect). qa scratch probe (2026-10-11, logs not kept in the repo):
  select K = 1 distinct word ~1.94 ns vs K = 2..2048 ~2.14-2.22 in one process (witness control row K = 1 vs
  K = 2048: qa's 3 runs 2.43-2.48 vs 2.67-2.74 ns, all 7 runs 2.05-2.48 vs 2.31-2.74; absolute ns vary run to run,
  the deltas agree); 0 and -1 alternating cost the full price; rank / countMasked / count gaps 0.01-0.08 ns; ctlRead
  none; HOT shows no effect. So the full witness's PRESSURE `select (density)` 5.2-6.2 N > 4.5 N (HEAD and new
  alike) is a corpus artifact, not select's code; the published HOT-only flatness claim is unaffected.
  RESOLVED 2026-10-11 (maintainer-approved, unreleased): the witness gates PRESSURE density rows (real ops,
  foilLut16, foilKernighan, SEP) and the PRESSURE NOISE over d1..d31; d0/d32 print as INFO and keep the
  negative-cell check. HOT, the position sweeps and ctlRead keep every cell. Why the cut leaves no hole: HOT still
  gates d0/d32 for every op, and the PRESSURE position rows still gate the words 0 and -1 (params 100/101)
  against other one-word corpora; only the one-word-vs-2048-word comparison the effect skews is dropped. An INFO control row prints select d16
  over K = 1 / 2 / 2048 distinct words: K = 1 was 0.21-0.35 ns (3.9-8.0 N) below K = 2048 in 7 runs and K = 2
  matched K = 2048 within 0.06 ns. Over d1..d31 select reads 1.93-4.25 N vs 4.5 N in 7 runs (all 33 cells 4.9-7.0 N at the
  all-cell NOISE the 1.5.0 gate uses), extremes
  on scattered cells, no density trend. PRESSURE NOISE (and its floor median) over d1..d31 0.040-0.066 ns, 11-25% below the all-cell NOISE (7 runs); the NOISE_FLOOR_MAX PRESSURE
  0.08 cap was not recalibrated for it and fires later than calibrated. Watch: select has the least real-op headroom (4.25 N vs 4.5 N in one run) and
  foilLut16 the thinnest foil margin (6.86 N vs 5.5 N in one run).
- PRESSURE lane: the FastBit1024 rows print as INFO, never gated (maintainer decision). Same-word control, all 32
  cells on word 5, at the shipped estimator:
  - PRESSURE `has` failed 4.5 N in 1 of 4 runs and `acquire` in 2 of 4;
  - the real sweep failed has 4/5 and acquire 2/5;
  - median of words 0-15 == median of words 16-31;
  - pass 0 of has reads ~0.6 ns vs ~1.25 ns later.

  The evidence is the same-word control (identical data spreads as much as the real sweep), so the spread is the
  lane's. The 128 B state is off-heap and V8 does not guarantee its alignment (on the M4 Pro, 128 B cache lines,
  240/240 sampled backing stores were 128 B aligned: one line; on a 64 B-line host, two or three -- two if 64 B aligned, as observed here; not measured there). A miss is
  possible; a word-dependent one was not observed.
- HOT `nextClearBit` on a loaded host (load ~3.3): same-word control spreads 0.014-0.228 ns over 8 runs vs
  0.029-0.299 ns for the sweep, with whole passes shifting together. This is host noise, not the word. The 6 N
  gate (~0.18 ns at NOISE 0.03) can flake on a busy host; the full witness needs a quiet one.
