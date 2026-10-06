/**
 * FastBit32 -- Zero-GC, Monomorphic 32-bit Flag Manager
 * Engineered for 60fps hot-path execution, ECS masking, and object pooling.
 * * WARNING: ENGINE PRIMITIVE CAVEATS:
 * - SILENT WRAPAROUND: JS bitwise shifts implicitly apply modulo 32.
 * Calling `add(32)` evaluates as `add(0)`. `add(40)` evaluates as `add(8)`.
 * - TRUNCATION: Floats and negative numbers are silently truncated and
 * converted to unsigned 32-bit integers (e.g., `-1 >>> 0` becomes `4294967295`).
 * Sanitize your inputs upstream if your domain logic requires strict bounds!
 */

export const VERSION = '1.2.0';

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
        return (this.value & mask) === mask;
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
        if (this.value === 0) return -1;
        // Isolate lowest set bit, then use native Count Leading Zeros to find index
        return Math.clz32(this.value & -this.value) ^ 31;
    }

    /**
     * Instantly finds the index of the highest active bit.
     * Useful for determining the bounds of active arrays/spatial grids.
     * Returns -1 if empty.
     */
    highest() {
        if (this.value === 0) return -1;
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
            const bit = Math.clz32(v & -v) ^ 31;
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
        const inv = ~this.value >>> 0;
        if (inv === 0) return -1;
        return Math.clz32(inv & -inv) ^ 31;
    }

    /**
     * O(1) loop-free bit-scan reverse for the highest INACTIVE (0) bit.
     * Returns -1 if all 32 bits are active.
     */
    highestClearBit() {
        const inv = ~this.value >>> 0;
        if (inv === 0) return -1;
        return 31 - Math.clz32(inv);
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
            result.push(Math.clz32(v & -v) ^ 31);
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
}

// -- O(k) Iteration Helpers --

export function forEachArray(mask, array, callback) {
    let v = mask.value;
    while (v !== 0) {
        const bit = Math.clz32(v & -v) ^ 31;
        callback(array[bit], bit);
        v &= v - 1;
    }
}

export function forEachObject(mask, keys, obj, callback) {
    let v = mask.value;
    while (v !== 0) {
        const bit = Math.clz32(v & -v) ^ 31;
        const key = keys[bit];
        callback(obj[key], key, bit);
        v &= v - 1;
    }
}

export function forEachMapped(mask, mapper, callback) {
    let v = mask.value;
    while (v !== 0) {
        const bit = Math.clz32(v & -v) ^ 31;
        callback(mapper.getName(bit), bit);
        v &= v - 1;
    }
}

export function forEachMappedObject(mask, mapper, obj, callback) {
    let v = mask.value;
    while (v !== 0) {
        const bit = Math.clz32(v & -v) ^ 31;
        const key = mapper.getName(bit);
        callback(obj[key], key, bit);
        v &= v - 1;
    }
}

export function forEachMaskPair(maskA, maskB, callback) {
    let v = (maskA.value & maskB.value) >>> 0;
    while (v !== 0) {
        const bit = Math.clz32(v & -v) ^ 31;
        callback(bit);
        v &= v - 1;
    }
}

export function forEachMaskDiff(maskA, maskB, callback) {
    let v = (maskA.value & ~maskB.value) >>> 0;
    while (v !== 0) {
        const bit = Math.clz32(v & -v) ^ 31;
        callback(bit);
        v &= v - 1;
    }
}

export function forEachMaskUnion(maskA, maskB, callback) {
    let v = (maskA.value | maskB.value) >>> 0;
    while (v !== 0) {
        const bit = Math.clz32(v & -v) ^ 31;
        callback(bit);
        v &= v - 1;
    }
}