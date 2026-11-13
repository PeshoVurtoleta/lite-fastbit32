# lite-fastbit32 Research Notes

Compiled 2026-10-06 against `main` (1052881, published 1.2.0, node v26.8.2). Modeled on `../LitePick/RESEARCH.md`
and `../LiteLogN/RESEARCH.md`. Feeds
`ROADMAP.md`; every claim below marked **(measured)** was reproduced with a probe in this session, every claim
marked **(to measure)** is a session task, not a fact. Nothing here is a settle call -- those live in ROADMAP section 3.
Section 11 (multi-word drafts, evaluated 2026-10-08 against 37dc47d) was measured on a different host; it says which.

---

## 1. Core Identity

lite-fastbit32 is the **single-word** primitive of the suite: one 32-bit integer, one object, every op a fixed handful
of ALU instructions. It is not a bitset (no array, no capacity), not a scheduler, not an ECS. It is the thing those are
built from when 32 is enough.

Three layers, in order of heat:

| Layer | Surface | Heat |
| --- | --- | --- |
| Word ops | `add/remove/toggle/has`, `hasAll/hasAny/hasNone`, `union/difference/intersect`, `count/countMasked/countRange`, `lowest/highest/nextClearBit/highestClearBit`, `isEmpty/isFull` | HOT -- per entity, per frame |
| Iteration | `forEach`, the seven `forEach*` free functions | WARM -- O(k) over set bits, callback-driven |
| Naming + I/O | `BitMapper`, `serialize/deserialize`, `toArray/fromArray/toBinaryString`, `clone` | COLD -- init, save, debug |

**The honest unifying thread:** every hot op is *data-independent constant time*. Not "O(1) amortized", not "O(1)
expected" -- the same instruction count whatever bits are set. That is the property worth proving (section 2), and the
one a 32-iteration loop or a `Set<number>` does not have.

**What the package is for, as its consumers actually use it** (grep of the suite, 2026-10-06):

| Consumer | Uses | Notes |
| --- | --- | --- |
| lite-ecs `Entity.js`, `World.js` | `FastBit32` per entity, `BitMapper` for components, `hasAll(signature)` per system per entity | `World.js:30` builds signatures as `(1 << idx) >>> 0` -- **hit by FB-01 at component 31** |
| lite-tween-pro `TweenPro.js` | `flags.add/has/toggle/clear` with a small enum | small indices; exposed to FB-02 if an enum key is misspelled |
| lite-depth `Depth.js` | `BitMapper` only, then `1 << FLAGS.get(name)` by hand into a `Uint32Array` lane | wants a one-bit-mask accessor (`BitMapper.bit`), not the class |
| lite-fxpro | devDep `^1.1.1` | not inspected |
| lite-pick | ADR 0001 Fork 5: optional peer for N <= 32 eligibility, post-1.0 | the closure-free cursor (section 4) is what a picker loop needs |
| lite-scheduler | hand-rolls `31 - Math.clz32(x & -x)` with a review note | not a dependency; shows the idiom question is suite-wide |

---

## 2. The Analytical Anchor: the constant-time witness

lite-logn's anchor is "growth is logarithmic"; lite-pick's is "imbalance under the provable ceiling". lite-fastbit32's
is simpler and stricter:

> **Every hot op runs in the same time for every input word.** Its ns/op is
> flat across bit density 0..32 and across bit position 0..31, and `forEach` is
> exactly linear in popcount with a near-zero intercept.

### Why it belongs in the project

The README sells "O(1) popcount" and "O(1) bit-scan". Big-O is meaningless at n = 32 -- a 32-step loop is also O(1). The
real claim is *no data-dependent work*: no loop, no early exit, no branch whose direction depends on which bits are set.
That claim is falsifiable, and the foils below fail it visibly.

### The witness, precisely

- **Density sweep:** for d in 0..32, a corpus of 2048 words with popcount d
  (seeded). Time each hot op over the corpus. Gate: max/min ns-per-op ratio across d below a flatness floor AND the
  unclamped max - min spread below a multiple of the run's measured noise (lite-logn's witness uses the same shape).
- **Position sweep:** for p in 0..31, single-bit words `1 << p`, plus the two extremes `0` and `-1`. Same flatness gate.
  This is the sweep that catches a sign-bit slow path (FB-12 territory: values >= 2^30 or >= 2^31 leaving Smi).
- **Iteration slope:** `forEach` / cursor iteration over popcount k = 0..32. Fit time = a + b*k; gate R^2, a two-sided
  `|a|` bound in units of the per-bit slope, and the curvature of a quadratic fit. O(k), not O(32) (foil: a fixed
  32-step scan) and not O(k^2) (foil: a re-walking iterator).
- **Foils (must visibly fail flatness):** Kernighan's popcount
  (`while (v !== 0) { v &= v - 1; c++; }` -- O(k), the common real-world implementation), the 16-bit lookup table (flat
  when L1-hot, data-dependent under cache pressure -- the reason the witness runs two cache lanes), a 32-iteration
  popcount loop with early exit,
  `for (b = 0; b < 32; b++) if (v & (1 << b))` for lowest, and a `Set<number>`
  of indices. If a foil passes the flatness gate, the gate has no teeth.
- **popcount candidates, S2a witness harness (reworked 2026-10-10, node v26.8.2, Apple M4 Pro).** Numbers from
  the witness harness -- each candidate in its OWN process behind a monomorphic inlined call site; per cell 3 (HOT) / 5
  (PRESSURE) passes of interleaved op/floor loops, net = median pass, result sunk into an Int32Array slot. Absolute ns
  come from two `npm run witness` runs (round 1, both exit 0); flatness in N from the 8 re-freeze calibration runs
  (round 2, quiet host). HOT is a tight loop; PRESSURE streams 32 MB at a 4099-word stride (int32 index, persistent) in both
  the op and floor loops. Density sweep d0..d32 in BOTH lanes. Flatness is gated as a ratio (cells clamped up to EPS)
  AND as an unclamped spread, both in units of the run's own NOISE (median cell-to-cell spread of the real-op rows:
  0.038-0.073 ns HOT, 0.046-0.081 ns PRESSURE in the calibration runs). No absolute-ns constant gates. The PRESSURE
  lane needs a quiet host: under concurrent load its noise doubles and the run returns a host verdict. Frozen constants and
  calibration in `benchmark/METHODOLOGY.md`.

  | candidate | HOT net ns/op (flatness) | PRESSURE net ns/op (flatness) |
  | --- | --- | --- |
  | SWAR (shipped) | 0.35-0.40, flat (spread 0.24-2.03 N) | -0.23..+0.01 (relative: the lane's negative bias), flat (1.13-2.29 N) |
  | 16-bit LUT (64 KB), 2 loads | 0.33-0.35, flat (0.25-2.52 N) | **-0.24..0.99: ~0 at d0/d32, 0.5-1.0 mid-density -- data-dependent (8.82-18.91 N, beats the worst real op by 6.89-15.40 N)** |
  | Kernighan `v &= v - 1` | 0.60 (d0) -> 7.80 (d32), O(k) (113-218 N) | 0.01 (d0) -> 6.90 (d32), O(k) (84.6-174.8 N) |

  The 16-bit LUT fails the flatness gate in the PRESSURE lane and passes it when L1-HOT -- the data-dependence the
  witness forbids. Kernighan fails it in both lanes (O(popcount); run and pinned red in both). SWAR is the only
  popcount candidate flat in BOTH lanes, so
  **SWAR stays** (no LUT member ships). PRESSURE resolves cache behaviour, not ALU work: a ~0.7 ns full-word ALU step
  (the foilSubEps control) is caught in HOT (9.3-20.0 N) and invisible in PRESSURE, where op loops run up to 0.48 ns
  FASTER than the empty loop (a measured negative floor bias; PRESSURE nets are relative across cells).
  **(superseded)** the first S2a table (2026-10-07: SWAR 0.29-0.43 HOT, LUT16 hump 0.1-0.66, ratios 2.6-3.6) -- its
  PRESSURE loop deopted (`si += 4099` left int32), its boolean ops carried the harness's own `?1:0` branch, and its
  ratios used an absolute 0.8 ns clamp. Earlier **(superseded)** ad-hoc probe
  (2026-10-06, best of 5 x 5e7, same verdict): SWAR 0.36-0.56 HOT / ~0 streaming; 8-bit LUT (256 B) 0.53-0.70 ties SWAR;
  nibble LUT (16 B) 1.41-1.48; 16-bit LUT 0.28-0.33 HOT / +0.3-0.7 streaming; Kernighan 0.97/2.42/4.01/8.43 at
  0/8/16/32. The 8-bit and nibble tables (not re-run under the S2a harness) never beat SWAR there -- loads cost more
  than ALU ops.

  Cost notes behind the verdict: the 16-bit table also costs 64 KB per realm plus a 65,536-step import-time init, and
  its PRESSURE hump comes from which words arrive (0x0000/0xFFFF entries stay cached, mixed words miss). Kernighan is
  ~0.25 ns per set bit.

  An earlier version of this probe called every candidate through one shared
  `bench(fn)` site, so nothing inlined and SWAR read ~4 ns (mostly call overhead, plus a ~0.77 ns artifact on sparse
  corpora). That is the reason S2 builds a real harness. Kernighan's trick stays where it is the right tool:
  `forEach`, `toArray` and the `forEach*` helpers must visit every set bit, so O(k) is the floor there.
  No `countSparse()` member and no LUT member.

### Prior art for the anchor

Constant-time bit tricks are textbook (Hacker's Delight ch. 5 for SWAR popcount, ch. 2 for `x & -x` / `x & (x - 1)`; the
Stanford "Bit Twiddling Hacks"
page). The point of the witness is not novelty, it is proving the JS engine honours them: `Math.clz32` lowers to a
single `lzcnt`/`clz` on x64/arm64 in TurboFan, and `Math.imul` to `imul`. **(to measure: confirm via the position sweep
that no lane has a slow path, in both Node and a pointer-compressed Chrome.)**

---

## 3. The Benchmark Suite

### The claim we are actually proving

Not "fastest flag engine in JavaScript" (README today -- unbacked, FB-08). The defensible claim has three parts, each
with its own number:

1. **Abstraction tax vs raw integers.** `flags.has(b)` vs `(v & (1 << b)) !== 0`
   on a local. This is the honest headline: it should be ~0 after inlining, and if it is not, users deserve to know. A
   library that hides this number is selling, not measuring.
2. **Constant time** -- the section 2 witness.
3. **Zero allocation** -- 0 B/op on every hot op, proven by the torture lanes and lite-perf-gate, including the
   Smi-boundary key matrix (2^30, 2^31, -2^31, 2^32 - 1).

### Dimensions

| Dimension | Values |
| --- | --- |
| Op | each hot op + `forEach` + cursor iteration (once it exists) |
| Word shape | density 0/8/16/24/32, single bit at 0/15/30/31, `0`, `-1`, `0xFFFFFFFF` (unsigned form) |
| Representation | instance built by `add()` (signed) vs by `new FastBit32(u32)` (unsigned double today) |
| Call-site shape | monomorphic site vs one site shared by >= 5 classes (inlining off; the torture-harness control) |
| Runtime | node 22 LTS, node 26 current; Chrome via the demo page (best effort, reported separately, never gated) |

### Honest-cost disclosure (on-brand, like lite-o1's build/space co-headline)

Report alongside every win: the abstraction tax (part 1), the cost of the fail-closed variant once it exists (ROADMAP
S6), and the `forEach` closure cost when the callback captures (measured 2026-10-06: **425 scavenges over 2e6 calls with
a capturing closure, 0 with a hoisted function**). The cursor API (section 4) exists precisely because of that last number.

### Competitive matrix (apples-to-apples, reproducible)

| Subject | Why it is in the matrix |
| --- | --- |
| raw `number` + inline bitwise | the floor; every row is reported as a ratio to it |
| `fastbitset` (npm 0.5.2) | named in the README table today |
| `typedfastbitset` (npm 0.8.0) | named in the README table today |
| `bitset` (npm 5.3.0) | most-installed general bitset |
| `Set<number>` | what people write without a bitset |
| naive loop foils | the witness foils (section 2) |

The multi-word libraries are only compared on the 32-bit subset of their surface, and the report says so in its first
line. The README comparison table
(FastBitSet "O(k) iteration: No", "Zero-GC: No", and so on) is **unverified**
and gets either reproduced by this matrix or deleted (FB-08).

### Reproducibility machinery

Seeded xorshift32 corpora; `process.version` and V8 version stamped into
`benchmark/results.json`; warm-up fixed by run count, not by time; window 0 printed and never floored on (
torture-harness skill: window 0 often runs Maglev code). A results file without a version stamp fails the report build.

### Correctness methodology: the oracle fuzz

The oracle is a `Uint8Array(32)` of booleans plus naive loops -- it shares no code and no trick with the library (
torture-harness skill: "an oracle that shares the design agrees with the bug"). Every hot op is cross-checked over a
seeded corpus that **always includes** the four Smi/sign boundary words and both representations of every word (signed
int32 and `>>> 0` unsigned). FB-01 is exactly the bug this finds in under one millisecond and that 48 example tests
missed.

---

## 4. The Candidate Roster

Every formula below was checked against the oracle on 20,008 words (8 fixed boundary words + 20,000 seeded), both signed
and unsigned forms where relevant:
**0 mismatches (measured, 2026-10-06).**

### Tier 1 -- the missing basics (ship in ROADMAP S4)

| Member | Body | Why |
| --- | --- | --- |
| `nextSetBit(from)` | `w = v & (-1 << (from & 31)) & ((from - 32) >> 31); return 31 - clz32(w & -w)` | **closure-free iteration**: `for (b = m.nextSetBit(0); b !== -1; b = m.nextSetBit(b + 1))`. Branchless, `from` in 0..32, returns -1 past the end. The `(from - 32) >> 31` term kills the `<< 32` wraparound without a branch. |
| `prevSetBit(from)` | `31 - clz32(v & (-1 >>> (31 - from)) & ~(from >> 31))` | descending cursor, `from` in -1..31 |
| `rank(bit)` | popcount of `v & ((1 << bit) - 1)` | set bits strictly below `bit` -- the index into a packed/compressed array (HAMT-style sparse slots). Bit 31 case verified. |
| `equals(other)` / `equalsValue(x)` | `(this.value ^ x) === 0` | signedness-agnostic equality; today users must remember `>>> 0` on both sides (README itself documents the trap) |
| `set(x)` / `copy(other)` | one store | zero-alloc alternative to `clone()` in a pool |
| `isSubsetOf(mask)` | `(v & ~mask) === 0` | the dual of `hasAll` |
| `FastBit32.rangeMask(start, end)` | the `countRange` mask, exported | callers rebuild it by hand today |
| `BitMapper.bit(name)` | `1 << get(name)` | lite-depth hand-rolls exactly this eight times |
| `BitMapper.size` | count of names | introspection |

### Tier 2 -- strong candidates (ROADMAP S5, greenlit one at a time)

Status: select / nextSubset / nextCombination are shipped in the working tree
for 1.5.0. reverse / rotl / rotr and FastBit1024.select are rejected (ROADMAP
S5 ledger). lite-pick is not a consumer today (ROADMAP S5 consumer check).

| Member | Sketch | When it pays |
| --- | --- | --- |
| `select(k)` | position of the k-th set bit; branchless via a 5-step popcount descent (16/8/4/2/1) | inverse of `rank`; random pick of the k-th free slot (lite-pick P2C over an N <= 32 eligibility word) |
| `nextSubset(sub, mask)` | `(sub - 1) & mask` (submask enumeration) | DP over subsets, combo-system checks, "all ability combinations" in game logic |
| `nextCombination(v)` | Gosper's hack: next larger word with the same popcount | enumerate all k-of-32 selections without allocation |
| `reverse()` / `rotl(n)` / `rotr(n)` | SWAR reverse; `(v << n) \| (v >>> (32 - n))` with the n = 0 trap handled | ring-buffer occupancy, mirrored tile masks |

Each needs a kill criterion written before coding: no real consumer pattern in the suite or a documented recipe that
uses it, and it is rejected into the ledger, not shipped.

### Tier 3 -- adjacent (evaluate; may fold in or cross-reference)

- **Word kernel as free functions** (`ctz32`, `bsr32`, `popcnt32`, `blsi`,
  `blsr`). Users who keep flags in a `Uint32Array` lane (lite-depth's shape)
  want these without the class. The suite's zero-runtime-deps law means siblings will NOT import them; the value is for
  end users only. Gate: the class methods must not slow down if they delegate (to measure -- or keep the bodies
  duplicated and test them against each other).
- **A checked twin** (`CheckedFastBit32`): same surface, validates every bit index and mask, throws on `undefined`
  /`null`/out-of-range. The answer to FB-02 that costs the default hot path nothing. Opt-in at dev time. Risk: a call
  site that sees both classes turns polymorphic -- the docs must say "pick one per build", and the perf gate must
  include the mixed-site lane to show the cost.
- **`FastBit64`** (two int32 fields, hi/lo). The most common user ask for a flag word is "more than 32 components".
  Boundary question with lite-o1
  `BitSet` (open question 3). Kept out of every session until that is settled.

### The boundary -- explicitly OUT of scope

- **Multi-word bitsets of arbitrary capacity.** (A FIXED 32 x 32 geometry is not this: `FastBit1024`, ROADMAP SC-5,
  section 13.) lite-o1 `BitSet` (1.4.0) owns this, with a summary layer for O(1)
  firstSet. lite-o1 RESEARCH already records the non-overlap from its side.
  Section 11 reviews three drafts that cross this line; what survives is routed to lite-o1 or to docs, not here.
- **O(1) rank/select over long bitvectors.** lite-o1 `RankSelect` (proposed 1.8.0). The Tier 1 `rank` here is
  single-word only.
- **Priority queues over bit buckets.** lite-scheduler `FastBitScheduler`.
- **BigInt.** Allocation per op; contradicts the package.
- **Morton / bit interleave.** Spatial packages.

---

## 5. The Honesty Hook

Three sentences the README must be able to say after S8, each backed by a gate:

1. "Every hot op allocates 0 bytes, including on words at the Smi and sign boundaries." (torture T6 + perf-gate)
2. "Every hot op takes the same time for every word; here is the flatness ratio." (witness)
3. "Calling a method costs X% over writing the bitwise expression inline on node vYY." (benchmark part 1)

And three it must stop saying (FB-08): "No branches" (four scans branch today),
"a plain unsigned 32-bit integer" (false after any mutation touching bit 31),
"FastBit32 handles [bit 31] correctly under the hood" (FB-01 says otherwise).

---

## 6. Boundaries with sibling packages

| Sibling | Relationship | Rule |
| --- | --- | --- |
| lite-o1 `BitSet` / `RankSelect` | multi-word cousins | design parity (same idioms), no runtime dep either way |
| lite-ecs | consumer | FB-01 fix is required there too (its own session) |
| lite-arena | none today | if it ever wants component masks, it consumes, never forks |
| lite-scheduler | parallel idiom | the S3 idiom settle is a recommendation the suite can adopt, not a dependency |
| lite-pick | future optional peer | the cursor API and `select` are what its N <= 32 path needs |
| lite-depth | consumer of `BitMapper` | `BitMapper.bit` and the free-function kernel serve its `Uint32Array` lanes |

---

## 7. Reference notes for the fixes

### FB-01 -- `hasAll` with the sign bit

Today: `(this.value & mask) === mask`. `&` returns a signed int32, so when `mask`
arrives as the unsigned double `2147483648` (which `BitMapper.getMask` *always*
produces for bit 31) the left side is `-2147483648` and the strict compare fails.

Fix: `(~this.value & mask) === 0`. Same instruction count (not, and, compare vs and, compare, plus the extra operand
load). Comparing to `0` is signedness-agnostic. **0 mismatches over 800,000 signed/unsigned value/mask mixes
(measured).** `has`, `hasAny`, `hasNone`, `isEmpty`, `isFull` already compare to
`0` or use `~`, so they are immune; `hasAll` is the only `=== mask` in the file.

### The clz32 idiom

`31 - Math.clz32(x)` and `Math.clz32(x) ^ 31` agree for every x != 0 (clz32 is in 0..31). They disagree at x ==
0: **`31 - clz32(0) === -1`, `clz32(0) ^ 31 === 63` (measured).** The `31 -` form therefore produces the
package's `-1` "none"
sentinel for free, which makes all four scans branchless:

```
lowest()          31 - Math.clz32(v & -v)
highest()         31 - Math.clz32(v)
nextClearBit()    31 - Math.clz32(~v & (v + 1))
highestClearBit() 31 - Math.clz32(~v)
```

All four verified against the oracle (0 mismatches, both representations). With
`^ 31` each needs its `=== 0` guard kept. Whether removing the branch is
*measurably* faster is a benchmark question (the branch is perfectly predicted in most loops); the README's "branchless"
claim, though, is only true with
`31 -`. ROADMAP SC-1 carries the decision.

**S2a measured (reworked 2026-10-10, `npm run bench:sc1`):** for `lowest`/`highest`/`nextClearBit` the gaps are
-0.064..+0.121 ns: HOT branchless faster in 7 of 9 cells (+0.031..+0.121 ns), PRESSURE 7 of 9 sub-noise -- uniformity,
not speed. But `highestClearBit` is a special case the SC-1 experiment found by accident: its CURRENT body
`const inv = ~this.value >>> 0; ... 31 - clz32(inv)` makes `inv` a **HeapNumber** for every word with bit 31 clear
(`~value >= 2^31`), and `Math.clz32(thatDouble)` then runs a **data-dependent slow path: 26.9-29.8 ns HOT and
46.5-64.4 ns PRESSURE** on the empty-heavy and random corpora (0.93 ns HOT full-heavy, where 90% of words take the
`inv === 0` exit); the witness pins it red (spread 40-135 N HOT, 17.6-89 N PRESSURE). The branchless
`31 - Math.clz32(~v)` (no `>>> 0`) reads **~0.01-0.05 ns HOT / ~0.19-0.37 ns PRESSURE** (sub-noise). So `highestClearBit` is NOT
constant time today -- the one hot op that is not -- and S3's branchless body both fixes it and removes the dead
`>>> 0` coercion (FB-09). `nextClearBit` shares the `~v >>> 0` but survives because `inv & -inv` forces the double
back to int32 before `clz32`. Numbers: `benchmark/experiments/sc1-scans.mjs`, witness finding in
`benchmark/METHODOLOGY.md`.

### FB-03 -- one representation

Stores today: constructor `initial >>> 0` (unsigned, a double for >= 2^31),
`fromArray` `v >>> 0` (same), every mutator `|= &= ^=` (signed int32). Proposed canonical form: **signed int32
everywhere** (`| 0` at the three cold entries), with an unsigned view only at the I/O edge (`serialize()`
returns `>>> 0`, one box per call, cold, documented). Signed int32 is a Smi on 64-bit Node for every value; under
Chrome's 31-bit Smis, values with bit 30 or 31 are HeapNumbers in either form, so the canonical choice is not worse
there **(to measure in the demo)**. lite-arena's AR-01 lesson applies: do not "fix" signedness by widening to `>>> 0` on
a hot path.

---

## 8. Experimental direction: fail-closed without hot-path bytes

The suite law says `null` is not zero and every unverified state fails closed. The hot-path law says a guard that never
fires still costs its bytes. For a library whose whole body *is* the hot path, these collide head-on in `add(bit)`. The
research position:

- **Cold entries validate unconditionally** (constructor, `deserialize`,
  `fromArray`, `BitMapper` constructor, `rangeMask`). These are free.
- **`BitMapper` is the fail-closed front door** for names -- it already throws on unknown names. `BitMapper.bit(name)`
  extends that to masks.
- **Raw-index hot ops stay permissive and pinned**, with a documented contract, OR a measured guard if the perf gate
  shows 0 cost after inlining (to measure:
  `if ((bit >>> 0) > 31) throw` folded into a cold `_badBit()` call).
- **`CheckedFastBit32`** for development builds.

S6 records which of these the package adopts; this section only lays out the ground.

---

## 9. The demo

Four panels, one page, `demo/index.html`, every frame loop under the demo-audit law (no allocation, reads before
writes, `#profile` layout profiler):

1. **Bit board.** 32 cells; click to toggle. Live readouts: value as signed, unsigned, hex, binary; `count`, `lowest`, `highest`,
   `nextClearBit`, `highestClearBit`. Bit 31 cell styled as the sign bit with a note.
2. **SWAR popcount, staged.** The three reduction steps drawn as 16 2-bit lanes -> 8 4-bit lanes -> 4 bytes -> `imul`
   sum, for the current word.
3. **Object pool.** 32 particle slots allocated with `nextClearBit`, freed on expiry; slot occupancy word drawn live; a
   counter showing 0 allocations per frame for the pool logic.
4. **ECS signature matcher.** 32 components via `BitMapper`, three systems as masks, 64 entities highlighted by `hasAll`.
   A system that requires component 31 is included on purpose: it is the FB-01 regression made visible.

Plus the browser-side Smi probe (FB-12): a hidden `#measure` mode that times the position sweep in Chrome and prints it,
so the pointer-compression question gets an answer.

---

## 10. Recommended path

Harness first (nothing else is provable without it), then the one live S1
(FB-01), then measurement (benchmark + witness) before any idiom or representation decision, then additive API, then the
one breaking release, then demo and docs. ROADMAP section 4 is the ordered version of this sentence.

---

## 11. Draft proposals beyond one word: evaluation (2026-10-08)

Three drafts were added to this file in 37dc47d: `FastBitArray` (flat multi-word bitset), `MultiBit32`
(the same with exact capacity and index checks) and `SparseBit1024` (a two-level 32 x 32 bitmap). They are kept
**verbatim in Appendix A** so the history stays readable; this section is the review. Every **(measured)** row below
comes from `benchmark/experiments/s11-drafts.mjs`, which loads the drafts straight out of Appendix A.
Host for this section: node v22.22.0 / V8 12.4, x64 Xeon @ 2.1 GHz cloud container. That is a **different host from
the S2a numbers in section 2**, and the probe is ad hoc, not the S2a harness. Read the timings as ratios, not as
absolute numbers.

### 11.1 Verdict

| Draft | What it is | In scope for fastbit32? | Correct in range? | Verdict |
| --- | --- | --- | --- | --- |
| `FastBitArray` | `Uint32Array` of words, unchecked indices, O(words) scans | **No**: section 4 boundary; lite-o1 `BitSet` (M14, 1.4.0, ADR 0019) owns multi-word | all ops agree with the oracle **except `contains`** (FB-01 class) | reject as a member; `contains` names a real gap in `BitSet` (11.4) |
| `MultiBit32` | the same with exact capacity, `#check`, `lastMask` | **No**, same reason | `contains` broken (FB-01 class); `isFull` broken at capacity mod 32 in {0, 31}; `#check` fails open | reject; the padding question is already settled in `BitSet` (11.3 e) |
| `SparseBit1024` | 1024 bits = 32 data words + one 32-bit routing word | **No** as a class (still multi-word), **yes** as an idea | `nextClearBit` wrong (returns the first EMPTY word, not the lowest clear bit) and loops; any bad index corrupts the routing word | **salvage the idea**: corrected in 11.5, routed in 11.4 |

The research instinct is sound: all three drafts aim at the two operations that real consumers hit when 32 is not
enough (ECS signature match = subset test, object pool = lowest clear slot). Neither operation exists in lite-o1
`BitSet` today (its surface is test/set/unset/toggle/firstSet/nextSet + in-place and/or/xor/andNot). The drafts found
real gaps, just in a sibling package. They also re-derive, without being told, two defects this file already
documents (FB-01, FB-02). That is the most useful finding here: those defect classes come back by default (11.3).

### 11.2 Measured defects

All **(measured)** with the probe. "want" is the oracle (`Uint8Array` of booleans, linear scans, shares no trick).

| # | Repro | got | want | Class |
| --- | --- | --- | --- | --- |
| D1 | `FastBitArray(64)`: `{31}.contains({31})` | `false` | `true` | FB-01: `(a & b) !== b` compares a signed int32 to a `Uint32Array` read (unsigned, `2147483648`) |
| D2 | `FastBitArray(64)`: `{5,63}.contains({63})` | `false` | `true` | same; bit 31 of **any** word (bits 31, 63, 95, ...) |
| D3 | `MultiBit32(64)`: D1 and D2 | `false` | `true` | same body, same bug |
| D4 | `MultiBit32(n)` all bits set, `isFull()`, n = 31, 32, 63, 64 | `false` | `true` | `lastMask` is `0xFFFFFFFF` (n mod 32 = 0) or `(1 << 31) - 1 = -2147483649` (n mod 32 = 31); `(w & lastMask) === lastMask` never holds. n = 1, 33 pass |
| D5 | `MultiBit32(0).isFull()` | `false` | `true` (vacuous) | reads `w[-1]` |
| D6 | `MultiBit32(10).add(x)` for x = `undefined`, `null`, `NaN` | sets bit 0 | throws | FB-02: `bit < 0 \|\| bit >= n` is false for all three |
| D7 | `MultiBit32(10).add(x)` for x = `1.5`, `'3'`, `true` | sets bits 1, 3, 1 | throws | a range check is not a type check |
| D8 | `FastBitArray(10).add(12)` then `count()` / `forEach` | `1` / `[12]` | `0` / `[]` | a padding bit becomes a visible member |
| D9 | `FastBitArray(10).add(undefined)` then `has(0)` | `true` | `false` | FB-02 |
| D10 | `FastBitArray(10).add(-1)` | silently dropped (`-1 >>> 5` = 134217727, a typed array ignores the out-of-bounds store) | throws | fails open, no trace |
| D11 | `SparseBit1024`: `{0}.nextClearBit()` | `32` | `1` | returns the first **empty** word, not the lowest **clear** bit |
| D12 | `SparseBit1024`: `{0..39}.nextClearBit()` | `64` | `40` | same |
| D13 | `SparseBit1024`: `{}.add(1024)` then `lowest()` | `63` | `-1` | `1 << 32` is `1 << 0`: routing bit 0 is set over an empty word, then `clz32(0) ^ 31 = 63` |
| D14 | `SparseBit1024`: `{5}.remove(1029)` then `lowest()` | `-1` | `5` | the out-of-bounds read is `undefined & m = 0`, so routing bit 0 is cleared and bit 5 disappears from `lowest`/`forEach` while `has(5)` still says `true` |

Differential fuzz (4000 seeded trials, in-range indices only, a quarter of them near-full): `FastBitArray` and
`MultiBit32` agree with the oracle on `count/lowest/highest/nextClearBit/forEach`. `SparseBit1024.nextClearBit`
disagrees on **117** trials (D11 shape). D4 is missed by the fuzz, which rarely builds a full set at n = 31/32/63/64.
That is why the targeted rows exist next to the fuzz (the T1 "pin the degenerate values" rule).

**Timing (measured, net of an empty-loop floor, own process per candidate, three runs):**
`SparseBit1024.nextClearBit` takes **0.80-1.02 ns** when the free slot is in word 0 and **30.4-34.2 ns** when 31 full
words come first. That is a 33-38x data-dependent spread on that x64 host. **Re-run 2026-10-10 on the maintainer's
host (node v26.8.2, arm64 Apple Silicon): 0.50 ns vs 8.66 ns, about 17x; the 11.5 sketch 0.34 / 0.46 ns.** The ratio
itself moves 2x between hosts, so the portable statement is "an order of magnitude, data-dependent" -- and the section 2
witness exists to reject exactly that. The 11.5 sketch measures **0.6-0.8 ns in both shapes** on x64. A note on measurement: the first run of this probe timed both classes through one shared
`timeIt(s)` function. The call site went polymorphic and the numbers came out inverted (the draft looked faster).
That is the section 2 lesson repeated, and it is why the probe now forks one process per candidate.

### 11.3 What the defects teach (the general laws)

a. **The compare-to-zero law.** A bitwise result is a signed int32. A `Uint32Array` element, a `>>> 0` value, or a
   literal like `0xFFFFFFFF` is an unsigned double. `===` between the two families fails whenever bit 31 is set. D1-D4
   are three new copies of FB-01, in fresh code written after FB-01 was documented. So the law has to
   be mechanical, not remembered: **compare a bitwise expression only to `0`** (or to another bitwise expression).
   Subset is `(b & ~a) === 0`. Full is `~(w | padMask) === 0`. Equality is `(a ^ b) === 0`. A grep for `) === [a-z]`
   / `) !== [a-z]` over bitwise lines catches the pattern. Candidate for the shared law in ROADMAP section 1 and
   for T8 cross-package conformance.

b. **A summary multiplies the cost of a bad index.** In one word, a bad index damages one bit, at worst a wrong bit
   (`add(32)` sets bit 0; FB-02). Under a summary it damages **other answers**: D13 makes `lowest()` invent bit 63
   in an empty set, and D14 makes `lowest()` and `forEach` lose a member that `has()` still reports. The summary and
   the data disagree, and nothing ever repairs them. This is the structural reason lite-o1 `BitSet` makes every
   mutator fail closed (ADR 0019 call 4), while fastbit32 can defensibly keep raw-index hot ops permissive (SC-3
   option A/C). **"Trust the caller" does not scale past one word.** Input to SC-3: record it as the argument for
   why the single-word answer does not transfer.

c. **A range check is not a type check.** `bit < 0 || bit >= n` lets `undefined`, `null`, `NaN`, `1.5`, `'3'` and
   `true` through (D6, D7), because every comparison with `NaN` is false and the others coerce. The one-test form
   used by lite-o1 is `typeof i !== 'number' || (i >>> 0) !== i || i >= n`. `typeof` comes first so a Symbol/BigInt
   never reaches `>>>`. The cold throw must build its message with `String(i)`, not a template literal, which throws
   on a Symbol. Same law as FB-02 and S6.

d. **A summary answers exactly one question.** An "is this word non-empty" summary answers lowest-**set** in O(1).
   It says nothing about lowest-**clear**, because a non-empty word can still be full or have room. D11/D12 are the
   draft treating "empty word" as "lowest free slot". The dual needs its own summary: lowest clear of `x` is lowest
   set of `~x`, and "word `~x` is non-empty" means "word `x` is not full". So a pool index keeps **two** routing words
   (11.5). This is also why the draft's fallback had to loop.

e. **Padding: enforce it on write, do not mask it on read.** `MultiBit32` masks the last word on every read
   (`lastMask` in `highest`, `nextClearBit`, `forEach`, `isFull`), so every hot read pays for the padding question and
   one read (`count`) forgot to mask. lite-o1 `BitSet` instead keeps the invariant "padding bits are always 0":
   mutators reject `i >= nbits`, and `setAll` writes `0xFFFFFFFF >>> (32 - rem)` (rem in 1..31, never a 32-shift).
   The invariant costs nothing on reads. `(1 << rem) - 1` is the wrong spelling at rem = 31 (D4).

f. **Doc truth applies to drafts too** (FB-08). "Loop-free Hamming Weight" (a loop over words), "Instantly" and
   "O(1)" on O(words) scans, "No loops. Just two SWAR operations" (two `clz32` scans; SWAR means the parallel-lane
   popcount, not bit scans), "Safe by default" (D6), "Sparse" (storage is dense: 128 B of data always; the *index*
   is what skips empty words, and in the literature "sparse bitmap" means Roaring-style compressed containers). The
   section 2 witness would have caught the "O(1)" `nextClearBit` (17x arm64 / 33-38x x64 spread, 11.2).

g. **Smaller notes.** `bytes()`/`serialize()` expose host byte order through a `Uint8Array` view of a `Uint32Array`.
   Every mainstream host is little-endian, but a save format should state it, or use `DataView` with an explicit
   endianness on the cold path. `~data[i] >>> 0` in both drafts' `nextClearBit` is the dead coercion FB-09 removes.
   `physicalCapacity` is unused. `Uint32Array` vs `Int32Array` storage made **no measurable difference** to popcount
   or the corrected subset loop on words with bit 31 set (measured, within noise, this host). The choice of
   `Int32Array` in 11.5 is about compare semantics (law a), not speed.

### 11.4 Where the findings are useful (routing)

| Finding | Home | Shape | Status |
| --- | --- | --- | --- |
| Lowest **clear** bit at N > 32 (pool allocation) | lite-o1 `BitSet` | `firstClear()` / `nextClear(from)` over a second "non-full" summary of the same geometry as the existing one. Level 1: bit j set iff `(_w[j] \| padMask_j) !== -1`, where padMask covers bits >= nbits in the last word, so padding counts as occupied. Levels 2-3 are non-empty summaries of level 1, so the existing `_firstWordFrom` descent is reused unchanged. Cost: every mutator also tracks the full<->non-full transition (one more compare in the common case, propagation only on a flip), plus ~n/1024 words. Measure it with BitSet's existing witness. | **handoff proposal**, goes through lite-o1's own pipeline (ADR before code). Not fastbit32 work |
| Subset / intersects at N > 32 (ECS signatures past 32 components) | lite-o1 `BitSet` | non-mutating `isSubsetOf(other)` = every word `(a & ~b) === 0`, and `intersects(other)` = some word `(a & b) !== 0` (law a). O(words) disclosed, like and/or. Option: walk only the words that `other`'s summary marks non-empty (the `hibitset` join idea), so a sparse signature costs O(its non-empty words) | **handoff proposal**, same pipeline |
| Two-level index over 32 words | fastbit32 **demo / learning notes**, not code, not the README | a recipe: "1024 slots = 32 words + an `active` word + a `full` word", built from the single-word idioms fastbit32 already ships (`lowest`, `nextClearBit`, `31 - clz32(x & -x)`). It teaches the composition without crossing the boundary. With the Tier-3 word kernel (section 4) the recipe gets shorter. Not the README: a README recipe is code users copy, and 11.3 b says this shape must fail closed if it ships, which makes the recipe longer than its point | S7 demo stretch (the pool panel at 1024 slots) |
| The compare-to-zero law (11.3 a) | ROADMAP section 1 shared law + T8 | one rule and one grep; D1-D4 become T8 cross-package rows ("`Uint32Array`-backed subset with bit 31 per word") | **adopt** |
| "Trust the caller does not scale past one word" (11.3 b) | ROADMAP SC-3 | add as a recorded argument; it supports option C (cold entries fail closed, hot raw ops permissive) for the single word and explains why lite-o1 differs | **adopt** |
| More than 32 components (open question 3, SC-4) | still open | the drafts are the array-backed answer, and that answer already exists (lite-o1 `BitSet`). They do not settle `FastBit64` (two int32 fields, no array, `hasAll` = two ANDs and no loop), which is the only shape that keeps 33-64 components at single-word cost. **(to measure, if SC-4 is ever scheduled):** `FastBit64.hasAll` vs `BitSet.isSubsetOf` at 64 bits | open |

### 11.5 The salvaged structure, corrected (reference sketch, not a proposed export)

The idea in `SparseBit1024` that holds up: 1024 = 32 x 32, so **two** `clz32` scans locate any bit with no loop.
The draft breaks it in two places: it keeps only an `active` summary (11.3 d), and it takes unchecked indices into a
summarized structure (11.3 b). The fixed shape keeps two routing words and updates both on every write. It also
drops the draft's `if (chunk === 0)` branch in `remove`; that branch was harmless, but losing it keeps the mutators
straight-line, like FastBit32's own:

```js
const nz = (x) => (x | -x) >>> 31;  // 1 iff x !== 0, for EVERY int32 x. At x = -2^31, JS -x does NOT wrap: it is the
                                    // double 2^31, and `|` truncates it back to -2^31 (ToInt32), so bit 31 is still 1

class Occupancy1024 {               // 0 <= bit < 1024, caller-guaranteed (see 11.3 b before shipping this anywhere)
    constructor() { this.active = 0; this.full = 0; this.data = new Int32Array(32); }
    add(bit) {
        const w = bit >>> 5, d = this.data[w] | (1 << (bit & 31));
        this.data[w] = d;
        this.active |= 1 << w;                      // a word with a set bit is non-empty: unconditional
        this.full |= (nz(~d) ^ 1) << w;             // full iff ~d === 0
        return this;
    }
    remove(bit) {
        const w = bit >>> 5, d = this.data[w] & ~(1 << (bit & 31));
        this.data[w] = d;
        this.full &= ~(1 << w);                     // a word with a clear bit is not full: unconditional
        this.active &= ~((nz(d) ^ 1) << w);         // empty iff d === 0
        return this;
    }
    lowest() {                                      // lowest set bit, or -1
        const a = this.active; if (a === 0) return -1;
        const w = 31 - Math.clz32(a & -a), d = this.data[w];
        return (w << 5) + (31 - Math.clz32(d & -d));
    }
    nextClearBit() {                                // lowest clear bit, or -1
        const f = ~this.full; if (f === 0) return -1;
        const w = 31 - Math.clz32(f & -f), c = ~this.data[w];
        return (w << 5) + (31 - Math.clz32(c & -c));
    }
}
```

**(measured)** 0 `lowest`/`nextClearBit` mismatches against the oracle (the 1/3 of fuzz trials at capacity 1024,
including the near-full pool phases) plus the pinned extremes (all set, then free 1023, then free 31, then all
clear). `nextClearBit` costs 0.6-0.8 ns net in both the "free slot in word 0" and the "free slot in word 31" shapes,
flat where the draft spreads 17-38x by host. It is "allocate the lowest free slot", the policy
that keeps occupancy dense at the bottom. That matters beyond tidiness: the draft's "first empty word" policy hands
out slots 0, 32, 64, ..., so all 32 words become active almost at once, and the summary-guided `forEach` no longer
skips anything.

**Prior art** (the drafts reinvent a well-known structure, a good sign for the instinct):
two-level bitmaps for O(1) "first non-empty class" are the core of **TLSF** (Masmano, Ripoll, Crespo, Real, *TLSF:
a New Dynamic Memory Allocator for Real-Time Systems*, ECRTS 2004) and of the Linux 2.6 **O(1) scheduler**'s
140-priority bitmap (`sched_find_first_bit`). The multi-level, fan-out-word version is a **hierarchical bitset**:
lite-o1 `BitSet` here (3 levels, fan-out 32), and the Rust `hibitset` crate that backs the `specs` ECS's component
joins (the "walk only non-empty words" idea in 11.4). The recursive limit of the same split is the **van Emde Boas**
layout. Truly sparse sets are **Roaring** bitmaps (Chambi, Lemire, Kaser, Godin 2016), which is where the word
"sparse" belongs.

### 11.6 Not next

- **Superseded in part 2026-10-10 by SC-5:** a FIXED 32 x 32 class (`FastBit1024`, section 13) does enter. No
  arbitrary-capacity multi-word class enters fastbit32. The section 4 boundary and ADR 0019 (lite-o1) both say so, and the drafts
  add nothing BitSet lacks except the two handoff ops in 11.4, which belong in BitSet.
- The handoffs are proposals to lite-o1's roster, not edits to it. Each needs its ADR (geometry, cost, witness
  foil) before code, the M14 way.
- The 11.5 sketch is a teaching reference and a recipe seed. If anything like it ships, it ships fail-closed
  (11.3 b), in whichever package owns it.

---

## 12. Open questions

1. **Representation in the browser.** Does a field holding bit-30/31 values cost anything per write in
   pointer-compressed V8 (Chrome, Deno, Electron)? Node cannot answer this; the demo's `#measure` mode can.
2. **Is `forEach` worth keeping on the hot path** once `nextSetBit` exists, or should the docs demote it to "warm, hoist
   your callback"?
3. **`FastBit64`.** Same package (two fields, same idioms, still one object) or out of scope in favour of
   lite-o1 `BitSet`? The answer decides whether ECS users with 33+ components have a zero-alloc path that is not
   array-backed. Section 11.4: the array-backed path exists (BitSet) but lacks a subset test; `FastBit64` is still
   the only loop-free 33-64 option. **Answered 2026-10-11 (ROADMAP SC-4 SETTLED, S9):** same package, a flat
   `lo`/`hi` object on shared word kernels -- not two FastBit32 behind an orchestrator. Measured with
   `benchmark/experiments/fb64-shapes.mjs` (10k entities, hasAll over all): flat ~1.0 ns and 50 B/entity, composed
   ~1.9 ns and 115 B, FastBit1024(64) ~4.4 ns and 403 B. A 64 x 64 structure is a README recipe only.
4. **lite-ecs migration.** FB-01 is fixed in fastbit32 by S1, but lite-ecs pins
   `^1.0.0`; any lite-ecs user on a lockfile keeps the bug until they update. Does lite-ecs get a floor bump to `^1.2.1`
   in its own session?
5. **`countRange` contract.** Validate (it is called on hot paths by some users)
   or keep "caller must guarantee" and pin the garbage? Decided in S6.
6. **The compare-to-zero law (11.3 a).** **Adopted into ROADMAP section 1 (2026-10-10); T8 rows land with the next
   torture-touching session.** Promote it to the ROADMAP section 1 shared law and add the D1-D4 rows to T8?
   It is the one rule that would have prevented FB-01 and all three of its re-occurrences in section 11.
7. **SC-3 input (11.3 b).** **Recorded in ROADMAP SC-3 (2026-10-10).** Record "a summary multiplies the cost of a bad index" in SC-3 as the reason the
   single-word answer (permissive hot ops) does not generalize, so a future multi-word helper is not built on it.
8. **lite-o1 handoff (11.4).** Do `BitSet.firstClear/nextClear` (non-full summary) and
   `BitSet.isSubsetOf/intersects` enter the lite-o1 roster? Decided there, in its own ADR, not here.
9. **llms.txt boundary pointer.** `llms.txt` line 11 sends ">32 flags" users to `@zakkster/lite-bits`. The suite's
   multi-word bitset documented everywhere else (this file, ADR 0019) is lite-o1 `BitSet`. Verify that `lite-bits`
   exists; if not, this is FB-13-class doc drift, to fix in S8. **Checked 2026-10-10: no `lite-bits` package in the
   suite** -- it is drift; S8 repoints the line to lite-o1 `BitSet`.

---

## 13. FastBit1024: the 32 x 32 class (SC-5 SETTLED: A, 2026-10-10)

The maintainer chose to ship the section 11 idea here, as a fixed-geometry export. Draft:
`benchmark/experiments/fb1024-draft.mjs`; checker: `benchmark/experiments/fb1024-check.mjs` (research only).

**Shape.** `data: Int32Array(32)` plus three scalars: `active` (bit w iff `data[w] !== 0`), `full` (bit w iff
`data[w] === -1`) and `n` (exact count). Every mutator keeps all of them up to date, so no reader repairs anything.
Two summaries, because one summary answers one question (11.3 d): `active` routes lowest/highest/cursor/forEach,
`full` routes nextClearBit/acquire.

**Capacity 1..1024 without read-side masking.** Bits at or above capacity are never stored (mutators reject them),
so `nextClearBit` needs only `s < cap ? s : -1`: the lowest clear bit at or above capacity means there is none
below it (11.3 e: enforce padding on write, not on read).

**Fail closed (11.3 b, 11.3 c).** One check per call: `(i & 1023) !== i || i >= cap`. It rejects `undefined`, `null`,
`NaN`, `1.5`, `'3'`, `true`, `-1`, `1024` and `2^32`; a Symbol or BigInt throws on `&` itself. `-0` passes as slot 0.
`release(slot)` also throws when the slot is not held (double release). A rejected call leaves the state unchanged.

**Branch-free summary updates.** Full-word test without a branch: `nz(d + 1) ^ 1` where `nz(x) = (x | -x) >>> 31`
(at d = 2^31 - 1, d + 1 is the double 2^31 and `|` truncates it to -2^31, so nz is still 1). Count update:
`n += ((old >>> b) & 1) ^ 1` on add, `n -= (old >>> b) & 1` on remove.

**Cursor at the end.** `nextSetBit(from)` accepts from = capacity. For words above w it uses
`active & (-2 << w) & ((w - 32) >> 31)`: `-2 << 31` is 0, and the last term zeroes the mask at w = 32
(from = 1024), where `-2 << 32` would wrap to `-2 << 0`.

**(measured, 2026-10-10, node v26.8.2, arm64)** 3000 trials over capacities {1, 2, 31, 32, 33, 63, 64, 65, 500,
991, 992, 993, 1023, 1024} plus random ones, near-full phases included: ~290k checkpoints x 10 ops against a
`Uint8Array` oracle, invariants I1-I4 at every checkpoint, the fill-1024/free-{1023,31,0} extremes, the bad-input
matrix on every mutator: **0 failures**. Timing, net of an empty-loop floor, own process per (op, shape), three
runs: `nextClearBit` 0.47-0.52 ns with the free slot in word 0 and 0.48-0.52 ns behind 31 full words (flat);
`acquire` + `release` pair 5.19-5.33 ns in both shapes (flat, but slower than it should be; S4b profiles it
against lite-object-pool's free stack).

**Open for S4b:** why the acquire/release pair costs ~5 ns; whether `has` should stay fail-closed on the hot read
path (it cannot corrupt state, but `has(undefined)` answering for slot 0 is FB-02 again); hasAll/hasAny across
different capacities (the draft does not check; words above capacity are always 0, so the answer is still exact).

**Shipped in 1.4.0 (S4b, 2026-10-11, node v26.8.2, Apple M4 Pro).** `FastBit1024` is a named export of
`FastBit32.js`. The three open questions, answered:
- *The ~5 ns pair.* Ablation, one process per variant: the draft pair 5.43/5.49 ns (free slot in word 0 / 31);
  the `clz32(x) >>> 5` zero test in place of `nz(d + 1)`, still calling `nextClearBit()`, 4.87/4.85 (~4.9); plus the scan inlined into `acquire` (one
  word read reused for the write, the mask taken from `c & -c`) 3.20/3.20. In short: 5.4 ns draft -> ~4.9 ns with the cheaper zero test while still calling `nextClearBit()` -> ~3.0-3.2 ns with the scan inlined. Dropping the count, the index check
  or the double-release check each moved it by <= 0.05 ns. The rest is the loop-carried store-to-load chain
  (acquire writes the word and `full`, release reads them back); an `Int32Array` free stack with no checks
  measures 2.22/2.31 ns on the same harness. Shipped: 2.96-3.16 ns in the full witness (3.06-3.21 in an earlier run), flat over words 0..31.
- *`has` fails closed.* It throws like every index op. Cost, measured: `has` 0.91-0.98 ns vs the unchecked
  read 0.17 ns, check ~0.78 ns (full witness; 0.72-0.90 over 9 runs; an earlier run read 0.98-1.01 vs 0.15, ~0.86). Every variant of the check (cap only, mask only, `>>> 0`, inline
  `throw`) cost the same 0.6-0.8 ns in a scratch ablation: the throw site, not the compare, is the price.
- *Cross-capacity `hasAll`/`hasAny`.* Allowed and exact; T2, T5 and node:test cover it.
- *The witness rows.* The first version built one instance per word, so it measured heap placement: the
  same data in 32 instances spread 2.50-6.54 ns under PRESSURE, and reversing the allocation order moved the
  slow cells (round-2 review). Shipped harness: ONE instance and one corpus per process, re-shaped per word
  outside the timed loop, plus a must-fail foil (`foilWordScan`, an O(word) scan).
- *The acquire/has estimator (SLOT_SLOW).* Median of 5 passes of best-of-8 reps, at a quarter (acquire) or half
  (has) of the lane's loop length. This is an estimator change, not a threshold change. Its justification is that
  it keeps the gate's teeth: `foilWordScan` reads the same under the lane config and under both SLOT_SLOW configs
  (220.8 / 219.3 / 218.4 N in `witness:fast`, 166.5 / 165.1 / 165.8 N in the full run), and a deliberate word step
  measures the same with and without it (round-3 review).
- *PRESSURE is info-only for FastBit1024 (maintainer decision, 2026-10-11).* Same-word control: all 32 cells hold
  word 5, at the shipped estimator. PRESSURE `has` failed the 4.5 N spread gate in 1 of 4 runs and `acquire` in
  2 of 4. The real sweep failed has 4/5 and acquire 2/5. There is no word pattern: the median of words 0-15 equals
  the median of 16-31, and pass 0 of has reads ~0.6 ns vs ~1.25 ns later. Identical data in every cell spreads as
  much as the real sweep, so the spread belongs to the lane, not the op. (The 128 B state is off-heap and V8 does
  not guarantee its alignment; on the M4 Pro, 128 B lines, 240/240 sampled stores were 128 B aligned -- one line;
  two or three on a 64 B-line host (two if 64 B aligned, as observed here; not measured there). A miss is possible; a word-dependent one was not observed.)
  HOT stays gated.
- *HOT `nextClearBit` on a loaded host.* Same-word control (all 6 cells hold word 5), 8 runs each at load ~3.3:
  spreads 0.014-0.228 ns vs the real sweep's 0.029-0.299 ns, with whole passes shifting together. This is host
  noise, not the word. At NOISE ~0.03 ns the 6 N gate is 0.18 ns, so this row can flake on a busy host (one
  `witness:fast` run read 7.0 N); it passed in every verify and full run here. Reported, not widened.
Full witness (load 3.43 -> 3.65), net ns, min-max over words 0..31. HOT (gated, all flat): acquire+release
2.96-3.16 (4.00 N), `nextClearBit` 0.48-0.54, `lowest` 0.34-0.37, `highest` 0.40-0.47, `has` 0.91-0.98 (check
~0.78 ns; 0.72-0.90 over 9 runs). PRESSURE (info only): acquire 2.67-2.85 (3.69 N), `has` 0.84-1.37 (8.26 N),
the scans 0.02-0.29.
Every op 0 B/op (T6, both pool shapes); perf gate 0 scavenges at N and 8N.

---

## Appendix A -- the section 11 drafts as submitted (verbatim, 37dc47d)

Kept unedited so section 11 can cite it and `benchmark/experiments/s11-drafts.mjs` can load it. The probe pins the block's
sha256 and refuses to run if it changes, so do not reflow or reformat this block. **Do not copy from
here**: section 11.2 lists the defects. The box-drawing comment rules are the file's only non-ASCII bytes. RESEARCH.md
is not in the shipped files list and the hygiene test does not scan it, but strip them if this code ever moves.

```js
/**
 * High-performance contiguous bitset for AAA engine architecture.
 *
 * Design goals:
 * - Zero-GC hot paths
 * - Cache-friendly memory layout
 * - O(k) active-bit iteration
 * - Fast ECS subset testing
 * - Deterministic behaviour
 *
 * Assumption:
 * All bitsets participating in set algebra operations have
 * identical logical capacities.
 */
export class FastBitArray {
    /**
     * @param {number} bitCapacity - The logical number of bits required.
     */
    constructor(bitCapacity) {
        if (!Number.isInteger(bitCapacity) || bitCapacity < 0) {
            throw new TypeError("bitCapacity must be a non-negative integer");
        }

        const buckets = (bitCapacity + 31) >>> 5;

        this.logicalCapacity = bitCapacity;
        this.physicalCapacity = buckets << 5;
        this.data = new Uint32Array(buckets);
    }

    // ---------------------------------------------------------------------
    // Single-bit operations
    // ---------------------------------------------------------------------

    add(bit) {
        this.data[bit >>> 5] |= 1 << (bit & 31);
        return this;
    }

    remove(bit) {
        this.data[bit >>> 5] &= ~(1 << (bit & 31));
        return this;
    }

    toggle(bit) {
        this.data[bit >>> 5] ^= 1 << (bit & 31);
        return this;
    }

    has(bit) {
        return (this.data[bit >>> 5] & (1 << (bit & 31))) !== 0;
    }

    clear() {
        this.data.fill(0);
        return this;
    }

    // ---------------------------------------------------------------------
    // Queries
    // ---------------------------------------------------------------------

    /**
     * O(N) Loop-free Hamming Weight.
     * Returns the number of active bits.
     */
    count() {
        const data = this.data;
        const len = data.length;
        let total = 0;

        for (let i = 0; i < len; i++) {
            let v = data[i];

            if (v === 0) continue;

            v = v - ((v >>> 1) & 0x55555555);
            v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);

            total += Math.imul(((v + (v >>> 4)) & 0x0F0F0F0F), 0x01010101) >>> 24;
        }

        return total;
    }

    /**
     * O(N/32) Instantly finds the global index of the lowest active bit.
     */
    lowest() {
        const data = this.data;
        const len = data.length;

        for (let bucket = 0; bucket < len; bucket++) {
            const v = data[bucket];

            if (v !== 0) {
                const lsb = v & -v;
                const bit = (bucket << 5) + (Math.clz32(lsb) ^ 31);

                // Ensure we don't read garbage bits outside logical bounds if erroneously set
                return bit < this.logicalCapacity ? bit : -1;
            }
        }

        return -1;
    }

    /**
     * O(N/32) Finds the first available (inactive) bit.
     * Clamped strictly to the logical capacity to prevent Object Pool buffer overruns.
     */
    nextClearBit() {
        const data = this.data;
        const len = data.length;
        const limit = this.logicalCapacity;

        for (let i = 0; i < len; i++) {
            const inv = ~data[i] >>> 0;
            if (inv !== 0) {
                const lsb = inv & -inv;
                const bit = (i << 5) + (Math.clz32(lsb) ^ 31);

                // Return -1 if the clear bit is just structural padding
                if (bit < limit) return bit;
                return -1;
            }
        }

        return -1;
    }

    /**
     * Fast bulk subset test.
     * Equivalent to: (this & other) === other
     * Extremely hot path for ECS systems (archetype matching).
     */
    contains(other) {
        const a = this.data;
        const b = other.data;
        const len = a.length;

        if (len !== b.length) {
            throw new Error("FastBitArray capacity mismatch");
        }

        for (let i = 0; i < len; i++) {
            if ((a[i] & b[i]) !== b[i]) {
                return false;
            }
        }

        return true;
    }

    isEmpty() {
        const data = this.data;
        const len = data.length;

        for (let i = 0; i < len; i++) {
            if (data[i] !== 0) {
                return false;
            }
        }

        return true;
    }

    // ---------------------------------------------------------------------
    // Set algebra
    // ---------------------------------------------------------------------

    intersect(other) {
        const a = this.data;
        const b = other.data;
        const len = a.length;

        if (len !== b.length) {
            throw new Error("FastBitArray capacity mismatch");
        }

        for (let i = 0; i < len; i++) {
            a[i] &= b[i];
        }

        return this;
    }

    union(other) {
        const a = this.data;
        const b = other.data;
        const len = a.length;

        if (len !== b.length) {
            throw new Error("FastBitArray capacity mismatch");
        }

        for (let i = 0; i < len; i++) {
            a[i] |= b[i];
        }

        return this;
    }

    xor(other) {
        const a = this.data;
        const b = other.data;
        const len = a.length;

        if (len !== b.length) {
            throw new Error("FastBitArray capacity mismatch");
        }

        for (let i = 0; i < len; i++) {
            a[i] ^= b[i];
        }

        return this;
    }

    // ---------------------------------------------------------------------
    // Iteration
    // ---------------------------------------------------------------------

    /**
     * O(k) iteration (k = active bit count).
     * Strictly Zero-GC. Use this in hot paths.
     */
    forEach(callback) {
        const data = this.data;
        const len = data.length;

        for (let bucket = 0; bucket < len; bucket++) {
            let v = data[bucket];

            while (v !== 0) {
                const lsb = v & -v;

                callback((bucket << 5) + (Math.clz32(lsb) ^ 31));

                v ^= lsb;
            }
        }

        return this;
    }

    /**
     * WARNING: Allocates an Iterator object.
     * Not hot-path safe (triggers GC). Intended for initialization/debug only.
     */
    * values() {
        const data = this.data;
        const len = data.length;

        for (let bucket = 0; bucket < len; bucket++) {
            let v = data[bucket];

            while (v !== 0) {
                const lsb = v & -v;

                yield (bucket << 5) + (Math.clz32(lsb) ^ 31);

                v ^= lsb;
            }
        }
    }

    /**
     * WARNING: Allocates an Iterator object.
     * Enables standard `for (const bit of bitset)` loops. Not hot-path safe.
     */
    [Symbol.iterator]() {
        return this.values();
    }

    // ---------------------------------------------------------------------
    // Utilities
    // ---------------------------------------------------------------------

    /**
     * V8 fast-path cloning using underlying C++ memcpy.
     */
    clone() {
        const out = new FastBitArray(this.logicalCapacity);
        out.data.set(this.data);
        return out;
    }

    copyFrom(other) {
        if (this.data.length !== other.data.length) {
            throw new Error("FastBitArray capacity mismatch");
        }

        this.data.set(other.data);
        return this;
    }

    /**
     * Zero-copy view of the underlying buffer.
     */
    bytes() {
        return new Uint8Array(
            this.data.buffer,
            this.data.byteOffset,
            this.data.byteLength
        );
    }

    /**
     * Deep-copy serialization for state saving or web-worker transfer.
     */
    serialize() {
        return new Uint8Array(this.bytes());
    }
}

/**
 * MultiBit32 – zero-allocation fixed-capacity bitset
 *
 * Design goals:
 * - Exact logical capacity (no readable padding bits)
 * - Zero-GC hot paths
 * - Full feature set (scans, algebra, iteration)
 * - Safe by default
 */
export class MultiBit32 {
    /**
     * @param {number} numBits  Exact number of bits required
     */
    constructor(numBits) {
        if (!Number.isInteger(numBits) || numBits < 0) {
            throw new TypeError('numBits must be a non-negative integer');
        }

        this.numBits = numBits;
        this.numWords = (numBits + 31) >>> 5;
        this.words = new Uint32Array(this.numWords);

        // Mask for the last (possibly partial) word
        const rem = numBits & 31;
        this.lastMask = rem === 0 ? 0xFFFFFFFF : (1 << rem) - 1;
    }

    // ── Internal helpers ─────────────────────────────────────

    #word(bit) {
        return bit >>> 5;
    }

    #offset(bit) {
        return bit & 31;
    }

    #check(bit) {
        if (bit < 0 || bit >= this.numBits) {
            throw new RangeError(`bit ${bit} out of range 0..${this.numBits - 1}`);
        }
    }

    #sameSize(other) {
        if (other.numBits !== this.numBits) {
            throw new Error('MultiBit32 capacity mismatch');
        }
    }

    // ── Single-bit operations ────────────────────────────────

    add(bit) {
        this.#check(bit);
        this.words[this.#word(bit)] |= 1 << this.#offset(bit);
        return this;
    }

    remove(bit) {
        this.#check(bit);
        this.words[this.#word(bit)] &= ~(1 << this.#offset(bit));
        return this;
    }

    toggle(bit) {
        this.#check(bit);
        this.words[this.#word(bit)] ^= 1 << this.#offset(bit);
        return this;
    }

    has(bit) {
        this.#check(bit);
        return (this.words[this.#word(bit)] & (1 << this.#offset(bit))) !== 0;
    }

    // ── Whole-set operations ─────────────────────────────────

    clear() {
        this.words.fill(0);
        return this;
    }

    isEmpty() {
        const w = this.words;
        for (let i = 0; i < this.numWords; i++) {
            if (w[i] !== 0) return false;
        }
        return true;
    }

    isFull() {
        const w = this.words;
        for (let i = 0; i < this.numWords - 1; i++) {
            if (w[i] !== 0xFFFFFFFF) return false;
        }
        return (w[this.numWords - 1] & this.lastMask) === this.lastMask;
    }

    // ── Popcount ─────────────────────────────────────────────

    count() {
        const w = this.words;
        let total = 0;

        for (let i = 0; i < this.numWords; i++) {
            let v = w[i];
            if (v === 0) continue;

            v = v - ((v >>> 1) & 0x55555555);
            v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
            total += Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
        }
        return total;
    }

    // ── Bit scans ────────────────────────────────────────────

    /** Lowest set bit, or -1 if empty */
    lowest() {
        const w = this.words;
        for (let i = 0; i < this.numWords; i++) {
            const v = w[i];
            if (v !== 0) {
                const bit = (i << 5) + (Math.clz32(v & -v) ^ 31);
                return bit < this.numBits ? bit : -1;
            }
        }
        return -1;
    }

    /** Highest set bit, or -1 if empty */
    highest() {
        const w = this.words;
        for (let i = this.numWords - 1; i >= 0; i--) {
            let v = w[i];
            if (i === this.numWords - 1) v &= this.lastMask;
            if (v !== 0) {
                return (i << 5) + (31 - Math.clz32(v));
            }
        }
        return -1;
    }

    /** Lowest clear bit, or -1 if full */
    nextClearBit() {
        const w = this.words;
        for (let i = 0; i < this.numWords; i++) {
            let inv = ~w[i] >>> 0;
            if (i === this.numWords - 1) inv &= this.lastMask;

            if (inv !== 0) {
                const bit = (i << 5) + (Math.clz32(inv & -inv) ^ 31);
                return bit < this.numBits ? bit : -1;
            }
        }
        return -1;
    }

    // ── Set algebra ──────────────────────────────────────────

    /** true if this contains every bit set in other */
    contains(other) {
        this.#sameSize(other);
        const a = this.words;
        const b = other.words;

        for (let i = 0; i < this.numWords; i++) {
            if ((a[i] & b[i]) !== b[i]) return false;
        }
        return true;
    }

    intersect(other) {
        this.#sameSize(other);
        const a = this.words;
        const b = other.words;
        for (let i = 0; i < this.numWords; i++) a[i] &= b[i];
        return this;
    }

    union(other) {
        this.#sameSize(other);
        const a = this.words;
        const b = other.words;
        for (let i = 0; i < this.numWords; i++) a[i] |= b[i];
        return this;
    }

    xor(other) {
        this.#sameSize(other);
        const a = this.words;
        const b = other.words;
        for (let i = 0; i < this.numWords; i++) a[i] ^= b[i];
        return this;
    }

    difference(other) {
        this.#sameSize(other);
        const a = this.words;
        const b = other.words;
        for (let i = 0; i < this.numWords; i++) a[i] &= ~b[i];
        return this;
    }

    // ── Iteration (zero-GC) ──────────────────────────────────

    forEach(callback) {
        const w = this.words;
        for (let i = 0; i < this.numWords; i++) {
            let v = w[i];
            if (i === this.numWords - 1) v &= this.lastMask;

            while (v !== 0) {
                const lsb = v & -v;
                callback((i << 5) + (Math.clz32(lsb) ^ 31));
                v ^= lsb;
            }
        }
        return this;
    }

    // ── Cloning / copying ────────────────────────────────────

    clone() {
        const out = new MultiBit32(this.numBits);
        out.words.set(this.words);
        return out;
    }

    copyFrom(other) {
        this.#sameSize(other);
        this.words.set(other.words);
        return this;
    }

    // ── Serialization ────────────────────────────────────────

    /** Zero-copy view */
    bytes() {
        return new Uint8Array(this.words.buffer, this.words.byteOffset, this.words.byteLength);
    }

    /** Deep copy for transfer / storage */
    serialize() {
        return new Uint8Array(this.bytes());
    }

    // ── Debug helpers (allocate – not hot-path) ──────────────

    toArray() {
        const result = [];
        this.forEach(bit => result.push(bit));
        return result;
    }

    toBinaryString() {
        return Array.from(this.words)
            .map((w, i) => {
                let v = w;
                if (i === this.numWords - 1) v &= this.lastMask;
                return (v >>> 0).toString(2).padStart(32, '0');
            })
            .reverse()
            .join('_');
    }
}

/**
 * SparseBit1024 - A 2-level hierarchical bitset for ultra-fast sparse queries.
 * Maximum capacity: 1024 bits (32 buckets of 32 bits).
 *
 * Best for: Systems where entities are scattered widely across indices,
 *           or for finding the lowest available ID out of 1024 instantly.
 */
export class SparseBit1024 {
    constructor() {
        this.activeMask = 0; // The O(1) routing table
        this.data = new Uint32Array(32); // The actual 1024 bits
    }

    add(bit) {
        const word = bit >>> 5;
        this.data[word] |= (1 << (bit & 31));
        this.activeMask |= (1 << word); // Flag this bucket as active
        return this;
    }

    remove(bit) {
        const word = bit >>> 5;
        const mask = ~(1 << (bit & 31));

        // Clear the bit in the data chunk
        let chunk = (this.data[word] &= mask);

        // TAX: If the bucket is now empty, clear it from the routing table
        if (chunk === 0) {
            this.activeMask &= ~(1 << word);
        }
        return this;
    }

    has(bit) {
        return (this.data[bit >>> 5] & (1 << (bit & 31))) !== 0;
    }

    // ---------------------------------------------------------------------
    // The Magic: O(1) global queries without loops
    // ---------------------------------------------------------------------

    /**
     * O(1) instantly finds the lowest set bit across 1024 states.
     * No loops. Just two SWAR operations.
     */
    lowest() {
        if (this.activeMask === 0) return -1;

        // 1. Find the lowest active bucket
        const lowestBucketLsb = this.activeMask & -this.activeMask;
        const bucketIdx = Math.clz32(lowestBucketLsb) ^ 31;

        // 2. Find the lowest active bit within that bucket
        const chunk = this.data[bucketIdx];
        const bitLsb = chunk & -chunk;

        return (bucketIdx << 5) + (Math.clz32(bitLsb) ^ 31);
    }

    /**
     * O(1) finds the first available clear bit.
     * Brilliant for 1024-slot Object Pools.
     */
    nextClearBit() {
        // If all 32 buckets are fully active, activeMask is 0xFFFFFFFF
        const invMask = ~this.activeMask >>> 0;
        if (invMask !== 0) {
            // There is at least one bucket that is entirely empty
            const lowestEmptyLsb = invMask & -invMask;
            return (Math.clz32(lowestEmptyLsb) ^ 31) << 5;
        }

        // Otherwise, fall back to checking buckets for partial gaps
        // (This still requires a loop, but only when heavily saturated)
        for (let i = 0; i < 32; i++) {
            const inv = ~this.data[i] >>> 0;
            if (inv !== 0) {
                const lsb = inv & -inv;
                return (i << 5) + (Math.clz32(lsb) ^ 31);
            }
        }
        return -1;
    }

    // ---------------------------------------------------------------------
    // Ultra-Fast Sparse Iteration
    // ---------------------------------------------------------------------

    /**
     * O(k) iteration over active buckets, then active bits.
     * Skips vast ranges of empty bits without executing loop iterations.
     */
    forEach(callback) {
        let mask = this.activeMask;

        // Iterate only over buckets that contain bits
        while (mask !== 0) {
            const bucketLsb = mask & -mask;
            const bucketIdx = Math.clz32(bucketLsb) ^ 31;

            let chunk = this.data[bucketIdx];
            const base = bucketIdx << 5;

            // Iterate only over bits within this bucket
            while (chunk !== 0) {
                const bitLsb = chunk & -chunk;
                callback(base + (Math.clz32(bitLsb) ^ 31));
                chunk ^= bitLsb;
            }

            mask ^= bucketLsb; // Clear bucket from routing mask
        }
        return this;
    }
}

```

---

## 14. External audit of 1.5.0: triage (2026-10-14)

An outside audit (pasted by the maintainer, 2026-10-14) made five code claims and
four extension proposals. Each was checked against `FastBit32.js` at 22693ef and
against this file and the ROADMAP. Probes and logs: `.handoff/evidence/audit-2026-10-14/`
(gitignored; node v26.8.2 darwin/arm64).

### 14.1 Code claims

| # | Claim | Verdict | Where it lives |
| --- | --- | --- | --- |
| 1 | Constructor / `fromArray` store `>>> 0`, mutators store int32: `serialize()` differs for one set; bit-31 values make the field a HeapNumber | TRUE, ALREADY KNOWN | FB-03; SC-2 option B (2.0.0), measured in S2a (`%DebugPrint`: signed Smi vs unsigned HeapNumber; serialize 0/0 vs 7/61 scavenges) |
| 1b | `BitMapper.getMask` returns `>>> 0` but `bit(name)` returns `1 << i`: `getMask(['F31']) !== bit('F31')` | TRUE, NEW DETAIL | Not in SC-2's scope until now. Added to SC-2 B (ROADMAP) |
| 2 | `rank(31)` deopts after warm-up on 0..30: `(1 << 31) - 1` overflows int32 (CheckedInt32Sub) | NOT REPRODUCED | `rank-deopt.mjs`: 2e6 calls warm on bits 0..30, then 2e6 on bit 31, under `--trace-deopt`: 4 bailouts, all OSR / insufficient-feedback in the probe's own loop, 0 with an overflow reason, `rank(31) = 31`. The `- 1` feeds only `&`, so V8 truncates it to Word32 and needs no overflow check. The audit's `~(-1 << bit)` is an equivalent loop-free mask (checked by hand for bit 0 and 31); no change is needed. A browser / Maglev-only engine is not covered by this probe |
| 3 | `FastBit1024.toggle` validates twice and reads the word twice (branch to `add` / `remove`) | TRUE | `FastBit32.js:572-575`. The proposed single-load form keeps I1-I4 by the same `clz32(d) >>> 5` and `clz32(~d) >>> 5` terms `add` / `remove` use. A speed claim, so STATISTICAL: adopt only with an interleaved A/B, never on reasoning. ROADMAP FB-15 |
| 4a | `BitMapper(['A','A'])`: one name owns two bits, bit 0 orphaned | TRUE, ALREADY KNOWN | FB-06 (S6) |
| 4b | `_reverse = new Array(32)` is HOLEY; `getActiveNames` walks the whole Map (O(names), a Map iterator) | TRUE, MINOR | `getActiveNames` already allocates its result array (a cold API), so the iterator is not a hot-path breach. Folded into the FB-06 fix: walk the set bits of `value` through a packed `_reverse` once duplicates are rejected |
| 5a | `countRange`'s outer `>>> 0` is redundant | TRUE, NO EFFECT | `countMasked` ANDs it into int32 anyway. Leave it to SC-3 (S6), which decides `countRange`'s contract |
| 5b | `nextCombination('3') === 31`; coerce with `v \|= 0` | TRUE, ALREADY PINNED | `FastBit32.js:334` pins it until S6 (SC-3 input law) |

### 14.2 Extension proposals

| Proposal | Verdict | Reason |
| --- | --- | --- |
| `findClearRun(k)` / `acquireRun(k)`: lowest run of k clear bits by a SWAR shift cascade | CANDIDATE (kernel verified) | `clear-run.mjs`: a doubling cascade `r &= r >>> s` (at most 5 steps for k <= 32) then `31 - clz32(r & -r)`, against a brute-force oracle: 640,320 cases (k = 1..32, 10 edge words + 20k random each), 0 mismatches. Must-fail control: signed `>>` instead of `>>>` smears bit 31 and disagrees 79 times. One word only; a run crossing words in `FastBit1024` needs a carry between neighbour words, not designed. Overlaps BITWISE_RESEARCH Candidate C (TLSF) for variable sizes. Needs a named consumer before a planner pass |
| `FastBit1024` tier-2 parity: bulk `union` / `intersect` / `difference`, `prevSetBit`, `rank` / `select`, pair iterators, `copy` / `equals` | CANDIDATE, CONSUMER-GATED | The `_active` / `_full` summaries do make these O(non-empty words). But SC-5 scoped FastBit1024 to slot pools and id sets; the ECS use the audit names belongs to lite-ecs (BITWISE_RESEARCH Candidate D: query sets on lite-o1 `SparseSet`), and lite-o1 `BitSet` already has bulk ops. Add a member only when a consumer needs it in a pool |
| Raw-word views over an `Int32Array` arena (`FastBit1024View`, 36-word stride) or a `SharedArrayBuffer` | CANDIDATE, OVERLAPS SC-2 | The free iterators are already raw-word functions. Caveat the audit omits: a view over a SharedArrayBuffer shared by workers is a data race unless every write is an `Atomics` op (BITWISE_RESEARCH Candidate A, `sab-alloc.mjs`, uses CAS). A single-thread arena is plain typed-array code |
| `FastBit32768` (32 x 32 x 32, three summary hops) | REJECTED HERE | SC-4 / SC-5 boundary: "32 x 32 x 32 is not built here". The multi-word answer is lite-o1 `BitSet` (3 levels, fan-out 32); its missing `firstClear` / `nextClear` is the 11.4 handoff, decided in lite-o1 |
| `FastBitTable32`: `dense[mask.rank(bit)]` sparse table | REJECTED AS A CLASS | `rank` is already documented as the HAMT index (section 7). At most a GUIDE recipe in S8 |

Lesson kept: three of the five code claims were already on record (FB-03, FB-06,
the S6 pins); the one engine claim with a mechanism (the rank deopt) did not
reproduce. An audit's JIT claim is a hypothesis until `--trace-deopt` or
`%DebugPrint` shows it on the engine in question.

---

## 15. FastBitSet.js (lemire) gap check (2026-10-22)

The maintainer asked what FastBitSet.js has that this package lacks, in function
and in benchmarking. Source: the repo README (github.com/lemire/FastBitSet.js,
read 2026-10-22: API list and benchmark categories; the internals were not read).
Compared against the methods in `FastBit32.js` at 435e748.

### 15.1 Function

FastBitSet is ONE dynamic multi-word set (32-bit words, `resize` / `trim`). Its
single-word surface is already here: `add` / `remove` / `has` / `flip` ->
`add` / `remove` / `has` / `toggle`; `intersects` -> `hasAny`;
`intersection_size` -> `countMasked`; in-place `union` / `intersection` /
`difference` -> `union` / `intersect` / `difference`; `equals`, `clone`;
iteration -> `forEach` / `nextSetBit`. `union_size` / `change_size` on one word
are `popcount(v | m)` / `popcount(v ^ m)`: a composite, not a gap.

The gaps are in `FastBit1024` (today: add / remove / toggle / has, acquire /
release, size / capacity, isEmpty / isFull, lowest / highest, nextClearBit,
nextSetBit, hasAll / hasAny, forEach, clear):

| Gap | FastBitSet | Value | Verdict |
| --- | --- | --- | --- |
| G1 save / restore: `serialize` + a `fromWords`-style restore, plus `copy` / `equals` | `fromWords`, `clone`, `equals` | Snapshots for rollback, save games, network sync. Today the only way is reading `_data`, which voids I1-I4 | CANDIDATE, FIRST. The restore must rebuild `_active` / `_full` / the count from the words and fail closed on a bit at or above capacity (I4) |
| G2 cross-set counts without a result set | `intersection_size`, `difference_size`, `union_size`, `change_size` | "How many ids are in both sets" at O(non-empty words) via `_active`, zero allocation | CANDIDATE |
| G3 in-place `union` / `intersect` / `difference` between two FastBit1024 | `union`, `intersection`, `difference`, `change` | Bulk set algebra | CANDIDATE, CONSUMER-GATED (same as 14.2; lite-o1 `BitSet` has bulk ops) |
| G4 checked add (returns whether the bit was new) | `checkedAdd` | Dedupe in id sets; `acquire` already covers pools | MINOR |

Not adopted: the `new_*` operations and `array()` (allocate by design);
`resize` / `trim` (fixed capacity, SC-5); `[Symbol.iterator]` (an iterator object
per loop; the `nextSetBit` cursor is the zero-GC form); `difference2` (niche).

### 15.2 Benchmark

FastBitSet's suite: categories create, array, foreach, cardinality, query, clone,
intersection, union, difference, xor, with `-card` (size only) and `-inplace`
variants. Competitors: TypedFastBitSet, roaring, infusion BitSet, tdegrunt BitSet,
mattkrick fast-bitset and the native `Set`. Its published table is from Node 10.9
on an i7-6700: REPORTED-tier at best and stale; never quote it.

What this package lacks:
1. The competitor matrix itself. S2b (ROADMAP section 6) was never built
   (`benchmark/Matrix.mjs` does not exist; no competitor devDeps installed), so the
   README comparison tables are still unverified (FB-08).
2. A like-for-like multi-word row. S2b compares the multi-word libraries on their
   32-bit subset only; `FastBit1024` against `fastbitset` / `typedfastbitset` at
   1024 bits is a fair comparison. For "lowest free slot" they need a scan loop,
   which is the difference worth showing.
3. FastBitSet's category names (`-card`, `-inplace`), so readers can map rows.
4. A column FastBitSet does not measure: scavenges per op, from the torture
   machinery. That is this package's differentiator.

## 16. What FastBit1024 can take from its siblings (2026-11-04)

The maintainer asked the reverse question: several suite modules borrowed from
fastbit; can fastbit borrow from them? Read: lite-o1 `BitSet` (O1.js:3739, eaa46e3),
lite-o1 `RankSelect` (O1.js:5269), lite-loglogn `StratifiedBitset`
(LogLogN.js:124, eda355c) and its `test/Count.test.js`, and the RULED RoaringSet
PROPOSAL (LiteLogLogN/.handoff/PROPOSAL-roaringset.md, sha256/8 95713727, ruled
2026-11-04; R1, version slot 0.6.0, not yet built). Code read only; no probe ran.

### 16.1 Worth taking

| # | From | What | For | Verdict |
| --- | --- | --- | --- | --- |
| T1 | StratifiedBitset `Count.test.js`; RoaringSet 2.3 | COUNT gate: a Proxy swapped into the word array after construction counts every word read / write; an exact table per op and state, upper bounds on seeded random ops, a must-fail naive-scan control, one Worker per case so a hang is a FAIL. RoaringSet adds a worst-case search (sweep + hill-climb), reported as a LOWER bound | `FastBit1024` loops over `_data` (forEach, hasAll / hasAny, nextSetBit, nextClearBit): bounds become DETERMINISTIC gates instead of STATISTICAL witness rows | CANDIDATE, test-only, no public surface, no PROPOSAL needed. Not for `FastBit32` (one number, no array): there the deterministic tool is the LiteUtils bytecode-budget script |
| T2 | RoaringSet R1 surface | Counting set ops `intersects` / `intersectionSize` / `unionSize` / `differenceSize`: cold, 0 B, neither set changes, TypeError on a wrong type, RangeError on a universe mismatch | G2 (15.1): take the suite's names | CANDIDATE, joins the G1 research burst. `hasAny` is already `intersects` under fastbit's name |
| T3 | RoaringSet `addRange(lo, hi)` (Q-3) | Range set: precount, RangeError before any write, allocates nothing, returns this | `FastBit1024` set / clear range: fill middle words with -1, mask the two ends, update `_active` / `_full` / `_n`. With `findClearRun` (14.2) it reserves a contiguous slot block in one step | CANDIDATE, joins the G1 research burst |
| T4 | StratifiedBitset `predecessor` | The summary descent run in reverse | `FastBit1024.prevSetBit` (already a 14.2 candidate; `FastBit32` has `prevSetBit`) | CANDIDATE, joins the G1 research burst |
| T5 | RoaringSet 1 (P-5) | Hot bodies measured against V8's 460 B inlining limit (successor 621 B, predecessor 759 B on V8 14.6, so a shrink task) | Shows the limit bites in practice | Already the NEXT.md LiteUtils engine-gates unit; no new item |
| T6 | lite-o1 `BitSet` | Input law: `typeof` guard before `>>>`; `(i >>> 0) !== i` rejects bad indexes; queries never throw (test -> false, firstSet / nextSet -> -1) | S6 / SC-3 | Prior art for the S6 research burst, not a copy |

### 16.2 Questions the G1 research burst must put to the maintainer

- Q (T2) Capacity mismatch in cross-set ops: today `hasAll` / `hasAny` accept
  different capacities; RoaringSet throws RangeError on a universe mismatch.
  Keep fastbit's rule for the counts, or follow RoaringSet.
- Q (T3) Range convention: RoaringSet `addRange` is half-open [lo, hi) (ruled
  2026-11-04, as CRoaring `add_range` and JS `slice`); fastbit `countRange` and
  `rangeMask` are inclusive [start, end]. Two conventions in one suite invite
  off-by-one bugs, so this is a ruling, not a planner choice.
- Q (G1) Serialization format: RoaringSet R1 ships no serialization (only a cold
  `dump()`), so `FastBit1024` save / restore would be the suite's first. Define
  the format so RoaringSet R2 can reuse it instead of inventing a second one.

### 16.3 Where fastbit is ahead (nothing to take)

- `FastBit32.select` is a branchless 5-step descent; `RankSelect`'s in-word select
  loops up to 31 times.
- Signed int32 results (SC-2): `StratifiedBitset` and RoaringSet R1 return keys
  >= 2^31 boxed (RoaringSet: ~16-32 B per non-inlined call, REPORTED) and defer
  a signed / `successorInto` API to R2. SC-2 is the precedent for that R2 work.
- `FastBit1024._full` makes `nextClearBit` a summary lookup; `BitSet` has no
  `firstClear` / `nextClear`.
- Roaring containers pay off per 2^16-key chunk; at 1024 bits (128 B of data)
  they buy nothing. The ROADMAP already names `FastBit1024` as the design-parity
  source for RoaringSet's in-container summary.

## 17. FastBit1024 consumer-value set: the G1 research burst (2026-11-04)

The research burst RESEARCH 16.2 asked for, before any planner pass on new
`FastBit1024` surface: G1 save / restore + copy / equals, G2 cross-set counts
under RoaringSet's names, a set / clear range, `prevSetBit`. Candidate bodies
were written as a SUBCLASS of the shipped 1.5.0 class (FastBit32.js
sha256/8 21b08802, untouched) and probed; the draft surface, the alternatives
and the Q-ids are in `.handoff/PROPOSAL-fastbit1024.md` (gitignored), the
probes and logs in `.handoff/research/fastbit1024-g1/`. Apple M4 Pro, Node
v26.8.2 / V8 14.6; the DETERMINISTIC probes ran untimed on a busy host
(load1 14-23), which counts and correctness do not depend on.

### 17.1 Findings

- **Every zero-GC shape allocates nothing** (DETERMINISTIC, the torture
  harness's `measureBop`, K = 65536, 7 / 7 valid windows, 0 scavenges in
  2e6 ops): `saveInto` into a caller's `Int32Array`, `loadFrom`, `copy`,
  `equals`, `intersectionSize` / `unionSize` / `differenceSize`,
  `addRange` + `removeRange`, `prevSetBit` and a reverse `prevSetBit` walk.
  The allocating shapes are the controls: `serialize()` 200 B,
  `deserialize` / `clone` 264 B, `Array.from(serialize())` 2,320 B.
- **The first restore shape failed open.** Validating the image in one pass
  and writing it in a second pass that re-reads the source broke I4 on a
  `Proxy` over an `Int32Array` (it passes `instanceof Int32Array`), and
  accepted a non-int32 element from one. The brand
  `ArrayBuffer.isView(x) && x instanceof Int32Array` reads an internal slot,
  so a Proxy fails it; a genuine `Int32Array` has no element accessors, so the
  two passes read the same words. Accepting a plain Array (the JSON shape)
  safely would need one read per element into a scratch plus a re-entrancy
  check; the PROPOSAL recommends the caller's `new Int32Array(arr)` instead
  (200 B, once).
- **Two holes remain open (review r1).** `instanceof FastBit1024` also passes a
  Proxy and an `Object.create(FastBit1024.prototype)` forgery, and `copy`
  trusts their count and summaries (I3 broken). A subclass `length` getter is
  user code: a lying length silently truncates a restore. Both are maintainer
  questions (PROPOSAL Q-8, Q-9): a private-name brand or a rebuild for the
  first, the intrinsic `length` getter for the second.
- **Fail-closed restore holds** on the v2 shape: 1,320 hostile cases over 16
  capacities (bit at capacity, header / length / offset damage, wrong source
  types, oversize images and copies that do not fit), every one throwing with
  the receiver unchanged field for field; 19,200 round-trip checks rebuild
  I1-I4 exactly.
- **The range ops agree with the shipped single-word helpers**: 1,232,886
  `addRange` / `removeRange` calls (every half-open range at seven
  capacities), words equal to the `FastBit32.rangeMask` construction and the
  count delta equal to `FastBit32#countRange`. `prevSetBit` matched a naive
  scan on 278,200 queries; the counts matched a naive loop on 4,000 random
  pairs, differing capacities included. 10 / 10 non-equivalent mutants were
  killed.
- **Inlining** (REPORTED, V8 14.6, limit 460 B): every new hot body is under
  the limit (prevSetBit 225, addRange 315, intersectionSize 130, copy 233,
  equals 139 B); only the cold `loadFrom` is over it (589 B).
- **A self-describing image beats raw words.** A headerless restore reads
  the receiver's word count, so a longer image is silently truncated; one
  header word (tag, version, capacity) turns that and an arena offset error
  into a RangeError.
- **Prior art.** lemire `fromWords` wraps the caller's array unchecked (the
  aliasing shape this package must not copy); its `equals` and `*_size` ops
  accept differing lengths, as fastbit's `hasAll` / `hasAny` do. lite-o1
  `BitSet` throws on a capacity mismatch and has no serialization, copy or
  equals. StratifiedBitset's `predecessor` is strict (`< x`), unlike
  `FastBit32.prevSetBit` (`<= from`).
- **Not measured**: the summary-rebuild timing (PENDING: the quiet lock
  refused, exit 76, NOISY host).

### 17.2 Open questions (ruled in the PROPOSAL)

Q-1 capacity mismatch in cross-set ops; Q-2 range convention; Q-3 save format
and its zero-GC shape (reusable by RoaringSet R2); Q-4 copy / equals / clone;
Q-5 ship order; Q-6 prevSetBit domain; Q-7 an `intersects` alias; Q-8
trusting `other` in copy; Q-9 reading an image's length.

RULED by the maintainer 2026-11-04, every one on its recommended option
(quoted in the PROPOSAL, section 7): keep fastbit's capacity rule (exact
answers across capacities; a write fails closed when a bit does not fit);
half-open ranges; the versioned `Int32Array` image with `saveInto` /
`loadFrom`; copy, equals and clone; all four groups in 1.6.0; inclusive
`prevSetBit`; no `intersects` alias; a private-name brand on every cross-set
method (hasAll / hasAny included); the intrinsic `length` getter, read once.

## 18. FastBit64: the S9 research burst (2026-11-05)

The research burst ROADMAP S9 requires before any planner pass (maintainer, 2026-11-04;
run ahead of the T6-LOAD diagnosis by the maintainer's decision of 2026-11-05). SC-4's
shape is SETTLED and not reopened: one flat object, two int32 fields, bodies on shared
single-word kernels. A candidate class was written OUTSIDE the package
(`.handoff/research/fastbit64/candidate.mjs`, gitignored; FastBit32.js sha256/8 71f28feb
and FastBit32.d.ts a650fa3c untouched, both 1.6.0) and probed. The draft surface, the
alternatives and the Q-ids are in `.handoff/PROPOSAL-fastbit64.md`. Apple M4 Pro (12
cores), Node v26.8.2 / V8 14.6.202.34-node.28, 2026-11-05 08:41-08:49Z, load1 3.0-4.0
(baseline 2.21): the host was PRELIMINARY for timing, which the DETERMINISTIC probes
(counts, correctness, allocation) do not depend on.

### 18.1 Findings

- **Prior art in the suite: none.** No package keeps a 64-bit bitset in two int32 words
  or in a BigInt (scout, 7 patterns over every main file and probe folder; near misses
  are hashes and number splits: LiteSketch `addHashed(hi, lo)`, LiteAdaptive, LiteBmfont).
  The one consumer that hits the 32-bit limit is lite-ecs (`LiteEcs/ROADMAP.md:25`, "at
  most 32 component types"); its plan for wider masks is `FastBit1024` (`:35-37`). No
  package asks for a FastBit64. BitMapper refuses more than 32 names (`FastBit32.js:388`).
- **Correctness (DETERMINISTIC).** Every candidate method matches TWO independent
  oracles, a BigInt model and the shipped `FastBit1024(64)`, on 2,621 word pairs
  (boundary words with bits 31 / 32 / 63, -1, -2^31, 2^31 - 1, plus seeded random and
  sparse): 1,764,168 checks, 0 FAIL (p1). The cursors are exhaustive over their
  domains, every half-open range [a, b) on 40 words is checked, and the kernels
  (`ctz32`, `popcnt32`, `select32`) equal the shipped FastBit32 `lowest` / `count` /
  `select` bodies on every word of the corpus. 19 / 20 LISTED one-token mutants are
  killed by p1 + p2; the review found four guard-drop mutants that survive (fromArray
  index, setWords lo, equalsWords hi, saveInto offset: one slot of a pair untested), so
  the planner owes a bad-input row per guarded argument. The survivor (dropping `ArrayBuffer.isView` from the source brand) is
  equivalent: the intrinsic `@@toStringTag` getter already returns `undefined` for every
  non-TypedArray. FastBit1024 1.6.0 has the same redundant third check.
- **Branchless word split.** With `ctz32(x) = 32 - clz32(~x & (x - 1))` (32 at 0, no
  branch), the two-word scans need no branch: lowest = `t | ~((t - 64) >> 31)` with
  `t = ctz32(lo) + (ctz32(hi) & -(ctz32(lo) >>> 5))`; highest = `63 - clz64` the same
  way. The cursor masks use `(from - 32) >> 31` to pick the word (no `<< 32` trap).
- **Fail-closed input law, one check.** `(i & 63) !== i` rejects -1, 64, 2^31, 2^32 + 3,
  1.5, NaN, Infinity, '3', null, undefined, true, [3] and an object with valueOf,
  RangeError with the receiver unchanged (unchanged by the method: a user valueOf runs once,
  before the throw, and its own side effects stand, as in FastBit1024); Symbol / BigInt throw TypeError from `&`
  (126 law rows, p1). Word inputs (ctor, setWords, equalsWords) accept a number that is
  an int32 or a uint32 and store `| 0`; anything else is RangeError, and a non-number is
  never converted.
- **The private fields are the brand.** With `#lo` / `#hi`, `other.#lo` throws
  TypeError on `{}`, `{lo, hi}`, a Proxy of a real instance, an
  `Object.create(FastBit64.prototype)` forgery, a FastBit32 or a FastBit1024, and
  accepts subclass instances, with no extra check (p1, p5). The public-field shape
  (SC-4's 2026-10-11 probe) FAILS OPEN: `hasAll({})`, `hasAll({lo: 0, hi: 0})`,
  `hasAll(Proxy)` and `hasAll(forgery)` answer `true` (p5). The underscore + `#brand`
  shape (FastBit1024 parity) is closed too, but costs 24 B of bytecode in `hasAll`
  (67 B vs 43 B).
- **Zero allocation, inlined or not (DETERMINISTIC).** All 21 hot lanes (every mutator,
  query, cursor walk, range op, saveInto / loadFrom, the lo / hi getters on bit-31
  words) are 0.000 B/op with 0 scavenges in 2e6 ops, each op and every callee verified
  TurboFan (measureBop, K = 65536, 7 / 7 valid windows) -- AND the same with
  `--no-turbo-inlining`, where every kernel and method is reached through a real call
  (p3). Every value is an int32, so nothing boxes on a 64-bit Node. On a
  pointer-compressed engine (31-bit Smi) a word in [2^30, 2^31) is not a Smi: the
  reviewer's d8 run showed 0 scavenges inlined; the no-inlining case is unproven. Control: a callee
  returning the unsigned form of a bit-31 word (`x >>> 0`) reads 0.000 B/op inlined and
  **16.000 B/op** under `--no-turbo-inlining`, while still carrying the TurboFan status
  bit. That is the exact T6-LOAD signature (NEXT.md): status bits do not prove
  inlining, and an unsigned double crossing a call boxes 16 B. It supports the T6-LOAD
  hypothesis but does not prove it; that burst gets it as an input.
- **Inlining (REPORTED, V8 14.6, limit 460 B).** Every candidate body is under the limit:
  hot bodies 19-181 B (hasAll 43, has 67, add 84, lowest 56, nextSetBit 139, prevSetBit
  148, select 115 + the `select32` kernel 323), cold `loadFrom` 453 B. TurboFan inlined
  every kernel into its method. In one loop calling ten methods, the 920 B cumulative
  budget ran out, so `rank` and `countRange` stayed calls (`count` and `select` inlined in only one of two
  compilations; p5-inline.out); the no-inlining
  run shows that costs no allocation. Duplicating kernel bodies inline (no free
  functions) grows `count` from 35 B to 207 B and `lowest` from 58 B to 108 B (p4).
- **Save / restore = the FastBit1024 image at capacity 64.** `[0x46420840, lo, hi]` is
  byte-identical to `FastBit1024(64).serialize()` on every corpus word; each class
  loads the other's image (p1). loadFrom takes any FastBit1024-format image (capacity
  1..1024) whose set bits are below 64, and refuses, with the receiver unchanged: a bit at
  the image capacity for every capacity 1..63, a bit >= 64 in larger images, header /
  version / capacity / length damage, bad offsets, a lying-length subclass, a Proxy, a
  re-prototyped Uint32Array and every non-Int32Array source. It loads a genuine
  subclass, a SharedArrayBuffer image and a 1-word image followed by a non-zero arena
  word (hi stays 0): 402 rows, 0 FAIL (p2).
- **SAB + concurrent writer (the 1.6.0 required probe).** A worker flips the hi word of
  a capacity-40 image between valid (bits 32..39) and invalid (bits 40..63) while the
  main thread restores 2e6 times. Candidate: 1,985,524 accepted, 14,476 refused,
  **0 FAIL-OPEN**. The two-pass control (validate one read, store another) failed open
  2x in the same run, so the race was hit (2, 4 and 30 hits / 2e6 over three runs:
  too thin for a gate control, which must be the re-read mutant); a candidate mutant that re-reads
  `src[base + 1]` failed open 649x (p7). Reading each word once into a local and
  validating the local is what makes restore safe; there is no summary to tear.
- **The 64 x 64 recipe.** Two shapes on the public draft surface, both exact against a
  byte-array oracle on 40 seeded runs of add / remove / acquire / release / has / lowest /
  nextSetBit / size (866,216 checks, 0 FAIL), fail-closed on every index and 0 B/op on
  acquire + release, has and nextSetBit (p8). Retained bytes (REPORTED, 2,000 live
  structures after gc): R1 = one Int32Array(128) + two FastBit64 summaries, **852 B**;
  R2 = SC-4's literal 64 FastBit64 objects + summaries, **3,261 B**; one FastBit64 37 B;
  one FastBit1024 404 B.
- **Not measured: timing.** p6 (interleaved A/B of the five storage / kernel / branch
  variants plus FastBit1024(64): hasAll, lowest, has, add) was refused by the quiet lock
  (`run --strict`, exit 76, NOISY: load1 3.24 >= baseline 2.21 + 1). PENDING. SC-4's
  2026-10-11 table stays the only timing evidence for the flat shape.

### 18.2 Open questions (ruled in the PROPOSAL)

Q-1 release slot; Q-2 field storage and brand; Q-3 index law and domains; Q-4 word-input
law; Q-5 mask arguments; Q-6 surface scope; Q-7 ranges; Q-8 word kernels (+ section 8 K1);
Q-9 save format (+ BigInt); Q-10 the 64 x 64 recipe shape; Q-11 BitMapper above 32
names; Q-12 member naming; Q-13 fromArray container law (a review DESIGN blocker: the
draft, like FastBit32.fromArray, clears the set on fromArray(42) / ({}) / (true)).

RULED by the maintainer 2026-11-05, every one on its recommended option (quoted in the
PROPOSAL, section 7): ship as 1.7.0 ahead of S6; private `#lo` / `#hi` as the brand;
fail closed on every index with one check; a word is an int32 or a uint32 number, stored
signed; cross-set methods take another FastBit64; the full draft surface without pool
ops; half-open ranges; private kernels (exports and K1 wait for S6); the FastBit1024
image at capacity 64; the Int32Array recipe, tested; BitMapper unchanged; FastBit32's
names first; `fromArray` takes an Array or a TypedArray only.

---

## 19. Lane P calibration (NIGHTLY program, 2026-11-06)

Lane P is `.github/workflows/perf-nightly.yml` (REPORT-ONLY, STATISTICAL tier). Its numbers are REPORTED until this
protocol closes per OS; nothing below is measured yet. Source: SPEC-nightly (Q-N2 ruling, CAL-1..CAL-5, addenda A2
and A3 applied).

- CAL-1 Window. At least 10 DECISIVE nights per OS over at least 7 UTC days. Manual dispatches count for at most
  floor(n/3) of the samples; excess dispatches are dropped, latest first. A change to any pinned harness sha
  (the `sha256` map in night.json) restarts the window. Only DECISIVE nights count (no HARNESS in either arm, the
  control tripped, arm-A exit 0 or 1); on a loaded runner (macOS) HARNESS / HOST nights are expected and do not count.
- CAL-2 Split-half. In time order, derive from each half: S = q99 of the real-row spreadN; Nc = q90 of
  noise/floor; F = min of the control and foilSubEps spreadN; plus p (real-arm FAIL per round), q (control row FAIL
  per round), h (HOST + demoted share). The halves match when |S1 - S2| and |Nc1 - Nc2| are each <= 0.15 x the
  larger, AND S_i < F_j crosswise, AND half 1's (S, Nc) replayed on half 2's stdout reproduce >= 90% of its verdicts
  (and the reverse). Per-round per-row verdicts live only in the uploaded round stdout files, not in night.json
  (A2), so the replay reads those files. The bounds are 95% one-sided Clopper-Pearson upper bounds over >= 50
  counted rounds per OS, and are VOID when within-night overdispersion (variance of per-night FAIL counts /
  5r(1-r)) exceeds 2: then the night count, not K, bounds the false-fail rate, and NIGHTLY-2 must say so.
- CAL-3 Control. Control trip rate = nights where the slowed-`countMasked` arm tripped / nights with no HARNESS.
  A rate below 0.8 means that OS cannot close.
- CAL-4 Collection (NIGHTLY-2). `gh run list --workflow perf-nightly.yml --json databaseId,event,headSha,createdAt`,
  then `gh run download <id>` for each run, into the table below with provenance (date, host, load, Node, run count).
- CAL-5 Earliest close. A push on day D closes at the earliest after the D+7 cron (7 nights + 3 dispatches, all
  decisive), or D+10 with no dispatches. For a push on 2026-11-07: 2026-11-14 (with 3 dispatches) or 2026-11-17.
  A never-acquired macOS runner is no data, not a fail, and delays the close; if macOS cannot close, that is a
  NIGHTLY-2 gap.

Results (empty until NIGHTLY-2 fills it from run logs of that cycle):

| OS | nights decisive | S | Nc | control trip rate | closes | provenance |
|---|---|---|---|---|---|---|

---

## 20. FastBit64 on pointer-compressed engines: the FB64-PC research burst (2026-11-08)

Question (maintainer ruling A7 in the program spec): on a pointer-compressed engine (31-bit Smi: d8, Chrome,
Electron) FastBit64's stores box a HeapNumber per word outside [-2^30, 2^30 - 1]. Keep the storage with a
caveat, or change it? Method: a probe ladder (one small script per rung, each with a must-fail control, the next
rung picked by the last result) on scratch copies of FastBit32.js; the shipped file (a60bcedf) was only read.
Draft decision, alternatives and Q-ids: `.handoff/PROPOSAL-fb64-pc.md`; scripts and logs:
`.handoff/research/fb64-pc/` (both gitignored). Apple M4 Pro, d8 15.7.37 arm64 (pointer-compressed), Node
v26.8.2 / V8 14.6.202.34-node.28; scavenges counted with --trace-gc and 1 MB semi-spaces between MARK prints
(the T6 d8 lane method); every count REPORTED, runs repeated 2-3x (R3, R4c, R7g and R4's node rows: one run each). Calibration: one 12 B box per op = 11
scavenges per 1e6 ops on d8. Timing: section 20.3.

### 20.1 Findings

- **Cause: the bare field declaration.** `#lo; #hi;` defines each field as undefined first, so the
  constructor's Smi store generalizes it to a Tagged field (d8 --trace-generalization). A Tagged field must
  allocate a fresh HeapNumber for every stored int32 outside the Smi range. A field that starts as Smi 0
  generalizes to a Double field instead: one mutable box per field, written in place.
- **Today's storage boxes on every mutator, not only setWords / loadFrom.** Per 1e6 ops on d8: setWords 23-24 (Maglev
  47), loadFrom 22, union 22, toggle 11, add 11, in TurboFan (inlined) and Maglev (Sparkplug / Ignition:
  setWords 93, toggle 34); reads 0,
  copy 0 (it copies the existing box), Smi-range words 0. A word is out of range exactly when its bits 31 and 30
  differ. Node is unaffected (32-bit Smi: 0 on every op).
- **`#lo = 0; #hi = 0;` removes them.** Inlined: 0 on every op (setWords 1 per 1e6, 2 per 4e6: not per op);
  Maglev: 0 on reads and mutators except loadFrom (11 per 1e6, today 22); Ignition / Sparkplug box more
  than today (toggle 57 vs 34 per 1e6). Remaining cost class (any untagged storage has it): an out-of-Smi word boxes
  when it crosses a NON-inlined call -- setWords / equalsWords arguments (22 per 1e6, also today), and, new with
  this storage, lo / hi returns and kernel arguments under --no-turbo-inlining (11-19 per 1e6; today 0, except
  nextSetBit 11).
  Per instance ~24-27 B more on d8 when the words are Smi-range (two boxes from birth); node unchanged.
  Differential vs the shipped class: 400,000 random ops, 0 fails on node and d8 (a one-token mutant fails
  17,921); no deopt loop.
- **Int32Array(2) backing loses:** ~186 B per instance on d8 and ~361 B on node (vs ~48 / ~42 B), with the same
  call-boundary boxing at best.
- **The lane's warm-up.** d8-fb64.mjs pointed at the candidate reads read 2 / store 2-3 per 1e6: all in the first
  1e5 ops of each window (0 in the other nine tenths), between the post-gc() re-tier and the window function's
  TurboFan OSR (which lower tier boxes is not isolated). Without that gc() the candidate reads 0 / 0.
- **FastBit1024 already uses the Smi-first pattern** (`_active` / `_full` assigned 0 in the constructor;
  `_active` -> Double on an out-of-Smi store). Its d8 loadFrom window (1e5 loads, gate <= 2) is blind to one box per load: a mutant declaring those
  fields bare, and a one-box-per-load mutant, both read 1 per 1e5 and 11 per 1e6.

### 20.2 Open questions (ruled in the PROPOSAL)

Q-PC1 storage (field initializers / keep + caveat / Int32Array(2)); Q-PC2 the FB64 d8 lane shape (drop the
pre-window gc() and gate stores + a mutator window / chunked gate / REPORTED for good / a regression bound);
Q-PC3 the FastBit1024 d8 window (1e6 + revert checks / + a permanent control / keep 1e5); Q-PC4 a representation
rule for the main file (code rule + source pin / rule only / none).

### 20.3 Timing: R6 and R6b (REPORTED)

a = the pre-A9 (b9447cb) `#lo; #hi;`, z = `#lo = 0; #hi = 0;`, a2 = an A/A twin of a. Both rungs ran once under
`quiet-lock run --strict` on a QUIET host (exit 0), Apple M4 Pro, d8 15.7.37, Node v26.8.2, K = 7, medians in ns/op.
Scripts and logs are in `.handoff/research/fb64-pc/`. An op whose A/A sits outside [0.95, 1.05] is HOST-INCONCLUSIVE.

R6 (load1 2.32 -> 2.94; logs/r6-timing-strict-3.log). d8 a -> z: toggle on out-of-Smi words 7.201 -> 4.012 (z/a 0.557),
setWords 8.500 -> 2.471 (0.291), hasAll 1.005, count 1.016, toggle on Smi words 1.653 -> 4.052 (2.451, A/A 0.994). Node
z/a 0.898-1.006, every A/A inside the band.

R6b asks whether that Smi-word cost needs the process to also hold an out-of-Smi instance (2026-11-08T20:52:53Z, load1
2.33 -> 2.45; logs/r6b-timing-strict-2.log). Every timed word is Smi-range; mode `smi` never stores an out-of-Smi word,
mode `mixed` constructs one out-of-Smi instance first. One process per (engine, candidate, mode), best of 5 windows of
2e6 ops after a 4e5-op warm-up, median over K. A must-fail control (a + a fixed spin) read slow/a >= 4.97 in every cell.

| d8 | a | z | z/a | A/A | |
|---|---|---|---|---|---|
| smi toggle | 0.946 | 0.801 | 0.847 | 1.060 | HOST-INCONCLUSIVE |
| smi add | 1.504 | 1.496 | 0.995 | 1.026 | |
| smi union | 1.336 | 0.797 | 0.597 | 1.123 | HOST-INCONCLUSIVE |
| smi setWords | 2.291 | 2.182 | 0.952 | 0.971 | |
| mixed toggle | 1.002 | 3.685 | 3.678 | 1.020 | |
| mixed add | 1.644 | 3.752 | 2.282 | 0.934 | HOST-INCONCLUSIVE |
| mixed union | 1.221 | 5.881 | 4.817 | 0.810 | HOST-INCONCLUSIVE |
| mixed setWords | 2.303 | 2.298 | 0.998 | 0.998 | |

Node, both modes: z/a 0.848-1.004, A/A 0.987-1.037, no flag on any op.

- **Pre-stated reading: H-NOT-CONFIRMED.** The rule also withholds confirmation when a d8 `smi` op has no verdict, and
  smi toggle and smi union are HOST-INCONCLUSIVE. No verdict cell went against the hypothesis: smi add 0.995, smi setWords
  0.952, mixed toggle 3.678.
- **What the verdict cells do show.** With one out-of-Smi instance in the process, z's toggle on Smi words costs +2.683
  ns/op on d8 (1.002 -> 3.685); setWords is unchanged. Mixed add and union point the same way but carry no verdict.
- **What this rung does not show.** It times; it does not trace field representations, so the class-wide Double field
  stays a mechanism inferred from R1b's generalization trace, not observed here.

---

## 21. Hacker's Delight / cp-algorithms intake (2026-11-12) -- nothing to change

Source: Hacker's Delight (Warren, 2nd ed. 2012) via cp-algorithms "Bit manipulation" and the Go port
https://github.com/nikolaydubina/go-hackers-delight (MIT, one file per book section, active 2026-11; checked 2026-11-12). Teaching write-up:
`../../Learning/Bitwise.md` PART 15. Every formula named below was checked against a naive per-bit
oracle (2,000,000 random int32 + edge words, Node 26.8.2, 0 mismatches). Nothing here is timed, nothing
shipped changes, and none of it is a PROPOSAL.

- **The three cp-algorithms tricks are already here, in equivalent forms.**
  - `nextClearBit` is `31 - Math.clz32(~v & (v + 1))` (FastBit32.js:179).
  - FastBit1024 `acquire` computes `m = c & -c` with `c = ~old`, which is `~old & (old + 1)`. It then writes
    `old | m`, which is `old | (old + 1)` (FastBit32.js:643-654). The one-op `old | (old + 1)` would save
    nothing, because `acquire` still needs `m` for the slot number.
  - `x & -x` is used throughout.
- **`x & (x + 1)` (clear the trailing 1s) has no use site here.** Its natural home is the 0-indexed Fenwick
  tree (lite-logn RESEARCH 16).
- **`acquireRun(k)` stays as 14.2 has it.** An independent linear shift-AND check in Learning (k = 1..12, 2e5
  cases vs a naive scan, 0 mismatches) agrees with `clear-run.mjs`. The 14.2 doubling cascade needs fewer
  steps, so it remains the kernel to keep.
- **A second oracle is available.** The Go port's test files for book sections 2-1 (rightmost bits, next
  number with the same popcount) and 5-1 (popcount) can seed a cross-check for `nextCombination` / `rank` /
  `select` that does not come from this repo. Not done.
- **The Go port's own benchmarks agree with Bitwise.md 12.10.** On its arm64 run, the plain or built-in
  version beat the book's trick for leading zeros and for division by small constants. A book trick is a
  candidate for a measurement, not a speedup.

---

## 22. Bitcoin Core bitset.h intake (2026-11-12) -- nothing to port; one test method to adopt

Source: Bitcoin Core `src/util/bitset.h` (528 lines) and `src/test/fuzz/bitset.cpp` (318 lines), MIT, read from
bitcoin/bitcoin master on 2026-11-12. (The link offered was kerrigan-network/kerrigan, a Dash-derived coin: it has
NO bitset.h -- 404, and no match in its 4,875-file tree. The description fits Bitcoin Core's cluster-mempool
bitset.) Nothing here is timed; nothing shipped changes; none of it is a PROPOSAL.

- **The API already has a counterpart for each of Bitcoin's operations:** First / Last = `lowest` / `highest`;
  Count = `count`; Fill = `rangeMask` / `addRange`; IsSubsetOf / IsSupersetOf / Overlaps = `isSubsetOf` /
  `hasAll` / `hasAny`; the ctz iterator = `forEach`.
- **Popcount:** same SWAR; Bitcoin's shift-add tail and this package's `Math.imul` tail agree on 5e6 words.
  Speed not measured.
- **The `Fill(0)` trap does not apply here:** `rangeMask` is inclusive `[start, end]` and never empty. A future
  `fillLow(n)` would need `n === 0` guarded (in JS, `~0 >>> 32` is all ones).
- **To adopt: lead CIDF** (lite-loglogn RESEARCH 20). Run one seeded op stream through FastBit32, FastBit64 and
  FastBit1024 (at caps 1, 31, 32, 33, 63, 64, 65, 1023, 1024) against one plain reference, comparing every
  inspector after every op. The existing parity tests (FastBit1024Parity160, FastBit64Recipe) compare fixed
  cases; this would compare op SEQUENCES.
