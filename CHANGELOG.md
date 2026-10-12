# Changelog

All notable changes to `@zakkster/lite-fastbit32` are documented here. The
format follows Keep a Changelog; this project adheres to Semantic Versioning.

## [Unreleased]

### Changed (test harness only; no library change)

- Witness: gateFlat fails closed on an empty or one-cell row and on a
  non-finite metric or NOISE (an empty row used to pass as NaN / -Infinity).
  The Witness.test.mjs todo is now a real test, and
  test/WitnessFailClosedQA.test.mjs pins every clause (10 cases).
- Witness: PRESSURE density rows (real ops, the foilLut16 / foilKernighan
  foils, the SEP margin and the PRESSURE NOISE) are judged over d1..d31. The
  d0 and d32 corpora repeat one word, which the M4 Pro runs cheaper under the
  PRESSURE stream (select ~0.2-0.35 ns); that failed the full witness at
  PRESSURE select (density) 5.2-6.2 N. d0/d32 print as INFO and keep the
  negative-cell check; a malformed, misaligned or under-2-density subset
  fails closed. New INFO control row: select d16 over 1 / 2 / 2048 distinct
  words. HOT and the position sweeps are unchanged.
- Tests: test/WitnessSubsetQA.test.mjs (26 cases) drives run() with a fake
  run-one and pins the d1..d31 routing for real ops, foils, SEP, NOISE and the
  control row, kwords validation, and HOT / position / ctlRead keeping every
  cell.
- Witness: a HOST-only failure exits 2. Exit 2 is used only when every
  failure is a lane NOISE cap failure (noise/floor > NOISE_FLOOR_MAX), with
  "HOST: re-run on a quiet host"; any other finding exits 1 (a NOISE that
  measured nothing, a malformed spawn row, a malformed PRESSURE subset). The
  load advisory reads "(advisory, not a gate)"; its busy-host note fires
  above load 5 (was 2).
- Witness: a malformed PRESSURE density subset is a finding (FAIL line,
  exit 1) even when the lane also failed its NOISE cap. It used to be
  relabelled HOST (the run still exited 1). One intentional golden delta.
- Witness: slope confirm. A real iterator that fails slopeVerdict on one
  process is re-spawned twice and judged once on the cellwise median of 3
  (odd count, no loop). Skipped under WITNESS_CALIBRATE and when NOISE HOT
  failed; the one-process verdict prints as a CONFIRM note. New control
  `CTRL confirm-slope` (foilIterStep judged as a real iterator must stay
  non-linear, else "no teeth"). Cost: +2 spawns per run for the CTRL
  (fake-driver count, 20/20 scenario x mode pairs); each confirm trigger
  adds 2 more.
- Witness: a flat-row confirm (cellwise median of 3) was tried and rejected;
  49/60 med3 spreads were <= 0.132 ns, so the pre-fixed rule failed. Flat
  rows stay single-process.
- Tests: test/WitnessConfirm.test.mjs replays the gate functions against
  test/fixtures/witness-gates-golden.json (cut from efbb377), and covers
  cellMedian, the confirm with a stub respawn, the advisory and hostFails.
- Tests: test/WitnessStabilityQA.test.mjs drives run() with a fake run-one
  (FAST, serial, per-spawn counter): a 1st-spawn slope outlier exits 0, a
  step on every spawn exits 1, a 1st-spawn select outlier exits 1, a NOISE
  failure alone exits 2, a NOISE failure plus a finding exits 1.
- Tests: test/WitnessSubsetQA.test.mjs now runs serially and pins the
  malformed-subset behaviour (fails 1, hostSuppressed 1).

## [1.5.0] - 2026-10-11

### Added

S5 (ROADMAP S5, settle calls a-d). Additions only: `FastBit32.js` is +54/-0
and 154832 golden vectors are identical to 1.4.0.

- `FastBit32#select(k)`: the k-th set bit (0-based, ascending), the inverse of
  `rank`. -1 for every int32 `k` outside `0..count()-1` and on an empty word.
  Non-int32 input is read as `k | 0` (pinned until S6). O(1), branchless
  5-step popcount descent.
- `FastBit32.nextSubset(sub, mask)`: `(sub - 1) & mask` as a signed int32.
  From `mask` down it yields exactly 2^count(mask) submasks, 0 last, bit 31
  included. `nextSubset(0, mask)` wraps to `mask | 0` (not a sentinel).
- `FastBit32.nextCombination(v)`: next word with the same popcount, strictly
  greater as uint32 (Gosper's hack, no division), as a signed int32. Ends at 0
  after the top-k-bits word; `f(0) === 0` and `f(-1) === 0`; never -1 (-1 is
  the k = 32 combination). Walks C(32, k) words from `rangeMask(0, k - 1)`.
- Typings for all three in `FastBit32.d.ts`; README and llms.txt recipes.
- Rejected on the record: `FastBit1024#select` (settle a), `reverse`, `rotl`,
  `rotr` (ledger; reopen when a consumer appears).
- Bundle (esbuild 0.28.2 --bundle --format=esm --minify | gzip -9), before ->
  now: whole module 2072 -> 2254 B; `{ FastBit32 }` 879 -> 1059 B;
  `{ FastBit1024 }` 1006 -> 1006 B; every export except FastBit1024, VERSION
  included, 1302 -> 1485 B.
- Witness HOT (two fast runs, node v26.8.2, Apple M4 Pro, load ~4-5, net
  ns/op, flat across density and position): `select` ~3.25-3.35 ns (ratio
  <= 1.02), `nextSubset` ~0.10-0.21 ns (<= 1.17), `nextCombination`
  ~0.35-0.43 ns (<= 1.16). `select` is an order of magnitude more than the
  other constant ops (~3.3 ns vs ~0.1-0.4 ns; a 5-step dependent descent) and
  still flat.
- 0 B/op on Node, all 6 key-matrix lanes (T6 S5 lane, gated < 0.1 B/op; the
  bop-box control goes red at ~16 B/op). On a pointer-compressed engine
  (31-bit Smi) a static's result outside [-2^30, 2^30) boxes (12 B) when
  returned through a non-inlined call (d8, --no-turbo-inlining, 2M calls,
  1 MB semi-space: 23 scavenges each for nextSubset(0, 0x7FFFFFFF) and
  nextCombination(0x40000000), ~12 B/call; 0 for a 0x3FFFFFFF result; 0 when
  the call is inlined); browser measurement in S7 (FB-12). `select` returns
  only -1..31: unaffected.
- Gates: T0 inverse laws, oracle k = -1..33 and static walks; T2 rows per build
  form; T5 fuzz subjects; T6 S5 lane; T7 soak; 3 witness HOT rows (the NOISE
  median is now over 44 rows); 4 T9 controls (select-nosentinel,
  select-descent-off, nextsubset-nomask, nextcomb-nosentinel);
  `test/S5Members.test.mjs` (14 tests in 4 suites, independent reference);
  Pinned S5 (7 tests); `test/S5QA.test.mjs` (40 tests in 7 suites: int32 k
  edges, mask = -1 structure, an independent colex oracle for every k, the
  doc recipes run from the doc text, settle (a), and a parity gate against
  the 1.4.0 source via `git show`). `npm test`: 345 tests, 344 pass, 1 todo
  (the existing Witness gateFlat finding).

## [1.4.0] - 2026-10-11

### Added

S4b (ROADMAP S4b, SC-5 settled A, RESEARCH 13). Additions only: every existing
`FastBit32.js` body (FastBit32, BitMapper, the free iterators) is byte-identical;
the header comment gains one surface paragraph.

- `FastBit1024`, a named export of `FastBit32.js`: a fixed 32 x 32 two-level
  bitmap (`Int32Array(32)` + `_active`/`_full` word summaries + exact count),
  capacity an integer 1..1024 (`undefined` -> 1024). No import or runtime
  coupling to `FastBit32`; `sideEffects: false` is unchanged.
- Surface: `add/remove/toggle/has(bit)`, `acquire()` (the LOWEST free slot, -1
  when full), `release(slot)`, `size`, `capacity`, `isEmpty()`, `isFull()`,
  `lowest()`, `highest()`, `nextClearBit()`, `nextSetBit(from)` (from
  0..capacity), `hasAll(other)`/`hasAny(other)` (another FastBit1024; capacities
  may differ, the answer is exact), `forEach(cb)`, `clear()`.
- Fails closed on every index, `has` included: `RangeError` unless the index is
  an integer `0 <= i < capacity`; Symbol, BigInt and null-prototype objects throw
  `TypeError` from `&`. `release` of a free slot throws `RangeError`.
  `hasAll`/`hasAny` throw `TypeError` on anything but a FastBit1024 (null, `{}`,
  a FastBit32). A rejected call writes nothing (the argument's own conversion
  still runs once, before the throw). FastBit32's input law is unchanged.
- State lives in underscore fields (`_cap`, `_n`, `_active`, `_full`, `_data`):
  internal; writing them voids invariants I1-I4. `forEach` reads each word once
  (a snapshot); to mutate during a walk, use the `nextSetBit` cursor.
- Measured (node v26.8.2, Apple M4 Pro, full witness, load average 3.43 -> 3.65,
  net ns/op, min-max over the word 0..31 holding the free or set slot). HOT,
  gated, every row flat: `acquire` + `release` pair 2.96-3.16, `nextClearBit`
  0.48-0.54, `lowest` 0.34-0.37, `highest` 0.40-0.47, `has` 0.91-0.98 (unchecked
  read 0.17: the fail-closed check costs ~0.78 ns; 0.72-0.90 over 9 runs).
  PRESSURE is printed as info only, not gated: `acquire` 2.67-2.85, `has`
  0.84-1.37 (8.26 N). The same spread appears with every cell on one word, so it
  is the lane, not the data (RESEARCH 13).
  The draft's pair cost 5.4 ns: the `clz32(x) >>> 5` zero test took it to
  ~4.9 ns (still calling `nextClearBit()`), inlining the scan into `acquire`
  to 3.0-3.2 ns (an `Int32Array` free stack with no checks: 2.2-2.3 ns).
- Bundle (an `export { ... }` entry through esbuild 0.28.2 --bundle --format=esm
  --minify | gzip -9): whole module 2072 B (1302 B at 1.3.0); FastBit32 alone
  879 B; FastBit1024 alone 1006 B; every export except FastBit1024 1302 B.
- Gates: T0 invariants I1-I4 after every op + laws, with pre-fill to capacity;
  T1 capacities 1, 31, 32, 33, 1023, 1024 (empty, full pool, drained pool,
  fill-1024/free-{1023, 31, 0}); T2 nine word values in each of the 32 words
  (-1 and -2^31 included); T3 the bad-input matrix on every index method,
  `release`, the ctor and `hasAll`/`hasAny` (exact error class per row); T5 the
  ported oracle fuzz (3000 trials, pre-fill, keys from a second stream) with
  counted, gated near-full coverage (floors: fullBig >= 50, acqHigh >= 10000,
  fullHigh >= 1000, rel31 >= 1000, clearBig >= 20; T0: acqHigh >=
  100, clearBig >= 3; e.g. one verify run: 1071 acquires returning -1 at cap >=
  128, 207965 acquires in words >= 16, 18571 checkpoints with a full oracle
  word >= 16, 27340 releases of bit 31, 861 clears at cap >= 512 with a high word
  set; T0: 16 such clears); T6 0.000 B/op on both pool shapes; a
  perf-gate acquire+release scenario (0 scavenges at N and 8N); five witness
  rows (HOT gated, PRESSURE info), one instance per process, plus the slot foil
  `foilWordScan` gated red under the lane config and both acquire/has
  estimator configs (165-221 N); T9 controls `fb1024-sparse` (first EMPTY word;
  red on T1, T5), `fb1024-nofull` (no `_full` summary; red on T0, T5),
  `fb1024-clear-low16` (clear() zeroes words 0-15 only; red on T0, T5) and
  `fb1024-acq-highword` (second-lowest clear bit in high words; red on T0, T5).
- `test/S4bQA.test.mjs` (21 cases, an independent model): every capacity
  1..1024, all 1024 single bits and all 1024 single holes (bit 31 and word 31
  included), the full bad-input matrix with byte-identical state,
  throw-before-write in the ctor, the second-copy brand, and the README /
  llms.txt / d.ts examples executed from the doc text. 14 scratch mutants, all
  red.
- d.ts, llms.txt and README document the class and the two input laws, and
  name the `instanceof` brand's limit (a prototype forgery passes it).

### Fixed

- README and llms.txt package claims corrected: "One class", "single-class",
  "Zero branches" and "< 1KB" are replaced by the two classes, branchless
  FastBit32 bit/mask ops, and the measured bundle sizes.

## [1.3.0] - 2026-10-11

Two sessions in one release (1.2.2 was never published). S3 is internal and
output-identical (SC-1 settled B: decisions/0001-clz32-idiom.md). S4 adds the
Tier-1 API (### Added). S3 changes no API; for every `.value` the API can produce (any int32 or uint32), every
changed function returns exactly what 1.2.1 returns
(test/S3Parity.test.mjs: 0 mismatches over the key matrix, the T5 corpus and
1e6 seeded words, signed and unsigned representations; an exhaustive scratch run
over all 2^32 words for the four scans: 0 mismatches, 487.0 s on 10 workers). A `.value` written directly
with a non-integer or out-of-range number (NaN, 0.5, 2**32) is outside that
contract and may answer differently (e.g. `nextClearBit` on NaN: 0 -> -1).

### Added

S4 (ROADMAP S4, RESEARCH 4 Tier 1). Additions only: relative to S3, every existing
`FastBit32.js` body is byte-identical (`countRange` included, SC-3).

- `nextSetBit(from)` (domain 0..32, 32 -> -1) and `prevSetBit(from)` (domain
  -1..31, -1 -> -1): branchless O(1) cursors. Closure-free iteration
  `for (b = m.nextSetBit(0); b !== -1; b = m.nextSetBit(b + 1))` is 0 B/op -- the
  answer to FB-11 (a capturing `forEach` callback allocates per call).
- `rank(bit)` (domain 0..31): set bits strictly below `bit`, O(1) SWAR.
- `equals(other)`, `equalsValue(x)`: signedness-agnostic `(a ^ b) === 0`.
  `equalsValue(undefined|null|NaN)` behaves like 0 (FB-02 class, pinned; S6).
- `set(x)` (`value = x | 0`, signed int32) and `copy(other)`: one store, the
  0 B/op alternative to `clone()`.
- `isSubsetOf(mask)`: `(value & ~mask) === 0`, the dual of `hasAll`.
- `static FastBit32.rangeMask(start, end)`: cold and validated; throws
  `RangeError` unless both are integers with `0 <= start <= end <= 31`; returns
  the `countRange` bit pattern as a signed int32. `countRange` itself is
  unchanged (T0 law: `countMasked(rangeMask(s, e)) === countRange(s, e)`).
- `BitMapper.bit(name)` (`1 << get(name)`, signed; throws on unknown) and the
  `BitMapper.size` getter.
- Raw-index ops (`nextSetBit`, `prevSetBit`, `rank`) are not validated: the
  out-of-domain answers are pinned in test/Pinned.test.mjs until S6 (SC-3).
- d.ts: every new member with its domain; `clone()` and a closure-capturing
  `forEach` are marked as allocating.
- Gates: T0 laws (cursor == forEach, prevSetBit descending, rank(lowest()) === 0,
  isSubsetOf/hasAll duality, equals/xor, rangeMask/countRange), T2 rows over the
  key matrix x 5 build forms, T5 fuzz subjects (both representations), a T6
  0 B/op lane over all 6 key-matrix lanes, a perf-gate cursor scenario (measured
  0 scavenges at N and 8N; the gate allows <= 2), six flat witness rows
  (nextSetBit, prevSetBit, rank, equals, equalsValue, isSubsetOf; set/copy and
  BitMapper.bit/size are covered by the T6 lane at 0.000 B/op), and the T9 control
  `nextset-nowrap` (no `(from - 32) >> 31` term; red on T0 and T5).
- Tests: test/S3Parity.test.mjs (4) and test/S4Boundary.test.mjs (60, checked
  against a per-bit `Math.floor(u / 2**k) % 2` oracle; 12 scratch mutants all
  red). node:test 128 -> 249 (248 pass, 1 todo: Witness.test.mjs empty-row
  gateFlat, deferred to the witness backlog); perf gate 19 -> 20.

### Changed

- One bit-index idiom: every `Math.clz32(x) ^ 31` is now `31 - Math.clz32(x)`
  (11 sites); the file header states the rule.
- `lowest`, `highest`, `nextClearBit`, `highestClearBit` are branchless: the
  four `=== 0` guards are gone (`31 - clz32(0)` is the `-1` sentinel).

### Fixed

- `highestClearBit` slow path removed: the 1.2.1 body's `~this.value >>> 0`
  made a HeapNumber on every bit-31-clear word (~32 B/op, 26.9-64.4 ns in the
  S2a witness). Now 0 B/op and constant time; the T6, perf-gate and witness
  expected-red rows for it are normal gated rows.
- FB-09: dropped the dead `>>> 0` in `forEachMaskPair` / `forEachMaskDiff` /
  `forEachMaskUnion` (it only manufactured a double for words >= 2^31).

## [1.2.1] - 2026-10-06

Two sessions fold in here: S0 (harness only -- node:test
port, torture tiers, perf gate, hygiene) and S1 (the FB-01 fix). The only
runtime change is the one-line `hasAll` fix below; every other `FastBit32.js`
function body is byte-identical to 1.2.0 (parity-checked line-by-line against the
S0 baseline), and the only addition is `export const VERSION`.

### Added

- `export const VERSION = '1.2.0'` -- the third version site, synced with
  `package.json` and the llms.txt stamp.
- node:test suites (`node:test` + `node:assert/strict`), split by area:
  `test/FastBit32.test.mjs` (33), `test/BitMapper.test.mjs` (7),
  `test/Iterators.test.mjs` (8), plus `test/Pinned.test.mjs` and
  `test/Hygiene.test.mjs`.
- `test/torture.mjs` + `test/torture/*`: ten tiers (T0 laws, T1 degenerate,
  T2 representation matrix, T3 adversarial, T4 BitMapper abuse, T5 differential
  fuzz, T6 zero-alloc budget + B/op, T7 soak/retention, T8 cross-package,
  T9 controls) over a seeded xorshift32 harness and a lib-free oracle.
- `test/perf/PerfGate.test.mjs`: lite-perf-gate `zgcSuite` scenarios per hot-op
  group plus a `mustFail` capturing-closure teeth-check.
- `test/types/` type-level smoke (`tsc`), covering every export incl. `VERSION`.
- `CHANGELOG.md`, `LICENSE` (MIT (c) 2026 Zahary Shinikchiev), and
  `engines: { node: ">=18" }`.
- devDependencies: `@zakkster/lite-gc-profiler`, `@zakkster/lite-leak`,
  `@zakkster/lite-perf-gate`, `@zakkster/lite-signal` (a required static peer of
  lite-leak, `>=1.5.0-beta.3 <2`), `esbuild`, `typescript`.

### Changed

- Test runner moved from vitest to node:test; `vitest` removed from
  devDependencies. Scripts mirror the suite blueprint (`test`, `test:types`,
  `torture`, `torture:controls`, `test:perf`, `bundle-check`, `verify`,
  `prepublishOnly`).
- ASCII sweep of `FastBit32.js`, `FastBit32.d.ts` and `llms.txt` (comments only):
  em dash -> `--`, box-drawing runs -> `--`, `->`, `==`, `-`, the warning
  emoji -> `WARNING:`. No wording changed.
- `bundle-check` writes to a gitignored `.bundle-check/` path (not the package
  root) and uses the pinned `esbuild` devDep rather than a network `npx` fetch.
- Node floor: the shipped library keeps `engines >=18`; the torture harness
  needs Node 20+ because `@zakkster/lite-leak` declares `engines.node >=20` (its
  stated requirement, not a measurement here).

### Fixed

- FB-01 (S1): `hasAll(mask)` returned `false` whenever `mask` carried bit 31 in
  unsigned form. The 1.2.0 body `(value & mask) === mask` compared a signed int32
  to an unsigned double, so `new FastBit32().add(31).hasAll(0x80000000)` and even
  `new FastBit32(-1).hasAll(0xFFFFFFFF)` were `false`, and any mapped mask from
  `BitMapper.getMask` (which always returns `>>> 0`) that included the 32nd flag
  never matched. Fixed to `(~this.value & mask) === 0` -- same op count, 0 B/op
  (perf gate + T6 unchanged), and signedness-agnostic: `mask` and `mask >>> 0`
  answer identically, so `0x80000000`, `0xFFFFFFFF` and a bit-31 `getMask` now
  match correctly. hasAll now follows V8's ToInt32 coercion like every other mask
  op. Proven over the T0/T1/T2/T3/T5/T8 torture tiers against the lib-free oracle
  (0 mismatches; an instrumented QA run counted 601,352 hasAll comparisons --
  no gate prints this count); the `hasall-old` control reinstalls the 1.2.0
  body and fails every one of those tiers (revert-checked).
  - **BEHAVIOUR CHANGE (fail-open, FB-02 class):** ToInt32 consistency also means
    a mask that coerces to 0 -- `undefined`, `NaN`, `null`, `2**32` -- now returns
    `true` on EVERY instance, including an empty one
    (`new FastBit32().hasAll(undefined) === true`). 1.2.0 returned `false` for
    these on every instance, by the same signed-compare accident. This is a
    false -> true change in the FB-02 "null is zero" class, not a guarantee: a
    signature that is `undefined` matches every entity. It is pinned in
    `test/Pinned.test.mjs` and fails closed in S6 (SC-3). The body is left
    ToInt32-consistent on purpose; the cold-path validation is an S6 door.
- FB-07: the iterator tests imported the 7 free functions from
  `../FastBit32.d.ts` (a types file with no runtime bodies), so all seven failed
  with `TypeError: forEachArray is not a function`. They now import from
  `../FastBit32.js` and pass.

### Notes for dependents

- **lite-ecs** (`World.js:30`) builds system signatures as `(1 << idx) >>> 0` and
  matches entities with `entity.mask.hasAll(sys.signature)`. Before 1.2.1 a system
  requiring component 31 silently never ran (FB-01). It now matches correctly;
  bump the `@zakkster/lite-fastbit32` floor to `^1.2.1`. lite-ecs is not edited
  from this session.
- **Keep signatures defined.** Because of the fail-open change above,
  `hasAll(undefined)` is now `true` (a signature that is `undefined`/`NaN`/`null`
  matches every entity), where 1.2.0 returned `false`. Build masks through
  `BitMapper.getMask`, which throws on an unknown name; a raw `undefined` field
  read does not throw and will silently match. Fails closed in S6 (SC-3).

### Known / pinned (unchanged behaviour, flips in a later session)

- FB-02..FB-06 (pinned): null/undefined map to bit 0; `fromArray` coerces
  non-integers and holes; `serialize` is representation-unstable; `deserialize`
  and the constructor accept garbage; `countRange` has no domain; `BitMapper`
  accepts duplicates and yields `undefined` names. Each is pinned to its literal
  today-answer in `test/Pinned.test.mjs` so a later session changes it on purpose.
  - FB-02 extension (new in 1.2.1): `hasAll(undefined|NaN|null|2**32)` is `true`
    on any instance (ToInt32 -> 0), where 1.2.0 returned `false` on a set
    instance. Same "null is zero" fail-open class; pinned on an empty instance in
    `test/Pinned.test.mjs`, fails closed in S6 (SC-3).

### Measured (S0 baseline, Node 26.8.2, both --min/--max-semi-space-size=4)

All scavenge counts are reproducible only with BOTH semi-space pins (fresh new
space scavenges ~2x more than grown new space); the perf gate asserts both pins
and fails closed if absent, and the torture B/op lanes discard any window that
scavenged (read after an awaited settle). Every comparison is NaN-fails-closed.

- node:test: 128 cases -- 128 pass, 0 fail, 0 `todo` (the three FB-01 cases are
  now hard assertions, plus a pinned fail-open case, all fixed/pinned in S1;
  QA's test/S1HasAllEdges.test.mjs adds 8 hasAll edge cases, 5 of which fail on
  the 1.2.0 body).
  (Includes QA's
  test/Boundary.test.mjs and test/TortureGuards.test.mjs; the semi-space pin
  bypass cases -- repeated last-occurrence and underscore spelling -- the
  --minor-ms / --minor_ms young-GC mode cases, and the young-GC detector
  self-validation case (a stubbed PerformanceObserver must exit 1) are hard
  assertions, not todo.)
- T6 steady-state B/op (K=65536/window, min over windows 1..7, empty-loop
  baseline subtracted, scavenged windows discarded). Signed key-matrix lanes are
  built THROUGH A MUTATOR (`new FB(0).union(int32)`) so the stored word is a real
  signed int32 (-1, -2^31), asserted `=== LANE_INT32` BOTH before and after
  measuring; the composite hot surface
  (count/lowest/highest/nextClearBit/has/hasAll/hasAny/hasNone/countMasked/
  countRange + a WORD-PRESERVING toggle/toggle pair) reads 0.000 B/op on every
  signed lane. The unsigned double lanes (`0xFFFFFFFF`, `2**31`) are READ-ONLY
  (a mutator would coerce them to int32), read ~0.000, and their value is
  re-checked unchanged. EVERY lane (signed and unsigned) is gated < 0.1 B/op
  (clean lanes read within +/-0.02; the threshold does not change under any
  control). The shared megamorphic call site (sharedHasAll + sharedForEach, at
  least 5 receiver shapes) is measured at 0.000, gated < 0.1.
- T6 highestClearBit lane: 0.000 B/op on the bit-31-SET lanes (`-1`, `-2^31`,
  gated < 0.1); ~32 B/op on the bit-31-CLEAR lanes (`0`, `1<<30`), registered
  EXPECTED-RED (see below).
- T6 budget lane: the GATE is a manual GcProfiler over the 200k-op mix,
  `checkNoGc(summary, {maxMajor:0, maxPauseMs:4})` after an awaited settle ->
  verdict `pass`, major 0, maxMs ~0. measureOps' own `bytesPerOp` is printed as
  a DIAGNOSTIC only and may be null (it read null in ~half of the sampled runs);
  its verdict is NOT a gate (see Upstream note, pinned by the blind-measureOps
  assertion in `test/torture/t6-alloc.mjs`). The budget-major control fires a
  gc() in the mix -> the manual lane fails.
- T6 forEach-closure scavenge lane: 0 scavenges over 2e6 ops with a module-scope
  callback (the foreach-closure control, the ROADMAP `forEach(b => a += b + i)`
  shape, churns dozens -> fails; gated <= 2).
- T7 soak: post-drain retained heap flat across 4 segments (growth within
  +/- ~100KB; gated < 1024KB). The soak-retain control retains 4096 x ~4KB
  on-heap packed arrays (the gate measured ~12.5MB post-drain growth) -> trips
  this gate with tracker.size() still 0; soak-stash retains tracked instances ->
  trips the size()/drain gate. tracker.size() returns to 0.
- perf-gate scavenges at N=200000 and k*N=1.6M: every gated scenario (single-bit,
  signed mask ops, popcount, scans, forEach with a hoisted callback, and all
  seven free iterators including forEachMappedObject) reads N=0 / 8N=0 (printed
  by a diagnostic test; the gate proves <= 2), old-gen 0, grows delta 0. The
  FB-11 teeth churns N=6 / 8N=52 scavenges (stable across 3 pinned runs).

### Known zero-box hole (pinned RED, NOT gated -- for S6/SC-2)

A genuine HeapNumber box in a shipped 1.2.0 body. S0 changes no code and never
widens a budget; the hole is pinned RED so a later session must close it on
purpose (a green reading FAILS the gate -- an expected-red lane, like T6's
highestClearBit bit-31-clear lanes below):

- `highestClearBit()` boxes on a bit-31-CLEAR word -- `31 - clz32(~value >>> 0)`
  with the operand >= 2^31. Reproduced at V8 DEFAULT tier (the reviewer confirmed
  with %GetOptimizationStatus that the body was not TurboFan and boxed; under
  --no-maglev it read 0). Pinned by TWO expected-red gates: perf-gate
  `test/perf/PerfGate.test.mjs` (scavenges N=1 / 8N=12, stable across 3 pinned
  runs; asserted finite and > 2 with the exact over-budget reason, so a
  fail-closed NaN cannot pass it) and torture T6's highestClearBit lane on the
  bit-31-clear key-matrix lanes (~32 B/op). The companion `nextClearBit()` does
  NOT box (`inv & -inv` keeps it int32).

(The earlier draft's "forEachMappedObject boxes" was a TEST artifact -- a `v | 0`
coercion of string object values built a NaN HeapNumber in the callback; with
numeric values the iterator is 0-alloc and is now gated. No library hole there.)

## [1.2.0]

- New: clear-bit scans -- `nextClearBit()` and `highestClearBit()`. O(1) bit-scan
  on the inverted mask via `Math.clz32`. The object-pool slot-lookup pattern is
  now truly zero-allocation; the prior
  `new FastBit32(~pool.value & 0xFFFFFFFF).lowest()` workaround is retired.
- New: `isFull()` -- companion to `isEmpty()`. Uses `~this.value === 0` for
  correctness across both signed (`-1`) and unsigned (`0xFFFFFFFF`) all-set
  int32 representations.
- New: `countRange(start, end)` -- O(1) popcount within an inclusive bit range.
  Mask is built with `>>>` to sidestep the `1 << 32` wraparound.
- New: debug + init helpers -- `toBinaryString(padded?)`, `toArray()`,
  `fromArray(bits)`. Documented as allocating and kept outside the hot-path
  surface. `toBinaryString` forces unsigned via `>>> 0`; `toArray` inlines the
  `v &= v - 1` loop; `fromArray` replaces the value and writes once.

## [1.1.0]

- New: BitMapper -- human-to-hardware bridge. Maps semantic string names to bit
  indices and masks, with O(1) reverse lookup via `getName(bit)`.
- New: `forEach(callback)` -- O(k) iteration on FastBit32 instances. Visits only
  active bits in ascending order via `v &= v - 1`. Returns `this`.
- New: 7 standalone iteration helpers -- `forEachArray`, `forEachObject`,
  `forEachMapped`, `forEachMappedObject`, `forEachMaskPair`, `forEachMaskDiff`,
  `forEachMaskUnion`. All O(k), connecting masks to arrays, objects, BitMapper
  dictionaries and mask set operations without intermediate allocations.

## [1.0.0]

- Initial release. FastBit32 core: single-bit ops, bulk mask ops, in-place set
  math, O(1) popcount, O(1) bit-scan (lowest/highest), clone,
  serialize/deserialize.
