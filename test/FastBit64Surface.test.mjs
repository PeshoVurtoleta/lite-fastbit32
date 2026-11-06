// test/FastBit64Surface.test.mjs -- FastBit64 exact-surface pin (PLAN-fastbit64-A A2, PROPOSAL R-2 / R-8).
// DETERMINISTIC. Pins, from the PROPOSAL s1 d.ts surface (not from the code):
//   (a) the sorted own keys of FastBit64.prototype, each with its kind (method / getter / data):
//       39 methods + the lo / hi / imageLength getters + constructor = 43;
//   (b) the sorted own keys of FastBit64 (statics deserialize + the imageLength getter, plus
//       length / name / prototype);
//   (c) every method's arity (Function#length = the required parameters of its d.ts signature;
//       a defaulted parameter does not count): ctor 0, setWords 2, saveInto 1, toBinaryString 0, ...;
//   (d) the module's sorted export list: the 1.6.1 eleven + FastBit64;
//   (e) an instance has no own properties (the words live in private fields; Q-2), however made.
// A new member, a lost member, a getter turned method, a changed arity or a public field fails.
// Node 18 APIs only.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as MOD from '../FastBit32.js';
import { FastBit64 } from '../FastBit32.js';

const METHODS = {
    add: 1, remove: 1, toggle: 1, has: 1,
    hasAll: 1, hasAny: 1, hasNone: 1, isSubsetOf: 1, equals: 1,
    union: 1, difference: 1, intersect: 1, copy: 1, countMasked: 1,
    setWords: 2, equalsWords: 2,
    count: 0, isEmpty: 0, isFull: 0, clear: 0,
    lowest: 0, highest: 0, nextClearBit: 0, highestClearBit: 0,
    nextSetBit: 1, prevSetBit: 1, rank: 1, select: 1,
    addRange: 2, removeRange: 2, countRange: 2,
    forEach: 1,
    saveInto: 1, loadFrom: 1, serialize: 0,
    clone: 0, toArray: 0, fromArray: 1, toBinaryString: 0,
};
const PROTO_GETTERS = ['hi', 'imageLength', 'lo'];
const STATIC_METHODS = { deserialize: 1 };
const STATIC_GETTERS = ['imageLength'];
const STATIC_DATA = ['length', 'name', 'prototype'];
const EXPORTS = [
    'BitMapper', 'FastBit1024', 'FastBit32', 'FastBit64', 'VERSION',
    'forEachArray', 'forEachMapped', 'forEachMappedObject', 'forEachMaskDiff',
    'forEachMaskPair', 'forEachMaskUnion', 'forEachObject',
];

const keyName = (k) => (typeof k === 'symbol' ? k.toString() : k);
function kindOf(obj, k) {
    const d = Object.getOwnPropertyDescriptor(obj, k);
    if (d.get !== undefined || d.set !== undefined) {
        return d.set === undefined ? 'getter' : d.get === undefined ? 'setter' : 'accessor';
    }
    return typeof d.value === 'function' && k !== 'constructor' ? 'method' : 'data';
}
function surface(obj) {
    return Reflect.ownKeys(obj).map(keyName).sort().map((n) => n + ':' + kindOf(obj, n));
}
function expectSurface(methods, getters, data) {
    return [
        ...Object.keys(methods).map((n) => n + ':method'),
        ...getters.map((n) => n + ':getter'),
        ...data.map((n) => n + ':data'),
    ].sort((a, b) => (a.split(':')[0] < b.split(':')[0] ? -1 : 1));
}

describe('FastBit64 surface pin (A2 / R-2)', () => {
    it('(a) FastBit64.prototype: exactly 39 methods, the lo / hi / imageLength getters and constructor (43)', () => {
        const want = expectSurface(METHODS, PROTO_GETTERS, ['constructor']);
        assert.equal(Object.keys(METHODS).length, 39, 'method table size');
        assert.equal(want.length, 43, 'expected surface size');
        assert.deepStrictEqual(surface(FastBit64.prototype), want);
        assert.strictEqual(FastBit64.prototype.constructor, FastBit64);
    });

    it('(a) the prototype getters are read-only (no setter) and every member is non-enumerable', () => {
        for (const g of PROTO_GETTERS) {
            const d = Object.getOwnPropertyDescriptor(FastBit64.prototype, g);
            assert.equal(typeof d.get, 'function', g + ' getter');
            assert.equal(d.set, undefined, g + ' has no setter');
        }
        for (const k of Reflect.ownKeys(FastBit64.prototype)) {
            assert.equal(Object.getOwnPropertyDescriptor(FastBit64.prototype, k).enumerable, false, keyName(k) + ' enumerable');
        }
    });

    it('(b) FastBit64 statics: deserialize and the imageLength getter (plus length / name / prototype)', () => {
        assert.deepStrictEqual(surface(FastBit64), expectSurface(STATIC_METHODS, STATIC_GETTERS, STATIC_DATA));
        assert.equal(Object.getOwnPropertyDescriptor(FastBit64, 'imageLength').set, undefined, 'static imageLength has no setter');
        assert.equal(FastBit64.imageLength, 3);
        assert.equal(FastBit64.name, 'FastBit64');
    });

    it('(c) arities: ctor 0, setWords 2, saveInto 1, toBinaryString 0, and every other member', () => {
        assert.equal(FastBit64.length, 0, 'constructor arity');
        assert.equal(FastBit64.prototype.setWords.length, 2, 'setWords');
        assert.equal(FastBit64.prototype.saveInto.length, 1, 'saveInto');
        assert.equal(FastBit64.prototype.toBinaryString.length, 0, 'toBinaryString');
        for (const [n, a] of Object.entries(METHODS)) assert.equal(FastBit64.prototype[n].length, a, n + ' arity');
        for (const [n, a] of Object.entries(STATIC_METHODS)) assert.equal(FastBit64[n].length, a, 'static ' + n + ' arity');
    });

    it('(d) the module exports exactly the 1.6.1 eleven + FastBit64 (12)', () => {
        assert.deepStrictEqual(Reflect.ownKeys(MOD).map(keyName).filter((k) => k !== 'Symbol(Symbol.toStringTag)').sort(), EXPORTS);
        assert.equal(EXPORTS.length, 12);
        assert.equal(typeof MOD.FastBit64, 'function');
    });

    it('(e) an instance has no own properties, however it was made', () => {
        const img = new FastBit64(-1, -1).serialize();
        const made = [
            new FastBit64(),
            new FastBit64(-1, -1),
            new FastBit64(0x80000000, 0xFFFFFFFF),
            new FastBit64(5, 7).add(63).remove(0).toggle(31).union(new FastBit64(1, 1)).addRange(3, 40),
            new FastBit64(9, 9).setWords(1, 2).clear().fromArray([0, 31, 32, 63]),
            new FastBit64(3, 4).clone(),
            FastBit64.deserialize(img),
            new FastBit64().copy(new FastBit64(-1, 0)),
        ];
        const loaded = new FastBit64();
        loaded.loadFrom(img);
        made.push(loaded);
        for (const s of made) {
            assert.deepStrictEqual(Reflect.ownKeys(s), [], 'own keys of ' + s.toBinaryString());
            assert.strictEqual(Object.getPrototypeOf(s), FastBit64.prototype);
        }
        class Sub extends FastBit64 {}
        assert.deepStrictEqual(Reflect.ownKeys(new Sub(1, 2)), [], 'subclass instance');
    });
});
