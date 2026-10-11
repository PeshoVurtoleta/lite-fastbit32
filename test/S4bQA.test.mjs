// test/S4bQA.test.mjs -- QA boundary suite for FastBit1024 (S4b, 1.4.0).
// An oracle independent of the coder's (test/torture/oracle.mjs is NOT used):
// the invariant checker below reads words with `>>> 0` and Math.floor / 2 ** k,
// never clz32 or a shift on a summary. Fills what FastBit1024.test.mjs and the
// torture tiers do not pin:
//   - every capacity 1..1024: acquire hands out 0..cap-1 in order, then -1;
//     the full summary and isFull agree; release/acquire round-trips the lowest;
//   - every one of the 1024 single bits and every single hole in a full pool
//     (word 31 and bit 31 of every word are the int32 sign: the "wrap" here);
//   - the integer key matrix (-1, 2^30, 2^31-1, 2^31, 2^32-1, 2^32, 2^53-1,
//     2^53, 1024 + k aliases, 2047, 2048) on EVERY index method, every throw
//     checked to leave the state byte-identical (fields, buffer identity, keys);
//   - the ctor throws before ANY write (a receiver with recording setters);
//   - a valueOf that re-enters the instance (the method itself writes nothing);
//   - the cross-copy instanceof brand (a second module instance via ?copy=);
//   - cursor ends (nextSetBit(cap), cap - 1, cap + 1, 2047, 2048) at every cap;
//   - I1-I4 after every op of word-31 / bit-31 heavy mixed sequences;
//   - forEach under re-entrant writes, clear() and a throw mid-walk;
//   - the README / llms.txt / d.ts FastBit1024 examples, executed from the doc
//     text, with their documented results asserted.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FastBit1024, FastBit32 } from '../FastBit32.js';

const ROOT = new URL('../', import.meta.url);
const P32 = 4294967296;

// ---- independent oracle ------------------------------------------------------
const bitOf = (word, b) => Math.floor((word >>> 0) / 2 ** b) % 2;

function inv(s) {
    if (!(s._data instanceof Int32Array) || s._data.length !== 32) return 'data shape';
    let n = 0;
    for (let w = 0; w < 32; w++) {
        const u = s._data[w] >>> 0;
        if ((bitOf(s._active, w) === 1) !== (u !== 0)) return 'I1 word ' + w;
        if ((bitOf(s._full, w) === 1) !== (u === P32 - 1)) return 'I2 word ' + w;
        for (let b = 0; b < 32; b++) {
            if (bitOf(u, b) === 1) {
                n++;
                if (w * 32 + b >= s._cap) return 'I4 bit ' + (w * 32 + b) + ' cap ' + s._cap;
            }
        }
    }
    if (n !== s._n) return 'I3 _n ' + s._n + ' want ' + n;
    if (s.size !== n) return 'size ' + s.size + ' want ' + n;
    if (s.isEmpty() !== (n === 0)) return 'isEmpty';
    if (s.isFull() !== (n === s._cap)) return 'isFull';
    return null;
}

// Truth model: a plain array of 0/1 and naive scans.
class Model {
    constructor(cap) { this.cap = cap; this.b = new Array(cap).fill(0); }
    low() { return this.b.indexOf(1); }
    high() { return this.b.lastIndexOf(1); }
    clearLow() { return this.b.indexOf(0); }
    next(f) { for (let i = f; i < this.cap; i++) if (this.b[i] === 1) return i; return -1; }
    count() { return this.b.reduce((a, x) => a + x, 0); }
}

function agree(s, m, tag) {
    const bad = inv(s);
    assert.equal(bad, null, tag + ': ' + bad);
    assert.equal(s.lowest(), m.low(), tag + ' lowest');
    assert.equal(s.highest(), m.high(), tag + ' highest');
    assert.equal(s.nextClearBit(), m.clearLow(), tag + ' nextClearBit');
    assert.equal(s.size, m.count(), tag + ' size');
}

function snap(s) {
    return s._cap + '|' + s._active + '|' + s._full + '|' + s._n + '|' + Array.prototype.join.call(s._data, ',') +
        '|' + Object.keys(s).join(',');
}

function expectReject(s, fn, ctor, tag) {
    const before = snap(s), data = s._data;
    assert.throws(fn, ctor, tag);
    assert.equal(snap(s), before, tag + ' moved the state');
    assert.equal(s._data, data, tag + ' replaced _data');
}

const fill = (cap) => { const s = new FastBit1024(cap); for (let i = 0; i < cap; i++) s.add(i); return s; };
const INDEX_OPS = ['add', 'remove', 'toggle', 'has', 'release'];
const SIGN_CAPS = [1, 2, 31, 32, 33, 63, 64, 65, 991, 992, 993, 1023, 1024];

// The integer key matrix + every non-integer edge (none of these may be accepted
// by an index method, at any capacity).
const BAD_NUMS = [
    -1, -0.5, 0.5, 1.5, 2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 1,
    2 ** 53 - 1, 2 ** 53, -(2 ** 31), -(2 ** 32), 1025, 2047, 2048, 4096,
    NaN, Infinity, -Infinity, Number.MIN_VALUE, -Number.MIN_VALUE, Number.EPSILON
];
const BAD_OBJS = [
    ['undefined', undefined], ['null', null], ['true', true], ['false', false], ["'0'", '0'],
    ["''", ''], ['new Number(1)', new Number(1)], ['[1]', [1]], ['[]', []],
    ['valueOf 1', { valueOf() { return 1; } }], ['() => 1', () => 1]
];
const TYPE_ERRS = [['Symbol', Symbol('s')], ['BigInt 1n', 1n], ['BigInt 0n', 0n], ['null-proto', Object.create(null)],
    ['throwing valueOf', { valueOf() { throw new TypeError('boom'); } }]];

// ---- capacity edges ----------------------------------------------------------
describe('S4b QA: capacity edges', () => {
    it('every capacity 1..1024: acquire gives 0..cap-1 in order, then -1; summaries and isFull agree', () => {
        for (let cap = 1; cap <= 1024; cap++) {
            const s = new FastBit1024(cap);
            assert.equal(s.capacity, cap);
            for (let i = 0; i < cap; i++) {
                const got = s.acquire();
                if (got !== i) assert.fail('cap ' + cap + ' acquire #' + i + ' got ' + got);
            }
            assert.equal(s.acquire(), -1, 'cap ' + cap + ' acquire when full');
            assert.equal(s.acquire(), -1, 'cap ' + cap + ' second acquire when full');
            assert.equal(s.nextClearBit(), -1, 'cap ' + cap);
            assert.equal(s.isFull(), true, 'cap ' + cap);
            assert.equal(s.size, cap);
            // full words below cap, exactly; nothing at or above cap
            const fullWords = cap >>> 5;
            assert.equal(s._full | 0, fullWords === 32 ? -1 : ((2 ** fullWords - 1) | 0), 'cap ' + cap + ' _full');
            assert.equal(inv(s), null, 'cap ' + cap);
            // the last slot round-trips, and so does slot 0
            s.release(cap - 1);
            assert.equal(s.isFull(), false);
            assert.equal(s.acquire(), cap - 1, 'cap ' + cap + ' reacquire last');
            s.release(0);
            assert.equal(s.acquire(), 0, 'cap ' + cap + ' reacquire 0');
            assert.equal(inv(s), null, 'cap ' + cap + ' after round trips');
            // cursor ends at this capacity
            assert.equal(s.nextSetBit(cap), -1, 'cap ' + cap + ' nextSetBit(cap)');
            assert.equal(s.nextSetBit(cap - 1), cap - 1, 'cap ' + cap + ' nextSetBit(cap - 1)');
            expectReject(s, () => s.nextSetBit(cap + 1), RangeError, 'cap ' + cap + ' nextSetBit(cap + 1)');
            expectReject(s, () => s.add(cap), RangeError, 'cap ' + cap + ' add(cap)');
            expectReject(s, () => s.has(cap), RangeError, 'cap ' + cap + ' has(cap)');
        }
    });

    it('the ctor: 0, 1, N-1, N, N+1 and the integer matrix', () => {
        for (const c of [1, 2, 31, 32, 33, 992, 993, 1023, 1024]) assert.equal(new FastBit1024(c).capacity, c);
        for (const c of [0, -0, -1, 1025, 2047, 2048, 2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 1,
            2 ** 53 - 1, 2 ** 53, 1.5, 1023.5, NaN, Infinity, -Infinity, null, true, '64', new Number(64), [64],
            { valueOf() { return 64; } }, Symbol('c'), 64n, Object.create(null)]) {
            assert.throws(() => new FastBit1024(c), RangeError, 'capacity ' + (typeof c === 'number' ? String(c) : typeof c));
        }
    });

    it('the ctor throws before ANY write (receiver with recording setters)', () => {
        const writes = [];
        function NT() {}
        NT.prototype = Object.create(FastBit1024.prototype);
        for (const k of ['_cap', '_active', '_full', '_n', '_data']) {
            Object.defineProperty(NT.prototype, k, {
                set(v) { writes.push(k); Object.defineProperty(this, k, { value: v, writable: true, enumerable: true }); },
                configurable: true
            });
        }
        for (const c of [0, 1025, 1.5, NaN, null, Symbol('c'), 3n, Object.create(null), 2 ** 32 + 5]) {
            assert.throws(() => Reflect.construct(FastBit1024, [c], NT), RangeError);
            assert.deepEqual(writes, [], 'ctor wrote ' + writes.join(',') + ' before throwing');
        }
        // positive control: the recorder does see the writes of a valid construction
        const ok = Reflect.construct(FastBit1024, [7], NT);
        assert.equal(writes.length >= 5, true, 'recorder saw ' + writes.join(','));
        assert.equal(ok.capacity, 7);
    });
});

// ---- word 31 / bit 31: the int32 sign ---------------------------------------
describe('S4b QA: every bit and every hole (word-31 and bit-31 sign behavior)', () => {
    it('each of the 1024 single bits: lowest/highest/cursor/nextClearBit/summaries', () => {
        const s = new FastBit1024();
        for (let b = 0; b < 1024; b++) {
            s.add(b);
            const w = b >>> 5;
            assert.equal(s.lowest(), b);
            assert.equal(s.highest(), b);
            assert.equal(s.nextSetBit(0), b);
            assert.equal(s.nextSetBit(b), b);
            assert.equal(s.nextSetBit(b + 1), -1, 'nextSetBit(' + (b + 1) + ') with only ' + b);
            assert.equal(s.nextClearBit(), b === 0 ? 1 : 0);
            assert.equal(s._active >>> 0, 2 ** w, 'active for bit ' + b);
            assert.equal(s._full, 0);
            assert.equal(s._data[w], (2 ** (b & 31)) | 0, 'word for bit ' + b);
            assert.equal(inv(s), null, 'bit ' + b);
            let seen = -1, calls = 0;
            s.forEach((x) => { seen = x; calls++; });
            assert.deepEqual([seen, calls], [b, 1]);
            s.remove(b);
            assert.equal(s.isEmpty(), true);
            assert.equal(s._active, 0);
            assert.equal(inv(s), null);
        }
    });

    it('each of the 1024 single holes in a full pool: nextClearBit/acquire/summaries', () => {
        const s = fill(1024);
        assert.equal(s._full, -1);
        assert.equal(s._active, -1);
        for (let b = 0; b < 1024; b++) {
            s.release(b);
            const w = b >>> 5;
            assert.equal(s.nextClearBit(), b, 'hole ' + b);
            assert.equal(s._full >>> 0, P32 - 1 - 2 ** w, 'full summary for hole ' + b);
            assert.equal(s._active, -1);
            assert.equal(s.lowest(), b === 0 ? 1 : 0);
            assert.equal(s.highest(), b === 1023 ? 1022 : 1023);
            assert.equal(s.nextSetBit(b), b === 1023 ? -1 : b + 1, 'cursor skips hole ' + b);
            assert.equal(s.isFull(), false);
            assert.equal(inv(s), null, 'hole ' + b);
            assert.equal(s.acquire(), b);
            assert.equal(s.acquire(), -1);
            assert.equal(s._full, -1);
        }
    });

    it('word values 0x80000000 / 0x7fffffff / -1 in word 31 and word 0 via mutators', () => {
        for (const w of [0, 15, 30, 31]) {
            const s = new FastBit1024();
            const m = new Model(1024);
            const base = w * 32;
            s.add(base + 31); m.b[base + 31] = 1;
            assert.equal(s._data[w], -(2 ** 31));
            agree(s, m, 'w' + w + ' sign only');
            for (let b = 0; b < 31; b++) { s.add(base + b); m.b[base + b] = 1; }
            assert.equal(s._data[w], -1);
            assert.equal(bitOf(s._full, w), 1);
            agree(s, m, 'w' + w + ' all ones');
            s.remove(base + 31); m.b[base + 31] = 0;
            assert.equal(s._data[w], 0x7fffffff);
            assert.equal(bitOf(s._full, w), 0);
            agree(s, m, 'w' + w + ' 0x7fffffff');
            assert.equal(s.nextClearBit(), w === 0 ? 31 : 0);
            s.toggle(base + 31); m.b[base + 31] = 1;
            agree(s, m, 'w' + w + ' toggled back');
            s.remove(base); m.b[base] = 0;
            assert.equal(s._data[w], -2);
            agree(s, m, 'w' + w + ' -2');
            assert.equal(s.nextSetBit(base), base + 1);
            assert.equal(s.nextSetBit(base + 31), base + 31);
        }
    });

    it('nextSetBit from inside word 31 never wraps to a lower word', () => {
        const s = new FastBit1024().add(0).add(31).add(500).add(992);
        for (let f = 993; f <= 1024; f++) assert.equal(s.nextSetBit(f), -1, 'nextSetBit(' + f + ')');
        s.add(1023);
        for (let f = 993; f <= 1023; f++) assert.equal(s.nextSetBit(f), 1023);
        assert.equal(s.nextSetBit(1024), -1);
        // word 30 walking into word 31
        assert.equal(s.nextSetBit(501), 992);
        assert.equal(s.nextSetBit(960), 992);
    });
});

// ---- fail closed: every throwing method, every input, every shape ------------
describe('S4b QA: every throw happens before any write', () => {
    function shapes(cap) {
        const out = [['empty', new FastBit1024(cap)], ['full', fill(cap)]];
        const mixed = new FastBit1024(cap);
        for (const b of [0, 31, 32, 63, 992, 1023, cap - 1, cap >> 1]) if (b < cap) mixed.add(b);
        out.push(['mixed', mixed]);
        if (cap === 1024) {
            const w31 = new FastBit1024();
            for (let b = 992; b < 1024; b++) w31.add(b);
            out.push(['word31 full', w31]);
        }
        return out;
    }

    it('add/remove/toggle/has/release/nextSetBit reject the integer matrix at every sign capacity', () => {
        let n = 0;
        for (const cap of SIGN_CAPS) {
            for (const [shape, s] of shapes(cap)) {
                const bad = BAD_NUMS.concat([cap, cap + 1, 1024 + (cap - 1), 1024 + (cap >> 1), -cap]);
                for (const v of bad) {
                    for (const op of INDEX_OPS) {
                        expectReject(s, () => s[op](v), RangeError, op + '(' + v + ') cap ' + cap + ' ' + shape);
                        n++;
                    }
                    if (v === cap) continue; // from = capacity is in the cursor domain
                    expectReject(s, () => s.nextSetBit(v), RangeError, 'nextSetBit(' + v + ') cap ' + cap + ' ' + shape);
                    n++;
                }
                for (const [tag, v] of BAD_OBJS) {
                    for (const op of INDEX_OPS.concat(['nextSetBit'])) {
                        expectReject(s, () => s[op](v), RangeError, op + '(' + tag + ') cap ' + cap + ' ' + shape);
                        n++;
                    }
                }
                for (const [tag, v] of TYPE_ERRS) {
                    for (const op of INDEX_OPS.concat(['nextSetBit'])) {
                        expectReject(s, () => s[op](v), TypeError, op + '(' + tag + ') cap ' + cap + ' ' + shape);
                        n++;
                    }
                }
                assert.equal(inv(s), null, 'cap ' + cap + ' ' + shape);
            }
        }
        assert.ok(n > 10000, 'rejections ' + n);
    });

    it('release of every free slot at the sign positions throws RangeError, state byte-identical', () => {
        for (const cap of SIGN_CAPS) {
            const s = new FastBit1024(cap);
            for (let b = 0; b < cap; b += 2) s.add(b);
            for (const b of [1, 31, 33, 63, 991, 993, 1023, cap - 1]) {
                if (b >= cap || (b & 1) === 0) continue;
                expectReject(s, () => s.release(b), RangeError, 'release(' + b + ') free, cap ' + cap);
                assert.throws(() => s.release(b), { message: 'FastBit1024: release of a free slot ' + b });
            }
            // duplicate dispose: release, release again, clear, release after clear
            const t = new FastBit1024(cap);
            const a = t.acquire();
            t.release(a);
            expectReject(t, () => t.release(a), RangeError, 'double release cap ' + cap);
            t.add(cap - 1).clear().clear();
            expectReject(t, () => t.release(cap - 1), RangeError, 'release after clear cap ' + cap);
            assert.equal(inv(t), null);
        }
    });

    it('a re-entrant valueOf: the method itself writes nothing, valueOf runs once', () => {
        const s = new FastBit1024(64).add(3);
        let calls = 0;
        const evil = { valueOf() { calls++; s.add(40); return 3; } };
        for (const op of INDEX_OPS.concat(['nextSetBit'])) {
            calls = 0;
            s.remove(40);
            const before = snap(s);
            assert.throws(() => s[op](evil), RangeError, op);
            assert.equal(calls, 1, op + ' valueOf calls');
            // the only write is the callback's own add(40)
            const ref = new FastBit1024(64);
            for (let b = s.nextSetBit(0); b !== -1; b = s.nextSetBit(b + 1)) ref.add(b);
            assert.equal(s.has(40), true, op);
            assert.equal(snap(s), snap(ref), op + ' extra write beside the re-entrant one');
            assert.notEqual(snap(s), before);
            assert.equal(inv(s), null, op);
        }
        // a valueOf that clears the instance mid-check
        const evil2 = { valueOf() { s.clear(); return 0; } };
        assert.throws(() => s.add(evil2), RangeError);
        assert.equal(inv(s), null);
        assert.equal(s.isEmpty(), true);
    });

    it('hasAll/hasAny reject non-instances and leave both sides untouched', () => {
        const s = new FastBit1024(1024).add(0).add(1023);
        const bad = [undefined, null, 0, 1, -0, NaN, '', 'x', true, Symbol('o'), 1n, {}, [], Object.create(null),
            new FastBit32(5), { _cap: 1024, _active: 1, _full: 0, _n: 1, _data: new Int32Array(32).fill(1) },
            new Proxy({}, {}), FastBit1024, FastBit1024.prototype.constructor];
        for (const v of bad) {
            expectReject(s, () => s.hasAll(v), { name: 'TypeError', message: /^FastBit1024: expected a FastBit1024, got / }, 'hasAll');
            expectReject(s, () => s.hasAny(v), { name: 'TypeError', message: /^FastBit1024: expected a FastBit1024, got / }, 'hasAny');
        }
    });
});

// ---- the cross-copy instanceof brand -----------------------------------------
describe('S4b QA: the instanceof brand', () => {
    it('a FastBit1024 from a second module instance throws TypeError both ways, state unchanged', async () => {
        const copy = await import(new URL('FastBit32.js?s4bqa-copy=' + process.pid, ROOT).href);
        const Other = copy.FastBit1024;
        assert.notEqual(Other, FastBit1024, 'the second import must be a second module instance');
        const mine = new FastBit1024(64).add(1).add(63);
        const theirs = new Other(64).add(1).add(63);
        for (const [a, b] of [[mine, theirs], [theirs, mine]]) {
            expectReject(a, () => a.hasAll(b), { name: 'TypeError', message: 'FastBit1024: expected a FastBit1024, got object' }, 'hasAll x-copy');
            expectReject(a, () => a.hasAny(b), { name: 'TypeError', message: 'FastBit1024: expected a FastBit1024, got object' }, 'hasAny x-copy');
            expectReject(b, () => a.hasAny(b), TypeError, 'other side x-copy');
        }
        // positive controls: same-copy and a subclass are accepted
        assert.equal(mine.hasAll(new FastBit1024(2).add(1)), true);
        assert.equal(theirs.hasAny(new Other(2).add(1)), true);
        class Sub extends FastBit1024 {}
        assert.equal(mine.hasAll(new Sub(64).add(63)), true);
        assert.equal(new Sub(64).add(2).hasAny(mine), false);
    });

    it('a prototype-forged object passes the brand (instanceof is the settled check): never true, never corrupts', () => {
        // SC-5 c chose `instanceof`; a forged prototype is the documented limit of that brand.
        const s = new FastBit1024(64).add(5);
        const before = snap(s);
        const forged = Object.create(FastBit1024.prototype);
        let any;
        try { any = s.hasAny(forged); } catch (e) { any = e instanceof TypeError ? 'TypeError' : e; }
        assert.notEqual(any, true, 'hasAny(forged) answered true');
        let all;
        try { all = s.hasAll(forged); } catch (e) { all = e instanceof TypeError ? 'TypeError' : e; }
        assert.ok(all === 'TypeError' || all === false || all === true, 'hasAll(forged) -> ' + String(all));
        assert.equal(snap(s), before);
    });
});

// ---- cursor ends and the iteration contract ----------------------------------
describe('S4b QA: cursor ends and iteration under writes', () => {
    it('nextSetBit domain is exactly 0..capacity at every sign capacity (-0 included)', () => {
        for (const cap of SIGN_CAPS) {
            const s = fill(cap);
            assert.equal(s.nextSetBit(-0), 0);
            assert.equal(s.nextSetBit(0), 0);
            assert.equal(s.nextSetBit(cap - 1), cap - 1);
            assert.equal(s.nextSetBit(cap), -1);
            for (const v of [cap + 1, 1025, 2047, 2048, -1, 2 ** 31, 2 ** 32 + cap]) {
                expectReject(s, () => s.nextSetBit(v), RangeError, 'nextSetBit(' + v + ') cap ' + cap);
            }
            const walk = [];
            for (let b = s.nextSetBit(0); b !== -1; b = s.nextSetBit(b + 1)) walk.push(b);
            assert.equal(walk.length, cap);
            assert.equal(walk[cap - 1], cap - 1);
        }
    });

    it('the cursor walk survives release of the current slot and clear() mid-walk', () => {
        const s = fill(1024);
        let n = 0;
        for (let b = s.nextSetBit(0); b !== -1; b = s.nextSetBit(b + 1)) { s.release(b); n++; }
        assert.equal(n, 1024);
        assert.equal(s.isEmpty(), true);
        assert.equal(inv(s), null);
        const t = new FastBit1024().add(1).add(500).add(1023);
        const seen = [];
        for (let b = t.nextSetBit(0); b !== -1; b = t.nextSetBit(b + 1)) { seen.push(b); if (b === 1) t.clear(); }
        assert.deepEqual(seen, [1]);
        assert.equal(inv(t), null);
    });

    it('forEach reads each word once (snapshot) and keeps I1-I4 under re-entrant writes', () => {
        // same word: a removed later bit is still visited; a later-added bit is not
        const s = new FastBit1024().add(0).add(5).add(31);
        const seen = [];
        s.forEach((b) => { seen.push(b); if (b === 0) { s.remove(31); s.add(7); } });
        assert.deepEqual(seen, [0, 5, 31]);
        assert.equal(inv(s), null);
        // a later word emptied before it is reached: nothing visited there
        const t = new FastBit1024().add(1).add(992).add(1023);
        const seen2 = [];
        t.forEach((b) => { seen2.push(b); if (b === 1) { t.remove(992).remove(1023); } });
        assert.deepEqual(seen2, [1]);
        assert.equal(inv(t), null);
        // clear() inside the walk
        const u = fill(1024);
        let calls = 0;
        u.forEach(() => { calls++; if (calls === 1) u.clear(); });
        assert.equal(calls, 32, 'word 0 snapshot only');
        assert.equal(inv(u), null);
        assert.equal(u.isEmpty(), true);
        // a throw mid-walk leaves the state as it was
        const v = new FastBit1024().add(3).add(1000);
        const before = snap(v);
        assert.throws(() => v.forEach(() => { throw new Error('cb'); }), /cb/);
        assert.equal(snap(v), before);
    });
});

// ---- I1-I4 after EVERY op of mixed sequences ---------------------------------
describe('S4b QA: I1-I4 after every op of mixed sequences', () => {
    it('sign-heavy deterministic sequences at every sign capacity', () => {
        let X = 0x2545f491;
        const rnd = () => { X ^= X << 13; X ^= X >>> 17; X ^= X << 5; return X >>> 0; };
        let checks = 0;
        for (const cap of SIGN_CAPS) {
            const s = new FastBit1024(cap);
            const m = new Model(cap);
            // indices biased to bit 31 of each word, word 31, 0 and cap - 1
            const pick = () => {
                const r = rnd() % 8;
                if (r === 0) return cap - 1;
                if (r === 1) return 0;
                if (r < 5) { const w = rnd() % 32; const i = w * 32 + 31; return i < cap ? i : cap - 1; }
                return rnd() % cap;
            };
            for (let k = 0; k < 3000; k++) {
                const op = rnd() % 10;
                const i = pick();
                if (op < 3) { s.add(i); m.b[i] = 1; }
                else if (op < 5) { s.remove(i); m.b[i] = 0; }
                else if (op < 6) { s.toggle(i); m.b[i] ^= 1; }
                else if (op < 8) {
                    const want = m.clearLow();
                    assert.equal(s.acquire(), want, 'acquire cap ' + cap + ' step ' + k);
                    if (want !== -1) m.b[want] = 1;
                } else if (op < 9) {
                    if (m.b[i] === 1) { s.release(i); m.b[i] = 0; }
                    else expectReject(s, () => s.release(i), RangeError, 'release free ' + i);
                } else if (rnd() % 16 === 0) { s.clear(); m.b.fill(0); }
                else {
                    const f = rnd() % (cap + 1);
                    assert.equal(s.nextSetBit(f), m.next(f), 'nextSetBit(' + f + ') cap ' + cap);
                    assert.equal(s.has(i), m.b[i] === 1);
                }
                agree(s, m, 'cap ' + cap + ' step ' + k);
                checks++;
            }
        }
        assert.ok(checks >= SIGN_CAPS.length * 3000);
    });
});

// ---- doc examples, executed from the doc text --------------------------------
function docBlock(file, anchor, opener, needle) {
    const text = readFileSync(new URL(file, ROOT), 'utf8');
    const at = text.indexOf(anchor);
    assert.ok(at >= 0, file + ': anchor "' + anchor + '" missing');
    let from = at;
    for (;;) {
        const s = text.indexOf(opener, from);
        assert.ok(s >= 0, file + ': no code block with "' + needle + '" after the anchor');
        const e = text.indexOf('```', s + opener.length);
        const body = text.slice(s + opener.length, e);
        if (body.includes(needle)) return body;
        from = e + 3;
    }
}

// Rewrites `stmt; // <int>` lines into asserts and exports every top-level
// binding into __out: functions from the top (hoisted), consts right after
// their own line (so a later throwing line still leaves them readable).
function instrument(code) {
    const fns = [];
    const lines = code.split('\n').filter((l) => !/^\s*import\s/.test(l)).map((l) => {
        const m = /^(\s*)(?:const (\w+) = )?([^;]+);\s*\/\/\s*(-?\d+)\b/.exec(l);
        if (m) {
            const where = JSON.stringify(l.trim());
            if (m[2]) return m[1] + 'const ' + m[2] + ' = ' + m[3] + '; __out.' + m[2] + ' = ' + m[2] + '; __check(' + m[2] + ', ' + m[4] + ', ' + where + ');';
            return m[1] + '__check(' + m[3] + ', ' + m[4] + ', ' + where + ');';
        }
        const f = /^function (\w+)/.exec(l);
        if (f) fns.push(f[1]);
        const c = /^const (\w+) = .*;/.exec(l);
        if (c) {
            // `const a = x, b = y;` exports every name on the line
            const names = [...l.matchAll(/(?:^const |, )(\w+) = /g)].map((x) => x[1]);
            return l + '\n' + names.map((n) => '__out.' + n + ' = ' + n + ';').join(' ');
        }
        return l;
    });
    return fns.map((n) => '__out.' + n + ' = ' + n + ';').join(' ') + '\n' + lines.join('\n');
}

function runDoc(code) {
    const checks = [];
    const out = {};
    const check = (got, want, line) => checks.push([got, want, line]);
    let err = null;
    try { new Function('FastBit1024', '__check', '__out', instrument(code))(FastBit1024, check, out); } catch (e) { err = e; }
    for (const [got, want, line] of checks) assert.equal(got, want, 'documented "' + line + '"');
    return { out, err, checks };
}

describe('S4b QA: the FastBit1024 doc examples are true', () => {
    it('README pool recipe: lowest-slot spawn, closure-free step, double release caught', () => {
        const code = docBlock('README.md', '## FastBit1024: 32 x 32 pools up to 1024', '```js', 'new FastBit1024(');
        assert.match(code, /\/\/ live\.release\(a\);\s+\/\/ RangeError: release of a free slot/);
        const { out, err } = runDoc(code);
        assert.equal(err, null, 'README example threw ' + err);
        const { live, x, vx, spawn, step, a } = out;
        assert.equal(a, 0, 'spawn(0, 1) is slot 0');
        assert.equal(live.size, 0);
        // the commented-out line really throws what its comment says
        assert.throws(() => live.release(a), { name: 'RangeError', message: /release of a free slot/ });
        assert.equal(spawn(10, 1), 0);
        assert.equal(spawn(20, 2), 1);
        step(0.5);
        assert.deepEqual([x[0], x[1]], [10.5, 21]);
        live.release(0);
        step(1);
        assert.deepEqual([x[0], x[1]], [10.5, 23], 'step walks live slots only');
        assert.equal(spawn(1, 0), 0, 'lowest free slot reused');
        for (let i = 2; i < 500; i++) assert.equal(spawn(0, 0), i);
        assert.equal(spawn(0, 0), -1, '"-1 when full"');
        assert.equal(vx.length, 500);
    });

    it('llms.txt bullets pool: spawn/despawn/walk, -1 when exhausted, double release throws', () => {
        const code = docBlock('llms.txt', '## FastBit1024 -- 32 x 32 two-level bitmap (1.4.0)', '```javascript', 'new FastBit1024(500)');
        const { out, err } = runDoc(code);
        assert.equal(err, null, 'llms example threw ' + err);
        const { slots, bullets, spawn, despawn } = out;
        assert.equal(slots.capacity, 500, '"slots 0..499"');
        assert.equal(bullets.length, 2000);
        assert.equal(spawn(), 0);
        assert.equal(spawn(), 1);
        despawn(0);
        assert.throws(() => despawn(0), RangeError, '"throws on a double release"');
        assert.equal(spawn(), 0, 'lowest free slot');
        for (let i = 2; i < 500; i++) assert.equal(spawn(), i);
        assert.equal(spawn(), -1, '"pool exhausted"');
    });

    it('d.ts @example: 0, 1, release, 0, then the second release throws', () => {
        const dts = readFileSync(new URL('FastBit32.d.ts', ROOT), 'utf8');
        const at = dts.indexOf('FastBit1024 -- a fixed 32 x 32 two-level bitmap');
        assert.ok(at >= 0);
        const ex = dts.slice(dts.indexOf('```js', at) + 5, dts.indexOf('```', dts.indexOf('```js', at) + 5));
        const code = ex.split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n');
        assert.match(code, /pool\.release\(a\); pool\.release\(a\);\s+\/\/ second call throws: double release/);
        const { out, err, checks } = runDoc(code);
        assert.equal(checks.length, 3, 'three documented results (0, 1, 0)');
        assert.ok(err instanceof RangeError, 'the last line must throw RangeError, got ' + err);
        assert.match(err.message, /release of a free slot 0/);
        const pool = out.pool;
        assert.equal(pool.capacity, 500, '"slots 0..499"');
        assert.equal(pool.has(0), false, 'the first release went through');
        assert.equal(pool.size, 1, 'slot 1 still held');
        assert.equal(inv(pool), null);
    });

    it('llms.txt / d.ts input-law lists: each listed input throws the error the doc names', () => {
        const s = new FastBit1024(8).add(1);
        // "RangeError (undefined, null, NaN, 1.5, '3', true, -1, capacity, 2^32, {})"
        for (const v of [undefined, null, NaN, 1.5, '3', true, -1, 8, 2 ** 32, {}]) expectReject(s, () => s.has(v), RangeError, 'has(' + String(v) + ')');
        // "a Symbol, a BigInt or a null-prototype object throws TypeError"
        for (const v of [Symbol('d'), 2n, Object.create(null)]) expectReject(s, () => s.add(v), TypeError, 'add(' + typeof v + ')');
        // "-0 is slot 0"; "has(undefined) throws: it never answers for slot 0"
        assert.equal(s.add(-0).has(0), true);
        assert.throws(() => s.has(undefined), RangeError);
        // "undefined -> 1024"
        assert.equal(new FastBit1024(undefined).capacity, 1024);
    });
});
