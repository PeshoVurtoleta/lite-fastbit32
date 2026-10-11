/**
 * FastBit32 -- Zero-GC, Monomorphic 32-bit Flag Manager
 * Engineered for 60fps hot-path execution, ECS masking, and object pooling.
 * * WARNING: ENGINE PRIMITIVE CAVEATS:
 * - SILENT WRAPAROUND: JS bitwise shifts implicitly apply modulo 32.
 * Calling `add(32)` evaluates as `add(0)`. `add(40)` evaluates as `add(8)`.
 * - TRUNCATION: Floats and negative numbers are silently truncated and
 * converted to unsigned 32-bit integers (e.g., `-1 >>> 0` becomes `4294967295`).
 * Sanitize your inputs upstream if your domain logic requires strict bounds!
 * - BIT INDEX IDIOM: always `31 - Math.clz32(x)`, never the XOR-31 form: `31 -` maps
 * x === 0 to the -1 "none" sentinel for free, so every scan is branchless.
 * - 1.3.0 (Tier 1): nextSetBit(from) [from 0..32], prevSetBit(from) [from -1..31],
 * rank(bit) [bit 0..31], equals, equalsValue, set, copy, isSubsetOf, static
 * rangeMask(start, end) [validated, throws RangeError], BitMapper bit(name) and
 * size. Raw-index ops are permissive outside their domain (pinned until S6).
 * - 1.4.0: FastBit1024, a fixed 32 x 32 two-level bitmap (capacity 1..1024)
 * that FAILS CLOSED on every index: add/remove/toggle/has, acquire/release,
 * size, capacity, isEmpty/isFull, lowest/highest, nextClearBit, nextSetBit,
 * hasAll/hasAny, forEach, clear. No coupling to FastBit32.
 */

export const VERSION = '1.4.0';

export class FastBit32 {
    constructor(initial = 0) {
        this.value = initial >>> 0;
    }

    add(bit) {
        this.value |= (1 << bit);
        return this;
    }

    remove(bit) {
        this.value &= ~(1 << bit);
        return this;
    }

    toggle(bit) {
        this.value ^= (1 << bit);
        return this;
    }

    has(bit) {
        return (this.value & (1 << bit)) !== 0;
    }

    hasAll(mask) {
        return (~this.value & mask) === 0;
    }

    hasAny(mask) {
        return (this.value & mask) !== 0;
    }

    hasNone(mask) {
        return (this.value & mask) === 0;
    }

    clear() {
        this.value = 0;
        return this;
    }

    union(mask) {
        this.value |= mask;
        return this;
    }

    difference(mask) {
        this.value &= ~mask;
        return this;
    }

    intersect(mask) {
        this.value &= mask;
        return this;
    }

    // -- Advanced AAA Engine Helpers --

    /**
     * O(1) loop-free popcount (Hamming Weight).
     * Returns the number of active bits (e.g., how many flags are active).
     */
    count() {
        let v = this.value;
        v = v - ((v >>> 1) & 0x55555555);
        v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
        return Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
    }

    /**
     * O(1) loop-free popcount applying a mask first.
     * Useful for counting active flags within a specific subsystem.
     */
    countMasked(mask) {
        let v = this.value & mask;
        v = v - ((v >>> 1) & 0x55555555);
        v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
        return Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
    }

    /**
     * Instantly finds the index of the lowest active bit.
     * Incredibly useful for Object Pools (finding the first available slot).
     * Returns -1 if empty.
     */
    lowest() {
        const v = this.value;
        // Isolate lowest set bit, then Count Leading Zeros; clz32(0) = 32 -> -1
        return 31 - Math.clz32(v & -v);
    }

    /**
     * Instantly finds the index of the highest active bit.
     * Useful for determining the bounds of active arrays/spatial grids.
     * Returns -1 if empty.
     */
    highest() {
        return 31 - Math.clz32(this.value);
    }

    isEmpty() {
        return this.value === 0;
    }

    clone() {
        return new FastBit32(this.value);
    }

    // -- Serialization (For ECS Save States) --

    /**
     * Exports the raw 32-bit integer for ultra-lightweight JSON/binary storage.
     */
    serialize() {
        return this.value;
    }

    /**
     * Instantiates a new FastBit32 from a serialized integer.
     */
    static deserialize(value) {
        return new FastBit32(value);
    }

    /**
     * O(k) loop-free iteration over active bits.
     * @param {Function} callback - Called with (bit)
     */
    forEach(callback) {
        let v = this.value;
        while (v !== 0) {
            const bit = 31 - Math.clz32(v & -v);
            callback(bit);
            v &= v - 1; // Clear lowest active bit
        }
        return this;
    }

    // -- v1.2.0 AAA Engine Primitives --

    /**
     * O(1) loop-free bit-scan forward for the lowest INACTIVE (0) bit.
     * Essential for Object Pools to find the first available slot WITHOUT
     * allocating a scratch FastBit32 for the inverted mask.
     * Returns -1 if all 32 bits are active.
     */
    nextClearBit() {
        const v = this.value;
        // ~v & (v + 1) isolates the lowest 0 bit; full word -> 0 -> -1
        return 31 - Math.clz32(~v & (v + 1));
    }

    /**
     * O(1) loop-free bit-scan reverse for the highest INACTIVE (0) bit.
     * Returns -1 if all 32 bits are active.
     */
    highestClearBit() {
        return 31 - Math.clz32(~this.value);
    }

    /**
     * O(1) Returns true if all 32 bits are active.
     * Uses `~this.value === 0` because JS bitwise ops yield signed int32,
     * so a fully-set value reads as -1 rather than 0xFFFFFFFF.
     */
    isFull() {
        return ~this.value === 0;
    }

    /**
     * O(1) active bit count within an inclusive range [start, end].
     * Mask is built with `>>>` to avoid the `1 << 32` wraparound trap.
     * Caller must guarantee 0 <= start <= end <= 31.
     */
    countRange(start, end) {
        const mask = ((0xFFFFFFFF >>> (31 - (end - start))) << start) >>> 0;
        return this.countMasked(mask);
    }

    // -- v1.3.0 Tier-1 Primitives (closure-free iteration + basics) --

    /**
     * O(1) branchless cursor: index of the lowest active bit >= from, or -1.
     * Domain: from in 0..32 (32 returns -1, so `nextSetBit(b + 1)` ends the walk).
     * `(from - 32) >> 31` is 0 at from === 32 and kills the `<< 32` wraparound.
     */
    nextSetBit(from) {
        const w = this.value & (-1 << (from & 31)) & ((from - 32) >> 31);
        return 31 - Math.clz32(w & -w);
    }

    /**
     * O(1) branchless descending cursor: index of the highest active bit <= from,
     * or -1. Domain: from in -1..31 (-1 returns -1).
     */
    prevSetBit(from) {
        return 31 - Math.clz32(this.value & (-1 >>> (31 - from)) & ~(from >> 31));
    }

    /**
     * O(1) number of active bits strictly below `bit`. Domain: bit in 0..31.
     * The packed-array slot index of `bit` (HAMT-style sparse storage).
     */
    rank(bit) {
        let v = this.value & ((1 << bit) - 1);
        v = v - ((v >>> 1) & 0x55555555);
        v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
        return Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
    }

    /**
     * Same set as `other` (signedness-agnostic: compares the bit pattern).
     */
    equals(other) {
        return (this.value ^ other.value) === 0;
    }

    /**
     * Same set as the raw word `x` (signedness-agnostic).
     */
    equalsValue(x) {
        return (this.value ^ x) === 0;
    }

    /**
     * Overwrites the word with `x | 0` (signed int32, like every mutator).
     */
    set(x) {
        this.value = x | 0;
        return this;
    }

    /**
     * Overwrites the word with `other.value`. Zero-alloc alternative to clone().
     */
    copy(other) {
        this.value = other.value;
        return this;
    }

    /**
     * True when every active bit is also in `mask` (the dual of hasAll).
     */
    isSubsetOf(mask) {
        return (this.value & ~mask) === 0;
    }

    /**
     * COLD, validated: the inclusive [start, end] mask as a signed int32 (the
     * bit pattern countRange uses). Throws RangeError unless both are integers
     * with 0 <= start <= end <= 31.
     */
    static rangeMask(start, end) {
        if (typeof start !== 'number' || typeof end !== 'number' ||
            !Number.isInteger(start) || !Number.isInteger(end) ||
            !(start >= 0) || !(end <= 31) || !(start <= end)) {
            throw new RangeError('FastBit32.rangeMask: need integers 0 <= start <= end <= 31, got ' +
                (typeof start === 'number' ? String(start) : typeof start) + ', ' +
                (typeof end === 'number' ? String(end) : typeof end));
        }
        return (0xFFFFFFFF >>> (31 - (end - start))) << start;
    }

    // -- Debug & Init Helpers (allocate -- NOT hot-path safe) --

    /**
     * Returns the 32-bit binary string representation (LSB on the right).
     * Forces unsigned via `>>> 0` so the sign bit prints as a leading `1`
     * instead of triggering `toString(2)`'s minus-sign formatting.
     * WARNING: Allocates a String. Debug use only.
     */
    toBinaryString(padded = true) {
        const str = (this.value >>> 0).toString(2);
        return padded ? str.padStart(32, '0') : str;
    }

    /**
     * Returns an array of active bit indexes in ascending order.
     * Inlined O(k) scan -- no closure allocation vs. delegating to forEach.
     * WARNING: Allocates an Array. Do not use in hot loop!
     */
    toArray() {
        const result = [];
        let v = this.value;
        while (v !== 0) {
            result.push(31 - Math.clz32(v & -v));
            v &= v - 1;
        }
        return result;
    }

    /**
     * Replaces the mask from an array of bit indexes. Note: this OVERWRITES
     * the current value -- it does not OR into it. Accumulates in a local and
     * writes `this.value` once for monomorphic-friendly init.
     * WARNING: Intended for initialization / deserialization, not hot paths.
     */
    fromArray(bits) {
        let v = 0;
        for (let i = 0; i < bits.length; i++) {
            v |= (1 << bits[i]);
        }
        this.value = v >>> 0;
        return this;
    }
}

// -- BitMapper: names <-> bit indices (constructor is cold; get/bit/size are hot-safe) --
export class BitMapper {
    constructor(names = []) {
        if (names.length > 32) throw new Error('BitMapper: Maximum 32 flags supported.');

        this._map = new Map();
        this._reverse = new Array(32); // O(1) array lookup

        names.forEach((name, index) => {
            this._map.set(name, index);
            this._reverse[index] = name;
        });
    }

    get(name) {
        const bit = this._map.get(name);
        if (bit === undefined) throw new Error(`BitMapper: Unknown flag "${name}"`);
        return bit;
    }

    getMask(names) {
        let mask = 0;
        for (let i = 0; i < names.length; i++) mask |= (1 << this.get(names[i]));
        return mask >>> 0;
    }

    getActiveNames(FastBit32Instance) {
        const active = [];
        for (const [name, bit] of this._map.entries()) {
            if (FastBit32Instance.has(bit)) active.push(name);
        }
        return active;
    }

    /**
     * O(1) Reverse lookup. Integer -> String.
     */
    getName(bit) {
        return this._reverse[bit];
    }

    /**
     * One-bit mask for a name: `1 << get(name)` (signed int32; bit 31 gives
     * -2147483648). Throws on an unknown name, through get().
     */
    bit(name) {
        return 1 << this.get(name);
    }

    /**
     * Number of registered names.
     */
    get size() {
        return this._map.size;
    }
}

// -- O(k) Iteration Helpers --

export function forEachArray(mask, array, callback) {
    let v = mask.value;
    while (v !== 0) {
        const bit = 31 - Math.clz32(v & -v);
        callback(array[bit], bit);
        v &= v - 1;
    }
}

export function forEachObject(mask, keys, obj, callback) {
    let v = mask.value;
    while (v !== 0) {
        const bit = 31 - Math.clz32(v & -v);
        const key = keys[bit];
        callback(obj[key], key, bit);
        v &= v - 1;
    }
}

export function forEachMapped(mask, mapper, callback) {
    let v = mask.value;
    while (v !== 0) {
        const bit = 31 - Math.clz32(v & -v);
        callback(mapper.getName(bit), bit);
        v &= v - 1;
    }
}

export function forEachMappedObject(mask, mapper, obj, callback) {
    let v = mask.value;
    while (v !== 0) {
        const bit = 31 - Math.clz32(v & -v);
        const key = mapper.getName(bit);
        callback(obj[key], key, bit);
        v &= v - 1;
    }
}

export function forEachMaskPair(maskA, maskB, callback) {
    let v = maskA.value & maskB.value;
    while (v !== 0) {
        const bit = 31 - Math.clz32(v & -v);
        callback(bit);
        v &= v - 1;
    }
}

export function forEachMaskDiff(maskA, maskB, callback) {
    let v = maskA.value & ~maskB.value;
    while (v !== 0) {
        const bit = 31 - Math.clz32(v & -v);
        callback(bit);
        v &= v - 1;
    }
}

export function forEachMaskUnion(maskA, maskB, callback) {
    let v = maskA.value | maskB.value;
    while (v !== 0) {
        const bit = 31 - Math.clz32(v & -v);
        callback(bit);
        v &= v - 1;
    }
}
// -- FastBit1024 --
// A fixed 32 x 32 two-level bitmap: 1024 bits (or fewer, `capacity` 1..1024),
// for slot pools and dense id sets. No import or runtime coupling to FastBit32.
// Unlike FastBit32 (whose hot ops trust the caller; SC-3 is open, decided in
// S6), every FastBit1024 method that takes an index FAILS CLOSED (SC-5): a bad
// index throws RangeError (a Symbol/BigInt throws TypeError on `&`) and writes
// nothing; the argument's own conversion runs once, before the throw. Every op
// is loop-free except forEach/hasAll/hasAny/clear (O(non-empty words)).
//
// State lives in underscore fields (_cap, _active, _full, _n, _data): they are
// internal, and writing them voids the invariants below.
// Invariants (every mutator keeps all four, so no reader repairs anything):
//   I1  _active bit w set  iff  _data[w] !== 0    (lowest/highest/nextSetBit/forEach)
//   I2  _full   bit w set  iff  _data[w] === -1   (nextClearBit/acquire)
//   I3  _n === popcount of every _data word        (size/isFull are O(1))
//   I4  no bit >= capacity is ever stored          (mutators reject it)
// Storage is Int32Array, so every word read is a signed int32 and every bitwise
// compare is to 0 (law 8). `clz32(x) >>> 5` is 1 iff x === 0: the summary
// updates are branch-free and never leave int32.

function fb1024Show(v) {
    return typeof v === 'number' ? String(v) : typeof v;
}

function fb1024BadOther(other) {
    throw new TypeError('FastBit1024: expected a FastBit1024, got ' + (other === null ? 'null' : typeof other));
}

function fb1024BadIndex(bit, limit) {
    throw new RangeError('FastBit1024: bit index must be an integer 0..' + (limit - 1) + ', got ' + fb1024Show(bit));
}

export class FastBit1024 {
    constructor(capacity = 1024) {
        if (typeof capacity !== 'number' || (capacity & 2047) !== capacity || capacity < 1 || capacity > 1024) {
            throw new RangeError('FastBit1024: capacity must be an integer 1..1024, got ' + fb1024Show(capacity));
        }
        this._cap = capacity;
        this._active = 0;
        this._full = 0;
        this._n = 0;
        this._data = new Int32Array(32);
    }

    add(bit) {
        if ((bit & 1023) !== bit || bit >= this._cap) fb1024BadIndex(bit, this._cap);
        const w = bit >>> 5, b = bit & 31, data = this._data, old = data[w], d = old | (1 << b);
        data[w] = d;
        this._n += ((old >>> b) & 1) ^ 1;
        this._active |= 1 << w;
        this._full |= (Math.clz32(~d) >>> 5) << w;
        return this;
    }

    remove(bit) {
        if ((bit & 1023) !== bit || bit >= this._cap) fb1024BadIndex(bit, this._cap);
        const w = bit >>> 5, b = bit & 31, data = this._data, old = data[w], d = old & ~(1 << b);
        data[w] = d;
        this._n -= (old >>> b) & 1;
        this._full &= ~(1 << w);
        this._active &= ~((Math.clz32(d) >>> 5) << w);
        return this;
    }

    toggle(bit) {
        if ((bit & 1023) !== bit || bit >= this._cap) fb1024BadIndex(bit, this._cap);
        return ((this._data[bit >>> 5] >>> (bit & 31)) & 1) === 0 ? this.add(bit) : this.remove(bit);
    }

    has(bit) {
        if ((bit & 1023) !== bit || bit >= this._cap) fb1024BadIndex(bit, this._cap);
        return (this._data[bit >>> 5] & (1 << (bit & 31))) !== 0;
    }

    /**
     * O(1) pool take: the LOWEST free slot, now held; -1 when full. The scan is
     * inlined (one word read reused for the write): ~3.0-3.2 ns per
     * acquire+release pair vs ~4.9 ns when it called nextClearBit() with the
     * same zero test (5.4 ns for the original draft; RESEARCH 13).
     */
    acquire() {
        const f = ~this._full;
        if (f === 0) return -1;
        const w = 31 - Math.clz32(f & -f), data = this._data, old = data[w], c = ~old, m = c & -c;
        const s = (w << 5) + (31 - Math.clz32(m));
        if (s >= this._cap) return -1;
        const d = old | m;
        data[w] = d;
        this._n++;
        this._active |= 1 << w;
        this._full |= (Math.clz32(~d) >>> 5) << w;
        return s;
    }

    /** O(1) pool give-back. Throws RangeError on a bad index AND on a slot that is not held. */
    release(slot) {
        if ((slot & 1023) !== slot || slot >= this._cap) fb1024BadIndex(slot, this._cap);
        const w = slot >>> 5, m = 1 << (slot & 31), data = this._data, old = data[w];
        if ((old & m) === 0) throw new RangeError('FastBit1024: release of a free slot ' + slot);
        const d = old & ~m;
        data[w] = d;
        this._n--;
        this._full &= ~(1 << w);
        this._active &= ~((Math.clz32(d) >>> 5) << w);
        return this;
    }

    get size() { return this._n; }

    get capacity() { return this._cap; }

    isEmpty() { return this._active === 0; }

    isFull() { return this._n === this._cap; }

    lowest() {
        const a = this._active;
        if (a === 0) return -1;
        const w = 31 - Math.clz32(a & -a), d = this._data[w];
        return (w << 5) + (31 - Math.clz32(d & -d));
    }

    highest() {
        const a = this._active;
        if (a === 0) return -1;
        const w = 31 - Math.clz32(a), d = this._data[w];
        return (w << 5) + (31 - Math.clz32(d));
    }

    /** Lowest clear bit below capacity, or -1. I4: "lowest clear >= capacity" means none. */
    nextClearBit() {
        const f = ~this._full;
        if (f === 0) return -1;
        const w = 31 - Math.clz32(f & -f), c = ~this._data[w];
        const s = (w << 5) + (31 - Math.clz32(c & -c));
        return s < this._cap ? s : -1;
    }

    /**
     * Lowest set bit >= from, or -1. Domain: from in 0..capacity (capacity
     * returns -1, so `nextSetBit(b + 1)` ends the walk); anything else throws.
     * `(w - 32) >> 31` zeroes the word mask at w = 32 (from = 1024).
     */
    nextSetBit(from) {
        if ((from & 2047) !== from || from > this._cap) fb1024BadIndex(from, this._cap + 1);
        const w = from >>> 5;
        const d = w < 32 ? this._data[w] & (-1 << (from & 31)) : 0;
        if (d !== 0) return (w << 5) + (31 - Math.clz32(d & -d));
        const a = this._active & (-2 << w) & ((w - 32) >> 31);
        if (a === 0) return -1;
        const w2 = 31 - Math.clz32(a & -a), d2 = this._data[w2];
        return (w2 << 5) + (31 - Math.clz32(d2 & -d2));
    }

    /**
     * Every bit of `other` (a FastBit1024) is set here. O(non-empty words of
     * other). Capacities may differ: words above a capacity are always 0.
     * Anything that is not a FastBit1024 throws TypeError.
     */
    hasAll(other) {
        if (!(other instanceof FastBit1024)) fb1024BadOther(other);
        if ((other._active & ~this._active) !== 0) return false;
        const od = other._data, td = this._data;
        for (let a = other._active; a !== 0; a &= a - 1) {
            const w = 31 - Math.clz32(a & -a);
            if ((od[w] & ~td[w]) !== 0) return false;
        }
        return true;
    }

    /** Some bit of `other` (a FastBit1024) is set here. Capacities may differ. */
    hasAny(other) {
        if (!(other instanceof FastBit1024)) fb1024BadOther(other);
        const od = other._data, td = this._data;
        for (let a = other._active & this._active; a !== 0; a &= a - 1) {
            const w = 31 - Math.clz32(a & -a);
            if ((od[w] & td[w]) !== 0) return true;
        }
        return false;
    }

    /**
     * O(k + non-empty words), ascending. Hoist the callback: a capturing closure
     * allocates. Each word is read once, as a snapshot: a callback that removes
     * a later bit of the same word is still called for it. To mutate during the
     * walk, use the nextSetBit cursor.
     */
    forEach(callback) {
        const data = this._data;
        for (let a = this._active; a !== 0; a &= a - 1) {
            const w = 31 - Math.clz32(a & -a), base = w << 5;
            for (let d = data[w]; d !== 0; d &= d - 1) callback(base + (31 - Math.clz32(d & -d)));
        }
        return this;
    }

    /** O(non-empty words), not a 32-word fill. */
    clear() {
        const data = this._data;
        for (let a = this._active; a !== 0; a &= a - 1) data[31 - Math.clz32(a & -a)] = 0;
        this._active = 0;
        this._full = 0;
        this._n = 0;
        return this;
    }
}
