// test/Boundary.test.mjs -- QA boundary pins (S0, no behaviour change).
// Fills the ROADMAP section 5 T1/T4 cells that no node:test case pinned:
// the mask-taking mutators/countMasked crossed with the T1 mask inputs,
// fromArray/countRange/getName crossed with the T1 bit inputs, T4 non-string
// and prototype-shaped names, plus re-entrancy / iteration-mutation cases.
// Every literal was computed against BOTH `git show HEAD:FastBit32.js` and the
// working copy (identical). These are today's answers, bugs included; a later
// session (S6/SC-3) re-pins them on purpose.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FastBit32, BitMapper } from '../FastBit32.js';

const BASE = 0x12345678; // 305419896, bit 31 clear

// T1 mask inputs: 0, -1, 0xFFFFFFFF, 2**32, NaN, undefined
const MASK_ROWS = [
    // tag, mask, union, difference, intersect, countMasked(on -1), signedUnion(add(31))
    ['0', 0, 305419896, 305419896, 0, 0, -2147483648],
    ['-1', -1, -1, 0, 305419896, 32, -1],
    ['0xFFFFFFFF', 0xFFFFFFFF, -1, 0, 305419896, 32, -1],
    ['2**32', 2 ** 32, 305419896, 305419896, 0, 0, -2147483648],
    ['NaN', NaN, 305419896, 305419896, 0, 0, -2147483648],
    ['undefined', undefined, 305419896, 305419896, 0, 0, -2147483648]
];

describe('T1 mask inputs x union/difference/intersect/countMasked (pinned)', () => {
    for (const [tag, m, uni, dif, int, cm, sUni] of MASK_ROWS) {
        it('mask ' + tag, () => {
            assert.strictEqual(new FastBit32(BASE).union(m).value, uni);
            assert.strictEqual(new FastBit32(BASE).difference(m).value, dif);
            assert.strictEqual(new FastBit32(BASE).intersect(m).value, int);
            assert.strictEqual(new FastBit32(-1).countMasked(m), cm);
            assert.strictEqual(new FastBit32().add(31).union(m).value, sUni);
        });
    }
});

// T1 bit inputs: 0, 31, 32, 33, -1, -0, 1.5, NaN, Infinity, undefined, null, '3', 2**31, 2**32
const BIT_ROWS = [
    // tag, bit, fromArray([bit]), countRange(bit,31) on -1, countRange(0,bit) on -1, getName(bit) on 32 names
    ['0', 0, 1, 32, 1, 'C0'],
    ['31', 31, 2147483648, 1, 32, 'C31'],
    ['32', 32, 1, 32, 1, undefined],
    ['33', 33, 2, 31, 2, undefined],
    ['-1', -1, 2147483648, 1, 32, undefined],
    ['-0', -0, 1, 32, 1, 'C0'],
    ['1.5', 1.5, 2, 31, 3, undefined],
    ['NaN', NaN, 1, 32, 32, undefined],
    ['Infinity', Infinity, 1, 32, 32, undefined],
    ['undefined', undefined, 1, 32, 32, undefined],
    ['null', null, 1, 32, 1, undefined],
    ["'3'", '3', 8, 29, 4, 'C3'],
    ['2**31', 2 ** 31, 1, 32, 1, undefined],
    ['2**32', 2 ** 32, 1, 32, 1, undefined]
];

describe('T1 bit inputs x fromArray/countRange/getName (pinned, FB-02/FB-05)', () => {
    const m32 = new BitMapper(Array.from({ length: 32 }, (_, i) => 'C' + i));
    for (const [tag, b, fa, crHi, crLo, name] of BIT_ROWS) {
        it('bit ' + tag, () => {
            assert.strictEqual(new FastBit32().fromArray([b]).value, fa);
            assert.strictEqual(new FastBit32(-1).countRange(b, 31), crHi);
            assert.strictEqual(new FastBit32(-1).countRange(0, b), crLo);
            assert.strictEqual(m32.getName(b), name);
        });
    }

    it('constructor/deserialize with undefined and no argument read 0', () => {
        assert.strictEqual(new FastBit32(undefined).value, 0);
        assert.strictEqual(new FastBit32().value, 0);
        assert.strictEqual(FastBit32.deserialize(undefined).value, 0);
    });

    it('fromArray: empty overwrites to 0, a string iterates its chars, null throws', () => {
        assert.strictEqual(new FastBit32(5).fromArray([]).value, 0);
        assert.strictEqual(new FastBit32().fromArray('35').value, 40); // bits '3' and '5'
        assert.throws(() => new FastBit32().fromArray(null), TypeError);
    });
});

describe('T4 BitMapper: non-string, prototype-shaped and N-1/N/N+1 names (pinned)', () => {
    it('non-string names (1, null, {}) are keyed by identity (SameValueZero)', () => {
        const o = {};
        const m = new BitMapper([1, null, o]);
        assert.strictEqual(m.get(1), 0);
        assert.strictEqual(m.get(null), 1);
        assert.strictEqual(m.get(o), 2);
        assert.strictEqual(m.getName(2), o);
        assert.throws(() => m.get({}), /Unknown flag/);
        assert.throws(() => m.get('1'), /Unknown flag/);
    });

    it('prototype-shaped names never leak through the Map', () => {
        assert.throws(() => new BitMapper([]).get('__proto__'), /Unknown flag/);
        assert.throws(() => new BitMapper(['A']).get('hasOwnProperty'), /Unknown flag/);
        assert.strictEqual(new BitMapper(['__proto__', 'constructor', 'toString']).getMask(['__proto__', 'toString']), 5);
    });

    it('31 / 32 names construct, 33 throws; an array-like of length 33 throws first', () => {
        assert.strictEqual(new BitMapper(Array.from({ length: 31 }, (_, i) => 'F' + i)).getMask(['F30']), 1073741824);
        assert.strictEqual(new BitMapper(Array.from({ length: 32 }, (_, i) => 'F' + i)).getMask(['F31']), 2147483648);
        assert.throws(() => new BitMapper(Array.from({ length: 33 }, (_, i) => 'F' + i)), /Maximum 32/);
        assert.throws(() => new BitMapper({ length: 33 }), /Maximum 32/);
        assert.throws(() => new BitMapper({ length: 2 }), TypeError);
    });

    it('no-arg / undefined ctor is an empty mapper; holes are skipped', () => {
        assert.throws(() => new BitMapper().get('A'), /Unknown flag/);
        assert.strictEqual(new BitMapper(undefined).getMask([]), 0);
        const sparse = new BitMapper([, 'B']);
        assert.strictEqual(sparse.get('B'), 1);
        assert.strictEqual(sparse.getName(0), undefined);
    });

    it('getMask: duplicate names in the query OR once; a string query iterates chars', () => {
        assert.strictEqual(new BitMapper(['A', 'B']).getMask(['A', 'A']), 1);
        assert.strictEqual(new BitMapper(['A', 'B']).getMask('AB'), 3);
    });

    it('the names array is copied at construction (later mutation is not seen)', () => {
        const names = ['A', 'B'];
        const m = new BitMapper(names);
        names[0] = 'Z';
        assert.strictEqual(m.get('A'), 0);
        assert.throws(() => m.get('Z'), /Unknown flag/);
    });

    it('getActiveNames omits the orphaned bit of a duplicate-name mapper (FB-06)', () => {
        assert.deepStrictEqual(new BitMapper(['A', 'A', 'B']).getActiveNames(new FastBit32(7)), ['A', 'B']);
    });
});

describe('Re-entrancy and mutation during iteration (pinned)', () => {
    it('re-entrant write through valueOf is lost (compound assignment reads first)', () => {
        const fb = new FastBit32();
        fb.add({ valueOf() { fb.add(5); return 3; } });
        assert.strictEqual(fb.value, 8);
    });

    it('forEach iterates a snapshot: clear() during iteration still visits every bit', () => {
        const fb = new FastBit32(0b1011);
        const seen = [];
        fb.forEach((b) => { seen.push(b); fb.clear(); });
        assert.deepStrictEqual(seen, [0, 1, 3]);
        assert.strictEqual(fb.value, 0);
    });

    it('forEach iterates a snapshot: add() during iteration is not visited', () => {
        const fb = new FastBit32(1);
        const seen = [];
        fb.forEach((b) => { seen.push(b); fb.add((b + 1) & 31); });
        assert.deepStrictEqual(seen, [0]);
        assert.strictEqual(fb.value, 3);
    });

    it('a throwing callback stops iteration and leaves the word unchanged', () => {
        const fb = new FastBit32(6);
        let n = 0;
        assert.throws(() => fb.forEach(() => { n++; throw new Error('x'); }), /x/);
        assert.strictEqual(n, 1);
        assert.strictEqual(fb.value, 6);
    });

    it('forEach(null) throws only when there is a bit to visit', () => {
        assert.throws(() => new FastBit32(1).forEach(null), TypeError);
        assert.strictEqual(new FastBit32(0).forEach(null).value, 0);
    });

    it('duplicate clear() is idempotent', () => {
        assert.strictEqual(new FastBit32(-1).clear().clear().value, 0);
    });
});
