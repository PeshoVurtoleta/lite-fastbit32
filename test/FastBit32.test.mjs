// test/FastBit32.test.mjs -- node:test port of the v1.2.0 engine-primitive suite.
// 33 cases: nextClearBit, highestClearBit, isFull, countRange, toBinaryString,
// toArray, fromArray. Behaviour pinned as-is (S0, no behaviour change).
// S4 (1.3.0): + the Tier-1 suite at the bottom (cursors, rank, equals,
// equalsValue, set, copy, isSubsetOf, rangeMask validation matrix).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FastBit32 } from '../FastBit32.js';
import { seedRng, randBelow, nextU32 } from './torture/harness.mjs';

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

// ---- S4 Tier-1 ------------------------------------------------------------

// The T5 corpus: the T5 op stream replayed from a fixed seed (as in
// S3Parity), one word per op, as uint32.
function t5Corpus(n) {
    seedRng(0x5EED0004);
    const fb = new FastBit32();
    const out = [0, 0xFFFFFFFF, 0x80000000, 1, 0x7FFFFFFF];
    for (let i = 0; i < n; i++) {
        const op = randBelow(7);
        const bit = randBelow(32);
        const mask = nextU32();
        switch (op) {
            case 0: fb.add(bit); break;
            case 1: fb.remove(bit); break;
            case 2: fb.toggle(bit); break;
            case 3: fb.union(mask); break;
            case 4: fb.difference(mask); break;
            case 5: fb.intersect(mask); break;
            case 6: fb.clear(); break;
        }
        out.push(fb.value >>> 0);
    }
    return out;
}
const CORPUS = t5Corpus(20000);
// both representations of one word: ctor (unsigned double) and add (signed int32)
function reps(w) {
    const s = new FastBit32();
    for (let b = 0; b < 32; b++) if (((w >>> b) & 1) === 1) s.add(b);
    return [new FastBit32(w), s];
}
function naiveRank(w, bit) {
    let c = 0;
    for (let i = 0; i < bit; i++) c += (w >>> i) & 1;
    return c;
}

describe('FastBit32 -- S4 Tier-1 (1.3.0)', () => {
    it('nextSetBit cursor visits exactly toArray() over the T5 corpus, both representations', () => {
        let words = 0;
        for (const w of CORPUS) {
            for (const m of reps(w)) {
                const got = [];
                for (let b = m.nextSetBit(0); b !== -1; b = m.nextSetBit(b + 1)) {
                    got.push(b);
                    assert.ok(got.length <= 32, 'cursor did not terminate on w=' + w);
                }
                assert.deepStrictEqual(got, m.toArray(), 'w=' + w);
            }
            words++;
        }
        assert.strictEqual(words, 20005);
    });

    it('prevSetBit descending cursor visits toArray() reversed, both representations', () => {
        for (const w of CORPUS) {
            for (const m of reps(w)) {
                const got = [];
                for (let b = m.prevSetBit(31); b !== -1; b = m.prevSetBit(b - 1)) {
                    got.push(b);
                    assert.ok(got.length <= 32, 'cursor did not terminate on w=' + w);
                }
                assert.deepStrictEqual(got, m.toArray().reverse(), 'w=' + w);
            }
        }
    });

    it('cursor end conditions: nextSetBit(32), prevSetBit(-1), nextSetBit(0) on 0', () => {
        for (const w of [0, 0xFFFFFFFF, 0x80000000, 1]) {
            for (const m of reps(w)) {
                assert.strictEqual(m.nextSetBit(32), -1);
                assert.strictEqual(m.prevSetBit(-1), -1);
            }
        }
        assert.strictEqual(new FastBit32().nextSetBit(0), -1);
        assert.strictEqual(new FastBit32().prevSetBit(31), -1);
        assert.strictEqual(new FastBit32().add(31).nextSetBit(31), 31);
        assert.strictEqual(new FastBit32(0x80000000).nextSetBit(31), 31);
        assert.strictEqual(new FastBit32(1).prevSetBit(0), 0);
    });

    it('rank: rank(31) on -1 is 31; rank(0) is 0; matches a naive oracle on the corpus', () => {
        assert.strictEqual(new FastBit32(-1).rank(31), 31);
        assert.strictEqual(new FastBit32().union(-1).rank(31), 31);
        assert.strictEqual(new FastBit32(-1).rank(0), 0);
        for (let i = 0; i < CORPUS.length; i += 7) {
            const w = CORPUS[i];
            for (const m of reps(w)) {
                for (let b = 0; b < 32; b++) assert.strictEqual(m.rank(b), naiveRank(w, b), 'w=' + w + ' bit=' + b);
            }
        }
    });

    it('equals is true across representations', () => {
        assert.strictEqual(new FastBit32(0x80000000).equals(new FastBit32().add(31)), true);
        assert.strictEqual(new FastBit32(-1).equals(new FastBit32().union(-1)), true);
        assert.strictEqual(new FastBit32(1).equals(new FastBit32(2)), false);
        for (let i = 0; i < CORPUS.length; i += 13) {
            const [u, s] = reps(CORPUS[i]);
            assert.strictEqual(u.equals(s), true);
            assert.strictEqual(s.equals(u), true);
        }
    });

    it('equalsValue is signedness-agnostic', () => {
        const m = new FastBit32().add(31);
        assert.strictEqual(m.equalsValue(0x80000000), true);
        assert.strictEqual(m.equalsValue(-(2 ** 31)), true);
        assert.strictEqual(new FastBit32(0xFFFFFFFF).equalsValue(-1), true);
        assert.strictEqual(m.equalsValue(0), false);
    });

    it('set stores signed int32; copy stores the other word; both chain', () => {
        const m = new FastBit32();
        assert.strictEqual(m.set(0xFFFFFFFF), m);
        assert.strictEqual(m.value, -1);
        assert.strictEqual(m.set(0x80000000).value, -(2 ** 31));
        const src = new FastBit32(0x80000001);
        assert.strictEqual(m.copy(src), m);
        assert.strictEqual(m.value, src.value);
        src.add(3);
        assert.strictEqual(m.has(3), false, 'copy is by value, not by reference');
    });

    it('isSubsetOf is the dual of hasAll, both representations', () => {
        assert.strictEqual(new FastBit32().add(31).isSubsetOf(0x80000000), true);
        assert.strictEqual(new FastBit32(0x80000000).isSubsetOf(-(2 ** 31)), true);
        assert.strictEqual(new FastBit32(3).isSubsetOf(1), false);
        assert.strictEqual(new FastBit32().isSubsetOf(0), true);
        for (let i = 0; i < CORPUS.length; i += 11) {
            const w = CORPUS[i];
            const mk = CORPUS[(i + 5) % CORPUS.length];
            for (const m of reps(w)) {
                assert.strictEqual(m.isSubsetOf(mk), new FastBit32(mk).hasAll(m.value), 'w=' + w + ' m=' + mk);
                assert.strictEqual(m.isSubsetOf(mk | 0), m.isSubsetOf(mk >>> 0));
            }
        }
    });

    it('rangeMask returns the countRange bit pattern as a signed int32', () => {
        assert.strictEqual(FastBit32.rangeMask(0, 31), -1);
        assert.strictEqual(FastBit32.rangeMask(31, 31), -(2 ** 31));
        assert.strictEqual(FastBit32.rangeMask(0, 0), 1);
        assert.strictEqual(FastBit32.rangeMask(3, 5), 56);
        const full = new FastBit32(-1);
        for (let s = 0; s < 32; s++) {
            for (let e = s; e < 32; e++) {
                assert.strictEqual(full.countMasked(FastBit32.rangeMask(s, e)), full.countRange(s, e));
                assert.strictEqual(full.countMasked(FastBit32.rangeMask(s, e)), e - s + 1);
            }
        }
    });

    it('rangeMask validation matrix throws RangeError (never a TypeError)', () => {
        const bad = [undefined, null, NaN, 1.5, '3', -1, 32, Symbol('s'), Infinity, {}];
        for (const x of bad) {
            assert.throws(() => FastBit32.rangeMask(x, 31), RangeError, 'start=' + String(x));
            assert.throws(() => FastBit32.rangeMask(0, x), RangeError, 'end=' + String(x));
        }
        assert.throws(() => FastBit32.rangeMask(5, 2), RangeError, 'start > end');
        assert.throws(() => FastBit32.rangeMask(), RangeError);
        assert.doesNotThrow(() => FastBit32.rangeMask(-0, 0));
    });
});
