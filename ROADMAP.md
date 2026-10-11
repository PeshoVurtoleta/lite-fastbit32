# lite-fastbit32 -- audit + roadmap (S0 harness, S1-S8 to 2.0.1)

Nine measured sessions for `@zakkster/lite-fastbit32`, modeled on
`../BLUEPRINT_ROADMAP.md` (findings with IDs, a torture spec, ordered briefs)
and `../LitePick/ROADMAP.md` (session table, settle calls, gates). Research
backing: `RESEARCH.md` (same date).

**Why it exists.** The package is published (1.2.0, 2026-04-18), small, and
used by at least three siblings (lite-ecs, lite-tween-pro, lite-depth). Reading
it, it looks finished. Running it, it is not: `hasAll` returns the wrong answer
for any mask that includes bit 31, and lite-ecs builds its system signatures in
exactly the form that triggers the bug. The test suite is 7/48 red, and nothing
gates allocation, retention or performance. Thirteen findings are in section 2.
**Every one was reproduced on 2026-10-06** (node v26.8.2), not inferred from
reading. The exception is FB-12, which is marked unmeasured.

| Session | Deliverable | Version | Kind | State |
| --- | --- | --- | --- | --- |
| **S0** | node:test port + torture T0-T9 + perf-gate + hygiene | (folds into 1.2.1) | harness, no behaviour change | DONE 2026-10-06 (uncommitted) |
| **S1** | **URGENT** `hasAll` sign-bit fix (FB-01) + sign-bit doc truth | 1.2.1 | bug fix | DONE 2026-10-06 (reviewer APPROVED, qa PASS; uncommitted, awaiting /release 1.2.1) |
| **S2** | Benchmark + constant-time witness (measure before deciding) | -- (no lib change) | measurement | **S2a DONE 2026-10-10** (reviewer APPROVED round 4, qa PASS; uncommitted). S2b (competitor matrix) planned, needed before S8 |
| **S3** | The word-math law: clz32 idiom (SC-1), branchless scans, dead coercions | 1.3.0 (folded with S4; 1.2.2 never released) | internal, output-identical | **RELEASED 1.3.0 2026-10-11** (with S4) |
| **S4** | Tier-1 API: cursor iteration, `rank`, `equals`, `set/copy`, `isSubsetOf`, `rangeMask`, `BitMapper.bit/size` | 1.3.0 | additive | **RELEASED 1.3.0 2026-10-11** (with S3) |
| **S4b** | `FastBit1024`: fixed 32 x 32 two-level bitmap, fail-closed, pool `acquire/release` (SC-5) | 1.4.0 | additive, new export | **RELEASED 1.4.0 2026-10-11** |
| **S5** | Tier-2 members, one greenlight each: `select`, `nextSubset`, `nextCombination` | 1.5.0 | additive, gated | DONE 2026-10-11 (select/nextSubset/nextCombination; reviewers APPROVED, qa PASS; uncommitted, awaiting /release 1.5.0; FastBit1024.select and reverse/rotl/rotr rejected) |
| **S6** | The input + representation law (SC-2, SC-3): canonical int32, cold-path fail-closed, checked twin | 2.0.0 | **breaking** | planned |
| **S7** | Demo: bit board, SWAR popcount, pool, ECS matcher, browser Smi probe | -- (demo/ not shipped) | demo | planned |
| **S8** | README rebuilt on the Sepforge spine + llms.txt + GUIDE recipes | 2.0.1 | docs | planned |
| **S9** | `FastBit64` (SC-4: flat lo/hi on shared word kernels) + the 64 x 64 recipe | 2.1.0 | additive, new export | planned (last chapter) |

---

## 0. Preflight -- single-file accounting

Every API change touches the same fixed set of sites. A missed site is how a
method ships typed-but-untortured.

| # | Site | What a change adds |
| --- | --- | --- |
| 1 | `FastBit32.js` | the method / function body |
| 2 | `FastBit32.js` header | surface list (ASCII only) |
| 3 | `FastBit32.js` `VERSION` | bump (version site 1 of 3; created in S0) |
| 4 | `package.json` `version` | bump (site 2) |
| 5 | `llms.txt` | API line + version stamp (site 3) |
| 6 | `FastBit32.d.ts` | the typed export, honest about signedness and `undefined` |
| 7 | `test/types/fastbit32.test-d.ts` | type-level smoke |
| 8 | `test/<Area>.test.mjs` | node:test boundary + behaviour suite |
| 9 | `test/torture/t*.mjs` | oracle fuzz (T5) + representation matrix (T2) + 0 B/op lane (T6) |
| 10 | `test/perf/PerfGate.test.mjs` | `zgcSuite` scenario + a `mustFail` teeth-check |
| 11 | `test/witness.mjs` | flatness entry (constant-time ops) or slope entry (O(k) ops) |
| 12 | `benchmark/Matrix.mjs` | subject row + raw-bitwise ratio |
| 13 | `README.md` + `CHANGELOG.md` + `decisions/00NN-*.md` | docs + the ADR |

`npm pack --dry-run` must exclude `test/`, `benchmark/`, `demo/`, `decisions/`,
`ROADMAP.md`, `RESEARCH.md`, `test-bundle.js`, and include `FastBit32.js`,
`FastBit32.d.ts`, `llms.txt`, `README.md`, `CHANGELOG.md`, `LICENSE`.

---

## 1. Shared law (every session)

1. **Zero allocation on every hot op, at every word.** "Every word" means the
   key matrix from the torture-harness skill, not a friendly `0b1010`: `0`,
   `-1`, `1 << 30`, `1 << 31`, `0xFFFFFFFF` as an unsigned double, `-2^31`.
2. **Signedness is never observable in a predicate.** Any op that takes a mask
   must answer the same for `m` and `m >>> 0`. T2 enforces this for every op.
   FB-01 exists because nothing did.
3. **Bytes in a hot body, not instructions.** A guard added to `add`/`has`/
   `hasAll` is a rejected design unless the perf gate and the witness both show
   it free. Validation lives at cold entries, `BitMapper`, or the checked twin.
4. **Fail closed at every cold boundary.** Constructor, `deserialize`,
   `fromArray`, `BitMapper` constructor: there is no hot-path excuse there.
   `null` is not zero (FB-02, FB-04).
5. **Every behaviour change carries a parity check** against
   `git show HEAD:FastBit32.js` and a gate that FAILS on the old body. Before
   `/release`, revert-check the new gates in a scratch copy.
6. **Every gate must be provably able to fail.** T9 ships a broken variant per
   gate.
7. **Measure before deciding.** No idiom, branch-removal or representation call
   is made before S2's numbers exist (SC-1, SC-2).
8. **Compare a bitwise expression only to `0`** (or to another bitwise
   expression), never to a mask, a `Uint32Array` read, a `>>> 0` value or a
   literal like `0xFFFFFFFF`. Subset is `(b & ~a) === 0`, full is `~v === 0`,
   equality is `(a ^ b) === 0`. FB-01 came back three times in fresh code
   (RESEARCH 11.2 D1-D4), so this is a grep, not a memory: any bitwise line
   matching `) === [a-zA-Z0-9]` or `) !== [a-zA-Z0-9]` needs a justification in
   review. Adopted 2026-10-10 (RESEARCH 11.3 a, open question 6); T8 gains
   "`Uint32Array`-backed subset with bit 31 per word" rows in the next
   torture-touching session.

---

## 1b. Process for this package (maintainer, 2026-10-10; local, not suite law)

Proportionate proof: the code takes minutes, so proving it must not take hours.
- REVIEW IS NOT CAPPED (maintainer, 2026-10-11: "the reviewer is very
  important, let it take its time. Quality matters most."). The reviewer gets
  the turns and rounds it needs; no turn budget, no blockers-only gag. What
  stays lean is the BUILD side: the cost was gate-on-gate infrastructure and
  threshold calibration, not review.
- Behaviour change (FastBit32.js): coder -> reviewer (as many rounds as it
  takes) -> qa, on the EXISTING torture + witness.
- Tests / benchmarks / tooling / docs: coder -> reviewer; qa when the
  reviewer asks for it.
- Research: draft + oracle fuzz + one timing, documented (the FastBit1024 model).
- No new gate infrastructure and no threshold calibration inside a feature
  session. The full witness runs once before a release on a quiet host;
  `verify` keeps witness:fast.
- coder-medium for mechanical sessions; coder (high) for design-heavy ones.

---

## 2. Verified findings

Reproduced 2026-10-06 against `main` (1052881). Severity: **S1** = silent wrong
answer or corruption, **S2** = broken documented guarantee, **S3** =
hygiene/contract gap. The probe scripts are reproduced inline so each row can be
re-run with `node -e`.

| ID | Sev | Finding | Reproduction |
| --- | --- | --- | --- |
| **FB-01** | **S1** | **`hasAll(mask)` is false whenever `mask` carries bit 31 in unsigned form.** The body `(v & mask) === mask` compares a signed int32 to an unsigned double. `BitMapper.getMask` *always* returns `>>> 0`, so any mapped mask that includes the 32nd flag never matches. Even `new FastBit32(-1).hasAll(0xFFFFFFFF)` is false. **lite-ecs `World.js:30` builds signatures as `(1 << idx) >>> 0` and calls `entity.mask.hasAll(sys.signature)`: a system that requires component 31 never runs, silently.** The README claims bit 31 is handled "correctly under the hood". | `new FastBit32().add(31).hasAll(0x80000000)` -> `false`; `new FastBit32().add(0).add(31).hasAll(m.getMask(['C0','C31']))` -> `false` |
| **FB-02** | **S1** | **`null` is zero.** `add(undefined)`, `add(null)` set bit 0; `has(undefined)` is `true` when bit 0 is set. A misspelled enum key (`flags.add(Flags.PLAYNIG)`) silently sets and reads bit 0. `fromArray([undefined, NaN, 'x'])` -> `1`; holey `fromArray([, 5])` -> `33`. The suite law, verbatim, violated. Since 1.2.1 `hasAll(undefined\|NaN\|null\|2**32)` is `true` on any instance (ToInt32 -> 0; was `false` by the FB-01 signed-compare accident in 1.2.0) -- same fail-open class, fails closed in S6. | `new FastBit32().add(undefined).value` -> `1`; `new FastBit32().hasAll(undefined)` -> `true` |
| **FB-03** | S2 | **Two representations of one set.** Constructor and `fromArray` store `>>> 0` (unsigned; a heap double for >= 2^31); every mutator stores signed int32. The same set serializes as `2147483648` or `-2147483648` depending on how it was built, so save-state equality, dedupe and hashing break. `d.ts`, README and llms.txt all document `value` as "unsigned". | `[new FastBit32(0x80000000).serialize(), new FastBit32().add(31).serialize()]` -> `[2147483648, -2147483648]` |
| **FB-04** | S2 | **`deserialize` / constructor accept garbage silently**: `'garbage'` -> 0, `NaN` -> 0, `2**32 + 1` -> 1, `1.5` -> 1. A corrupted save loads as a plausible mask. This is the one boundary where validation costs nothing. | `FastBit32.deserialize('garbage').value` -> `0` |
| **FB-05** | S2 | `countRange` has no domain: `(5, 2)` -> `27`, `(0, 32)` -> `1`, `(-1, 3)` -> `1` on a full word. Documented "caller must guarantee", but the failure is plausible numbers, not an error. | `new FastBit32(-1).countRange(5, 2)` -> `27` |
| **FB-06** | S2 | **`BitMapper` accepts duplicates and non-strings.** `['A','A','B']` -> `get('A') === 1`, `getName(0) === 'A'`: one name owns two bits and bit 0 is orphaned. `forEachMapped` passes `undefined` for an unmapped set bit while `d.ts` types the name as `string`. | `new BitMapper(['A','A','B']).get('A')` -> `1` |
| **FB-07** | S2 | **The test suite is red: 7 of 48 fail.** The iterator tests import from `'../FastBit32.d.ts'`, which has no runtime bodies -> `TypeError: forEachArray is not a function` for all seven `forEach*` free functions. `prepublishOnly` runs `vitest run`, so 1.2.0 shipped either red or with a test file edited after publish. The seven free functions have **zero** passing coverage. | `vitest run` in a scratch copy -> `48 tests, 7 failed` |
| **FB-08** | S2 | **Doc truth.** "No branches" / "Branchless": `lowest`, `highest`, `nextClearBit`, `highestClearBit` each branch. "A plain unsigned 32-bit integer": false after any mutation touching bit 31. "The fastest 32-bit flag engine in JavaScript" and four benchmark tables: no harness exists in the repo, so the numbers cannot be reproduced. Comparison rows such as FastBitSet "O(k) iteration: No" are unverified. "The only library with O(1) bit-scan": lite-o1 `BitSet` in this suite ships `firstSet`. | read README lines 11, 21-37, 74-76, 114-149, 175 |
| **FB-09** | S3 | **Idiom drift.** `Math.clz32(x) ^ 31` at 11 sites, `31 - Math.clz32(x)` at 2 (`highest`, `highestClearBit`). The three `forEachMask*` helpers coerce `>>> 0` (a no-op for `!== 0` loops, and it produces a double for >= 2^31), while `forEach` does not. | `grep -c '\^ 31'` -> 11; `grep -c '31 - Math.clz32'` -> 2 |
| **FB-10** | S3 | **Hygiene.** vitest rather than node:test. No torture, perf gate, witness, benchmark or demo. No `CHANGELOG.md` (the changelog lives inside the README), no `VERSION` export, no `LICENSE` file, no `engines`. `prepublishOnly` runs `npx esbuild`, which is not a devDep, so publish fetches it from the network, and it writes `test-bundle.js` into the package root without a gitignore entry. Non-ASCII lines: 12 in `FastBit32.js`, 38 in `.d.ts`, 28 in the README, 34 in llms.txt. The README license line names no holder. | `grep -cP '[^\x00-\x7F]'` |
| **FB-11** | S3 | **No closure-free iteration.** `forEach` with a capturing callback allocates per call: **425 scavenges over 2e6 calls** with a capturing closure, **0** with a hoisted function (measured). The README markets `forEach` as a zero-GC hot path, and the API offers no cursor alternative. | `perf_hooks` gc entries over `m.forEach(b => { a += b + i })` vs `m.forEach(noop)`, 2e6 calls; becomes S0's T6/T9 control |
| **FB-12** | S3 | **(unmeasured) Browser Smi boundary.** Under pointer compression (Chrome, Electron, Deno), Smis are 31-bit, so any word with bit 30 or 31 is a HeapNumber. On Node (32-bit Smis) `add/remove` at bits 30 and 31 measured **0 scavenges over 2e7 ops**. Chrome is unmeasured, and S7's `#measure` mode answers it. | -- |
| **FB-13** | S3 | **d.ts drift.** `value` is documented as "unsigned". `forEachMapped` types its callback name as `string` but can pass `undefined` (FB-06). `clone()` and `forEach` are not marked as allocating / closure-sensitive. `countRange` claims a return of "0-32" for any input. | read `FastBit32.d.ts` |

**Clean, and pinned so it stays clean:** `has`, `hasAny`, `hasNone`, `isEmpty`
and `isFull` compare to `0` or go through `~`, so they are signedness-agnostic.
The probed ops (`add/remove` at bits 5, 30 and 31; `count + lowest + hasAll`;
`serialize()` with a local sink; an unsigned-constructed instance) measured
**0 scavenges over 2e7 calls** on Node. S0's T6 extends this to every op.

### Consumer impact (out of package -- record, do not edit)

| Consumer | Pin | Exposed to | Action |
| --- | --- | --- | --- |
| lite-ecs | `^1.0.0` | **FB-01 live** at component index 31 | its own session: bump the floor to `^1.2.1`, add a 32-component signature test |
| lite-tween-pro | `^1.1.2` | FB-02 if a `TweenFlags` key is misspelled | none required; S6 migration note |
| lite-depth | `^1.2.0` | none (8 flags, hand-built masks) | adopt `BitMapper.bit` after S4 (optional) |
| lite-fxpro | `^1.1.1` | not inspected | inspect in S6 consumer sweep |

### Upstream gaps (tooling, not this package)

Recorded during S0 so later sessions do not re-trip them.

- **lite-gc-profiler `measureOps` is a blind budget gate under an injected
  collection.** With `stabilize: 'deep'` and a `globalThis.gc()` fired inside the
  hot fn's steady region, `measureOps(...).summary` reported
  `phases.steady.gc.major === 0`, top-level `gc.major === 0` and
  `checkNoGc(summary, {phases:{steady:{maxMajor:0}}}).verdict === 'pass'` -- the
  summary is built synchronously before the `PerformanceObserver` delivers the
  GC entry, so the major is never counted. **Pinned** by
  `test/torture/t6-alloc.mjs` (the "blind-measureOps pin", the `blindMix` block
  around line 77-91): it runs `measureOps` with a `gc()` injected in the steady
  phase and asserts the result is STILL `verdict: 'pass'` / `major: 0`. If a
  lite-gc-profiler release folds the observer before building its summary, that
  assertion goes red and must be flipped on purpose. **Consequence for this
  package:** T6's budget GATE is a MANUAL `GcProfiler` over the same mix with an
  awaited settle, then `checkNoGc(summary, {maxMajor:0, maxPauseMs:4})`;
  `measureOps` is kept only to print `bytesPerOp` as a diagnostic, never as a
  gate.

---

## 3. Settle calls

A call marked **SETTLED** here is binding on every agent (suite CLAUDE.md).
Until then it is **OPEN**, and the session named in its row decides it,
records the ADR, and flips the status.

### SC-1 -- the clz32 idiom (SETTLED 2026-10-10: B, maintainer)

**SETTLED: B** -- `31 - Math.clz32(...)` everywhere, branchless scans. Basis: S2a
measured highestClearBit at 27-64 ns today vs ~0.3 ns branchless (the one hot op
that is not constant time); for the other three scans the gap is sub-noise, so B
is chosen for uniformity and the free -1 sentinel, not speed. Binding on S3+.


The maintainer asked for consistency and named `Math.clz32(v) ^ 31` as the
example. The audit found one fact that bears on the choice, and it goes on the
table before the vote:

```
31 - Math.clz32(0)  ->  -1      // the package's "none" sentinel, for free
Math.clz32(0) ^ 31  ->  63
```

For x != 0 the two forms are identical (verified for all 32 lone bits and on a
20k-word corpus). At x == 0, only `31 -` yields `-1`. That makes all four scans
branchless (`lowest`, `highest`, `nextClearBit`, `highestClearBit`; bodies in
RESEARCH section 7, 0 oracle mismatches), and it is the only form under which
the README's "branchless" claim can be true.

- **A. `^ 31` everywhere.** Keep the four `=== 0` guards. 2 sites change.
- **B. `31 - clz32` everywhere.** Drop the four guards. 11 sites change.
- **C. Split by role.** `^ 31` inside the `v !== 0` loops, where the operand is
  provably non-zero, and `31 -` where the zero case must map to `-1`. This is
  consistent by *rule* rather than by spelling, and the rule goes in the file
  header.

**Recommendation: B.** It is one spelling with one meaning ("index of this bit,
or -1"), it removes four branches, and the suite already uses it
(lite-scheduler, lite-o1 `_bitsetCtz32`). If S2 shows no measurable win from
removing the branches, B still beats A on uniformity with the rest of the suite.
**The maintainer decides. If A is chosen, S3 implements A.**

**S2a results (reworked 2026-10-10, node v26.8.2, Apple M4 Pro; `npm run bench:sc1`,
witness finding in `benchmark/METHODOLOGY.md`).** Self-check: guarded === branchless
on 5006 words incl 0, -1, 2^31 (0 mismatches). For `lowest`/`highest`/
`nextClearBit` the gaps are -0.064..+0.121 ns: HOT branchless faster in 7 of 9
cells (+0.031..+0.121 ns), PRESSURE 7 of 9 sub-noise (one +0.058, one -0.064) --
uniformity, not speed. **But `highestClearBit` is not constant time today:** its
`~this.value >>> 0` makes a HeapNumber and `31 - clz32(thatDouble)` costs **26.9-29.8
ns HOT / 46.5-64.4 ns PRESSURE** (empty-heavy, random; 0.93 ns HOT full-heavy) **vs
~0.01-0.05 / ~0.19-0.37 ns branchless (sub-noise)**. The witness pins it EXPECTED-RED
(`FB-09/S3`: spread 40-135 x noise HOT, 17.6-89 x PRESSURE; a flat reading FAILS
the run -- S3 flips the pin). B both unifies the idiom AND removes this slow path +
the dead `>>> 0` (FB-09). The SC-1 evidence for B is decisive, not marginal.

### SC-2 -- the storage representation (OPEN, decided in S6)

- **A. Status quo, pinned.** Two forms coexist and `serialize` is unstable.
  Zero code.
- **B. Canonical signed int32.** Write `| 0` at the three cold entries.
  `serialize()` returns `>>> 0` (canonical unsigned at the I/O edge, one box per
  call, cold, documented). `deserialize` accepts both forms.
- **C. Canonical unsigned.** `>>> 0` after every mutation. **Rejected in
  advance.** It adds an op to every hot mutator and makes bit-31 words heap
  doubles on every runtime: lite-arena AR-01's lesson, run in reverse.

Recommendation: **B in 2.0.0.** It changes `new FastBit32(0x80000000).value` from
`2147483648` to `-2147483648`, which is observable, so it is a major.

**S2a results (reworked 2026-10-10, node v26.8.2, both semi-space pins = 4;
`npm run bench:sc2`).** The 2026-10-07 block ("0 scavenges for BOTH, no per-op
allocation tax") is WITHDRAWN: it ran both instances in one process (the map's
field generalized to a double, so it compared one representation with itself), its
mix inlined, and it counted window 0 only. Reworked: one process per
representation, ASSERTED with `%DebugPrint` (signed = bare Smi, unsigned =
`<HeapNumber>`); a boxing control that must scale N -> 8N (7 -> 61, both processes).
Scavenges at N = 2e6 / 8N, steady over windows 1..3: **`serialize()` through a
call site shared by >= 5 classes: signed 0 / 0, unsigned 7 / 61** (one box per call,
~16 B INFERRED from matching the HeapNumber control, not measured); inlined mix 0 / 0 for both (escape analysis); shared `count()` 0 / 0 for
both. So the unsigned form DOES carry a Node per-op tax, at the double-returning
edge only. Option B removes it as well as fixing serialize stability / equality /
hashing (FB-03). The browser pointer-compression half stays open for the demo's
`#measure` mode (S7).

### SC-3 -- the input law for raw bit indices (OPEN, decided in S6)

- **A. Permissive + pinned.** Today's behaviour: modulo 32, `null`/`undefined`
  map to bit 0. Every case gets a named T1 test, and the docs say it in the first
  screen.
- **B. Hot-path guard.** Allowed only if S2's witness and the perf gate show 0
  cost after inlining. Expected to fail law 3.
- **C. Cold-path fail-closed + `BitMapper` front door + opt-in
  `CheckedFastBit32`.** Hot ops stay permissive (A), every cold entry throws on
  bad input, `BitMapper.bit(name)` is the documented safe path, and a checked
  twin validates every call for development builds.

Recommendation: **C.** It honours both laws without trading one for the other.

Recorded argument (2026-10-10, RESEARCH 11.3 b): **"trust the caller" does not
scale past one word.** In one word a bad index damages one bit (FB-02). Under a
summary word it damages OTHER answers -- RESEARCH 11.2 D13 (`lowest()` invents a
bit in an empty set) and D14 (`lowest`/`forEach` lose a member `has()` still
reports). So C's permissive hot ops are defensible here and only here; any future
multi-word or summarized helper fails closed on every mutator (lite-o1 `BitSet`,
ADR 0019 call 4), and must not cite this SC as precedent.

### SC-4 -- `FastBit64` (SETTLED 2026-10-11, maintainer: build it, last chapter)

**SETTLED: a flat `FastBit64`** -- ONE object, two int32 fields (`lo`, `hi`),
every body written on shared single-word kernels (the RESEARCH section 4 Tier-3
"word kernel": `ctz32`, `popcnt32`, ... as free functions V8 inlines). NOT two
FastBit32 instances behind an orchestrator: the orchestrator is not light (every
cross-word op -- lowest/highest, nextClearBit, the nextSetBit cursor across bit
31->32, rank, ranges, hasAll on a 64-bit mask -- must be written in it anyway)
and it costs an extra dependent load per op.

Measured (2026-10-11, node v26.8.2 arm64, load ~4.6 so read as ratios; 10k
entities x 12 random bits, hasAll(signature) over all, one process per shape):

| Shape | B/entity | hasAll | lowest |
| --- | --- | --- | --- |
| flat FastBit64 (lo/hi fields) | 50 | 1.05 ns | 0.82 ns |
| 2 x FastBit32 + orchestrator | 115 | 2.24 ns | 1.01 ns |
| FastBit1024(64) (exists, 1.4.0) | 403 | 4.1 ns | 2.0 ns |

Probe: `benchmark/experiments/fb64-shapes.mjs` (research only). Re-run after the
1.4.0 release (load 3.3-3.6, two processes per shape): flat 0.96-1.00 / 0.75-0.95
ns, composed 1.80-1.95 / 0.98-1.03 ns, FastBit1024(64) 4.41-4.46 / 1.89-1.92 ns
(hasAll / lowest); same B/entity. The ratios hold.

Scheduled as **S9, the last chapter** (after S8): it follows the 2.0.0 input
law (S6) and costs little to build and measure. A 64 x 64 = 4096 structure is
NOT a class: it ships only as a README/GUIDE recipe in S9 (64 FastBit64 words +
`active`/`full` FastBit64 summaries, the FastBit1024 shape one size up). Beyond
that is lite-o1 `BitSet` (3 levels, fan-out 32); its missing `firstClear` is
the RESEARCH 11.4 handoff, decided in lite-o1. 32 x 32 x 32 is not built here.

### SC-5 -- `FastBit1024` in this package (SETTLED 2026-10-10, maintainer)

- **A. Export `FastBit1024` from `FastBit32.js`.** (chosen)
- B. Hand the idea to lite-o1 `BitSet` as `firstClear` / `nextClear` only.
- C. A lowest-slot policy in lite-object-pool.

**SETTLED: A.** Reasons: the section 4 boundary excludes multi-word bitsets of
*arbitrary capacity*; a fixed 32 x 32 geometry is not that. It is built only
from this package's word idioms, every op stays loop-free, and the section 2
witness applies (amended, see a; draft measured flat: `nextClearBit` ~0.5 ns with the
free slot in word 0 or behind 31 full words, vs 0.50 / 8.66 ns for the
SparseBit1024 draft; RESEARCH 11.2, 13). Binding consequences:
1. **`FastBit1024` fails closed on every index from day one** (RESEARCH 11.3 b,
   SC-3 recorded argument): one `(i & 1023) !== i || i >= cap` check per call,
   cold `RangeError`, `release` of a free slot throws. The two classes in one
   package therefore have DIFFERENT input laws (SC-3 is open, decided in S6); the README says so in
   one sentence and links SC-3/SC-5.
   **Amended 2026-10-11 (maintainer, during S4b review):**
   a. The witness gates FastBit1024 in HOT only; its PRESSURE rows are
      INFO-only (a same-word control showed host noise: identical data spreads
      as much as the real sweep; no word-dependent miss was observed). acquire/has use the SLOT_SLOW estimator,
      justified by foil equivalence (METHODOLOGY).
   b. `nextSetBit(from)` checks `(from & 2047) !== from || from > cap`
      (domain 0..capacity); every other index uses the one-check form above.
   c. `hasAll`/`hasAny` throw TypeError on a non-FastBit1024 argument,
      including an instance from a second installed copy (instanceof brand).
   d. Symbol / BigInt / null-proto inputs throw TypeError from `&` before the
      RangeError path (cold, before any write); every bad capacity, Symbol/BigInt
      included, throws RangeError from the ctor. Fields are `_cap/_n/_active/_full/_data`, internal.
2. `Int32Array` storage; every bitwise compare is to `0` (law 8).
3. Four invariants kept by every mutator (active, full, exact count, nothing
   stored at or above capacity); torture T0 checks all four after every op.
4. Not a general bitset: no resize, no capacity above 1024, no `and/or/xor`
   with arbitrary sizes. Anything bigger is lite-o1 `BitSet`.
5. SC-4 (`FastBit64`) is separate (SETTLED 2026-10-11 as S9): for 33-64 component
   signatures, two plain fields still beat any array-backed class.
Draft + oracle checker: `benchmark/experiments/fb1024-draft.mjs`,
`fb1024-check.mjs` (RESEARCH section 13).

---

## 4. Session order

```
S0 --> S1 --(release 1.2.1)--> S2 --> S3 + S4 --(1.3.0)--> S4b --(1.4.0)--> S5 --(1.5.0)--+
                                 |                                                   |
                                 +--------------------> S7 (demo, uses S2 kernels) <--+
                                                                                     |
                                                     S6 --(2.0.0)--> S8 --(2.0.1) <--+
                                                                          |
                                                                          +--> S9 --(2.1.0) FastBit64
```

- **S0 blocks everything.** Without the harness, nothing below can be proven.
  It does not release on its own. Its output ships inside 1.2.1.
- **S1 is urgent.** It is the only session fixing a silent wrong answer in a
  published package with a live consumer. Cut 1.2.1 as soon as S1's gates pass.
- **S2 blocks S3 and S6.** SC-1 and SC-2 are measured decisions.
- **S4 and S5 may run before or after S6.** Every Tier-1/Tier-2 body is
  signedness-agnostic by construction (verified on both forms), so the
  representation change does not invalidate them. If S6 is pulled forward, S4/S5
  renumber to 2.1.0/2.2.0.
- **S5 is a queue, not a block.** Each member is greenlit individually and may
  be rejected into the ledger.
- **S7 runs any time after S4.** It needs the cursor API for the pool panel and
  S2's corpora for `#measure`.
- **S8 is last.** The README describes the shipped package, with S2's numbers.

---

## 5. The torture suite (`test/torture.mjs`) -- spec

One harness, ten tiers, the BLUEPRINT layout. Built in S0, extended by every
later session.

```
test/
  torture.mjs           # entry: guard gc, run tiers in order, print exactly "ok", exit 0/1
  torture/
    harness.mjs         # xorshift32, key matrix, scratch, zero-alloc lane, gc wrappers
    oracle.mjs          # Uint8Array(32) model + naive loops; shares NO code with the lib
    t0-laws.mjs         # metamorphic algebra
    t1-degenerate.mjs   # every op x every bad bit/mask/value, pinned
    t2-representation.mjs  # every op x {signed, unsigned} value x {signed, unsigned} mask
    t3-adversarial.mjs  # pool fill/drain, 32-component ECS, full-word edges
    t4-mapper.mjs       # BitMapper abuse
    t5-fuzz.mjs         # differential fuzz vs oracle
    t6-alloc.mjs        # 0 B/op lanes incl. the Smi key matrix + closure control
    t7-soak.mjs         # lite-leak retention churn
    t8-cross.mjs        # consumer patterns: lite-ecs, lite-depth, lite-scheduler
    t9-controls.mjs     # every gate above, deliberately broken, must fail
```

### Harness rules

- The entry fails fast if `globalThis.gc` is absent and prints the remedy, not a
  stack trace. Import the devDeps after the guard, so a fresh clone without
  `npm install` gets a fix-it message.
- Pin `--min-semi-space-size=4 --max-semi-space-size=4` and assert both are
  set. If they are not, fail closed.
- All corpora, scratch instances and oracles are allocated **once**, outside
  every loop. Failure messages are built only on failure.
- Seeded xorshift32. On failure, print the seed and the op index.
  `TORTURE_SEED=... npm run torture` replays it.
- lite-gc-profiler: one measurement at a time, never nested. Unknown rule keys
  throw. `allowInconclusive` is never the fix.
- `await` a settle tick before reading `summary()`.

### T0 -- metamorphic laws

Over the fuzz corpus, both representations:

- `union`/`intersect`/`difference` match the set algebra. De Morgan holds:
  `~(a | b) === (~a & ~b)`.
- `count(v) === countMasked(v, m) + countMasked(v, ~m)`.
- `countRange(s, e) === countMasked(rangeMask(s, e))`.
- `lowest() === toArray()[0] ?? -1` and `highest() === toArray().at(-1) ?? -1`.
- `nextClearBit(v) === lowest(~v)` and `highestClearBit(v) === highest(~v)`.
- `isFull() <=> count() === 32` and `isEmpty() <=> count() === 0`.
- `hasAll(m) <=> countMasked(m) === count(m)`.
- `hasAny(m) === !hasNone(m)`.
- `forEach` visits exactly `count()` bits, ascending, and matches `toArray()`.
- `deserialize(serialize(x))` equals `x` as a set (`(a ^ b) === 0`).
- After S4: cursor iteration equals `forEach`, `rank(lowest()) === 0`, and
  `select(rank(b)) === b` for every set bit b (S5).

### T1 -- degenerate values (pin the actual answer)

Cross every op with bit inputs `0, 31, 32, 33, -1, -0, 1.5, NaN, Infinity,
undefined, null, '3', 2**31, 2**32`, mask inputs `0, -1, 0xFFFFFFFF, 2**32,
NaN, undefined`, and constructor/`deserialize` inputs `'garbage', NaN, 1.5,
2**32 + 1, -1, null, {}`. **S0 pins today's answers** (FB-02, FB-04, FB-05
included). S6 re-pins them under SC-3. A row that says "returns 1 for
`undefined`" is a valid contract. An unpinned row is not.

### T2 -- the representation matrix (this is where FB-01 lives)

| Value built by | Mask passed as | Status today |
| --- | --- | --- |
| `add()` (signed) | signed (`1 << 31`) | correct |
| `add()` (signed) | unsigned (`>>> 0`, `getMask`) | **`hasAll` BROKEN (FB-01)** |
| constructor (unsigned) | signed | correct |
| constructor (unsigned) | unsigned | **`hasAll` BROKEN when bit 31 in mask** |
| `fromArray` | both | as constructor |

Every op that takes a mask crosses all four rows over the key matrix. Equality
between two instances is checked as `(a ^ b) === 0`, never `===` on `value`.

### T3 -- adversarial sequences

- Pool: fill 32 slots with `nextClearBit`, free in random / ascending /
  descending order, refill. Assert the occupancy word matches the oracle and
  `isFull` flips exactly at 32.
- ECS: 32 components, every system signature of size 1, 2 and 32, including
  index 31. Every entity mask either matches the oracle or the gate fails.
- Toggle storms on bit 31 alone, and on bits 30 + 31 (the Smi edges).
- `fromArray` with 32 indices in reverse order, with duplicates, and with every
  index.

### T4 -- BitMapper abuse

33 names; duplicates; non-string names (`1`, `null`, `{}`); prototype-shaped
names (`'__proto__'`, `'constructor'`, `'toString'`); `get` on an unknown name;
`getName(-1 | 32 | 1.5 | NaN)`; `getMask([])`; `getMask` with an unknown name
mid-list (must throw before returning anything). Each case gets a decided
policy: **throw**, **documented no-op**, or **documented value**. "Silently
returns garbage" is not one of the three.

### T5 -- differential fuzz vs the oracle

200k mixed ops (`add/remove/toggle/union/difference/intersect/clear` plus every
query) against `Uint8Array(32)` with naive loops. After each query, compare.
Every 64th op re-derives the word from the oracle and checks `serialize()`
equality as a set. Any divergence prints the seed, the op index and a replay
line. Strict mode (every op) runs in CI; fast mode (every 16th op) runs locally.

### T6 -- the zero-alloc gate

- **Budget lane** (lite-gc-profiler): a MANUAL `GcProfiler` over 200k mixed hot
  ops with an awaited settle, then `checkNoGc(summary, { maxMajor: 0,
  maxPauseMs: 4 })`. NOT `measureOps`: under an injected steady `gc()` its
  `.summary` is built before the PerformanceObserver fires, so its `checkNoGc`
  is blind and would pass a real collection (see section 2 "Upstream gaps" and
  the blind-measureOps pin in `t6-alloc.mjs`). `measureOps` is kept only to
  print `bytesPerOp` as a diagnostic, never as the gate.
- **Steady-state B/op lane** (torture-harness skill): new-space delta over K
  ops with no GC in the window, minus an empty-loop baseline. The minimum over
  windows 1..n-1, with window 0 printed and never floored on. Gate: **0 B/op,
  gated as < 0.1 B/op measured (noise floor +/-0.02)**. Run it once per word in
  the key matrix (`0`, `-1`, `1<<30`, `1<<31`, `0xFFFFFFFF` unsigned, `-2^31`)
  and once per representation.
- **Megamorphic control:** the same ops called through ONE call site shared by
  >= 5 classes, so inlining cannot hide a box.

### T7 -- soak and retention

`leak_cycles: 4096` cycles, each building a `BitMapper` + 64 `FastBit32`, running
the ops, and dropping everything. The lite-leak tracker returns to `size() === 0`.
The held-value contract applies: neither the cleanup nor the tag closes over the
target. Sample the heap across cycles, never within one.

### T8 -- cross-package conformance (copied patterns, never imports)

- **lite-ecs:** `sig = (1 << idx) >>> 0` for idx 0..31, then `mask.hasAll(sig)`.
  Fails on 1.2.0 at idx 31. This is the executable form of FB-01.
- **lite-depth:** `1 << mapper.get(name)` into a `Uint32Array` lane, then read
  back through `new FastBit32(lane[i])`. `has` must agree.
- **lite-scheduler:** `31 - Math.clz32(x & -x)` equals `lowest()` on every
  non-zero word.

### T9 -- controls (the gate must be able to fail)

| Control | Must fail |
| --- | --- |
| `hasAll` with the 1.2.0 body `(v & m) === m` | T2, T8 (lite-ecs row) |
| `forEach` with a capturing closure in the loop | T6 steady-state lane |
| an oracle with one bit flipped | T5 |
| an instance stashed on `globalThis` per cycle | T7 (tracker non-empty) |
| `lowest()` with the guard removed under `^ 31` (returns 63 on empty) | T0 / T1 |

If a control passes, its gate is decorative and the session is not done.

---

## 6. The briefs

===============================================================================
# S0 -- harness: node:test + torture + perf-gate + hygiene (no behaviour change)
===============================================================================

```markdown
---
package: "@zakkster/lite-fastbit32"
version_target: (unreleased; ships inside 1.2.1)
status: planned
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: ["@zakkster/lite-gc-profiler@^1.16.0", "@zakkster/lite-leak@^1.10.0", "@zakkster/lite-perf-gate@^1.4.3"]
findings: [FB-07, FB-10, FB-13 (partial)]
blocks: [S1, S2, S3, S4, S5, S6, S7, S8]
---

# lite-fastbit32 -- make the package provable before changing it

PURPOSE
  The suite is vitest, 7/48 red, and gates nothing but examples. Port it, fix the
  broken import, build the harness, and pin today's behaviour (bugs included)
  so later sessions change it on purpose.

TASKS
  - Port test/FastBit32.test.js to node:test (`node:test` + `node:assert/strict`),
    split by area: test/FastBit32.test.mjs, test/BitMapper.test.mjs,
    test/Iterators.test.mjs. Keep all 48 cases. Fix the iterator import to
    '../FastBit32.js' (FB-07). Remove vitest from devDependencies.
  - Pin today's answers (T1 rows) as passing tests. Register FB-01 as a
    `todo` with its reproduction. Do NOT fix it here.
  - Build test/torture.mjs + test/torture/* per section 5: T0, T1, T2, T3,
    T4, T5, T6, T7, T8, T9 all registered. Expected-red T1/T2/T3/T5/T8 rows for
    FB-01 run as `todo` and flip in S1 (an in-place fix greens every one; the
    `hasall-fixed` control proves it, so there is no second FB-01 defect class).
  - test/perf/PerfGate.test.mjs: lite-perf-gate `zgcSuite` with one scenario
    per hot op group (single-bit, mask, popcount, scan, forEach with a hoisted
    callback), a `grows` counter of 0, and `mustFail` = forEach with a
    capturing closure.
  - Hygiene (FB-10): CHANGELOG.md (move the README changelog into it,
    add 1.2.1 Unreleased), `export const VERSION = '1.2.0'` (three-place sync),
    LICENSE (MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>),
    `engines: { node: ">=18" }`, esbuild as a devDep for bundle-check, write the
    bundle to a gitignored path, and add `test-bundle.js` to .gitignore.
    Update `files[]` (+CHANGELOG.md, +LICENSE).
  - ASCII sweep of FastBit32.js, FastBit32.d.ts and llms.txt (em dash -> `--`,
    arrows -> `->`, the warning emoji -> `WARNING:`). The README is rebuilt in S8,
    so only make it ASCII here if the edit is mechanical.
  - Scripts, mirroring lite-logn:
      test        node --test test/*.test.mjs
      torture     node --expose-gc --min-semi-space-size=4 --max-semi-space-size=4 test/torture.mjs
      test:perf   node --expose-gc --max-semi-space-size=4 --test test/perf/PerfGate.test.mjs
      test:types  tsc -p test/types/tsconfig.json
      verify      npm test && npm run test:types && npm run torture && npm run test:perf
      prepublishOnly  npm run verify && npm run bundle-check
  - Keep the uncommitted package.json diff ("module", "node" condition,
    "funding") as is.

ASSERTIONS
  - `npm test` green: 48+ passing, 0 failing, FB-01 todos listed.
    `grep -r vitest` returns only CHANGELOG history.
  - `npm run torture` prints exactly "ok" and exits 0.
  - Each T9 control exits non-zero on its own (run via env flag
    TORTURE_CONTROL=<name>).
  - `npm run test:perf` green, and the mustFail scenario trips.
  - `grep -cP '[^\x00-\x7F]' FastBit32.js FastBit32.d.ts llms.txt` -> 0 0 0.
  - `npm pack --dry-run`: includes CHANGELOG.md and LICENSE; excludes test/,
    ROADMAP.md, RESEARCH.md, test-bundle.js.
  - `git diff HEAD -- FastBit32.js` shows only comment/ASCII changes plus the
    VERSION line. Every function body is byte-identical (diff the bodies).

MEASURE (record in CHANGELOG Unreleased)
  T6 B/op per key-matrix word; perf-gate scavenges at N and kN; test count.

NON-GOALS
  No behaviour change, no fixes, no new API.

DONE WHEN
  node:test green; torture "ok"; every control fails; bodies unchanged
```

===============================================================================
# S1 -- 1.2.1 -- URGENT: `hasAll` and the sign bit (FB-01)
===============================================================================

```markdown
---
package: "@zakkster/lite-fastbit32"
version_target: 1.2.1
status: planned
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
peers: []
findings: [FB-01, FB-08 (sign-bit claims only)]
depends_on: [S0]
---

# lite-fastbit32 -- a 32-component ECS silently loses its 32nd system

PURPOSE
  `hasAll` is the ECS query op. For any mask carrying bit 31 in the unsigned
  form that BitMapper.getMask always returns, it answers false. lite-ecs hits
  this at component 31. Fix one line and prove it everywhere.

TASKS
  - `hasAll(mask) { return (~this.value & mask) === 0; }`
    (RESEARCH section 7: 0 mismatches over 800k signed/unsigned mixes).
  - Flip the S0 todos (T2 rows, the T8 lite-ecs row, the FB-01 unit
    reproduction) to hard assertions.
  - Parity: for every (value, mask) in the T5 corpus where the old body was
    correct (no bit 31 in mask), the new body gives the same answer. Where the
    old body was wrong, assert that the new answer matches the oracle.
  - Revert-check: run the T1/T2/T3/T5/T8 gates against `git show HEAD:FastBit32.js`
    in a scratch copy. They MUST fail.
  - Docs truth (sign bit only): fix the README "handles this correctly under the
    hood" paragraph and the matching llms.txt and d.ts text. Keep the
    recommendation to prefer `>>> 0` for display, and drop the "keep components
    to 0-30" advice, because it was a workaround for this bug.
  - CHANGELOG 1.2.1: Fixed FB-01, Fixed FB-07 (test import), Added
    harness (S0).
  - Record the consumer impact for lite-ecs in CHANGELOG "Notes for
    dependents". Do NOT edit lite-ecs from this session.

HOT PATH
  Same op count (not + and + compare). The perf gate and T6 must show
  0 B/op, unchanged from S0's numbers.

ASSERTIONS
  - `new FastBit32().add(31).hasAll(0x80000000) === true`
  - `new FastBit32(-1).hasAll(0xFFFFFFFF) === true`
  - every getMask over a 32-name mapper matches the oracle under hasAll
  - the T9 control (old body) fails T2 and T8
  - torture "ok", perf gate green, `npm run verify` green

DONE WHEN
  /release 1.2.1 passes; revert-check proves the gate has teeth
```

### S1 execution plan (pre-staged 2026-10-06 against the S0 tree -- go straight to coder)

Planner step is done; this is the coder's task list. Line numbers are from the
S0 working tree and may drift by a few lines.

PRECONDITION: the maintainer has committed S0, so `git show HEAD:FastBit32.js`
is the 1.2.0 body + VERSION. Parity and revert-check run against that HEAD.

```
CODE (the only library change)
  1. FastBit32.js:38-40  hasAll(mask) { return (~this.value & mask) === 0; }
     Nothing else in FastBit32.js changes (parity: every other body identical).

TESTS -- flip FB-01 from expected-red to ordinary oracle truth
  2. test/Pinned.test.mjs:59,63,67  drop `{ todo: ... }`; the three cases
     become hard asserts (true). Update the header comment at :4.
  3. Torture tiers: remove the expected-red machinery for FB-01, keep the rows
     as ordinary oracle checks (lib must equal oracle, else fails.push):
       t1-degenerate.mjs:196-212   regenerate the golden table with
                                   test/torture/gen-t1.mjs against the NEW
                                   FastBit32.js; the diff vs the S0 table must
                                   be exactly the 4 C5 hasAll rows (assert it,
                                   paste the diff in the handback)
       t2-representation.mjs:80-83 isC5 branch -> plain compare
       t3-adversarial.mjs:60       idx-31 row -> plain compare
       t5-fuzz.mjs:62-65,80-81     isC5 branch -> plain compare; the
                                   "c5count must be > 0" check is deleted
       t8-cross.mjs:25-26          idx-31 lite-ecs row -> plain compare
     Each tier stops returning fb01Red; test/torture.mjs:142-151,176 drops the
     FB-01 tally lines (keep totalGreen machinery only if another expected-red
     class still uses it -- the highestClearBit lane does, so keep it generic).
  4. t0-laws.mjs:61-63  the hasAll<=>popcount identity is scoped to bits 0..30
     to dodge FB-01: widen to the full word (bit 31 included).
  5. Controls: rename 'hasall-fixed' -> 'hasall-old' (controls.mjs:56). It now
     installs the 1.2.0 body `(this.value & m) === m` (subclass + clone() +
     static deserialize() overrides, same technique as today) and MUST fail
     T1, T2, T3, T5, T8 (every-tier rule). Update controls-runner expectations
     and test/TortureGuards.test.mjs if it names the control.
  6. test/torture/gen-t1.mjs: no change unless its FB-01 tagging needs removal.

REVERT-CHECK (suite law)
  7. Scratch copy with HEAD's FastBit32.js + the NEW tests: npm test must FAIL
     (the 3 Pinned cases) and torture must FAIL in T1/T2/T3/T5/T8. Record the
     counts in the handback.

DOCS (sign-bit truth only; README rebuild is S8)
  8. FastBit32.d.ts:94 doc "Equivalent to (value & mask) === mask" ->
     "(~value & mask) === 0 -- signedness-agnostic: m and m >>> 0 answer the
     same".
  9. llms.txt:55 same formula fix; llms.txt:180 sign-bit note: predicates
     (has/hasAll/hasAny/hasNone/isEmpty/isFull) are signedness-agnostic; only
     `.value` and serialize() comparisons need `>>> 0` (FB-03, S6).
 10. README.md:175 rewrite the bit-31 warning: drop "handles this correctly
     under the hood" and the "keep components to 0-30" advice; state that
     1.2.1 fixes hasAll for masks with bit 31 (link CHANGELOG).
 11. CHANGELOG.md: rename [Unreleased] -> [1.2.1] - <date>. Fixed: FB-01
     (with the reproduction and the C5 generalisation: any non-int32 mask
     whose true answer is true -- 0x80000000, 0xFFFFFFFF, NaN/undefined/2**32
     now follow ToInt32 like every other op). Move FB-01 out of "Known /
     pinned". "Notes for dependents": lite-ecs World.js:30 signature at
     component 31 now matches; bump floor to ^1.2.1. Update the test counts
     from the final run.

VERSION (via /release 1.2.1, not by hand): FastBit32.js VERSION, package.json,
llms.txt stamp -- three-place sync.

GATES (numbers to report)
  npm test: 0 fail, 0 todo (the 3 FB-01 todos are gone)
  npm run -s torture 2>/dev/null -> ok; no FB-01 tally lines; highestClearBit
    expected-red lanes unchanged (~32 B/op, still red -- S6)
  torture:controls: hasall-old fails T1,T2,T3,T5,T8; all others unchanged
  test:perf 19/19, mask scenario still 0/0 scavenges (the new body is
    not + and + compare -- no allocation possible, confirm anyway)
  npm run verify exit 0; parity: only hasAll differs from HEAD
```

Pipeline economy: coder -> reviewer -> qa, one round each if possible. The
reviewer's focus list: (a) only hasAll changed; (b) every former expected-red
row is now a hard oracle check, none silently deleted (row counts before/after
per tier); (c) hasall-old has teeth in every listed tier; (d) T1 golden diff is
exactly 4 rows; (e) CHANGELOG/README/llms/d.ts claims match the code.

===============================================================================
# S2 -- benchmark + constant-time witness (measurement, no lib change)
===============================================================================

```markdown
---
package: "@zakkster/lite-fastbit32"
version_target: -- (benchmark/ and test/witness.mjs are not shipped)
status: planned
peers: ["fastbitset", "typedfastbitset", "bitset"]   # devDeps, benchmark only
findings: [FB-08 (numbers), FB-12 (Node half)]
depends_on: [S1]
blocks: [S3, S6, S8]
---

# lite-fastbit32 -- replace the unbacked numbers with reproducible ones

PURPOSE
  The README's benchmark tables have no harness. SC-1 and SC-2 are perf
  questions. Measure first, decide second.

TASKS
  - Harness rule (learned 2026-10-06, RESEARCH section 2): every subject runs
    in its OWN process behind a MONOMORPHIC call site, timed as best-of-N
    minus an empty-loop floor. A shared `bench(fn)` site does not inline and
    measures call overhead (the first probe read SWAR at ~4 ns; inlined it is
    ~0.45 ns). A harness self-check asserts the floor is subtracted and that
    two runs of the same subject agree within the stated tolerance.
  - Two cache lanes for every popcount/scan subject: L1-HOT (tight loop) and
    CACHE-PRESSURE (each op also streams a buffer much larger than the last
    cache level, e.g. 32 MB at a 4099-word stride). Report both. A subject
    that is flat hot but density-dependent under pressure is NOT constant
    time, and the report says so in its row.
  - test/witness.mjs (RESEARCH section 2): density sweep 0..32, position
    sweep 0..31 + {0, -1}, iteration slope over k = 0..32, run in BOTH cache
    lanes, and the five foils: Kernighan's popcount (`v &= v - 1` loop),
    the 16-bit lookup table (64 KB; flat when hot, data-dependent under
    cache pressure -- it MUST fail flatness in the pressure lane), the
    32-iteration early-exit loop, the naive lowest scan, and Set<number>.
    Gate the flatness ratio and the slope fit. Every foil MUST fail
    flatness in at least one lane, which is the witness's own teeth.
    Reproduce the RESEARCH section 2 popcount table under the real harness
    and replace its ad-hoc numbers.
  - benchmark/ modeled on ../LiteLogN/benchmark: Harness.mjs, Matrix.mjs
    (subjects: raw bitwise, FastBit32, fastbitset, typedfastbitset, bitset,
    Set<number>, the popcount candidates -- SWAR (shipped), 8-bit LUT,
    16-bit LUT, nibble LUT, Kernighan -- and the naive foils), Report.mjs,
    results.json stamped with process.version + V8 version + seed + lane.
    Every row is reported as a ratio to raw bitwise (the abstraction tax).
    The popcount rows exist to keep the "why SWAR" decision on the record,
    not to ship a second implementation.
  - The SC-1 experiment: a scratch build with the four branchless scans
    (RESEARCH section 7) vs the current guarded scans, on empty-heavy,
    full-heavy and random corpora. Record ns/op and the gap. No lib change.
  - The SC-2 experiment: signed-canonical vs unsigned-constructed instances
    in the same loop (the field-representation question, Node half).
  - Verify or strike each README comparison-table row against the libs'
    current APIs. Record the verdicts in benchmark/METHODOLOGY.md.

ASSERTIONS
  - `npm run witness` green; each foil fails flatness when run alone; the
    16-bit LUT foil fails in the cache-pressure lane specifically.
  - SWAR `count()` is flat in BOTH lanes. If the hot lane shows the 16-bit
    LUT faster, the report states the margin and the pressure-lane result
    side by side (no LUT member ships: RESEARCH section 2 verdict).
  - `npm run bench` writes results.json with a version stamp; the report
    build fails without one.
  - METHODOLOGY.md states the 32-bit-subset caveat in its first line.

MEASURE
  abstraction tax per op; flatness ratio per op per cache lane; forEach
  slope + intercept; popcount candidates per lane; SC-1 gap; SC-2 gap.
  These numbers are the only ones S8 may print.

NON-GOALS
  No edit to FastBit32.js.

DONE WHEN
  witness green with teeth; results.json reproducible on a second run within
  the stated tolerance
```

### S2 execution plan (pre-staged 2026-10-06 after 1.2.1 -- go straight to coder)

S2 is the largest session left and is measurement-only, so it is SPLIT to fit
a token budget. Each half is independently shippable (neither touches
FastBit32.js; neither releases). Run S2a first: S3 and S6 need only its numbers.

```
S2a -- the witness + the SC-1/SC-2 experiments (the decision inputs)
  1. test/witness/run-one.mjs: ONE subject x ONE op x ONE lane per process,
     argv-driven, a monomorphic call site, best-of-5 minus an empty-loop floor
     (shape proven by the RESEARCH section 2 probe). Prints one JSON line.
     Both semi-space pins + --expose-gc NOT required (timing, not GC).
  2. test/witness.mjs: the driver. Spawns run-one per cell, collects JSON:
       density sweep 0..32 and position sweep 0..31 + {0, -1} for every
       constant-time op (count, countMasked, countRange, lowest, highest,
       nextClearBit, highestClearBit, has, hasAll, hasAny, hasNone, isEmpty,
       isFull); iteration slope k = 0..32 for forEach + the 7 free iterators;
       lanes HOT and PRESSURE (32 MB stream, 4099-word stride).
     Gates are NOISE-RELATIVE (superseded 2026-10-10 by the S2a rework: units of the run's own measured NOISE, see benchmark/METHODOLOGY.md; never a frozen absolute-ns constant):
       flatness = max/min ns-per-op across the sweep, per op, per lane;
       slope fit for O(k) ops (R^2 floor + intercept bound).
     CALIBRATE, then FREEZE (lite-logn D-02 pattern): the first full run
     measures; the floors are frozen as constants at calibration + a stated
     margin, with the calibration numbers pasted in a comment. Record them in
     benchmark/METHODOLOGY.md (no ADR -- decisions/0001 stays reserved for
     SC-1 in S3).
     Teeth: the five foils (Kernighan, 16-bit LUT [must fail PRESSURE],
     early-exit loop, naive lowest scan, Set<number>) MUST fail flatness;
     a foil that passes fails the run.
     Self-checks: a repeated cell agrees within tolerance; the floor is
     subtracted; a cell reading <= 0 after floor subtraction is flagged, not
     silently clamped (a dead-code-eliminated loop reads ~0 -- sink the result
     into an Int32Array slot).
     Runtime budget: <= 90 s on the maintainer's machine; if over, add
     `witness:fast` (one lane, coarser sweep) and keep the full run out of
     verify. Script: "witness": "node test/witness.mjs".
  3. SC-1 experiment (benchmark/experiments/sc1-scans.mjs, scratch copy of
     the scans, NOT a lib edit): guarded `clz32 ^ 31` scans vs branchless
     `31 - clz32` scans (RESEARCH section 7 bodies) on empty-heavy (90% zero
     words), full-heavy (90% -1) and random corpora, both lanes. Output: ns/op
     per variant + the gap. This is the number S3's SC-1 vote needs.
  4. SC-2 experiment (benchmark/experiments/sc2-repr.mjs): the same op mix on
     an add()-built (signed) instance vs a constructor-built (unsigned double,
     new FastBit32(0x80000000 | x)) instance, including highestClearBit and
     serialize(); ns/op + scavenges at N and 8N (pinned semi-space). Confirms
     or refutes "unsigned storage costs time/alloc" for S6's SC-2 vote.
  5. Record S2a results: RESEARCH section 2 popcount table replaced by
     harness numbers (keep the probe numbers as "superseded"); a short
     "S2a results" block appended to the SC-1 and SC-2 rows in section 3.
  DONE WHEN: witness green with all five foils red in the right lane; SC-1
  and SC-2 numbers recorded; npm run verify still exit 0.

  S2a progress (2026-10-07): step 1 done -- test/witness/run-one.mjs.
  S2a progress: step 2 done -- test/witness.mjs (full ~75s green; witness:fast
    ~5s in verify; superseded by the 2026-10-10 rework below), floors frozen + benchmark/METHODOLOGY.md written; scripts
    witness/witness:fast added.
  S2a progress: step 3 done -- benchmark/experiments/sc1-scans.mjs (+ bench:sc1).
  S2a progress: step 4 done -- benchmark/experiments/sc2-repr.mjs (+ bench:sc2).
  S2a progress: step 5 done -- RESEARCH section 2 popcount table replaced
    (old marked superseded) + section 7 highestClearBit finding; SC-1/SC-2
    "S2a results" blocks appended to section 3. S2a COMPLETE.
  Key finding for S3: highestClearBit is NOT constant time today (the ~v >>> 0
    HeapNumber slow path, 26.9-29.8 ns HOT / 46.5-64.4 ns PRESSURE) -- witness
    pins it EXPECTED-RED FB-09/S3; S3's branchless body fixes it and S3 flips
    the pin. All 12 other hot ops flat in both lanes, both sweeps.
  S2a REWORK (2026-10-10, after reviewer REJECT): witness gates are now
    noise-relative (no absolute-ns constant), ratio + unclamped spread, d0/d32
    and the position sweep gated in PRESSURE, highestClearBit expected-red
    (flat = FAIL), slope gate two-sided with curvature + O(k^2)/32-step foils,
    sub-EPS foil, broken-floor and self-check controls; run-one fixes (int32
    persistent stream index, branch-free boolean consumption, Math.imul fill,
    process.execPath); floors re-frozen (METHODOLOGY). Full witness 81-88 s,
    witness:fast 9.9 s in verify. SC-1 re-run; SC-2 rebuilt (one process per
    representation, asserted) -- its "no per-op tax" claim withdrawn.
  S2a REWORK round 2 (2026-10-10, after second REJECT): PRESSURE 5 passes
    (best-of-3) and re-frozen from 8 quiet full runs (SPREAD_K 4.5 vs worst
    real 3.50 N; FOIL_SPREAD_K 5.5 vs LUT16 >= 8.82 N; EPS_K 7; no PRESSURE
    ratio gate); NOISE_FLOOR_MAX PRESSURE 0.08 (host-load verdict: the full
    witness needs a quiet host); slope gate gains a residual check + per-op R^2
    floors + foilIterStep (it caught the residual check missing from the
    verdict); SC-2 doc: inlined ns/op gap unexplained, 16 B/box inferred.
  S2a REWORK round 3 (2026-10-10): NOISE_FLOOR_MAX HOT 0.27 (fires before
    foilSubEps can flip at ~0.33) + HOST relabelling of a failed lane's gate
    lines; slope curvature sign-aware [-0.60, 0.60]; forEachMapped gated on
    phase k = 0 mod 4, forEachArray residual vs quadratic fit -- common R^2
    0.90 / RESID_K 3.5; step resolution 6-16 callbacks for every iterator
    (synthetic series, METHODOLOGY); foil verdict spread-only.

S2b -- the competitor matrix + report (only needed before S8's README)
  1. devDeps (benchmark only): fastbitset, typedfastbitset, bitset -- pin
     exact versions; verify each one's current API before writing adapters.
  2. benchmark/Harness.mjs + Matrix.mjs + Report.mjs + results.json, modeled
     on ../LiteLogN/benchmark (results.json keys: meta, subjects, dimensions,
     results); every row a ratio to raw bitwise; meta stamps process.version,
     V8 version, seed, lane, machine model (os.cpus()[0].model).
  3. benchmark/METHODOLOGY.md first line: "multi-word libraries are compared
     on their 32-bit subset only". Verdict per README comparison-table row:
     reproduced / struck (with the measurement or API fact).
  4. Report.mjs refuses to build without a version stamp; a second run
     reproduces every ratio within the stated tolerance.
  DONE WHEN: results.json reproducible; every README comparison row has a
  verdict.

Design calls the coder must NOT make silently (report them in the handback):
  - the frozen flatness floors and margins (values + calibration run);
  - whether witness runs inside `npm run verify` (only if <= 90 s);
  - any op found NOT flat in the PRESSURE lane (that is a finding for
    RESEARCH, not a floor to widen).
Pipeline: coder -> reviewer -> qa per half. Reviewer focus: one process per
subject (no shared call site), floor subtraction, dead-code elimination
guarded, foils fail in the claimed lane, floors frozen from a recorded run.

===============================================================================
# S3 -- 1.3.0 (folded; was 1.2.2) -- the word-math law (SC-1, FB-09)
===============================================================================

```markdown
---
package: "@zakkster/lite-fastbit32"
version_target: 1.3.0 (folded with S4)
status: planned
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
findings: [FB-09, FB-08 ("branchless" claim)]
depends_on: [S2]
---

# lite-fastbit32 -- one spelling for "index of this bit, or -1"

PURPOSE
  The maintainer asked for one clz32 idiom. Settle SC-1 with S2's numbers,
  apply it to every site, and make the header state the rule.

THE DECISION (record before coding: decisions/0001-clz32-idiom.md)
  Options A / B / C as in ROADMAP SC-1, with S2's SC-1 gap pasted in.
  Recommendation B (`31 - Math.clz32`, branchless scans). The maintainer's
  vote is final. Flip SC-1 to SETTLED in this file.

TASKS
  - Apply the settled idiom to all 13 sites (11 `^ 31` + 2 `31 -`).
  - If B: replace the four guarded scans with the branchless bodies.
  - Drop the dead `>>> 0` in forEachMaskPair/Diff/Union (FB-09). The
    `while (v !== 0)` loop is signedness-agnostic; the coercion only manufactures
    a double for >= 2^31.
  - Header comment: one line stating the idiom rule and why.
  - README/llms "branchless": true after B, else reword to "loop-free".

PARITY (output-identical release)
  For every word in the T5 corpus plus the key matrix, in both
  representations, every changed function returns exactly what
  `git show HEAD:FastBit32.js` returns. Exhaustive over all 2^32 words is
  ~minutes per op in a worker. Run it once for the four scans and record the
  wall time.

ASSERTIONS
  - `grep -c '\^ 31' FastBit32.js` -> 0 (if B) or `grep -c '31 - Math.clz32'` -> 0 (if A)
  - parity green; the T9 "guard removed under ^ 31" control still fails
  - witness: scans flat; perf gate 0 B/op
  - FLIP the highestClearBit expected-red pin (witness.mjs gateRed) to a
    normal flat row in the same diff as the new body; the pin failing on the
    new body is the revert-check evidence

WITNESS BACKLOG (S2a reviewer round-4 / qa notes, 2026-10-10). NOT part of S3
and NOT blocking any release: the maintainer moved to a lighter process
(2026-10-10) -- witness polish is done only when a session needs it.
  - forEachMapped k = 2 mod 4 cells are printed, not gated: a +40 ns
    regression confined to that phase passes. Add a loose pin (inside the
    documented bimodal band, or within a stated multiple of slope of the
    phase-0 fit) with a must-fail synthetic series.
  - Load advisory (witness.mjs ~:411) says "expect HOST" above load 2; data
    says HOT noise/floor 0.135-0.158 at load 2-3.7, 0.336 only at 6-11.7.
    Move the advisory threshold to ~5.
  - HOST verdict gets its own exit code (2) + "re-run on a quiet host"
    message; optionally one automatic witness:fast retry before failing.
    Never an env var that skips it in prepublishOnly.
  - gateFlat on an EMPTY row passes as flat (metrics([]) -> ratio NaN,
    spread -Infinity, both read in-bounds). Unreachable today (sweeps are
    constants); pinned as a `todo` in test/Witness.test.mjs. Fix: an empty
    or short row fails closed; flip the todo.
  - S3 reviewer notes (2026-10-10): `.value` is a mutable public field; a
    direct out-of-range write (NaN, 0.5, 2**32) answers differently than
    1.2.1 -> make `value` readonly in d.ts or document the invariant (S6).
    S3Parity needs git history (sha 27291e4); before any CI, save the 1.2.1
    body as a fixture file. README:14 / d.ts:5 "All operations are
    branchless" over-claims for forEach*/toArray loops (S8).
  - S4 reviewer (2026-10-11): witness rows for nextSetBit(9)/prevSetBit(22)/
    rank(17) (and countRange(4,27)) take LITERAL args that TurboFan folds;
    they prove word-flatness, not `from`-flatness, and under-cost a real
    cursor step. Take the arg from data (`i & 31` or a corpus slot).
  - FastBit32.js:7-9 header says values become unsigned; set() and every
    mutator store signed (S6 / S8 wording).
  - (RESOLVED by S2a qa: full witness green on a quiet host, load 1.98,
    85.8 s, PRESSURE noise/floor 0.048, LUT16 11.30 N, SEP 8.39 N.)

DONE WHEN
  SC-1 SETTLED; one idiom in the file; parity proven; highestClearBit pin flipped
```

===============================================================================
# S4 -- 1.3.0 -- Tier-1 API: closure-free iteration and the missing basics
===============================================================================

```markdown
---
package: "@zakkster/lite-fastbit32"
version_target: 1.3.0
status: planned
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
findings: [FB-11, FB-06 (BitMapper.bit)]
depends_on: [S3]
---

# lite-fastbit32 -- iterate without a closure; stop users hand-rolling masks

PURPOSE
  forEach with a capturing callback allocates (FB-11), and users rebuild
  equality, range masks and one-bit masks by hand (lite-depth does it eight
  times). Ship the RESEARCH Tier-1 roster, every body branchless and already
  oracle-verified.

TASKS
  - FastBit32: nextSetBit(from), prevSetBit(from), rank(bit), equals(other),
    equalsValue(x), set(x), copy(other), isSubsetOf(mask).
  - static FastBit32.rangeMask(start, end), validated (it is cold; throw on
    start > end or out of 0..31), and have countRange use it. countRange itself
    stays as-is until S6 (SC-3).
  - BitMapper: bit(name) (= 1 << get(name), throws on unknown), size getter.
  - d.ts + llms.txt + type smoke for each. Mark clone() and closure-capturing
    forEach as allocating in d.ts.
  - Torture: T0 laws for every member (cursor == forEach, rank/lowest, etc.),
    T2 rows, a T5 subject, a T6 scenario, perf-gate scenarios, witness entries.
  - README recipe: "iterate set bits in a hot loop" using nextSetBit, as the
    zero-GC answer to FB-11.

ASSERTIONS
  - cursor iteration visits exactly toArray() on the full T5 corpus
  - nextSetBit(32) === -1, prevSetBit(-1) === -1, nextSetBit(0) on 0 === -1
  - rank(31) on -1 === 31; equals is true across representations
  - perf gate: cursor loop 0 B/op, mustFail (capturing forEach) trips
  - witness: every new op flat

NON-GOALS
  No representation change (S6). No Tier-2 members (S5).

DONE WHEN
  every Tier-1 member gated in all 13 accounting sites
  (scope clarified 2026-10-11 after qa: the witness covers the word-computing
  ops -- nextSetBit, prevSetBit, rank, equals, equalsValue, isSubsetOf; set/copy
  (one store) and BitMapper.bit/size (Map lookup / getter) are proven by the
  T6 S4 0 B/op lane, not the witness. benchmark/Matrix.mjs (site 12) does not
  exist until S2b.)
```

===============================================================================
# S4b -- 1.4.0 -- FastBit1024 (SC-5 SETTLED: A)
===============================================================================

```
GOAL
  Ship FastBit1024 from FastBit32.js: the 32 x 32 two-level bitmap for pools
  and dense id sets up to 1024, fail-closed, every op loop-free except the
  O(k) iterators and clear().

START FROM
  benchmark/experiments/fb1024-draft.mjs (oracle-fuzzed: 3000 trials,
  ~290k checkpoints, invariants I1-I4, fail-closed rows; RESEARCH 13).
  Reuse S4's names: nextSetBit cursor, hasAll/hasAny, isEmpty/isFull.

SURFACE
  new FastBit1024(capacity = 1024)        // 1..1024 integer, else RangeError
  add/remove/toggle/has(bit)               // RangeError on any bad index
  acquire() -> slot | -1                   // LOWEST free slot
  release(slot)                            // throws on a free slot (double release)
  size, capacity, isEmpty(), isFull()
  lowest(), highest(), nextClearBit(), nextSetBit(from)
  hasAll(other), hasAny(other)             // O(non-empty words of other)
  forEach(cb), clear()                     // O(k + non-empty words)

GATES
  T0 invariants I1-I4 after every op; T1 degenerate: capacity 1, 31, 32, 33,
  1023, 1024, full pool, drained pool; T2 every word value incl. -1 and -2^31
  per word; T3 bad-input matrix (undefined, null, NaN, 1.5, '3', true, -1,
  cap, 1024, 2^32, Symbol, BigInt, {}) throws AND leaves state unchanged;
  T5 oracle fuzz (port fb1024-check.mjs); T6 0 B/op acquire/release/has/
  nextSetBit; witness: acquire, nextClearBit, lowest, highest flat across
  "free slot in word 0..31" shapes, both lanes (amended: HOT gated,
  PRESSURE info-only, see SC-5 a); T9 controls: the SparseBit1024
  draft policy (first EMPTY word) and a no-full-summary variant MUST fail T5.
  Perf: profile acquire+release (draft 5.2 ns, flat) vs lite-object-pool's
  free stack; report it, do not hide it.

NON-GOALS
  No resize, no >1024, no FastBit64 (SC-4), no change to FastBit32's input law.

DONE WHEN
  all gates green with controls red; the 13 accounting sites + d.ts +
  llms.txt cover the new export; README states the two input laws.
```

**S4b progress (2026-10-11; RELEASED as 1.4.0 the same day).** `FastBit1024` shipped in the working tree (additions only;
existing bodies byte-identical). Gates added: T0/T1/T2/T3/T5 rows, T6 lane, perf-gate scenario, witness `slot`
mode (5 HOT-gated rows (amended, see SC-5 a), a `has` check-cost info row, the `foilWordScan` foil), T9 controls `fb1024-sparse` and
`fb1024-nofull` (red), and test/FastBit1024.test.mjs. acquire+release 5.4 -> 3.2 ns (RESEARCH 13 "Shipped
in 1.4.0"). Round 2 (reviewer REJECTED round 1, code correct) fixed:
- the witness now uses one instance per process (separate instances measured heap placement), with the new foil;
- `hasAll`/`hasAny` throw TypeError on a non-FastBit1024;
- T5/T0 pre-fill and use a second key stream, with gated near-full coverage minimums;
- fields renamed to `_cap/_n/_active/_full/_data`;
- doc truth fixes (TypeError rows, two compares, the forEach snapshot, package-level claims, bundle sizes).

Round 3 (reviewer REJECTED round 2, code correct):
- maintainer decision: the FastBit1024 PRESSURE rows print as INFO (same-word evidence in RESEARCH 13 and
  METHODOLOGY); HOT stays gated;
- `foilWordScan` is gated under the lane config and both SLOT_SLOW configs;
- the clear decision is drawn before the op switch in T0/T5, with clear-count minimums;
- new T9 controls `fb1024-clear-low16` and `fb1024-acq-highword` (red);
- T5 counts full high words from the oracle;
- doc truth fixes: underscore names, the instanceof brand, the size method.

Full witness at load 3.43 -> 3.65: FastBit1024 HOT gated and flat, PRESSURE info. The only FAIL is the unrelated
SLOPE forEachArray residual (3.61 vs 3.5 x slope; known host load, HEAD fails it too). Finding: HOT
`nextClearBit` can flake on a busy host. A same-word control spreads the same, so this is host noise, not the
word (RESEARCH 13). Not done: site 12 (`benchmark/Matrix.mjs` does not exist yet, S2b) and an ADR (SC-5 is the
record). Awaiting review round 3.

===============================================================================
# S5 -- 1.5.0 -- Tier-2 members, greenlit one at a time
===============================================================================

```markdown
---
package: "@zakkster/lite-fastbit32"
version_target: 1.5.0
status: greenlit 2026-10-11 (maintainer): select, nextSubset, nextCombination
gc_maxMajor: 0
alloc_bytes_per_op: 0
depends_on: [S4b released as 1.4.0]
---

# lite-fastbit32 -- select, subsets, combinations -- or a rejection ledger

PURPOSE
  RESEARCH Tier 2. Each member must name a real use (a suite consumer or a
  documented recipe) BEFORE coding, or it is rejected into the ledger.

CONSUMER CHECK (2026-10-11, orchestrator): no suite package needs any member.
  The suite dependents (LiteTools, LiteDepth, LiteEcs, LiteTweenPro,
  LiteFXPro) use add/has/remove/forEach/hasAll/countMasked only. lite-pick,
  named below as select's consumer, holds eligibility in a Uint8Array, not a
  mask. The maintainer greenlit the first three anyway (documented-recipe use).

QUEUE
  1. GREENLIT. select(k) -- k-th set bit (0-based), branchless 5-step popcount
     descent; -1 when k >= count(). Use (recipe): uniform random live flag,
     `select((rand * count()) | 0)`. Laws: select(rank(b)) === b for a set b;
     rank(select(k)) === k for 0 <= k < count(). FastBit32 input law: k outside
     0..31 is unspecified until S6 (pin it, like rank) [superseded by settle
     (b): -1 for any int32 k outside 0..count()-1]. Planner decides whether
     FastBit1024 gets select(k) too (O(non-empty words), fails closed: k must be
     an integer 0 <= k < size, else RangeError -- or -1 past size; settle it).
  2. GREENLIT. static FastBit32.nextSubset(sub, mask) -- `(sub - 1) & mask`.
     Use (recipe): subset DP, enumerate every submask of mask. Law: from mask
     down to 0 it yields exactly 2^count(mask) distinct submasks (0 last),
     bit 31 included (int32 wrap of `-2^31 - 1` is correct under `&`).
  3. GREENLIT. static FastBit32.nextCombination(v) -- Gosper's hack, no
     division: `c = v & -v; r = v + c; ((r ^ v) >>> 2 >>> ctz(c)) | r`.
     Use (recipe): enumerate every k-of-32 flag set. Laws: popcount preserved;
     strictly increasing as unsigned; enumerates exactly C(32, k). The end of
     the sequence (the top k bits set, where r overflows bit 31) must be a
     defined sentinel (planner settles: 0, never a valid k >= 1 combination,
     or -1); v = 0 and v = -1 (k = 32) too.
  4. REJECTED (ledger). reverse() / rotl(n) / rotr(n): no consumer, no recipe.
     Reopen only when a consumer appears.

SETTLED 2026-10-11 (maintainer, on the S5 planner's calls):
  (a) FastBit1024.select(k): NO for 1.5.0 -- ledger; reopen when a consumer
      appears (it would be the only loop-bearing op outside the iterators,
      clear, hasAll and hasAny, with no flat witness row).
  (b) FastBit32.select(k): `q = k | 0` plus the `| q` sign term -- -1 for
      every int32 outside 0..count()-1, select(x) === select(x | 0) otherwise.
      Pinned until S6 (Pinned.test.mjs).
  (c) nextCombination end sentinel: 0 (-1 is the k = 32 combination). The
      brief's formula ends at 0 only for k <= 2 (the r ^ v carry out of bit 31
      is lost; k = 3 top block -> 1). Fixed form, branchless:
      `(((r ^ v) >>> 2 >>> (31 - clz32(c))) | r) & ((r | -r) >> 31)`.
      f(0) = 0, f(-1) = 0. Orchestrator check: walks for k = 1..4, 28..32
      visit exactly C(32, k) words, popcount k, strictly increasing unsigned.
  (d) nextSubset / nextCombination return a signed int32 (like rangeMask).

S5 progress (2026-10-11, uncommitted)
  Shipped in the working tree for 1.5.0: FastBit32#select, static nextSubset,
  static nextCombination (FastBit32.js +54/-0; 154832 golden vectors identical
  to 1.4.0). d.ts, README + llms recipes, CHANGELOG [Unreleased] written.
  Bundle (esbuild 0.28.2, gzip -9): whole 2072 -> 2254 B, { FastBit32 } 879 ->
  1059 B, { FastBit1024 } 1006 -> 1006 B, all-but-FastBit1024 1302 -> 1485 B.
  Witness HOT (two fast runs, node v26.8.2, M4 Pro, load ~4-5, net ns/op): select
  ~3.25-3.35 (ratio <= 1.02), nextSubset ~0.10-0.21 (<= 1.17), nextCombination
  ~0.35-0.43 (<= 1.16); select is an order of magnitude more than the
  others (~3.3 ns vs ~0.1-0.4 ns) and still flat. T6 S5 lane 0 B/op on Node,
  all 6 key-matrix lanes (gated < 0.1; bop-box control red at ~16).
  RISK (d8 probe, jsvu, pointer compression on, 1 MB semi-space, 2M calls):
  a static result outside [-2^30, 2^30) boxes (12 B) through an optimized,
  non-inlined call (--no-turbo-inlining: 23 scavenges each for
  nextSubset(0, 0x7FFFFFFF) and nextCombination(0x40000000), ~12 B/call;
  0x3FFFFFFF result 0; inlined 0). A never-optimized (interpreted) callee
  also boxes its intermediates (~8 boxes/call for nextCombination(0x40000000):
  184 scavenges). select returns -1..31, unaffected.
  Node Smis are 32-bit, so T6 reads 0. S7 backlog: measure a d8/browser row
  for the statics (FB-12).
  Gates: T0 laws, T2 rows, T5 subjects, T6 lane, T7 soak, 3 witness HOT rows
  (NOISE median over 44 rows), 4 T9 controls, test/S5Members.test.mjs (14 tests,
  4 suites), Pinned S5 (7), test/S5QA.test.mjs (qa: 40 tests, 7 suites, incl.
  a 1.4.0 parity gate via `git show`). npm test: 345 tests, 344 pass, 1 todo
  (existing gateFlat). qa PASS 2026-10-11.
  Ledger: FastBit1024.select REJECTED for 1.5.0 (settle a); reverse / rotl /
  rotr REJECTED (no consumer, no recipe). Reopen only when a consumer appears.

PER MEMBER (lean build, see section 1b)
  oracle-verified body (exhaustive where cheap: all 2^count submasks for
  sampled masks, every combination for k <= 4 and k >= 28, structured +
  random words for select); T0 law; T5 subject; T6 lane 0 B/op; witness HOT
  entry; d.ts; README + llms recipe; CHANGELOG line. No per-member perf-gate
  scenario: T6 proves 0 B/op and the witness proves flat. Or a ledger line.

DONE WHEN
  every queued member is shipped or rejected on the record
```

===============================================================================
# S6 -- 2.0.0 -- the input + representation law (SC-2, SC-3) -- breaking
===============================================================================

```markdown
---
package: "@zakkster/lite-fastbit32"
version_target: 2.0.0
status: planned
gc_maxMajor: 0
gc_maxPauseMs: 4
alloc_bytes_per_op: 0
leak_cycles: 4096
findings: [FB-02, FB-03, FB-04, FB-05, FB-06, FB-13]
depends_on: [S2]
---

# lite-fastbit32 -- one representation, and null is not zero

PURPOSE
  Two stored forms of one set (FB-03), garbage accepted at every cold door
  (FB-04, FB-06), and `undefined` meaning bit 0 (FB-02). Decide both laws on the
  record, put every observable change in one major, and keep every hot body
  byte-identical, apart from what the decision explicitly changes.

THE DECISIONS (record before coding)
  decisions/0002-representation.md -- SC-2, options A/B/C, S2's SC-2 numbers.
  decisions/0003-input-law.md -- SC-3, options A/B/C, the measured cost of B
  (a scratch build with `if ((bit >>> 0) > 31) _badBit(bit)` folded cold).
  Recommendations: SC-2 = B, SC-3 = C.

TASKS (if B + C)
  - Storage: `| 0` in the constructor, fromArray and deserialize.
    serialize() returns `>>> 0` (documented: one box per call, cold).
    deserialize accepts both signed and unsigned forms.
  - Cold fail-closed (throw a FastBit32Error with a stable code BEFORE any
    state write): constructor / deserialize on a non-integer, NaN, or a value
    outside [-2^31, 2^32); fromArray on a non-array, a hole, or an entry
    that is not an integer in 0..31; BitMapper constructor on > 32 names,
    duplicates, or non-strings. countRange: per SC-3 (validated, or pinned
    with a d.ts warning).
  - CheckedFastBit32: same surface, every bit/mask validated, throws on
    undefined/null/out-of-range. Document "one class per build" plus the
    measured cost of a mixed call site (perf-gate lane).
  - d.ts truth (FB-13): value is "int32 bit pattern; use serialize() for
    unsigned"; forEachMapped's name is `string | undefined`.
  - Consumer sweep: lite-ecs, lite-tween-pro, lite-depth, lite-fxpro. Grep
    each for `.value` comparisons, fromArray, deserialize and BitMapper ctor
    use. Write MIGRATION.md (shipped? decide; it is docs) with one row
    per consumer. Edit none of them.

HOT PATH
  The default class's add/remove/toggle/has/hasAll/hasAny/hasNone/union/
  difference/intersect/count/scans are byte-identical to 1.4.0 (diff the
  bodies). The only hot change allowed is none.

ASSERTIONS
  - T1 re-pinned under the new law. Every throw is asserted with its code,
    and the object state is unchanged after a throw. The re-pin MUST cover the
    1.2.1 fail-open: `FastBit32().hasAll(undefined|NaN|null)` is `true` today and
    must fail closed on CheckedFastBit32 (and per the SC-3 decision on the
    default class).
  - serialize() is stable across representations:
    new FastBit32(0x80000000).serialize() === new FastBit32().add(31).serialize()
  - CheckedFastBit32 throws on add(undefined) and hasAll(undefined)/hasAll(NaN);
    FastBit32's permissive fail-open (hasAll(undefined) === true, FB-02 class
    since 1.2.1) is pinned and documented
  - revert-check: the new T1/T4 gates fail on 1.4.0
  - S5 qa F1 (2026-10-11): FastBit32.nextCombination(v) reads `v + c`, so a
    string / array / Date concatenates (nextCombination('3') === 31, numeric
    answer 5; valueOf read 4 times). select uses `k | 0`, nextSubset subtracts.
    Settle with SC-3: coerce once (`v | 0`, one op) or fail closed on the
    checked twin. Pinned in test/S5QA.test.mjs ("FINDING pin").
  - perf gate + T6 0 B/op on the default class; the mixed-site lane is recorded

PACKAGING (maintainer direction, 2026-10-11): a v2-only changelog ships, the
  1.x history stays in the repo only.
  - CHANGELOG.md (in files[]) starts fresh at [2.0.0] and opens with one line
    linking the 1.x history on GitHub. Keeping the name means the suite law
    ("CHANGELOG.md per package"), /release (rewrites the CHANGELOG.md head),
    README:544 and Hygiene.test.mjs all keep working unchanged.
  - The 1.0.0..1.5.x entries move verbatim to CHANGELOG-1.x.md, NOT in files[].
  - Hygiene.test.mjs: ASCII-check CHANGELOG-1.x.md too, and assert it is
    absent from files[] and from `npm pack --dry-run`.
  - Scope of the saving: the npm tarball only (CHANGELOG.md is ~24 kB raw,
    ~11 kB gzip at 1.5.0, before 2.0.0's own entry). It does not change the
    JS bundle a consumer ships; esbuild never reads the changelog.

DONE WHEN
  SC-2 and SC-3 SETTLED; one stored form; every cold door fails closed; hot
  bodies unchanged; MIGRATION written; the v2-only CHANGELOG.md ships and
  CHANGELOG-1.x.md stays out of the tarball
```

===============================================================================
# S7 -- demo (not shipped)
===============================================================================

```markdown
---
package: "@zakkster/lite-fastbit32"
version_target: -- (demo/ never in files[])
status: planned
findings: [FB-12 (browser half)]
depends_on: [S4]
---

# lite-fastbit32 -- see the word

PURPOSE
  There is no demo. Build the four-panel page from RESEARCH section 9, under
  the demo-audit law, and use it to answer the browser Smi question (FB-12).

TASKS
  - demo/index.html + demo/kernels.mjs (pure, importable by tests) +
    demo/serve.mjs, following ../LiteLogN/demo.
  - Panels: bit board (signed/unsigned/hex/binary + every scan); SWAR
    popcount staged; 32-slot particle pool on nextClearBit (and, after S4,
    the cursor loop); ECS matcher with 32 components and a system that
    requires component 31.
  - `#measure` mode: the S2 position sweep in the browser, printed. Record the
    Chrome numbers in RESEARCH open question 1 and close it.
    Also a d8/browser B/op row for nextSubset / nextCombination (FB-12, S5
    boxing risk: results outside [-2^30, 2^30) box 12 B on pointer compression).
  - `#profile` mode: lite-layout-profiler, dormant otherwise.
  - demo/Demo.test.mjs (`npm run demo`): kernels are 0 B/op (perf-gate),
    and the ECS panel's matcher agrees with the oracle at component 31.

ASSERTIONS
  - demo-audit checklist clean: no allocation, no toFixed per frame,
    reads before writes, cached DOM lookups, pointer events
  - `#profile` reports violationCount === 0 across all four panels
  - `npm pack --dry-run` excludes demo/

PANEL 5 -- maintainer's mockup (2026-10-11): "1024-slot pool" (needs S4b FastBit1024)
  Layout from the mockup: a 32 x 32 grid of slots (one row = one data word);
  three stat cards: Allocated `n / 1024`, Fragmentation `%`, Next Free Index;
  legend Free / Allocated / nextClearBit (recently handed-out slots tinted, the
  current next free slot outlined); controls Pause, Clear Grid, click a cell to
  toggle, Allocation Rate slider (e.g. 50/s), Volatility slider (e.g. 1x, the
  release rate relative to allocation).
  Behaviour: every tick runs acquire() at the rate and release() on random held
  slots at rate x volatility; the outlined cell is nextClearBit() (lowest free
  slot, so occupancy stays dense at the bottom -- the policy RESEARCH 11.5/13
  argues for). Define Fragmentation before building it, e.g. free slots below
  highest() / (highest() + 1), and say so on the page.
  Teaching additions (cheap, the point of the panel): draw the two routing
  words (`active`, `full`) as 32-cell strips beside the grid, and show the
  two clz32 steps that find the next free slot (word = lowest clear of ~full,
  bit = lowest clear of that word). Optional toggle: the SparseBit1024 draft's
  "first EMPTY word" policy side by side, to show slots 0, 32, 64... being
  handed out and every word going active at once (RESEARCH 11.2 D11/D12).
  Frame loop under the demo-audit law: 0 allocations per tick for the pool
  logic, counter on screen.
  Improvements (main session, 2026-10-11 -- maintainer: "improve it any way";
  APPROVED by the maintainer 2026-10-11):
  - Policy race: the same seeded alloc/free stream driven into three pools
    side by side -- FastBit1024 lowest-free, the SparseBit1024 first-empty-word
    draft, and a LIFO free stack (lite-object-pool's policy). Same stream, so
    the difference on screen is the policy alone.
  - High-water mark card: `highest() + 1` -- the instance count a GPU draw or
    a network snapshot must cover. Lowest-free keeps it low; plot it over time
    per policy (one small sparkline, preallocated ring buffer).
  - Step mode (Pause -> Step): animate one acquire as the two clz32 hops --
    flash the `full` strip, mark its lowest zero (the word), then that word's
    lowest zero (the bit), then the cell. This is the whole data structure in
    four frames.
  - Cursor sweep: a button that walks `nextSetBit` across the grid, lighting
    cells in order and skipping empty words via `active` -- shows why
    iteration costs O(k + non-empty words), not O(1024).
  - Live cost readout: ns per acquire+release from a batched timing every
    second (never per frame), next to the "0 allocations" counter.
  - Reproducible runs: a seed field (xorshift32) and the state in the URL hash,
    so a bug report is a link.
  - Keyboard + a11y: arrow keys move a focus cell, Space toggles;
    `prefers-reduced-motion` drops the animations, keeps the numbers.
  - Fragmentation: show the formula on hover (see above) so the number
    teaches instead of decorates.

DONE WHEN
  demo runs; Demo.test green; FB-12 answered with numbers
```

===============================================================================
# S8 -- 2.0.1 -- README on the Sepforge spine
===============================================================================

```markdown
---
package: "@zakkster/lite-fastbit32"
version_target: 2.0.1
status: planned
findings: [FB-08, FB-10 (README ASCII + license holder)]
depends_on: [S2, S6, S7]
---

# lite-fastbit32 -- a README that only says what a gate proves

TASKS
  - Rebuild README.md on ../LiteSepforge/README.md, spine in order: title
    + tagline; badges; "The 32-bit word the ecosystem was missing" with
    install + quick start; TOC; Why this exists; What you get; <details>
    deep-dive (scans, SWAR popcount, cursor iteration); API reference + a
    constants table; Composability (an end-to-end ECS + pool pipeline in
    code); <details> Zero-GC design notes with the allocation table and S2's
    gated numbers; Design decisions worth knowing (SC-1..SC-3, linked);
    Testing (counts + scripts); What this is not (lite-o1 BitSet, scheduler,
    BigInt); Ecosystem; License (MIT (c) Zahary Shinikchiev).
  - Delete every unbacked claim (FB-08). Every number is copied from
    benchmark/results.json with its node version.
  - Move the TweenPro promo and the discount note to the Ecosystem section,
    or drop them (maintainer's call).
  - llms.txt mirrors the README surface; GUIDE.md optional (recipes: pool,
    ECS, iteration, save/load).
  - ASCII-only. Grep for stray tool-call tags.

ASSERTIONS
  - every number in the README is in results.json
  - `grep -cP '[^\x00-\x7F]' README.md llms.txt` -> 0 0
  - README is in files[]; /release 2.0.1 green

DONE WHEN
  the honesty hook (RESEARCH section 5) holds sentence by sentence
```

---

## 7. How to run it

One session per Claude session: `cd LiteFastBit32 && claude`, then point the
planner at the brief. Pipeline: planner -> coder -> reviewer -> qa. A REJECTED
review goes back to the coder. The maintainer commits, tags and publishes. No
agent does.

### If you only do a subset

- **Minimum responsible:** S0 + S1. This fixes the live consumer bug and leaves
  the package provable.
- **The maintainer's stated asks:** S0 (tests, torture, harness), S2
  (benchmark), S3 (the idiom), S7 (demo).
- **Feature growth without risk:** S4. It is additive, and every body is
  pre-verified.
- **Defer without guilt:** S5 (a queue by design), and S6 if no consumer is
  hurt by FB-02..FB-06. S1 has already removed the S1-severity part of the
  representation problem.

### The habit this roadmap is built around

Run the code before planning the code. Reading `hasAll` in the 1.2.0 source,
it looks correct. Run it with the mask that `BitMapper` produces and it is
not.
