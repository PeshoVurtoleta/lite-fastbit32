// test/AF2Rows.test.mjs -- AF-2 (audit 1.7) pin rows for the surviving FastBit64 mutants:
// U-13 forEach under a mutating callback (the per-word rule FastBit1024 documents; NOT CONFIRM's FIX-13
// snapshot of both words -- RECONCILE "Disputed items", LEDGER E2), U-14 clone / deserialize / two bad words /
// fromArray's intrinsic length, U-21 loadFrom's intrinsic length. Each row kills its named mutant
// (test/fixtures/af2-mutants.mjs); every expected value is written from the rule, then checked on bb4e41c.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FastBit64, FastBit1024 } from '../FastBit32.js';

// seeds {1, 5, 40}; at bit 1 the callback adds 3 (a lower word, already being walked: not visited), removes 40
// and adds 50 (the next word, not yet read: read once when its walk starts, so 50 is visited and 40 is not)
const mutate = (s) => (b) => { if (b === 1) { s.add(3); s.remove(40); s.add(50); } };
const VISIT = [1, 5, 50], END = [1, 3, 5, 50];

describe('AF-2 U-13: forEach under a mutating callback reads each word once, when its walk starts', () => {
    it('U-13 FastBit64.forEach visits [1,5,50] and ends [1,3,5,50] (same rule as FastBit1024)', () => {
        const s = new FastBit64().add(1).add(5).add(40), seen = [], cb = mutate(s);
        assert.strictEqual(s.forEach((b) => { seen.push(b); cb(b); }), s);
        assert.deepStrictEqual(seen, VISIT, 'FastBit64 forEach visit order');
        assert.deepStrictEqual(s.toArray(), END);
    });

    it('U-13 FastBit1024(64).forEach (the documented per-word rule, the oracle twin) visits [1,5,50]', () => {
        const s = new FastBit1024(64).add(1).add(5).add(40), seen = [], cb = mutate(s), end = [];
        s.forEach((b) => { seen.push(b); cb(b); });
        s.forEach((b) => { end.push(b); });
        assert.deepStrictEqual(seen, VISIT);
        assert.deepStrictEqual(end, END);
    });
});

describe('AF-2 U-14: FastBit64 cold factories return the base class; words checked lo first; intrinsic length', () => {
    class Sub extends FastBit64 {}

    it('U-14 clone() returns a base FastBit64, also from a subclass instance', () => {
        const c = new Sub(5, -1).clone();
        assert.strictEqual(Object.getPrototypeOf(c), FastBit64.prototype, 'U-14 clone: not a base FastBit64');
        assert.ok(c.equalsWords(5, -1));
    });

    it('U-14 Sub.deserialize() returns a base FastBit64 (static called on a subclass)', () => {
        const d = Sub.deserialize(new FastBit64(5, -1).serialize());
        assert.strictEqual(Object.getPrototypeOf(d), FastBit64.prototype, 'U-14 deserialize: not a base FastBit64');
        assert.ok(d.equalsWords(5, -1));
    });

    it('U-14 two bad words: constructor / setWords / equalsWords name lo (1.5), not hi (2.5)', () => {
        const want = { name: 'RangeError', message: 'FastBit64: a word must be an integer in [-2^31, 2^32), got 1.5' };
        assert.throws(() => new FastBit64(1.5, 2.5), want);
        const s = new FastBit64(9, 9);
        assert.throws(() => s.setWords(1.5, 2.5), want);
        assert.ok(s.equalsWords(9, 9), 'setWords threw before any write');
        assert.throws(() => s.equalsWords(1.5, 2.5), want);
    });

    it('U-14 fromArray reads the intrinsic TypedArray length: short lie, long lie, own length -> [3,40], 0 getter calls', () => {
        let calls = 0;
        class Short extends Uint8Array { get length() { calls++; return 1; } }
        class Long extends Uint8Array { get length() { calls++; return super.length + 4; } }
        const own = new Uint8Array([3, 40]);
        Object.defineProperty(own, 'length', { value: 1 });
        assert.strictEqual(own.length, 1, 'the own-property lie is in place');
        assert.deepStrictEqual(new FastBit64().fromArray(new Short([3, 40])).toArray(), [3, 40], 'fromArray(Short): intrinsic length');
        assert.deepStrictEqual(new FastBit64().fromArray(new Long([3, 40])).toArray(), [3, 40], 'fromArray(Long): intrinsic length');
        assert.deepStrictEqual(new FastBit64().fromArray(own).toArray(), [3, 40], 'fromArray(own length): intrinsic length');
        assert.strictEqual(calls, 0);
    });
});

describe('AF-2 U-21: FastBit64#loadFrom reads the intrinsic Int32Array length', () => {
    const HDR = new FastBit64().serialize()[0];           // the capacity-64 image header

    // outcome of loadFrom on a fresh FastBit64(1, 1): [return or 'throws <name>: <message>', lo, hi]
    const load = (src) => {
        const s = new FastBit64(1, 1);
        let r;
        try { r = s.loadFrom(src); } catch (e) { r = 'throws ' + e.name + ': ' + e.message; }
        return [r, s.lo, s.hi];
    };

    it('U-21 loadFrom: a Liar / Short length getter gives the same outcome as a plain Int32Array, 0 getter calls', () => {
        let calls = 0;
        class Liar extends Int32Array { get length() { calls++; return super.length + 64; } }
        class Short extends Int32Array { get length() { calls++; return 1; } }
        const fill = (a, words) => { for (let k = 0; k < words.length; k++) a[k] = words[k]; return a; };
        // a 2-word cut of a 3-word image: RangeError, receiver unchanged
        const CUT = [HDR, 5], WHOLE = [HDR, 7, -9];
        const BAD = ['throws RangeError: FastBit64: bad image: length', 1, 1];
        assert.deepStrictEqual(load(fill(new Int32Array(2), CUT)), BAD, 'plain Int32Array control');
        assert.deepStrictEqual(load(fill(new Liar(2), CUT)), BAD, 'Liar (length + 64)');
        assert.deepStrictEqual(load(fill(new Int32Array(3), WHOLE)), [3, 7, -9], 'plain Int32Array control');
        assert.deepStrictEqual(load(fill(new Short(3), WHOLE)), [3, 7, -9], 'Short (length 1)');
        assert.strictEqual(calls, 0);
    });
});
