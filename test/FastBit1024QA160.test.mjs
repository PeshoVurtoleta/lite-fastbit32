// test/FastBit1024QA160.test.mjs -- 1.6.0 qa pass: contract edges the rung suites do not pin.
// Written from the CONTRACT (FastBit32.d.ts, README.md, llms.txt, SPEC C-4 / C-14 / C-15), not from
// FastBit32.js. Expected values are built here bit by bit (popcount loops, word scans) or are literal.
// Covers: capacity 1 and 1024 for every 1.6.0 member, the integer wrap matrix (-1, 2^30, 2^31 - 1,
// 2^31, 2^32 - 1, 2^32, 2^32 + 5, 2^53 - 1, 2^53, NaN, null, '', 1.5, +-Infinity, -0) on every new
// index / offset entry point, the C-15 bound order, exact-fit and one-past offsets, copy into a set
// that cannot hold the bits, repeat (duplicate) range ops, SAB deserialize, a cross-realm Int32Array
// (the one input the `instanceof` clause of C-4 alone rejects), and the README / llms.txt recipes
// executed verbatim from the docs.
// FB1024_QA_SRC=<abs path> points the suite at another build (mutant / before-build runs); default is
// the package file.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const SRC = process.env.FB1024_QA_SRC
    ? pathToFileURL(process.env.FB1024_QA_SRC).href
    : new URL('../FastBit32.js', import.meta.url).href;
const { FastBit1024 } = await import(SRC);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const pop = (v) => { let c = 0; for (let i = 0; i < 32; i++) c += (v >>> i) & 1; return c; };
const snap = (s) => [s._cap, s._n, s._active, s._full, ...Array.from(s._data)].join(',');
const bitsOf = (s) => { const r = []; for (let b = 0; b < 1024; b++) if ((s._data[b >>> 5] >>> (b & 31)) & 1) r.push(b); return r; };
function invariants(s) {
    let n = 0, act = 0, full = 0;
    for (let w = 0; w < 32; w++) {
        const v = s._data[w];
        n += pop(v);
        if (v !== 0) act |= 1 << w;
        if (v === -1) full |= 1 << w;
    }
    const high = bitsOf(s).filter((b) => b >= s._cap);
    assert.deepEqual([s._n, s._active, s._full, high.length], [n, act, full, 0], 'I1-I4 at cap ' + s._cap);
}
const fill = (s, bits) => { for (const b of bits) s.add(b); return s; };
const HEADER = (cap) => (0x46420800 | cap);

// The wrap matrix: every value an index / bound / offset must reject (RangeError).
const WRAP = [-1, 2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 5, 2 ** 53 - 1, 2 ** 53,
    NaN, null, '', '3', 1.5, Infinity, -Infinity, true, {}];

describe('FastBit1024 1.6.0 qa -- capacity 1 and 1024', () => {
    test('capacity 1: prevSetBit, ranges, counts, copy, equals, image -- the only slot is 0', () => {
        const s = new FastBit1024(1);
        assert.equal(s.prevSetBit(-1), -1);
        assert.equal(s.prevSetBit(0), -1);
        assert.throws(() => s.prevSetBit(1), RangeError);
        assert.throws(() => s.addRange(0, 2), RangeError);
        assert.equal(s.addRange(0, 1), s);
        assert.equal(s.isFull(), true);
        assert.equal(s.prevSetBit(0), 0);
        invariants(s);
        assert.equal(s.imageLength, 2);
        assert.deepEqual(Array.from(s.serialize()), [HEADER(1), 1]);
        const d = FastBit1024.deserialize(s.serialize());
        assert.deepEqual([d.capacity, d.size, d.has(0)], [1, 1, true]);
        // counts against a full 1024 (mismatched capacities, both directions)
        const big = new FastBit1024(1024).addRange(0, 1024);
        assert.deepEqual([s.intersectionSize(big), s.unionSize(big), s.differenceSize(big)], [1, 1024, 0]);
        assert.deepEqual([big.intersectionSize(s), big.unionSize(s), big.differenceSize(s)], [1, 1024, 1023]);
        // copy / equals across capacities
        const one = fill(new FastBit1024(1024), [0]);
        assert.equal(s.equals(one), true);
        assert.equal(one.equals(s), true);
        const before = snap(s);
        assert.throws(() => s.copy(fill(new FastBit1024(1024), [1])), RangeError);
        assert.equal(snap(s), before);
        assert.equal(s.removeRange(0, 1), s);
        assert.equal(s.isEmpty(), true);
        assert.equal(s.copy(one), s);
        assert.equal(snap(s), '1,1,1,0,1' + ',0'.repeat(31));
        assert.equal(s.clone().equals(s), true);
        assert.equal(s.clone().capacity, 1);
    });

    test('capacity 1024: prevSetBit(1023) / prevSetBit(1024); addRange(0, 1024) == add-loop fill; removeRange(0, 1024) == fresh', () => {
        const s = new FastBit1024(1024);
        assert.throws(() => s.prevSetBit(1024), /from must be an integer -1\.\.1023, got 1024/);
        s.add(1023);
        assert.equal(s.prevSetBit(1023), 1023);
        assert.equal(s.prevSetBit(1022), -1);
        s.addRange(0, 1024);
        const loop = new FastBit1024(1024);
        for (let b = 0; b < 1024; b++) loop.add(b);
        assert.equal(snap(s), snap(loop));
        assert.deepEqual([s._n, s._active, s._full, s.isFull()], [1024, -1, -1, true]);
        assert.deepEqual(Array.from(s.serialize()), [HEADER(1024), ...new Array(32).fill(-1)]);
        assert.equal(s.removeRange(0, 1024), s);
        assert.equal(snap(s), snap(new FastBit1024(1024)));
    });

    test('every capacity 1..1024: addRange(0, cap) fills exactly, removeRange(0, cap) restores the fresh state', () => {
        for (let cap = 1; cap <= 1024; cap++) {
            const s = new FastBit1024(cap).addRange(0, cap);
            assert.equal(s.size, cap);
            assert.equal(s.isFull(), true);
            assert.equal(s.prevSetBit(cap - 1), cap - 1);
            invariants(s);
            s.removeRange(0, cap);
            assert.equal(snap(s), snap(new FastBit1024(cap)), 'cap ' + cap);
        }
    });
});

describe('FastBit1024 1.6.0 qa -- bounds, order and wrap points', () => {
    test('lo === hi is a no-op that returns this, for every lo in 0..cap (lo === hi === cap included)', () => {
        for (const cap of [1, 31, 32, 33, 1024]) {
            const s = fill(new FastBit1024(cap), [0, cap - 1]);
            const before = snap(s);
            for (let lo = 0; lo <= cap; lo++) {
                assert.equal(s.addRange(lo, lo), s);
                assert.equal(s.removeRange(lo, lo), s);
            }
            assert.equal(snap(s), before);
        }
    });

    test('C-15 order: lo is checked first -- (-1, Symbol) / (-1, 3n) RangeError, (0, Symbol) / (0, 3n) TypeError', () => {
        for (const op of ['addRange', 'removeRange']) {
            const s = fill(new FastBit1024(100), [5, 99]);
            const before = snap(s);
            assert.throws(() => s[op](-1, Symbol('x')), (e) => e instanceof RangeError && /got -1, symbol$/.test(e.message));
            assert.throws(() => s[op](-1, 3n), (e) => e instanceof RangeError && /got -1, bigint$/.test(e.message));
            // lo's check is the integer screen only: an in-range-integer lo above capacity (101 at cap 100)
            // passes it, so a Symbol hi then throws TypeError from the hi screen (observed; C-15 wording)
            assert.throws(() => s[op](101, Symbol('x')), TypeError);
            assert.throws(() => s[op](2048, Symbol('x')), RangeError);
            assert.throws(() => s[op](0, Symbol('x')), TypeError);
            assert.throws(() => s[op](0, 3n), TypeError);
            assert.throws(() => s[op](Symbol('x'), -1), TypeError);
            assert.equal(snap(s), before);
        }
    });

    test('wrap matrix on prevSetBit: every value RangeError at caps 1 / 1024; -1 -> -1; -0 is slot 0', () => {
        for (const cap of [1, 1024]) {
            const s = fill(new FastBit1024(cap), [0]);
            const before = snap(s);
            for (const v of [...WRAP.filter((x) => x !== -1), undefined, cap, -2]) {
                assert.throws(() => s.prevSetBit(v), RangeError, 'prevSetBit(' + String(v) + ') cap ' + cap);
            }
            assert.equal(s.prevSetBit(-1), -1);
            assert.equal(s.prevSetBit(-0), 0);
            assert.equal(s.prevSetBit(0), 0);
            s.remove(0);
            assert.equal(s.prevSetBit(-0), -1);
            s.add(0);
            assert.equal(snap(s), before);
        }
    });

    test('wrap matrix on addRange / removeRange: every bad lo or hi is RangeError, nothing written; -0 is 0', () => {
        for (const cap of [1, 1024]) {
            for (const op of ['addRange', 'removeRange']) {
                const s = fill(new FastBit1024(cap), [0, cap - 1]);
                const before = snap(s);
                for (const v of [...WRAP, undefined, cap + 1]) {
                    assert.throws(() => s[op](v, cap), RangeError, op + '(' + String(v) + ', cap)');
                    assert.throws(() => s[op](0, v), RangeError, op + '(0, ' + String(v) + ')');
                }
                // 2^32 aliases 0 and 2^32 + 5 aliases 5 under ToUint32: still rejected
                assert.throws(() => s[op](2 ** 32, 2 ** 32 + 1), RangeError);
                assert.equal(snap(s), before);
            }
        }
        const z = new FastBit1024(64).addRange(-0, 1);
        assert.deepEqual(bitsOf(z), [0]);
        assert.equal(z.addRange(0, -0), z);
        assert.deepEqual(bitsOf(z.removeRange(-0, 1)), []);
    });

    test('wrap matrix on saveInto / loadFrom / deserialize offsets: RangeError, out / receiver unchanged; undefined and -0 are 0', () => {
        for (const cap of [1, 1024]) {
            const src = fill(new FastBit1024(cap), [0, cap - 1]);
            const img = src.serialize();
            const out = new Int32Array(64).fill(0x5a5a5a5a);
            const outBefore = Array.from(out);
            const r = fill(new FastBit1024(cap), [cap >>> 1]);
            const rBefore = snap(r);
            for (const v of [...WRAP, 2 ** 30 - 1]) {
                assert.throws(() => src.saveInto(out, v), RangeError, 'saveInto ' + String(v));
                assert.throws(() => r.loadFrom(img, v), RangeError, 'loadFrom ' + String(v));
                assert.throws(() => FastBit1024.deserialize(img, v), RangeError, 'deserialize ' + String(v));
            }
            assert.deepEqual(Array.from(out), outBefore);
            assert.equal(snap(r), rBefore);
            assert.equal(src.saveInto(out, undefined), src.imageLength);
            assert.equal(src.saveInto(out, -0), src.imageLength);
            assert.equal(r.loadFrom(img, -0), src.imageLength);
            assert.equal(r.equals(src), true);
            assert.equal(FastBit1024.deserialize(img, -0).equals(src), true);
        }
    });

    test('exact fit at offset = length - imageLength is accepted; one past is RangeError with nothing written', () => {
        for (const cap of [1, 31, 32, 33, 500, 1024]) {
            const s = fill(new FastBit1024(cap), [0, cap - 1, cap >>> 1]);
            const L = s.imageLength;
            const arena = new Int32Array(L + 7).fill(0x13);
            const last = arena.length - L;
            assert.equal(s.saveInto(arena, last), arena.length);
            const saved = Array.from(arena);
            assert.throws(() => s.saveInto(arena, last + 1), RangeError);
            assert.deepEqual(Array.from(arena), saved);
            const r = new FastBit1024(cap);
            assert.equal(r.loadFrom(arena, last), arena.length);
            assert.equal(r.equals(s), true);
            assert.equal(FastBit1024.deserialize(arena, last).equals(s), true);
            // a VALID header one word later: only the length check can reject it
            arena[last + 1] = HEADER(cap);
            const rb = snap(r);
            assert.throws(() => r.loadFrom(arena, last + 1), /bad image: length/);
            assert.throws(() => FastBit1024.deserialize(arena, last + 1), /bad image: length/);
            assert.equal(snap(r), rb);
        }
    });
});

describe('FastBit1024 1.6.0 qa -- copy, repeat ops, shared memory, realms', () => {
    test('copy into a capacity that cannot hold the top bit: RangeError, receiver byte-identical; bit cap - 1 fits and stale words are cleared', () => {
        for (const cap of [1, 31, 32, 33, 500, 1023]) {
            const junk = () => fill(new FastBit1024(cap), [0, cap - 1, cap >>> 1]);
            const r = junk();
            const before = snap(r);
            assert.throws(() => r.copy(fill(new FastBit1024(1024), [cap])), RangeError);
            assert.throws(() => r.copy(fill(new FastBit1024(1024), [cap - 1, 1023])), RangeError);
            assert.equal(snap(r), before);
            // fits: other's only bit is cap - 1; every other word of the receiver must be zeroed
            const other = fill(new FastBit1024(1024), [cap - 1]);
            const r2 = cap > 1 ? fill(junk(), [0]) : junk();
            assert.equal(r2.copy(other), r2);
            assert.deepEqual(bitsOf(r2), [cap - 1]);
            invariants(r2);
            // empty other empties the receiver
            assert.equal(snap(junk().copy(new FastBit1024(1024))), snap(new FastBit1024(cap)));
        }
    });

    test('duplicate range ops are idempotent: count is never double-counted, and a repeated save / load is identical', () => {
        for (const cap of [33, 1024]) {
            const s = new FastBit1024(cap).addRange(3, cap - 2).addRange(3, cap - 2).addRange(1, cap);
            invariants(s);
            assert.equal(s.size, cap - 1);
            s.removeRange(5, 9).removeRange(5, 9);
            invariants(s);
            assert.equal(s.size, cap - 5);
            const a = new Int32Array(40), b = new Int32Array(40);
            assert.equal(s.saveInto(a, 2), s.saveInto(a, 2));
            s.saveInto(b, 2);
            assert.deepEqual(Array.from(a), Array.from(b));
            const r = new FastBit1024(cap);
            r.loadFrom(a, 2);
            const once = snap(r);
            r.loadFrom(a, 2);
            assert.equal(snap(r), once);
            assert.equal(r.equals(s), true);
        }
    });

    test('a re-entrant valueOf bound runs once before the RangeError; its own write stands and I1-I4 hold', () => {
        const s = new FastBit1024(64);
        let calls = 0;
        const lo = { valueOf() { calls++; s.addRange(10, 20); return 3; } };
        assert.throws(() => s.addRange(lo, 40), RangeError);
        assert.equal(calls, 1);
        assert.deepEqual(bitsOf(s), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
        invariants(s);
    });

    test('deserialize of a SAB-backed Int32Array at an offset: image capacity, exact bits', () => {
        for (const cap of [1, 33, 1024]) {
            const s = fill(new FastBit1024(cap), [0, cap - 1, cap >>> 1]);
            const sab = new Int32Array(new SharedArrayBuffer(4 * (s.imageLength + 5)));
            assert.equal(s.saveInto(sab, 3), 3 + s.imageLength);
            const d = FastBit1024.deserialize(sab, 3);
            assert.equal(d.capacity, cap);
            assert.deepEqual(bitsOf(d), bitsOf(s));
            invariants(d);
            const r = new FastBit1024(1024);
            assert.equal(r.loadFrom(sab, 3), 3 + s.imageLength);
            assert.equal(r.equals(s), true);
        }
    });

    test('adversarial: an Int32Array from another realm is refused (TypeError) on all three entry points, nothing written', () => {
        const foreign = vm.runInNewContext('new Int32Array(40)');
        assert.equal(Object.prototype.toString.call(foreign), '[object Int32Array]');
        assert.equal(foreign instanceof Int32Array, false);
        const s = fill(new FastBit1024(100), [1, 99]);
        foreign.set(s.serialize());
        const fBefore = Array.from(foreign);
        assert.throws(() => s.saveInto(foreign, 0), /out must be an Int32Array/);
        assert.deepEqual(Array.from(foreign), fBefore);
        const r = fill(new FastBit1024(100), [50]);
        const rb = snap(r);
        assert.throws(() => r.loadFrom(foreign, 0), /src must be an Int32Array/);
        assert.throws(() => FastBit1024.deserialize(foreign, 0), TypeError);
        assert.equal(snap(r), rb);
        // the same bytes through a local view load fine
        assert.equal(r.loadFrom(new Int32Array(Array.from(foreign)), 0), s.imageLength);
        assert.equal(r.equals(s), true);
    });
});

describe('FastBit1024 1.6.0 qa -- the documented recipes, executed from the docs', () => {
    function block(file, marker, fence) {
        const text = readFileSync(ROOT + file, 'utf8');
        const at = text.indexOf(marker);
        assert.ok(at >= 0, file + ': recipe marker missing');
        const start = text.indexOf(fence, at) + fence.length;
        const end = text.indexOf('\n```', start);
        return text.slice(start, end).split('\n').filter((l) => !/^\s*import /.test(l)).join('\n');
    }
    for (const [file, marker, fence] of [
        ['README.md', 'Save, load and walk (1.6.0', '```js'],
        ['llms.txt', 'Save, load and walk recipes (1.6.0', '```javascript'],
    ]) {
        test(file + ': JSON round trip, reverse walk and arena run verbatim and give the commented results', () => {
            const code = block(file, marker, fence);
            assert.match(code, /499, 103, 102, 101, 100, 64, 3/);
            assert.ok(code.includes('for (let b = s.prevSetBit(s.capacity - 1); b !== -1; b = s.prevSetBit(b - 1))'), file + ': reverse-walk loop drifted');
            const r = new Function('FastBit1024', code + '\nreturn { s, back, k, arena, off };')(FastBit1024);
            assert.deepEqual(bitsOf(r.s), [3, 64, 100, 101, 102, 103, 499]);
            assert.equal(r.back.equals(r.s), true);
            assert.equal(r.back.capacity, 500);
            const walk = [];
            for (let b = r.s.prevSetBit(r.s.capacity - 1); b !== -1; b = r.s.prevSetBit(b - 1)) walk.push(b);
            assert.deepEqual(walk, [499, 103, 102, 101, 100, 64, 3]);
            assert.equal(r.off, r.arena.length);
            let off = 0;
            for (let i = 0; i < r.k; i++) {
                const t = new FastBit1024(500);
                const next = t.loadFrom(r.arena, off);
                assert.equal(next, (i + 1) * r.s.imageLength);
                assert.equal(t.equals(r.s), true);
                off = next;
            }
        });
    }
});
