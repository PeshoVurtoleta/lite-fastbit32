// test/S5QA.test.mjs -- QA boundary suite for the S5 (1.5.0) Tier-2 members:
// FastBit32#select(k), static FastBit32.nextSubset(sub, mask), static
// FastBit32.nextCombination(v). An oracle independent of the coder's AND of
// test/S5Members.test.mjs: words are read by arithmetic (Math.floor / 2 ** b),
// ToInt32 is computed by modular arithmetic (never `| 0`), and nextCombination
// is checked against the combinatorial number system (colex rank / unrank),
// which shares nothing with Gosper's hack or a "lowest 01 pair" scan.
// Fills what S5Members, Pinned S5 and the torture tiers do not pin:
//   - select on every int32 k edge (-2^31 .. 2^31-1) on the empty, full and
//     bit-31 words, both representations; result always an int in -1..31;
//   - settle (b): select(x) === select(x | 0) for EVERY non-int32 input,
//     k swept ACROSS the wrap points 2^31, 2^32 and 2^53 (not from 0); valueOf
//     read exactly once, after `this.value` (a re-entrant write is not seen);
//   - nextSubset on mask = -1 (2^32 values: structure, not a full walk) in
//     windows that cross 2^30, 2^31 (the int32 sign), 3 x 2^30 and the 0 -> -1
//     wrap; high-popcount masks against compress/decrement/expand; the literal
//     `(sub - 1) & mask` out of domain (non-submask, fractional, 2^53);
//     uint32 / mixed input parity;
//   - nextCombination for EVERY k = 1..32 at its first ranks, across the 2^30
//     and 2^31 thresholds and into the 0 sentinel; 3 x 65536 exhaustive 16-bit
//     windows (bit 31 included) + random words; numeric non-int32 parity;
//   - settle (a): FastBit1024 has no select; the statics are this-free;
//   - the README / llms.txt / d.ts recipes, executed FROM THE DOC TEXT.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FastBit32, FastBit1024 } from '../FastBit32.js';

const ROOT = new URL('../', import.meta.url);
const P32 = 4294967296, P31 = 2147483648, P30 = 1073741824;

// ---- independent oracle -------------------------------------------------------
// ToInt32 by modular arithmetic (spec 7.1.6), no bitwise operator.
function toI32(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    const t = Math.trunc(n);
    const m = ((t % P32) + P32) % P32;
    return m >= P31 ? m - P32 : m + 0;           // + 0 turns -0 into +0
}
const u32 = (x) => { const i = toI32(x); return i < 0 ? i + P32 : i; };
const bitOf = (w, b) => Math.floor(u32(w) / 2 ** b) % 2;
function popc(w) { let n = 0; for (let b = 0; b < 32; b++) n += bitOf(w, b); return n; }
function sel(w, k) {                           // k-th set bit, or -1
    let n = 0;
    for (let b = 0; b < 32; b++) if (bitOf(w, b) === 1) { if (n === k) return b; n++; }
    return -1;
}
function andArith(a, b) {                       // a & b as int32, per bit
    let r = 0;
    for (let i = 0; i < 32; i++) if (bitOf(a, i) === 1 && bitOf(b, i) === 1) r += 2 ** i;
    return toI32(r);
}
function nsRef(sub, mask) {                     // compress, decrement mod 2^n, expand
    const pos = [];
    for (let i = 0; i < 32; i++) if (bitOf(mask, i) === 1) pos.push(i);
    let j = 0;
    for (let p = 0; p < pos.length; p++) if (bitOf(sub, pos[p]) === 1) j += 2 ** p;
    const span = 2 ** pos.length;
    const nj = (j + span - 1) % span;
    let r = 0;
    for (let p = 0; p < pos.length; p++) if (Math.floor(nj / 2 ** p) % 2 === 1) r += 2 ** pos[p];
    return toI32(r);
}
// Combinatorial number system: colex rank of a k-set == its order as a uint32.
const CH = [];
for (let n = 0; n <= 32; n++) { CH.push(new Array(34).fill(0)); CH[n][0] = 1; for (let r = 1; r <= n; r++) CH[n][r] = CH[n - 1][r - 1] + (r <= n - 1 ? CH[n - 1][r] : 0); }
const C = (n, r) => (r < 0 || r > n ? 0 : CH[n][r]);
function rankOf(w) {
    let r = 0, i = 0;
    for (let b = 0; b < 32; b++) if (bitOf(w, b) === 1) { i++; r += C(b, i); }
    return r;
}
function unrank(r, k) {
    let u = 0;
    for (let i = k; i >= 1; i--) {
        let p = i - 1;
        while (p + 1 < 32 && C(p + 1, i) <= r) p++;
        u += 2 ** p; r -= C(p, i);
    }
    return toI32(u);
}
function ncRef(w) {                             // next k-set in colex, or 0
    const k = popc(w);
    if (k === 0) return 0;
    const r = rankOf(w);
    return r + 1 >= C(32, k) ? 0 : unrank(r + 1, k);
}
function rng(seed) {                            // xorshift32 on doubles-safe ints
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}
const isI32 = (x) => typeof x === 'number' && Object.is(x, toI32(x));

const unsignedBuilt = (w) => new FastBit32(u32(w));    // ctor stores >>> 0
const signedBuilt = (w) => new FastBit32().set(w);     // mutator stores | 0
const BUILDS = [['ctor/uint32', unsignedBuilt], ['set/int32', signedBuilt]];

// ---- 1. select: every int32 k edge -------------------------------------------
const K_EDGES = [-P31, -P31 + 1, -P30 - 1, -P30, -P30 + 1, -65536, -33, -32, -31, -2, -1,
    0, 1, 2, 15, 16, 17, 30, 31, 32, 33, 63, 64, 65535, P30 - 1, P30, P30 + 1, P31 - 2, P31 - 1];
const EDGE_WORDS = [0, -1, 1, -P31, toI32(0xC0000000), toI32(0x80000001), P30, 0x7FFFFFFF,
    toI32(0xAAAAAAAA), 0x55555555, toI32(0xFFFF0000), 0x0000FFFF, toI32(0x80008000), toI32(0xFFFFFFFE)];

describe('S5 QA select -- int32 k edges on empty / full / bit-31 words', () => {
    for (const [name, build] of BUILDS) {
        it('every edge k matches the scan, result an int in -1..31, ' + name, () => {
            let n = 0;
            for (const w of EDGE_WORDS) {
                const f = build(w), c = popc(w);
                const ks = K_EDGES.concat([c - 2, c - 1, c, c + 1, c + 2]);
                for (const k of ks) {
                    const got = f.select(k);
                    assert.strictEqual(got, sel(w, k), 'w=' + u32(w).toString(16) + ' k=' + k);
                    assert.ok(isI32(got) && got >= -1 && got <= 31);
                    n++;
                }
                assert.strictEqual(f.value, build(w).value, 'select is read-only');
            }
            assert.ok(n >= EDGE_WORDS.length * 34);
        });
    }

    it('k swept just below int32 max and just above int32 min: all -1, even on the full word', () => {
        for (const w of [-1, -P31, 0, 0x7FFFFFFF]) {
            const f = signedBuilt(w);
            for (let k = P31 - 4096; k <= P31 - 1; k++) assert.strictEqual(f.select(k), -1);
            for (let k = -P31; k <= -P31 + 4096; k++) assert.strictEqual(f.select(k), -1);
        }
    });

    it('bit-31 words: select(count()-1) === 31 === highest(), both representations', () => {
        for (const w of [-P31, toI32(0xC0000000), toI32(0x80000001), -1, toI32(0x80008000)]) {
            for (const [, build] of BUILDS) {
                const f = build(w);
                assert.strictEqual(f.select(popc(w) - 1), 31);
                assert.strictEqual(f.select(popc(w) - 1), f.highest());
                assert.strictEqual(f.select(0), f.lowest());
            }
        }
        // empty word: select(0) === lowest() === -1 and select(count()-1) === highest() === -1
        const e = new FastBit32();
        assert.strictEqual(e.select(0), -1);
        assert.strictEqual(e.select(e.count() - 1), e.highest());
    });
});

// ---- 2. select: settle (b) -- select(x) === select(x | 0) -------------------
describe('S5 QA select -- settle (b), non-int32 k read as k | 0', () => {
    const nonInt32 = () => [NaN, Infinity, -Infinity, -0, 0.5, -0.5, 1.5, 31.999, -1.5, 32.5,
        P31, P31 + 3, P32 - 1, P32, P32 + 3, P32 + 31, P32 + 32, -P31 - 1, -P32 - 1, -P32 + 2,
        2 ** 53 - 1, 2 ** 53, 2 ** 53 + 2, -(2 ** 53), 1e21, 1e300, Number.MIN_VALUE,
        undefined, null, true, false, '', ' ', '3', ' 7 ', '0x1f', '0b101', '1e1', 'abc', '-0',
        [], [5], ['6'], [1, 2], {}, { valueOf() { return 2; } }, { toString() { return '4'; } },
        new Number(9), new String('10'), new Date(12)];

    for (const [name, build] of BUILDS) {
        it('parity over a word corpus, ' + name, () => {
            const r = rng(0x51ec7);
            const corpus = EDGE_WORDS.slice();
            for (let i = 0; i < 200; i++) corpus.push(toI32(r()));
            let n = 0;
            for (const w of corpus) {
                const f = build(w);
                for (const x of nonInt32()) {
                    const want = sel(w, toI32(x));           // ToNumber then ToInt32, by arithmetic
                    assert.strictEqual(f.select(x), want, 'w=' + u32(w).toString(16) + ' x=' + String(x));
                    n++;
                }
            }
            assert.ok(n > 10000);
        });
    }

    it('k crosses the 2^32 wrap for real: 2^32 - 64 .. 2^32 + 64 (k|0 = -64..64)', () => {
        const w = toI32(0x8421_1248), f = signedBuilt(w), g = unsignedBuilt(w);
        let mids = 0;
        for (let x = P32 - 64; x <= P32 + 64; x++) {
            const want = sel(w, x - P32);
            assert.strictEqual(f.select(x), want, 'x=2^32+' + (x - P32));
            assert.strictEqual(g.select(x), want);
            if (want >= 0) mids++;
        }
        assert.strictEqual(mids, popc(w));                  // the k = 0..count-1 band is hit
    });

    it('k crosses 2^31 and 2^53: the sign wrap answers -1, 2^53 reads as 0', () => {
        const f = new FastBit32(0b1010);
        for (let x = P31 - 8; x < P31; x++) assert.strictEqual(f.select(x), -1);
        for (let x = P31; x <= P31 + 8; x++) assert.strictEqual(f.select(x), -1);  // -> -2^31..
        assert.strictEqual(f.select(2 ** 53 - 1), -1);       // ToInt32 = -1
        assert.strictEqual(f.select(2 ** 53), 1);            // ToInt32 = 0 -> bit 1
        assert.strictEqual(f.select(2 ** 53 + 2), -1);       // ToInt32 = 2 = count() -> -1
        assert.strictEqual(f.select(2 ** 53 + 1), 1);        // the literal rounds to 2^53 -> 0
    });

    it('pinned answers on 0b1010 (bits 1 and 3)', () => {
        const f = new FastBit32(0b1010);
        const pins = [[P32, 1], [P32 + 1, 3], [P32 + 2, -1], [P32 - 1, -1], [-0, 1], [Infinity, 1],
            [-Infinity, 1], ['0x1', 3], [' 1 ', 3], [[1], 3], [true, 3], [null, 1], [1.9999, 3],
            [-0.9999, 1], [P31, -1], [-P31 - 1, -1], [P32 + P31, -1], [-P32 + 1, 3]];
        // -2^31 - 1 -> 2^31 - 1 (-1); 2^32 + 2^31 -> -2^31 (-1); -2^32 + 1 -> 1 (bit 3)
        for (const [x, want] of pins) assert.strictEqual(f.select(x), want, 'select(' + String(x) + ')');
    });

    it('BigInt and Symbol throw TypeError (k | 0 throws on them too)', () => {
        const f = new FastBit32(0b1010);
        assert.throws(() => f.select(1n), TypeError);
        assert.throws(() => f.select(Symbol('k')), TypeError);
        assert.strictEqual(f.value, 0b1010);
    });

    it('valueOf is read exactly once', () => {
        let calls = 0;
        const k = { valueOf() { calls++; return 1; } };
        assert.strictEqual(new FastBit32(0b1010).select(k), 3);
        assert.strictEqual(calls, 1);
    });

    it('re-entrant write: a valueOf that rewrites the word is not seen (this.value read first)', () => {
        const f = new FastBit32(0b1010);
        const k = { valueOf() { f.clear(); f.add(20); return 0; } };
        assert.strictEqual(f.select(k), 1);                 // bit 0 of the OLD word 0b1010
        assert.strictEqual(f.value, 2 ** 20);
        const g = new FastBit32(0b1010);
        const k2 = { valueOf() { g.clear(); return 1; } };
        assert.strictEqual(g.select(k2), 3);
        assert.strictEqual(g.value, 0);
    });
});

// ---- 3. nextSubset ------------------------------------------------------------
describe('S5 QA nextSubset -- mask = -1 structure, wrap windows, literal formula', () => {
    // mask = -1 has 2^32 submasks: never walked fully. Each step must be exactly
    // u32(s) - 1 (so the walk from -1 has 2^32 values, 0 last); checked in 4096-step
    // windows that START just above each wrap point and cross it.
    const ANCHORS = [P30 + 2048, P31 + 2048, 3 * P30 + 2048, 2048, P32 - 1];
    for (const mask of [-1, P32 - 1]) {
        it('mask=' + mask + ': step is u32(s) - 1 across 2^30, 2^31, 3x2^30, 0 -> -1', () => {
            let crossed = 0;
            for (const a of ANCHORS) {
                let s = toI32(a);
                for (let i = 0; i < 4096; i++) {
                    const nx = FastBit32.nextSubset(s, mask);
                    const want = u32(s) === 0 ? -1 : toI32(u32(s) - 1);
                    assert.ok(isI32(nx), 'int32 result');
                    assert.strictEqual(nx, want, 's=' + u32(s));
                    assert.strictEqual(FastBit32.nextSubset(u32(s), mask), nx, 'uint32 sub');
                    if (u32(s) === P30 || u32(s) === P31 || u32(s) === 3 * P30 || u32(s) === 0) crossed++;
                    s = nx;
                }
            }
            assert.strictEqual(crossed, 4);                   // every wrap point was crossed
        });
    }

    it('mask = -1: 20000 random s, step is exactly u32(s) - 1 (2^32 values in the walk)', () => {
        const r = rng(0xFEEDF00D);
        for (let i = 0; i < 20000; i++) {
            const s = toI32(r());
            assert.strictEqual(FastBit32.nextSubset(s, -1), u32(s) === 0 ? -1 : toI32(u32(s) - 1));
        }
    });

    it('high-popcount masks (31, 30, bit 31 in and out): windows vs compress/decrement/expand', () => {
        const masks = [0x7FFFFFFF, toI32(0xFFFFFFFE), toI32(0xBFFFFFFF), toI32(0xFFFF7FFF), toI32(0xFFFFFFFC), toI32(0xAAAAAAAA)];
        for (const mask of masks) {
            // start at mask (top), at the submask whose compressed index is 2^(n-1)
            // (the bit-31 crossing for masks that hold bit 31) and at the bottom 4096
            const n = popc(mask);
            const starts = [mask, unrankSub(mask, 2 ** (n - 1) + 2048), unrankSub(mask, 4096)];
            for (const st of starts) {
                let s = st;
                for (let i = 0; i < 4096; i++) {
                    const nx = FastBit32.nextSubset(s, mask);
                    assert.strictEqual(nx, nsRef(s, mask), 'mask=' + u32(mask).toString(16) + ' s=' + u32(s).toString(16));
                    assert.strictEqual(andArith(nx, mask), nx, 'submask');
                    assert.ok(s === 0 || u32(nx) < u32(s), 'strictly decreasing');
                    s = nx;
                }
            }
        }
    });

    it('out of domain: still the literal (sub - 1) & mask on non-submasks, int32 pairs', () => {
        const r = rng(0x0DD5EED);
        let nonSub = 0;
        for (let i = 0; i < 20000; i++) {
            const sub = toI32(r()), mask = toI32(r() & r());
            const want = andArith(u32(sub) === 0 ? -1 : u32(sub) - 1, mask);
            assert.strictEqual(FastBit32.nextSubset(sub, mask), want);
            assert.strictEqual(FastBit32.nextSubset(u32(sub), u32(mask)), want);
            assert.strictEqual(FastBit32.nextSubset(u32(sub), mask), want);
            assert.strictEqual(FastBit32.nextSubset(sub, u32(mask)), want);
            if (andArith(sub, mask) !== sub) nonSub++;
        }
        assert.ok(nonSub > 15000);
    });

    it('out of domain, non-int32 sub: the subtraction happens BEFORE ToInt32 (pinned)', () => {
        // (sub - 1) & mask, literally: NOT nextSubset(sub | 0, mask)
        assert.strictEqual(FastBit32.nextSubset(0.5, 7), 0);       // -0.5 -> 0
        assert.strictEqual(FastBit32.nextSubset(0, 7), 7);         // the (sub | 0) reading
        assert.strictEqual(FastBit32.nextSubset(1.5, 7), 0);       // 0.5 -> 0
        assert.strictEqual(FastBit32.nextSubset(2 ** 53 + 2, -1), 0); // 2^53 + 1 rounds to 2^53
        assert.strictEqual(FastBit32.nextSubset(P32, -1), -1);     // 2^32 - 1 -> -1
        assert.strictEqual(FastBit32.nextSubset(P32 + 5, 0xFF), 4);
        assert.strictEqual(FastBit32.nextSubset('5', 7), 4);
        assert.strictEqual(FastBit32.nextSubset(undefined, -1), 0); // NaN -> 0
        assert.strictEqual(FastBit32.nextSubset(5, undefined), 0);
        assert.strictEqual(FastBit32.nextSubset(P31, -1), 0x7FFFFFFF);
        assert.throws(() => FastBit32.nextSubset(1n, 3), TypeError);
    });

    it('nextSubset(0, m) wraps to m | 0 for uint32 masks with bit 31 (d.ts: 0xF0000000 -> -268435456)', () => {
        assert.strictEqual(FastBit32.nextSubset(0, 0xF0000000), -268435456);
        for (const m of [0x80000000, 0xFFFFFFFF, 0xC0000001, 0xF000000F]) {
            const got = FastBit32.nextSubset(0, m);
            assert.ok(isI32(got));
            assert.strictEqual(got, toI32(m));
        }
    });

    it('valueOf: sub read once, then mask once', () => {
        const log = [];
        const sub = { valueOf() { log.push('sub'); return 6; } };
        const mask = { valueOf() { log.push('mask'); return 7; } };
        assert.strictEqual(FastBit32.nextSubset(sub, mask), 5);
        assert.deepStrictEqual(log, ['sub', 'mask']);
    });
});

// expand compressed index j through the mask bits (for window starts)
function unrankSub(mask, j) {
    const pos = [];
    for (let i = 0; i < 32; i++) if (bitOf(mask, i) === 1) pos.push(i);
    let r = 0;
    for (let p = 0; p < pos.length; p++) if (Math.floor(j / 2 ** p) % 2 === 1) r += 2 ** pos[p];
    return toI32(r);
}

// ---- 4. nextCombination -------------------------------------------------------
describe('S5 QA nextCombination -- every k, across 2^30 / 2^31, into the sentinel', () => {
    it('colex oracle self-check: unrank(rankOf(w)) === w, first/last ranks', () => {
        for (let k = 1; k <= 32; k++) {
            assert.strictEqual(unrank(0, k), toI32(2 ** k - 1));
            assert.strictEqual(unrank(C(32, k) - 1, k), toI32(P32 - 2 ** (32 - k)));
            const w = unrank(Math.floor(C(32, k) / 3), k);
            assert.strictEqual(rankOf(w), Math.floor(C(32, k) / 3));
            assert.strictEqual(popc(w), k);
        }
    });

    it('every k = 1..32: windows at rank 0, across 2^30, across 2^31 and into 0', () => {
        let steps = 0, ends = 0, wantEnds = 0;
        for (let k = 1; k <= 32; k++) {
            const total = C(32, k);
            // C(30, k) - 1 is the last k-word below 2^30; C(31, k) - 1 the last below 2^31.
            const starts = [0, C(30, k) - 256, C(31, k) - 256, total - 512];
            for (const st of starts) {
                let r = Math.max(0, st);
                if (r + 512 >= total) wantEnds++;          // this window reaches the top block
                let v = unrank(r, k);
                for (let i = 0; i < 512; i++) {
                    const nx = FastBit32.nextCombination(v);
                    assert.ok(isI32(nx), 'int32 result');
                    assert.strictEqual(FastBit32.nextCombination(u32(v)), nx, 'uint32 input');
                    if (r + 1 === total) {
                        assert.strictEqual(nx, 0, 'sentinel after the top block, k=' + k);
                        assert.strictEqual(v, toI32(P32 - 2 ** (32 - k)));
                        ends++;
                        break;
                    }
                    assert.strictEqual(nx, unrank(r + 1, k), 'k=' + k + ' rank=' + r);
                    assert.ok(u32(nx) > u32(v));
                    v = nx; r++; steps++;
                }
            }
        }
        assert.strictEqual(ends, wantEnds);
        assert.ok(wantEnds >= 32);                          // every k ends at least once
        assert.ok(steps > 30000);
    });

    it('every bit-31 carry: the block ending at bit 30 moves to bit 31, k = 1..31', () => {
        for (let k = 1; k <= 31; k++) {
            const v = toI32(P31 - 2 ** (31 - k));               // bits 31-k .. 30
            const want = toI32(P31 + 2 ** (k - 1) - 1);         // bit 31 + low k-1 bits
            assert.strictEqual(FastBit32.nextCombination(v), want, 'k=' + k);
            assert.strictEqual(FastBit32.nextCombination(u32(v)), want);
        }
    });

    it('exhaustive 16-bit windows at bits 0, 8, 16 (bit 31) + 20000 random words vs colex', () => {
        let n = 0;
        for (const sh of [0, 8, 16]) {
            for (let p = 0; p < 65536; p++) {
                const w = toI32(p * 2 ** sh);
                assert.strictEqual(FastBit32.nextCombination(w), ncRef(w), 'w=' + u32(w).toString(16));
                n++;
            }
        }
        const r = rng(0xC0B1CAFE);
        for (let i = 0; i < 20000; i++) {
            const w = toI32(r());
            const got = FastBit32.nextCombination(w);
            assert.strictEqual(got, ncRef(w), 'w=' + u32(w).toString(16));
            assert.strictEqual(FastBit32.nextCombination(u32(w)), got);
            n++;
        }
        assert.strictEqual(n, 3 * 65536 + 20000);
    });

    it('numeric non-int32 input: f(x) === f(ToInt32(x))', () => {
        const xs = [NaN, Infinity, -Infinity, -0, 0.5, 1.5, 2.9, 3.5, -1.5, -2.5, -3.5, P31, P31 + 1,
            P32 - 1, P32, P32 + 3, P32 + 12, -P31 - 1, 2 ** 53 - 1, 2 ** 53, 2 ** 53 + 2, 2 ** 60 + 2 ** 20,
            1e21, 1e300, -(2 ** 53), Number.MIN_VALUE, undefined, null, true, false];
        for (const x of xs) {
            const got = FastBit32.nextCombination(x);
            assert.ok(isI32(got) && !Object.is(got, -0));
            assert.strictEqual(got, ncRef(toI32(x)), 'x=' + String(x));
        }
    });

    it('FINDING pin: a string / array / Date input concatenates in `v + c` (popcount not kept)', () => {
        // select reads k | 0 and nextSubset subtracts, both numeric; nextCombination's
        // `v + c` is string concatenation for these. Out of domain (d.ts: number),
        // not validated until S6. Pinned so any change is visible.
        assert.strictEqual(FastBit32.nextCombination('3'), 31);   // ncRef(3) is 5
        assert.strictEqual(FastBit32.nextCombination([3]), 31);
        assert.strictEqual(FastBit32.nextCombination('0x3'), 61);
        assert.strictEqual(FastBit32.nextCombination(new Date(3)), 0);
        assert.strictEqual(ncRef(3), 5);
        let calls = 0;
        FastBit32.nextCombination({ valueOf() { calls++; return 3; } });
        assert.strictEqual(calls, 4);                              // v is read 4 times
        assert.throws(() => FastBit32.nextCombination(1n), TypeError);
    });
});

// ---- 5. surface: settle (a), this-free statics -------------------------------
describe('S5 QA surface', () => {
    it('settle (a): FastBit1024 has no select (nor the statics)', () => {
        assert.strictEqual('select' in FastBit1024.prototype, false);
        assert.strictEqual(typeof new FastBit1024(64).select, 'undefined');
        assert.strictEqual(Object.hasOwn(FastBit1024, 'nextSubset'), false);
        assert.strictEqual(Object.hasOwn(FastBit1024, 'nextCombination'), false);
    });

    it('arity and placement: select on the prototype, the two statics on the class', () => {
        assert.strictEqual(FastBit32.prototype.select.length, 1);
        assert.strictEqual(FastBit32.nextSubset.length, 2);
        assert.strictEqual(FastBit32.nextCombination.length, 1);
        assert.strictEqual(typeof new FastBit32().nextSubset, 'undefined');
        assert.strictEqual(new FastBit32().constructor.nextCombination, FastBit32.nextCombination);
    });

    it('statics are this-free: detached and subclass calls give the same answers', () => {
        const { nextSubset, nextCombination } = FastBit32;
        class Sub extends FastBit32 {}
        const r = rng(0x7E57);
        for (let i = 0; i < 2000; i++) {
            const a = toI32(r()), m = toI32(r());
            const s = andArith(a, m);
            assert.strictEqual(nextSubset(s, m), FastBit32.nextSubset(s, m));
            assert.strictEqual(Sub.nextSubset(s, m), FastBit32.nextSubset(s, m));
            assert.strictEqual(nextCombination(a), FastBit32.nextCombination(a));
            assert.strictEqual(Sub.nextCombination(a), FastBit32.nextCombination(a));
        }
    });

    it('select works on a duck-typed receiver (reads only this.value)', () => {
        const sel1 = FastBit32.prototype.select;
        assert.strictEqual(sel1.call({ value: 0b1010 }, 1), 3);
        assert.strictEqual(sel1.call({ value: P32 - 1 }, 31), 31);
        assert.strictEqual(sel1.call({ value: 0 }, 0), -1);
    });
});

// ---- 6. doc recipes, executed FROM THE DOC TEXT ------------------------------
function read(file) { return readFileSync(new URL(file, ROOT), 'utf8'); }
function blocksAfter(file, anchor, end, opener) {
    const text = read(file);
    const at = text.indexOf(anchor);
    assert.ok(at >= 0, file + ': anchor "' + anchor + '" missing');
    const stop = text.indexOf(end, at);
    assert.ok(stop > at, file + ': end marker missing');
    const out = [];
    let from = at;
    for (;;) {
        const s = text.indexOf(opener, from);
        if (s < 0 || s > stop) break;
        const e = text.indexOf('```', s + opener.length);
        out.push(text.slice(s + opener.length, e));
        from = e + 3;
    }
    return out;
}
const stripImports = (code) => code.split('\n').filter((l) => !/^\s*import\s/.test(l)).join('\n');
function mathStub(r) { return { random: () => r, floor: Math.floor, trunc: Math.trunc, clz32: Math.clz32 }; }

// independent expectations for a recipe walk
function checkSubmaskWalk(seen, m) {
    const n = popc(m);
    assert.strictEqual(seen.length, 2 ** n, '2^count(m) submasks');
    assert.strictEqual(seen[0], toI32(m), 'starts at m');
    assert.strictEqual(seen[seen.length - 1], 0, '0 last');
    assert.strictEqual(new Set(seen).size, seen.length, 'distinct');
    for (const s of seen) assert.strictEqual(andArith(s, m), s, 'submask');
}
function checkCombWalk(seen, k) {
    assert.strictEqual(seen.length, C(32, k), 'C(32,' + k + ') words');
    for (let i = 0; i < seen.length; i++) {
        assert.strictEqual(popc(seen[i]), k);
        assert.strictEqual(rankOf(seen[i]), i, 'colex order, increasing as uint32');
    }
}

describe('S5 QA doc recipes, executed from the doc text', () => {
    const README_ANCHOR = 'Pick a random live flag, walk submasks, walk k-of-32 sets (1.5.0)';

    it('README: random live flag picks 3, 17 or 31 uniformly; -1 when the set is empty', () => {
        const [b1] = blocksAfter('README.md', README_ANCHOR, '</details>', '```javascript');
        assert.ok(b1.includes('select(') && b1.includes('.add(3).add(17).add(31)'));
        const run = (code, r) => new Function('FastBit32', 'Math', stripImports(code) + '\nreturn pick;')(FastBit32, mathStub(r));
        const hits = new Map();
        for (const r of [0, 0.2, 0.3333, 0.3334, 0.5, 0.6666, 0.6667, 0.9, 0.999999]) {
            const p = run(b1, r);
            assert.ok(p === 3 || p === 17 || p === 31, 'r=' + r + ' pick ' + p);
            hits.set(p, (hits.get(p) || 0) + 1);
        }
        assert.strictEqual(hits.size, 3);
        // the documented "-1 if empty": the same text with the adds removed
        const empty = b1.replace('.add(3).add(17).add(31)', '');
        for (const r of [0, 0.5, 0.999999]) assert.strictEqual(run(empty, r), -1);
    });

    it('README: submask loop visits 8 submasks of m, m first, 0 last', () => {
        const blocks = blocksAfter('README.md', README_ANCHOR, '</details>', '```javascript');
        const b2 = blocks.find((b) => b.includes('nextSubset'));
        assert.ok(b2, 'submask block');
        assert.ok(/8 submasks, 0 last/.test(b2));
        const seen = [];
        const m = new Function('FastBit32', 'visit', stripImports(b2) + '\nreturn m;')(FastBit32, (s) => seen.push(s));
        checkSubmaskWalk(seen, m);
        assert.strictEqual(seen.length, 8);
    });

    it('README: k-of-32 loop visits C(32, k) words for k = 1, 2, 3, 30, 31, 32; (1 << 32) - 1 really is 0', () => {
        const blocks = blocksAfter('README.md', README_ANCHOR, '</details>', '```javascript');
        const b3 = blocks.find((b) => b.includes('nextCombination'));
        assert.ok(b3, 'combination block');
        for (const k of [1, 2, 3, 30, 31, 32]) {
            const seen = [];
            new Function('FastBit32', 'k', 'visit', stripImports(b3))(FastBit32, k, (v) => seen.push(v));
            checkCombWalk(seen, k);
        }
        // README prose: "`(1 << k) - 1` is wrong at k = 32 (`1 << 32` is `1`)"
        assert.ok(read('README.md').includes('`1 << 32` is `1`'));
        assert.strictEqual(1 << 32, 1);
        assert.strictEqual((1 << 32) - 1, 0);
        assert.strictEqual(FastBit32.rangeMask(0, 31), -1);
    });

    it('llms.txt recipe block: pick, submasks of a bit-31 mask, k-of-32 sets', () => {
        const [b] = blocksAfter('llms.txt', '### Random pick, submasks, k-of-32 combinations (1.5.0)', '### ECS Component Mask Query', '```javascript');
        assert.ok(b && b.includes('nextSubset') && b.includes('nextCombination'));
        const run = (f, m, k, r) => {
            const seen = [];
            const bit = new Function('FastBit32', 'f', 'm', 'k', 'visit', 'Math', stripImports(b) + '\nreturn bit;')(FastBit32, f, m, k, (x) => seen.push(x), mathStub(r));
            return { bit, seen };
        };
        const m = toI32(0xF000000F), k = 3;
        const { bit, seen } = run(new FastBit32().add(5).add(31), m, k, 0.75);
        assert.strictEqual(bit, 31);
        const nSub = 2 ** popc(m);
        checkSubmaskWalk(seen.slice(0, nSub), m);
        checkCombWalk(seen.slice(nSub), k);
        assert.strictEqual(run(new FastBit32(), 0, 1, 0.5).bit, -1);   // "-1 on an empty set by itself"
    });

    it('llms.txt Common Mistakes: the WRONG loops never end; (1 << 32) - 1 is 0', () => {
        const text = read('llms.txt');
        const at = text.indexOf('// WRONG: nextCombination ends at 0, never -1');
        assert.ok(at >= 0);
        const lines = text.slice(at).split('\n');
        // 1. `while (v !== -1) v = FastBit32.nextCombination(v);` -- run with a guard
        const wl = lines.find((l) => l.startsWith('while (v !== -1)'));
        assert.ok(wl);
        const guarded = wl.replace('while (v !== -1)', 'while (v !== -1 && __g++ < 100000)').replace(/\/\/.*$/, '');
        for (const start of [1, 7, toI32(0xE0000000), 0x7FFFFFFF]) {
            const out = new Function('FastBit32', 'v0', 'let v = v0, __g = 0;\n' + guarded + '\nreturn [v, __g];')(FastBit32, start);
            assert.strictEqual(out[1], 100001, 'the WRONG loop does not terminate');
            assert.strictEqual(out[0], 0, 'it is stuck at the 0 sentinel');
        }
        // 2. `for (let s = m; s !== -1; s = nextSubset(s, m)) visit(s);` -- cycles back to m
        const fl = lines.find((l) => l.startsWith('for (let s = m; s !== -1;'));
        assert.ok(fl);
        const g2 = fl.replace('s !== -1;', 's !== -1 && __g++ < 300;');
        for (const m of [0b10110, toI32(0x80000001), 0]) {
            const seen = [];
            new Function('FastBit32', 'm', 'visit', 'let __g = 0;\n' + g2)(FastBit32, m, (s) => seen.push(s));
            assert.strictEqual(seen.length, 300, 'the WRONG loop does not terminate (guard tripped), m=' + m);
            assert.strictEqual(seen[2 ** popc(m)], toI32(m), 'wraps from 0 back to m');
        }
        // 3. `const all = (1 << 32) - 1;` evaluates to 0
        const cl = lines.find((l) => l.startsWith('const all = (1 << 32) - 1;'));
        assert.ok(cl);
        assert.strictEqual(new Function(cl + '\nreturn all;')(), 0);
    });

    it('d.ts @example blocks for select / nextSubset / nextCombination run as documented', () => {
        const dts = read('FastBit32.d.ts');
        const example = (sig) => {
            const end = dts.indexOf(sig);
            assert.ok(end >= 0, 'd.ts signature ' + sig);
            const start = dts.lastIndexOf('/**', end);
            const doc = dts.slice(start, end).split('\n').map((l) => l.replace(/^\s*\*\s?/, ''));
            const i = doc.findIndex((l) => l.startsWith('@example'));
            assert.ok(i >= 0, 'no @example before ' + sig);
            const body = [];
            for (let j = i + 1; j < doc.length && doc[j].trim() !== '' && !doc[j].startsWith('@'); j++) body.push(doc[j]);
            return body.join('\n');
        };
        // select
        const ex1 = example('select(k: number): number;');
        for (const [r, want] of [[0, 4], [0.5, 9], [0.99, 30]]) {
            const f = new FastBit32().add(4).add(9).add(30);
            const bit = new Function('f', 'Math', ex1 + '\nreturn bit;')(f, mathStub(r));
            assert.strictEqual(bit, want);
        }
        assert.strictEqual(new Function('f', 'Math', ex1 + '\nreturn bit;')(new FastBit32(), mathStub(0.5)), -1);
        // nextSubset, including a uint32 mask with bit 31
        const ex2 = example('static nextSubset(sub: number, mask: number): number;');
        for (const mask of [0b1011, 0xF0000000, toI32(0x80000003)]) {
            const seen = [];
            new Function('FastBit32', 'mask', 'visit', ex2)(FastBit32, mask, (s) => seen.push(s));
            assert.strictEqual(seen.length, 2 ** popc(mask));
            assert.strictEqual(seen[seen.length - 1], 0);
            for (const s of seen.slice(1)) assert.ok(isI32(s) && andArith(s, mask) === s);
        }
        // the d.ts claim `nextSubset(0, 0xF0000000)` is -268435456
        assert.ok(dts.includes('`nextSubset(0, 0xF0000000)` is -268435456'));
        assert.strictEqual(FastBit32.nextSubset(0, 0xF0000000), -268435456);
        // nextCombination
        const ex3 = example('static nextCombination(v: number): number;');
        for (const k of [1, 2, 31, 32]) {
            const seen = [];
            new Function('FastBit32', 'k', 'visit', ex3)(FastBit32, k, (v) => seen.push(v));
            checkCombWalk(seen, k);
        }
    });
});

// ---- 7. parity vs the published 1.4.0 body (ASSERTION 7, committed) ----------
// Every pre-existing export, prototype method and static of 1.4.0 is called on
// the old body (`git show fb3b803:FastBit32.js`, pinned so the check survives
// the release commit) and on the tree, with the same arguments, and must give
// the same outcome: return value (or thrown class + message), the receiver's
// own state afterwards, and every callback invocation. Fails closed if git
// cannot produce the base.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as NEW from '../FastBit32.js';

const BASE14 = 'fb3b803';
let OLD14 = null, baseErr = null;
try {
    const src = execFileSync('git', ['show', BASE14 + ':FastBit32.js'], { cwd: fileURLToPath(ROOT), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (!src.includes("export const VERSION = '1.4.0';")) throw new Error('base is not the 1.4.0 body');
    OLD14 = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
} catch (e) { baseErr = e; }

const PNAMES = [];
for (let i = 0; i < 32; i++) PNAMES.push('k' + i);
const PARR = PNAMES.map((_, i) => i * 7 + 1);
const POBJ = Object.fromEntries(PNAMES.map((n, i) => [n, i * 3 + 2]));
// argument tokens resolved per side (old / new) so no object is shared
function side(M, log) {
    const rec = (...a) => { log.push(a.map((x) => (typeof x === 'object' ? 'obj' : x))); };
    return (tok) => {
        if (tok === 'CB') return rec;
        if (tok === 'INST') return new M.FastBit32(0x0F0F0F0F);
        if (tok === 'MAPPER') return new M.BitMapper(PNAMES);
        if (tok === 'ARR') return PARR;
        if (tok === 'KEYS') return PNAMES;
        if (tok === 'OBJ') return POBJ;
        if (tok === 'NAMES2') return ['k1', 'k5'];
        return tok;
    };
}
function snap(x) {
    if (x === null || typeof x !== 'object') return typeof x === 'number' && Object.is(x, -0) ? 'num:-0' : typeof x + ':' + String(x);
    if (Array.isArray(x)) return 'arr:' + JSON.stringify(x);
    const own = Object.entries(x).map(([k, v]) => [k, ArrayBuffer.isView(v) ? Array.from(v) : (v instanceof Map ? [...v] : v)]);
    return (x.constructor && x.constructor.name) + ':' + JSON.stringify(own);
}
function outcome(M, make, call, args) {
    const log = [];
    const res = side(M, log);
    let recv = null, out;
    try {
        recv = make(M);
        const r = call(M, recv, args.map(res));
        out = r === recv && recv !== null ? 'this' : snap(r);
    } catch (e) { out = 'throw:' + e.constructor.name + ':' + e.message; }
    return out + ' | state ' + (recv === null ? '-' : snap(recv)) + ' | log ' + JSON.stringify(log);
}
const P1 = [-1, 0, 1, 7, 16, 31, 32, 33, 0x0F0F0F0F, -P31, P31, P32 - 1, P32, 1.5, NaN, undefined, null, '3', 'k3', 'CB', 'INST', 'MAPPER', 'NAMES2'];
const P2 = [-1, 0, 5, 31, 32, toI32(0xF0F0F0F0), NaN, 'CB', 'INST', 'k2'];
const P3 = [0, -1, 0x0F0F0F0F, 'ARR', 'KEYS', 'OBJ', 'MAPPER', 'CB'];
function argTuples(n) {
    if (n === 0) return [[]];
    if (n === 1) return P1.map((a) => [a]);
    if (n === 2) return P2.flatMap((a) => P2.map((b) => [a, b]));
    return P3.flatMap((a) => P3.flatMap((b) => P3.map((c) => [a, b, c])));
}
const ownMethods = (o) => Object.getOwnPropertyNames(o).filter((n) => n !== 'constructor' && typeof Object.getOwnPropertyDescriptor(o, n).value === 'function');

describe('S5 QA parity vs 1.4.0 (' + BASE14 + ')', () => {
    it('the base loads (fails closed)', () => {
        assert.strictEqual(baseErr, null, 'git show ' + BASE14 + ' failed: ' + (baseErr && baseErr.message));
    });

    it('the surface is additive: exactly select + nextSubset + nextCombination are new', () => {
        assert.ok(OLD14);
        assert.deepStrictEqual(Object.keys(NEW).sort(), Object.keys(OLD14).sort());
        const diff = (a, b) => a.filter((n) => !b.includes(n)).sort();
        const np = ownMethods(NEW.FastBit32.prototype), op = ownMethods(OLD14.FastBit32.prototype);
        assert.deepStrictEqual(diff(op, np), []);
        assert.deepStrictEqual(diff(np, op), ['select']);
        const ns = Object.getOwnPropertyNames(NEW.FastBit32), os = Object.getOwnPropertyNames(OLD14.FastBit32);
        assert.deepStrictEqual(diff(os, ns), []);
        assert.deepStrictEqual(diff(ns, os), ['nextCombination', 'nextSubset']);
        for (const C2 of ['FastBit1024', 'BitMapper']) {
            assert.deepStrictEqual(ownMethods(NEW[C2].prototype).sort(), ownMethods(OLD14[C2].prototype).sort());
            assert.deepStrictEqual(Object.getOwnPropertyNames(NEW[C2]).sort(), Object.getOwnPropertyNames(OLD14[C2]).sort());
        }
        // VERSION sync with package.json is Hygiene.test.mjs's gate (bumped by /release).
    });

    it('every 1.4.0 FastBit32 method, static and free function: identical outcomes', () => {
        assert.ok(OLD14);
        const r = rng(0x1404);
        const words = [0, -1, 1, -P31, 0x7FFFFFFF, P30, toI32(0x80000001), 0x0F0F0F0F, toI32(0xAAAAAAAA)];
        for (let i = 0; i < 100; i++) words.push(toI32(r()));
        let n = 0;
        const cmp = (make, call, args, tag) => {
            const a = outcome(OLD14, make, call, args), b = outcome(NEW, make, call, args);
            if (a !== b) assert.fail(tag + ' args=' + JSON.stringify(args.map(String)) + '\n old ' + a + '\n new ' + b);
            n++;
        };
        for (const name of ownMethods(OLD14.FastBit32.prototype)) {
            const len = OLD14.FastBit32.prototype[name].length;
            for (const w of words) {
                for (const [bn, make] of [['ctor', (M) => new M.FastBit32(u32(w))], ['set', (M) => new M.FastBit32().set(w)]]) {
                    for (const args of argTuples(len)) cmp(make, (M, x, a) => x[name](...a), args, 'FastBit32#' + name + ' ' + bn + ' w=' + w);
                }
            }
        }
        for (const name of ownMethods(OLD14.FastBit32)) {
            for (const args of argTuples(Math.min(OLD14.FastBit32[name].length, 2))) cmp(() => null, (M, x, a) => M.FastBit32[name](...a), args, 'FastBit32.' + name);
        }
        for (const name of Object.keys(OLD14).filter((k) => typeof OLD14[k] === 'function' && !/^[A-Z]/.test(k))) {
            for (const args of argTuples(OLD14[name].length)) cmp(() => null, (M, x, a) => M[name](...a), args, name);
        }
        for (const name of ownMethods(OLD14.BitMapper.prototype)) {
            for (const args of argTuples(Math.min(OLD14.BitMapper.prototype[name].length, 2))) cmp((M) => new M.BitMapper(PNAMES), (M, x, a) => x[name](...a), args, 'BitMapper#' + name);
        }
        assert.ok(n > 100000, 'golden vector count ' + n);
    });

    it('every 1.4.0 FastBit1024 method on seeded pools of 8 capacities: identical outcomes', () => {
        assert.ok(OLD14);
        let n = 0;
        for (const cap of [1, 31, 32, 33, 64, 500, 1023, 1024]) {
            const make = (M) => {
                const p = new M.FastBit1024(cap);
                const rr = rng(cap * 977 + 1);
                for (let i = 0; i < cap; i++) if (rr() % 3 !== 0) p.add(i);
                return p;
            };
            for (const name of ownMethods(OLD14.FastBit1024.prototype)) {
                const len = Math.min(OLD14.FastBit1024.prototype[name].length, 2);
                const extra = len === 1 ? [[cap - 1], [cap], [cap + 1], [1023], [1024], [2047], [2048]] : [];
                for (const args of argTuples(len).concat(extra)) {
                    const a = outcome(OLD14, make, (M, x, q) => x[name](...q), args), b = outcome(NEW, make, (M, x, q) => x[name](...q), args);
                    if (a !== b) assert.fail('FastBit1024#' + name + ' cap=' + cap + ' args=' + JSON.stringify(args.map(String)) + '\n old ' + a + '\n new ' + b);
                    n++;
                }
            }
        }
        assert.ok(n > 1000, 'FastBit1024 golden count ' + n);
    });
});
