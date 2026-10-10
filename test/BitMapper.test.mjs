// test/BitMapper.test.mjs -- node:test port of the BitMapper suite (6) plus the
// getName reverse-lookup case (7 total). Behaviour pinned as-is (S0).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FastBit32, BitMapper } from '../FastBit32.js';

describe('BitMapper -- string to bit resolution', () => {
    it('maps string names to correct bit indices', () => {
        const mapper = new BitMapper(['Transform', 'Velocity', 'Renderable']);
        assert.strictEqual(mapper.get('Transform'), 0);
        assert.strictEqual(mapper.get('Velocity'), 1);
        assert.strictEqual(mapper.get('Renderable'), 2);
    });

    it('throws an error if initializing with more than 32 flags', () => {
        const tooMany = Array.from({ length: 33 }, (_, i) => `Flag${i}`);
        assert.throws(() => new BitMapper(tooMany), /Maximum 32 flags/);
    });

    it('throws an error when requesting an unregistered flag', () => {
        const mapper = new BitMapper(['Position']);
        assert.throws(() => mapper.get('Health'), /Unknown flag "Health"/);
    });

    it('generates correct 32-bit integer masks from string arrays', () => {
        const mapper = new BitMapper(['Position', 'Velocity', 'Health', 'Magic']);

        // Position (bit 0 = 1) + Health (bit 2 = 4) = 5
        const mask = mapper.getMask(['Position', 'Health']);
        assert.strictEqual(mask, 5);

        // All bits
        const fullMask = mapper.getMask(['Position', 'Velocity', 'Health', 'Magic']);
        assert.strictEqual(fullMask, 15); // 1 + 2 + 4 + 8
    });

    it('returns 0 when generating a mask for an empty array', () => {
        const mapper = new BitMapper(['Position', 'Velocity']);
        assert.strictEqual(mapper.getMask([]), 0);
    });

    it('extracts active string names from a FastBit32 instance', () => {
        const mapper = new BitMapper(['Physics', 'Render', 'AI', 'Input']);
        const entityMask = new FastBit32();

        // Simulate activating Physics (0) and Input (3)
        entityMask.add(mapper.get('Physics')).add(mapper.get('Input'));

        const activeNames = mapper.getActiveNames(entityMask);

        assert.strictEqual(activeNames.length, 2);
        assert.ok(activeNames.includes('Physics'));
        assert.ok(activeNames.includes('Input'));
        assert.ok(!activeNames.includes('Render'));
    });

    it('performs reverse O(1) lookup via getName', () => {
        const mapper = new BitMapper(['Transform', 'Velocity']);
        assert.strictEqual(mapper.getName(0), 'Transform');
        assert.strictEqual(mapper.getName(1), 'Velocity');
        assert.strictEqual(mapper.getName(10), undefined);
    });
});

describe('BitMapper -- S4 bit(name) and size (1.3.0)', () => {
    it('bit(name) is 1 << get(name), signed int32 at bit 31', () => {
        const names = [];
        for (let i = 0; i < 32; i++) names.push('C' + i);
        const m = new BitMapper(names);
        assert.strictEqual(m.bit('C0'), 1);
        assert.strictEqual(m.bit('C5'), 32);
        assert.strictEqual(m.bit('C31'), -(2 ** 31));
        assert.strictEqual(new FastBit32().add(31).hasAll(m.bit('C31')), true);
        assert.strictEqual((m.bit('C31') ^ m.getMask(['C31'])) | 0, 0, 'same pattern as getMask');
    });

    it('bit(name) throws on an unknown name (through get)', () => {
        const m = new BitMapper(['A']);
        assert.throws(() => m.bit('B'), /Unknown flag "B"/);
    });

    it('size is the number of names', () => {
        assert.strictEqual(new BitMapper().size, 0);
        assert.strictEqual(new BitMapper(['A', 'B', 'C']).size, 3);
    });
});
