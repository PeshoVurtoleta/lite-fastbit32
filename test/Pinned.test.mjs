// test/Pinned.test.mjs -- degenerate-input contracts pinned to today's literal
// answers (S0, no behaviour change). Each value was confirmed against
// `git show HEAD:FastBit32.js`. FB-02/FB-03/FB-04/FB-05/FB-06 are pinned, not
// fixed, here; FB-01 is three `todo` rows that flip to hard truth in S1.
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

describe('FB-01 -- hasAll and the sign bit (flips in S1)', () => {
    it('add(31).hasAll(0x80000000) should be true', { todo: 'FB-01, flips in S1' }, () => {
        assert.strictEqual(new FastBit32().add(31).hasAll(0x80000000), true);
    });

    it('FastBit32(-1).hasAll(0xFFFFFFFF) should be true', { todo: 'FB-01, flips in S1' }, () => {
        assert.strictEqual(new FastBit32(-1).hasAll(0xFFFFFFFF), true);
    });

    it('32-name getMask([C0,C31]) should match add(0).add(31)', { todo: 'FB-01, flips in S1' }, () => {
        const names = Array.from({ length: 32 }, (_, i) => 'C' + i);
        const mapper = new BitMapper(names);
        const query = mapper.getMask(['C0', 'C31']);
        const entity = new FastBit32().add(0).add(31);
        assert.strictEqual(entity.hasAll(query), true);
    });
});
