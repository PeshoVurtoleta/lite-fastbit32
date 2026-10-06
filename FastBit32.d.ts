/**
 * FastBit32 -- Zero-GC, Monomorphic 32-bit Flag Manager.
 *
 * Engineered for 60fps hot-path execution, ECS masking, and object pooling.
 * All operations are branchless bitwise ops on a single unsigned 32-bit integer.
 *
 * **Caveats:**
 * - JS bitwise shifts apply modulo 32 silently: `add(32)` == `add(0)`.
 * - Floats and negatives are truncated to unsigned 32-bit: `-1 >>> 0` -> `4294967295`.
 *
 * @example
 * ```js
 * import { FastBit32 } from '@zakkster/lite-fastbit32';
 *
 * const flags = new FastBit32();
 * flags.add(1).add(4);
 *
 * flags.has(4);    // true
 * flags.count();   // 2
 * flags.lowest();  // 1
 * ```
 */

/**
 * The package version string. Mirrors `package.json` and the llms.txt stamp.
 */
export const VERSION: string;

export class FastBit32 {
    /**
     * Creates a new FastBit32 instance.
     * The initial value is coerced to an unsigned 32-bit integer via `>>> 0`.
     *
     * @param initial - Starting bitmask value. Defaults to `0`.
     *
     * @example
     * ```js
     * new FastBit32();          // 0x00000000
     * new FastBit32(0xFF);      // bits 0-7 active
     * new FastBit32(-1);        // 0xFFFFFFFF -- all 32 bits active
     * ```
     */
    constructor(initial?: number);

    /**
     * The raw unsigned 32-bit integer bitmask.
     * Mutated in-place by all operations. Safe to read directly in hot paths.
     */
    value: number;

    // -- Single Bit Ops (Zero-Branching) --

    /**
     * Sets bit at the given position.
     * Bit index is applied modulo 32 by the JS engine.
     *
     * @param bit - Bit position (0-31).
     * @returns `this` for chaining.
     */
    add(bit: number): this;

    /**
     * Clears bit at the given position.
     *
     * @param bit - Bit position (0-31).
     * @returns `this` for chaining.
     */
    remove(bit: number): this;

    /**
     * Flips bit at the given position.
     *
     * @param bit - Bit position (0-31).
     * @returns `this` for chaining.
     */
    toggle(bit: number): this;

    /**
     * Tests whether bit at the given position is active.
     *
     * @param bit - Bit position (0-31).
     * @returns `true` if the bit is set.
     */
    has(bit: number): boolean;

    // -- Bulk Mask Ops --

    /**
     * Tests whether **all** bits in the mask are active.
     * Equivalent to `(value & mask) === mask`.
     *
     * @param mask - Bitmask to test against.
     */
    hasAll(mask: number): boolean;

    /**
     * Tests whether **any** bit in the mask is active.
     * Equivalent to `(value & mask) !== 0`.
     *
     * @param mask - Bitmask to test against.
     */
    hasAny(mask: number): boolean;

    /**
     * Tests whether **no** bits in the mask are active.
     * Equivalent to `(value & mask) === 0`.
     *
     * @param mask - Bitmask to test against.
     */
    hasNone(mask: number): boolean;

    // -- In-Place Mutations (Zero-GC Set Math) --

    /**
     * Resets all 32 bits to zero.
     *
     * @returns `this` for chaining.
     */
    clear(): this;

    /**
     * Sets all bits present in the mask (bitwise OR).
     *
     * @param mask - Bits to add.
     * @returns `this` for chaining.
     */
    union(mask: number): this;

    /**
     * Clears all bits present in the mask (bitwise AND NOT).
     *
     * @param mask - Bits to remove.
     * @returns `this` for chaining.
     */
    difference(mask: number): this;

    /**
     * Keeps only bits present in both the value and the mask (bitwise AND).
     *
     * @param mask - Bits to keep.
     * @returns `this` for chaining.
     */
    intersect(mask: number): this;

    // -- Advanced Engine Helpers --

    /**
     * Returns the number of active bits (Hamming weight / popcount).
     * Uses the Hacker's Delight O(1) parallel bit-count algorithm -- no loops.
     *
     * @returns Active bit count (0-32).
     */
    count(): number;

    /**
     * Returns the number of active bits within a masked region.
     * Equivalent to `(new FastBit32(value & mask)).count()` without allocation.
     *
     * @param mask - Region to count within.
     * @returns Active bit count within the masked region (0-32).
     */
    countMasked(mask: number): number;

    /**
     * Returns the index of the lowest (least significant) active bit.
     * Uses `Math.clz32` for O(1) bit-scan forward -- no loops.
     * Ideal for object pools: instantly finds the first available slot.
     *
     * @returns Bit index (0-31), or `-1` if empty.
     */
    lowest(): number;

    /**
     * Returns the index of the highest (most significant) active bit.
     * Uses `Math.clz32` for O(1) bit-scan reverse -- no loops.
     * Useful for determining active bounds of spatial grids.
     *
     * @returns Bit index (0-31), or `-1` if empty.
     */
    highest(): number;

    /**
     * Tests whether all 32 bits are zero.
     *
     * @returns `true` if value is `0`.
     */
    isEmpty(): boolean;

    /**
     * Creates an independent copy of this instance.
     * The clone has its own `value` -- mutations do not propagate.
     *
     * @returns A new `FastBit32` with the same value.
     */
    clone(): FastBit32;

    // -- Iteration --

    /**
     * O(k) iteration over active bits, where k is the number of set bits.
     * Visits each active bit index in ascending order.
     *
     * @param callback - Called with the bit index of each active bit.
     * @returns `this` for chaining.
     */
    forEach(callback: (bit: number) => void): this;

    // -- v1.2.0 AAA Engine Primitives --

    /**
     * Returns the index of the lowest INACTIVE (0) bit.
     * O(1) via `Math.clz32` on the inverted mask -- no loops, no scratch
     * `FastBit32` allocation. Ideal for object pools: instantly finds the
     * first free slot.
     *
     * @returns Bit index (0-31), or `-1` if all 32 bits are active.
     */
    nextClearBit(): number;

    /**
     * Returns the index of the highest INACTIVE (0) bit.
     * O(1) via `Math.clz32` on the inverted mask.
     *
     * @returns Bit index (0-31), or `-1` if all 32 bits are active.
     */
    highestClearBit(): number;

    /**
     * Tests whether all 32 bits are active.
     *
     * @returns `true` if the value has every bit set.
     */
    isFull(): boolean;

    /**
     * Returns the number of active bits within an inclusive range
     * `[start, end]`. Caller must guarantee `0 <= start <= end <= 31`.
     *
     * @param start - Lowest bit of the range (inclusive).
     * @param end - Highest bit of the range (inclusive).
     * @returns Active bit count within the range (0-32).
     */
    countRange(start: number, end: number): number;

    // -- Debug & Init Helpers (allocate -- NOT hot-path safe) --

    /**
     * Returns a 32-character binary string of the raw value, LSB on the right.
     * Forces unsigned representation so bit 31 prints as `1`, not a minus sign.
     *
     * WARNING: Allocates a String. Debug use only.
     *
     * @param padded - Pad to 32 chars with leading zeros. Defaults to `true`.
     */
    toBinaryString(padded?: boolean): string;

    /**
     * Returns an array of active bit indexes in ascending order.
     *
     * WARNING: Allocates an Array. Not safe for hot loops.
     *
     * @returns Array of bit indexes (0-31).
     */
    toArray(): number[];

    /**
     * Replaces the current value with a bitmask built from an array of bit
     * indexes. Overwrites -- does NOT OR into the existing value. Intended
     * for initialization and deserialization, not hot paths.
     *
     * @param bits - Array of bit indexes (0-31).
     * @returns `this` for chaining.
     */
    fromArray(bits: number[]): this;

    // -- Serialization --

    /**
     * Exports the raw unsigned 32-bit integer for storage.
     * Ideal for JSON, binary protocols, and ECS save states.
     *
     * @returns The raw `value`.
     */
    serialize(): number;

    /**
     * Creates a new `FastBit32` from a previously serialized integer.
     *
     * @param value - A raw unsigned 32-bit integer.
     * @returns A new `FastBit32` instance.
     */
    static deserialize(value: number): FastBit32;
}

/**
 * BitMapper -- The Human-to-Hardware Bridge.
 *
 * Translates semantic string names into 32-bit integer indices and raw masks.
 * Protects developers from raw integer math while keeping the engine hot-path fast.
 */
export class BitMapper {
    /**
     * Creates a new BitMapper dictionary.
     *
     * @param names - Array of component/flag names (Maximum 32).
     * @throws Error if more than 32 flags are provided.
     */
    constructor(names?: string[]);

    /**
     * Gets the raw bit index (0-31) for a specific flag name.
     *
     * @param name - The semantic string name of the flag.
     * @returns The integer bit index.
     * @throws Error if the flag name is not registered.
     */
    get(name: string): number;

    /**
     * Generates a raw 32-bit integer mask from an array of flag names.
     * Ideal for building System signatures in an ECS.
     *
     * @param names - Array of semantic flag names to combine into a mask.
     * @returns The generated unsigned 32-bit mask.
     */
    getMask(names: string[]): number;

    /**
     * Helper to extract which semantic strings are active inside a FastBit32 instance.
     * Excellent for console.log debugging.
     *
     * @param fastBit32Instance - The FastBit32 instance to evaluate.
     * @returns An array of active string names.
     */
    getActiveNames(fastBit32Instance: FastBit32): string[];

    /**
     * O(1) reverse lookup -- integer bit index to string name.
     *
     * @param bit - The bit index (0-31).
     * @returns The registered name, or `undefined` if no name is registered at that index.
     */
    getName(bit: number): string | undefined;
}

// -- O(k) Iteration Helpers --

/**
 * Iterates active bits in a mask, calling back with the corresponding array element.
 *
 * @param mask - FastBit32 instance whose active bits select array indices.
 * @param array - Data array indexed by bit position.
 * @param callback - Called with `(element, bitIndex)` for each active bit.
 */
export function forEachArray<T>(
    mask: FastBit32,
    array: T[],
    callback: (element: T, bit: number) => void
): void;

/**
 * Iterates active bits, mapping through a keys array to object properties.
 *
 * @param mask - FastBit32 instance whose active bits select key indices.
 * @param keys - Array of property keys indexed by bit position.
 * @param obj - Object to read values from.
 * @param callback - Called with `(value, key, bitIndex)` for each active bit.
 */
export function forEachObject<T>(
    mask: FastBit32,
    keys: string[],
    obj: Record<string, T>,
    callback: (value: T, key: string, bit: number) => void
): void;

/**
 * Iterates active bits, resolving each to a string name via a BitMapper.
 *
 * @param mask - FastBit32 instance.
 * @param mapper - BitMapper for reverse lookup.
 * @param callback - Called with `(name, bitIndex)` for each active bit.
 */
export function forEachMapped(
    mask: FastBit32,
    mapper: BitMapper,
    callback: (name: string, bit: number) => void
): void;

/**
 * Iterates active bits, resolving names via BitMapper and reading object values.
 *
 * @param mask - FastBit32 instance.
 * @param mapper - BitMapper for reverse lookup.
 * @param obj - Object to read values from.
 * @param callback - Called with `(value, key, bitIndex)` for each active bit.
 */
export function forEachMappedObject<T>(
    mask: FastBit32,
    mapper: BitMapper,
    obj: Record<string, T>,
    callback: (value: T, key: string, bit: number) => void
): void;

/**
 * Iterates bits that are active in BOTH masks (intersection / AND).
 *
 * @param maskA - First FastBit32 instance.
 * @param maskB - Second FastBit32 instance.
 * @param callback - Called with `(bitIndex)` for each shared active bit.
 */
export function forEachMaskPair(
    maskA: FastBit32,
    maskB: FastBit32,
    callback: (bit: number) => void
): void;

/**
 * Iterates bits active in A but not in B (difference / A AND NOT B).
 *
 * @param maskA - First FastBit32 instance.
 * @param maskB - Second FastBit32 instance.
 * @param callback - Called with `(bitIndex)` for each bit in A not in B.
 */
export function forEachMaskDiff(
    maskA: FastBit32,
    maskB: FastBit32,
    callback: (bit: number) => void
): void;

/**
 * Iterates bits active in either mask (union / OR).
 *
 * @param maskA - First FastBit32 instance.
 * @param maskB - Second FastBit32 instance.
 * @param callback - Called with `(bitIndex)` for each active bit in A or B.
 */
export function forEachMaskUnion(
    maskA: FastBit32,
    maskB: FastBit32,
    callback: (bit: number) => void
): void;