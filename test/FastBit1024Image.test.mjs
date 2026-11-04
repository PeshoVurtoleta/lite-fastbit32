// test/FastBit1024Image.test.mjs -- FastBit1024 image (G1, 1.6.0): imageLength,
// saveInto, loadFrom, serialize, static deserialize, copy, clone, equals and the
// private-name brand on copy / equals / hasAll / hasAny.
//
// ORACLE. Every expected value comes from the SPEC (.handoff/plan-fastbit1024-160.md
// C-1..C-14, ASSERTIONS 1-2; PROPOSAL Q-3: header 0x46420800 | capacity, then
// ceil(capacity / 32) LSB-first words) and from the image builder below, which
// sets bits ONE AT A TIME with plain arithmetic (2 ** k), never with the library
// and never with a shift. The library is only the thing under test. Nothing here
// imports the research candidate. The error messages are the PROPOSAL R-4 texts.
//
// Every test starts with need(): on the frozen 1.5.0 build (no saveInto) it fails,
// so no must-throw row can pass by accident on "x is not a function".
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';
import { FastBit1024 } from '../FastBit32.js';
import { fb1024Invariants, fb1024Snapshot } from './torture/oracle.mjs';

const ROOT = new URL('../', import.meta.url);

// ---- independent oracle ------------------------------------------------------
const TAG = 0x46420800;                       // Q-3: 'FB', version 1
const w32 = (u) => (u > 2147483647 ? u - 4294967296 : u);
const show = (v) => (typeof v === 'number' ? String(v) : typeof v);
const lenOf = (cap) => Math.ceil(cap / 32);

// image of (cap, Set of bits) built bit by bit
function refImage(cap, bits) {
    const u = new Array(1 + lenOf(cap)).fill(0);
    u[0] = TAG + cap;
    for (const k of bits) { assert.ok(k >= 0 && k < cap); u[1 + Math.floor(k / 32)] += 2 ** (k % 32); }
    return Int32Array.from(u, w32);
}
// the 32 data words a set holding `bits` must have
function refWords(bits) {
    const u = new Array(32).fill(0);
    for (const k of bits) u[Math.floor(k / 32)] += 2 ** (k % 32);
    return u.map(w32);
}
// seeded 32-bit-exact xorshift (Marsaglia 13/17/5), one independent stream per use
function xs(seed) {
    let s = seed | 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
}
function mk(cap, bits) { const s = new FastBit1024(cap); for (const b of bits) s.add(b); return s; }
function rndBits(rng, cap, per1000, top) {
    const out = new Set();
    for (let b = 0; b < cap; b++) if ((rng() % 1000) < per1000) out.add(b);
    if (top) out.add(cap - 1);
    return out;
}
function expectState(s, cap, bits, label) {
    assert.equal(s._cap, cap, label + ' cap');
    assert.equal(Array.prototype.join.call(s._data), refWords(bits).join(), label + ' words');
    assert.equal(s._n, bits.size, label + ' n');
    assert.equal(fb1024Invariants(s), null, label + ' I1-I4');
}
const bytesOf = (x) => { try { return Buffer.from(x.buffer, x.byteOffset, x.byteLength).toString('hex'); } catch { return 'nobuf'; } };

let MUST = 0;                                  // must-throw rows executed (ASSERTIONS 1)
function need() {
    for (const m of ['saveInto', 'loadFrom', 'serialize', 'copy', 'clone', 'equals']) {
        assert.equal(typeof FastBit1024.prototype[m], 'function', 'FastBit1024#' + m + ' missing');
    }
    assert.equal(typeof FastBit1024.deserialize, 'function', 'FastBit1024.deserialize missing');
    assert.equal(typeof Object.getOwnPropertyDescriptor(FastBit1024.prototype, 'imageLength')?.get, 'function', 'imageLength missing');
}
// one must-throw row: class, exact message (when given), receiver fully unchanged, buffers unchanged
function rej(recv, fn, Cls, msg, bufs = [], label = '') {
    MUST++;
    const before = recv ? fb1024Snapshot(recv) : '', data = recv ? recv._data : null;
    const b0 = bufs.map(bytesOf);
    let err = null;
    try { fn(); } catch (e) { err = e; }
    assert.ok(err !== null, label + ': did not throw');
    assert.equal(err.constructor, Cls, label + ': threw ' + err.constructor.name + ' ' + err.message);
    if (msg !== undefined) assert.equal(err.message, msg, label);
    if (recv) { assert.equal(fb1024Snapshot(recv), before, label + ': receiver changed'); assert.equal(recv._data, data, label + ': _data replaced'); }
    bufs.forEach((b, i) => assert.equal(bytesOf(b), b0[i], label + ': buffer changed'));
}
const M_OFF = (v) => 'FastBit1024: offset must be a non-negative integer that fits the image, got ' + show(v);
const M_IMG = (w) => 'FastBit1024: bad image: ' + w;
const M_FIT = (cap) => 'FastBit1024: a set bit is at or above capacity ' + cap;
const M_BUF = (what) => 'FastBit1024: ' + what + ' must be an Int32Array';
const M_OTHER = (o) => 'FastBit1024: expected a FastBit1024, got ' + (o === null ? 'null' : typeof o);

const CAPS9 = [1, 31, 32, 33, 63, 64, 500, 1023, 1024];
const CAPS16 = [1, 2, 31, 32, 33, 63, 64, 65, 500, 511, 512, 513, 993, 1000, 1023, 1024];
// the bit patterns of a capacity: low, top valid bit (cap - 1), both, full, alternating
function patterns(cap) {
    const all = new Set(), alt = new Set();
    for (let b = 0; b < cap; b++) { all.add(b); if (b % 2 === 0) alt.add(b); }
    return [['empty', new Set()], ['{0}', new Set([0])], ['{cap-1}', new Set([cap - 1])], ['{0,cap-1}', new Set([0, cap - 1])],
        ['full', all], ['alt', alt], ['{31,32}', new Set([31, 32].filter((b) => b < cap))]];
}

// ==== layout, imageLength, saveInto =============================================
describe('FastBit1024 image: layout and saveInto', () => {
    it('imageLength is 1 + ceil(cap / 32) and serialize() is the oracle image, for every capacity 1..1024', () => {
        need();
        const rng = xs(0x1badb002);
        for (let cap = 1; cap <= 1024; cap++) {
            const bits = rndBits(rng, cap, 300, cap % 3 === 0);
            const s = mk(cap, bits);
            assert.equal(s.imageLength, 1 + lenOf(cap), 'imageLength cap ' + cap);
            const img = s.serialize();
            assert.ok(img instanceof Int32Array && Object.getPrototypeOf(img) === Int32Array.prototype);
            assert.equal(img.length, 1 + lenOf(cap));
            assert.equal(img.join(), refImage(cap, bits).join(), 'serialize cap ' + cap);
        }
        assert.equal(new FastBit1024(500).serialize()[0], 0x464209F4, 'cap 500 header (Q-3: 0x46420800 + 0x1F4)');
    });

    it('saveInto writes exactly [offset, offset + imageLength), returns the end, leaves every other word alone', () => {
        need();
        for (const cap of CAPS9) for (const [name, bits] of patterns(cap)) for (const off of [0, 1, 7]) {
            const s = mk(cap, bits), n = 1 + lenOf(cap);
            const out = new Int32Array(off + n + 5).fill(0x5a5a5a5a);
            const ret = s.saveInto(out, off);
            const want = new Int32Array(off + n + 5).fill(0x5a5a5a5a);
            want.set(refImage(cap, bits), off);
            assert.equal(ret, off + n, cap + ' ' + name + ' off ' + off);
            assert.equal(out.join(), want.join(), cap + ' ' + name + ' off ' + off);
        }
        // default offset is 0
        const s = mk(33, [32]);
        assert.equal(s.saveInto(new Int32Array(3)), 3);
    });

    it('saveInto chains through one arena (return value feeds the next offset)', () => {
        need();
        const a = mk(500, [0, 499]), b = mk(33, [32]), c = mk(1, [0]);
        const arena = new Int32Array(3 + a.imageLength + b.imageLength + c.imageLength);
        let o = a.saveInto(arena, 3); o = b.saveInto(arena, o); o = c.saveInto(arena, o);
        assert.equal(o, arena.length);
        const want = [0, 0, 0, ...refImage(500, new Set([0, 499])), ...refImage(33, new Set([32])), ...refImage(1, new Set([0]))];
        assert.equal(arena.join(), want.join());
    });

    it('a saved image does not alias the set (later writes do not reach the image)', () => {
        need();
        const s = mk(64, [1]), out = new Int32Array(3);
        s.saveInto(out);
        s.add(40);
        assert.equal(out.join(), refImage(64, new Set([1])).join());
    });
});

// ==== loadFrom from oracle-built images ===========================================
describe('FastBit1024 image: loadFrom from oracle images', () => {
    it('loads every pattern at every offset, ignores garbage before and AFTER the image, overwrites junk', () => {
        need();
        const rng = xs(0xc0ffee11);
        for (const cap of CAPS9) for (const [name, bits] of patterns(cap)) for (const off of [0, 1, 5, 40]) {
            const img = refImage(cap, bits), n = img.length;
            const src = new Int32Array(off + n + 40);
            for (let i = 0; i < src.length; i++) src[i] = (rng() | 0);     // garbage everywhere
            src.set(img, off);
            src.fill(-1, off + n, off + n + 8);                           // all-ones garbage right after
            const r = mk(cap, rndBits(rng, cap, 500, false));              // junk the load must clear
            const ret = r.loadFrom(src, off);
            assert.equal(ret, off + n, cap + ' ' + name + ' off ' + off);
            expectState(r, cap, bits, cap + ' ' + name + ' off ' + off);
        }
    });

    it('the top valid bit (cap - 1) survives, at every capacity 1..1024', () => {
        need();
        for (let cap = 1; cap <= 1024; cap++) {
            const bits = new Set([cap - 1]);
            const r = new FastBit1024(cap);
            r.loadFrom(refImage(cap, bits));
            expectState(r, cap, bits, 'cap ' + cap);
        }
    });

    it('loadFrom of an empty image into a full set empties it; a full image fills all 32 words', () => {
        need();
        const r = mk(1024, patterns(1024)[4][1]);
        assert.equal(r._full, -1);
        r.loadFrom(refImage(1024, new Set()));
        expectState(r, 1024, new Set(), 'emptied');
        assert.equal(r._active, 0); assert.equal(r._full, 0);
        r.loadFrom(refImage(1024, patterns(1024)[4][1]));
        assert.equal(r._full, -1); assert.equal(r._active, -1); assert.equal(r._n, 1024);
    });

    it('deserialize returns a base FastBit1024 with the image capacity (also from a subclass, at an offset)', () => {
        need();
        class Sub extends FastBit1024 {}
        for (const cap of CAPS9) for (const [name, bits] of patterns(cap)) {
            const src = new Int32Array(3 + 1 + lenOf(cap) + 3).fill(-1);
            src.set(refImage(cap, bits), 3);
            for (const D of [FastBit1024, Sub]) {
                const d = D.deserialize(src, 3);
                assert.equal(Object.getPrototypeOf(d), FastBit1024.prototype, 'always a base instance');
                expectState(d, cap, bits, cap + ' ' + name);
            }
        }
    });

    it('JSON path: new Int32Array(JSON.parse(JSON.stringify(Array.from(img)))) round-trips', () => {
        need();
        for (const cap of CAPS9) for (const [name, bits] of patterns(cap)) {
            const img = refImage(cap, bits);
            const back = new Int32Array(JSON.parse(JSON.stringify(Array.from(img))));
            expectState(FastBit1024.deserialize(back), cap, bits, cap + ' ' + name);
        }
    });
});

// ==== cross capacity (Q-1) =========================================================
describe('FastBit1024 image: cross-capacity loads and copies (Q-1)', () => {
    it('every (image cap, receiver cap) pair: fits -> exact; does not fit -> RangeError, receiver unchanged', () => {
        need();
        const rng = xs(0xfeedbeef);
        let fit = 0, nofit = 0;
        for (const ic of CAPS9) for (const rc of CAPS9) {
            const lowTop = Math.min(ic, rc) - 1;
            const cases = [['low', new Set([0, lowTop])], ['top', new Set([ic - 1])], ['full', patterns(ic)[4][1]], ['empty', new Set()]];
            for (const [name, bits] of cases) {
                const fits = [...bits].every((b) => b < rc);      // the Q-1 rule, stated independently
                const junk = rndBits(rng, rc, 400, false);
                const r1 = mk(rc, junk), r2 = mk(rc, junk);
                const src = mk(ic, bits);
                if (fits) {
                    fit++;
                    r1.loadFrom(refImage(ic, bits)); expectState(r1, rc, bits, 'load ' + ic + '->' + rc + ' ' + name);
                    r2.copy(src); expectState(r2, rc, bits, 'copy ' + ic + '->' + rc + ' ' + name);
                    assert.equal(r1.equals(src), true); assert.equal(src.equals(r1), true);
                } else {
                    nofit++;
                    rej(r1, () => r1.loadFrom(refImage(ic, bits)), RangeError, M_FIT(rc), [], 'load ' + ic + '->' + rc + ' ' + name);
                    rej(r2, () => r2.copy(src), RangeError, M_FIT(rc), [], 'copy ' + ic + '->' + rc + ' ' + name);
                    assert.equal(fb1024Snapshot(r1), fb1024Snapshot(mk(rc, junk)));
                }
            }
        }
        assert.ok(fit >= 150 && nofit >= 40, 'coverage floor: fit ' + fit + ' nofit ' + nofit);
    });

    it('clone: same capacity, same bits, independent storage; copy(self) is a no-op; copy returns this', () => {
        need();
        for (const cap of CAPS9) for (const [name, bits] of patterns(cap)) {
            const s = mk(cap, bits), c = s.clone();
            assert.notEqual(c, s); assert.notEqual(c._data, s._data);
            assert.equal(Object.getPrototypeOf(c), FastBit1024.prototype);
            expectState(c, cap, bits, cap + ' ' + name);
            c.add(0); c.remove(cap - 1);
            expectState(s, cap, bits, 'source untouched');
            const before = fb1024Snapshot(s);
            assert.equal(s.copy(s), s); assert.equal(fb1024Snapshot(s), before);
            const t = new FastBit1024(cap);
            assert.equal(t.copy(s), t);
        }
    });

    it('equals: same bits regardless of capacity; one differing bit (any word, any position) -> false', () => {
        need();
        assert.equal(mk(500, [3]).equals(mk(1024, [3])), true);
        assert.equal(mk(1024, [3]).equals(mk(1, [])), false);
        assert.equal(new FastBit1024(1).equals(new FastBit1024(1024)), true);
        const rng = xs(0xabcdef01);
        for (const cap of CAPS9) {
            const bits = rndBits(rng, cap, 300, true);
            const a = mk(cap, bits);
            assert.equal(a.equals(a), true);
            assert.equal(a.equals(mk(cap, bits)), true);
            for (let k = 0; k < cap; k += (cap > 100 ? 7 : 1)) {
                const t = new Set(bits); if (t.has(k)) t.delete(k); else t.add(k);
                const b = mk(cap, t);
                assert.equal(a.equals(b), false, cap + ' flip ' + k); assert.equal(b.equals(a), false);
            }
            // same count and same active words, different bit within a word
            const c = mk(cap, [0]), d = mk(cap, [cap > 1 ? 1 : 0]);
            assert.equal(c.equals(d), cap === 1);
        }
    });
});

// ==== p2: fail-closed rows (744) and round trips (19,200) ==========================
describe('FastBit1024 image: p2 fail-closed rows and round trips (seed 0x9e3779b9)', () => {
    it('744 p2 G1 rows: stated class, exact message, receiver unchanged, out unchanged', () => {
        need();
        const rng = xs(0x9e3779b9);
        const start = MUST;
        let outChecks = 0;
        for (const cap of CAPS16) {
            const bits = rndBits(rng, cap, 300, false);
            const s = mk(cap, bits), L = lenOf(cap);
            const good = refImage(cap, bits);
            // 1. a bit at / above the capacity in the image's last word
            if ((cap & 31) !== 0) {
                const bad = good.slice(); bad[L] += 2 ** (cap % 32); bad[L] |= 0;
                rej(s, () => s.loadFrom(bad), RangeError, M_IMG('bit >= image capacity'), [], 'cap ' + cap + ' bit == cap');
                const bad2 = good.slice(); bad2[L] |= -2147483648;
                rej(s, () => s.loadFrom(bad2), RangeError, M_IMG('bit >= image capacity'), [], 'cap ' + cap + ' bit 31');
            }
            // 2. header damage (expected: capacity word out of 1..1024 -> 'capacity', wrong tag / version -> 'header')
            for (const [h, why] of [[0, 'header'], [-1, 'header'], [TAG, 'capacity'], [TAG | 1025, 'capacity'], [TAG | 2047, 'capacity'],
                [(TAG ^ 2048) | cap, 'header'], [0x46410800 | cap, 'header'], [cap, 'header']]) {
                const bad = good.slice(); bad[0] = h;
                rej(s, () => s.loadFrom(bad), RangeError, M_IMG(why), [], 'cap ' + cap + ' header ' + h);
            }
            // 3. truncated image
            rej(s, () => s.loadFrom(good.subarray(0, L)), RangeError, M_IMG('length'), [], 'cap ' + cap + ' truncated');
            // 4. offset damage
            for (const off of [-1, 1.5, NaN, '0', null, 2 ** 31, good.length, 1]) {
                rej(s, () => s.loadFrom(good, off), RangeError, off === 1 ? M_IMG('header') : M_OFF(off), [], 'cap ' + cap + ' offset ' + String(off));
            }
            // 5. not an Int32Array
            for (const src of [null, {}, 'abc', 42, new Uint32Array(good.length), new Float64Array(good.length), new Uint8Array(4)]) {
                rej(s, () => s.loadFrom(src), TypeError, M_BUF('src'), [], 'cap ' + cap + ' src ' + (src === null ? 'null' : src.constructor.name));
            }
            // 6. a plain Array and a Proxy over an Int32Array
            rej(s, () => s.loadFrom(Array.from(good)), TypeError, M_BUF('src'), [], 'cap ' + cap + ' Array');
            rej(s, () => s.loadFrom(new Proxy(good.slice(), {})), TypeError, M_BUF('src'), [], 'cap ' + cap + ' Proxy');
            rej(null, () => FastBit1024.deserialize(Array.from(good)), TypeError, M_BUF('src'), [], 'cap ' + cap + ' deserialize(Array)');
            // 7. a bigger image whose bits do not fit
            if (cap < 1024) {
                const big = refImage(1024, new Set([0, cap]));
                rej(s, () => s.loadFrom(big), RangeError, M_FIT(cap), [], 'cap ' + cap + ' 1024-image bit ' + cap);
                rej(s, () => s.copy(mk(1024, [0, cap])), RangeError, M_FIT(cap), [], 'cap ' + cap + ' copy bit ' + cap);
                rej(s, () => s.loadFrom(refImage(1024, new Set([1023]))), RangeError, M_FIT(cap), [], 'cap ' + cap + ' 1024-image bit 1023');
            }
            // 8. copy / equals: wrong type
            for (const o of [null, {}, 42, s._data]) {
                rej(s, () => s.copy(o), TypeError, M_OTHER(o), [], 'cap ' + cap + ' copy ' + typeof o);
                rej(s, () => s.equals(o), TypeError, M_OTHER(o), [], 'cap ' + cap + ' equals ' + typeof o);
            }
            // 9. saveInto: too small / wrong type / bad offset, out unchanged
            {
                const out = new Int32Array(L + 1).fill(7), short = new Int32Array(L), u32 = new Uint32Array(L + 1), arr = [];
                const rows = [['short out', short, 0, RangeError, M_OFF(0)], ['offset 1 overflow', out, 1, RangeError, M_OFF(1)],
                    ['offset -1', out, -1, RangeError, M_OFF(-1)], ['offset 0.5', out, 0.5, RangeError, M_OFF(0.5)],
                    ['Array out', arr, 0, TypeError, M_BUF('out')], ['Uint32Array out', u32, 0, TypeError, M_BUF('out')]];
                for (const [lbl, o, off, Cls, msg] of rows) rej(s, () => s.saveInto(o, off), Cls, msg, [o], 'cap ' + cap + ' saveInto ' + lbl);
                outChecks++; MUST++;
                assert.equal(out.join(), new Int32Array(L + 1).fill(7).join(), 'cap ' + cap + ' out written by a rejected saveInto');
            }
        }
        // deserialize: bad headers never construct
        for (const [h, why] of [[0, 'header'], [TAG, 'capacity'], [TAG | 1025, 'capacity']]) {
            rej(null, () => FastBit1024.deserialize(new Int32Array([h, 0])), RangeError, M_IMG(why), [], 'deserialize header ' + h);
        }
        assert.equal(outChecks, 16);
        assert.equal(MUST - start, 744, 'p2 G1 row count (ASSERTIONS 1)');
    });

    it('19,200 round trips (16 caps x 200 reps x 6 checks) against the oracle, with a coverage floor', () => {
        need();
        const bitsRng = xs(0x9e3779b9), opRng = xs(0x2545f491);    // independent key and op streams
        const DENS = [0, 5, 100, 500, 900, 995, 1000];
        let trips = 0, topSet = 0, nonEmpty = 0, full = 0, offs = 0, garbage = 0;
        for (let rep = 0; rep < 200; rep++) for (const cap of CAPS16) {
            const top = rep % 3 === 0;
            const abits = rndBits(bitsRng, cap, DENS[rep % 7], top), bbits = rndBits(bitsRng, cap, (rep * 37) % 1000, false);
            const a = mk(cap, abits), b = mk(cap, bbits);
            if (abits.has(cap - 1)) topSet++;
            if (abits.size > 0) nonEmpty++;
            if (abits.size === cap) full++;
            const ref = refImage(cap, abits), n = ref.length;
            const off = opRng() % 9, tail = opRng() % 5; if (off > 0) offs++; if (tail > 0) garbage++;
            // 1. serialize == oracle; load the ORACLE image (at an offset, garbage around it) into a junk receiver
            assert.equal(a.serialize().join(), ref.join(), 'serialize ' + cap + ' rep ' + rep); trips++;
            const src = new Int32Array(off + n + tail).fill(-1); src.set(ref, off);
            const junk = mk(cap, bbits);
            assert.equal(junk.loadFrom(src, off), off + n); expectState(junk, cap, abits, 'load ' + cap + ' rep ' + rep); trips++;
            // 2. JSON path
            const c = FastBit1024.deserialize(new Int32Array(JSON.parse(JSON.stringify(Array.from(ref)))));
            expectState(c, cap, abits, 'json ' + cap); trips++;
            // 3. copy + clone
            expectState(b.copy(a), cap, abits, 'copy ' + cap); expectState(a.clone(), cap, abits, 'clone ' + cap); trips++;
            // 4. load into a 1024 receiver full of junk
            const big = mk(1024, rndBits(bitsRng, 1024, 500, false)); big.loadFrom(ref); expectState(big, 1024, abits, 'into 1024 ' + cap); trips++;
            // 5. a 1024-image whose bits all fit a smaller receiver; 6. arena of two images
            const small = mk(cap, bbits); small.loadFrom(refImage(1024, abits)); expectState(small, cap, abits, 'fit 1024-image ' + cap);
            const bb = mk(cap, bbits), arena = new Int32Array(off + 2 * n + tail).fill(0x13579bdf);
            const o1 = mk(cap, abits).saveInto(arena, off), o2 = bb.saveInto(arena, o1);
            const a2 = new FastBit1024(cap), b2 = new FastBit1024(cap), p1 = a2.loadFrom(arena, off), p2 = b2.loadFrom(arena, p1);
            assert.equal(o2, off + 2 * n); assert.equal(p2, off + 2 * n);
            assert.equal(arena.slice(off, o2).join(), [...ref, ...refImage(cap, bbits)].join());
            expectState(a2, cap, abits, 'arena a'); expectState(b2, cap, bbits, 'arena b'); trips++;
        }
        assert.equal(trips, 19200);
        assert.ok(topSet >= 1000 && nonEmpty >= 2500 && full >= 400 && offs >= 2000 && garbage >= 2000,
            'coverage floor ' + [topSet, nonEmpty, full, offs, garbage]);
    });
});

// ==== Q-8: private-name brand on copy / equals / hasAll / hasAny ====================
describe('FastBit1024 image: private-name brand (Q-8, C-3)', () => {
    const METHODS = ['copy', 'equals', 'hasAll', 'hasAny'];
    const forgery = () => { const f = Object.create(FastBit1024.prototype); f._cap = 1024; f._active = 1; f._full = 0; f._n = 5000; f._data = new Int32Array(32); f._data[0] = 1; return f; };

    it('12 rows: forgery, Proxy of a real set, Proxy lying about _active x 4 methods -> TypeError, nothing changes', () => {
        need();
        for (const m of METHODS) {
            const real = mk(1024, [3, 900]);
            let n = 0;
            const lying = new Proxy(real, { get(t, k) { if (k === '_active') return n++ === 0 ? 1 : Reflect.get(t, k); return Reflect.get(t, k); } });
            for (const [lbl, o] of [['forgery', forgery()], ['Proxy', new Proxy(real, { get(t, k) { return k === '_n' ? 999 : Reflect.get(t, k); } })], ['lying _active', lying]]) {
                const r = mk(100, [5]);
                rej(r, () => r[m](o), TypeError, M_OTHER(o), [], m + ' ' + lbl);
            }
            assert.equal(n, 0, 'the lying proxy was never even read');
        }
    });

    it('primitives and objects keep the 1.5.0-style message; V8\'s "Cannot use in" never surfaces', () => {
        need();
        for (const m of METHODS) for (const o of [undefined, null, 0, 1n, 'x', true, Symbol('s'), () => 0, {}, [], Object.create(null), new FastBit1024(8)._data]) {
            const r = mk(64, [1]);
            rej(r, () => r[m](o), TypeError, M_OTHER(o), [], m + ' ' + String(typeof o));
        }
    });

    it('a subclass instance passes the brand both ways (copy / equals / hasAll / hasAny)', () => {
        need();
        class Sub extends FastBit1024 {}
        const base = mk(64, [5, 63]), sub = new Sub(64); sub.add(5).add(63);
        assert.equal(base.equals(sub), true); assert.equal(sub.equals(base), true);
        assert.equal(base.hasAll(sub), true); assert.equal(sub.hasAny(base), true);
        const t = new FastBit1024(64).copy(sub); expectState(t, 64, new Set([5, 63]), 'copy from sub');
        const u = new Sub(64).copy(base); expectState(u, 64, new Set([5, 63]), 'copy into sub');
        const c = sub.clone(); assert.equal(Object.getPrototypeOf(c), FastBit1024.prototype);
        expectState(c, 64, new Set([5, 63]), 'clone of sub');
    });

    it('a set from a second module instance throws TypeError both ways; its images are interchangeable', async () => {
        need();
        const copy = await import(new URL('FastBit32.js?img-copy=' + process.pid, ROOT).href);
        const Other = copy.FastBit1024;
        assert.notEqual(Other, FastBit1024);
        const mine = mk(64, [1, 63]), theirs = new Other(64); theirs.add(1).add(63);
        for (const m of METHODS) {
            rej(mine, () => mine[m](theirs), TypeError, M_OTHER(theirs), [], 'mine.' + m);
            rej(theirs, () => theirs[m](mine), TypeError, M_OTHER(mine), [], 'theirs.' + m);
        }
        // the image is a plain Int32Array: it crosses module instances
        const img = theirs.serialize();
        assert.equal(img.join(), refImage(64, new Set([1, 63])).join());
        const r = new FastBit1024(64); r.loadFrom(img); expectState(r, 64, new Set([1, 63]), 'cross-module load');
        const d = Other.deserialize(mine.serialize()); assert.ok(d instanceof Other); assert.equal(d.has(63), true);
    });
});

// ==== p7 / p8 / Q-9 / Q-10 / hostile ================================================
describe('FastBit1024 image: hostile sources (p7, p8, Q-9, Q-10)', () => {
    const img500 = () => refImage(500, new Set([3]));

    it('p7 rows 1-3 (Array accessor, flipping Proxy, Proxy returning 1.5) -> TypeError; receiver unchanged', () => {
        need();
        const img = img500(), L = img.length;
        const arr = Array.from(img); let n = 0;
        Object.defineProperty(arr, L - 1, { get() { return n++ === 0 ? 0 : -1; } });
        const flip = new Proxy(img.slice(), { get(t, k) { if (k === String(L - 1)) return -1; const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v; } });
        const frac = new Proxy(img.slice(), { get(t, k) { if (k === '1') return 1.5; const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v; } });
        for (const [lbl, src] of [['Array accessor', arr], ['flipping Proxy', flip], ['1.5 Proxy', frac]]) {
            const r = mk(500, [9]);
            rej(r, () => r.loadFrom(src), TypeError, M_BUF('src'), [], lbl);
        }
    });

    it('p8 rows 1-3 (copy through a forgery / Proxy / lying Proxy) -> TypeError; row 4 (5 real words of 17) -> RangeError length', () => {
        need();
        const f = Object.create(FastBit1024.prototype); Object.assign(f, { _cap: 1024, _active: 1, _full: 0, _n: 5000, _data: new Int32Array(32) });
        f._data[0] = 1;
        const s1 = mk(1024, []); rej(s1, () => s1.copy(f), TypeError, M_OTHER(f), [], 'p8 row 1');
        const real = mk(1024, [3]);
        const s2 = mk(1024, []); rej(s2, () => s2.copy(new Proxy(real, { get(t, k) { return k === '_n' ? 999 : Reflect.get(t, k); } })), TypeError, M_OTHER({}), [], 'p8 row 2');
        const real3 = mk(1024, [3, 900]); let n = 0;
        const s3 = mk(100, []); rej(s3, () => s3.copy(new Proxy(real3, { get(t, k) { if (k === '_active') return n++ === 0 ? 1 : Reflect.get(t, k); return Reflect.get(t, k); } })), TypeError, M_OTHER({}), [], 'p8 row 3');
        const bits = new Set(); for (let b = 0; b < 500; b += 7) bits.add(b);
        const img = refImage(500, bits);
        let calls = 0;
        class Liar extends Int32Array { get length() { calls++; return super.length + 64; } }
        const ta = new Liar(5); ta.set(img.subarray(0, 5));
        const r = mk(500, []);
        rej(r, () => r.loadFrom(ta), RangeError, M_IMG('length'), [], 'p8 row 4');
        assert.equal(calls, 0, 'the subclass getter is never called');
    });

    it('p7 Liar / Short and p8 row 5 (detach on the 2nd length read) load EXACTLY, with 0 subclass-getter calls', () => {
        need();
        const bits = new Set(); for (let b = 0; b < 500; b += 7) bits.add(b);
        const img = refImage(500, bits), L = img.length;
        let calls = 0;
        class Liar extends Int32Array { get length() { calls++; return super.length + 64; } }
        class Short extends Int32Array { get length() { calls++; return 1; } }
        class Det extends Int32Array { get length() { calls++; if (calls === 2) structuredClone(this.buffer, { transfer: [this.buffer] }); return L; } }
        for (const C of [Liar, Short, Det]) {
            const ta = new C(L); ta.set(img);
            const r = mk(500, [1, 2]);
            assert.equal(r.loadFrom(ta), L); expectState(r, 500, bits, 'load ' + C.name);
            assert.equal(FastBit1024.deserialize(ta).equals(mk(500, bits)), true);
            // saveInto through a subclass with a lying length getter writes exactly the image
            const out = new C(L + 3); const s = mk(500, bits);
            assert.equal(s.saveInto(out, 2), 2 + L);
            assert.equal(Array.from(Int32Array.prototype.slice.call(out, 2, 2 + L)).join(), img.join());
        }
        assert.equal(calls, 0, 'no subclass length getter was ever called');
    });

    it('Q-9: a counting getter installed BEFORE a fresh import is called exactly once per saveInto / loadFrom / deserialize', async () => {
        need();
        const TA = Object.getPrototypeOf(Int32Array.prototype);
        const dL = Object.getOwnPropertyDescriptor(TA, 'length');
        let nL = 0;
        Object.defineProperty(TA, 'length', { get() { nL++; return dL.get.call(this); }, configurable: true });
        let mod;
        try { mod = await import(new URL('FastBit32.js?q9-spy=' + process.pid + '-' + Date.now(), ROOT).href); }
        finally { Object.defineProperty(TA, 'length', dL); }
        const F = mod.FastBit1024;
        const s = new F(500); s.add(3); s.add(499);
        const out = new Int32Array(40), r = new F(500);
        const got = [];
        nL = 0; s.saveInto(out, 2); got.push(nL);
        nL = 0; r.loadFrom(out, 2); got.push(nL);
        nL = 0; const d = F.deserialize(out, 2); got.push(nL);
        nL = 0; const ser = s.serialize(); got.push(nL);           // serialize = saveInto once
        assert.deepEqual(got, [1, 1, 1, 1]);
        assert.equal(r.equals(s), true); assert.equal(d.equals(s), true);
        assert.equal(ser.join(), refImage(500, new Set([3, 499])).join());
        // a rejected brand reads the length ZERO times (the length is read after the brand)
        const u8 = new Uint8Array(40); Object.setPrototypeOf(u8, Int32Array.prototype);
        nL = 0; assert.throws(() => s.saveInto(u8), TypeError); assert.equal(nL, 0);
    });

    it('Q-9: a length / toStringTag getter patched AFTER import is never called; an own length property is ignored', () => {
        need();
        const TA = Object.getPrototypeOf(Int32Array.prototype);
        const dL = Object.getOwnPropertyDescriptor(TA, 'length'), dT = Object.getOwnPropertyDescriptor(TA, Symbol.toStringTag);
        let calls = 0, ok = false, tt = '';
        const s = mk(500, [3]), out = new Int32Array(17), r = new FastBit1024(500);
        Object.defineProperty(TA, 'length', { get() { calls++; return 999; }, configurable: true });
        Object.defineProperty(TA, Symbol.toStringTag, { get() { calls++; return 'Int32Array'; }, configurable: true });
        try {
            s.saveInto(out); r.loadFrom(out); FastBit1024.deserialize(out);
            const u8 = new Uint8Array(68); Object.setPrototypeOf(u8, Int32Array.prototype);
            try { r.saveInto(u8); } catch (e) { tt = e.constructor.name; }
            ok = r.has(3);
        } finally { Object.defineProperty(TA, 'length', dL); Object.defineProperty(TA, Symbol.toStringTag, dT); }
        assert.equal(calls, 0); assert.equal(ok, true); assert.equal(tt, 'TypeError');
        const own = new Int32Array(17); Object.defineProperty(own, 'length', { value: 1000 });
        s.saveInto(own); const r2 = new FastBit1024(500); r2.loadFrom(own); expectState(r2, 500, new Set([3]), 'own length');
    });

    it('Q-10: a view re-prototyped to Int32Array.prototype throws TypeError on saveInto, loadFrom, deserialize (20+ rows)', () => {
        need();
        const types = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array];
        if (typeof globalThis.Float16Array === 'function') types.push(globalThis.Float16Array);
        const start = MUST;
        for (const T of types) {
            const v = new T(64); Object.setPrototypeOf(v, Int32Array.prototype);
            assert.ok(ArrayBuffer.isView(v) && v instanceof Int32Array, T.name + ': the row is not vacuous (passes isView + instanceof)');
            const r1 = mk(500, [1, 2]);
            rej(r1, () => r1.saveInto(v, 0), TypeError, M_BUF('out'), [v], 'saveInto ' + T.name);
            const r2 = mk(500, [7]);
            rej(r2, () => r2.loadFrom(v, 0), TypeError, M_BUF('src'), [v], 'loadFrom ' + T.name);
            rej(null, () => FastBit1024.deserialize(v, 0), TypeError, M_BUF('src'), [v], 'deserialize ' + T.name);
        }
        assert.ok(MUST - start >= 30);
        // a DataView, a null-prototype Int32Array and a cross-realm Int32Array
        const dv = new DataView(new ArrayBuffer(256)); Object.setPrototypeOf(dv, Int32Array.prototype);
        const r = mk(500, [9]);
        rej(r, () => r.saveInto(dv), TypeError, M_BUF('out'), [dv], 'DataView out'); rej(r, () => r.loadFrom(dv), TypeError, M_BUF('src'), [dv], 'DataView src');
        const np = new Int32Array(64); Object.setPrototypeOf(np, null);
        rej(r, () => r.saveInto(np), TypeError, M_BUF('out'), [np], 'null proto out');
        const xr = vm.runInNewContext('new Int32Array(64)');
        rej(r, () => r.saveInto(xr), TypeError, M_BUF('out'), [xr], 'cross-realm out'); rej(r, () => r.loadFrom(xr), TypeError, M_BUF('src'), [xr], 'cross-realm src');
        const px = new Int32Array(64), p = new Proxy(px, {});
        rej(r, () => r.saveInto(p), TypeError, M_BUF('out'), [px], 'Proxy out'); rej(r, () => r.loadFrom(p), TypeError, M_BUF('src'), [px], 'Proxy src');
        rej(null, () => FastBit1024.deserialize(p), TypeError, M_BUF('src'), [px], 'Proxy deserialize');
        for (const x of [null, undefined, 0, 'x', [1, 2], {}, new ArrayBuffer(8)]) {
            rej(r, () => r.saveInto(x), TypeError, M_BUF('out'), [], 'saveInto ' + String(x)); rej(r, () => r.loadFrom(x), TypeError, M_BUF('src'), [], 'loadFrom ' + String(x));
        }
    });

    it('Q-10: a subclass of Int32Array passes the tag check, even one that overrides @@toStringTag', () => {
        need();
        class Sub extends Int32Array {}
        class Tagged extends Int32Array { get [Symbol.toStringTag]() { return 'Nope'; } }
        for (const C of [Sub, Tagged]) {
            const s = mk(500, [3, 499]), out = new C(20);
            assert.equal(s.saveInto(out, 1), 18);
            assert.equal(Array.from(Int32Array.prototype.slice.call(out, 1, 18)).join(), refImage(500, new Set([3, 499])).join());
            const r = new FastBit1024(500); assert.equal(r.loadFrom(out, 1), 18); expectState(r, 500, new Set([3, 499]), C.name);
            expectState(FastBit1024.deserialize(out, 1), 500, new Set([3, 499]), C.name + ' deserialize');
        }
    });

    it('detached out / src -> RangeError (offset-fit message "got 0"); a shrunk resizable buffer -> RangeError length', () => {
        need();
        const s = mk(500, [9]);
        const out = new Int32Array(64); structuredClone(out.buffer, { transfer: [out.buffer] });
        rej(s, () => s.saveInto(out), RangeError, M_OFF(0), [], 'detached out');
        const src = new Int32Array(64); src.set(refImage(500, new Set([3]))); structuredClone(src.buffer, { transfer: [src.buffer] });
        rej(s, () => s.loadFrom(src), RangeError, M_OFF(0), [], 'detached src');
        rej(null, () => FastBit1024.deserialize(src), RangeError, M_OFF(0), [], 'detached deserialize');
        const rab = new ArrayBuffer(68, { maxByteLength: 400 }), a = new Int32Array(rab);
        s.saveInto(a); rab.resize(40);
        rej(s, () => s.loadFrom(a), RangeError, M_IMG('length'), [], 'shrunk resizable src');
    });

    it('BigInt / Symbol offsets -> V8\'s own TypeError (class pinned); receiver and buffers unchanged', () => {
        need();
        const s = mk(500, [3]), out = new Int32Array(40), src = new Int32Array(40); src.set(refImage(500, new Set([3])));
        for (const off of [1n, 0n, Symbol('o')]) {
            rej(s, () => s.saveInto(out, off), TypeError, undefined, [out], 'saveInto ' + typeof off);
            rej(s, () => s.loadFrom(src, off), TypeError, undefined, [src], 'loadFrom ' + typeof off);
            rej(null, () => FastBit1024.deserialize(src, off), TypeError, undefined, [src], 'deserialize ' + typeof off);
        }
    });

    it('hostile offsets and header values on all three entry points', () => {
        need();
        const s = mk(500, [9]), good = refImage(500, new Set([3, 499]));
        for (const off of [2 ** 30, NaN, '1', 1.5, -1, null, 2 ** 31, Infinity, { valueOf() { return 0; } }]) {
            const out = new Int32Array(64), src = new Int32Array(64); src.set(good);
            rej(s, () => s.saveInto(out, off), RangeError, M_OFF(off), [out], 'saveInto off ' + String(typeof off === 'object' && off ? 'obj' : off));
            rej(s, () => s.loadFrom(src, off), RangeError, M_OFF(off), [src], 'loadFrom off');
            rej(null, () => FastBit1024.deserialize(src, off), RangeError, M_OFF(off), [src], 'deserialize off');
        }
        { // -0 is offset 0
            const out = new Int32Array(17), ret = s.saveInto(out, -0), r = new FastBit1024(500), ret2 = r.loadFrom(out, -0);
            assert.equal(ret, 17); assert.equal(ret2, 17); assert.equal(Object.is(ret, -0), false); expectState(r, 500, new Set([9]), '-0');
        }
        const H = (cap) => TAG | cap;
        const img = (cap, words, len) => { const a = new Int32Array(len ?? (1 + lenOf(cap))); a[0] = H(cap); for (const [w, v] of words) a[1 + w] = v; return a; };
        const cases = [
            ['cap 0', () => { const a = img(32, []); a[0] = TAG; return a; }, 'capacity'],
            ['cap 1025', () => { const a = new Int32Array(40); a[0] = H(1025); return a; }, 'capacity'],
            ['cap 2047', () => { const a = new Int32Array(40); a[0] = H(2047); return a; }, 'capacity'],
            ['version 2', () => { const a = img(32, []); a[0] = 0x46421000 | 32; return a; }, 'header'],
            ['version 0', () => { const a = img(32, []); a[0] = 0x46420000 | 32; return a; }, 'header'],
            ['tag wrong', () => { const a = img(32, []); a[0] = 0x46430800 | 32; return a; }, 'header'],
            ['len short by one', () => img(500, [], 16), 'length'],
            ['tail bit 500 of 500', () => img(500, [[15, 1048576]]), 'bit >= image capacity'],
            ['tail bit 31 cap 1', () => img(1, [[0, -2147483648]]), 'bit >= image capacity'],
            ['tail bit 1 cap 1', () => img(1, [[0, 2]]), 'bit >= image capacity'],
            ['tail bit 33 cap 33', () => img(33, [[1, 2]]), 'bit >= image capacity'],
        ];
        for (const [lbl, f, why] of cases) {
            const a = f();
            for (const cap of [1, 33, 500, 1024]) { const r = mk(cap, [0]); rej(r, () => r.loadFrom(a), RangeError, M_IMG(why), [a], 'loadFrom ' + lbl + ' into ' + cap); }
            rej(null, () => FastBit1024.deserialize(a), RangeError, M_IMG(why), [a], 'deserialize ' + lbl);
        }
    });

    it('a SAB-backed Int32Array (no concurrent writer) saves and loads exactly like a normal one (C-14 keeps SAB accepted)', () => {
        need();
        for (const cap of CAPS9) for (const [name, bits] of patterns(cap)) {
            const n = 1 + lenOf(cap), sab = new Int32Array(new SharedArrayBuffer(4 * (n + 6)));
            const s = mk(cap, bits);
            assert.equal(s.saveInto(sab, 3), 3 + n);
            const want = new Int32Array(n + 6); want.set(refImage(cap, bits), 3);
            assert.equal(sab.join(), want.join(), cap + ' ' + name);
            const r = mk(cap, [0]); assert.equal(r.loadFrom(sab, 3), 3 + n); expectState(r, cap, bits, 'sab ' + cap + ' ' + name);
            expectState(FastBit1024.deserialize(sab, 3), cap, bits, 'sab deser ' + cap + ' ' + name);
        }
    });
});

// ==== C-14: a concurrent writer on a SharedArrayBuffer =============================
describe('FastBit1024 image: SAB + worker (C-14)', () => {
    it('under a torn concurrent image I1-I4 and 1 <= cap <= 1024 hold after EVERY accepted loadFrom / deserialize', async () => {
        need();
        const OFF = 5, FLOOR = 50, sab = new SharedArrayBuffer(4 * 64), src = new Int32Array(sab);
        const ctl = new Int32Array(new SharedArrayBuffer(8));
        const w = new Worker(`const { workerData: [sab, c] } = require('node:worker_threads');
const a = new Int32Array(sab), ctl = new Int32Array(c), OFF = 5;
const CAPS = [1, 31, 32, 33, 64, 500, 1023, 1024]; const BAD = [0, 1025, 2047]; let x = 0x9e3779b9 | 0;
function nx() { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x; }
a[OFF] = 0x46420800 | 1024; Atomics.store(ctl, 1, 1);
while (Atomics.load(ctl, 0) === 0) {
  a[OFF] = 0x46420800 | CAPS[(nx() >>> 0) % 8];
  for (let w = 1; w <= 33; w++) a[OFF + w] = 0;
  for (let w = 1; w <= 33; w++) a[OFF + w] = -1;
  a[OFF] = 0x46420800 | BAD[(nx() >>> 0) % 3];
  a[OFF] = 0x46420800 | CAPS[(nx() >>> 0) % 8];
  for (let w = 1; w <= 33; w++) a[OFF + w] = nx();
  for (let w = 33; w >= 1; w--) a[OFF + w] = 0;
}`, { eval: true, workerData: [sab, ctl.buffer] });
        const report = [];
        try {
            while (Atomics.load(ctl, 1) === 0) await new Promise((r) => setTimeout(r, 5));
            for (const cap of [1, 32, 33, 500, 1024]) {
                const r = new FastBit1024(cap); let ok = 0, torn = 0, broke = 0, first = '';
                const t0 = Date.now();
                while ((torn < FLOOR || ok < 2000) && Date.now() - t0 < 8000) for (let k = 0; k < 200; k++) {
                    try { r.loadFrom(src, OFF); } catch (e) { assert.ok(e instanceof RangeError); continue; }
                    ok++; if (r._n > 0) torn++;
                    const v = fb1024Invariants(r); if (v !== null) { broke++; if (!first) first = v; }
                }
                report.push('loadFrom cap ' + cap + ' ok ' + ok + ' torn ' + torn);
                assert.equal(broke, 0, 'cap ' + cap + ' broke: ' + first);
                assert.ok(torn >= FLOOR, 'coverage floor (raced images with set bits) cap ' + cap + ': ' + torn);
            }
            let ok = 0, torn = 0, broke = 0, first = '';
            const t0 = Date.now();
            while ((torn < FLOOR || ok < 2000) && Date.now() - t0 < 8000) for (let k = 0; k < 200; k++) {
                let s; try { s = FastBit1024.deserialize(src, OFF); } catch (e) { assert.ok(e instanceof RangeError); continue; }
                ok++; if (s._n > 0) torn++;
                const v = fb1024Invariants(s);
                if (v !== null || !(s._cap >= 1 && s._cap <= 1024)) { broke++; if (!first) first = v || ('cap ' + s._cap); }
            }
            report.push('deserialize ok ' + ok + ' torn ' + torn);
            assert.equal(broke, 0, 'deserialize broke: ' + first);
            assert.ok(torn >= FLOOR, 'coverage floor deserialize: ' + torn);
        } finally { Atomics.store(ctl, 0, 1); await w.terminate(); }
    });
});

// ==== final tally ====================================================================
describe('FastBit1024 image: ASSERTIONS 1 tally', () => {
    it('at least 782 must-throw rows were executed (744 p2 + 12 Q-8 + 3 p7 + 4 p8 + 2 detached + 20 Q-10)', () => {
        need();
        assert.ok(MUST >= 782, 'must-throw rows executed: ' + MUST);
        if (process.env.IMG_ROWS) console.log('MUST-THROW ROWS ' + MUST);
    });
});
