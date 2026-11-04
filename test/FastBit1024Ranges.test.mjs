// test/FastBit1024Ranges.test.mjs -- 1.6.0 L3: FastBit1024#addRange / #removeRange (half-open [lo, hi)).
// INDEPENDENT ORACLE: written from the SPEC (.handoff/plan-fastbit1024-160.md, "Ranges plan -- L3",
// ASSERTIONS A1 / A2), not from FastBit32.js. Everything expected is built in this file one bit at
// a time: NAIVE[s * 32 + e] in-word masks (bits s..e), per-bit prefix counts of the base, and a
// Uint8Array bit model for the mixed sequence. Nothing from FastBit32's statics (no rangeMask /
// countRange) and nothing the class reports about itself is used as an expected value.
// Deterministic: seeded 32-bit xorshift, separate streams per purpose, no timing.
// Operation counts (A1) are derived by hand: for one base and capacity c, the enumeration visits
//   p3's lo / hi grid (step 1 within 70 of either end, else STEP) x 2 ops; e.g. c = 1 -> 3 pairs
//   (0,0) (0,1) (1,1) x 2 ops x 2 bases = 12. The other counts are the plan's A1 numbers; if the
//   enumeration below did not reproduce them it would be the enumeration that is wrong.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FastBit1024 } from '../FastBit32.js';

// ---- seeded 32-bit xorshift (Marsaglia 13/17/5), one factory, independent states ----
function stream(seed) {
    let x = seed | 0;
    if (x === 0) x = 1;
    return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
}

// ---- oracle part 1: NAIVE in-word masks, built one bit at a time ----
const NAIVE = new Int32Array(32 * 32);
for (let s = 0; s < 32; s++) {
    for (let e = s; e < 32; e++) {
        let m = 0;
        for (let b = s; b <= e; b++) m |= (1 << b);
        NAIVE[s * 32 + e] = m;
    }
}

// ---- oracle part 2: O1024, a bit model (one byte per bit) ----
class O1024 {
    constructor(cap) { this.cap = cap; this.b = new Uint8Array(1024); }
    clear() { this.b.fill(0); }
    setRange(lo, hi, v) { for (let i = lo; i < hi; i++) this.b[i] = v; }
    count() { let n = 0; for (let i = 0; i < 1024; i++) n += this.b[i]; return n; }
    word(w) { let v = 0; for (let k = 0; k < 32; k++) if (this.b[w * 32 + k]) v |= (1 << k); return v; }
}

// Expected receiver state from an array of 32 expected words: n by bit loop, summaries by word value.
function expectedOf(words) {
    let n = 0, active = 0, full = 0;
    for (let w = 0; w < 32; w++) {
        const v = words[w];
        for (let k = 0; k < 32; k++) if ((v >>> k) & 1) n++;
        if (v !== 0) active |= (1 << w);
        if (v === -1) full |= (1 << w);
    }
    return { n, active, full };
}

function snap(s) { return [s._cap, s._active, s._full, s._n, ...s._data].join(','); }

// ---- bases (as plain word arrays + exact bit arrays) ----
// A bit array (length 1024, 0 at and above cap) -> words.
function wordsOfBits(bits) {
    const out = new Int32Array(32);
    for (let b = 0; b < 1024; b++) if (bits[b]) out[b >>> 5] |= (1 << (b & 31));
    return out;
}
function randomBits(rnd, cap, density) {
    const bits = new Uint8Array(1024);
    for (let b = 0; b < cap; b++) bits[b] = (rnd() % 1000) < density ? 1 : 0;
    return bits;
}
// STRIPED: word w % 3 -> 0: full below capacity, 1: empty, 2: random (density 400).
function stripedBits(rnd, cap) {
    const bits = new Uint8Array(1024);
    for (let b = 0; b < cap; b++) {
        const m = (b >>> 5) % 3;
        bits[b] = m === 0 ? 1 : m === 1 ? 0 : ((rnd() % 1000) < 400 ? 1 : 0);
    }
    return bits;
}

const CAPS9 = [1, 31, 32, 33, 64, 65, 500, 1023, 1024];
const STEP = { 1: 1, 31: 1, 32: 1, 33: 1, 64: 1, 65: 1, 500: 3, 1023: 7, 1024: 1 };
const WANT_OPS = { 1: 12, 31: 2112, 32: 2244, 33: 2380, 64: 8580, 65: 8844, 500: 162328, 1023: 175972, 1024: 2103300 };
const CAPS16 = [1, 2, 31, 32, 33, 63, 64, 65, 500, 511, 512, 513, 993, 1000, 1023, 1024];

// One E5 sweep for a base over every (lo, hi, op). Returns the number of ops checked; throws on mismatch.
function sweep(cap, bits) {
    const baseData = wordsOfBits(bits);
    const baseState = expectedOf(baseData);
    // per-bit prefix counts of the base: pre[i] = set bits in [0, i)
    const pre = new Int32Array(1025);
    for (let i = 0; i < 1024; i++) pre[i + 1] = pre[i] + bits[i];
    const work = new FastBit1024(cap);
    const want = new Int32Array(32);
    const step = STEP[cap];
    let ops = 0;
    for (let lo = 0; lo <= cap; lo += (lo < 70 || cap - lo < 70) ? 1 : step) {
        for (let hi = lo; hi <= cap; hi += (hi - lo < 70 || cap - hi < 70) ? 1 : step) {
            for (let op = 0; op < 2; op++) {
                // reset by assigning fields (not via copy)
                work._data.set(baseData);
                work._n = baseState.n; work._active = baseState.active; work._full = baseState.full;
                const ret = op === 0 ? work.addRange(lo, hi) : work.removeRange(lo, hi);
                ops++;
                // expected words from NAIVE masks
                for (let w = 0; w < 32; w++) {
                    const ws = w << 5;
                    const s = lo > ws ? lo : ws, e = (hi - 1) < ws + 31 ? hi - 1 : ws + 31;
                    let m = 0;
                    if (s <= e) m = NAIVE[(s - ws) * 32 + (e - ws)];
                    want[w] = op === 0 ? (baseData[w] | m) : (baseData[w] & ~m);
                }
                const ones = pre[hi] - pre[lo];
                const wantN = op === 0 ? baseState.n + (hi - lo - ones) : baseState.n - ones;
                const ex = expectedOf(want);
                const tag = 'cap ' + cap + (op === 0 ? ' addRange(' : ' removeRange(') + lo + ', ' + hi + ')';
                if (ret !== work) assert.fail(tag + ' did not return this');
                for (let w = 0; w < 32; w++) {
                    if (work._data[w] !== want[w]) assert.strictEqual(work._data[w], want[w], tag + ' word ' + w);
                }
                if (work._n !== wantN) assert.strictEqual(work._n, wantN, tag + ' _n (prefix counts)');
                if (work._n !== ex.n) assert.strictEqual(work._n, ex.n, tag + ' _n (bit loop)');
                if (work._active !== ex.active) assert.strictEqual(work._active, ex.active, tag + ' _active');
                if (work._full !== ex.full) assert.strictEqual(work._full, ex.full, tag + ' _full');
            }
        }
    }
    return ops;
}

describe('FastBit1024 addRange / removeRange (1.6.0 L3)', () => {
    // E5: every capacity, two bases; trips on any wrong word, _n, _active or _full, or an inclusive-hi bug.
    for (const cap of CAPS9) {
        it('E5 exhaustive ranges at capacity ' + cap + ' (RANDOM + STRIPED bases)', () => {
            const rnd = stream(0x2545F491);
            const rand = randomBits(rnd, cap, 400);
            const striped = stripedBits(rnd, cap);
            const total = sweep(cap, rand) + sweep(cap, striped);
            assert.strictEqual(total, WANT_OPS[cap]);
        });
    }

    it('identities: return value is this, chaining, full range, empty range, add then remove restores', () => {
        for (const cap of CAPS16) {
            const s = new FastBit1024(cap);
            assert.strictEqual(s.addRange(0, cap), s);
            assert.strictEqual(s.size, cap);          // trips on an off-by-one in either bound
            assert.strictEqual(s.isFull(), true);
            assert.strictEqual(s.has(cap - 1), true);
            assert.strictEqual(s.removeRange(0, cap), s);
            assert.strictEqual(s.size, 0);
            assert.strictEqual(s.isEmpty(), true);
            // removeRange(0, cap) == clear
            s.addRange(0, cap);
            const c = new FastBit1024(cap);
            s.removeRange(0, cap);
            assert.strictEqual(snap(s), snap(c.clear()));
            // empty ranges (lo === hi) are no-ops, including lo = 0 and lo = cap
            s.add(0);
            const before = snap(s);
            for (const x of [0, 1, cap >> 1, cap]) {
                assert.strictEqual(s.addRange(x, x), s);
                assert.strictEqual(s.removeRange(x, x), s);
                assert.strictEqual(snap(s), before);
            }
            // add then remove of a range that was empty restores
            const t = new FastBit1024(cap);
            if (cap > 2) t.add(0);
            const tb = snap(t);
            const lo = cap > 2 ? 1 : 0, hi = cap;
            assert.strictEqual(t.addRange(lo, hi).removeRange(lo, hi), t);
            assert.strictEqual(snap(t), tb);
            // half-open: [lo, hi) leaves bit hi (when below capacity) untouched
            if (cap > 3) {
                const u = new FastBit1024(cap).addRange(1, 3);
                assert.deepStrictEqual([u.has(0), u.has(1), u.has(2), u.has(3)], [false, true, true, false]);
                assert.strictEqual(u.size, 2);
                u.addRange(0, cap).removeRange(1, 3);
                assert.deepStrictEqual([u.has(0), u.has(1), u.has(2), u.has(3)], [true, false, false, true]);
                assert.strictEqual(u.size, cap - 2);
            }
        }
        // chaining with the other mutators
        const ch = new FastBit1024(100).addRange(0, 10).removeRange(2, 4).add(50);
        assert.strictEqual(ch.size, 9);
    });

    it('A2 fail closed: 352 RangeError rows, 128 TypeError rows, receiver unchanged, valueOf once', () => {
        const rnd = stream(0x9E3779B9);
        const show = (v) => typeof v === 'number' ? String(v) : typeof v;
        let rangeRows = 0, typeRows = 0, objRows = 0;
        for (const cap of CAPS16) {
            const s = new FastBit1024(cap);
            const bits = randomBits(rnd, cap, 500);
            s._data.set(wordsOfBits(bits));
            const ex = expectedOf(s._data);
            s._n = ex.n; s._active = ex.active; s._full = ex.full;
            const before = snap(s);
            const bad = [[-1, 1], [0, cap + 1], [1, 0], [0.5, 2], ['0', 1], [null, 1], [0, undefined], [NaN, 1], [cap + 1, cap + 1], [0, 2048], [2 ** 32, 1]];
            for (const [lo, hi] of bad) {
                for (const name of ['addRange', 'removeRange']) {
                    let err = null;
                    try { s[name](lo, hi); } catch (e) { err = e; }
                    assert.ok(err instanceof RangeError, name + '(' + String(lo) + ', ' + String(hi) + ') cap ' + cap + ' must throw RangeError');
                    assert.strictEqual(err.message, 'FastBit1024: range must be integers 0 <= lo <= hi <= ' + cap + ', got ' + show(lo) + ', ' + show(hi));
                    assert.strictEqual(snap(s), before);
                    rangeRows++;
                }
            }
            for (const [lo, hi] of [[Symbol('x'), 1], [0, Symbol('x')], [3n, 1], [0, 3n]]) {
                for (const name of ['addRange', 'removeRange']) {
                    let err = null;
                    try { s[name](lo, hi); } catch (e) { err = e; }
                    assert.ok(err instanceof TypeError, name + ' with a ' + typeof (typeof lo === 'number' ? hi : lo) + ' bound must throw TypeError');
                    assert.strictEqual(snap(s), before);
                    typeRows++;
                }
            }
            // an object bound is converted exactly once, then RangeError; the receiver is unchanged
            for (const name of ['addRange', 'removeRange']) {
                for (let pos = 0; pos < 2; pos++) {
                    let calls = 0;
                    const obj = { valueOf() { calls++; return 1; } };
                    let err = null;
                    try { if (pos === 0) s[name](obj, cap); else s[name](0, obj); } catch (e) { err = e; }
                    assert.ok(err instanceof RangeError);
                    assert.strictEqual(calls, 1, name + ' bound position ' + pos + ' cap ' + cap + ': valueOf calls');
                    assert.strictEqual(snap(s), before);
                    objRows++;
                }
            }
        }
        assert.strictEqual(rangeRows, 352);
        assert.strictEqual(typeRows, 128);
        assert.strictEqual(objRows, 64);
    });

    it('word ledger: reads === writes === w1 - w0 + 1 (words w0..w1); lo === hi touches 0 words', () => {
        // 13 values -> C(13, 2) = 78 pairs with lo < hi; the same 13 values give 13 lo === hi pairs x 2 ops = 26 calls.
        const V = [0, 1, 31, 32, 33, 63, 64, 65, 511, 512, 1000, 1023, 1024];
        const rnd = stream(0xC0FFEE11);
        const s = new FastBit1024(1024);
        const bits = randomBits(rnd, 1024, 500);
        const baseData = wordsOfBits(bits);
        const ex = expectedOf(baseData);
        let pairs = 0, calls = 0, emptyCalls = 0;
        let reads = null, writes = null;
        const counting = new Proxy(s._data, {
            get(t, p) { if (typeof p === 'string' && /^[0-9]+$/.test(p)) reads[+p] = (reads[+p] | 0) + 1; return Reflect.get(t, p, t); },
            set(t, p, v) { if (typeof p === 'string' && /^[0-9]+$/.test(p)) writes[+p] = (writes[+p] | 0) + 1; return Reflect.set(t, p, v, t); },
        });
        const raw = s._data;
        s._data = counting;
        const reset = () => { raw.set(baseData); s._n = ex.n; s._active = ex.active; s._full = ex.full; reads = {}; writes = {}; };
        for (let i = 0; i < V.length; i++) {
            for (let j = i; j < V.length; j++) {
                const lo = V[i], hi = V[j];
                for (const name of ['addRange', 'removeRange']) {
                    reset();
                    s[name](lo, hi);
                    if (lo === hi) {
                        assert.deepStrictEqual(reads, {}, name + ' empty range read a word at ' + lo);
                        assert.deepStrictEqual(writes, {}, name + ' empty range wrote a word at ' + lo);
                        emptyCalls++;
                    } else {
                        const w0 = lo >>> 5, w1 = (hi - 1) >>> 5;
                        const span = w1 - w0 + 1;
                        const keysR = Object.keys(reads).map(Number).sort((a, b) => a - b);
                        const keysW = Object.keys(writes).map(Number).sort((a, b) => a - b);
                        const wantKeys = [];
                        for (let w = w0; w <= w1; w++) wantKeys.push(w);
                        assert.deepStrictEqual(keysR, wantKeys, name + '(' + lo + ', ' + hi + ') words read');
                        assert.deepStrictEqual(keysW, wantKeys, name + '(' + lo + ', ' + hi + ') words written');
                        let nr = 0, nw = 0;
                        for (const k of keysR) nr += reads[k];
                        for (const k of keysW) nw += writes[k];
                        assert.strictEqual(nr, span, name + '(' + lo + ', ' + hi + ') reads');
                        assert.strictEqual(nw, span, name + '(' + lo + ', ' + hi + ') writes');
                        calls++;
                    }
                }
                if (lo < hi) pairs++;
            }
        }
        assert.strictEqual(pairs, 78);
        assert.strictEqual(calls, 156);
        assert.strictEqual(emptyCalls, 26);
    });

    it('per-bit mixed: 10,000 random add/remove ranges over 16 capacities match the bit model', () => {
        const keyS = stream(0x1F123BB5), opS = stream(0x6C8E9CF5), spanS = stream(0x2F6A4D01);
        let ops = 0, multi = 0, filled = 0, emptied = 0, noop = 0, tail = 0, mismatches = 0;
        for (const cap of CAPS16) {
            const s = new FastBit1024(cap);
            const o = new O1024(cap);
            for (let i = 0; i < 625; i++) {
                const kind = opS() & 1;
                const small = (spanS() & 1) === 0;
                const lo = keyS() % (cap + 1);
                const room = cap - lo;
                const span = small ? spanS() % ((room < 40 ? room : 40) + 1) : spanS() % (room + 1);
                const hi = lo + span;
                const beforeWords = [];
                for (let w = 0; w < 32; w++) beforeWords.push(o.word(w));
                o.setRange(lo, hi, kind === 0 ? 1 : 0);
                const ret = kind === 0 ? s.addRange(lo, hi) : s.removeRange(lo, hi);
                ops++;
                if (lo === hi) noop++;
                else {
                    const w0 = lo >>> 5, w1 = (hi - 1) >>> 5;
                    if (w1 > w0) multi++;
                    if (kind === 0 && hi < cap && o.b[hi] === 0) tail++;
                    for (let w = w0; w <= w1; w++) {
                        const nw = o.word(w);
                        if (kind === 0 && nw === -1 && beforeWords[w] !== -1) filled++;
                        if (kind === 1 && nw === 0 && beforeWords[w] !== 0) emptied++;
                    }
                }
                const words = [];
                for (let w = 0; w < 32; w++) words.push(o.word(w));
                const ex = expectedOf(words);
                let bad = ret !== s || s._n !== o.count() || s._n !== ex.n || s._active !== ex.active || s._full !== ex.full;
                for (let w = 0; w < 32 && !bad; w++) if (s._data[w] !== words[w]) bad = true;
                if (bad) mismatches++;
            }
        }
        assert.strictEqual(ops, 10000);
        assert.strictEqual(mismatches, 0);
        // coverage floors (from the oracle's own streams): each path must have been exercised
        assert.ok(multi >= 1000, 'multi-word ops ' + multi);
        assert.ok(filled >= 100, 'words filled ' + filled);
        assert.ok(emptied >= 100, 'words emptied ' + emptied);
        assert.ok(noop >= 20, 'empty ranges ' + noop);
        assert.ok(tail >= 500, 'add with hi < cap and bit hi clear ' + tail);
    });
});
