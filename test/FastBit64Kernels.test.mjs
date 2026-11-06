// test/FastBit64Kernels.test.mjs -- FastBit64 group A, ASSERTION A3 (kernel half) + A-S2 / R-5.
// INDEPENDENT ORACLE: written from the SPEC (.handoff/PLAN-fastbit64-A.md A-S2 / A3, PROPOSAL-fastbit64.md R-5),
// not from the FastBit64 section. Expected values come from FastBit32's SHIPPED bodies (the code above the
// FastBit64 marker): ctz32 vs lowest (0 -> 32), popcnt32 vs count, select32 vs select (k -1..33),
// upTo(n) vs rangeMask(0, n - 1) (n 1..32; upTo(0) = 0 by spec, rangeMask refuses n - 1 = -1).
// Plus a few hand-derived anchors (stated beside each row).
// The private span between `// fb64-kernels:begin` and `// fb64-kernels:end` is extracted into a data: module.
// Seeds (xorshift32, independent streams): WORDS 0x0badf00d, POP 0x2545f491. No timing.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Mod from '../FastBit32.js';
import { FastBit32 } from '../FastBit32.js';

const SRC = readFileSync(fileURLToPath(new URL('../FastBit32.js', import.meta.url)), 'utf8');
const BEGIN = '// fb64-kernels:begin';
const END = '// fb64-kernels:end';

function count(hay, needle) {
    let n = 0, at = hay.indexOf(needle);
    while (at !== -1) { n++; at = hay.indexOf(needle, at + needle.length); }
    return n;
}

function stream(seed) {
    let x = seed | 0;
    if (x === 0) x = 1;
    return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
}

describe('FastBit64 kernels -- marker span', () => {
    it('both markers are present exactly once, begin before end', () => {
        assert.equal(count(SRC, BEGIN), 1, 'begin marker count');
        assert.equal(count(SRC, END), 1, 'end marker count');
        assert.ok(SRC.indexOf(BEGIN) < SRC.indexOf(END), 'begin must precede end');
    });
    it('the span declares the four kernels and exports nothing (A-S2)', () => {
        const span = SRC.slice(SRC.indexOf(BEGIN) + BEGIN.length, SRC.indexOf(END));
        for (const n of ['ctz32', 'popcnt32', 'select32', 'upTo']) {
            assert.ok(new RegExp('function\\s+' + n + '\\s*\\(').test(span), n + ' declared as a function in the span');
        }
        assert.ok(!/\bexport\b/.test(span), 'no export inside the kernel span');
        for (const n of ['ctz32', 'popcnt32', 'select32', 'upTo']) {
            assert.equal(n in Mod, false, n + ' must not be a module export');
        }
    });
});

let K = null, kerr = null;
try {
    const span = SRC.slice(SRC.indexOf(BEGIN) + BEGIN.length, SRC.indexOf(END));
    K = await import('data:text/javascript;base64,' +
        Buffer.from(span + '\nexport { ctz32, popcnt32, select32, upTo };\n').toString('base64'));
} catch (e) { kerr = e; }
const need = () => { if (kerr) throw kerr; };

// word corpus: bit 31, bit 0, -1, -2^31 and friends, every single bit and its complement, runs, seeded random
const WORDS = [0, 1, -1, -2147483648, 2147483647, 0x80000001 | 0, 0x55555555, 0xAAAAAAAA | 0, 0x0000FFFF, 0xFFFF0000 | 0, 0x7FFFFFFE, 0xFFFFFFFE | 0];
for (let b = 0; b < 32; b++) { WORDS.push((1 << b) | 0); WORDS.push(~(1 << b)); WORDS.push(((1 << b) - 1) | 0); WORDS.push((-1 << b) | 0); }
const rw = stream(0x0badf00d), rp = stream(0x2545f491);
for (let i = 0; i < 3000; i++) {
    const a = rw(), b = rw();
    WORDS.push((i % 3 === 0 ? a & b : i % 3 === 1 ? a | b : a) | 0);
}

describe('FastBit64 kernels vs FastBit32 shipped bodies (A3, R-5)', () => {
    it('the corpus has the required words and a floor', () => {
        assert.ok(WORDS.length >= 3000, 'corpus size ' + WORDS.length);
        for (const w of [(1 << 31) | 0, 1, -1, -2147483648, 0]) assert.ok(WORDS.includes(w), 'corpus lacks ' + w);
    });

    it('ctz32 === FastBit32#lowest, 0 -> 32', () => {
        need();
        let n = 0;
        for (const w of WORDS) {
            const l = new FastBit32(w).lowest();
            const exp = l === -1 ? 32 : l;
            assert.equal(K.ctz32(w), exp, 'ctz32(' + w + ')');
            n++;
        }
        assert.ok(n >= 3000);
        // hand anchors: ctz32(0) = 32 (spec), ctz32(1) = 0, ctz32(-2^31) = 31, ctz32(-1) = 0, ctz32(0x00010000) = 16
        assert.equal(K.ctz32(0), 32);
        assert.equal(K.ctz32(1), 0);
        assert.equal(K.ctz32(-2147483648), 31);
        assert.equal(K.ctz32(-1), 0);
        assert.equal(K.ctz32(0x10000), 16);
    });

    it('popcnt32 === FastBit32#count', () => {
        need();
        for (const w of WORDS) assert.equal(K.popcnt32(w), new FastBit32(w).count(), 'popcnt32(' + w + ')');
        // hand anchors: 0 -> 0, -1 -> 32, -2^31 -> 1, 0x55555555 -> 16, 0xFFFF -> 16
        assert.equal(K.popcnt32(0), 0);
        assert.equal(K.popcnt32(-1), 32);
        assert.equal(K.popcnt32(-2147483648), 1);
        assert.equal(K.popcnt32(0x55555555), 16);
        assert.equal(K.popcnt32(0xFFFF), 16);
        // every popcount 0..32 appears (low-k masks), so a mutated SWAR constant cannot hide
        for (let k = 0; k <= 32; k++) assert.equal(K.popcnt32(k === 32 ? -1 : ((1 << k) - 1)), k);
    });

    it('select32(v, k) === FastBit32#select(k) for k -1..33 on every word', () => {
        need();
        let n = 0;
        for (const w of WORDS) {
            const f = new FastBit32(w);
            for (let k = -1; k <= 33; k++) {
                assert.equal(K.select32(w, k), f.select(k), 'select32(' + w + ', ' + k + ')');
                n++;
            }
        }
        assert.ok(n >= 3000 * 35, 'select rows ' + n);
        // hand anchors: select32(-1, 31) = 31, select32(-1, 32) = -1, select32(0, 0) = -1, select32(-2^31, 0) = 31
        assert.equal(K.select32(-1, 31), 31);
        assert.equal(K.select32(-1, 32), -1);
        assert.equal(K.select32(0, 0), -1);
        assert.equal(K.select32(-2147483648, 0), 31);
        assert.equal(K.select32(0x00000005, 1), 2);
    });

    it('select32 and ctz32 and popcnt32 agree on a second, independent random stream', () => {
        need();
        let n = 0;
        for (let i = 0; i < 5000; i++) {
            const w = rp() | 0, k = (rp() % 36) - 2, f = new FastBit32(w);
            assert.equal(K.select32(w, k), f.select(k));
            assert.equal(K.popcnt32(w), f.count());
            const l = f.lowest();
            assert.equal(K.ctz32(w), l === -1 ? 32 : l);
            n++;
        }
        assert.equal(n, 5000);
    });

    it('upTo(n) === FastBit32.rangeMask(0, n - 1) for n 1..32; upTo(0) = 0; upTo(32) = -1', () => {
        need();
        assert.equal(K.upTo(0), 0);
        assert.equal(K.upTo(32), -1);
        for (let n = 1; n <= 32; n++) {
            assert.equal(K.upTo(n), FastBit32.rangeMask(0, n - 1), 'upTo(' + n + ')');
        }
        // hand anchors: upTo(1) = 1, upTo(31) = 0x7FFFFFFF, upTo(16) = 0xFFFF
        assert.equal(K.upTo(1), 1);
        assert.equal(K.upTo(31), 0x7FFFFFFF);
        assert.equal(K.upTo(16), 0xFFFF);
        // the result is an int32 (never a uint32 double): upTo(32) is -1, not 4294967295
        for (let n = 0; n <= 32; n++) assert.equal(K.upTo(n) | 0, K.upTo(n));
    });
});
