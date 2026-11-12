// test/AF2Pins.test.mjs -- AF-2 (audit 1.7 U-1, ruling Q1 2026-11-10): CHARACTERIZATION pins of today's
// outcomes when a FastBit32 mask method, equals / copy / fromArray or a free iterator gets a set OBJECT (or
// undefined) instead of a number mask / a FastBit32. These rows pin what the code DOES today, not what it
// should do: FastBit32's hot ops trust the caller (SC-3, OPEN, decided in S6). A row that turns red after an
// S6 / SC-3 change is re-pinned with that change, never widened.
// Source of every table: the U-1 golden census on the frozen build bb4e41c (FastBit32.js sha256/8 6bd9753e),
// .handoff/evidence/af2/coder/u1-golden.json (u1-census.mjs beside it).
// Tuple: [ret, value, isEmpty(), count(), lowest(), serialize()] read from the RECEIVER after the call;
// ret 'this' = the receiver came back (chaining); 'throws <name>' = the call threw that error type.
// Not duplicated here: FastBit32().hasAll(undefined) (test/Pinned.test.mjs, FB-02 row).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    FastBit32, FastBit64, FastBit1024, BitMapper,
    forEachArray, forEachObject, forEachMapped, forEachMappedObject,
    forEachMaskPair, forEachMaskDiff, forEachMaskUnion
} from '../FastBit32.js';

const T = 'characterization: today\'s outcome; S6 / SC-3 may change it -- AF-2 U-1 ';

const X = {
    'fb32(6)': () => new FastBit32(6),
    'fb64(5,7)': () => new FastBit64(5, 7),
    'fb1024(64)+5': () => new FastBit1024(64).add(5),
    '{}': () => ({}),
    'undefined': () => undefined
};
const state = (f) => [f.value, f.isEmpty(), f.count(), f.lowest(), f.serialize()];
const call = (r, fn) => {
    try { const v = fn(); return v === r ? 'this' : v; } catch (e) { return 'throws ' + e.name; }
};

describe('AF-2 U-1: FastBit32 with a set object / undefined where a mask or a FastBit32 belongs', () => {
    it(T + 'FastBit32 mask ops (receiver FastBit32(1); nextSubset(1, x))', () => {
        const want = [
            ['hasAll', 'fb32(6)', true, 1, false, 1, 0, 1],
            ['hasAll', 'fb64(5,7)', true, 1, false, 1, 0, 1],
            ['hasAll', 'fb1024(64)+5', true, 1, false, 1, 0, 1],
            ['hasAll', '{}', true, 1, false, 1, 0, 1],
            ['hasAny', 'fb32(6)', false, 1, false, 1, 0, 1],
            ['hasAny', 'fb64(5,7)', false, 1, false, 1, 0, 1],
            ['hasAny', 'fb1024(64)+5', false, 1, false, 1, 0, 1],
            ['hasAny', '{}', false, 1, false, 1, 0, 1],
            ['hasAny', 'undefined', false, 1, false, 1, 0, 1],
            ['hasNone', 'fb32(6)', true, 1, false, 1, 0, 1],
            ['hasNone', 'fb64(5,7)', true, 1, false, 1, 0, 1],
            ['hasNone', 'fb1024(64)+5', true, 1, false, 1, 0, 1],
            ['hasNone', '{}', true, 1, false, 1, 0, 1],
            ['hasNone', 'undefined', true, 1, false, 1, 0, 1],
            ['union', 'fb32(6)', 'this', 1, false, 1, 0, 1],
            ['union', 'fb64(5,7)', 'this', 1, false, 1, 0, 1],
            ['union', 'fb1024(64)+5', 'this', 1, false, 1, 0, 1],
            ['union', '{}', 'this', 1, false, 1, 0, 1],
            ['union', 'undefined', 'this', 1, false, 1, 0, 1],
            ['difference', 'fb32(6)', 'this', 1, false, 1, 0, 1],
            ['difference', 'fb64(5,7)', 'this', 1, false, 1, 0, 1],
            ['difference', 'fb1024(64)+5', 'this', 1, false, 1, 0, 1],
            ['difference', '{}', 'this', 1, false, 1, 0, 1],
            ['difference', 'undefined', 'this', 1, false, 1, 0, 1],
            ['intersect', 'fb32(6)', 'this', 0, true, 0, -1, 0],
            ['intersect', 'fb64(5,7)', 'this', 0, true, 0, -1, 0],
            ['intersect', 'fb1024(64)+5', 'this', 0, true, 0, -1, 0],
            ['intersect', '{}', 'this', 0, true, 0, -1, 0],
            ['intersect', 'undefined', 'this', 0, true, 0, -1, 0],
            ['countMasked', 'fb32(6)', 0, 1, false, 1, 0, 1],
            ['countMasked', 'fb64(5,7)', 0, 1, false, 1, 0, 1],
            ['countMasked', 'fb1024(64)+5', 0, 1, false, 1, 0, 1],
            ['countMasked', '{}', 0, 1, false, 1, 0, 1],
            ['countMasked', 'undefined', 0, 1, false, 1, 0, 1],
            ['isSubsetOf', 'fb32(6)', false, 1, false, 1, 0, 1],
            ['isSubsetOf', 'fb64(5,7)', false, 1, false, 1, 0, 1],
            ['isSubsetOf', 'fb1024(64)+5', false, 1, false, 1, 0, 1],
            ['isSubsetOf', '{}', false, 1, false, 1, 0, 1],
            ['isSubsetOf', 'undefined', false, 1, false, 1, 0, 1],
            ['nextSubset', 'fb32(6)', 0, 1, false, 1, 0, 1],
            ['nextSubset', 'fb64(5,7)', 0, 1, false, 1, 0, 1],
            ['nextSubset', 'fb1024(64)+5', 0, 1, false, 1, 0, 1],
            ['nextSubset', '{}', 0, 1, false, 1, 0, 1],
            ['nextSubset', 'undefined', 0, 1, false, 1, 0, 1]
        ];
        const got = want.map(([op, k]) => {
            const r = new FastBit32(1), x = X[k]();
            return [op, k, call(r, () => (op === 'nextSubset' ? FastBit32.nextSubset(1, x) : r[op](x))), ...state(r)];
        });
        assert.deepStrictEqual(got, want);
    });

    it(T + 'FastBit32#equals(x) (receivers FastBit32(1) and FastBit32(0))', () => {
        const want = [
            [1, 'fb32(6)', false, 1, false, 1, 0, 1],
            [1, 'fb64(5,7)', false, 1, false, 1, 0, 1],
            [1, 'fb1024(64)+5', false, 1, false, 1, 0, 1],
            [1, '{}', false, 1, false, 1, 0, 1],
            [1, 'undefined', 'throws TypeError', 1, false, 1, 0, 1],
            // fail-open: an EMPTY FastBit32 "equals" any set object (its .value is undefined)
            [0, 'fb32(6)', false, 0, true, 0, -1, 0],
            [0, 'fb64(5,7)', true, 0, true, 0, -1, 0],
            [0, 'fb1024(64)+5', true, 0, true, 0, -1, 0],
            [0, '{}', true, 0, true, 0, -1, 0],
            [0, 'undefined', 'throws TypeError', 0, true, 0, -1, 0]
        ];
        const got = want.map(([v, k]) => {
            const r = new FastBit32(v), x = X[k]();
            return [v, k, call(r, () => r.equals(x)), ...state(r)];
        });
        assert.deepStrictEqual(got, want);
    });

    it(T + 'FastBit32#copy(x) (receiver FastBit32(1))', () => {
        // fail-open: a set object stores value = undefined (isEmpty() false, count() 0, lowest() -1)
        const want = [
            ['fb32(6)', 'this', 6, false, 2, 1, 6],
            ['fb64(5,7)', 'this', undefined, false, 0, -1, undefined],
            ['fb1024(64)+5', 'this', undefined, false, 0, -1, undefined],
            ['{}', 'this', undefined, false, 0, -1, undefined],
            ['undefined', 'throws TypeError', 1, false, 1, 0, 1]
        ];
        const got = want.map(([k]) => {
            const r = new FastBit32(1), x = X[k]();
            return [k, call(r, () => r.copy(x)), ...state(r)];
        });
        assert.deepStrictEqual(got, want);
    });

    it(T + 'FastBit32#fromArray(x) (receiver FastBit32(6))', () => {
        // a value with no numeric .length clears the receiver silently; undefined throws before the write
        const FA = {
            'Set([1,2])': () => new Set([1, 2]),
            'Map': () => new Map(),
            '{}': () => ({}),
            '5': () => 5,
            'undefined': () => undefined
        };
        const want = [
            ['Set([1,2])', 'this', 0, true, 0, -1, 0],
            ['Map', 'this', 0, true, 0, -1, 0],
            ['{}', 'this', 0, true, 0, -1, 0],
            ['5', 'this', 0, true, 0, -1, 0],
            ['undefined', 'throws TypeError', 6, false, 2, 1, 6]
        ];
        const got = want.map(([k]) => {
            const r = new FastBit32(6), x = FA[k]();
            return [k, call(r, () => r.fromArray(x)), ...state(r)];
        });
        assert.deepStrictEqual(got, want);
    });
});

// ---- the seven free iterators: [x, ret, callback argument tuples] ----------------------------------------
const ARR = Array.from({ length: 32 }, (_, i) => 'e' + i);
const OBJ = Object.fromEntries(ARR.map((s, i) => [s, i]));
const MAP = new BitMapper(ARR);
const F6 = () => new FastBit32(6);
const XI = ['fb64(5,7)', 'fb1024(64)+5', '{}', 'undefined'];
const walk = (run) => XI.map((k) => {
    const calls = [];
    const ret = call(null, () => run(X[k](), (...a) => {
        calls.push(a);
        if (calls.length > 64) throw new Error('runaway callback');
    }));
    return [k, ret, calls];
});
// a set object reads .value === undefined: ONE callback with bit -1 (31 - clz32(0)); undefined throws
const ONE_MINUS_1 = (args) => [
    ['fb64(5,7)', undefined, [args]],
    ['fb1024(64)+5', undefined, [args]],
    ['{}', undefined, [args]],
    ['undefined', 'throws TypeError', []]
];
const NONE = [
    ['fb64(5,7)', undefined, []],
    ['fb1024(64)+5', undefined, []],
    ['{}', undefined, []],
    ['undefined', 'throws TypeError', []]
];
const BITS_1_2 = [
    ['fb64(5,7)', undefined, [[1], [2]]],
    ['fb1024(64)+5', undefined, [[1], [2]]],
    ['{}', undefined, [[1], [2]]],
    ['undefined', 'throws TypeError', []]
];

describe('AF-2 U-1: the free iterators with a set object / undefined mask', () => {
    it(T + 'forEachArray(x, array, cb)', () => {
        assert.deepStrictEqual(walk((x, cb) => forEachArray(x, ARR, cb)), ONE_MINUS_1([undefined, -1]));
    });
    it(T + 'forEachObject(x, keys, obj, cb)', () => {
        assert.deepStrictEqual(walk((x, cb) => forEachObject(x, ARR, OBJ, cb)), ONE_MINUS_1([undefined, undefined, -1]));
    });
    it(T + 'forEachMapped(x, mapper, cb)', () => {
        assert.deepStrictEqual(walk((x, cb) => forEachMapped(x, MAP, cb)), ONE_MINUS_1([undefined, -1]));
    });
    it(T + 'forEachMappedObject(x, mapper, obj, cb)', () => {
        assert.deepStrictEqual(walk((x, cb) => forEachMappedObject(x, MAP, OBJ, cb)), ONE_MINUS_1([undefined, undefined, -1]));
    });
    it(T + 'forEachMaskPair (x in either slot, other = FastBit32(6))', () => {
        assert.deepStrictEqual(walk((x, cb) => forEachMaskPair(F6(), x, cb)), NONE);
        assert.deepStrictEqual(walk((x, cb) => forEachMaskPair(x, F6(), cb)), NONE);
    });
    it(T + 'forEachMaskDiff (x in either slot, other = FastBit32(6))', () => {
        // fail-open: A minus a set object = all of A
        assert.deepStrictEqual(walk((x, cb) => forEachMaskDiff(F6(), x, cb)), BITS_1_2);
        assert.deepStrictEqual(walk((x, cb) => forEachMaskDiff(x, F6(), cb)), NONE);
    });
    it(T + 'forEachMaskUnion (x in either slot, other = FastBit32(6))', () => {
        assert.deepStrictEqual(walk((x, cb) => forEachMaskUnion(F6(), x, cb)), BITS_1_2);
        assert.deepStrictEqual(walk((x, cb) => forEachMaskUnion(x, F6(), cb)), BITS_1_2);
    });
});
