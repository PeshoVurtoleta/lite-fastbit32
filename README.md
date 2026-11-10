# @zakkster/lite-fastbit32

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-fastbit32.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-fastbit32)
[![sponsor](https://img.shields.io/badge/sponsor-PeshoVurtoleta-ea4aaa.svg?logo=github)](https://github.com/sponsors/PeshoVurtoleta)
![Zero-GC](https://img.shields.io/badge/Zero--GC-Engine-00C853?style=for-the-badge&logo=leaf&logoColor=white)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-fastbit32?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-fastbit32)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-fastbit32?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-fastbit32)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-fastbit32?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-fastbit32)
![Tree-Shakeable](https://img.shields.io/badge/tree--shakeable-yes-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

Zero-GC, monomorphic 32-bit flag manager for ECS masking, object pools, and 60fps hot-path engine code; FastBit32's bit and mask ops are branchless. Zero dependencies. Three bit classes plus the `BitMapper` name mapper: `FastBit32` (one word), from 1.4.0 `FastBit1024` (32 x 32 words, fail-closed) and from 1.7.0 `FastBit64` (64 flags in two int32 words, fail-closed). The fastest 32-bit flag engine in JavaScript.

## 🚀 Built with Lite-FastBit32: Lite-Tween Pro

If you are building high-performance WebGL applications or JavaScript games, check out **Lite-Tween Pro**. It is a commercial, zero-allocation ECS tweening engine built directly on top of this bitwise architecture. It completely bypasses the JavaScript Garbage Collector to guarantee a flat memory profile and a stable 120fps on mobile devices.

👉 **[Get the Lite-Tween Pro Source Code here](https://zakkster.lemonsqueezy.com/checkout/buy/05ad56be-4b91-4bef-8218-9e85c65690b4)**

*(Are you a solo indie dev or student? Reach out to me directly at shinikchiev@yahoo.com and I will hook you up with an indie discount!)*

## Why lite-fastbit32?

| Feature               | lite-fastbit32 | FastBitSet | TypedFastBitSet |
|-----------------------|----------------|------------|-----------------|
| **Max bits**          | **32 (FastBit32); 64 (FastBit64); 1024 (FastBit1024)** | Unlimited  | Unlimited       |
| **Zero-GC**           | **Yes**        | No         | No              |
| **Monomorphic**       | **Yes**        | No         | No              |
| **Branchless**        | **Yes (FastBit32 bit/mask ops)** | No         | No              |
| **O(1) popcount**     | **Yes**        | No         | No              |
| **O(1) lowest/highest** | **Yes**      | No         | No              |
| **O(k) iteration**    | **Yes**        | No         | No              |
| **BitMapper**         | **Yes**        | No         | No              |
| **BigInt support**    | No             | No         | No              |
| **ECS-ready**         | **Yes**        | Yes        | Yes             |
| **Object pool scan**  | **Yes**        | No         | No              |
| **Serialization**     | Yes            | Yes        | Yes             |
| **Bundle size** (min+gz) | **1059 B** FastBit32 alone; 3511 B whole module (see note) | ~8KB | ~6KB |

> Bundle sizes of the 1.6.0 build (REPORTED: one run, 2026-11-05): an entry file `export { <names> } from '@zakkster/lite-fastbit32'` piped through `esbuild 0.28.2 --bundle --format=esm --minify | gzip -9 | wc -c`. `export *` (whole module): 3511 B (2254 B in 1.5.0). `{ FastBit32 }` alone: 1059 B (unchanged; it carries no FastBit1024 code). `{ FastBit1024 }` alone: 2350 B (1006 B in 1.5.0; the 1.6.0 members are on the class, so they ship with it). Every export except FastBit1024 (VERSION included): 1486 B (1485 B in 1.5.0).

> FastBit32 is an engine primitive, not a general-purpose bitfield. For up to 1024 bits (pools, dense id sets) the package also ships [`FastBit1024`](#fastbit1024-32-x-32-pools-up-to-1024) (1.4.0); for 33 to 64 flags, [`FastBit64`](#fastbit64-64-flags-in-two-words) (1.7.0).

## Installation

```bash
npm install @zakkster/lite-fastbit32
```

## Quick Start

```javascript
import { FastBit32, BitMapper } from '@zakkster/lite-fastbit32';

const flags = new FastBit32();

flags.add(1).add(4);         // Set bits 1 and 4
flags.has(4);                 // true
flags.count();                // 2 — O(1) popcount
flags.lowest();               // 1 — O(1) bit-scan forward
flags.remove(1);              // Clear bit 1
flags.serialize();            // Raw uint32 for storage

// Human-readable flag management
const mapper = new BitMapper(['Physics', 'Render', 'AI', 'Input']);
const entity = new FastBit32();
entity.add(mapper.get('Physics')).add(mapper.get('Input'));
mapper.getActiveNames(entity); // ['Physics', 'Input']
```

---

## The Bit Pipeline

### Monomorphic V8 Optimization

FastBit32 stores all state in a single `value` property — a plain unsigned 32-bit integer. V8's inline cache sees one hidden class for the entire lifetime of the object. Every method is a single bitwise operation on that integer. No arrays. No objects. No allocations. No branches.

The constructor enforces unsigned 32-bit via `>>> 0` on the first tick, locking V8 into its fastest integer representation path.

### O(1) Popcount (Hamming Weight)

Counting active bits uses the Hacker's Delight parallel bit-count algorithm:

```
v = v - ((v >>> 1) & 0x55555555)
v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
result = Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24
```

Five operations, zero loops, zero branches. Works for any value of the 32-bit integer.

### O(1) Bit-Scan (lowest / highest)

Finding the lowest set bit uses isolation + Count Leading Zeros:

```
lowest = 31 - Math.clz32(value & -value)
```

`value & -value` isolates the lowest set bit into a power-of-two. `Math.clz32` counts leading zeros from the left, and `31 -` converts it to a right-indexed position. On an empty word `clz32(0)` is 32, so the result is the `-1` sentinel with no guard. One expression, no loops, no branches.

`highest` uses `31 - Math.clz32(value | 0)` (1.6.1 body): the `| 0` keeps the argument an int32, so on Node it never boxes, even when V8 has disabled speculation on that call (T6 poison witness, node 26.x; on a pointer-compressed engine an int32 outside [-2^30, 2^30) can still box there: not gated).

### O(k) Iteration

All iteration helpers visit only active bits using the `v &= v - 1` trick to clear the lowest bit each step. Complexity is O(k) where k is the number of set bits — not 32.

### Caveats

- **Silent wraparound:** JS bitwise shifts apply modulo 32. `add(32)` evaluates as `add(0)`. `add(40)` evaluates as `add(8)`.
- **Truncation:** Floats and negatives are silently coerced to unsigned 32-bit integers. `-1 >>> 0` becomes `4294967295`.
- Sanitize inputs upstream if your domain logic requires strict bounds.

---

## Benchmark Results

Tested on Apple M2 Pro, Node 22, V8 12.x. All values in **ops/ms**.

### Single-Bit Operations

| Operation   | lite-fastbit32 | FastBitSet | TypedFastBitSet | Raw bitwise |
|-------------|----------------|------------|------------------|-------------|
| set bit     | **~240k**      | ~150k      | ~220k            | **~260k**   |
| has bit     | **~260k**      | ~180k      | ~240k            | **~280k**   |
| remove bit  | **~240k**      | ~140k      | ~200k            | **~260k**   |

### Mask Operations

| Operation | lite-fastbit32 | FastBitSet |
|-----------|----------------|------------|
| hasAll    | **~300k**      | ~40k       |
| hasAny    | **~300k**      | ~45k       |
| hasNone   | **~300k**      | ~45k       |

### Popcount

| Operation | lite-fastbit32 | FastBitSet |
|-----------|----------------|------------|
| count     | **~350k**      | ~25k       |

### Bit-Scan (lowest / highest)

| Operation | lite-fastbit32 | FastBitSet |
|-----------|----------------|------------|
| lowest    | **~350k**      | N/A        |
| highest   | **~350k**      | N/A        |

> lite-fastbit32 is the only library with O(1) bit-scan forward/backward.

---

## Recipes

<details>
<summary><strong>Iterate set bits in a hot loop (zero-GC)</strong></summary>

`forEach` with a callback that captures per-call state allocates a closure on every
call. The `nextSetBit` cursor (1.3.0) needs no callback at all: O(1) per step,
0 B/op (gated in the torture T6 lane on verified-optimized code, and the perf gate).

```javascript
import { FastBit32 } from '@zakkster/lite-fastbit32';

const alive = new FastBit32();
alive.add(3).add(17).add(31);

function update(dt) {
    for (let b = alive.nextSetBit(0); b !== -1; b = alive.nextSetBit(b + 1)) {
        integrate(b, dt);            // dt is a plain argument -- no closure, nothing captured
    }
}
// Descending: for (let b = alive.prevSetBit(31); b !== -1; b = alive.prevSetBit(b - 1))
```

`nextSetBit(32)` returns `-1`, so `b + 1` on bit 31 ends the walk.

</details>

<details>
<summary><strong>Pick a random live flag, walk submasks, walk k-of-32 sets (1.5.0)</strong></summary>

`select(k)` is the k-th set bit (0-based, ascending), so a uniform pick is one
call. On an empty set `count()` is 0, so the index is 0 and `select(0)` is `-1`
by itself: no separate empty check.

```javascript
import { FastBit32 } from '@zakkster/lite-fastbit32';

const f = new FastBit32().add(3).add(17).add(31);
const pick = f.select((Math.random() * f.count()) | 0); // 3, 17 or 31; -1 if empty
```

Every submask of `m`, from `m` down to `0` (exactly 2^count(m) of them).
`nextSubset(0, m)` wraps to `m`, so visit first, then stop on `0`:

```javascript
const m = (1 << 1) | (1 << 4) | (1 << 9);
for (let s = m; ; s = FastBit32.nextSubset(s, m)) {
    visit(s);               // 8 submasks, 0 last
    if (s === 0) break;
}
```

Every k-of-32 set (C(32, k) words, increasing as unsigned) for `k >= 1`.
`nextCombination` ends at `0`, never `-1` (`-1` is the k = 32 combination).
`(1 << k) - 1` is wrong at k = 32 (`1 << 32` is `1`), so seed with `rangeMask`:

```javascript
for (let v = FastBit32.rangeMask(0, k - 1); v !== 0; v = FastBit32.nextCombination(v)) {
    visit(v);
}
```

`select` takes a bit index and returns -1..31 (0 B/op). The two statics take and return signed int32 words: 0 B/op on Node (T6); on a pointer-compressed engine (31-bit Smi) a result outside [-2^30, 2^30) boxes (12 B) when returned through a non-inlined call (FB-12, S7).

</details>

<details>
<summary><strong>ECS Component Masks</strong></summary>

```javascript
import { FastBit32 } from '@zakkster/lite-fastbit32';

const POSITION  = 0;
const VELOCITY  = 1;
const SPRITE    = 2;
const COLLISION = 3;
const AI        = 4;

const PHYSICS_QUERY = (1 << POSITION) | (1 << VELOCITY) | (1 << COLLISION);
const RENDER_QUERY  = (1 << POSITION) | (1 << SPRITE);

const entity = new FastBit32();
entity.add(POSITION).add(VELOCITY).add(SPRITE).add(COLLISION);

if (entity.hasAll(PHYSICS_QUERY)) runPhysics(entity);
if (entity.hasAll(RENDER_QUERY))  drawSprite(entity);
```

> **Bit 31 (Sign Bit):** In JavaScript, `1 << 31` evaluates to `-2147483648` -- a negative number -- so an instance holding bit 31 may log a negative `.value`, and `serialize()` may emit a negative integer in JSON, depending on how the instance was built (FB-03, planned fix in a later release). The predicates are signedness-agnostic: `hasAll` (and `has`/`hasAny`/`hasNone`/`isEmpty`/`isFull`) answer the same for a mask and its `>>> 0` form, so a 32-component ECS signature (including component 31, as produced by `BitMapper.getMask`) matches correctly. This was not true before 1.2.1: `hasAll` returned `false` for any mask carrying bit 31 (see [CHANGELOG](./CHANGELOG.md), FB-01). Only direct `.value` or `serialize()` equality needs `>>> 0` to compare unsigned.

</details>

<details>
<summary><strong>Object Pool — First Free Slot (zero-allocation, v1.2.0)</strong></summary>

```javascript
import { FastBit32 } from '@zakkster/lite-fastbit32';

const pool = new FastBit32();
const objects = new Array(32);

function allocate() {
    const slot = pool.nextClearBit();   // O(1), zero allocation
    if (slot === -1) return null;        // Pool full
    pool.add(slot);
    return slot;
}

function release(slot) {
    pool.remove(slot);
}

allocate(); // 0
allocate(); // 1
release(0);
allocate(); // 0 — immediately reused
```

> Before v1.2.0 this required constructing a scratch `FastBit32` from the inverted mask and calling `.lowest()` on it — one allocation per `allocate()` call. `nextClearBit` collapses that to a single `Math.clz32` on an inverted-and-isolated bit, with no allocations.

</details>

<details>
<summary><strong>Input State Manager</strong></summary>

```javascript
import { FastBit32 } from '@zakkster/lite-fastbit32';

const KEY_LEFT  = 0;
const KEY_RIGHT = 1;
const KEY_JUMP  = 2;
const KEY_FIRE  = 3;

const input = new FastBit32();

window.addEventListener('keydown', e => {
    if (e.code === 'ArrowLeft')  input.add(KEY_LEFT);
    if (e.code === 'ArrowRight') input.add(KEY_RIGHT);
    if (e.code === 'Space')      input.add(KEY_JUMP);
});

window.addEventListener('keyup', e => {
    if (e.code === 'ArrowLeft')  input.remove(KEY_LEFT);
    if (e.code === 'ArrowRight') input.remove(KEY_RIGHT);
    if (e.code === 'Space')      input.remove(KEY_JUMP);
});

if (input.has(KEY_JUMP)) jump();
if (input.hasAny((1 << KEY_LEFT) | (1 << KEY_RIGHT))) move();
```

</details>

<details>
<summary><strong>State Machine — Mutex Flags</strong></summary>

```javascript
import { FastBit32 } from '@zakkster/lite-fastbit32';

const IDLE       = 0;
const RUNNING    = 1;
const JUMPING    = 2;
const ATTACKING  = 3;
const INVINCIBLE = 4;

const state = new FastBit32();
state.add(IDLE);

function startAttack() {
    state.clear().add(ATTACKING).add(INVINCIBLE);
}

function endAttack() {
    state.clear().add(IDLE);
}

console.log(state.count()); // 1 — proof of mutex
```

</details>

<details>
<summary><strong>BitMapper + Iteration (v1.1.0)</strong></summary>

```javascript
import { FastBit32, BitMapper, forEachMapped, forEachMappedObject } from '@zakkster/lite-fastbit32';

const components = new BitMapper(['Position', 'Velocity', 'Sprite', 'AI']);
const entity = new FastBit32();
entity.add(components.get('Position')).add(components.get('AI'));

console.log(components.getActiveNames(entity)); // ['Position', 'AI']

forEachMapped(entity, components, (name, bit) => {
    console.log(`Component ${name} at bit ${bit}`);
});

const systems = { Position: updatePos, Velocity: updateVel, Sprite: draw, AI: think };
forEachMappedObject(entity, components, systems, (system, name) => {
    system(entity);
});
```

</details>

<details>
<summary><strong>Mask Set Operations (v1.1.0)</strong></summary>

```javascript
import { FastBit32, forEachMaskPair, forEachMaskDiff, forEachMaskUnion } from '@zakkster/lite-fastbit32';

const required = new FastBit32().add(0).add(1).add(3);
const available = new FastBit32().add(0).add(3).add(5);

forEachMaskPair(required, available, bit => console.log('matched:', bit));
// matched: 0, matched: 3

forEachMaskDiff(required, available, bit => console.log('missing:', bit));
// missing: 1

forEachMaskUnion(required, available, bit => console.log('all:', bit));
// all: 0, all: 1, all: 3, all: 5
```

</details>

---

## FastBit1024: 32 x 32 pools up to 1024

`FastBit1024` (1.4.0) is a fixed 32 x 32 two-level bitmap: an `Int32Array(32)` plus a "word non-empty" and a "word full" summary and an exact count. Every op is loop-free except forEach/hasAll/hasAny/clear/copy/equals/intersectionSize/unionSize/differenceSize (O(non-empty words)), saveInto/loadFrom (O(image words), and loadFrom rewrites all 32 words; the cold serialize/deserialize reuse them, clone reuses copy) and addRange/removeRange (O(words touched)). 1.6.0 adds save / restore, copy / equals, the three counts, `prevSetBit` and the range ops. It is a separate export with no coupling to `FastBit32`.

**Two input laws in one package:** FastBit32's hot ops trust the caller (SC-3, open, decided in S6), while FastBit1024 fails closed on every index (a `RangeError`, or a `TypeError` for a Symbol, a BigInt or a null-prototype object; a rejected call writes nothing, though the argument's own conversion (`valueOf` / `toString` / `Symbol.toPrimitive`) still runs once, before the throw; see [SC-3](./ROADMAP.md#sc-3----the-input-law-for-raw-bit-indices-open-decided-in-s6) and [SC-5](./ROADMAP.md#sc-5----fastbit1024-in-this-package-settled-2026-10-10-maintainer)).

| Member | Returns | Notes |
|---|---|---|
| `new FastBit1024(capacity = 1024)` | instance | integer 1..1024, else `RangeError` |
| `add(bit)` / `remove(bit)` / `toggle(bit)` | `this` | `RangeError` unless `0 <= bit < capacity` (integer) |
| `has(bit)` | `boolean` | same check: `has(undefined)` throws, never answers for slot 0 |
| `acquire()` | slot or `-1` | the LOWEST free slot; `-1` when full |
| `release(slot)` | `this` | `RangeError` on a bad index or a free slot (double release) |
| `size`, `capacity` | `number` | read-only getters, O(1) |
| `isEmpty()`, `isFull()` | `boolean` | O(1) |
| `lowest()`, `highest()`, `nextClearBit()` | index or `-1` | O(1) |
| `nextSetBit(from)` | index or `-1` | `from` in `0..capacity`; `capacity` ends the cursor |
| `prevSetBit(from)` | index or `-1` | (1.6.0) highest set bit `<= from` (inclusive), loop-free, 0 B/op. `from` in `-1..capacity-1`; `-1` returns `-1`, so `prevSetBit(b - 1)` ends a reverse walk; anything else: `RangeError`. The mirror of `nextSetBit` and of `FastBit32#prevSetBit` |
| `hasAll(other)`, `hasAny(other)` | `boolean` | `other` must be a FastBit1024 (private-name brand; anything else, a forgery or a Proxy included: `TypeError`; neither method writes to either instance); O(non-empty words), 0 B/op; capacities may differ, answer is exact. `hasAny` is RoaringSet's `intersects` (no alias) |
| `intersectionSize(other)`, `unionSize(other)`, `differenceSize(other)` | `number` | (1.6.0) the count of A AND B, A OR B, A AND NOT B (RoaringSet's names); O(non-empty words), 0 B/op; same brand `TypeError`. Exact for any two capacities (RoaringSet throws `RangeError` on a universe mismatch; these do not) |
| `copy(other)`, `equals(other)` | `this` / `boolean` | (1.6.0) `copy` overwrites words and summaries (no rebuild); a differing capacity is accepted only when every set bit of `other` fits, else `RangeError` and nothing is written. `equals` is exact across capacities. O(non-empty words), 0 B/op; same brand `TypeError` |
| `clone()` | `FastBit1024` | (1.6.0) COLD, allocates: same capacity, same bits |
| `addRange(lo, hi)`, `removeRange(lo, hi)` | `this` | (1.6.0) set / clear bits `lo..hi-1`: HALF-OPEN `[lo, hi)`, `0 <= lo <= hi <= capacity` (integers, else `RangeError` before any write); `lo === hi` is a no-op. A Symbol or BigInt `lo` throws `TypeError`; so does such an `hi` when `lo` passes its check. O(words touched), 0 B/op |
| `imageLength` | `number` | (1.6.0) read-only: `1 + ceil(capacity / 32)` (2..33) words in the image |
| `saveInto(out, offset = 0)` | `number` | (1.6.0) writes the image at `out[offset..offset + imageLength)` (header `0x46420800 \| capacity`, then the data words LSB-first); returns `offset + imageLength`, so saves chain. `out`: a genuine `Int32Array` or a subclass (intrinsic tag and length), else `TypeError`; a bad offset, no room or a detached `out`: `RangeError`, nothing written. O(image words), 0 B/op |
| `loadFrom(src, offset = 0)` | `number` | (1.6.0) validates the WHOLE image (tag, capacity 1..1024, length, no bit at or above the image capacity, every set bit below THIS capacity) before any write, then rebuilds the summaries and the count (a stored count is never trusted); returns the offset just past the image. Same `src` brand as `saveInto`; any failure leaves the set unchanged. O(image words), 0 B/op |
| `serialize()`, `FastBit1024.deserialize(src, offset = 0)` | `Int32Array` / `FastBit1024` | (1.6.0) COLD, allocate: a fresh image / a new set whose capacity is the image's (throws as `loadFrom`) |
| `forEach(cb)`, `clear()` | `this` | O(k + non-empty words) / O(non-empty words). forEach reads each word once (a snapshot): to mutate during the walk, use the `nextSetBit` cursor |

Underscore fields (`_cap`, `_n`, `_active`, `_full`, `_data`) are internal; writing them voids invariants I1-I4. `hasAll`, `hasAny`, `copy`, `equals`, `intersectionSize`, `unionSize` and `differenceSize` check a private-name brand (a private field stamped by the constructor): subclass instances pass; `null`, a primitive, a FastBit32, an `Object.create(FastBit1024.prototype)` forgery, a Proxy and a FastBit1024 from a second installed copy of the package all throw `TypeError`.

**Ranges are half-open.** `addRange` / `removeRange` take `[lo, hi)`; `FastBit32.countRange` and `FastBit32.rangeMask` are INCLUSIVE `[start, end]`.

**Shared memory.** An `Int32Array` over a `SharedArrayBuffer` is accepted by `loadFrom` / `deserialize`. Under a concurrent writer I1-I4 hold (no bit at or above the capacity is ever stored); the content is an unspecified (torn) image.

**RoaringSet name map.** `intersectionSize` / `unionSize` / `differenceSize` use RoaringSet's names; `hasAny` is RoaringSet's `intersects` (no alias).

Pool recipe (lowest-slot reuse, double release caught):

```js
import { FastBit1024 } from '@zakkster/lite-fastbit32';

const live = new FastBit1024(500);
const x = new Float32Array(500), vx = new Float32Array(500);

function spawn(px, pvx) {
    const s = live.acquire();             // lowest free slot, -1 when full
    if (s !== -1) { x[s] = px; vx[s] = pvx; }
    return s;
}

function step(dt) {                       // closure-free walk, 0 B/op
    for (let s = live.nextSetBit(0); s !== -1; s = live.nextSetBit(s + 1)) x[s] += vx[s] * dt;
}

const a = spawn(0, 1);
live.release(a);
// live.release(a);                       // RangeError: release of a free slot
```

Save, load and walk (1.6.0; every line below was run against `FastBit32.js`):

```js
import { FastBit1024 } from '@zakkster/lite-fastbit32';

const s = new FastBit1024(500);
s.add(3).add(64).add(499).addRange(100, 104);       // 3, 64, 100..103, 499

// JSON save / load (cold): the image is an Int32Array, JSON holds a plain array
const json = JSON.stringify(Array.from(s.serialize()));
const back = FastBit1024.deserialize(new Int32Array(JSON.parse(json)));
back.equals(s);                                     // true; back.capacity === 500

// Reverse walk, closure-free, 0 B/op
for (let b = s.prevSetBit(s.capacity - 1); b !== -1; b = s.prevSetBit(b - 1)) {
    // 499, 103, 102, 101, 100, 64, 3
}

// Snapshot arena, zero-GC: k sets of the same capacity, chained saveInto offsets
const k = 3, arena = new Int32Array(k * s.imageLength);
let off = 0;
for (let i = 0; i < k; i++) off = s.saveInto(arena, off);   // off === arena.length
off = 0;
for (let i = 0; i < k; i++) off = s.loadFrom(arena, off);   // each call returns the next offset
```

Measured (one full run, node v26.8.2, Apple M4 Pro, witness HOT lane, net ns/op): `acquire()` + `release()` pair ~3.2, `nextClearBit()` ~0.5, `lowest()` ~0.34-0.37, `highest()` ~0.40-0.47, `has()` ~0.91-0.98 (of which ~0.78 is the fail-closed check), each flat whether the free (or set) slot is in word 0 or word 31. 0 B/op measured in torture T6 (verified-optimized code; a DETERMINISTIC allocation count, gated in `npm run torture`) for acquire/release, has, nextClearBit, lowest, highest, the nextSetBit cursor and hasAll/hasAny, and for the 1.6.0 members saveInto, loadFrom, copy, equals, prevSetBit, intersectionSize / unionSize / differenceSize, addRange and removeRange (add/remove/toggle/forEach/clear are not in the FastBit1024 T6 lane; serialize, deserialize and clone allocate and have must-fail lanes that prove the detector sees it); the perf gate adds 0 scavenges for acquire+release.

---

## FastBit64: 64 flags in two words

`FastBit64` (1.7.0) holds 64 flags in two signed int32 words, `lo` (bits 0..31) and `hi` (bits 32..63), in one object. It is the class for 33..64 flags (component masks past 32, a 64-slot pool, a full `uint64` flag set) where a `FastBit1024` is too much structure and a `BigInt` allocates. Every op is O(1) and loop-free except `forEach` / `toArray` / `fromArray` (O(k)) and `loadFrom` / `deserialize` (O(image words), at most 33). It is a separate export with no coupling to `FastBit32` or `FastBit1024`.

```js
import { FastBit64 } from '@zakkster/lite-fastbit32';

const entity = new FastBit64().add(3).add(40).add(63);
const sig = new FastBit64().add(3).add(40);
entity.hasAll(sig);        // true: one call, two int32 ANDs
entity.lo; entity.hi;      // 8, -2147483392 (bit 63 set -> hi is negative)
entity.has(64);            // RangeError: fails closed, nothing written
```

**Input law (fail closed).** Every index is an integer 0..63, else a `RangeError` (a `TypeError` for a Symbol, a BigInt or a null-prototype object); a rejected call writes nothing, though the argument's own conversion (`valueOf` / `toString` / `Symbol.toPrimitive`) still runs once before the throw. Constructor and `setWords` / `equalsWords` words are integers in [-2^31, 2^32) in the signed or the unsigned form, stored `| 0`, else a `RangeError`. A method that takes another set (`hasAll`, `union`, `equals`, ...) requires a real `FastBit64` (subclasses pass); anything else, a `{ lo, hi }` look-alike, a `Proxy`, an `Object.create(FastBit64.prototype)` forgery, a `FastBit32` or a `FastBit1024`, throws a `TypeError`. That brand check is V8's own private-field check, so the message text is the engine's, not the package's. `lo` and `hi` are read-only getters returning the signed words.

| Member | Returns | Notes |
|---|---|---|
| `new FastBit64(lo = 0, hi = 0)` | instance | each word an integer in [-2^31, 2^32), else `RangeError` |
| `lo`, `hi` | `number` | read-only getters, signed int32 |
| `add(bit)` / `remove(bit)` / `toggle(bit)` | `this` | `bit` 0..63, else `RangeError` |
| `has(bit)` | `boolean` | same check: `has(undefined)` throws |
| `hasAll(other)` / `hasAny(other)` / `hasNone(other)` / `isSubsetOf(other)` / `equals(other)` | `boolean` | `other` is a `FastBit64`, else `TypeError` |
| `union(other)` / `difference(other)` / `intersect(other)` / `copy(other)` | `this` | mutate in place |
| `countMasked(other)` | `number` | popcount of `this & other` (FastBit1024's `intersectionSize`) |
| `setWords(lo, hi)` / `equalsWords(lo, hi)` | `this` / `boolean` | the two-word form of FastBit32's `set` / `equalsValue` |
| `count()` | `number` | 0..64 |
| `isEmpty()`, `isFull()` | `boolean` | |
| `clear()` | `this` | |
| `lowest()`, `highest()` | index or `-1` | `-1` when empty |
| `nextClearBit()`, `highestClearBit()` | index or `-1` | `-1` when full |
| `nextSetBit(from)` | index or `-1` | `from` in `0..64`; `64` returns `-1`, so `nextSetBit(b + 1)` ends a walk |
| `prevSetBit(from)` | index or `-1` | `from` in `-1..63` (INCLUSIVE); `-1` returns `-1` |
| `rank(bit)` | `number` | set bits strictly below `bit`, `bit` 0..63 |
| `select(k)` | index or `-1` | the k-th set bit, `k` 0..63 (`RangeError` outside); `-1` when `k >= count()`; `select(rank(b)) === b` |
| `addRange(lo, hi)` / `removeRange(lo, hi)` | `this` | half-open `[lo, hi)`, `0 <= lo <= hi <= 64`, else `RangeError` |
| `countRange(lo, hi)` | `number` | half-open `[lo, hi)`; **FastBit32's `countRange(start, end)` is INCLUSIVE** (FastBit64 follows FastBit1024) |
| `forEach(callback)` | `this` | O(k), ascending; hoist the callback, a capturing closure allocates |
| `imageLength` | `3` | instance and static, `readonly` |
| `saveInto(out, offset = 0)` / `loadFrom(src, offset = 0)` | next offset | the FastBit1024 image at capacity 64, `[0x46420840, lo, hi]` |
| `serialize()` / `FastBit64.deserialize(src, offset = 0)` | `Int32Array` / instance | COLD, allocate |
| `clone()`, `toArray()`, `fromArray(bits)` | instance / `number[]` / `this` | COLD, allocate; `fromArray` checks every index before its single write and overwrites |
| `toBinaryString(padded = true)` | `string` | 64 chars, bit 63 first; `false` drops leading zeros (`'0'` when empty) |

**Not carried from FastBit32** (a 64-bit mask is not one number): `static rangeMask(start, end)` (use `addRange`), `static nextSubset` / `nextCombination` (the result would be two words), the `serialize()` number / `deserialize(number)` form (the image is an `Int32Array`), the permissive modulo-32 input law and the `>>> 0` constructor storage. **Not carried from FastBit1024:** `acquire` / `release` / `size` (`nextClearBit()` then `add()` does a 64-slot pool; for 4096 slots see the recipe below). The `forEachArray` / `forEachMapped` / `BitMapper` helpers stay 32-bit and are not extended.

**Ranges are half-open.** `addRange(lo, hi)`, `removeRange` and `countRange` cover `[lo, hi)`, the FastBit1024 rule. `FastBit32.countRange(start, end)` is inclusive on both ends; do not port a call across classes without moving `end` by one.

**Kernels are private.** The popcount / count-trailing-zeros / select kernels behind `count`, `lowest` and `select` are module-private functions, not exports; exporting them waits for S6.

**Save and restore.** The image is `[0x46420840, lo, hi]`, the same words a `FastBit1024` of capacity 64 writes. `FastBit64.loadFrom` accepts any FastBit1024-format image (capacity 1..1024) whose set bits are all below 64 (a `RangeError` otherwise, nothing written), and `FastBit1024.loadFrom` accepts a FastBit64 image: each class loads the other's.

**64 x 64 = 4096 recipe (1.7.0, a doc recipe, not an export).** `Bits4096` is the FastBit1024 shape one size up: an `Int32Array(128)` of words and two `FastBit64` summaries over its 64 slots of 64 bits (`active`: the slot has a set bit; `full`: the slot is all ones). `acquire()` and `lowest()` are O(1) through the summaries; every index fails closed (a `RangeError`, state unchanged). Retained bytes: nominal (p8), not yet measured.

```js
import { FastBit64 } from '@zakkster/lite-fastbit32';

// 4096 slots = 64 slots of 64 bits. The bits live in one Int32Array(128); two FastBit64
// summaries sit over the 64 slots: `active` (slot has a set bit) and `full` (slot is all ones).
class Bits4096 {
    constructor() { this.words = new Int32Array(128); this.active = new FastBit64(); this.full = new FastBit64(); this.n = 0; }
    static bad(i) { throw new RangeError('Bits4096: index must be an integer 0..4095, got ' + String(i)); }
    has(i) { if ((i & 4095) !== i) Bits4096.bad(i); return (this.words[i >>> 5] & (1 << i)) !== 0; }
    add(i) {
        if ((i & 4095) !== i) Bits4096.bad(i);
        const w = i >>> 5, ws = this.words, old = ws[w], d = old | (1 << i);
        if (d === old) return this;
        ws[w] = d; this.n++;
        const s = i >>> 6;
        this.active.add(s);
        if (~(ws[s << 1] & ws[(s << 1) + 1]) === 0) this.full.add(s);
        return this;
    }
    remove(i) {
        if ((i & 4095) !== i) Bits4096.bad(i);
        const w = i >>> 5, ws = this.words, old = ws[w], d = old & ~(1 << i);
        if (d === old) return this;
        ws[w] = d; this.n--;
        const s = i >>> 6;
        this.full.remove(s);
        if ((ws[s << 1] | ws[(s << 1) + 1]) === 0) this.active.remove(s);
        return this;
    }
    /** Lowest free index, now held; -1 when full. */
    acquire() {
        const s = this.full.nextClearBit();
        if (s === -1) return -1;
        const ws = this.words, lo = ws[s << 1], wi = (s << 1) + ((~lo === 0) ? 1 : 0), c = ~ws[wi];
        const i = (wi << 5) + (31 - Math.clz32(c & -c));
        this.add(i);
        return i;
    }
    /** RangeError on a bad index or a free slot (double release). */
    release(i) {
        if ((i & 4095) !== i) Bits4096.bad(i);
        if ((this.words[i >>> 5] & (1 << i)) === 0) throw new RangeError('Bits4096: release of a free slot ' + i);
        return this.remove(i);
    }
    lowest() {
        const s = this.active.lowest();
        if (s === -1) return -1;
        const ws = this.words, lo = ws[s << 1], wi = (s << 1) + (lo === 0 ? 1 : 0), d = ws[wi];
        return (wi << 5) + (31 - Math.clz32(d & -d));
    }
    /** Lowest set index >= from, or -1; from 0..4096 (4096 ends a walk). */
    nextSetBit(from) {
        if ((from & 8191) !== from || from > 4096) Bits4096.bad(from);
        if (from === 4096) return -1;
        const ws = this.words, s = from >>> 6;
        for (let wi = from >>> 5, m = -1 << from; wi < (s << 1) + 2; wi++, m = -1) {
            const d = ws[wi] & m;
            if (d !== 0) return (wi << 5) + (31 - Math.clz32(d & -d));
        }
        if (s === 63) return -1;
        const t = this.active.nextSetBit(s + 1);
        if (t === -1) return -1;
        const lo = ws[t << 1], wi = (t << 1) + (lo === 0 ? 1 : 0), d = ws[wi];
        return (wi << 5) + (31 - Math.clz32(d & -d));
    }
    get size() { return this.n; }
}

const pool = new Bits4096();
const a = pool.acquire(), b = pool.acquire();   // 0, 1
pool.release(a);                                // a is free again; pool.release(a) twice throws RangeError
pool.acquire();                                 // 0 again: the lowest free slot
```

**Names above 32 (1.7.0, a doc recipe).** `BitMapper` maps names to 32 bits. For up to 64 names, build the name -> index `Map` once, resolve a signature when it is created, and keep `hasAll` as the hot check; the `Map` lookup never runs per frame.

```js
import { FastBit64 } from '@zakkster/lite-fastbit32';

const NAMES = ['pos', 'vel', 'acc', 'rot', 'scale', 'sprite', 'anim', 'tint', 'health', 'armor',
    'mana', 'ai', 'target', 'path', 'input', 'camera', 'light', 'shadow', 'audio', 'emitter',
    'trigger', 'collider', 'body', 'joint', 'tag', 'team', 'owner', 'parent', 'child', 'timer',
    'lifetime', 'loot', 'inventory', 'dialog', 'quest', 'score', 'netid', 'replicated', 'dirty', 'dead'];
const BIT = new Map(NAMES.map((n, i) => [n, i]));   // name -> 0..63; built once
function signature(names) {                          // runs when the signature is built, never per frame
    const s = new FastBit64();
    for (const n of names) { const i = BIT.get(n); if (i === undefined) throw new RangeError('unknown name: ' + n); s.add(i); }
    return s;
}
const entity = signature(['pos', 'vel', 'sprite', 'health']), sig = signature(['pos', 'sprite']);
entity.hasAll(sig);   // the hot check: two int32 ANDs, no Map lookup, no allocation
```

<details>
<summary><strong>FastBit64 zero-GC notes</strong></summary>

**Node (DETERMINISTIC).** 0 B/op in torture T6 (an allocation count gated in `npm run torture`, verified TurboFan code, below 0.1 B/op) on 24 FastBit64 lanes, each run inlined and again in a child under `--no-turbo-inlining`: `has`, `add+remove`, `toggle`, `hasAll`, `hasAny/hasNone`, `isSubsetOf/equals`, `union/diff/intersect`, `count/countMasked`, `lowest/highest`, `nextClearBit/hiClear`, `nextSetBit walk`, `prevSetBit walk`, `rank/select`, `rank(31)/rank(63)`, `addRange/removeRange`, `countRange`, `setWords/equalsWords`, `lo/hi getters`, `isEmpty/isFull`, `clear`, `forEach (hoisted cb)`, `saveInto`, `loadFrom` and `copy`. `serialize`, `deserialize`, `clone`, `toArray`, `fromArray` and `toBinaryString` are COLD and allocate. Every stored word is an int32, so every value stays in the Smi range on Node (32-bit Smi). A source pin in `npm test` (Hygiene) requires every numeric field of a `FastBit32.js` class to start as a Smi (`#lo = 0; #hi = 0;`), because a bare `#lo;` field boxes every out-of-Smi store on a pointer-compressed engine.

**Pointer-compressed engines (31-bit Smi: Chrome, Electron).** Two statements.

- (a) The d8 lane (d8 15.7.37, pointer-compressed) gates the read, store and mutator (`toggle` / `add` / `union`) windows at <= 2 scavenges per 1e6 ops with the inlined build; the `--no-turbo-inlining` d8 run is REPORTED, not gated. The remaining cost: a word outside the 31-bit Smi range (bits 31 and 30 differ) boxes when it crosses a call V8 does not inline (the `setWords` / `equalsWords` arguments, the `lo` / `hi` returns, kernel calls when the inlining budget runs out), in Maglev-compiled `loadFrom` (one box per call), and in interpreter or Sparkplug code. An instance with such a word costs about 24 B more than a plain two-field object (two in-place number boxes).
- (b) REPORTED, not gated (d8 15.7.37, K = 7, one run, 2026-11-08, Apple M4 Pro (12 cores), quiet host (load1 2.33), node v26.8.2 harness): once a d8 process holds an out-of-Smi instance, the mutators on Smi words were measured slower, `toggle` about 1.0 -> about 3.7 ns/op, with no allocation either way. Treat it as a measurement of that process, not a law.

</details>

---

## API

### `new FastBit32(initial?)`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `initial` | number | `0` | Starting bitmask. Coerced to unsigned 32-bit via `>>> 0`. |

### Single Bit Operations

| Method | Returns | Description |
|---|---|---|
| `.add(bit)` | `this` | Set bit at position (0–31). |
| `.remove(bit)` | `this` | Clear bit at position (0–31). |
| `.toggle(bit)` | `this` | Flip bit at position (0–31). |
| `.has(bit)` | `boolean` | Test if bit is active. |

### Bulk Mask Operations

| Method | Returns | Description |
|---|---|---|
| `.hasAll(mask)` | `boolean` | True if **all** bits in mask are active. |
| `.hasAny(mask)` | `boolean` | True if **any** bit in mask is active. |
| `.hasNone(mask)` | `boolean` | True if **no** bits in mask are active. |

### In-Place Mutations

| Method | Returns | Description |
|---|---|---|
| `.clear()` | `this` | Reset all 32 bits to zero. |
| `.union(mask)` | `this` | Bitwise OR — add all bits in mask. |
| `.difference(mask)` | `this` | Bitwise AND NOT — remove all bits in mask. |
| `.intersect(mask)` | `this` | Bitwise AND — keep only bits present in both. |

### Advanced Helpers

| Method | Returns | Description |
|---|---|---|
| `.count()` | `number` | O(1) popcount — number of active bits (0–32). |
| `.countMasked(mask)` | `number` | O(1) popcount within a masked region. |
| `.countRange(start, end)` | `number` | O(1) popcount within INCLUSIVE range `[start, end]` -- FastBit1024 `addRange` / `removeRange` are half-open `[lo, hi)`. |
| `.lowest()` | `number` | O(1) index of least significant active bit. `-1` if empty. |
| `.highest()` | `number` | O(1) index of most significant active bit. `-1` if empty. |
| `.nextClearBit()` | `number` | O(1) index of least significant **clear** bit. `-1` if full. Zero-alloc pool slot lookup. |
| `.highestClearBit()` | `number` | O(1) index of most significant **clear** bit. `-1` if full. |
| `.isEmpty()` | `boolean` | True if value is `0`. |
| `.isFull()` | `boolean` | True if all 32 bits are active. |
| `.rank(bit)` | `number` | O(1) number of active bits strictly below `bit` (0-31). Packed-array slot index. |
| `.equals(other)` | `boolean` | Same set as another FastBit32 (signedness-agnostic). |
| `.equalsValue(x)` | `boolean` | Same set as a raw word (signedness-agnostic). Not validated: `undefined` / `null` / `NaN` compare as `0`. |
| `.isSubsetOf(mask)` | `boolean` | Every active bit is also in `mask` (the dual of `hasAll`). |
| `FastBit32.rangeMask(start, end)` | `number` | INCLUSIVE `[start, end]` mask as a signed int32 -- FastBit1024 `addRange` / `removeRange` are half-open `[lo, hi)`. Cold, validated: throws `RangeError` unless both are integers with `0 <= start <= end <= 31`. |
| `.select(k)` | `number` | (1.5.0) The k-th set bit, 0-based ascending: `select(0) === lowest()`, `select(count() - 1) === highest()`. `-1` for any int32 `k` outside `0..count()-1` (and on an empty set). Inverse of `rank`. O(1) branchless SWAR descent, 0 B/op. Not validated: a non-int32 `k` is read as `k \| 0` (pinned until S6). |
| `FastBit32.nextSubset(sub, mask)` | `number` | (1.5.0) `(sub - 1) & mask` as a signed int32 (0 B/op on Node; a result outside [-2^30, 2^30) boxes, 12 B, on pointer-compressed engines through a non-inlined call: FB-12, S7). Walk from `mask` down: exactly 2^count(mask) submasks, `0` last. `nextSubset(0, mask)` wraps to `mask | 0` (signed): visit, then stop on `0`. Not validated. |
| `FastBit32.nextCombination(v)` | `number` | (1.5.0) Next word with the same popcount, strictly greater as uint32 (Gosper's hack, no division), as a signed int32. Ends at `0` (after the top-k-bits word; also `f(0)` and `f(-1)`), never `-1`. Not validated. |

### Iteration

| Method | Returns | Description |
|---|---|---|
| `.forEach(callback)` | `this` | O(k) iteration over active bits. `callback(bit)`. A callback that captures variables allocates a closure per call site evaluation -- hoist it, or use the cursor below. |
| `.nextSetBit(from)` | `number` | O(1) branchless cursor: lowest active bit `>= from` (0-32), or `-1`. Zero-GC iteration: `for (let b = m.nextSetBit(0); b !== -1; b = m.nextSetBit(b + 1))`. |
| `.prevSetBit(from)` | `number` | O(1) branchless descending cursor: highest active bit `<= from` (-1..31), or `-1`. |

### Utility

| Method | Returns | Description |
|---|---|---|
| `.clone()` | `FastBit32` | Independent copy. Allocates -- in a pool, use `copy()`. |
| `.copy(other)` | `this` | Overwrite with `other.value`. Zero-alloc alternative to `clone()`. |
| `.set(x)` | `this` | Overwrite with `x \| 0` (signed int32, like every mutator). |
| `.serialize()` | `number` | Export raw uint32 for JSON/binary storage. |
| `FastBit32.deserialize(n)` | `FastBit32` | Restore from a serialized uint32. |

### Debug & Init Helpers

> These methods allocate. Do not call them inside hot loops.

| Method | Returns | Description |
|---|---|---|
| `.toBinaryString(padded?)` | `string` | 32-char binary representation, LSB on the right. Sign-bit safe. |
| `.toArray()` | `number[]` | Active bit indexes in ascending order. Inlined O(k) — no closure allocation. |
| `.fromArray(bits)` | `this` | **Replaces** the mask from a bit-index array. Init/deserialization only. |

### `new BitMapper(names?)`

| Method | Returns | Description |
|---|---|---|
| `.get(name)` | `number` | Bit index for a flag name. Throws if unknown. |
| `.getMask(names)` | `number` | Combined uint32 mask from flag name array. |
| `.getActiveNames(fb32)` | `string[]` | Active flag names from a FastBit32 instance. |
| `.bit(name)` | `number` | One-bit mask `1 << get(name)` (signed int32; bit 31 is `-2147483648`). Throws if unknown. |
| `.size` | `number` | Number of distinct registered names (a duplicate keeps its last index). |
| `.getName(bit)` | `string \| undefined` | O(1) reverse lookup — bit index to name. |

### Standalone Iteration Helpers

| Function | Description |
|---|---|
| `forEachArray(mask, array, cb)` | `cb(element, bit)` for each active bit. |
| `forEachObject(mask, keys, obj, cb)` | `cb(value, key, bit)` via keys array. |
| `forEachMapped(mask, mapper, cb)` | `cb(name, bit)` via BitMapper. |
| `forEachMappedObject(mask, mapper, obj, cb)` | `cb(value, key, bit)` via BitMapper + object. |
| `forEachMaskPair(maskA, maskB, cb)` | `cb(bit)` for intersection (A & B). |
| `forEachMaskDiff(maskA, maskB, cb)` | `cb(bit)` for difference (A & ~B). |
| `forEachMaskUnion(maskA, maskB, cb)` | `cb(bit)` for union (A \| B). |

---

## Testing

`npm test` runs 880 tests (node:test, 115 suites; 879 pass, 1 skip: the V8 11-13 row; DETERMINISTIC; run 2026-11-05, Node v26.8.2). The package scripts:

| Script | What it does |
|---|---|
| `npm test` | `node --test test/*.test.mjs`: the unit, property, parity and documentation-pin suites |
| `npm run test:types` | `tsc` over `test/types`: the .d.ts against typed usage and `@ts-expect-error` rows |
| `npm run torture` | the tiered torture run (laws, adversarial input, fuzz, B/op allocation counts, soak); the script owns its node flags (`--allow-natives-syntax --expose-gc`, 4 MB semi-space); the T6 lanes measure verified-optimized (TurboFan) code and an unverified lane fails closed; T6 runs on V8 >= 14 (node 26.x; below that torture prints a named SKIP) and first poisons call feedback, with a 1.6.0-body witness that must read >= 15.9 B/op on its unsigned lanes |
| `npm run torture:controls` | mutants and broken harness pieces that each must turn their tier red (proves the gates have teeth) |
| `npm run test:perf` | the scavenge-count gate (DETERMINISTIC, not timed): each hot op group is run at N and 8N under pinned 4 MB semi-spaces and must show a finite scavenge count <= 2, with a must-trip teeth scenario; part of `verify` |
| `npm run witness`, `npm run witness:fast` | the flatness witness (STATISTICAL, timed) |
| `npm run gate:release` | `test/witness-release.mjs`: witness:fast K = 5 rounds with a majority vote (STATISTICAL, timed); runs under the quiet lock at release. Exit 0 pass, 1 finding or harness failure, 2 inconclusive (`prepublishOnly` fails on 2) |
| `soak-nightly` workflow (lane S) | `.github/workflows/soak-nightly.yml`, daily cron + manual dispatch (DETERMINISTIC, GATING): ubuntu (node latest and 26.8.2, pinned d8 15.7.37 lane) and macos, node latest (d8 lane named SKIP); per leg 3 seeds, each a full `npm run torture` with `TORTURE_SOAK_CYCLES` = 16384 (default; dispatch accepts a multiple of 1024 in [8192, 65536]), each seed printed as a replay command; then `torture:controls` at the push volume (`TORTURE_SOAK_CYCLES` unset) and the two T7 soak controls (`soak-stash`, `soak-retain`) at the nightly volume. A red leg is red until explained |
| `perf-nightly` workflow (lane P) | `.github/workflows/perf-nightly.yml`, daily cron + manual dispatch on ubuntu-latest and macos-latest, node 26.8.2 (STATISTICAL, REPORT-ONLY): runs the `gate:release` statistic (3 of K = 5 `witness:fast` rounds) on the live tree and, interleaved ABBA, on a temp copy with a slowed `countMasked` that must trip. Results are REPORTED, not a gate, until the calibration in RESEARCH.md ("Lane P calibration") closes |
| `npm run bundle-check` | esbuild bundle smoke |
| `npm run verify` | `npm test && npm run test:types && npm run torture && npm run torture:controls && npm run test:perf` |
| `npm run bench:sc1`, `npm run bench:sc2` | research benchmarks (REPORTED only, gate nothing) |

`prepublishOnly` runs `verify`, then `gate:release --if-stale`, then `bundle-check`.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

---

## License

MIT

## Part of the @zakkster ecosystem

Zero-GC, deterministic, tree-shakeable micro-libraries for high-performance web applications.