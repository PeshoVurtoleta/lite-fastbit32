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
 */

export const VERSION = '1.3.0';

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