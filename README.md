# @zakkster/lite-fastbit32

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-fastbit32.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-fastbit32)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-fastbit32?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-fastbit32)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-fastbit32?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-fastbit32)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-fastbit32?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-fastbit32)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

Zero-GC, monomorphic, branchless 32-bit flag manager for ECS masking, object pools, and 60fps hot-path engine code. Zero dependencies. One class. The fastest 32-bit flag engine in JavaScript.

## 🚀 Built with Lite-FastBit32: Lite-Tween Pro

If you are building high-performance WebGL applications or JavaScript games, check out **Lite-Tween Pro**. It is a commercial, zero-allocation ECS tweening engine built directly on top of this bitwise architecture. It completely bypasses the JavaScript Garbage Collector to guarantee a flat memory profile and a stable 120fps on mobile devices.

👉 **[Get the Lite-Tween Pro Source Code here](https://zakkster.lemonsqueezy.com/checkout/buy/05ad56be-4b91-4bef-8218-9e85c65690b4)**

*(Are you a solo indie dev or student? Reach out to me directly at shinikchiev@yahoo.com and I will hook you up with an indie discount!)*

## Why lite-fastbit32?

| Feature               | lite-fastbit32 | FastBitSet | TypedFastBitSet |
|-----------------------|----------------|------------|-----------------|
| **Max bits**          | **32**         | Unlimited  | Unlimited       |
| **Zero-GC**           | **Yes**        | No         | No              |
| **Monomorphic**       | **Yes**        | No         | No              |
| **Branchless**        | **Yes**        | No         | No              |
| **O(1) popcount**     | **Yes**        | No         | No              |
| **O(1) lowest/highest** | **Yes**      | No         | No              |
| **O(k) iteration**    | **Yes**        | No         | No              |
| **BitMapper**         | **Yes**        | No         | No              |
| **BigInt support**    | No             | No         | No              |
| **ECS-ready**         | **Yes**        | Yes        | Yes             |
| **Object pool scan**  | **Yes**        | No         | No              |
| **Serialization**     | Yes            | Yes        | Yes             |
| **Bundle size**       | **< 1KB**      | ~8KB       | ~6KB            |

> FastBit32 is an engine primitive, not a general-purpose bitfield.

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
lowest = Math.clz32(value & -value) ^ 31
```

`value & -value` isolates the lowest set bit into a power-of-two. `Math.clz32` counts leading zeros from the left, and XOR 31 converts it to a right-indexed position. One expression, no loops.

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

### Iteration

| Method | Returns | Description |
|---|---|---|
| `.forEach(callback)` | `this` | O(k) iteration over active bits. `callback(bit)`. |

### Utility

| Method | Returns | Description |
|---|---|---|
| `.clone()` | `FastBit32` | Independent copy. Mutations do not propagate. |
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