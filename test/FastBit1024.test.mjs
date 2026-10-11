// test/FastBit1024.test.mjs -- S4b (1.4.0): the FastBit1024 export.
// Ports benchmark/experiments/fb1024-check.mjs (oracle fuzz + invariants I1-I4 +
// fail-closed rows) into node:test. The truth model (O1024) and the invariant
// checker live in test/torture/oracle.mjs, shared with torture T0-T5.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FastBit1024, FastBit32 } from '../FastBit32.js';
import { O1024, fb1024Invariants, fb1024Snapshot, fb1024BadInputs } from './torture/oracle.mjs';

// seeded xorshift32 (deterministic: node:test must not flake)
let X = 0x9e3779b9 | 0;
const rnd = () => { X ^= X << 13; X ^= X >>> 17; X ^= X << 5; return X >>> 0; };
const CAPS = [1, 2, 31, 32, 33, 63, 64, 65, 500, 991, 992, 993, 1023, 1024];

function fillPool(cap) {
    const s = new FastBit1024(cap);
    for (let i = 0; i < cap; i++) s.acquire();
    return s;
}

describe('FastBit1024 surface', () => {
    it('defaults to capacity 1024 (undefined is the default) and starts empty', () => {
        for (const s of [new FastBit1024(), new FastBit1024(undefined)]) {
            assert.equal(s.capacity, 1024);
            assert.equal(s.size, 0);
            assert.equal(s.isEmpty(), true);
            assert.equal(s.isFull(), false);
            assert.equal(s.lowest(), -1);
            assert.equal(s.highest(), -1);
            assert.equal(s.nextClearBit(), 0);
            assert.equal(s.nextSetBit(0), -1);
            assert.equal(s.nextSetBit(1024), -1);
        }
    });

    it('chains add/remove/toggle/release/forEach/clear and returns this', () => {
        const s = new FastBit1024(64);
        assert.equal(s.add(1).remove(2).toggle(3), s);
        assert.equal(s.release(3), s);
        assert.equal(s.forEach(() => {}), s);
        assert.equal(s.clear(), s);
    });

    it('acquire hands out the LOWEST free slot, -1 when full', () => {
        const s = new FastBit1024(40);
        for (let i = 0; i < 40; i++) assert.equal(s.acquire(), i);
        assert.equal(s.acquire(), -1);
        assert.equal(s.isFull(), true);
        s.release(33).release(7);
        assert.equal(s.acquire(), 7);
        assert.equal(s.acquire(), 33);
        assert.equal(s.acquire(), -1);
    });

    it('fill-1024 then free {1023, 31, 0}: the lowest free slot every time', () => {
        const s = fillPool(1024);
        assert.equal(s._full, -1);
        s.release(1023);
        assert.equal(s.nextClearBit(), 1023);
        s.release(31);
        assert.equal(s.nextClearBit(), 31);
        s.release(0);
        assert.equal(s.nextClearBit(), 0);
        assert.deepEqual([s.acquire(), s.acquire(), s.acquire(), s.acquire()], [0, 31, 1023, -1]);
        assert.equal(fb1024Invariants(s), null);
    });

    it('nextSetBit accepts from = capacity (ends the cursor) and walks ascending', () => {
        const s = new FastBit1024(100).add(0).add(31).add(32).add(99);
        const walk = [];
        for (let b = s.nextSetBit(0); b !== -1; b = s.nextSetBit(b + 1)) walk.push(b);
        assert.deepEqual(walk, [0, 31, 32, 99]);
        assert.equal(s.nextSetBit(100), -1);
        const full = fillPool(1024);
        assert.equal(full.nextSetBit(1023), 1023);
        assert.equal(full.nextSetBit(1024), -1);
    });

    it('hasAll/hasAny across different capacities are exact (words above a capacity are 0)', () => {
        const small = new FastBit1024(33).add(0).add(31).add(32);
        const big = new FastBit1024(1024).add(0).add(31).add(32).add(1023);
        assert.equal(big.hasAll(small), true);
        assert.equal(small.hasAll(big), false);
        assert.equal(small.hasAny(big), true);
        const high = new FastBit1024().add(1023);
        assert.equal(small.hasAny(high), false);
        assert.equal(small.hasAll(high), false);
        assert.equal(high.hasAll(new FastBit1024(1)), true);
    });

    it('has no runtime coupling to FastBit32', () => {
        const src = FastBit1024.toString();
        assert.ok(!src.includes('FastBit32'), 'FastBit1024 body references FastBit32');
        assert.ok(!(new FastBit1024() instanceof FastBit32));
    });
});

describe('FastBit1024 fails closed', () => {
    const TYPE_ERR = { Symbol: 1, BigInt: 1, 'null-proto': 1 };

    it('every index-taking method throws on the bad-input matrix and leaves the state byte-identical', () => {
        for (const cap of [1, 100, 1024]) {
            const s = new FastBit1024(cap).add(0).add(cap - 1).add(cap >> 1);
            const snap = fb1024Snapshot(s);
            for (const [tag, v] of fb1024BadInputs(cap)) {
                for (const op of ['add', 'remove', 'toggle', 'has', 'release', 'nextSetBit']) {
                    if (op === 'nextSetBit' && (tag === 'cap' || (tag === '1024' && cap === 1024))) continue;
                    assert.throws(() => s[op](v), TYPE_ERR[tag] ? TypeError : RangeError, op + '(' + tag + ') cap ' + cap);
                    assert.equal(fb1024Snapshot(s), snap, op + '(' + tag + ') moved the state');
                }
            }
            assert.throws(() => s.nextSetBit(cap + 1), RangeError);
            assert.equal(fb1024Snapshot(s), snap);
        }
    });

    it('messages name the type of a non-number (never String() on it)', () => {
        const s = new FastBit1024(8);
        assert.throws(() => s.has(undefined), { name: 'RangeError', message: 'FastBit1024: bit index must be an integer 0..7, got undefined' });
        assert.throws(() => s.add('3'), { message: /got string$/ });
        assert.throws(() => s.add({}), { message: /got object$/ });
        assert.throws(() => s.remove(8), { message: /0\.\.7, got 8$/ });
        assert.throws(() => s.nextSetBit(9), { message: /0\.\.8, got 9$/ });
        assert.throws(() => new FastBit1024(Symbol('c')), { name: 'RangeError', message: /got symbol$/ });
        assert.throws(() => new FastBit1024(64n), { name: 'RangeError', message: /got bigint$/ });
    });

    it('hasAll/hasAny throw TypeError on anything but a FastBit1024', () => {
        const s = new FastBit1024(64).add(1);
        const snap = fb1024Snapshot(s);
        for (const v of [undefined, null, {}, { active: 0 }, { _active: 0, _data: new Int32Array(32) }, new FastBit32(2), 5]) {
            assert.throws(() => s.hasAll(v), { name: 'TypeError', message: /^FastBit1024: expected a FastBit1024, got / });
            assert.throws(() => s.hasAny(v), TypeError);
        }
        assert.throws(() => s.hasAll(null), { message: 'FastBit1024: expected a FastBit1024, got null' });
        assert.equal(fb1024Snapshot(s), snap);
    });

    it('release of a free slot (double release) throws RangeError and changes nothing', () => {
        const s = new FastBit1024(64);
        const a = s.acquire();
        s.release(a);
        const snap = fb1024Snapshot(s);
        assert.throws(() => s.release(a), { name: 'RangeError', message: /release of a free slot 0/ });
        assert.equal(fb1024Snapshot(s), snap);
    });

    it('the ctor accepts integers 1..1024 only', () => {
        for (const v of [0, -1, 1025, 1.5, '64', null, NaN, true, 2 ** 32, Infinity, -0, Symbol('c'), 64n, {}, Object.create(null)]) {
            assert.throws(() => new FastBit1024(v), RangeError, 'capacity ' + typeof v);
        }
        for (const c of [1, 31, 32, 33, 1023, 1024]) assert.equal(new FastBit1024(c).capacity, c);
    });

    it('-0 is slot 0', () => {
        const s = new FastBit1024(4).add(-0);
        assert.equal(s.has(0), true);
        assert.equal(s.size, 1);
    });
});

describe('FastBit1024 oracle fuzz (port of fb1024-check.mjs)', () => {
    it('600 trials: 8 queries + forEach + cursor walk vs O1024, invariants I1-I4, relations', () => {
        let checks = 0;
        for (let trial = 0; trial < 600; trial++) {
            const cap = trial < 400 ? CAPS[trial % CAPS.length] : 1 + (rnd() % 1024);
            const s = new FastBit1024(cap);
            const o = new O1024(cap);
            const fillBias = (trial % 4) / 4 + 0.2;
            const steps = 50 + (rnd() % 2000);
            for (let k = 0; k < steps; k++) {
                const r = rnd() % 100;
                const i = rnd() % cap;
                if (r < 40 * fillBias + 10) { s.add(i); o.b[i] = 1; }
                else if (r < 60) { s.remove(i); o.b[i] = 0; }
                else if (r < 70) { s.toggle(i); o.b[i] ^= 1; }
                else if (r < 85) {
                    const want = o.clearLow();
                    assert.equal(s.acquire(), want, 'acquire cap ' + cap);
                    if (want !== -1) o.b[want] = 1;
                } else if (r < 92) {
                    const h = o.next(i);
                    if (h !== -1) { s.release(h); o.b[h] = 0; }
                    else if (o.b[i] === 0) assert.throws(() => s.release(i), RangeError);
                } else if (r < 94) { s.clear(); o.b.fill(0); }
                if ((k & 15) !== 0 && k !== steps - 1) continue;
                checks++;
                const f = rnd() % (cap + 1);
                const cnt = o.count();
                assert.equal(s.lowest(), o.lowest(), 'lowest cap ' + cap);
                assert.equal(s.highest(), o.highest(), 'highest cap ' + cap);
                assert.equal(s.nextClearBit(), o.clearLow(), 'nextClearBit cap ' + cap);
                assert.equal(s.size, cnt, 'size cap ' + cap);
                assert.equal(s.isEmpty(), cnt === 0);
                assert.equal(s.isFull(), cnt === cap);
                assert.equal(s.has(i), o.b[i] === 1);
                assert.equal(s.nextSetBit(f), o.next(f), 'nextSetBit(' + f + ') cap ' + cap);
                const it = [];
                s.forEach((b) => it.push(b));
                const cur = [];
                for (let b = s.nextSetBit(0); b !== -1; b = s.nextSetBit(b + 1)) cur.push(b);
                const want = o.list();
                assert.deepEqual(it, want, 'forEach cap ' + cap);
                assert.deepEqual(cur, want, 'cursor cap ' + cap);
                assert.equal(fb1024Invariants(s), null, 'invariants cap ' + cap);
            }
            const ocap = (trial % 3) === 2 ? 1 + (rnd() % 1024) : cap;
            const t = new FastBit1024(ocap);
            const ot = new Uint8Array(ocap);
            const mode = rnd() % 4;
            for (let k = 0; k < 20; k++) {
                const i = rnd() % ocap;
                if (mode === 0 ? (i < cap && o.b[i] === 1) : true) { t.add(i); ot[i] = 1; }
            }
            let all = true;
            let any = false;
            for (let b = 0; b < ocap; b++) {
                const here = b < cap && o.b[b] === 1;
                if (ot[b] === 1 && !here) all = false;
                if (ot[b] === 1 && here) any = true;
            }
            assert.equal(s.hasAll(t), all, 'hasAll cap ' + cap + ' other ' + ocap);
            assert.equal(s.hasAny(t), any, 'hasAny cap ' + cap + ' other ' + ocap);
        }
        assert.ok(checks > 10000, 'checkpoints ' + checks);
    });
});
