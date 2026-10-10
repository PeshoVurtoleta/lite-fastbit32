# 0001 -- the clz32 idiom

Status: ACCEPTED (B), 2026-10-10, maintainer. Implemented in S3; ships in 1.3.0 (folded with S4; 1.2.2 never released).
Source: ROADMAP.md "### SC-1", RESEARCH.md section 7, benchmark/METHODOLOGY.md.

## Context

FastBit32.js spelled "index of this bit" two ways: `Math.clz32(x) ^ 31` (11
sites) and `31 - Math.clz32(x)` (2 sites). For x != 0 they are identical
(clz32 is in 0..31). At x == 0 they differ:

```
31 - Math.clz32(0)  ->  -1      // the package's "none" sentinel, for free
Math.clz32(0) ^ 31  ->  63
```

So under `^ 31` every scan needs an `=== 0` guard; under `31 -` none does.

## Options

- **A. `^ 31` everywhere.** Keep the four scan guards. 2 sites change.
- **B. `31 - Math.clz32` everywhere.** Drop the four guards; all four scans
  become branchless. 11 sites change.
- **C. Split by role.** `^ 31` where the operand is provably non-zero (inside
  `while (v !== 0)`), `31 -` where 0 must map to -1. One rule, two spellings.

## Decision

**B.** One spelling, one meaning ("index of this bit, or -1"). The branchless
bodies (0 oracle mismatches, both representations):

```
lowest()          31 - Math.clz32(v & -v)
highest()         31 - Math.clz32(v)
nextClearBit()    31 - Math.clz32(~v & (v + 1))
highestClearBit() 31 - Math.clz32(~v)
```

Matches the suite (lite-scheduler, lite-o1 `_bitsetCtz32`) and makes the four
scans branchless. The README tagline and `FastBit32.d.ts` "All operations are
branchless" still over-claim: the `forEach*` / `toArray` loops branch (fixed in S8).

## Measured basis (S2a, node v26.8.2, Apple M4 Pro, `npm run bench:sc1`)

- `highestClearBit` was NOT constant time: the 1.2.1 body `~this.value >>> 0`
  made a HeapNumber for every word with bit 31 clear, and `clz32` on that
  double cost **26.9-29.8 ns HOT / 46.5-64.4 ns PRESSURE** (empty-heavy and
  random corpora) vs **~0.01-0.05 / ~0.19-0.37 ns** for the branchless body
  (sub-noise). The witness pinned it EXPECTED-RED; S3 flipped the pin.
- `lowest` / `highest` / `nextClearBit`: gaps -0.064..+0.121 ns, sub-noise.
  B is chosen there for uniformity and the free -1 sentinel, not speed.

## Consequences

- Output-identical release: test/S3Parity.test.mjs compares every changed
  method against the 1.2.1 body (0 mismatches).
- The highestClearBit slow path and its ~32 B/op box are gone; the T6, perf-gate
  and witness expected-red rows for it are now normal gated rows.
- FB-09: the dead `>>> 0` in forEachMaskPair/Diff/Union is dropped (the
  `while (v !== 0)` loop is signedness-agnostic).
- The file header states the rule. A new bit-index site uses `31 - Math.clz32`.

## Amendment (S4, 1.3.0 Tier 1)

The new scans follow this rule: `nextSetBit`, `prevSetBit` return
`31 - Math.clz32(word)`, so an empty word (past the end, or `from` = -1) maps
to the `-1` sentinel with no branch. The cursor's end at `from` = 32 is the
branchless `(from - 32) >> 31` term (a `<< 32` would wrap to `<< 0`); the T9
control `nextset-nowrap` drops it and must fail T0 and T5.

## Exhaustive parity (S3/S4 qa, 2026-10-11)

The four scans were checked against `git show 27291e4:FastBit32.js` over ALL
2^32 words, both representations: **0 mismatches, 487.0 s wall on 10 workers**
(scratch run, not a committed test; the committed gate is test/S3Parity.test.mjs
over the key matrix, the T5 corpus and 1e6 seeded words).
