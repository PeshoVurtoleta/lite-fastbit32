// test/Iterators.test.mjs -- node:test port of forEach + the 7 free iteration
// helpers. FB-07 fix: imports run bodies from '../FastBit32.js' (the old file
// imported from the .d.ts, which has no bodies -> the 7 helpers were 7 failures).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    FastBit32, BitMapper,
    forEachArray, forEachObject, forEachMapped,
    forEachMappedObject, forEachMaskPair, forEachMaskDiff, forEachMaskUnion
} from '../FastBit32.js';

describe('FastBit32 -- O(k) iterators', () => {
    it('forEach iterates exactly k times', () => {
        const mask = new FastBit32().add(2).add(10).add(31);
        const bits = [];
        mask.forEach(bit => bits.push(bit));

        assert.strictEqual(bits.length, 3);
        assert.deepStrictEqual(bits, [2, 10, 31]);
    });

    it('forEachArray maps active bits to array indices', () => {
        const mask = new FastBit32().add(0).add(2);
        const data = ['Zero', 'One', 'Two', 'Three'];

        const results = [];
        forEachArray(mask, data, (item, bit) => results.push({ item, bit }));

        assert.deepStrictEqual(results, [
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

        assert.deepStrictEqual(results, [
            { val: 50, key: 'mp', bit: 1 },
            { val: 15, key: 'agi', bit: 3 }
        ]);
    });

    it('forEachMapped iterates string names', () => {
        const mapper = new BitMapper(['Idle', 'Run', 'Jump', 'Attack']);
        const mask = new FastBit32().add(1).add(3); // Run, Attack

        const states = [];
        forEachMapped(mask, mapper, (name, bit) => states.push({ name, bit }));

        assert.deepStrictEqual(states, [
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

        assert.deepStrictEqual(results, [
            { val: 'SystemA', key: 'Physics', bit: 0 }
        ]);
    });

    it('forEachMaskPair isolates intersecting bits (A & B)', () => {
        const m1 = new FastBit32().add(1).add(5).add(9);
        const m2 = new FastBit32().add(1).add(9).add(15);

        const hits = [];
        forEachMaskPair(m1, m2, b => hits.push(b));
        assert.deepStrictEqual(hits, [1, 9]);
    });

    it('forEachMaskDiff isolates unique bits (A - B)', () => {
        const m1 = new FastBit32().add(1).add(5).add(9);
        const m2 = new FastBit32().add(1).add(9).add(15);

        const hits = [];
        // What is in m1 that is NOT in m2? -> 5
        forEachMaskDiff(m1, m2, b => hits.push(b));
        assert.deepStrictEqual(hits, [5]);
    });

    it('forEachMaskUnion isolates all active bits (A | B)', () => {
        const m1 = new FastBit32().add(1).add(5);
        const m2 = new FastBit32().add(5).add(10);

        const hits = [];
        forEachMaskUnion(m1, m2, b => hits.push(b));
        assert.deepStrictEqual(hits, [1, 5, 10]);
    });
});
