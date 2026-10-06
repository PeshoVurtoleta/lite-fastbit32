// test/FastBit32.test.mjs -- node:test port of the v1.2.0 engine-primitive suite.
// 33 cases: nextClearBit, highestClearBit, isFull, countRange, toBinaryString,
// toArray, fromArray. Behaviour pinned as-is (S0, no behaviour change).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FastBit32 } from '../FastBit32.js';

describe('FastBit32 -- v1.2.0 engine primitives', () => {
    describe('nextClearBit -- lowest 0 bit', () => {
        it('returns 0 on an empty mask', () => {
            assert.strictEqual(new FastBit32().nextClearBit(), 0);
        });

        it('finds the first free slot in a partially-filled mask', () => {
            const mask = new FastBit32().add(0).add(1).add(3);
            assert.strictEqual(mask.nextClearBit(), 2);
        });

        it('returns -1 when all 32 bits are active', () => {
            // Constructor coerces -1 to 0xFFFFFFFF via >>> 0
            assert.strictEqual(new FastBit32(-1).nextClearBit(), -1);
        });

        it('locates a single clear bit at position 31', () => {
            // All bits set except bit 31 => 0x7FFFFFFF
            const mask = new FastBit32(0x7FFFFFFF);
            assert.strictEqual(mask.nextClearBit(), 31);
        });

        it('locates a single clear bit at position 0 when others are full', () => {
            // All bits set except bit 0 => 0xFFFFFFFE
            const mask = new FastBit32(0xFFFFFFFE);
            assert.strictEqual(mask.nextClearBit(), 0);
        });
    });

    describe('highestClearBit -- highest 0 bit', () => {
        it('returns 31 on an empty mask', () => {
            assert.strictEqual(new FastBit32().highestClearBit(), 31);
        });

        it('finds the highest free slot when bit 31 is clear', () => {
            const mask = new FastBit32(0x7FFFFFFF);
            assert.strictEqual(mask.highestClearBit(), 31);
        });

        it('returns -1 when all bits are active', () => {
            assert.strictEqual(new FastBit32(-1).highestClearBit(), -1);
        });

        it('finds the highest clear bit in a mostly-full low region', () => {
            // Bits 0..30 set, bit 31 clear => highest clear = 31
            const mask = new FastBit32(0x7FFFFFFF).remove(15);
            assert.strictEqual(mask.highestClearBit(), 31);
        });
    });

    describe('isFull -- all 32 bits active', () => {
        it('returns false on an empty mask', () => {
            assert.strictEqual(new FastBit32().isFull(), false);
        });

        it('returns true when every bit is set via add()', () => {
            const mask = new FastBit32();
            for (let i = 0; i < 32; i++) mask.add(i);
            assert.strictEqual(mask.isFull(), true);
        });

        it('returns true when constructed from 0xFFFFFFFF', () => {
            assert.strictEqual(new FastBit32(0xFFFFFFFF).isFull(), true);
        });

        it('returns true when the signed representation is -1', () => {
            // Regression guard: `=== 0xFFFFFFFF` would be a bug because
            // JS bitwise ops yield signed int32, so a fully-set mask reads
            // as -1, not 4294967295.
            const mask = new FastBit32(-1);
            assert.ok(mask.value === -1 || mask.value === 0xFFFFFFFF);
            assert.strictEqual(mask.isFull(), true);
        });

        it('returns false when any single bit is clear', () => {
            const mask = new FastBit32(-1).remove(15);
            assert.strictEqual(mask.isFull(), false);
        });
    });

    describe('countRange -- popcount over a region', () => {
        it('counts bits within a narrow range', () => {
            const mask = new FastBit32().add(0).add(2).add(5).add(7);
            assert.strictEqual(mask.countRange(2, 5), 2); // bits 2 and 5
        });

        it('counts single-bit ranges correctly', () => {
            const mask = new FastBit32().add(10);
            assert.strictEqual(mask.countRange(10, 10), 1);
            assert.strictEqual(mask.countRange(9, 9), 0);
            assert.strictEqual(mask.countRange(11, 11), 0);
        });

        it('matches count() when called over the full [0, 31] range', () => {
            const mask = new FastBit32().add(0).add(15).add(31);
            assert.strictEqual(mask.countRange(0, 31), mask.count());
        });

        it('returns 32 for a full mask over [0, 31]', () => {
            assert.strictEqual(new FastBit32(-1).countRange(0, 31), 32);
        });

        it('returns 0 for a cleared range', () => {
            const mask = new FastBit32().add(0).add(31);
            assert.strictEqual(mask.countRange(5, 20), 0);
        });

        it('includes bit 31 correctly in ranges touching the sign bit', () => {
            const mask = new FastBit32().add(30).add(31);
            assert.strictEqual(mask.countRange(28, 31), 2);
        });
    });

    describe('toBinaryString -- debug representation', () => {
        it('returns a zero-padded 32-char string by default', () => {
            const str = new FastBit32().add(0).toBinaryString();
            assert.strictEqual(str.length, 32);
            assert.strictEqual(str, '00000000000000000000000000000001');
        });

        it('respects padded=false', () => {
            assert.strictEqual(new FastBit32().add(0).toBinaryString(false), '1');
        });

        it('prints the sign bit as a leading 1 (no minus sign)', () => {
            // Regression guard: naive `this.value.toString(2)` on a signed
            // -2147483648 would yield "-10000...0000".
            const str = new FastBit32().add(31).toBinaryString();
            assert.strictEqual(str[0], '1');
            assert.ok(!str.includes('-'));
            assert.strictEqual(str, '10000000000000000000000000000000');
        });

        it('prints all-bits-set as 32 ones', () => {
            assert.strictEqual(new FastBit32(-1).toBinaryString(), '11111111111111111111111111111111');
        });
    });

    describe('toArray -- bit indexes as array', () => {
        it('returns [] on an empty mask', () => {
            assert.deepStrictEqual(new FastBit32().toArray(), []);
        });

        it('returns active bits in ascending order', () => {
            const mask = new FastBit32().add(3).add(0).add(31).add(15);
            assert.deepStrictEqual(mask.toArray(), [0, 3, 15, 31]);
        });

        it('handles the sign bit correctly', () => {
            assert.deepStrictEqual(new FastBit32().add(31).toArray(), [31]);
        });
    });

    describe('fromArray -- populate from indexes (REPLACES value)', () => {
        it('populates an empty mask from an index array', () => {
            const mask = new FastBit32().fromArray([0, 5, 31]);
            assert.strictEqual(mask.has(0), true);
            assert.strictEqual(mask.has(5), true);
            assert.strictEqual(mask.has(31), true);
            assert.strictEqual(mask.count(), 3);
        });

        it('overwrites existing bits -- does NOT OR into them', () => {
            const mask = new FastBit32().add(10).add(20);
            mask.fromArray([1, 2]);
            assert.deepStrictEqual(mask.toArray(), [1, 2]);
            assert.strictEqual(mask.has(10), false);
            assert.strictEqual(mask.has(20), false);
        });

        it('clears the mask when given an empty array', () => {
            const mask = new FastBit32().add(5).fromArray([]);
            assert.strictEqual(mask.isEmpty(), true);
        });

        it('round-trips cleanly with toArray', () => {
            const original = new FastBit32().add(2).add(7).add(19).add(31);
            const arr = original.toArray();
            const restored = new FastBit32().fromArray(arr);
            assert.strictEqual(restored.value >>> 0, original.value >>> 0);
        });

        it('stores an unsigned 32-bit value after population', () => {
            // Writing `this.value = v >>> 0` ensures canonical unsigned form
            const mask = new FastBit32().fromArray([31]);
            assert.strictEqual(mask.value >>> 0, 0x80000000);
        });

        it('returns this for chaining', () => {
            const mask = new FastBit32();
            assert.strictEqual(mask.fromArray([1]), mask);
        });
    });
});
