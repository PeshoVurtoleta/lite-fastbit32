import { describe, it, expect } from 'vitest';
import { FastBit32, BitMapper } from '../FastBit32.js';

// ═══════════════════════════════════════════════════════════════
//  BITMAPPER (Human-to-Hardware Bridge)
// ═══════════════════════════════════════════════════════════════

describe('BitMapper — string to bit resolution', () => {
    it('maps string names to correct bit indices', () => {
        const mapper = new BitMapper(['Transform', 'Velocity', 'Renderable']);
        expect(mapper.get('Transform')).toBe(0);
        expect(mapper.get('Velocity')).toBe(1);
        expect(mapper.get('Renderable')).toBe(2);
    });

    it('throws an error if initializing with more than 32 flags', () => {
        // Create an array of 33 items
        const tooMany = Array.from({ length: 33 }, (_, i) => `Flag${i}`);
        expect(() => new BitMapper(tooMany)).toThrow(/Maximum 32 flags/);
    });

    it('throws an error when requesting an unregistered flag', () => {
        const mapper = new BitMapper(['Position']);
        expect(() => mapper.get('Health')).toThrow(/Unknown flag "Health"/);
    });

    it('generates correct 32-bit integer masks from string arrays', () => {
        const mapper = new BitMapper(['Position', 'Velocity', 'Health', 'Magic']);

        // Position (bit 0 = 1) + Health (bit 2 = 4) = 5
        const mask = mapper.getMask(['Position', 'Health']);
        expect(mask).toBe(5);

        // All bits
        const fullMask = mapper.getMask(['Position', 'Velocity', 'Health', 'Magic']);
        expect(fullMask).toBe(15); // 1 + 2 + 4 + 8
    });

    it('returns 0 when generating a mask for an empty array', () => {
        const mapper = new BitMapper(['Position', 'Velocity']);
        expect(mapper.getMask([])).toBe(0);
    });

    it('extracts active string names from a FastBit32 instance', () => {
        const mapper = new BitMapper(['Physics', 'Render', 'AI', 'Input']);
        const entityMask = new FastBit32();

        // Simulate activating Physics (0) and Input (3)
        entityMask.add(mapper.get('Physics')).add(mapper.get('Input'));

        const activeNames = mapper.getActiveNames(entityMask);

        expect(activeNames.length).toBe(2);
        expect(activeNames).toContain('Physics');
        expect(activeNames).toContain('Input');
        expect(activeNames).not.toContain('Render');
    });
});

// ═══════════════════════════════════════════════════════════════
//  O(k) ITERATORS & REVERSE LOOKUPS
// ═══════════════════════════════════════════════════════════════

import {
    forEachArray, forEachObject, forEachMapped,
    forEachMappedObject, forEachMaskPair, forEachMaskDiff, forEachMaskUnion
} from '../FastBit32.d.ts'; // Adjust import path if necessary

describe('FastBit32 — O(k) Iterators', () => {
    it('forEach iterates exactly k times', () => {
        const mask = new FastBit32().add(2).add(10).add(31);
        const bits = [];
        mask.forEach(bit => bits.push(bit));

        expect(bits).toHaveLength(3);
        expect(bits).toEqual([2, 10, 31]);
    });

    it('BitMapper.getName performs reverse O(1) lookup', () => {
        const mapper = new BitMapper(['Transform', 'Velocity']);
        expect(mapper.getName(0)).toBe('Transform');
        expect(mapper.getName(1)).toBe('Velocity');
        expect(mapper.getName(10)).toBeUndefined();
    });

    it('forEachArray maps active bits to array indices', () => {
        const mask = new FastBit32().add(0).add(2);
        const data = ['Zero', 'One', 'Two', 'Three'];

        const results = [];
        forEachArray(mask, data, (item, bit) => results.push({ item, bit }));

        expect(results).toEqual([
            { item: 'Zero', bit: 0 },
            { item: 'Two', bit: 2 }
        ]);
    });

    it('forEachObject maps bits to keys array to object values', () => {
        const mask = new FastBit32().add(1).add(3);
        const keys = ['hp', 'mp', 'str', 'agi'];
        const stats = { hp: 100, mp: 50, str: 20, agi: 15 };

        const results = [];
        forEachObject(mask, keys, stats, (val, key, bit) => results.push({ val, key, bit }));

        expect(results).toEqual([
            { val: 50, key: 'mp', bit: 1 },
            { val: 15, key: 'agi', bit: 3 }
        ]);
    });

    it('forEachMapped iterates string names', () => {
        const mapper = new BitMapper(['Idle', 'Run', 'Jump', 'Attack']);
        const mask = new FastBit32().add(1).add(3); // Run, Attack

        const states = [];
        forEachMapped(mask, mapper, (name, bit) => states.push({name, bit}));

        expect(states).toEqual([
            { name: 'Run', bit: 1 },
            { name: 'Attack', bit: 3 }
        ]);
    });

    it('forEachMappedObject connects mask directly to object values via BitMapper', () => {
        const mapper = new BitMapper(['Physics', 'Render']);
        const mask = new FastBit32().add(0); // Only Physics active
        const systems = { Physics: 'SystemA', Render: 'SystemB' };

        const results = [];
        forEachMappedObject(mask, mapper, systems, (val, key, bit) => results.push({ val, key, bit }));

        expect(results).toEqual([
            { val: 'SystemA', key: 'Physics', bit: 0 }
        ]);
    });

    it('forEachMaskPair isolates intersecting bits (A & B)', () => {
        const m1 = new FastBit32().add(1).add(5).add(9);
        const m2 = new FastBit32().add(1).add(9).add(15);

        const hits = [];
        forEachMaskPair(m1, m2, b => hits.push(b));
        expect(hits).toEqual([1, 9]);
    });

    it('forEachMaskDiff isolates unique bits (A - B)', () => {
        const m1 = new FastBit32().add(1).add(5).add(9);
        const m2 = new FastBit32().add(1).add(9).add(15);

        const hits = [];
        // What is in m1 that is NOT in m2? -> 5
        forEachMaskDiff(m1, m2, b => hits.push(b));
        expect(hits).toEqual([5]);
    });

    it('forEachMaskUnion isolates all active bits (A | B)', () => {
        const m1 = new FastBit32().add(1).add(5);
        const m2 = new FastBit32().add(5).add(10);

        const hits = [];
        forEachMaskUnion(m1, m2, b => hits.push(b));
        expect(hits).toEqual([1, 5, 10]);
    });
});

// ═══════════════════════════════════════════════════════════════
//  v1.2.0 AAA ENGINE PRIMITIVES
// ═══════════════════════════════════════════════════════════════

describe('FastBit32 — v1.2.0 engine primitives', () => {
    describe('nextClearBit — lowest 0 bit', () => {
        it('returns 0 on an empty mask', () => {
            expect(new FastBit32().nextClearBit()).toBe(0);
        });

        it('finds the first free slot in a partially-filled mask', () => {
            const mask = new FastBit32().add(0).add(1).add(3);
            expect(mask.nextClearBit()).toBe(2);
        });

        it('returns -1 when all 32 bits are active', () => {
            // Constructor coerces -1 to 0xFFFFFFFF via >>> 0
            expect(new FastBit32(-1).nextClearBit()).toBe(-1);
        });

        it('locates a single clear bit at position 31', () => {
            // All bits set except bit 31 => 0x7FFFFFFF
            const mask = new FastBit32(0x7FFFFFFF);
            expect(mask.nextClearBit()).toBe(31);
        });

        it('locates a single clear bit at position 0 when others are full', () => {
            // All bits set except bit 0 => 0xFFFFFFFE
            const mask = new FastBit32(0xFFFFFFFE);
            expect(mask.nextClearBit()).toBe(0);
        });
    });

    describe('highestClearBit — highest 0 bit', () => {
        it('returns 31 on an empty mask', () => {
            expect(new FastBit32().highestClearBit()).toBe(31);
        });

        it('finds the highest free slot when bit 31 is clear', () => {
            const mask = new FastBit32(0x7FFFFFFF);
            expect(mask.highestClearBit()).toBe(31);
        });

        it('returns -1 when all bits are active', () => {
            expect(new FastBit32(-1).highestClearBit()).toBe(-1);
        });

        it('finds the highest clear bit in a mostly-full low region', () => {
            // Bits 0..30 set, bit 31 clear  => highest clear = 31
            // then clear bit 15 too => highest clear still = 31
            const mask = new FastBit32(0x7FFFFFFF).remove(15);
            expect(mask.highestClearBit()).toBe(31);
        });
    });

    describe('isFull — all 32 bits active', () => {
        it('returns false on an empty mask', () => {
            expect(new FastBit32().isFull()).toBe(false);
        });

        it('returns true when every bit is set via add()', () => {
            const mask = new FastBit32();
            for (let i = 0; i < 32; i++) mask.add(i);
            expect(mask.isFull()).toBe(true);
        });

        it('returns true when constructed from 0xFFFFFFFF', () => {
            expect(new FastBit32(0xFFFFFFFF).isFull()).toBe(true);
        });

        it('returns true when the signed representation is -1', () => {
            // Regression guard: `=== 0xFFFFFFFF` would be a bug because
            // JS bitwise ops yield signed int32, so a fully-set mask reads
            // as -1, not 4294967295.
            const mask = new FastBit32(-1);
            expect(mask.value === -1 || mask.value === 0xFFFFFFFF).toBe(true);
            expect(mask.isFull()).toBe(true);
        });

        it('returns false when any single bit is clear', () => {
            const mask = new FastBit32(-1).remove(15);
            expect(mask.isFull()).toBe(false);
        });
    });

    describe('countRange — popcount over a region', () => {
        it('counts bits within a narrow range', () => {
            const mask = new FastBit32().add(0).add(2).add(5).add(7);
            expect(mask.countRange(2, 5)).toBe(2); // bits 2 and 5
        });

        it('counts single-bit ranges correctly', () => {
            const mask = new FastBit32().add(10);
            expect(mask.countRange(10, 10)).toBe(1);
            expect(mask.countRange(9, 9)).toBe(0);
            expect(mask.countRange(11, 11)).toBe(0);
        });

        it('matches count() when called over the full [0, 31] range', () => {
            const mask = new FastBit32().add(0).add(15).add(31);
            expect(mask.countRange(0, 31)).toBe(mask.count());
        });

        it('returns 32 for a full mask over [0, 31]', () => {
            expect(new FastBit32(-1).countRange(0, 31)).toBe(32);
        });

        it('returns 0 for a cleared range', () => {
            const mask = new FastBit32().add(0).add(31);
            expect(mask.countRange(5, 20)).toBe(0);
        });

        it('includes bit 31 correctly in ranges touching the sign bit', () => {
            const mask = new FastBit32().add(30).add(31);
            expect(mask.countRange(28, 31)).toBe(2);
        });
    });

    describe('toBinaryString — debug representation', () => {
        it('returns a zero-padded 32-char string by default', () => {
            const str = new FastBit32().add(0).toBinaryString();
            expect(str).toHaveLength(32);
            expect(str).toBe('00000000000000000000000000000001');
        });

        it('respects padded=false', () => {
            expect(new FastBit32().add(0).toBinaryString(false)).toBe('1');
        });

        it('prints the sign bit as a leading 1 (no minus sign)', () => {
            // Regression guard: naive `this.value.toString(2)` on a signed
            // -2147483648 would yield "-10000...0000".
            const str = new FastBit32().add(31).toBinaryString();
            expect(str[0]).toBe('1');
            expect(str).not.toContain('-');
            expect(str).toBe('10000000000000000000000000000000');
        });

        it('prints all-bits-set as 32 ones', () => {
            expect(new FastBit32(-1).toBinaryString()).toBe('11111111111111111111111111111111');
        });
    });

    describe('toArray — bit indexes as array', () => {
        it('returns [] on an empty mask', () => {
            expect(new FastBit32().toArray()).toEqual([]);
        });

        it('returns active bits in ascending order', () => {
            const mask = new FastBit32().add(3).add(0).add(31).add(15);
            expect(mask.toArray()).toEqual([0, 3, 15, 31]);
        });

        it('handles the sign bit correctly', () => {
            expect(new FastBit32().add(31).toArray()).toEqual([31]);
        });
    });

    describe('fromArray — populate from indexes (REPLACES value)', () => {
        it('populates an empty mask from an index array', () => {
            const mask = new FastBit32().fromArray([0, 5, 31]);
            expect(mask.has(0)).toBe(true);
            expect(mask.has(5)).toBe(true);
            expect(mask.has(31)).toBe(true);
            expect(mask.count()).toBe(3);
        });

        it('overwrites existing bits — does NOT OR into them', () => {
            const mask = new FastBit32().add(10).add(20);
            mask.fromArray([1, 2]);
            expect(mask.toArray()).toEqual([1, 2]);
            expect(mask.has(10)).toBe(false);
            expect(mask.has(20)).toBe(false);
        });

        it('clears the mask when given an empty array', () => {
            const mask = new FastBit32().add(5).fromArray([]);
            expect(mask.isEmpty()).toBe(true);
        });

        it('round-trips cleanly with toArray', () => {
            const original = new FastBit32().add(2).add(7).add(19).add(31);
            const arr = original.toArray();
            const restored = new FastBit32().fromArray(arr);
            expect(restored.value >>> 0).toBe(original.value >>> 0);
        });

        it('stores an unsigned 32-bit value after population', () => {
            // Writing `this.value = v >>> 0` ensures canonical unsigned form
            const mask = new FastBit32().fromArray([31]);
            expect(mask.value >>> 0).toBe(0x80000000);
        });

        it('returns this for chaining', () => {
            const mask = new FastBit32();
            expect(mask.fromArray([1])).toBe(mask);
        });
    });
});