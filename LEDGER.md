# lite-fastbit32 -- the consolidated ledger

*Every design refused, every defect found and fixed, every gate that had to be given teeth,
and the laws each one produced. This is the evidence base the package roadmap builds on.
Nothing here is re-litigated without a **new mechanism** clearing **every** gate the entry
names.*

Scope: `@zakkster/lite-fastbit32` (FastBit32, FastBit1024, BitMapper, FastBit64). Sources:
`.handoff/HISTORY.md` and `.handoff/archive/HISTORY-*.md` (gitignored), `RESEARCH.md`,
`CHANGELOG.md`, `.handoff/research/*`, `.handoff/evidence/*`, `git log`, and the
fastbit lines of `~/.claude/LESSONS.md`. Numbers are copied from those sources as they state
them; a number with no date / host / run count there carries none here either, and says so.

## How to read this file

- Section 0 (the laws) first. Each law cites the entries that prove it.
- Entries are IDs, not a single running number: `A<n>` refused designs, `B<n>` defects,
  `C<n>` gate evolution, `D<n>` shelved, `E` audit 1.7. Within a section, entries are in
  rough chronological order.
- Every entry has: what happened, root cause, evidence (commit sha from `git log` plus a file
  or `.handoff` path), the law it produced, and the gate that now holds it (file name + test /
  tier name). A claim with no findable sha or path says `evidence: NOT FOUND`.
- `.handoff/` is gitignored: those paths exist only in the maintainer's main checkout.
- Tiers: DETERMINISTIC gates run in `npm test` / `npm run verify` every time; STATISTICAL
  gates run once per release on a quiet host; REPORTED numbers gate nothing.

## How to add an entry

1. Take the next free number in the section (never renumber).
2. Title in one line. Then: **What happened**, **Root cause**, **Evidence** (sha + path),
   **Law**, **Gate** (file + test / tier name).
3. A measurement enters only from a run log of that cycle, with date, host (or CI run id), load,
   Node / V8 and run count as the source states them. An estimate is labelled "nominal".
4. An entry is never re-litigated without the new mechanism it demands: the entry names what
   would have to be true (a new engine behaviour, a new consumer, a new gate result), and the
   reopening change must clear every gate listed there.

---

## 0. The laws (read this first)

1. **A zero-box entry is not a zero-box path; make the unsigned form never exist.** A uint32
   double crossing a call V8 does not inline boxes 16 B on Node; one Maglev "not int32" deopt
   makes it permanent for a `Math.clz32` slot. Store and pass int32 (`| 0`), keep results
   signed. *(B3, B10, C8)*
2. **A bare class field is a Tagged field.** On a pointer-compressed engine (31-bit Smi) `#x;`
   boxes every out-of-Smi store; `#x = 0` starts Smi, generalizes to Double and stores in
   place. No bare numeric field declarations; a source pin enforces it. *(B10, C7)*
3. **A gate that cannot fail is not a gate.** Every gate needs a must-fail control that
   fails for its own reason (an `expect` pattern), and a coverage floor counted in events, not
   time, so it cannot pass by missing the thing it tests. *(B2, B4, B11, B12, C7, C9)*
4. **Status bits and "it passed" do not prove the thing was measured.** T6 verifies TurboFan
   through `%GetOptimizationStatus`, in both V8 bit layouts, and fails closed on an unknown
   layout; an unverified lane fails closed with its reason; where T6 cannot be verified at all (V8 < 14) the tier prints a named SKIP, never a silent pass. *(B2, B8, B9)*
5. **Fail closed on every unverified state, including the harness.** An empty or one-cell row and a symlinked entry point (B14), a missing coverage floor (B4), a census blind to helpers (B15) and a write before the last validation (B16) each failed open; an unknown V8 bit layout now fails closed (B8). *(B2, B4, B8, B9, B14, B15, B16)*
6. **Read shared memory once into a local and validate the local.** A restore that validates
   one read and stores another fails open under a concurrent writer. *(B11, B16)*
7. **Public fields cannot be a brand; a `#private` field is.** The public-field shape answers
   `true` for `{}` and a Proxy; the private fields throw TypeError on every forgery for free.
   *(A4, B16)*
8. **Statistical claims are gated once per release by a test designed for noise, never inside
   `verify`.** One `witness:fast` run false-failed 14 of 58 fast rounds. A flaky witness row is
   demoted to REPORTED, not widened. *(C1, C2, C3, C6)*
9. **Timed runs go through the quiet lock; a PRELIMINARY host is recorded, not argued.** A
   NOISY / BUSY host gives NO verdict: the step is PENDING, never re-run for a green. *(C5, C6)*
10. **A harness exit must flush.** `process.exit()` drops queued pipe writes; the gate output
    that explains the failure is exactly what is lost. *(B7)*
11. **Every refusal names a kill criterion before coding.** A member with no real consumer or
    recipe is rejected into this ledger, not shipped. *(A1, A2, A3)*
12. **An outside claim about the JIT is a hypothesis until `--trace-deopt` or `%DebugPrint`
    shows it on this engine.** The audit's `rank(31)` deopt did not reproduce. *(A8, B3)*
13. **Measured numbers enter docs from a run log of this cycle.** A control count came from a
    handoff note ("45", registry had 44) and a REPORTED cost cited a gitignored path; both were
    rejected in review. *(B17)*
14. **A design review that finds one window confounding two causes is a DESIGN rejection.**
    Fix the design (many short windows, a mixed-count floor), not the threshold. *(C9, C10)*

Gate consequence: no single green gate authorises a release. `npm run verify` carries the
DETERMINISTIC tier only; `gate:release` carries the STATISTICAL tier; CI hosts the
cross-platform half.

---

## A. Designs refused

### A1. FastBit1024#select, FastBit32 reverse / rotl / rotr

- **What happened.** Four members were listed as Tier-2 candidates in RESEARCH section 4 with
  the rule "each needs a kill criterion written before coding". At 1.5.0 `select`,
  `nextSubset`, `nextCombination` shipped on FastBit32; `FastBit1024#select`, `reverse`,
  `rotl`, `rotr` were "rejected on the record ... reopen when a consumer appears".
- **Root cause.** No real consumer pattern in the suite or a documented recipe (kill
  criterion). lite-pick was checked and is not a consumer. The ROADMAP S5 ledger carries the
  per-member text; no timing refused them.
- **Evidence.** 529d33e (1.5.0), `CHANGELOG.md` [1.5.0] "Rejected on the record" line;
  `RESEARCH.md` Tier 2 table (section 4). ROADMAP S5 text itself: NOT READ (not a source here).
- **Law.** 11.
- **Gate.** None needed (absence). Reopen only with a named consumer plus a recipe.

### A2. The three multi-word drafts (FastBitArray, MultiBit32, SparseBit1024)

- **What happened.** Three drafts were added to RESEARCH.md and reviewed in section 11.
  FastBitArray: all ops agree with the oracle except `contains` (FB-01 class). MultiBit32:
  `contains` broken, `isFull` broken at capacity mod 32 in {0, 31}, `#check` fails open.
  SparseBit1024: `nextClearBit` returns the first EMPTY word and loops; any bad index corrupts
  the routing word.
- **Root cause.** Out of scope (multi-word is lite-o1 `BitSet`'s); and the drafts re-made the
  signed/unsigned mask mistake FB-01 fixed. SparseBit1024's idea (a routing word over 32 data
  words) was salvaged as FastBit1024 (SC-5 SETTLED: A, 2026-10-10).
- **Evidence.** 37dc47d (drafts verbatim in Appendix A); `RESEARCH.md` section 11.1 verdict
  table; `benchmark/experiments/s11-drafts.mjs` (27291e4). Host stated there: node v22.22.0 /
  V8 12.4, x64 Xeon @ 2.1 GHz cloud container, read as ratios.
- **Law.** 11; a mask compare is a signedness bug until proven otherwise (B1).
- **Gate.** `test/FastBit1024.test.mjs` and the torture tiers cover the salvaged class; no
  gate holds the refusal.

### A3. FastBit32768 and FastBitTable32

- **What happened.** An external 1.5.0 audit proposed a 32 x 32 x 32 class and a
  `dense[mask.rank(bit)]` sparse table. Both were rejected in the triage.
- **Root cause.** FastBit32768 breaches the SC-4 / SC-5 boundary ("32 x 32 x 32 is not built
  here"; the multi-word answer is lite-o1 `BitSet`). FastBitTable32: `rank` is already
  documented as the HAMT index; at most a guide recipe.
- **Evidence.** `RESEARCH.md` section 14.2 (2026-10-14); evidence dir
  `.handoff/evidence/audit-2026-10-14/`; commit 435e748.
- **Law.** 11.
- **Gate.** None (absence).

### A4. Public-field and underscore-plus-brand shapes for FastBit64

- **What happened.** The S9 research burst compared FastBit64 storage shapes. The public-field
  shape (the SC-4 2026-10-11 probe) FAILS OPEN: `hasAll({})`, `hasAll({lo: 0, hi: 0})`,
  `hasAll(Proxy)` and `hasAll(forgery)` answer `true`. The underscore + `#brand` shape is
  closed too but costs 24 B of bytecode in `hasAll` (67 B vs 43 B).
- **Root cause.** A public field is not an unforgeable brand.
- **Evidence.** 149bbda (`RESEARCH.md` section 18.1, p1 / p5, 2026-11-05, Apple M4 Pro, Node
  v26.8.2 / V8 14.6.202.34-node.28); maintainer ruling of 2026-11-05 recorded in
  `.handoff/PROPOSAL-fastbit64.md` section 7 (private `#lo` / `#hi` as the brand).
- **Law.** 7.
- **Gate.** `test/FastBit64.test.mjs` forgery rows (`Object.create(FastBit64.prototype)`
  forgery, Proxy, FastBit32, FastBit1024 -> TypeError); `test/FastBit64DocsQA.test.mjs` pins
  the documented brand law.

### A5. Int32Array(2) backing for FastBit64 (and bare-field keep + caveat)

- **What happened.** For the pointer-compressed boxing (B10) the ladder compared field
  initializers, keep + caveat, and an `Int32Array(2)` backing. The typed-array backing lost:
  ~186 B per instance on d8 and ~361 B on node (vs ~48 / ~42 B), with the same call-boundary
  boxing at best.
- **Root cause.** A typed array is a heavier object than two Double fields and does not remove
  the call-boundary box.
- **Evidence.** b9447cb, `RESEARCH.md` section 20.1 (REPORTED, runs repeated 2-3x, R4 node
  rows one run each; Apple M4 Pro, d8 15.7.37); `.handoff/research/fb64-pc/` (gitignored).
- **Law.** 2.
- **Gate.** `test/Hygiene.test.mjs` A12 source pin (no bare class fields).

### A6. Inline duplication of kernel bodies in FastBit64

- **What happened.** To avoid shared free-function kernels, duplicating kernel bodies inline
  was measured: `count` grows 35 B -> 207 B, `lowest` 58 B -> 108 B (p4). Kernels stay shared
  (private; exports wait for S6).
- **Root cause.** V8 14.6 inlines a body only under 460 B, and one loop's inlining shares a 920 B cumulative budget (RESEARCH 18.1, p5-inline.out); bytes in a hot body are the cost.
- **Evidence.** 149bbda, `RESEARCH.md` section 18.1 "Inlining (REPORTED, V8 14.6, limit 460 B)".
- **Law.** Bytes in a hot body (suite law); see also 1.
- **Gate.** `test/FastBit64Kernels.test.mjs`; T6 `--no-turbo-inlining` child
  (`test/torture/t6-fb64-noinline.mjs`, C8).

### A7. Flat-row confirm in the witness (cellwise median of 3)

- **What happened.** A confirm for flat rows, like the slope confirm, was tried and rejected:
  49 / 60 med3 spreads were <= 0.132 ns, so the pre-fixed rule failed. Flat rows stay
  single-process.
- **Root cause.** The rule was stated before the data and the data did not meet it.
- **Evidence.** 3c94d49 `CHANGELOG.md` [1.6.0] "Witness: a flat-row confirm ... was
  tried and rejected".
- **Law.** 8 (a pre-fixed acceptance rule decides, not the wish).
- **Gate.** `test/WitnessConfirm.test.mjs` (slope confirm only).

### A8. Audit claim: `rank(31)` deopts after warm-up

- **What happened.** An outside audit claimed `rank(31)` deopts (`(1 << 31) - 1` overflows).
  `rank-deopt.mjs`: 2e6 calls on bits 0..30, then 2e6 on bit 31 under `--trace-deopt`: 4
  bailouts, all OSR / insufficient-feedback in the probe's own loop, 0 overflow reasons.
- **Root cause.** The `- 1` feeds only `&`, so V8 truncates to Word32; no overflow check.
- **Evidence.** 435e748; `RESEARCH.md` section 14.1 row 2; probe in
  `.handoff/evidence/audit-2026-10-14/` (node v26.8.2 darwin/arm64).
- **Law.** 12.
- **Gate.** None; `test/Pinned.test.mjs` pins the 31-bit rank values (not re-verified here).

### A9. Section 16 "from siblings": what was NOT taken

- **What happened.** Reading lite-o1 `BitSet` / `RankSelect`, lite-loglogn `StratifiedBitset`
  and the RoaringSet proposal: fastbit is ahead on `select` (a branchless 5-step descent; the
  sibling loops up to 31 times), signed int32 results (siblings box keys >= 2^31) and
  `_full`-based `nextClearBit`. Roaring containers buy nothing at 1024 bits. Taken: the COUNT
  gate idea, counting set ops, range ops, `prevSetBit`, input-law prior art.
- **Root cause.** n/a (a boundary decision).
- **Evidence.** 57fd897, `RESEARCH.md` section 16 (code read only, no probe).
- **Law.** 11.
- **Gate.** Taken items became G1 / G2 / R-L3 (1.6.0): `test/FastBit1024Counts.test.mjs`,
  `test/FastBit1024Ranges.test.mjs`, torture T-tier rows.

---

## B. Defects found and fixed

### B1. FB-01: `hasAll` returned false for bit-31 masks (1.2.1)

- **What happened.** `hasAll(mask)` returned `false` whenever `mask` carried bit 31 in unsigned
  form: `new FastBit32().add(31).hasAll(0x80000000)` and `new FastBit32(-1).hasAll(0xFFFFFFFF)`
  were `false`; a mapped mask from `getMask` with bit 31 too.
- **Root cause.** The 1.2.0 body `(value & mask) === mask` compared a signed int32 to an
  unsigned double.
- **Evidence.** f880047 (1.2.1, 2026-10-06); `CHANGELOG.md` [1.2.1] Fixed FB-01 (QA: 0
  mismatches; an instrumented QA run counted 601,352 hasAll comparisons, "no gate prints this
  count").
- **Law.** A mask compare is signedness-agnostic or it is a bug; `mask` and `mask >>> 0` must
  answer identically.
- **Gate.** `test/S1HasAllEdges.test.mjs`; torture T-tier control `hasall-old`
  (`test/torture/controls.mjs`, reinstalls the 1.2.0 body, expect `T3: ECS size-1 idx 31`).

### B2. T6 lanes measured unverified code (T6-FIX)

- **What happened.** T6 B/op went red under host load on a callee that had not been optimized
  yet; a lane could "pass" measuring baseline code.
- **Root cause.** The harness did not force and verify TurboFan for the op, the baseline and
  the registered callees.
- **Evidence.** d88876e (T6-FIX + R-L3b); `.handoff/evidence/t6-fix/`; `CHANGELOG.md` [1.6.0]
  "T6 B/op lanes measure verified-optimized (TurboFan) code" (90 callees registered per the
  archived HISTORY; not re-counted here).
- **Law.** 3, 4. A hypothesis in this entry ("a non-inlined callee left unoptimized boxes the
  unsigned double") was later REFUTED as the load cause (B3).
- **Gate.** `test/torture/harness.mjs` `measureBop` (synchronous `%OptimizeFunctionOnNextCall`,
  `%GetOptimizationStatus` before and after each window); torture guard 6; controls
  `bop-unoptimized`, `bop-unoptimized-callee`.

### B3. `highest()` boxed a float64 into `Math.clz32` (T6-LOAD, T6-FIX2; 1.6.1)

- **What happened.** CI macos node 26.8.2 (run 42066992411) read 16.000 B/op on both unsigned lanes (load1
  137.66 on 3 cpus, seed 2085328061). After one Maglev "not int32" deopt (a word >= 2^31
  reaching optimized code), V8 stopped speculating on the `Math.clz32` call and passed the
  float64 field as a boxed HeapNumber: 16 B per `highest()` call on Node.
- **Root cause.** `Math.clz32(this.value)` on an unsigned double field; the load keeps Maglev
  code live. Deterministic A/B 3/3. The hypothesis "non-inlined TurboFan callee" was REFUTED.
- **Evidence.** 9a9d1b0 (T6-FIX2), a7db8dd (docs), fddf34e (1.6.1);
  `.handoff/research/t6-load/`, `.handoff/evidence/t6-fix2/` (census.txt, golden.mjs,
  orch-confirm-frozen.mjs); `CHANGELOG.md` [1.6.1] Fixed (200,085 golden vectors vs the 1.6.0
  build, `HighestParity161` 100,000 seeded words). Fix: `31 - Math.clz32(this.value | 0)`.
- **Law.** 1, 12. Only `highest()` was affected; every other `Math.*` call takes an int32
  (census over every method that feeds `this.value` to a `Math.*` call, 11 pre-pass rows).
- **Gate.** `test/HighestParity161.test.mjs`; T6 feedback-poisoning pre-pass (a witness class
  with the 1.6.0 body must read >= 15.9 B/op or T6 fails "the pre-pass did not take");
  control `t6-highest-old`.

### B4. T3 SAB race controls could pass by missing the race (DESER-FIX)

- **What happened.** The FastBit1024 shared-memory row's race controls could pass without ever
  hitting the window; a must-fail control that cannot fail is the failure mode.
- **Root cause.** No coverage floor; controls matched a generic failure, not their own reason.
- **Evidence.** 9e597dc; `.handoff/evidence/deser-fix/` (provenance.txt: node v26.8.2, load1
  5.88 at start, PRELIMINARY, runs UNTIMED); `CHANGELOG.md` [1.6.0] "Torture T3
  shared-memory row".
- **Law.** 3. Floors are counts, no clock: deserialize header re-read window >= 64 hits,
  loadFrom at capacity 500 tail-word window >= 8 hits; chunks repeat only while a floor is
  unmet (at most 64); a break is never retried.
- **Gate.** `test/torture/t3-adversarial.mjs`; controls `fb1024-deser-snapshot`,
  `fb1024-load-snapshot`, `t9-expect-swap`; T9 honors `expect`; `torture:controls` takes names.

### B5. FastBit1024 getter captures defeated tree-shaking (TREESHAKE-FIX; 1.6.0)

- **What happened.** An `export { FastBit32 }` bundle was 1134 B min+gz instead of 1059 B.
- **Root cause.** The two intrinsic getter captures (the %TypedArray%.prototype `length` and
  @@toStringTag getters) were impure at module scope, so a bundle that never used FastBit1024
  kept them.
- **Evidence.** 54f8f58; `.handoff/evidence/treeshake-fix/` (bundle-check.log);
  `CHANGELOG.md` [1.6.0] (REPORTED: esbuild 0.28.2 --bundle --format=esm --minify | gzip -9,
  one run, 2026-11-05).
- **Law.** Module-scope captures are `/* @__PURE__ */` IIFEs; bundle size is a deterministic
  fact that needs a gate, not a README sentence.
- **Gate.** `test/BundleShake.test.mjs`; `npm run bundle-check` in `prepublishOnly`.

### B6. Torture entry guards failed on node 18 - 24 runners (CI-1, CI-2)

- **What happened.** First hosted CI: the replay row and the `--minor-ms` probe failed on
  older runners.
- **Root cause.** The replay row compared stderr with PIDs in it; `--minor-ms` was assumed
  present.
- **Evidence.** fee4785 (and 8c56802 for the workflows); CI run 42066992411 on 938a84c
  (CI-1..3 confirmed fixed, `npm test` 831 / 831 on all legs); `CHANGELOG.md` [1.6.1].
- **Law.** A test that runs on one engine is not a test that runs on the matrix.
- **Gate.** `test/TortureGuards.test.mjs` (PID-normalized replay stderr; `--minor-ms`
  probed); `.github/workflows/ci.yml`.

### B7. `process.exit()` dropped queued pipe output (CI-3)

- **What happened.** On a pipe, torture's final lines were lost, so a red leg explained nothing.
- **Root cause.** `process.exit()` before stdout / stderr drained on a slow pipe.
- **Evidence.** 938a84c; `.handoff/research/ci3/` (repro-ci3.mjs, stall-burst.mjs);
  `CHANGELOG.md` [1.6.1] Testing / CI.
- **Law.** 10.
- **Gate.** `test/TortureFlush.test.mjs`; `test/torture.mjs` flushes before every exit.

### B8. T6 harness read one V8 bit layout (CI-4)

- **What happened.** On node 20 / 22 / 24 (6 legs red at torture guard 6) torture refused to
  run: "TurboFan is unavailable", status 0x51 = TurboFan.
- **Root cause.** V8 <= 13.6 keeps kAlwaysOptimize at bit 2 (TurboFan 0x51 vs 0x29 on newer).
  Reproduced with official node 22.23.4 / 24.22.2 (maintainer-approved download).
- **Evidence.** 9f57c7c; CI run 42066992411; `.handoff/research/ci4/`;
  `CHANGELOG.md` [1.6.1]. Also fixed in the same unit: DEP0152 (the GC watcher reads
  `detail.kind` only).
- **Law.** 4, 5. The layout is detected once by two probes and normalized; an unknown layout
  fails closed. Review r1 rejected 3 LITERAL (teeth), r2 approved.
- **Gate.** `test/OptStatusLayout.test.mjs`.

### B9. T6 on V8 < 14: a named SKIP, not a hole (CI-5)

- **What happened.** On old V8 forced optimization stays concurrent / Maglev, and the withhold
  controls hit a fatal CHECK. The maintainer ruled (2026-11-05) "T6 needs V8 >= 14; named
  SKIP". Review r1 rejected 3 LITERAL (the runner skip predicate failed open on node 26).
- **Root cause.** T6's claim cannot be verified below V8 14; silence would read as a pass.
- **Evidence.** a035697; CI 42091755714 on a7db8dd, 12 / 12 green (node 20-24 print a named
  `T6 SKIP`, 6 T6 controls skipped; node 26 T6 37 / 37); `CHANGELOG.md` [1.6.1].
- **Law.** 4, 5.
- **Gate.** `test/T6Floor.test.mjs`.

### B10. FastBit64 stores boxed on pointer-compressed engines (FB64-PC)

- **What happened.** d8 15.7.37 (pointer-compressed): `setWords` / `loadFrom` / `toggle` /
  `union` boxed a HeapNumber per word outside [-2^30, 2^30 - 1], even inlined. Per 1e6 ops on
  d8: setWords 23-24 (Maglev 47), loadFrom 22, union 22, toggle 11, add 11; reads 0. Node
  unaffected.
- **Root cause.** `#lo; #hi;` defines each field undefined first, so the constructor's Smi
  store generalizes it to Tagged (d8 `--trace-generalization`). `#lo = 0; #hi = 0;` generalizes
  to Double: stored in place.
- **Evidence.** b9447cb (`RESEARCH.md` section 20, probe ladder R1-R7g, REPORTED, runs 2-3x),
  912bf67 (fix, A9 / A12 / A16), 7acb17e (gates, A10 / A11). Cost stated, not hidden: R6b
  (Apple M4 Pro, d8 15.7.37, 2026-11-08T20:52:53Z, load1 2.33 -> 2.45, K = 7): mixed toggle
  1.002 -> 3.685 ns/op (z/a 3.678). Ruled A15 "z + stated cost".
- **Law.** 1, 2.
- **Gate.** `test/Hygiene.test.mjs` A12 source pin (names the two bare fields on the pre-fix
  tree); `test/torture/d8-fb64.mjs` (read / store / mutator windows, <= 2 per 1e6);
  `test/torture/d8-loadfrom.mjs` (FB1024, 1e6); T6 u32-storage witness rows and control
  `fb64-u32-storage`. Revert on the pre-fix store: 45 / mutator 45-46 (3 runs, qa).

### B11. FastBit64 SAB row red on hosted ubuntu (FB64-SAB-CI, A5)

- **What happened.** Nightly 42624558856 and soak-nightly 42612283571 (both on 5524792) read
  "INCONCLUSIVE -- the reread control failed open N times in 1024 chunk(s)", shipped 0. Five
  hosted runs, 54 FB64 SAB rows: macOS 20 / 20 pass; ubuntu 10 of 34 INCONCLUSIVE, rate
  5e-8..2e-3, median 7e-6 (design r_min 1.3e-4 from the M4).
- **Root cause.** The back-to-back flipping writer's reread hit rate on hosted ubuntu was 5e-8..2e-3 per call (median 7e-6), against a design r_min of 1.3e-4 sized on the M4 (HISTORY (ac)). Shipped fail-open count 0 everywhere; the control is what starved.
- **Evidence.** 54a9f2d (held writer + dwell witness; SPEC-fastbit64 A17-A19); CI 42760677836
  on 54a9f2d green 12 / 12 (T3 FB64 SAB: dwell 80,763-114,510 / 200,000, mixed 15-20 / 20,
  reread 58-1,106 in chunk 1, shipped 0); `.handoff/research/fb64-sab-ci/` (45 local runs, 0-24
  busy threads, min rate 3.8e-4; held writer H = 64 rate 3.8e-3..5.7e-3 idle);
  `.handoff/evidence/qa-fb64/ci-42760677836-sab.log`. CI 42738445669 (old writer) later went
  green 12 / 12: variance, not a fix. Lane-S night half: PENDING.
- **Law.** 3, 6, 14. Review r1 REJECTED DESIGN (one sub-ms window confounds preemption: parked
  0xFF = spurious red; parked -1 = vacuous pass); ruled A18: 20 bursts x 10,000 reads, 1 ms
  apart, >= 20,000 -1 AND >= 10 of 20 bursts mixed.
- **Gate.** `test/torture/sab-writer64.mjs` (held writer); T3 FB64 SAB row dwell witness;
  `test/FastBit64SabSkip.test.mjs` (A18 H1 constants, H7 / H7b / H8 sampler); controls
  `fb64-sab-reread`, `fb64-sab-flip`. Reverts: old writer 1736 / 200000 FAIL; parked -1 mixed
  0 / 20 FAIL; half-burst sampler FAIL (PRELIMINARY).

### B12. T0 FastBit1024 rows had a seed-dependent hole (SOAK-1)

- **What happened.** soak-nightly 42208348480 red on 1 leg (seed 2503656438): T9
  `fb1024-acq-highword` was decorative in T0 for that RNG state. Reproduced untimed
  (`replay-t9.mjs`, the RNG state T9 inherits).
- **Root cause.** The row's precondition (that the acquire reaches the high word) was
  unasserted; it depended on the seed.
- **Evidence.** b85ac00 (SOAK-1); `.handoff/evidence/soak-1/`. Reviews: LITERAL x2 (row
  precondition unasserted; an unprinted "reported" counter) then approved.
- **Law.** 3: a randomized row asserts its own coverage floor.
- **Gate.** `test/torture/t0-laws.mjs` fixed acquire rows with the precondition asserted
  (word-23 row).

### B13. FastBit64 poisoning pass was unproven under a private-field read (B.B2)

- **What happened.** A poisoned `clz32` READ of a PRIVATE uint32 field does not box on V8 14.6
  (private 0.000 vs public 16.000). Under ruling A3 no gate proved the FB64 poisoning pass;
  mutant mutA (opts dropped) survived. B.B2 REJECTED (DESIGN) and parked; ruled A4: a
  public-field read witness (Fb64PubMirror, one poisoning call site fb64Poison).
- **Root cause.** A witness on a private field is blind to the box it is supposed to see.
- **Evidence.** eef5c21 (B.B2 + B.B1b); `.handoff/evidence/fb64-B2/`; `.handoff/rejected/B.B2.restored-*`
  (parked copy); HISTORY entries (u) and (v) (2026-11-06/07). Pub read witness 16.000 B/op;
  mutA 0.000.
- **Law.** 3, 4.
- **Gate.** `test/torture/fb64-lanes.mjs`, `t6-alloc.mjs` FB64 witness; control
  `fb64-poison-opts-drop`; `test/torture/harness.mjs` parity census (typed args + deopted
  compared).

### B14. Witness harness fail-opens

- **What happened.** (a) `gateFlat` passed an empty or one-cell row as NaN / -Infinity. (b) the
  `witness.mjs` entry guard skipped `run()` and exited 0 when started through a symlink or
  realpath-changing path (macOS /tmp, `tmpdir()`). (c) A malformed PRESSURE density subset was
  relabelled HOST (exit stayed 1).
- **Root cause.** Guards that compared the wrong thing and defaulted to pass.
- **Evidence.** efbb377 (gateFlat; a malformed subset fails closed); 3c94d49 (the subset is no longer relabelled HOST); ed3db0f (realpath); `CHANGELOG.md` [1.6.0]
  Witness bullets.
- **Law.** 5.
- **Gate.** `test/WitnessFailClosedQA.test.mjs` (10 cases), `test/WitnessSubsetQA.test.mjs`
  (28 cases, two symlink probes), `test/Witness.test.mjs`.

### B15. Census could not see helpers outside the kernel markers

- **What happened.** `mathOutsideFunctions` (harness.mjs) missed const-arrow fixpoints and a const between markers, and had no var / export const fixture; opened from B.B2 r2 nit 1, then r1 REJECTED 3 LITERAL, r2 APPROVED.
- **Root cause.** A text scanner with a fail-open fixpoint.
- **Evidence.** 01a3665; `.handoff/COMMIT_MSG-outside-fns.txt`; HISTORY (w) 2026-11-08. Live
  outside list 8, census 13 (as stated there).
- **Law.** 5.
- **Gate.** `test/HarnessOutsideFns.test.mjs`.

### B16. FastBit64 `saveInto` / `loadFrom` fail-open shapes

- **What happened.** Engine review of FastBit64 found a FAIL-OPEN throw after write in
  `saveInto` (header stored first); fixed by storing the header last (FastBit32.js sha256/8 a60bcedf, bytecode 192 =
  192). A.B3 oracle tests found 5 guard-drop survivors (tag drop x2, loadFrom offset mask /
  `>= len`, fromArray `n` guard). The 1.6.0-required SAB probe: candidate 1,985,524 accepted,
  14,476 refused, 0 FAIL-OPEN; a mutant that re-reads `src[base + 1]` failed open 649x.
- **Root cause.** A write before the last validation; a guard per argument not tested.
- **Evidence.** e8b4b8e; `RESEARCH.md` section 18.1 p2 / p7 (2026-11-05, Apple M4 Pro);
  HISTORY (r) 2026-11-06.
- **Law.** 5, 6, 7.
- **Gate.** `test/FastBit64.test.mjs` (75 + 7 mutants per HISTORY), `test/FastBit64QA.test.mjs`;
  T3 FB64 SAB row (B11).

### B17. Wrong numbers entered docs from a handoff note

- **What happened.** CHANGELOG [Unreleased] said controls "45 at 1.6.1"; the registry had 44
  (the error came from NEXT.md's PROPOSED DOCS via the brief). Another doc cited a gitignored
  `.handoff` path for a REPORTED cost; and the SAB row lacked fb64-sab-flip + dwell (52 -> 53).
- **Root cause.** A doc number copied from a note, not from a run log.
- **Evidence.** 754292c, 9cb0213; HISTORY (ab) r1 2 LITERAL, (ad) qa C REJECTED on CHANGELOG.
- **Law.** 13.
- **Gate.** `test/FastBit64DocsQA.test.mjs`; reviewer doc-mutants (21 / 24 killed, 3
  equivalent, per HISTORY (ab)).

---

## C. Gate evolution

### C1. witness:fast moved out of verify; gate:release votes K = 5

- **What happened.** One `witness:fast` run false-failed 14 of 58 fast rounds (REPORTED: pooled
  earlier local single runs on the builds before 170481d, not re-measured that cycle); LESSONS
  2026-10-12: it failed ~40% of quiet runs inside `verify`.
- **Root cause.** A STATISTICAL gate inside a DETERMINISTIC chain.
- **Evidence.** 170481d, 22693ef; `CHANGELOG.md` [1.6.0] Release gate bullets;
  `.handoff/archive/1.6.0/plan-release-gate.md`, `plan-witness-stability*.md`;
  `~/.claude/LESSONS.md` 2026-10-12.
- **Law.** 8. `gate:release` runs K = 5 serial rounds, strict majority (3 of 5) of FAIL is a
  FINDING; exit 0 pass, 1 finding or harness failure, 2 inconclusive; `--if-stale`.
- **Gate.** `test/witness-release.mjs`; `test/WitnessRelease.test.mjs`,
  `WitnessReleaseQA.test.mjs`; `prepublishOnly`.

### C2. select flatness rows demoted to REPORTED

- **What happened.** flat-sel H (2026-10-21; one run, local) found 30 of 60 select processes
  reading a spread > 0.132 ns with no code change.
- **Root cause.** A host-dependent flat row; not a library change.
- **Evidence.** 36d6b73; `.handoff/evidence/selflake/` and `selectslow-div4/`;
  `CHANGELOG.md` [1.6.0]. Rows still required in every round (missing = HARNESS), printed as
  REPORTED, kept in `decision.json`.
- **Law.** 8.
- **Gate.** `test/WitnessRelease*.test.mjs` (REPORTED rows never become FINDING).

### C3. Slot-mode warm-up (27e4ac0)

- **What happened.** The first cells of a fresh process read cold (flat-cp probe). Fix:
  `ceil(12 / P)` unrecorded warm-up passes in slot mode, lane HOT only.
- **Evidence.** 27e4ac0, 4a4d91a; `CHANGELOG.md` [1.6.0]: STATISTICAL tier, one run, local,
  quiet host (load1 1.06 -> 1.15, baseline 2.21), Node v26.8.2, 2026-11-04, 480 processes,
  K10 count H 18 vs N 1, Fisher p 2.836e-5, PASS. Single run.
- **Law.** 8.
- **Gate.** `test/WitnessWarmup.test.mjs`; `test/WitnessProgramQA.test.mjs` (8 new cases).

### C4. PRESSURE density judged over d1..d31

- **What happened.** d0 / d32 corpora repeat one word, which the M4 Pro runs cheaper under the
  PRESSURE stream (select ~0.2-0.35 ns); the full witness failed at PRESSURE select (density)
  5.2-6.2 N.
- **Evidence.** efbb377; `CHANGELOG.md` [1.6.0]. d0 / d32 print INFO and keep the negative-cell
  check; a malformed subset fails closed.
- **Law.** 5, 8.
- **Gate.** `test/WitnessSubsetQA.test.mjs`.

### C5. The quiet lock and PRELIMINARY hosts

- **What happened.** A LitePick verify chain ran inside FastBit32's quiet window (LESSONS
  2026-10-12); across the FB64 bursts the lock was BUSY or NOISY at most closes (exit 75 / 76; strict refusals at load1 27.3 (r), 30.8 (t), 7.77 and 9.63 (w), 9.16 (x), 3.91 (aa)). Timed numbers were recorded PRELIMINARY; a BUSY / NOISY
  step is PENDING, never retried for a green (e.g. R6 strict: 76, then ran on a quiet host and
  FAILED A9's gate with z/a 2.451 on toggleSmi).
- **Evidence.** `~/.claude/LESSONS.md` (fastbit lines); HISTORY (z), (aa), (ac).
- **Law.** 9.
- **Gate.** Process (quiet-lock `run --strict`); `npm run verify` is deterministic only.

### C6. Nightly lanes: lane S gating, lane P report-only; test:perf relabelled

- **What happened.** NIGHTLY-1 added a soak lane (gating) and a perf lane (report-only). The
  claim inventory found `test:perf` is a scavenge-COUNT gate (DETERMINISTIC), mislabelled
  "timed" / STATISTICAL; 10 UNPROVEN claims listed. Lane P local night (old sha 26001295 (HISTORY (s)), load1
  19 -> 30): NO DATA (ETIMEDOUT) and failed closed. Reviewer rejects: `rowStats` demoted-teeth
  miscount; `--cycles ""` push-volume fail-open.
- **Evidence.** 6e5f46b, 5524792 (docs); `.handoff/evidence/nightly-1/claims-inventory.md`;
  `.handoff/SPEC-nightly.md` (S-1..S-9, P-1..P-9, CAL-1..CAL-5); `RESEARCH.md` section 19
  (results table empty: NIGHTLY-2 has not filled it).
- **Law.** 8, 9.
- **Gate.** `test/SoakLane.test.mjs`, `test/PerfNightly.test.mjs`, `test/perf/PerfGate.test.mjs`;
  `.github/workflows/nightly.yml` and the lane files.

### C7. The d8 pointer-compressed lane grew windows and revert checks

- **What happened.** B.B3 first built a 1e5-op window; review showed it blind to one box per op
  (mutant read 1 per 1e5; at 1e6 clean 0 / mutant 11) and ruled A8 (1e6 windows, read <= 2 per
  1e6). PC.B dropped the warm-up `gc()` (a post-gc() re-tier transient), added the mutator
  window, and gates read / store / mutator <= 2 per 1e6. Review r1 REJECTED 3 LITERAL (RESULT
  blind to a dropped toggle / union; no inlined-store COUNT row). FB1024's d8 loadFrom window
  moved to 1e6 with m1 / m2 revert checks (A11).
- **Evidence.** 34c2995 (B.B3), 7acb17e (PC.B); `.handoff/evidence/fb64-B3/review/REPORT-r1.md`,
  `fb64pc-B/`; PC.B live 9 runs: read 1,0,0,0,0,0,0,0,0, store 0, mutator 0.
- **Law.** 3, 14 (a window must be able to see one box per op).
- **Gate.** `test/torture/d8-fb64.mjs`, `d8-loadfrom.mjs`; `SoakLane.test.mjs` store defaults
  47 / 68 as stated in HISTORY (x).

### C8. FastBit64 T6 lanes in an `--no-turbo-inlining` child

- **What happened.** T6 FB64 lanes (24) run inlined and in a child with `--no-turbo-inlining`
  so every kernel is reached through a real call: 24 lanes -0.010..0.000, u32 control 16.000,
  kernels 4 / 4 (B.B3 coder).
- **Root cause.** Status bits do not prove inlining; an unsigned double crossing a call boxes
  16 B (the T6-LOAD signature).
- **Evidence.** 34c2995; `RESEARCH.md` section 18.1 control (`x >>> 0` callee: 0.000 inlined,
  16.000 under `--no-turbo-inlining`).
- **Law.** 1, 4.
- **Gate.** `test/torture/t6-fb64-noinline.mjs`; control `fb64-noinline-flag-drop`.

### C9. Dwell witness (A18): count the writer's dwell, not a clock

- **What happened.** See B11: the gate is 20 bursts x 10,000 reads, 1 ms apart, >= 20,000 -1
  AND >= 10 of 20 bursts mixed (false-FAIL ~7e-7 nominal). r2 rejected the verdict because it
  passed constants (n / k); a half-burst sampler passed; r3 added an exported counted sampler
  (A19).
- **Evidence.** 54a9f2d; `.handoff/frozen-sabci-754292c/`; overlays `overlay-sabci*`.
- **Law.** 3, 14.
- **Gate.** `test/FastBit64SabSkip.test.mjs` (H1 constants, H7 / H7b / H8); `sab-writer64.mjs`.

### C10. Stop and park a rejected design; never patch it forward

- **What happened.** B.B2 (A4 ruling) and B.B3 (A8 ruling) were REJECTED on DESIGN, parked as
  `.handoff/rejected/<unit>` (base HEAD), and re-restored for a fix round after the ruling.
  G1-B1 was parked once as well. Rule stands: stop + park, do not carry the design patch into
  the next unit.
- **Evidence.** `.handoff/rejected/` (three restored copies); HISTORY (u), (v), (w).
- **Law.** 14.
- **Gate.** Process (reviewer + orchestrator).

### C11. Harness hygiene found by reviewers (small, kept)

- **What happened.** (a) A first R7g run ignored its tier flags: zsh does not word-split an
  unquoted two-flag `$f`. (b) A helper's `until ! pgrep -f 'npm test'` wait matched other
  sessions and never ended: wait on the log. (c) qa B ran one text-only control capture
  unlocked after a 75 (BUSY): verdicts came from the locked run.
- **Evidence.** HISTORY (y), (ad); `/Users/zakkster/.claude/projects/-Users-zakkster-Work-Portfolio-LiteLibrariesSuite-LiteFastBit32/memory/zsh-no-word-split-flags.md`.
- **Law.** 9, 13.
- **Gate.** Process.

---

## D. Shelved (built or measured, parked -- not disproven)

### D1. `findClearRun(k)` / `acquireRun(k)`

- **What.** Lowest run of k clear bits by a SWAR doubling cascade `r &= r >>> s` then
  `31 - clz32(r & -r)`. Kernel verified: 640,320 cases (k = 1..32, 10 edge words + 20k random
  each), 0 mismatches; must-fail control (signed `>>`) disagrees 79 times.
- **Why parked.** CANDIDATE with no consumer.
- **Evidence.** 435e748, `RESEARCH.md` section 14.2; `.handoff/evidence/audit-2026-10-14/`.
- **Reopen with.** A consumer plus a gate for the run-reservation contract.

### D2. FastBit1024 raw-word views (Int32Array arena, SharedArrayBuffer)

- **What.** `FastBit1024View` (36-word stride) over an arena. Caveat the audit omitted: a view
  over a SharedArrayBuffer shared by workers is a data race unless every write is an `Atomics`
  op.
- **Why parked.** CANDIDATE, OVERLAPS SC-2.
- **Evidence.** `RESEARCH.md` section 14.2. Later shipped part: `saveInto` / `loadFrom` (1.6.0,
  125e1d1).
- **Reopen with.** A consumer and an `Atomics` race gate.

### D3. FB-15: single-load `FastBit1024.toggle`

- **What.** The audit's single-load form keeps I1-I4. A speed claim, so STATISTICAL.
- **Why parked.** Adopt only with an interleaved A/B, never on reasoning.
- **Evidence.** `RESEARCH.md` section 14.1 row 3 (FastBit32.js:572-575 at 22693ef).
- **Reopen with.** A quiet-host interleaved A/B with a stated statistic.

### D4. S6 / 2.0.0: SC-2 (signed results) and SC-3

- **What.** Signed-int32 results so `serialize()` and `BitMapper.getMask` vs `bit(name)` agree;
  measured in S2a (`%DebugPrint`: signed Smi vs unsigned HeapNumber; serialize 0 / 0 vs 7 / 61
  scavenges). FB-03, FB-06 recorded.
- **Why parked.** A breaking change scheduled after S9.
- **Evidence.** 27291e4 (sc2-repr.mjs), `RESEARCH.md` section 14.1 rows 1, 1b, 4a; ROADMAP
  S6 (not a source here).
- **Reopen with.** The S6 settle calls.

### D5. Lane P calibration table (NIGHTLY-2)

- **What.** Protocol CAL-1..CAL-5 is written; the results table is empty. Earliest close for a
  push on 2026-11-07: 2026-11-14 (with 3 dispatches) or 2026-11-17 (RESEARCH 19 worked example). After the restart at 754292c, HISTORY (ac) gives `CAL-5 earliest 2026-11-17`. The window restarted at
  754292c after 912bf67 changed FastBit32.js (a lane P pinned file).
- **Evidence.** `RESEARCH.md` section 19; HISTORY (ac) NIGHTLY line.
- **Reopen with.** 10 DECISIVE nights per OS.

### D6. FastBit64 timing (p6) and 1.8.0 word-ops candidate

- **What.** p6 (interleaved A/B of five storage / kernel / branch variants) was refused by the
  quiet lock (exit 76, load1 3.24 >= baseline 2.21 + 1); SC-4's 2026-10-11 table stays the only
  timing evidence for the flat shape. A 1.8.0 word-ops candidate sits in ROADMAP (767a45b);
  its content is not in the sources read here.
- **Evidence.** `RESEARCH.md` section 18.1 "Not measured: timing"; 767a45b.
- **Reopen with.** A quiet-lock run.

---

## E. Audit 1.7 findings

Filled after the audit 1.7 triage (verdicts only, pointing at audit/2026-11-10/ by name).

---

## Not yet covered

- Per-entry dates for several commits (git log was read without dates for most shas).
- The ROADMAP S5 ledger text for A1 (not a source for this unit).
- `.handoff/archive/HISTORY-*.md` entries before 2026-11-04 were only grepped (DESER-FIX,
  TREESHAKE-FIX, T6-FIX, SC-2 lines); the 2026-10-12 / 10-13 / 10-21 / 10-23 witness-stability
  work is summarised from CHANGELOG [1.6.0], not from those archives.
- The lite-signal v. fastbit LESSONS entries beyond the two quoted lines.
