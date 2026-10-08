# lite-fastbit32 Research Notes

Compiled 2026-10-06 against `main` (1052881, published 1.2.0, node v26.8.2). Modeled on `../LitePick/RESEARCH.md`
and `../LiteLogN/RESEARCH.md`. Feeds
`ROADMAP.md`; every claim below marked **(measured)** was reproduced with a probe in this session, every claim
marked **(to measure)** is a session task, not a fact. Nothing here is a settle call -- those live in ROADMAP section 3.

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
| lite-ecs `Entity.js`, `World.js` | `FastBit32` per entity, `BitMapper` for components, `hasAll(signature)` per system per entity | `World.js:30` builds signatures as `(1 << idx) >>> 0` -- **
hit by FB-01 at component 31** |
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

- **Density sweep:** for d in 0..32, a corpus of 4096 words with popcount d
  (seeded). Time each hot op over the corpus. Gate: max/min ns-per-op ratio across d below a flatness floor (lite-logn's
  witness uses the same shape).
- **Position sweep:** for p in 0..31, single-bit words `1 << p`, plus the two extremes `0` and `-1`. Same flatness gate.
  This is the sweep that catches a sign-bit slow path (FB-12 territory: values >= 2^30 or >= 2^31 leaving Smi).
- **Iteration slope:** `forEach` / cursor iteration over popcount k = 0..32. Fit time = a + b*k; gate that the residual
  is small and `a` is under one call's overhead. O(k), not O(32).
- **Foils (must visibly fail flatness):** Kernighan's popcount
  (`while (v !== 0) { v &= v - 1; c++; }` -- O(k), the common real-world implementation), the 16-bit lookup table (flat
  when L1-hot, data-dependent under cache pressure -- the reason the witness runs two cache lanes), a 32-iteration
  popcount loop with early exit,
  `for (b = 0; b < 32; b++) if (v & (1 << b))` for lowest, and a `Set<number>`
  of indices. If a foil passes the flatness gate, the gate has no teeth.
- **popcount candidates, S2a witness harness (2026-10-07, node v26.8.2, Apple Silicon).** Numbers
  from `test/witness.mjs` + `test/witness/run-one.mjs` -- each candidate in its OWN process behind a monomorphic inlined
  call site, best-of-N min minus an empty-loop floor, result sunk into an Int32Array slot. ns/op is floor-subtracted (
  net); HOT is a tight loop, PRESSURE streams 32 MB at a 4099-word stride in both the op and floor loops. Density sweep
  0..32. Flatness = max/min of net across the sweep, each cell clamped up to a per-lane noise floor (EPS_HOT 0.8,
  EPS_PRESSURE 0.18 ns). Full floors + margins in
  `benchmark/METHODOLOGY.md`.

  | candidate | HOT net ns/op (flatness) | PRESSURE net ns/op (flatness) |
    | --- | --- | --- |
  | SWAR (shipped) | 0.29-0.43, flat (ratio 1.0) | ~0-0.22, flat (ratio 1.0) |
  | 16-bit LUT (64 KB), 2 loads | 0.26-0.44, flat (ratio 1.0-1.67) | **hump 0.1-0.66, data-dependent (ratio 2.6-3.6)** |
  | Kernighan `v &= v - 1` | 0.29 (d0) -> 7.55 (d32), O(k) (ratio ~9-24) | O(k) |

  The 16-bit LUT fails the flatness gate in the PRESSURE lane and passes it when L1-HOT -- the data-dependence the
  witness forbids. Kernighan fails it in both lanes (O(popcount)). SWAR is the only popcount candidate flat in BOTH
  lanes, so
  **SWAR stays** (no LUT member ships). Earlier **(superseded)** ad-hoc probe
  (2026-10-06, best of 5 x 5e7, same verdict): SWAR 0.36-0.56 HOT / ~0 streaming; 8-bit LUT (256 B) 0.53-0.70 ties SWAR;
  nibble LUT (16 B) 1.41-1.48; 16-bit LUT 0.28-0.33 HOT / +0.3-0.7 streaming; Kernighan 0.97/2.42/4.01/8.43 at
  0/8/16/32. The 8-bit and nibble tables (not re-run under the S2a harness) never beat SWAR there -- loads cost more
  than ALU ops.

  Verdict: SWAR stays. The 8-bit and nibble tables never beat it (loads cost more than ALU ops). The 16-bit table wins
  by ~0.15 ns only while hot; under cache pressure its cost depends on which words arrive (0x0000/0xFFFF entries stay
  cached, mixed words miss), which is exactly what the constant-time witness forbids, and it costs 64 KB per realm plus
  a 65,536-step import-time init. Kernighan is O(k), ~0.25 ns per set bit.

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
a capturing closure, 0 with a hoisted function**). The cursor API (section

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
| `nextSetBit(from)` | `w = v & (-1 << (from & 31)) & ((from - 32) >> 31); return 31 - clz32(w & -w)` | **closure-free
iteration**: `for (b = m.nextSetBit(0); b !== -1; b = m.nextSetBit(b + 1))`. Branchless, `from` in 0..32, returns -1 past the end. The `(from - 32) >> 31` term kills the `<< 32` wraparound without a branch. |
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

- **Multi-word bitsets of arbitrary capacity.** lite-o1 `BitSet` (1.4.0) owns this, with a summary layer for O(1)
  firstSet. lite-o1 RESEARCH already records the non-overlap from its side.
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

**S2a measured (2026-10-07):** for `lowest`/`highest`/`nextClearBit` the guard is a well-predicted branch and the
branchless gap is ~0.01-0.08 ns -- uniformity, not speed. But `highestClearBit` is a special case the SC-1 experiment
found by accident: its CURRENT body `const inv = ~this.value >>> 0; ... 31 - clz32(inv)`
makes `inv` a **HeapNumber** for every word with bit 31 clear (`~value >= 2^31`), and `Math.clz32(thatDouble)` then runs
a **data-dependent slow path of 19-53 ns**
(empty-heavy/full-heavy/random corpora, both lanes; witness flatness ratio 57 HOT, 483 PRESSURE). The
branchless `31 - Math.clz32(~v)` (no `>>> 0`) is **flat at
~0 ns**. So `highestClearBit` is NOT constant time today -- the one hot op that is not -- and S3's branchless body both
fixes it and removes the dead `>>> 0`
coercion (FB-09). `nextClearBit` shares the `~v >>> 0` but survives because
`inv & -inv` forces the double back to int32 before `clz32`. Numbers:
`benchmark/experiments/sc1-scans.mjs`, witness finding in `benchmark/METHODOLOGY.md`.

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

1. **Bit board.** 32 cells; click to toggle. Live readouts: value as signed, unsigned, hex, binary; `count`, `lowest`
   , `highest`, `nextClearBit`,
   `highestClearBit`. Bit 31 cell styled as the sign bit with a note.
2. **SWAR popcount, staged.** The three reduction steps drawn as 16 2-bit lanes -> 8 4-bit lanes -> 4 bytes -> `imul`
   sum, for the current word.
3. **Object pool.** 32 particle slots allocated with `nextClearBit`, freed on expiry; slot occupancy word drawn live; a
   counter showing 0 allocations per frame for the pool logic.
4. **ECS signature matcher.** 32 components via `BitMapper`, three systems as masks, 64 entities highlighted by `hasAll`
   . A system that requires component 31 is included on purpose: it is the FB-01 regression made visible.

Plus the browser-side Smi probe (FB-12): a hidden `#measure` mode that times the position sweep in Chrome and prints it,
so the pointer-compression question gets an answer.

---

## 10. Recommended path

Harness first (nothing else is provable without it), then the one live S1
(FB-01), then measurement (benchmark + witness) before any idiom or representation decision, then additive API, then the
one breaking release, then demo and docs. ROADMAP section 4 is the ordered version of this sentence.

---

## 11. Further researched draft proposals:

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

## 11. Open questions

1. **Representation in the browser.** Does a field holding bit-30/31 values cost anything per write in
   pointer-compressed V8 (Chrome, Deno, Electron)? Node cannot answer this; the demo's `#measure` mode can.
2. **Is `forEach` worth keeping on the hot path** once `nextSetBit` exists, or should the docs demote it to "warm, hoist
   your callback"?
3. **`FastBit64`.** Same package (two fields, same idioms, still one object) or out of scope in favour of
   lite-o1 `BitSet`? The answer decides whether ECS users with 33+ components have a zero-alloc path that is not
   array-backed.
4. **lite-ecs migration.** FB-01 is fixed in fastbit32 by S1, but lite-ecs pins
   `^1.0.0`; any lite-ecs user on a lockfile keeps the bug until they update. Does lite-ecs get a floor bump to `^1.2.1`
   in its own session?
5. **`countRange` contract.** Validate (it is called on hot paths by some users)
   or keep "caller must guarantee" and pin the garbage? Decided in S6.
