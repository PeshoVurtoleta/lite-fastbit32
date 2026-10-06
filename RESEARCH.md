# lite-fastbit32 Research Notes

Compiled 2026-10-06 against `main` (1052881, published 1.2.0, node v26.8.2).
Modeled on `../LitePick/RESEARCH.md` and `../LiteLogN/RESEARCH.md`. Feeds
`ROADMAP.md`; every claim below marked **(measured)** was reproduced with a probe
in this session, every claim marked **(to measure)** is a session task, not a
fact. Nothing here is a settle call -- those live in ROADMAP section 3.

---

## 1. Core Identity

lite-fastbit32 is the **single-word** primitive of the suite: one 32-bit integer,
one object, every op a fixed handful of ALU instructions. It is not a bitset (no
array, no capacity), not a scheduler, not an ECS. It is the thing those are
built from when 32 is enough.

Three layers, in order of heat:

| Layer | Surface | Heat |
| --- | --- | --- |
| Word ops | `add/remove/toggle/has`, `hasAll/hasAny/hasNone`, `union/difference/intersect`, `count/countMasked/countRange`, `lowest/highest/nextClearBit/highestClearBit`, `isEmpty/isFull` | HOT -- per entity, per frame |
| Iteration | `forEach`, the seven `forEach*` free functions | WARM -- O(k) over set bits, callback-driven |
| Naming + I/O | `BitMapper`, `serialize/deserialize`, `toArray/fromArray/toBinaryString`, `clone` | COLD -- init, save, debug |

**The honest unifying thread:** every hot op is *data-independent constant
time*. Not "O(1) amortized", not "O(1) expected" -- the same instruction count
whatever bits are set. That is the property worth proving (section 2), and the
one a 32-iteration loop or a `Set<number>` does not have.

**What the package is for, as its consumers actually use it** (grep of the suite,
2026-10-06):

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

lite-logn's anchor is "growth is logarithmic"; lite-pick's is "imbalance under
the provable ceiling". lite-fastbit32's is simpler and stricter:

> **Every hot op runs in the same time for every input word.** Its ns/op is
> flat across bit density 0..32 and across bit position 0..31, and `forEach` is
> exactly linear in popcount with a near-zero intercept.

### Why it belongs in the project

The README sells "O(1) popcount" and "O(1) bit-scan". Big-O is meaningless at
n = 32 -- a 32-step loop is also O(1). The real claim is *no data-dependent
work*: no loop, no early exit, no branch whose direction depends on which bits
are set. That claim is falsifiable, and the foils below fail it visibly.

### The witness, precisely

- **Density sweep:** for d in 0..32, a corpus of 4096 words with popcount d
  (seeded). Time each hot op over the corpus. Gate: max/min ns-per-op ratio
  across d below a flatness floor (lite-logn's witness uses the same shape).
- **Position sweep:** for p in 0..31, single-bit words `1 << p`, plus the two
  extremes `0` and `-1`. Same flatness gate. This is the sweep that catches a
  sign-bit slow path (FB-12 territory: values >= 2^30 or >= 2^31 leaving Smi).
- **Iteration slope:** `forEach` / cursor iteration over popcount k = 0..32.
  Fit time = a + b*k; gate that the residual is small and `a` is under one
  call's overhead. O(k), not O(32).
- **Foils (must visibly fail flatness):** Kernighan's popcount
  (`while (v !== 0) { v &= v - 1; c++; }` -- O(k), the common real-world
  implementation), the 16-bit lookup table (flat when L1-hot, data-dependent
  under cache pressure -- the reason the witness runs two cache lanes),
  a 32-iteration popcount loop with early exit,
  `for (b = 0; b < 32; b++) if (v & (1 << b))` for lowest, and a `Set<number>`
  of indices. If a foil passes the flatness gate, the gate has no teeth.
- **popcount candidates, probe (2026-10-06, node v26.8.2, ad-hoc, not the S2
  harness).** Each candidate in its own process behind a monomorphic call site,
  best of 5 x 5e7 ops, ns/op above an empty-loop floor (~0.3 ns); densities
  0/8/16/32 bits + random words. All agreed on 2e5 random words first.

  | candidate | L1-hot | + 32 MB streaming per op |
  | --- | --- | --- |
  | SWAR (shipped) | 0.36-0.56, flat | ~0 at every density (hidden by memory) |
  | 8-bit LUT (256 B), 4 loads | 0.53-0.70, flat | ~0 (ties SWAR) |
  | nibble LUT (16 B), 8 loads | 1.41-1.48 | not run |
  | 16-bit LUT (64 KB), 2 loads | 0.28-0.33, flat | **+0.3-0.7 on mixed words, ~0 at 0/32 bits -- data-dependent** |
  | Kernighan `v &= v - 1` | 0.97 / 2.42 / 4.01 / 8.43 (0/8/16/32), 4.13 random | not run |

  Verdict: SWAR stays. The 8-bit and nibble tables never beat it (loads cost
  more than ALU ops). The 16-bit table wins by ~0.15 ns only while hot; under
  cache pressure its cost depends on which words arrive (0x0000/0xFFFF entries
  stay cached, mixed words miss), which is exactly what the constant-time
  witness forbids, and it costs 64 KB per realm plus a 65,536-step import-time
  init. Kernighan is O(k), ~0.25 ns per set bit.

  An earlier version of this probe called every candidate through one shared
  `bench(fn)` site, so nothing inlined and SWAR read ~4 ns (mostly call
  overhead, plus a ~0.77 ns artifact on sparse corpora). That is the reason S2
  builds a real harness. Kernighan's trick stays where it is the right tool:
  `forEach`, `toArray` and the `forEach*` helpers must visit every set bit, so
  O(k) is the floor there. No `countSparse()` member and no LUT member.

### Prior art for the anchor

Constant-time bit tricks are textbook (Hacker's Delight ch. 5 for SWAR
popcount, ch. 2 for `x & -x` / `x & (x - 1)`; the Stanford "Bit Twiddling Hacks"
page). The point of the witness is not novelty, it is proving the JS engine
honours them: `Math.clz32` lowers to a single `lzcnt`/`clz` on x64/arm64 in
TurboFan, and `Math.imul` to `imul`. **(to measure: confirm via the position
sweep that no lane has a slow path, in both Node and a pointer-compressed
Chrome.)**

---

## 3. The Benchmark Suite

### The claim we are actually proving

Not "fastest flag engine in JavaScript" (README today -- unbacked, FB-08). The
defensible claim has three parts, each with its own number:

1. **Abstraction tax vs raw integers.** `flags.has(b)` vs `(v & (1 << b)) !== 0`
   on a local. This is the honest headline: it should be ~0 after inlining, and
   if it is not, users deserve to know. A library that hides this number is
   selling, not measuring.
2. **Constant time** -- the section 2 witness.
3. **Zero allocation** -- 0 B/op on every hot op, proven by the torture lanes and
   lite-perf-gate, including the Smi-boundary key matrix (2^30, 2^31, -2^31,
   2^32 - 1).

### Dimensions

| Dimension | Values |
| --- | --- |
| Op | each hot op + `forEach` + cursor iteration (once it exists) |
| Word shape | density 0/8/16/24/32, single bit at 0/15/30/31, `0`, `-1`, `0xFFFFFFFF` (unsigned form) |
| Representation | instance built by `add()` (signed) vs by `new FastBit32(u32)` (unsigned double today) |
| Call-site shape | monomorphic site vs one site shared by >= 5 classes (inlining off; the torture-harness control) |
| Runtime | node 22 LTS, node 26 current; Chrome via the demo page (best effort, reported separately, never gated) |

### Honest-cost disclosure (on-brand, like lite-o1's build/space co-headline)

Report alongside every win: the abstraction tax (part 1), the cost of the
fail-closed variant once it exists (ROADMAP S6), and the `forEach` closure cost
when the callback captures (measured 2026-10-06: **425 scavenges over 2e6 calls
with a capturing closure, 0 with a hoisted function**). The cursor API (section
4) exists precisely because of that last number.

### Competitive matrix (apples-to-apples, reproducible)

| Subject | Why it is in the matrix |
| --- | --- |
| raw `number` + inline bitwise | the floor; every row is reported as a ratio to it |
| `fastbitset` (npm 0.5.2) | named in the README table today |
| `typedfastbitset` (npm 0.8.0) | named in the README table today |
| `bitset` (npm 5.3.0) | most-installed general bitset |
| `Set<number>` | what people write without a bitset |
| naive loop foils | the witness foils (section 2) |

The multi-word libraries are only compared on the 32-bit subset of their
surface, and the report says so in its first line. The README comparison table
(FastBitSet "O(k) iteration: No", "Zero-GC: No", and so on) is **unverified**
and gets either reproduced by this matrix or deleted (FB-08).

### Reproducibility machinery

Seeded xorshift32 corpora; `process.version` and V8 version stamped into
`benchmark/results.json`; warm-up fixed by run count, not by time; window 0
printed and never floored on (torture-harness skill: window 0 often runs Maglev
code). A results file without a version stamp fails the report build.

### Correctness methodology: the oracle fuzz

The oracle is a `Uint8Array(32)` of booleans plus naive loops -- it shares no
code and no trick with the library (torture-harness skill: "an oracle that shares
the design agrees with the bug"). Every hot op is cross-checked over a seeded
corpus that **always includes** the four Smi/sign boundary words and both
representations of every word (signed int32 and `>>> 0` unsigned). FB-01 is
exactly the bug this finds in under one millisecond and that 48 example tests
missed.

---

## 4. The Candidate Roster

Every formula below was checked against the oracle on 20,008 words (8 fixed
boundary words + 20,000 seeded), both signed and unsigned forms where relevant:
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

| Member | Sketch | When it pays |
| --- | --- | --- |
| `select(k)` | position of the k-th set bit; branchless via a 5-step popcount descent (16/8/4/2/1) | inverse of `rank`; random pick of the k-th free slot (lite-pick P2C over an N <= 32 eligibility word) |
| `nextSubset(sub, mask)` | `(sub - 1) & mask` (submask enumeration) | DP over subsets, combo-system checks, "all ability combinations" in game logic |
| `nextCombination(v)` | Gosper's hack: next larger word with the same popcount | enumerate all k-of-32 selections without allocation |
| `reverse()` / `rotl(n)` / `rotr(n)` | SWAR reverse; `(v << n) \| (v >>> (32 - n))` with the n = 0 trap handled | ring-buffer occupancy, mirrored tile masks |

Each needs a kill criterion written before coding: no real consumer pattern in
the suite or a documented recipe that uses it, and it is rejected into the
ledger, not shipped.

### Tier 3 -- adjacent (evaluate; may fold in or cross-reference)

- **Word kernel as free functions** (`ctz32`, `bsr32`, `popcnt32`, `blsi`,
  `blsr`). Users who keep flags in a `Uint32Array` lane (lite-depth's shape)
  want these without the class. The suite's zero-runtime-deps law means
  siblings will NOT import them; the value is for end users only. Gate: the
  class methods must not slow down if they delegate (to measure -- or keep the
  bodies duplicated and test them against each other).
- **A checked twin** (`CheckedFastBit32`): same surface, validates every bit
  index and mask, throws on `undefined`/`null`/out-of-range. The answer to FB-02
  that costs the default hot path nothing. Opt-in at dev time. Risk: a call site
  that sees both classes turns polymorphic -- the docs must say "pick one per
  build", and the perf gate must include the mixed-site lane to show the cost.
- **`FastBit64`** (two int32 fields, hi/lo). The most common user ask for a
  flag word is "more than 32 components". Boundary question with lite-o1
  `BitSet` (open question 3). Kept out of every session until that is settled.

### The boundary -- explicitly OUT of scope

- **Multi-word bitsets of arbitrary capacity.** lite-o1 `BitSet` (1.4.0) owns
  this, with a summary layer for O(1) firstSet. lite-o1 RESEARCH already records
  the non-overlap from its side.
- **O(1) rank/select over long bitvectors.** lite-o1 `RankSelect` (proposed
  1.8.0). The Tier 1 `rank` here is single-word only.
- **Priority queues over bit buckets.** lite-scheduler `FastBitScheduler`.
- **BigInt.** Allocation per op; contradicts the package.
- **Morton / bit interleave.** Spatial packages.

---

## 5. The Honesty Hook

Three sentences the README must be able to say after S8, each backed by a gate:

1. "Every hot op allocates 0 bytes, including on words at the Smi and sign
   boundaries." (torture T6 + perf-gate)
2. "Every hot op takes the same time for every word; here is the flatness
   ratio." (witness)
3. "Calling a method costs X% over writing the bitwise expression inline on
   node vYY." (benchmark part 1)

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

Fix: `(~this.value & mask) === 0`. Same instruction count (not, and, compare vs
and, compare, plus the extra operand load). Comparing to `0` is
signedness-agnostic. **0 mismatches over 800,000 signed/unsigned value/mask mixes
(measured).** `has`, `hasAny`, `hasNone`, `isEmpty`, `isFull` already compare to
`0` or use `~`, so they are immune; `hasAll` is the only `=== mask` in the file.

### The clz32 idiom

`31 - Math.clz32(x)` and `Math.clz32(x) ^ 31` agree for every x != 0 (clz32 is in
0..31). They disagree at x == 0: **`31 - clz32(0) === -1`, `clz32(0) ^ 31 ===
63` (measured).** The `31 -` form therefore produces the package's `-1` "none"
sentinel for free, which makes all four scans branchless:

```
lowest()          31 - Math.clz32(v & -v)
highest()         31 - Math.clz32(v)
nextClearBit()    31 - Math.clz32(~v & (v + 1))
highestClearBit() 31 - Math.clz32(~v)
```

All four verified against the oracle (0 mismatches, both representations). With
`^ 31` each needs its `=== 0` guard kept. Whether removing the branch is
*measurably* faster is a benchmark question (the branch is perfectly predicted
in most loops); the README's "branchless" claim, though, is only true with
`31 -`. ROADMAP SC-1 carries the decision.

### FB-03 -- one representation

Stores today: constructor `initial >>> 0` (unsigned, a double for >= 2^31),
`fromArray` `v >>> 0` (same), every mutator `|= &= ^=` (signed int32). Proposed
canonical form: **signed int32 everywhere** (`| 0` at the three cold entries),
with an unsigned view only at the I/O edge (`serialize()` returns `>>> 0`, one
box per call, cold, documented). Signed int32 is a Smi on 64-bit Node for every
value; under Chrome's 31-bit Smis, values with bit 30 or 31 are HeapNumbers in
either form, so the canonical choice is not worse there **(to measure in the
demo)**. lite-arena's AR-01 lesson applies: do not "fix" signedness by widening
to `>>> 0` on a hot path.

---

## 8. Experimental direction: fail-closed without hot-path bytes

The suite law says `null` is not zero and every unverified state fails closed.
The hot-path law says a guard that never fires still costs its bytes. For a
library whose whole body *is* the hot path, these collide head-on in `add(bit)`.
The research position:

- **Cold entries validate unconditionally** (constructor, `deserialize`,
  `fromArray`, `BitMapper` constructor, `rangeMask`). These are free.
- **`BitMapper` is the fail-closed front door** for names -- it already throws on
  unknown names. `BitMapper.bit(name)` extends that to masks.
- **Raw-index hot ops stay permissive and pinned**, with a documented contract,
  OR a measured guard if the perf gate shows 0 cost after inlining (to measure:
  `if ((bit >>> 0) > 31) throw` folded into a cold `_badBit()` call).
- **`CheckedFastBit32`** for development builds.

S6 records which of these the package adopts; this section only lays out the
ground.

---

## 9. The demo

Four panels, one page, `demo/index.html`, every frame loop under the demo-audit
law (no allocation, reads before writes, `#profile` layout profiler):

1. **Bit board.** 32 cells; click to toggle. Live readouts: value as signed,
   unsigned, hex, binary; `count`, `lowest`, `highest`, `nextClearBit`,
   `highestClearBit`. Bit 31 cell styled as the sign bit with a note.
2. **SWAR popcount, staged.** The three reduction steps drawn as 16 2-bit
   lanes -> 8 4-bit lanes -> 4 bytes -> `imul` sum, for the current word.
3. **Object pool.** 32 particle slots allocated with `nextClearBit`, freed on
   expiry; slot occupancy word drawn live; a counter showing 0 allocations per
   frame for the pool logic.
4. **ECS signature matcher.** 32 components via `BitMapper`, three systems as
   masks, 64 entities highlighted by `hasAll`. A system that requires component
   31 is included on purpose: it is the FB-01 regression made visible.

Plus the browser-side Smi probe (FB-12): a hidden `#measure` mode that times the
position sweep in Chrome and prints it, so the pointer-compression question gets
an answer.

---

## 10. Recommended path

Harness first (nothing else is provable without it), then the one live S1
(FB-01), then measurement (benchmark + witness) before any idiom or
representation decision, then additive API, then the one breaking release, then
demo and docs. ROADMAP section 4 is the ordered version of this sentence.

---

## 11. Open questions

1. **Representation in the browser.** Does a field holding bit-30/31 values
   cost anything per write in pointer-compressed V8 (Chrome, Deno, Electron)?
   Node cannot answer this; the demo's `#measure` mode can.
2. **Is `forEach` worth keeping on the hot path** once `nextSetBit` exists, or
   should the docs demote it to "warm, hoist your callback"?
3. **`FastBit64`.** Same package (two fields, same idioms, still one object) or
   out of scope in favour of lite-o1 `BitSet`? The answer decides whether ECS
   users with 33+ components have a zero-alloc path that is not array-backed.
4. **lite-ecs migration.** FB-01 is fixed in fastbit32 by S1, but lite-ecs pins
   `^1.0.0`; any lite-ecs user on a lockfile keeps the bug until they update.
   Does lite-ecs get a floor bump to `^1.2.1` in its own session?
5. **`countRange` contract.** Validate (it is called on hot paths by some users)
   or keep "caller must guarantee" and pin the garbage? Decided in S6.
