# Changelog

All notable changes to `@zakkster/lite-fastbit32` are documented here. The
format follows Keep a Changelog; this project adheres to Semantic Versioning.

## [Unreleased]

Ships inside 1.2.1. S0 is a harness-only session: no runtime behaviour changed.
Every `FastBit32.js` function body is byte-identical to 1.2.0 (verified 40/40 by
a `.toString()` parity check against `git show HEAD:FastBit32.js`); the only code
addition is `export const VERSION`.

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

- FB-07: the iterator tests imported the 7 free functions from
  `../FastBit32.d.ts` (a types file with no runtime bodies), so all seven failed
  with `TypeError: forEachArray is not a function`. They now import from
  `../FastBit32.js` and pass.

### Known / pinned (unchanged behaviour, flips in a later session)

- FB-01 (todo, flips in S1): `hasAll(mask)` returns false whenever `mask` carries
  bit 31 in unsigned form (`(value & mask) === mask` compares a signed int32 to
  an unsigned double). Three node:test cases and the T1/T2/T3/T5/T8 torture rows are
  registered `todo` and become hard assertions in S1. An in-place fix greens all
  of them (verified: the `hasall-fixed` control, which simulates the fix, turns
  every one of those rows green); there is no second FB-01 defect class.
- FB-02..FB-06 (pinned): null/undefined map to bit 0; `fromArray` coerces
  non-integers and holes; `serialize` is representation-unstable; `deserialize`
  and the constructor accept garbage; `countRange` has no domain; `BitMapper`
  accepts duplicates and yields `undefined` names. Each is pinned to its literal
  today-answer in `test/Pinned.test.mjs` so a later session changes it on purpose.

### Measured (S0 baseline, Node 26.8.2, both --min/--max-semi-space-size=4)

All scavenge counts are reproducible only with BOTH semi-space pins (fresh new
space scavenges ~2x more than grown new space); the perf gate asserts both pins
and fails closed if absent, and the torture B/op lanes discard any window that
scavenged (read after an awaited settle). Every comparison is NaN-fails-closed.

- node:test: 119 cases -- 116 pass, 0 fail, 3 `todo` (all FB-01). (Includes QA's
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
  control). The shared megamorphic call site (sharedHasAll + sharedForEach,
  >= 5 receiver shapes) is measured at 0.000, gated < 0.1.
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
purpose (a green reading FAILS the gate, like an FB-01 todo row):

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
