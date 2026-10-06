// test/S1HasAllEdges.test.mjs -- QA boundary matrix for the S1 hasAll fix (FB-01).
// Oracle: the TRUE subset definition over unsigned bit patterns, never the body.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FastBit32, BitMapper } from '../FastBit32.js';

const u = (x) => x >>> 0;
const subset = (v, m) => ((u(m) & ~u(v)) >>> 0) === 0; // every mask bit set in v

describe('S1 hasAll boundary matrix', () => {
    it('false half: add(0) does NOT match a 32-name getMask([C0,C31])', () => {
        const mapper = new BitMapper(Array.from({ length: 32 }, (_, i) => 'C' + i));
        const q = mapper.getMask(['C0', 'C31']);
        assert.equal(q, 0x80000001);
        assert.equal(new FastBit32().add(0).hasAll(q), false);
        assert.equal(new FastBit32().add(31).hasAll(q), false);
        assert.equal(new FastBit32().add(0).add(31).hasAll(q), true);
    });

    it('bits 0, 1, 30 (N-1), 31 (N), 32 (N+1 wraps to 0): mask and mask>>>0 agree with the oracle', () => {
        for (const b of [0, 1, 30, 31, 32]) {
            const signed = 1 << b;
            for (const v of [0, signed, ~signed, -1, 0x7FFFFFFF]) {
                const fb = new FastBit32(v);
                const want = subset(v, signed);
                assert.equal(fb.hasAll(signed), want, 'v=' + v + ' bit=' + b + ' signed');
                assert.equal(fb.hasAll(signed >>> 0), want, 'v=' + v + ' bit=' + b + ' unsigned');
            }
        }
    });

    it('every single-bit and every 2-bit mask over all 32 bits matches the oracle on every build form', () => {
        for (let a = 0; a < 32; a++) {
            for (let b = a; b < 32; b++) {
                const m = u((1 << a) | (1 << b));
                const forms = [
                    new FastBit32().add(a).add(b),
                    new FastBit32(m),
                    new FastBit32(m | 0),
                    FastBit32.deserialize(m | 0),
                    new FastBit32().add(a).add(b).clone()
                ];
                for (const fb of forms) {
                    assert.equal(fb.hasAll(m), true, 'a=' + a + ' b=' + b);
                    assert.equal(fb.hasAll(m | 0), true, 'a=' + a + ' b=' + b + ' signed');
                }
                if (a !== b) {
                    assert.equal(new FastBit32().add(a).hasAll(m), false, 'only a=' + a + ' b=' + b);
                    assert.equal(new FastBit32().add(b).hasAll(m), false, 'only b=' + b + ' a=' + a);
                }
            }
        }
    });

    it('empty mask (0, -0) is vacuously true on any value', () => {
        for (const v of [0, 1, -1, 0x80000000]) {
            assert.equal(new FastBit32(v).hasAll(0), true);
            assert.equal(new FastBit32(v).hasAll(-0), true);
        }
    });

    it('ToInt32 wrap: 2**32 + 1 behaves as mask 1', () => {
        assert.equal(new FastBit32(1).hasAll(2 ** 32 + 1), true);
        assert.equal(new FastBit32(4).hasAll(2 ** 32 + 1), false);
        assert.equal(new FastBit32().hasAll(2 ** 32), true); // coerces to 0 (fail-open, pinned FB-02 class)
    });

    it('adversarial: a valueOf/string mask is coerced like every other mask op (old body compared identity)', () => {
        const fb = new FastBit32().add(31);
        const obj = { valueOf() { return 0x80000000; } };
        assert.equal(fb.hasAll(obj), true);
        assert.equal(fb.hasAll('2147483648'), true);
        assert.equal(new FastBit32().add(30).hasAll(obj), false);
    });

    it('adversarial: a BigInt mask throws TypeError (no silent answer)', () => {
        assert.throws(() => new FastBit32(1).hasAll(1n), TypeError);
    });

    it('hasAll is pure: repeated calls never mutate value', () => {
        const fb = new FastBit32().add(0).add(31);
        const before = fb.value;
        for (let i = 0; i < 4; i++) fb.hasAll(0xFFFFFFFF);
        assert.equal(fb.value, before);
    });
});
