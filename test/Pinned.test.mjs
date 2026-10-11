// test/Pinned.test.mjs -- degenerate-input contracts pinned to today's literal
// answers (S0, no behaviour change). Each value was confirmed against
// `git show HEAD:FastBit32.js`. FB-02/FB-03/FB-04/FB-05/FB-06 are pinned, not
// fixed, here; FB-01 is fixed in S1 (hasAll is signedness-agnostic) and its
// three cases are hard assertions.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FastBit32, BitMapper, forEachMapped } from '../FastBit32.js';

describe('Pinned degenerate inputs (FB-02/03/04/05/06)', () => {
    it('null/undefined map to bit 0 (FB-02)', () => {
        assert.strictEqual(new FastBit32().add(undefined).value, 1);
        assert.strictEqual(new FastBit32().add(null).value, 1);
        assert.strictEqual(new FastBit32().add(0).has(undefined), true);
    });

    it('fromArray coerces non-integers and holes to bit 0 (FB-02)', () => {
        assert.strictEqual(new FastBit32().fromArray([undefined, NaN, 'x']).value, 1);
        assert.strictEqual(new FastBit32().fromArray([, 5]).value, 33);
    });

    it('serialize is representation-unstable across build forms (FB-03)', () => {
        assert.strictEqual(new FastBit32(0x80000000).serialize(), 2147483648);
        assert.strictEqual(new FastBit32().add(31).serialize(), -2147483648);
    });

    it('deserialize / constructor accept garbage silently (FB-04)', () => {
        assert.strictEqual(FastBit32.deserialize('garbage').value, 0);
        assert.strictEqual(FastBit32.deserialize(NaN).value, 0);
        assert.strictEqual(FastBit32.deserialize(2 ** 32 + 1).value, 1);
        assert.strictEqual(FastBit32.deserialize(1.5).value, 1);
        assert.strictEqual(new FastBit32(-1).value, 4294967295);
    });

    it('countRange has no domain (FB-05)', () => {
        const full = new FastBit32(-1);
        assert.strictEqual(full.countRange(5, 2), 27);
        assert.strictEqual(full.countRange(0, 32), 1);
        assert.strictEqual(full.countRange(-1, 3), 1);
    });

    it('BitMapper accepts duplicates (FB-06)', () => {
        const m = new BitMapper(['A', 'A', 'B']);
        assert.strictEqual(m.get('A'), 1);
        assert.strictEqual(m.getName(0), 'A');
    });

    it('forEachMapped passes undefined for an unmapped set bit (FB-06)', () => {
        const mapper = new BitMapper(['X']);
        const fb = new FastBit32().add(0).add(5);
        const seen = [];
        forEachMapped(fb, mapper, (name, bit) => seen.push([name, bit]));
        assert.deepStrictEqual(seen.map((p) => p[1]), [0, 5]);
        assert.strictEqual(seen[0][0], 'X');
        assert.strictEqual(seen[1][0], undefined);
    });
});

describe('FB-01 -- hasAll and the sign bit (fixed in S1)', () => {
    it('add(31).hasAll(0x80000000) is true', () => {
        assert.strictEqual(new FastBit32().add(31).hasAll(0x80000000), true);
    });

    it('FastBit32(-1).hasAll(0xFFFFFFFF) is true', () => {
        assert.strictEqual(new FastBit32(-1).hasAll(0xFFFFFFFF), true);
    });

    it('32-name getMask([C0,C31]) matches add(0).add(31)', () => {
        const names = Array.from({ length: 32 }, (_, i) => 'C' + i);
        const mapper = new BitMapper(names);
        const query = mapper.getMask(['C0', 'C31']);
        const entity = new FastBit32().add(0).add(31);
        assert.strictEqual(entity.hasAll(query), true);
    });

    // FAIL-OPEN behaviour change pinned (FB-02 "null is zero" class): ToInt32 of
    // undefined/NaN/null is 0, and (~value & 0) === 0 is true for ANY value, so
    // hasAll(undefined|NaN|null) is true even on an EMPTY instance. 1.2.0
    // returned false here by the same signed-compare accident FB-01 fixed;
    // 1.2.1 returns true. A signature that is `undefined` therefore matches every
    // entity -- callers must keep signatures defined (BitMapper.getMask throws on
    // unknown names; a raw undefined field does not). This fails closed in S6 /
    // SC-3; pinned here until then.
    it('hasAll(undefined|NaN|null) is true even on an empty instance (fail-open)', () => {
        assert.strictEqual(new FastBit32().hasAll(undefined), true);
        assert.strictEqual(new FastBit32().hasAll(NaN), true);
        assert.strictEqual(new FastBit32().hasAll(null), true);
    });
});

// S4 (1.3.0): the raw-index Tier-1 ops are permissive outside their domain,
// like add/has (SC-3 undecided until S6). Pinned to today's answers.
describe('Pinned S4 out-of-domain answers (SC-3 open; FB-02 class)', () => {
    it('equalsValue(undefined|null|NaN) behaves like 0 (FB-02 class, closed in S6)', () => {
        assert.strictEqual(new FastBit32().equalsValue(undefined), true);
        assert.strictEqual(new FastBit32().equalsValue(null), true);
        assert.strictEqual(new FastBit32().equalsValue(NaN), true);
        assert.strictEqual(new FastBit32(1).equalsValue(undefined), false);
    });

    it('nextSetBit outside 0..32', () => {
        const full = new FastBit32(-1);
        assert.strictEqual(full.nextSetBit(33), -1);
        assert.strictEqual(full.nextSetBit(-1), 31);          // from & 31 = 31
        assert.strictEqual(full.nextSetBit(undefined), -1);   // (NaN - 32) >> 31 = 0
        assert.strictEqual(full.nextSetBit(1.5), 1);
        assert.strictEqual(full.nextSetBit(64), -1);
    });

    it('prevSetBit outside -1..31', () => {
        const full = new FastBit32(-1);
        assert.strictEqual(full.prevSetBit(32), 0);           // -1 >>> (-1 & 31) = 1
        assert.strictEqual(full.prevSetBit(-2), -1);
        assert.strictEqual(full.prevSetBit(undefined), 31);   // NaN shift count -> -1 >>> 0, full word
        assert.strictEqual(full.prevSetBit(1.5), 2);          // 31 - 1.5 -> shift 29: answer ABOVE from
    });

    it('rank outside 0..31 (shift count wraps mod 32)', () => {
        const full = new FastBit32(-1);
        assert.strictEqual(full.rank(32), 0);
        assert.strictEqual(full.rank(-1), 31);
        assert.strictEqual(full.rank(undefined), 0);
        assert.strictEqual(full.rank(1.5), 1);
    });

    it('set coerces through | 0 (garbage stores 0)', () => {
        assert.strictEqual(new FastBit32(5).set(undefined).value, 0);
        assert.strictEqual(new FastBit32(5).set(2 ** 32 + 1).value, 1);
    });
});

// S5 (1.5.0): select / nextSubset / nextCombination are unvalidated (SC-3 open).
// Out-of-domain answers pinned; select returns -1 outside 0..count()-1 (settle b).
describe('Pinned S5 out-of-domain answers (SC-3 open)', () => {
    it('select on a full word: k outside 0..31 is -1', () => {
        const full = new FastBit32(-1);
        assert.strictEqual(full.select(32), -1);
        assert.strictEqual(full.select(-1), -1);
        assert.strictEqual(full.select(-(2 ** 31)), -1);
    });

    it('select coerces k through | 0', () => {
        const full = new FastBit32(-1);
        assert.strictEqual(full.select(undefined), 0);
        assert.strictEqual(full.select(1.5), 1);
        assert.strictEqual(full.select('3'), 3);
    });

    it('select k | 0 pins on 0b1010 (undefined/NaN/-0.5 -> 0, 1.5 -> 1)', () => {
        // Bits set: 1 and 3. k | 0 maps undefined, NaN, -0.5 to 0 -> bit 1; 1.5 to 1 -> bit 3.
        // Kills the mutant `q = k | 0` -> `q = k`.
        const w = new FastBit32(0b1010);
        assert.strictEqual(w.select(undefined), 1);
        assert.strictEqual(w.select(NaN), 1);
        assert.strictEqual(w.select(-0.5), 1);
        assert.strictEqual(w.select(1.5), 3);
    });

    it('select at the int32-max end of k is -1', () => {
        assert.strictEqual(new FastBit32(-1).select(2 ** 31 - 1), -1);
    });

    it('select on an empty word is -1 even for undefined', () => {
        assert.strictEqual(new FastBit32().select(undefined), -1);
    });

    it('nextSubset with sub outside mask (out of domain)', () => {
        assert.strictEqual(FastBit32.nextSubset(5, 10), 0);   // (5 - 1) & 10
    });

    it('nextCombination(undefined) is 0 (the end sentinel)', () => {
        assert.strictEqual(FastBit32.nextCombination(undefined), 0);
    });
});
