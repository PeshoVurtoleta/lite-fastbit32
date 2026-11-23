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
   time, so it cannot pass by missing the thing it tests. *(A10, B2, B4, B11, B12, B18, B19, B21, C7, C9)*
4. **Status bits and "it passed" do not prove the thing was measured.** T6 verifies TurboFan
   through `%GetOptimizationStatus`, in both V8 bit layouts, and fails closed on an unknown
   layout; an unverified lane fails closed with its reason; where T6 cannot be verified at all (V8 < 14) the tier prints a named SKIP, never a silent pass. *(B2, B8, B9)*
5. **Fail closed on every unverified state, including the harness.** An empty or one-cell row and a symlinked entry point (B14), a missing coverage floor (B4), a census blind to helpers (B15) and a write before the last validation (B16) each failed open; an unknown V8 bit layout now fails closed (B8). *(B2, B4, B8, B9, B14, B15, B16, B19)*
6. **Read shared memory once into a local and validate the local.** A restore that validates
   one read and stores another fails open under a concurrent writer. *(B11, B16)*
7. **Public fields cannot be a brand; a `#private` field is.** The public-field shape answers
   `true` for `{}` and a Proxy; the private fields throw TypeError on every forgery for free.
   *(A4, B16)*
8. **Statistical claims are gated once per release by a test designed for noise, never inside
   `verify`.** One `witness:fast` run false-failed 14 of 58 fast rounds. A flaky witness row is
   demoted to REPORTED, not widened. *(C1, C2, C3, C6)*
9. **Timed runs go through the quiet lock; a PRELIMINARY host is recorded, not argued.** A
   NOISY / BUSY host gives NO verdict: the step is PENDING, never re-run for a green. A run that
   spans a host sleep is VOID the same way. *(B20, C5, C6)*
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

### A10. 1.8.0 word ops: what the research burst declined (2026-11-21)

- **What happened.** The word-ops research burst (xor / invert on FastBit32 and FastBit64, a symmetric-difference
  count on all three classes) probed four rungs and declined three shapes: (1) the one-pass FastBit1024 count
  (walk the words that are non-empty in either set, popcount the xor); (2) `xor` / `invert` on FastBit1024; (3) any
  `>>> 0` store of a result. It also found that neither the T0 laws nor an inlined B/op lane can see (3).
- **Root cause.** (1) `size + other.size - 2 * intersectionSize(other)` walks only the words non-empty in both sets
  and never read more words on any of 1,600 pairs (0 vs 15.32 mean on sparse disjoint halves, 0 vs 23 for a 700-slot
  pool against one id outside its words; equal only when the word summaries coincide). (2) FastBit1024 has no
  in-place set algebra (SC-5), and `invert` under capacity < 1024 needs a mask and a summary rebuild. (3) A `>>> 0`
  result is a uint32 double: under `--no-turbo-inlining` it boxed 8.000 B/op (FastBit32 invert + serialize, one box
  per 2 ops) and 16.000 (FastBit64 invert + lo / hi), 0.000 for the `~` (int32) body. The same mutant passed every T0
  law (`equalsValue` ignores signedness) and read 0.000 on every inlined lane.
- **Evidence.** This burst's commit (after 4f0ff94): `RESEARCH.md` section 23; `.handoff/PROPOSAL-word-ops-1.8.md`;
  `.handoff/research/word-ops-1.8/` (PROGRESS.md R1-R4, logs/r1-*, r2-*, r3-*, r4-words.out). node v26.8.2 (V8
  14.6.202.34-node.28) and d8 15.7.37, 2026-11-21, one run per lane for R1, R4 and the m-u32 lanes, two for the R2 /
  R3 z lanes (base and `-b` logs) (deterministic counts, not timings; host load1 33-38, which a count does not depend
  on).
- **Law.** 1, 3, 11. A word-op law is compared bitwise, never with `.value ===`: x passed in its uint32 form breaks
  5,057 of 20,196 FastBit32 pairs in the `=== x` form (every mutator stores an int32), and the constructor's `>>> 0`
  (E3) breaks 10,090 in the `=== value-before` form. A representation defect needs a representation row and a
  `--no-turbo-inlining` lane; a law cannot see it.
- **Gate.** None yet (no source changed). The PROPOSAL's section 5 gate list (an int32 row per mutator, T6 with a
  `--no-turbo-inlining` child and a `>>> 0` must-fail control) is the planner's input once Q-GATE is ruled. Reopen
  (1) only with a FastBit1024 that drops its O(1) size; (2) with a consumer for in-place FastBit1024 algebra.

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
  green 12 / 12: variance, not a fix. Lane-S night half: SEEN (soak-nightly 43010282719, 9 / 9 legs shipped 0; see B18).
- **Law.** 3, 6, 14. Review r1 REJECTED DESIGN (one sub-ms window confounds preemption: parked
  0xFF = spurious red; parked -1 = vacuous pass); ruled A18: 20 bursts x 10,000 reads, 1 ms
  apart, >= 20,000 -1 AND >= 10 of 20 bursts mixed (A22: >= 4, A24: >= 1; B18).
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

### B18. A18 mixed bar false-FAILed on correct code (FB64-SAB-MIX, A22)

- **What happened.** CI 42861181198 (de9a5d9) went red on macOS node 22 only: dwell 106028 /
  200000, mixed 9 / 20 (seed 4037211545); shipped fail-open 0, the code was correct. The bar
  was 10 of 20 bursts mixed. Of 41 hosted legs with the held writer (CI 42760677836,
  42766543771, 42852157810, 42861181198, soak-nightly 43010282719) the 19 macOS legs read mixed
  9, 15, 15, 16, 17, 17, 18, 18, 18, 19 x5, 20 x5; ubuntu 19-20. Lane-S night half SEEN
  (nightly schedule 2026-11-11): soak-nightly 43010282719, 9 / 9 legs shipped 0, reread control
  106-740 in chunk 1, mixed 18-20.
- **Root cause.** Bursts are correlated, not independent: beta-binomial fit over the 19 macOS
  legs p 0.888, rho 0.104 (nominal). A18's false-FAIL ~7e-7 assumed independent bursts; the
  fitted model gives (nominal) P(mixed < 10) ~ 8.7e-3 per macOS leg (~4% per CI push of 5 macOS
  legs, nominal). A bad leg looks like whole-leg starvation, so more bursts help little
  (K = 40 bar >= 12 would miss ~2.6e-4 per macOS leg, nominal).
- **Evidence.** de9a5d9; CI 42861181198; soak-nightly 43010282719; `.handoff/evidence/sab-mix/`
  (model, per-leg lines). Fix: A22 (SPEC-fastbit64), maintainer ruling "K=20, bar >= 4
  (Recommended)", 2026-11-12; at commit: (maintainer fills). NOMINAL: P(mixed < 4) ~ 6.8e-5 per
  macOS leg (~3.4e-4 per push); 0 of 41 legs below 4.
- **Law.** 3, 13: a floor that fails correct code is as wrong as one that passes broken code;
  its stated miss probability must come from measured legs (run logs of this cycle), not an
  independence assumption. The parked -1 revert (dwell 200,000, mixed 0) still FAILS at >= 4.
- **Amended 2026-11-12 (A24).** The >= 4 bar's model was refuted: CI 43154836495 (72744e5)
  macOS node 26 read mixed 4 / 20 (dwell 121486) on correct code, exactly AT the bar. Refit
  over the 24 distinct macOS legs of 51 hosted legs (24 macOS, 27 ubuntu; nominal,
  `.handoff/evidence/sab-mix2/`): p 0.836, rho 0.197; miss per macOS leg bar >= 4 3.56e-3
  (~1.8% per push), bar >= 2 6.02e-4, bar >= 1 1.35e-4 (~6.8e-4 per push). The bar is now
  >= 1 (maintainer ruling "Bar >= 1 (Recommended)"); the stuck writer (stores only -1: dwell
  200,000, mixed 0) still FAILS, and fb64-sab-flip still fails on the 10% dwell floor.
- **Gate.** `test/torture/t3-adversarial.mjs` (`FB64_SAB_DWELL_MIXED` = 1, A24);
  `test/FastBit64SabSkip.test.mjs` (H1 constants); control `fb64-sab-flip`;
  `test/FastBit64DocsQA.test.mjs` (CHANGELOG T3 bars == the constants).

### B19. T7 false FAIL: a dead async-function local pinned the segment's last instance (T7-FIX)

- **What happened.** soak-nightly 44299365353 (2026-11-18, b34775d), leg macos-latest / node
  latest = v27.0.0-alpha.0.1.1 (V8 15.6.75.50-node.14), 3 cpus, load at job start 96.19 48.45
  19.83. Seed 3069745017, cycles 16384: `TODO/FAIL T7: segment 2 did not drain to 0 (live=1)`.
  Seeds 1452148634 / 1213775432 green on that leg; the ubuntu alpha and ubuntu 26.8.2 legs
  green; the same alpha passed b34775d the night before (44080134911). First T7 drain red in
  14 soak-nightly runs.
- **Root cause.** TEST HARNESS defect, not a FastBit32 retention. `test/torture/t7-soak.mjs`
  `run()` is async; its inline FastBit32 churn loop's dead loop-local `inst` (the segment's last
  instance) is saved in the suspended generator across `await drain(50)`, depending on the tier
  executing `run()` at the await; concurrent-compile timing (a 3-cpu runner at load 96) decides.
  imgCycle / fb64Cycle / fb1024Churn already lived in plain functions for this reason; the
  FastBit32 loop never moved. Ladder (2026-11-19, local M-series, 12 cores, quiet-lock QUIET,
  load1 1.40-3.68): (1) node v26.8.2 replay of the seed: green. (2) "conservative stack
  scanning on in the alpha": FALSE, `--v8-options` shows the default
  `--no-conservative-stack-scanning`, as on 26.8.2. (3) probe: an async function with
  `const inst` in an inner loop then `await drain()` keeps the segment's LAST object; small
  segments (64 x 64) every segment, every tier, both nodes; T7 size (1024 x 64) segment-
  dependent, moves with --no-turbofan / --no-maglev / --no-concurrent-recompilation
  --no-concurrent-osr (the last pins segments 0-2 every run); a 7-arg call after the loop does
  not clear it (the local's own register); the same loop in a plain function gives live=0 under
  every flag set on both nodes; the MODE=stash control keeps everything. (4) real harness on the
  alpha under --no-concurrent-recompilation --no-concurrent-osr: 16/16 segments `live=1;
  fb32 seg=N cyc=1023 n=63`; default flags on the alpha 0 red of 7 (seed 3069745017 x 5, the
  other two seeds x 1); node 26.8.2 under the flags: frozen old shape pins [1,1,1,1] 3/3.
  (5) old-V8 check (maintainer-approved downloads, node 20.20.2 / 22.23.5 / 24.22.3): the
  no-concurrent flags do NOT pin the old shape on node 20 (V8 11.3) or 22 (12.4) (control BAD,
  `u5-v*-control.log`; probe-r4 / r5); `--jitless` pins it 4/4 segments on node 20 / 22 / 24 /
  26.8.2 / the alpha and the fixed shape drains to 0 on all five. Ruling 2026-11-19 "Switch to
  --jitless (Recommended)": the lane and the control run under `--jitless`.
- **Evidence.** CI 44299365353, 44080134911; b34775d; fix commit: c4fe9cf (T7-FIX).
  `.handoff/evidence/t7-alpha/ci-44299365353-macos-alpha.log`,
  `u1-node26-seed3069745017-20261119T050604.log`, `u3-flags-noconc-3069745017.log`,
  `u3-default-*.log`, `u4-task0-frozen-entry.log`, `u5-v*-control.log`, `u6-*.log`;
  `.handoff/research/t7-alpha/probe-frame-pin.mjs` (probe-r1..r5 logs).
- **Measurement trap.** A replay on a quiet host is not a reproduction: the alpha went 0 red in
  7 replays under default flags (the failing seed x 5). A tier-timing defect needs a flag that makes tiering
  deterministic, not more replays -- and that flag must be checked on every engine the gate
  runs on: --no-concurrent-recompilation --no-concurrent-osr pinned on V8 13.6+ only;
  `--jitless` (interpreter only) pins on V8 11.3 through 15.6.
- **Law.** 3, 5. Entry-level rule: a tracked object is never a local of an async function
  across an await; churn that is tracked lives in a plain function. Law 3: the gate has a
  must-fail control, `t7-frame-pin`. Law 5: the lane's child fails closed.
- **Gate.** `fb32Cycle()` plain function in `test/torture/t7-soak.mjs`; permanent PASS lane
  `test/torture/t7-frame-pin-lane.mjs` (child spawned by `test/torture.mjs` after T7 under
  `--jitless`, push volume, `MEASURE T7 frame-pin lane ...`); must-fail control `t7-frame-pin`
  in `test/torture/controls.mjs` (old inline shape under `--jitless`, expect names
  `fb32 seg=0 cyc=1023 n=63`); fidelity and lane-presence rows
  in `test/FastBit64TortureQA.test.mjs`; the survivor suffix on every T7 drain failure.

### B20. WitnessReleaseQA e2e false FAIL: the host slept inside a round (WRQA-SLEEP)

- **What happened.** Burst al's closing `npm run verify` (2026-11-19, started 06:27:05Z, node
  v26.8.2, quiet-lock QUIET at load1 2.73): `test/WitnessReleaseQA.test.mjs` "clean -> exit 0"
  (gate:release end to end, synthetic run-one) FAILED: round 1 wall=28.9s, round 2 5.6s, round 3
  `spawn error: ETIMEDOUT (timeout 120000 ms)` wall=183.7s. The other three scenarios passed.
- **Root cause.** HOST SLEEP, not a test or gate defect. `pmset -g log`: the laptop entered
  'Clamshell Sleep' on battery at 08:18:00 +0200 and cycled Maintenance Sleep / DarkWake; the
  verify started (08:27:05 +0200) inside a 6 s DarkWake (08:27:02-08:27:08 +0200), then the host slept
  08:27:08-08:27:34 (26 s, inside round 1: 28.9 = 26 + ~3) and 08:27:40-08:30:41 (181 s, inside
  round 3: 183.7 = 181 + ~3) until the lid opened. The spawnSync 120 s timer counted the sleep.
  Awake re-check (2026-11-21, 08:32-08:36Z, same M-series host, node v26.8.2, quiet-lock run,
  host PRELIMINARY: load1 9.79-13.50, other busy node(s) 101-115% (k2, k3), an IDE at 591-764% CPU;
  re-check on c4fe9cf, /opt/homebrew/bin/node v26.8.2): the file alone K = 3, 3/3 green, 60/60
  rounds recorded, no HARNESS round (45 valid + 15 host, noiseonly by design), round wall
  3.0-4.8 s (>= 25x under the timeout), file wall 62.8 / 72.6 / 66.0 s.
- **Evidence.** Verify log `.handoff/evidence/t7-alpha/verify-20261119T062705.log`; re-check
  `.handoff/evidence/burst-am/wrqa-alone-k{1,2,3}.log`; `pmset -g log` excerpt (command on line 1)
  `.handoff/evidence/burst-am/pmset-20261119-0815-0833.log`; verify run on b34775d + the T7-FIX tree.
- **Measurement trap.** The lock read QUIET (load1 2.73 < baseline 2.21 + 1) during a DarkWake: it
  measures load, not imminent sleep. A wall-clock timeout counts the sleep.
- **Ruling.** 2026-11-21 "Host sleep, no code change (Recommended)": the 11-19 verify is VOID;
  no change to the test or any SHA_FILES member (CAL-1 continues); every verify / gate run
  records `pmset -g log` sleep events over its window in provenance, and a run that spans a
  sleep is VOID (no verdict, like NOISY).
- **Law.** 9 (a run spanning a host sleep has no verdict).
- **Gate.** Process (provenance of every verify / gate run: `pmset -g log` sleep / wake lines
  over the run window). No code gate: the row's 120 s timeout is the gate's HARNESS rule.

### B21. The CAL-2 analysis tool's self-test could not fail (NIGHTLY-2 tooling)

- **What happened.** Burst an (2026-11-21) built the split-half tool that reads lane P's CAL-2
  verdict (`.handoff/research/nightly-cal/cal2.mjs`, gitignored research tooling, not in
  `npm test`) with a plain-node self-test. Review r1 ran 36 mutants on the tool: 25 survived. After
  the reviewer's fix (66 / 66 checks), review r2 found two more survivors: an Nc taken from arm A
  only passed the fixture meant to require both arms (its arm-B rounds never moved the q90), and
  `main()` aggregating the exit as "last OS wins" (an ubuntu VOID masked by a macOS MATCH) passed
  because the fixture VOIDed only the last OS. Fixed in r3: the arm-B fixture rounds span
  noise/floor 0.001..0.010, so the both-arm q90 (0.26) differs from arm A alone (0.27); and (maintainer
  ruling "Injectable analyzer") `main(argv, analyze)` takes the analyzer, and a stub VOIDs the FIRST OS
  while the second MATCHes. Review r3 confirmed the last-OS-wins, throw-as-MISMATCH and arm-A-only-Nc
  mutants are caught.
- **Root cause.** The fixtures were built to pass, not to tell the tool from a mutant: values where
  the right and the wrong computation agree, and a failure placed only where order does not
  matter. Research tooling sits outside `npm test`, so nothing else guarded the verdict it prints.
- **Evidence.** HISTORY (an); r3 state cal2.mjs sha256/8 ce779458, cal2.test.mjs c783581b,
  self-test 73 / 73 (both gitignored).
- **Law.** 3, applied to research tooling: a script whose printed verdict decides a release-track
  step needs the same must-fail controls as a shipped gate.
- **Gate.** `cal2.test.mjs` (plain node; every burst that reads CAL-2 runs it first; not in
  `npm test`). Process: a reviewer mutant pass on every change to the tool. Known gap (NEXT.md
  FILLERS): an "S drops the arm-A filter" mutant still survives.

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
  (results table empty at NIGHTLY-1; NIGHTLY-2 filled it on 2026-11-21 and 2026-11-23, D5).
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
  AND >= 1 of 20 bursts mixed (A24; A22 was >= 4, A18 >= 10; see B18). r2 rejected the verdict because it
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

### C12. Alpha leg policy: early warning, never a release block (ruling 2026-11-19)

- **What happened.** B19 was a red on the prerelease `latest` leg (node v27.0.0-alpha). The
  maintainer ruled (a) "Early warning (Recommended)": the same as LiteUtils Q-B78-LATEST
  (LiteUtils LEDGER #128, `.handoff/RULINGS-b78.md`). Keep the alpha leg in the nightly, but a
  red there never blocks a release. The red is still investigated and recorded in the LEDGER,
  and `gate:release` goes ahead once it is explained or bounded.
- **Evidence.** B19; `.github/workflows/soak-nightly.yml` header; ROADMAP section 4.
- **Unchanged.** The soak-nightly node matrix is unchanged: the `latest` legs stay.
- **Law.** 5, 9. Q-N5 still holds for the pinned legs.
- **Gate.** Process (policy); no code gate.

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
  Cost of NOT having it, a learning probe on 2026-11-23 (REPORTED, one run; darwin-arm64, node
  v26.8.2, V8 14.6.202.34-node.28, pointer compression OFF; quiet-lock run, host QUIET, load1 2.14;
  AC power, no sleep). Tools: lite-utils 1.1.0 `alloc-per-op` and a retained-bytes count with
  K = 10,000 live sets, 5 reps, median. Self-checks VALID; the two tools agree to within the
  8-byte holder slot. Measured: about 232 bytes per 100-bit set as its own `Uint32Array(4)`;
  104 + 16 as a `subarray` view into one shared buffer; 16 (the payload) as a row of one shared
  buffer addressed by offset; 968 as a lite-o1 `BitSet(100)`; 272 + 128 off-heap as a
  `FastBit1024(100)`. Reading: for many small sets the win is offset addressing, not a view
  object. That works today with a plain typed array plus FastBit32-style word ops, so it is no
  reason to reopen D2. Evidence: `.handoff/research/shared-buffer/` (RESULTS.md, bench.mjs,
  footprint.mjs, logs; gitignored).
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

- **What.** Protocol CAL-1..CAL-5 is written. NIGHTLY-2 filled the results table on 2026-11-21
  (RESEARCH 19, REPORTED): ubuntu 10 DECISIVE nights (11-12 .. 11-21), control trip rate 1.0, CAL-2
  MISMATCH on four clauses, so lane P stays REPORT-ONLY on ubuntu (maintainer ruling "Accept, wait
  macOS"). macOS was read on 2026-11-23 (its 10th DECISIVE scheduled night, 45180186968; 12 nights
  11-12 .. 11-23, 11-18 and 11-20 INCONCLUSIVE, 0 dispatches): CAL-1 holds, control trip rate 12 / 12
  = 1.0, CAL-2 MISMATCH on all five clauses (S, Nc, F, both replays). Both OSes fail for the same
  reason: a few real FLAT rows (FastBit1024.acquire (slot word) first by rounds above 6) have a
  spread tail that overlaps the subtle RED foilSubEps teeth, so no one S separates them. NIGHTLY-2 is
  complete: lane P is not calibratable on either hosted OS under this protocol and stays REPORT-ONLY on both
  (maintainer ruling 2026-11-21 "Stay report-only", given ahead of the macOS read; a macOS MATCH would
  have gated nothing). Earliest close for a push on 2026-11-07 was 2026-11-14 (with 3 dispatches) or
  2026-11-17 (RESEARCH 19 worked example). After the restart at 754292c (912bf67 changed FastBit32.js,
  a lane P pinned file), HISTORY (ac) gave `CAL-5 earliest 2026-11-17`; the window restarted again at
  70ed15a (AF-1, FastBit32.js 6bd9753e; HISTORY (ah)), so the filled window starts at the 2026-11-12
  night.
- **Evidence.** `RESEARCH.md` section 19; HISTORY (ac) NIGHTLY line; HISTORY (ao), (ar);
  `.handoff/evidence/burst-ao/cal/`, `.handoff/evidence/burst-ar/cal/`.
- **Reopen with.** A revised CAL-2 protocol (for example a per-row S, or persistently unstable rows
  moved to REPORTED) that MATCHes, per OS, on >= 10 DECISIVE nights it was not fitted to (a
  post-1.7.0 research item). The ubuntu clause set that fails moved as its window grew (11 nights: S
  passed; 12 nights: S failed, both replays passed), so a revision is judged on fresh nights only.

### D6. FastBit64 timing (p6) and 1.8.0 word-ops candidate

- **What.** p6 (interleaved A/B of five storage / kernel / branch variants) was refused by the
  quiet lock (exit 76, load1 3.24 >= baseline 2.21 + 1); SC-4's 2026-10-11 table stays the only
  timing evidence for the flat shape. A 1.8.0 word-ops candidate sits in ROADMAP (767a45b);
  its content is not in the sources read here. (2026-11-21: its research burst ran, A10, RESEARCH 23; no
  timing was taken, the quiet lock was BUSY.)
- **Evidence.** `RESEARCH.md` section 18.1 "Not measured: timing"; 767a45b.
- **Reopen with.** A quiet-lock run.

---

## E. Audit 1.7 findings

Audit 1.7 ran on the frozen commit 9cb0213 (FastBit32.js 95ab856e) with two auditors: A
(claude-opus-5-5) and B (claude-fable-5-2). Cross-checks: an Opus 5.5 sub-agent on B's findings
(independent of B by model and context, not by memory), and CONFIRM, a separate Fable 5.2 session
with fresh context and the package
memory loaded (NOT independent). Triage by the maintainer on 2026-11-10. Verdicts only here; the
evidence is in `audit/2026-11-10/RECONCILE.md`, `audit/2026-11-10/opus-5.5_FINDINGS.md` and
`audit/2026-11-10/fable-5.2_FINDINGS.md`. No cross-check refuted any finding.

### E1. Verdict table (U-1..U-21)

Verdicts are RECONCILE's Step 3 rulings. FIX BEFORE 1.7.0 = must close before `/release 1.7.0`.
A "fixed in <sha>" / "in <sha>" suffix names the commit that closed the item (or its named part).

| U | ids | severity | verdict | what |
|---|---|---|---|---|
| U-1 | B-1 A-1 A-2 | High | FIX LATER (S6); doc, pin, type rows before 1.7.0; pin + type rows in bae32d4, docs AF-3 | set object / `undefined` masks fail open |
| U-2 | B-2 A-3 | Medium | FIX BEFORE 1.7.0 (docs only); header in 70ed15a, docs AF-3 | `value` / `serialize()` documented unsigned, signed after bit 31 |
| U-3 | B-3 | Low | FIX BEFORE 1.7.0 (FIX-1); fixed in 70ed15a | `countRange(start, 31)` boxes its `>>> 0` mask |
| U-4 | B-4 A-4 | Low | FIX LATER (S6, FB-03); docs before 1.7.0 | `>>> 0` widens the `value` field; README:81 inverted |
| U-5 | B-5 | Low | FIX BEFORE 1.7.0 (FIX-5); `saveInto` fixed in 70ed15a, docs AF-3 | FastBit1024 methods do not brand-check the receiver |
| U-6 | B-6 | Low | FIX BEFORE 1.7.0 (FIX-6); fixed in bae32d4 | d.ts does not reserve FastBit1024 / BitMapper private names |
| U-7 | B-7 | Low | CARRIED (KNOWN FB-06, no ruling) | `forEachMapped(Object)` passes `undefined` as a `string` |
| U-8 | B-8 A-6 | Low | FIX BEFORE 1.7.0 (docs) | shipped README / llms.txt name files that do not ship |
| U-9 | B-9 | Low | FIX BEFORE 1.7.0 (docs) | `test:perf` called DETERMINISTIC, no workflow runs it |
| U-10 | B-10 A-7 | Low | FIX BEFORE 1.7.0 (docs) | perf claims with no tier or provenance |
| U-11 | B-11 | Info | FIX BEFORE 1.7.0 (docs) | `JSON.stringify` / `structuredClone` of FastBit64 give `{}` |
| U-12 | B-12 | Info | CARRIED (KNOWN, the `/release` step); closed by `/release` 1.7.0 (2026-11-23) | tree versioned 1.6.1 with the 1.7.0 surface |
| U-13 | B-13 A-9 | Test-gap | FIX BEFORE 1.7.0 (doc + pin; NOT FIX-13, see E2); pin in bae32d4, doc AF-3 | `FastBit64.forEach` mutation rule undocumented |
| U-14 | B-14 A-13 | Test-gap | FIX BEFORE 1.7.0 (test rows); fixed in bae32d4 | FastBit64 mutants survive `npm test` |
| U-15 | B-15 | Low | FIX BEFORE 1.7.0 (test-only pin); fixed in bae32d4 | Hygiene pin checks an initializer exists, not a Smi |
| U-16 | B-16 A-5 | Test-gap | FIX BEFORE 1.7.0 (rows + `skipLibCheck: false`); fixed in bae32d4 | d.ts mutants pass `test:types` |
| U-17 | B-17 | Test-gap | FIX BEFORE 1.7.0 (test rows); fixed in bae32d4 | no gate reads `sideEffects` / `engines` |
| U-18 | A-8 | Info | CARRIED (KNOWN FB-06, no ruling) | BitMapper duplicate name keeps the stale reverse entry |
| U-19 | A-10 | Low | FIX BEFORE 1.7.0 (docs) | README ships 21 non-ASCII code points |
| U-20 | A-11 | Info | FIX BEFORE 1.7.0 (docs) | ci.yml says "6 T6 controls"; the tree has 11 |
| U-21 | A-12 | Test-gap | FIX BEFORE 1.7.0 (test rows); fixed in bae32d4 | `FastBit64#loadFrom` reading `src.length` survives |

U-15 severity is CONFIRM's re-grade (B said Test-gap); torture kills the mutant, `npm test` does not,
and the README:624 / CHANGELOG:15-17 wording is false. Ruled separately (Q5, "Tighten the pin"):
`bareFields()` requires an integer-literal initializer for every numeric field (brand excepted), so the
docs then hold as written. Severity is overrulable by the maintainer.

### E2. Declined: snapshot FastBit64 `hi` before `forEach` (CONFIRM's FIX-13)

- **What happened.** CONFIRM proposed that `FastBit64.forEach` snapshot `#hi` before the walk, to
  close U-13 (the mutation semantics were undocumented and a mutant survived `npm test` and torture).
- **Root cause.** FastBit64 already follows FastBit1024's documented rule ("each word is read once
  (snapshot)", llms.txt:229, README:411, d.ts:823). The orchestrator ran one script on both classes:
  seeds {1, 5, 40}, the callback at 1 adds 3, removes 40, adds 50. FastBit64 visits `1,5,50` and so
  does FastBit1024. FIX-13 would make the two classes diverge.
- **Evidence.** `audit/2026-11-10/RECONCILE.md` sha256/8 b0a73dda (gitignored), audited commit 9cb0213,
  "Disputed items" (U-13) and "Fix notes".
- **Law.** Sibling classes share one documented iteration rule; fix the sentence and the pin, not
  the behaviour.
- **Gate.** PENDING: the fix burst lands the `FastBit64.forEach` doc sentence and a pin row matching
  FastBit1024's rule. `FastBit64DocsQA.test.mjs:302` claims only "ascending, terminates" until then.

### E3. Deferred designs: FIX-2 (fail closed on object arguments) and FIX-4 (FB-03 `| 0`)

- **What happened.** Two fixes were proposed and ruled out for now (Q1, Q3), both to S6. FIX-2 makes
  `equals`, `copy`, `fromArray` and the seven free iterators throw TypeError on a set object; U-1's
  mask ops are SC-3 itself and FIX-2 leaves them as they are. FIX-4 applies `| 0` at the constructor /
  `fromArray` / `deserialize` sites (U-4, FB-03).
- **Root cause.** FIX-2 pre-empts the OPEN SC-3 and trips the S5QA "identical outcomes vs 1.4.0" row;
  it is a behaviour change in a minor. FIX-4 pre-empts the OPEN SC-2 (option B is a 2.0.0 major:
  `new FastBit32(0x80000000).value` changes) and turns 7 pinned rows red (FB-03, FB-04, T1 bit 31,
  T1 bit -1, S3 parity, two-builders, S5 corpus floor) plus the parity pins. A-3's `serialize() >>> 0`
  was also refused: every bit-31 word would box on a non-inlined call (CONFIRM: 77 vs 0 scavenges per 5e6
  non-inlined calls; node v26.8.2, Apple M4 Pro, host PRELIMINARY; a count, not a timing; run count
  not stated).
- **Evidence.** `audit/2026-11-10/RECONCILE.md` sha256/8 b0a73dda (gitignored), audited commit 9cb0213,
  Step 3 Q1 / Q2 / Q3 and "Fix notes". Design context: D4 (S6 / 2.0.0: SC-2 and SC-3).
- **Law.** A behaviour change that moves pinned outcomes waits for the settle call that owns it; until
  then the docs, the type rows and named pins state today's outcome.
- **Gate.** PENDING: the fix burst lands the doc, `@ts-expect-error` and pin rows. The fixes themselves
  are D4's Reopen-with (the S6 settle calls).

### E4. Measurement trap: a tree without git history fails the git-pinned parity rows

- **What happened.** Both auditors reported 37 test failures on their copy of the tree.
- **Root cause.** The copy had no git history, so the rows that read `git show <sha>:FastBit32.js`
  at a pinned commit, or an unshipped file such as ROADMAP.md, failed. CONFIRM's full-history tree of
  9cb0213 gives 1148 tests / 1146 pass / 0 fail / 2 skip, the same as burst ae's closing verify.
  Settled, not a finding.
- **Evidence.** `audit/2026-11-10/RECONCILE.md` sha256/8 b0a73dda (gitignored), audited commit 9cb0213,
  "Test totals" paragraph and the Unproven table.
- **Law.** Compare a mutant against an unmutated copy of the same tree, never against "0 failures".
- **Gate.** None. PENDING: a rule for the next audit brief; AUDIT-BRIEF.md has none.

### E5. Process: what the second auditor added (one data point)

- **What happened.** Two auditors ran on one brief; RECONCILE's process-trial "Reading" line records:
  "the second auditor found 9 rows the first did not (6 new, 1 partly KNOWN), the first found 4 the
  second did not (3 new); neither produced a false positive. On this package a single auditor would
  have missed a quarter (B alone: 3 of the 12 new rows) to a half (A alone: 6 of 12) of the new rows".
- **Root cause.** Not applicable; this is a yield record.
- **Evidence.** `audit/2026-11-10/RECONCILE.md` sha256/8 b0a73dda (gitignored), audited commit 9cb0213,
  "Process-trial record" (including its independence
  caveats: package memory was loaded in every session, and CONFIRM is not independent).
- **Law.** One audit on one package is one data point for "is a second auditor worth it", not a rule.
- **Gate.** None: a record, not a test.

---

## Not yet covered

- Per-entry dates for several commits (git log was read without dates for most shas).
- The ROADMAP S5 ledger text for A1 (not a source for this unit).
- `.handoff/archive/HISTORY-*.md` entries before 2026-11-04 were only grepped (DESER-FIX,
  TREESHAKE-FIX, T6-FIX, SC-2 lines); the 2026-10-12 / 10-13 / 10-21 / 10-23 witness-stability
  work is summarised from CHANGELOG [1.6.0], not from those archives.
- The lite-signal v. fastbit LESSONS entries beyond the two quoted lines.
