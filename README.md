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

Zero-GC, monomorphic 32-bit flag manager for ECS masking, object pools, and 60fps hot-path engine code; FastBit32's bit and mask ops are branchless. Zero dependencies. Two bit classes plus the `BitMapper` name mapper: `FastBit32` (one word) and, from 1.4.0, `FastBit1024` (32 x 32 words, fail-closed). The fastest 32-bit flag engine in JavaScript.

## 🚀 Built with Lite-FastBit32: Lite-Tween Pro

If you are building high-performance WebGL applications or JavaScript games, check out **Lite-Tween Pro**. It is a commercial, zero-allocation ECS tweening engine built directly on top of this bitwise architecture. It completely bypasses the JavaScript Garbage Collector to guarantee a flat memory profile and a stable 120fps on mobile devices.

👉 **[Get the Lite-Tween Pro Source Code here](https://zakkster.lemonsqueezy.com/checkout/buy/05ad56be-4b91-4bef-8218-9e85c65690b4)**

*(Are you a solo indie dev or student? Reach out to me directly at shinikchiev@yahoo.com and I will hook you up with an indie discount!)*

## Why lite-fastbit32?

| Feature               | lite-fastbit32 | FastBitSet | TypedFastBitSet |
|-----------------------|----------------|------------|-----------------|
| **Max bits**          | **32 (FastBit32); 1024 (FastBit1024)** | Unlimited  | Unlimited       |
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
| **Bundle size** (min+gz) | **1059 B** FastBit32 alone; 2254 B whole module | ~8KB | ~6KB |

> Bundle sizes, measured 2026-10-11: an entry file `export { <names> } from '@zakkster/lite-fastbit32'` piped through `esbuild 0.28.2 --bundle --format=esm --minify | gzip -9 | wc -c`. `export *` (whole module): 2254 B. `{ FastBit32 }` alone: 1059 B. `{ FastBit1024 }` alone: 1006 B. Every export except FastBit1024 (VERSION included): 1485 B (1302 B in 1.4.0).

> FastBit32 is an engine primitive, not a general-purpose bitfield. For up to 1024 bits (pools, dense id sets) the package also ships [`FastBit1024`](#fastbit1024-32-x-32-pools-up-to-1024) (1.4.0).

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

`highest` uses `31 - Math.clz32(value)` directly.

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
0 B/op (gated in the torture T6 lane and the perf gate).

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

`FastBit1024` (1.4.0) is a fixed 32 x 32 two-level bitmap: an `Int32Array(32)` plus a "word non-empty" and a "word full" summary and an exact count, so every op except `forEach`, `hasAll`, `hasAny` and `clear` is loop-free. It is a separate export with no coupling to `FastBit32`.

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
| `hasAll(other)`, `hasAny(other)` | `boolean` | `other` must be a FastBit1024 (anything else: `TypeError`; the brand is `instanceof`, so an `Object.create(FastBit1024.prototype)` forgery passes it and is unsupported: no defined answer, and neither method writes to either instance); capacities may differ, answer is exact |
| `forEach(cb)`, `clear()` | `this` | O(k + non-empty words) / O(non-empty words). forEach reads each word once (a snapshot): to mutate during the walk, use the `nextSetBit` cursor |

Underscore fields (`_cap`, `_n`, `_active`, `_full`, `_data`) are internal; writing them voids invariants I1-I4. `hasAll`/`hasAny` check `instanceof FastBit1024`, so a FastBit1024 from a second installed copy of the package throws `TypeError`.

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

Measured (one full run, node v26.8.2, Apple M4 Pro, witness HOT lane, net ns/op): `acquire()` + `release()` pair ~3.2, `nextClearBit()` ~0.5, `lowest()` ~0.34-0.37, `highest()` ~0.40-0.47, `has()` ~0.91-0.98 (of which ~0.78 is the fail-closed check), each flat whether the free (or set) slot is in word 0 or word 31. 0 B/op measured in torture T6 for acquire/release, has, nextClearBit, lowest, highest, the nextSetBit cursor and hasAll/hasAny (add/remove/toggle/forEach/clear are not in the FastBit1024 T6 lane); the perf gate adds 0 scavenges for acquire+release.

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
| `.countRange(start, end)` | `number` | O(1) popcount within inclusive range `[start, end]`. |
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
| `FastBit32.rangeMask(start, end)` | `number` | Inclusive `[start, end]` mask as a signed int32. Cold, validated: throws `RangeError` unless both are integers with `0 <= start <= end <= 31`. |
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

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

---

## License

MIT

## Part of the @zakkster ecosystem

Zero-GC, deterministic, tree-shakeable micro-libraries for high-performance web applications.