// test/S4Boundary.test.mjs -- QA boundary suite for the S4 Tier-1 API (1.3.0).
// Fills what the S4 node:test cases and the torture tiers do not pin:
//   - every single-bit word `1 << i` and every `~(1 << i)`, signed (mutator-built)
//     and unsigned (ctor-built), with nextSetBit / prevSetBit / rank checked against
//     an independent per-bit oracle (Math.floor / 2 ** k, no clz32, no shifts);
//   - the cursor crossing the `<< 32` wrap (start at bit 30/31, step past 31);
//   - exact signed-int32 return values (rangeMask, BitMapper.bit);
//   - set/copy chaining, equals over all 4 signedness pairings, isSubsetOf vs hasAll;
//   - BitMapper.size at 0, 1, 31, 32, 33 names;
//   - the rangeMask throw matrix incl. a null-prototype object, a throwing
//     toString/valueOf, a revoked Proxy, BigInt and boxed Number (RangeError only,
//     and the argument is never coerced);
//   - the integer key matrix (-1, 2^30, 2^31-1, 2^31, 2^32-1, 2^32, 2^53-1, 2^53)
//     as words for every new member, plus -0 / NaN / null / undefined;
//   - live-cursor semantics under re-entrant writes and clear() mid-walk.
// Out-of-domain cursor ANSWERS are pinned in test/Pinned.test.mjs on purpose;
// here they are only bounded (an integer in -1..31, never a throw).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FastBit32, BitMapper } from '../FastBit32.js';

// ---- independent oracles (true definitions, no word math shared with the lib) --
const u32 = (x) => Number(BigInt.asUintN(32, BigInt(Math.trunc(Number.isFinite(x) ? x : 0))));
const i32 = (x) => Number(BigInt.asIntN(32, BigInt(Math.trunc(Number.isFinite(x) ? x : 0))));
const bitOf = (w, k) => Math.floor(u32(w) / 2 ** k) % 2 === 1;
function oNext(w, from) { for (let k = from; k < 32; k++) if (bitOf(w, k)) return k; return -1; }
function oPrev(w, from) { for (let k = from; k >= 0; k--) if (bitOf(w, k)) return k; return -1; }
function oRank(w, bit) { let c = 0; for (let k = 0; k < bit; k++) if (bitOf(w, k)) c++; return c; }
function oSet(w) { const r = []; for (let k = 0; k < 32; k++) if (bitOf(w, k)) r.push(k); return r; }

// signed = mutator-built int32 instance; unsigned = ctor-built uint32 instance.
const signedOf = (w) => new FastBit32(0).union(i32(w));
const unsignedOf = (w) => new FastBit32(u32(w));
const FORMS = [['signed', signedOf], ['unsigned', unsignedOf]];

const KEYS = [-1, 2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 53 - 1, 2 ** 53];

const SINGLE = [];
for (let i = 0; i < 32; i++) SINGLE.push(['1<<' + i, 1 << i, i], ['~(1<<' + i + ')', ~(1 << i), i]);

describe('S4 boundary -- cursors on every single-bit and single-hole word', () => {
    for (const [fname, make] of FORMS) {
        it('nextSetBit on 1 << i (' + fname + '): i at i, -1 at i + 1 (incl. 32)', () => {
            for (let i = 0; i < 32; i++) {
                const m = make(1 << i);
                assert.strictEqual(m.nextSetBit(i), i, 'nextSetBit(' + i + ') on 1<<' + i);
                assert.strictEqual(m.nextSetBit(i + 1), -1, 'nextSetBit(' + (i + 1) + ') on 1<<' + i);
                assert.strictEqual(m.nextSetBit(0), i, 'nextSetBit(0) on 1<<' + i);
            }
        });

        it('nextSetBit on ~(1 << i) (' + fname + '): skips the hole', () => {
            for (let i = 0; i < 32; i++) {
                const m = make(~(1 << i));
                assert.strictEqual(m.nextSetBit(i), i === 31 ? -1 : i + 1, 'nextSetBit(' + i + ') on ~(1<<' + i + ')');
                assert.strictEqual(m.nextSetBit(i + 1), i === 31 ? -1 : i + 1);
                assert.strictEqual(m.nextSetBit(0), i === 0 ? 1 : 0);
            }
        });

        it('prevSetBit edges (' + fname + '): 31, 0, -1 and the hole', () => {
            for (let i = 0; i < 32; i++) {
                const one = make(1 << i);
                assert.strictEqual(one.prevSetBit(31), i);
                assert.strictEqual(one.prevSetBit(i), i);
                assert.strictEqual(one.prevSetBit(i - 1), -1, 'prevSetBit(' + (i - 1) + ') on 1<<' + i);
                assert.strictEqual(one.prevSetBit(0), i === 0 ? 0 : -1);
                const hole = make(~(1 << i));
                assert.strictEqual(hole.prevSetBit(i), i - 1, 'prevSetBit(' + i + ') on ~(1<<' + i + ')');
                assert.strictEqual(hole.prevSetBit(31), i === 31 ? 30 : 31);
                assert.strictEqual(hole.prevSetBit(-1), -1);
            }
        });

        it('rank(i) is the popcount below i (' + fname + ')', () => {
            for (let i = 0; i < 32; i++) {
                assert.strictEqual(make(1 << i).rank(i), 0);
                assert.strictEqual(make(~(1 << i)).rank(i), i, 'rank(' + i + ') on ~(1<<' + i + ')');
                assert.strictEqual(make(~(1 << i)).rank(31), i === 31 ? 31 : 30);
            }
        });

        it('exhaustive from x word vs the per-bit oracle (' + fname + ')', () => {
            for (const [tag, w] of SINGLE) {
                const m = make(w);
                for (let f = 0; f <= 32; f++) assert.strictEqual(m.nextSetBit(f), oNext(w, f), tag + ' next ' + f);
                for (let f = -1; f <= 31; f++) assert.strictEqual(m.prevSetBit(f), oPrev(w, f), tag + ' prev ' + f);
                for (let b = 0; b <= 31; b++) assert.strictEqual(m.rank(b), oRank(w, b), tag + ' rank ' + b);
            }
        });
    }

    it('cursor started below the wrap crosses it for real (from 30 -> 31 -> 32)', () => {
        for (const [, make] of FORMS) {
            const m = make((1 << 31) | 1 | (1 << 30));
            const seen = [];
            for (let b = m.nextSetBit(30); b !== -1; b = m.nextSetBit(b + 1)) {
                seen.push(b);
                assert.ok(seen.length <= 2, 'cursor wrapped past bit 31 back to bit 0');
            }
            assert.deepStrictEqual(seen, [30, 31]);
            const down = [];
            for (let b = m.prevSetBit(1); b !== -1; b = m.prevSetBit(b - 1)) {
                down.push(b);
                assert.ok(down.length <= 1, 'descending cursor wrapped past bit 0');
            }
            assert.deepStrictEqual(down, [0]);
        }
    });
});

describe('S4 boundary -- integer key matrix as words, every new member', () => {
    for (const k of KEYS) {
        it('word ' + k, () => {
            const want = oSet(k);
            for (const [fname, make] of FORMS) {
                const m = make(k);
                const up = [];
                for (let b = m.nextSetBit(0); b !== -1; b = m.nextSetBit(b + 1)) { up.push(b); assert.ok(up.length <= 32, fname + ' ascending cursor wrapped'); }
                assert.deepStrictEqual(up, want, fname + ' ascending');
                const down = [];
                for (let b = m.prevSetBit(31); b !== -1; b = m.prevSetBit(b - 1)) { down.push(b); assert.ok(down.length <= 32, fname + ' descending cursor wrapped'); }
                assert.deepStrictEqual(down, want.slice().reverse(), fname + ' descending');
                for (let b = 0; b < 32; b++) assert.strictEqual(m.rank(b), oRank(k, b), fname + ' rank ' + b);
                assert.strictEqual(m.equalsValue(k), true, fname + ' equalsValue(key)');
                assert.strictEqual(m.equalsValue(u32(k)), true);
                assert.strictEqual(m.equalsValue(i32(k)), true);
                assert.strictEqual(m.isSubsetOf(k), true, fname + ' isSubsetOf(itself)');
            }
            const s = new FastBit32(0).set(k);
            assert.ok(Object.is(s.value, i32(k)), 'set(' + k + ').value = ' + s.value + ', want ToInt32 ' + i32(k));
            assert.strictEqual(signedOf(k).equals(unsignedOf(k)), true);
        });
    }

    it('-0, NaN, null, undefined as set() input store +0', () => {
        for (const x of [-0, NaN, null, undefined]) {
            const v = new FastBit32(5).set(x).value;
            assert.ok(Object.is(v, 0), 'set(' + String(x) + ') -> ' + String(v));
        }
    });

    it('-0 as a cursor / rank argument behaves as 0', () => {
        const m = new FastBit32(0b1011);
        assert.strictEqual(m.nextSetBit(-0), 0);
        assert.strictEqual(m.prevSetBit(-0), 0);
        assert.strictEqual(m.rank(-0), 0);
    });

    it('out-of-domain integer args never throw and stay inside -1..31 / 0..32', () => {
        const words = [0, -1, 1 << 31, 0x55555555, 0xAAAAAAAA];
        for (const w of words) {
            for (const [, make] of FORMS) {
                const m = make(w);
                for (const a of KEYS.concat([-(2 ** 31), -(2 ** 32), -(2 ** 53), NaN, null, undefined, -0, 33, 63, 64])) {
                    const n = m.nextSetBit(a); const p = m.prevSetBit(a); const r = m.rank(a);
                    assert.ok(Number.isInteger(n) && n >= -1 && n <= 31, 'nextSetBit(' + a + ') = ' + n);
                    assert.ok(Number.isInteger(p) && p >= -1 && p <= 31, 'prevSetBit(' + a + ') = ' + p);
                    assert.ok(Number.isInteger(r) && r >= 0 && r <= 32, 'rank(' + a + ') = ' + r);
                    if (n !== -1) assert.ok(bitOf(w, n), 'nextSetBit answered an unset bit ' + n);
                    if (p !== -1) assert.ok(bitOf(w, p), 'prevSetBit answered an unset bit ' + p);
                }
            }
        }
    });
});

describe('S4 boundary -- exact signed-int32 return values', () => {
    it('rangeMask(0, 31) === -1 and rangeMask(31, 31) === -2147483648 (not uint32)', () => {
        assert.ok(Object.is(FastBit32.rangeMask(0, 31), -1));
        assert.ok(Object.is(FastBit32.rangeMask(31, 31), -2147483648));
        assert.ok(Object.is(FastBit32.rangeMask(0, 0), 1));
        assert.ok(Object.is(FastBit32.rangeMask(1, 31), -2));
        assert.ok(Object.is(FastBit32.rangeMask(0, 30), 0x7FFFFFFF));
    });

    it('rangeMask over all 528 (start, end) pairs: int32, bits exactly start..end', () => {
        for (let s = 0; s < 32; s++) {
            for (let e = s; e < 32; e++) {
                const r = FastBit32.rangeMask(s, e);
                assert.ok(Object.is(r, r | 0), 'rangeMask(' + s + ',' + e + ') not int32: ' + r);
                for (let k = 0; k < 32; k++) assert.strictEqual(bitOf(r, k), k >= s && k <= e, 'pair ' + s + ',' + e + ' bit ' + k);
                assert.strictEqual(new FastBit32(-1).countMasked(r), e - s + 1);
            }
        }
    });

    it('BitMapper.bit is int32 for every slot; bit 31 is -2147483648', () => {
        const names = [];
        for (let i = 0; i < 32; i++) names.push('N' + i);
        const m = new BitMapper(names);
        for (let i = 0; i < 32; i++) {
            const b = m.bit('N' + i);
            assert.ok(Object.is(b, b | 0), 'bit N' + i + ' not int32: ' + b);
            assert.deepStrictEqual(oSet(b), [i]);
        }
        assert.ok(Object.is(m.bit('N31'), -2147483648));
    });
});

describe('S4 boundary -- set/copy chaining and re-entrant writes', () => {
    it('set and copy return this; chains compose; copy does not alias', () => {
        const a = new FastBit32(0);
        const b = new FastBit32(0xF0);
        assert.strictEqual(a.set(5), a);
        assert.strictEqual(a.copy(b), a);
        assert.strictEqual(a.set(1).copy(b).set(7).add(31).value, 7 | (1 << 31));
        assert.strictEqual(a.copy(b).union(1).value, 0xF1);
        assert.strictEqual(b.value, 0xF0, 'copy target mutation leaked into the source');
        b.add(0);
        assert.strictEqual(a.copy(new FastBit32(2)).value, 2);
    });

    it('copy(self) and set(self.value) are identity, twice (duplicate application)', () => {
        for (const w of [0, -1, 1 << 31, 0xFFFFFFFF, 0x80000000]) {
            const a = new FastBit32(w);
            const before = a.value;
            a.copy(a).copy(a);
            assert.ok(Object.is(a.value, before));
            a.set(a.value).set(a.value);
            assert.strictEqual(a.equalsValue(before), true);
        }
    });

    it('the cursor reads the LIVE word: writes ahead are visited, writes behind are not', () => {
        const m = new FastBit32(0).add(0).add(5);
        const seen = [];
        for (let b = m.nextSetBit(0); b !== -1; b = m.nextSetBit(b + 1)) {
            seen.push(b);
            if (b === 0) m.add(3).remove(5);        // ahead: 3 added, 5 removed
            if (b === 3) m.add(1).add(31);          // behind: 1 never visited; ahead: 31 is
            assert.ok(seen.length <= 32, 'runaway cursor');
        }
        assert.deepStrictEqual(seen, [0, 3, 31]);
    });

    it('clear() mid-walk ends the cursor on the next step', () => {
        const m = new FastBit32(-1);
        let steps = 0;
        for (let b = m.nextSetBit(0); b !== -1; b = m.nextSetBit(b + 1)) {
            steps++;
            if (b === 30) m.clear();
            assert.ok(steps <= 32, 'runaway cursor');
        }
        assert.strictEqual(steps, 31);
    });
});

describe('S4 boundary -- equals and isSubsetOf across representations', () => {
    const words = [0, 1, -1, 1 << 31, 0x7FFFFFFF, 0xAAAAAAAA | 0, 2 ** 30];
    for (let i = 0; i < 32; i++) words.push(~(1 << i));

    it('equals is true in all 4 signed/unsigned pairings, false on any one-bit difference', () => {
        for (const w of words) {
            for (const [na, ma] of FORMS) {
                for (const [nb, mb] of FORMS) {
                    assert.strictEqual(ma(w).equals(mb(w)), true, na + ' vs ' + nb + ' ' + w);
                    for (const k of [0, 15, 31]) {
                        assert.strictEqual(ma(w).equals(mb(w ^ (1 << k))), false, na + ' vs ' + nb + ' ' + w + ' ^bit' + k);
                    }
                }
            }
        }
    });

    it('a.isSubsetOf(b.value) === b.hasAll(a.value), all pairings, both mask spellings', () => {
        const pool = words.concat([0x0F, 0xF0, 0xFF, 1 << 30 | 1 << 31]);
        for (const x of pool) {
            for (const y of pool) {
                for (const [, ma] of FORMS) {
                    for (const [, mb] of FORMS) {
                        const a = ma(x); const b = mb(y);
                        assert.strictEqual(a.isSubsetOf(b.value), b.hasAll(a.value), 'dual ' + x + ' ' + y);
                        assert.strictEqual(a.isSubsetOf(b.value), oSet(x).every((k) => bitOf(y, k)), 'oracle ' + x + ' ' + y);
                        assert.strictEqual(a.isSubsetOf(u32(y)), a.isSubsetOf(i32(y)));
                    }
                }
            }
        }
    });
});

describe('S4 boundary -- BitMapper.size', () => {
    it('size at 0, 1, 31, 32 names; 33 throws', () => {
        const names = (n) => Array.from({ length: n }, (_, i) => 'F' + i);
        assert.strictEqual(new BitMapper().size, 0);
        assert.strictEqual(new BitMapper([]).size, 0);
        assert.strictEqual(new BitMapper(names(1)).size, 1);
        assert.strictEqual(new BitMapper(names(31)).size, 31);
        assert.strictEqual(new BitMapper(names(32)).size, 32);
        assert.throws(() => new BitMapper(names(33)), /Maximum 32/);
    });

    it('empty mapper: size 0 and bit() throws on anything', () => {
        const m = new BitMapper();
        for (const x of ['', 'a', undefined, null, 0]) assert.throws(() => m.bit(x), /Unknown flag/);
    });

    it('size is a getter only: assignment throws in strict mode and the count stays', () => {
        const m = new BitMapper(['A', 'B']);
        assert.throws(() => { m.size = 9; }, TypeError);
        assert.strictEqual(m.size, 2);
        const d = Object.getOwnPropertyDescriptor(BitMapper.prototype, 'size');
        assert.strictEqual(typeof d.get, 'function');
        assert.strictEqual(d.set, undefined);
    });

    it('adversarial: duplicate names count once (size is distinct names; last index wins for bit)', () => {
        const m = new BitMapper(['A', 'B', 'A']);
        assert.strictEqual(m.size, 2);
        assert.strictEqual(m.bit('A'), 1 << 2);
        assert.strictEqual(m.bit('B'), 1 << 1);
    });
});

describe('S4 boundary -- rangeMask throw matrix (RangeError only, no coercion)', () => {
    let coerced = 0;
    const touchy = { valueOf() { coerced++; return 3; }, toString() { coerced++; return '3'; } };
    const throwing = { toString() { throw new Error('toString called'); }, valueOf() { throw new Error('valueOf called'); } };
    const nullProto = Object.create(null);
    const rp = Proxy.revocable({}, {}); rp.revoke();
    const BAD = [
        ['null-prototype object', nullProto],
        ['throwing toString/valueOf', throwing],
        ['revoked Proxy', rp.proxy],
        ['valueOf/toString counter', touchy],
        ['boxed Number(3)', Object(3)],
        ['BigInt 3n', 3n],
        ['Symbol', Symbol('x')],
        ['function', () => 3],
        ['array [3]', [3]],
        ['true', true],
        ['-1', -1], ['32', 32], ['2^31', 2 ** 31], ['2^32', 2 ** 32], ['2^53', 2 ** 53],
        ['-Infinity', -Infinity], ['NaN', NaN], ['0.5', 0.5], ['31.000001', 31.000001],
        ['null', null], ['undefined', undefined], ['empty string', '']
    ];
    for (const [tag, x] of BAD) {
        it(tag + ' in either position -> RangeError', () => {
            assert.throws(() => FastBit32.rangeMask(x, 31), RangeError, 'start ' + tag);
            assert.throws(() => FastBit32.rangeMask(0, x), RangeError, 'end ' + tag);
            assert.throws(() => FastBit32.rangeMask(x, x), RangeError, 'both ' + tag);
        });
    }

    it('the rejected argument is never coerced (no valueOf/toString call)', () => {
        coerced = 0;
        try { FastBit32.rangeMask(touchy, touchy); } catch { /* expected */ }
        assert.strictEqual(coerced, 0);
    });

    it('message names non-numbers by typeof and numbers by value', () => {
        assert.throws(() => FastBit32.rangeMask(nullProto, 32), (e) => e instanceof RangeError && /got object, 32$/.test(e.message));
        assert.throws(() => FastBit32.rangeMask(Symbol('s'), -0), (e) => e instanceof RangeError && /got symbol, 0$/.test(e.message));
    });

    it('in-domain edges do not throw, -0 included', () => {
        assert.strictEqual(FastBit32.rangeMask(-0, -0), 1);
        assert.strictEqual(FastBit32.rangeMask(0, 31), -1);
        assert.strictEqual(FastBit32.rangeMask(31, 31), -2147483648);
        assert.throws(() => FastBit32.rangeMask(31, 30), RangeError);
    });
});
