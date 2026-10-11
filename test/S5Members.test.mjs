// test/S5Members.test.mjs -- S5 (1.5.0) ASSERTIONS 1-3: select, nextSubset,
// nextCombination. Independent oracle: plain per-bit scans and brute-force
// enumeration written here; nothing is imported from test/torture/ and no
// expected value is read back from the library under test.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FastBit32 } from '../FastBit32.js';

// ---- naive references ------------------------------------------------------
function bitsOf(w) {                       // bit i of the 32-bit word, 0/1 array
    const a = new Array(32);
    for (let i = 0; i < 32; i++) a[i] = Math.floor((w >>> 0) / 2 ** i) % 2;
    return a;
}
function fromBits(a) {                     // back to a signed int32
    let u = 0;
    for (let i = 0; i < 32; i++) if (a[i]) u += 2 ** i;
    return u | 0;
}
function popc(w) { let c = 0; for (const b of bitsOf(w)) c += b; return c; }
// k-th (0-based) set bit from the bottom, or -1 outside 0..popcount-1.
function refSelect(w, k) {
    const a = bitsOf(w);
    let seen = 0;
    for (let i = 0; i < 32; i++) {
        if (a[i]) { if (seen === k) return i; seen++; }
    }
    return -1;
}
// (sub - 1) restricted to mask, done on the compressed index: the mask's bit
// positions form an n-bit counter; decrement it mod 2^n and expand back.
function refNextSubset(sub, mask) {
    const m = bitsOf(mask), s = bitsOf(sub);
    const pos = [];
    for (let i = 0; i < 32; i++) if (m[i]) pos.push(i);
    let idx = 0;
    for (let j = 0; j < pos.length; j++) if (s[pos[j]]) idx += 2 ** j;
    idx = (idx - 1 + 2 ** pos.length) % 2 ** pos.length;
    const out = new Array(32).fill(0);
    for (let j = 0; j < pos.length; j++) out[pos[j]] = Math.floor(idx / 2 ** j) % 2;
    return fromBits(out);
}
// Next larger word with equal popcount: lowest "01" pair (bit i set, bit i+1
// clear) -> swap, then pack the ones that were below i down to bit 0. None -> 0.
function refNextComb(v) {
    const a = bitsOf(v);
    for (let i = 0; i < 31; i++) {
        if (a[i] === 1 && a[i + 1] === 0) {
            let c = 0;
            for (let j = 0; j < i; j++) { c += a[j]; a[j] = 0; }
            a[i] = 0; a[i + 1] = 1;
            for (let j = 0; j < c; j++) a[j] = 1;
            return fromBits(a);
        }
    }
    return 0;
}

// ---- seeded 32-bit PRNG (xorshift32), independent streams -------------------
function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return s;
    };
}

// ---- word corpus (ASSERTION 1) ----------------------------------------------
const words = [0, -1];
for (let i = 0; i < 32; i++) words.push((1 << i) | 0);
const lone = words.length;
for (let i = 0; i < 32; i++) for (let j = i + 1; j < 32; j++) words.push(((1 << i) | (1 << j)) | 0);
const two = words.length - lone;
const threeStart = words.length;
for (let i = 0; i < 32; i++) for (let j = i + 1; j < 32; j++) for (let l = j + 1; l < 32; l++) {
    const w = ((1 << i) | (1 << j) | (1 << l)) | 0;
    words.push(w); words.push(~w);
}
const three = (words.length - threeStart) / 2;
const wordRng = rng(0x5eed1234);
const randStart = words.length;
for (let i = 0; i < 20000; i++) words.push(wordRng() | 0);

const unsignedBuilt = (w) => new FastBit32(w >>> 0);   // ctor stores >>> 0
const signedBuilt = (w) => new FastBit32().set(w);      // mutator stores | 0

describe('S5 corpus coverage floor', () => {
    it('has the planned word counts', () => {
        assert.strictEqual(lone, 34);                    // 0, -1, 32 lone bits
        assert.strictEqual(two, 496);                    // C(32,2)
        assert.strictEqual(three, 4960);                 // C(32,3)
        assert.strictEqual(words.length - randStart, 20000);
        assert.ok(new Set(words.slice(randStart)).size > 19990);
    });
    it('the two builders really differ in representation', () => {
        assert.strictEqual(unsignedBuilt(-1).value, 4294967295);
        assert.strictEqual(signedBuilt(-1).value, -1);
    });
});

describe('select(k) -- ASSERTION 1', () => {
    for (const [name, build] of [['unsigned (ctor)', unsignedBuilt], ['signed (mutator)', signedBuilt]]) {
        it('matches the per-bit scan for k = -2..33, ' + name, () => {
            let rows = 0;
            for (const w of words) {
                const f = build(w);
                for (let k = -2; k <= 33; k++) {
                    const want = refSelect(w, k);
                    assert.strictEqual(f.select(k), want, 'w=' + (w >>> 0).toString(16) + ' k=' + k);
                    rows++;
                }
            }
            assert.ok(rows >= 30450 * 36);               // coverage floor
        });

        it('inverse laws: select(rank(b)) === b and rank(select(k)) === k, ' + name, () => {
            let n = 0;
            for (const w of words) {
                const f = build(w), c = popc(w);
                const a = bitsOf(w);
                for (let b = 0; b < 32; b++) {
                    if (a[b]) { assert.strictEqual(f.select(f.rank(b)), b); n++; }
                }
                for (let k = 0; k < c; k++) { assert.strictEqual(f.rank(f.select(k)), k); n++; }
                if (c > 0) {
                    assert.strictEqual(f.select(0), refSelect(w, 0));
                    assert.strictEqual(f.select(c - 1), refSelect(w, c - 1));
                }
                assert.strictEqual(f.select(c), -1);     // one past the end
            }
            assert.ok(n > 400000);
        });
    }

    it('empty word answers -1 for every k; full word is the identity', () => {
        const e = new FastBit32(), f = new FastBit32(-1);
        for (let k = -2; k <= 33; k++) {
            assert.strictEqual(e.select(k), -1);
            assert.strictEqual(f.select(k), k >= 0 && k <= 31 ? k : -1);
        }
    });
});

describe('static nextSubset(sub, mask) -- ASSERTION 2', () => {
    const maskRng = rng(0xC0FFEE11);
    const masks = [0, -(2 ** 31), 0x80000001 | 0, 0xF000000F | 0, 0x0000FFFF, 0xFFFF0000 | 0];
    let randMasks = 0;
    while (randMasks < 64) {                             // popcount <= 12
        let m = maskRng() | 0;
        for (let guard = 0; popc(m) > 12; guard++) m = (m & maskRng()) | 0;
        masks.push(m); randMasks++;
    }
    it('walks exactly 2^popcount distinct strictly-decreasing submasks ending at 0', () => {
        for (const mask of masks) {
            const want = 2 ** popc(mask);
            const seen = new Set();
            let s = mask, prev = Infinity, steps = 0;
            for (;;) {
                assert.ok(Object.is(s, s | 0), 'int32 result');
                assert.strictEqual((s & ~mask) | 0, 0, 'is a submask');
                assert.ok((s >>> 0) < prev, 'strictly decreasing as uint32');
                prev = s >>> 0;
                seen.add(s);
                steps++;
                if (s === 0) break;
                const nx = FastBit32.nextSubset(s, mask);
                assert.strictEqual(FastBit32.nextSubset(s >>> 0, mask >>> 0), nx, 'unsigned input, same output');
                s = nx;
            }
            assert.strictEqual(steps, want);
            assert.strictEqual(seen.size, want);
        }
        assert.ok(masks.length === 70);
    });
    it('sizes: 65536 for the 16-bit masks, 2 for -2^31', () => {
        for (const [mask, n] of [[0x0000FFFF, 65536], [0xFFFF0000 | 0, 65536], [-(2 ** 31), 2]]) {
            let s = mask, steps = 1;
            while (s !== 0) { s = FastBit32.nextSubset(s, mask); steps++; }
            assert.strictEqual(steps, n);
        }
    });
    it('matches the compress/decrement/expand reference on random pairs', () => {
        const r = rng(0xABCD0042);
        for (let i = 0; i < 3000; i++) {
            const mask = r() | 0, sub = (r() | 0) & mask;
            assert.strictEqual(FastBit32.nextSubset(sub, mask), refNextSubset(sub, mask));
        }
    });
    it('nextSubset(0, m) wraps to m; mask 0 stays 0', () => {
        for (const m of masks) assert.strictEqual(FastBit32.nextSubset(0, m), m | 0);
        assert.strictEqual(FastBit32.nextSubset(0, 0), 0);
    });
});

describe('static nextCombination(v) -- ASSERTION 3', () => {
    const plan = [[1, 32], [2, 496], [3, 4960], [4, 35960], [28, 35960], [29, 4960], [30, 496], [31, 32], [32, 1]];
    it('walks visit C(32,k) words each (82897 total)', () => {
        let total = 0;
        for (const [k, want] of plan) {
            let v = FastBit32.rangeMask(0, k - 1), prev = -1, n = 0, last = 0;
            while (v !== 0) {
                assert.ok(Object.is(v, v | 0), 'int32 result');
                assert.ok((v >>> 0) > prev, 'strictly increasing as uint32');
                assert.strictEqual(popc(v), k);
                prev = v >>> 0; last = v; n++;
                v = FastBit32.nextCombination(v);
            }
            assert.strictEqual(n, want, 'k=' + k);
            assert.strictEqual(last, ((0xFFFFFFFF << (32 - k)) | 0) , 'end word k=' + k);
            total += n;
        }
        assert.strictEqual(total, 82897);
    });
    it('sentinel and pinned edge words', () => {
        assert.strictEqual(FastBit32.nextCombination(0), 0);
        assert.strictEqual(FastBit32.nextCombination(-1), 0);          // k=32 word, never the end marker -1
        assert.strictEqual(FastBit32.nextCombination(0xE0000000 | 0), 0);
        assert.strictEqual(FastBit32.nextCombination(0x7FFFFFFF), 0xBFFFFFFF | 0);
    });
    it('matches the lowest-01-pair reference on random words', () => {
        const r = rng(0x1234ABCD);
        for (let i = 0; i < 5000; i++) {
            const v = r() | 0;
            assert.strictEqual(FastBit32.nextCombination(v), refNextComb(v), 'v=' + (v >>> 0).toString(16));
        }
        for (let b = 0; b < 32; b++) {                                 // top blocks
            const v = (-1 << (31 - b)) | 0;
            assert.strictEqual(FastBit32.nextCombination(v), refNextComb(v));
            assert.strictEqual(FastBit32.nextCombination(v >>> 0), refNextComb(v));
        }
    });
});
