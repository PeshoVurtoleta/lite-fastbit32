// test/FastBit64.test.mjs -- FastBit64 group A: ASSERTIONS A3 (correctness), A4 (fail-closed rows), A5 (interop).
// INDEPENDENT ORACLE: written from the SPEC (.handoff/PROPOSAL-fastbit64.md s1 / R-3 / R-6 / s7 rulings,
// .handoff/PLAN-fastbit64-A.md A-S2..A-S9 + ASSERTIONS A3 / A4 / A5), not from the FastBit64 section.
// Two oracles: (1) a BigInt model (BigInt words + per-word Uint8Array bit tables built one bit at a time);
// (2) FastBit1024(64) (the shipped class above the FastBit64 marker) loaded through a hand-built image
// [0x46420800 | 64, lo, hi] or filled with add(). FastBit1024 has no rank / select / highestClearBit /
// countRange / union / difference / intersect / isSubsetOf / hasNone mutators; for those the oracle is
// the BigInt model plus the FastBit1024 identities listed beside each row (unionSize, differenceSize,
// intersectionSize, hasAll with swapped operands, !hasAny, removeRange-then-size).
// Seeds (xorshift32, 32-bit exact, independent streams):
//   WORDS 0x6a09e667 (corpus words), RANGE 0xbb67ae85 (range-test words), OPS 0x13198a2e (op kinds),
//   KEYS 0xc0ffee11 (operands), ARR 0x3c6ef372 (fromArray / image fuzz).
// Header: 0x46420800 + 64 = 70*2^24 + 66*2^16 + 8*2^8 + 64 = 1178732608 (hand-derived).
// Node 18 APIs only (A-S10). No timing. Row counters are printed by the last test.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FastBit64, FastBit32, FastBit1024 } from '../FastBit32.js';

// ---------------------------------------------------------------- helpers
function stream(seed) {
    let x = seed | 0;
    if (x === 0) x = 1;
    return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
}

const ROWS = { A3: 0, A4: 0, A5: 0 };
let CUR = 'A3';
function eq(got, exp, what) {
    ROWS[CUR]++;
    if (got !== exp) assert.fail(what + ': got ' + String(got) + ', expected ' + String(exp));
}
function same(a, b, what) {
    ROWS[CUR]++;
    if (a.length !== b.length) assert.fail(what + ': length ' + a.length + ' vs ' + b.length + ' (' + a + ' vs ' + b + ')');
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.fail(what + ': [' + i + '] ' + a[i] + ' vs ' + b[i]);
}

const MIN = -2147483648, MAX = 2147483647, HEADER = 1178732608, TAG = 0x46420800;
const BIT = [];
for (let i = 0; i < 64; i++) BIT.push(1n << BigInt(i));
const M64 = (1n << 64n) - 1n;
const big = (lo, hi) => (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
const loOf = (m) => Number(BigInt.asIntN(32, m & 0xFFFFFFFFn));
const hiOf = (m) => Number(BigInt.asIntN(32, (m >> 32n) & 0xFFFFFFFFn));
const pcBig = (m) => { let n = 0; for (let i = 0; i < 64; i++) if ((m & BIT[i]) !== 0n) n++; return n; };

// a model record: BigInt value, bit table, prefix counts pre[b] = set bits strictly below b, ascending list
function mk(lo, hi) {
    const m = big(lo, hi), bit = new Uint8Array(64), pre = new Uint8Array(65), list = [];
    for (let i = 0; i < 64; i++) {
        bit[i] = (m & BIT[i]) !== 0n ? 1 : 0;
        pre[i + 1] = pre[i] + bit[i];
        if (bit[i]) list.push(i);
    }
    return { lo: lo | 0, hi: hi | 0, m, bit, pre, list };
}
const mkBig = (m) => mk(loOf(m), hiOf(m));

// oracle 2 scratch sets: a FastBit1024(64) loaded from a hand-built image, and one filled with add()
const IMG = new Int32Array(3);
function ora(set, lo, hi) { IMG[0] = HEADER; IMG[1] = lo; IMG[2] = hi; set.loadFrom(IMG, 0); return set; }
function g1024(list) { const g = new FastBit1024(64); for (const b of list) g.add(b); return g; }
const O1 = new FastBit1024(64), O2 = new FastBit1024(64), O3 = new FastBit1024(64);

// ---------------------------------------------------------------- the word-pair corpus (A3: >= 2,621)
const SPEC_W = [0, 1, -1, MIN, MAX, 0x80000001 | 0, 0x55555555, 0xAAAAAAAA | 0, 0xFFFF, 0xFFFF0000 | 0, 0x7FFFFFFE, 0xFFFFFFFE | 0, 1 << 16];
const PAIRS = [];
for (const a of SPEC_W) for (const b of SPEC_W) PAIRS.push(mk(a, b));                // 169
for (let b = 0; b < 64; b++) {                                                           // 64 singles + 64 complements
    const s = BIT[b];
    PAIRS.push(mkBig(s));
    PAIRS.push(mkBig(M64 ^ s));
}
{
    const rw = stream(0x6a09e667);
    for (let i = 0; PAIRS.length < 2700; i++) {
        const a = rw(), b = rw(), c = rw(), d = rw();
        const kind = i & 3;
        if (kind === 0) PAIRS.push(mk(a | 0, b | 0));
        else if (kind === 1) PAIRS.push(mk((a & c & d) | 0, (b & c & d) | 0));     // sparse
        else if (kind === 2) PAIRS.push(mk((a | c | d) | 0, (b | c | d) | 0));     // dense
        else PAIRS.push(mk(a | 0, (i & 4) ? 0 : -1));                              // one word empty / full
    }
}
const N = PAIRS.length;

describe('FastBit64 A3 -- corpus', () => {
    it('has >= 2,621 word pairs including bits 31 / 32 / 63, -1 and -2^31', () => {
        CUR = 'A3';
        assert.ok(N >= 2621, 'pairs ' + N);
        const has = (lo, hi) => PAIRS.some((p) => p.lo === (lo | 0) && p.hi === (hi | 0));
        assert.ok(has(MIN, 0), 'bit 31 alone');
        assert.ok(has(0, 1), 'bit 32 alone');
        assert.ok(has(0, MIN), 'bit 63 alone');
        assert.ok(has(-1, -1), 'all ones');
        assert.ok(has(MIN, MIN), '-2^31 in both words');
    });
});

// ---------------------------------------------------------------- A3: constructor normalization
describe('FastBit64 A3 -- constructor normalization', () => {
    it('(0x80000000, 0xFFFFFFFF) gives lo -2147483648, hi -1', () => {
        CUR = 'A3';
        const x = new FastBit64(0x80000000, 0xFFFFFFFF);
        eq(x.lo, -2147483648, 'lo');
        eq(x.hi, -1, 'hi');
    });
    it('hand-derived normalization table (value mod 2^32 as signed int32)', () => {
        CUR = 'A3';
        const rows = [
            // [lo in, hi in, lo out, hi out]; 2^32 - 1 -> -1, 2^31 -> -2^31, 2^31 - 1 stays
            [0, 0, 0, 0], [-1, -1, -1, -1], [4294967295, 4294967295, -1, -1],
            [2147483647, 2147483648, 2147483647, MIN], [MIN, 0, MIN, 0], [1, 2147483648, 1, MIN],
            [2147483648, 2147483647, MIN, 2147483647], [4294967294, 1, -2, 1], [0, 4294967295, 0, -1],
        ];
        for (const [a, b, ea, eb] of rows) {
            const x = new FastBit64(a, b);
            eq(x.lo, ea, 'lo of (' + a + ', ' + b + ')');
            eq(x.hi, eb, 'hi of (' + a + ', ' + b + ')');
        }
    });
    it('defaults: no arguments, undefined and a lone lo', () => {
        CUR = 'A3';
        for (const x of [new FastBit64(), new FastBit64(undefined, undefined)]) { eq(x.lo, 0, 'lo'); eq(x.hi, 0, 'hi'); }
        const y = new FastBit64(5);
        eq(y.lo, 5, 'lo'); eq(y.hi, 0, 'hi');
    });
    it('signed and unsigned forms of the same 32 bits store the same signed word (seeded)', () => {
        CUR = 'A3';
        const r = stream(0x6a09e667 ^ 0x5555);
        for (let i = 0; i < 2000; i++) {
            const w = r(), v = r();
            const x = new FastBit64(w, v), y = new FastBit64(w | 0, v | 0);
            eq(x.lo, w | 0, 'lo'); eq(x.hi, v | 0, 'hi'); eq(y.lo, x.lo, 'lo parity'); eq(y.hi, x.hi, 'hi parity');
            eq(Number.isInteger(x.lo) && x.lo >= MIN && x.lo <= MAX, true, 'lo is int32');
        }
    });
});

// ---------------------------------------------------------------- A3: per-pair parity against both oracles
describe('FastBit64 A3 -- whole-set queries vs BigInt and FastBit1024(64)', () => {
    it('lo hi count isEmpty isFull lowest highest nextClearBit highestClearBit on every pair', () => {
        CUR = 'A3';
        for (let i = 0; i < N; i++) {
            const p = PAIRS[i], x = new FastBit64(p.lo, p.hi), f = ora(O1, p.lo, p.hi);
            const w = 'pair ' + p.lo + ',' + p.hi + ' ';
            eq(x.lo, p.lo, w + 'lo'); eq(x.hi, p.hi, w + 'hi');
            eq(x.count(), p.list.length, w + 'count'); eq(x.count(), f.size, w + 'count vs 1024');
            eq(x.isEmpty(), p.m === 0n, w + 'isEmpty'); eq(x.isEmpty(), f.isEmpty(), w + 'isEmpty vs 1024');
            eq(x.isFull(), p.list.length === 64, w + 'isFull'); eq(x.isFull(), f.isFull(), w + 'isFull vs 1024');
            const lowest = p.list.length ? p.list[0] : -1, highest = p.list.length ? p.list[p.list.length - 1] : -1;
            eq(x.lowest(), lowest, w + 'lowest'); eq(x.lowest(), f.lowest(), w + 'lowest vs 1024');
            eq(x.highest(), highest, w + 'highest'); eq(x.highest(), f.highest(), w + 'highest vs 1024');
            let nc = -1, hc = -1;
            for (let b = 0; b < 64; b++) if (!p.bit[b]) { if (nc === -1) nc = b; hc = b; }
            eq(x.nextClearBit(), nc, w + 'nextClearBit'); eq(x.nextClearBit(), f.nextClearBit(), w + 'nextClearBit vs 1024');
            eq(x.highestClearBit(), hc, w + 'highestClearBit');
            eq(x.lo, p.lo, w + 'unchanged lo'); eq(x.hi, p.hi, w + 'unchanged hi');
        }
    });
});

describe('FastBit64 A3 -- cursors, has, rank, select (exhaustive per pair)', () => {
    it('has 0..63, nextSetBit 0..64, prevSetBit -1..63, rank 0..63, select 0..63 on every pair', () => {
        CUR = 'A3';
        for (let i = 0; i < N; i++) {
            const p = PAIRS[i], x = new FastBit64(p.lo, p.hi), f = ora(O1, p.lo, p.hi);
            const w = 'pair ' + p.lo + ',' + p.hi + ' ';
            for (let b = 0; b < 64; b++) {
                eq(x.has(b), p.bit[b] === 1, w + 'has ' + b);
                eq(x.has(b), f.has(b), w + 'has vs 1024 ' + b);
                eq(x.rank(b), p.pre[b], w + 'rank ' + b);
                const k = b;
                eq(x.select(k), k < p.list.length ? p.list[k] : -1, w + 'select ' + k);
                if (p.bit[b]) eq(x.select(x.rank(b)), b, w + 'select(rank(b)) ' + b);
            }
            for (let k = 0; k < p.list.length; k++) eq(x.rank(x.select(k)), k, w + 'rank(select(k)) ' + k);
            for (let from = 0; from <= 64; from++) {
                let exp = -1;
                for (let b = from; b < 64; b++) if (p.bit[b]) { exp = b; break; }
                eq(x.nextSetBit(from), exp, w + 'nextSetBit ' + from);
                eq(x.nextSetBit(from), f.nextSetBit(from), w + 'nextSetBit vs 1024 ' + from);
            }
            for (let from = -1; from <= 63; from++) {
                let exp = -1;
                for (let b = from; b >= 0; b--) if (p.bit[b]) { exp = b; break; }
                eq(x.prevSetBit(from), exp, w + 'prevSetBit ' + from);
                eq(x.prevSetBit(from), f.prevSetBit(from), w + 'prevSetBit vs 1024 ' + from);
            }
            // a nextSetBit(b + 1) walk visits exactly the model list
            const walk = [];
            for (let b = x.nextSetBit(0); b !== -1; b = x.nextSetBit(b + 1)) walk.push(b);
            same(walk, p.list, w + 'next walk');
            const back = [];
            for (let b = x.prevSetBit(63); b !== -1; b = x.prevSetBit(b - 1)) back.push(b);
            same(back, p.list.slice().reverse(), w + 'prev walk');
        }
    });
});

describe('FastBit64 A3 -- add / remove / toggle', () => {
    it('every bit 0..63 on the first 700 pairs, 12 sampled bits on the rest, vs BigInt and FastBit1024', () => {
        CUR = 'A3';
        const rk = stream(0xc0ffee11 ^ 0x77);
        let ops = 0;
        for (let i = 0; i < N; i++) {
            const p = PAIRS[i];
            let bits;
            if (i < 700) { bits = []; for (let b = 0; b < 64; b++) bits.push(b); }
            else { bits = [0, 1, 30, 31, 32, 33, 62, 63]; for (let j = 0; j < 4; j++) bits.push(rk() & 63); }
            for (const b of bits) {
                for (let kind = 0; kind < 3; kind++) {
                    const t = new FastBit64(p.lo, p.hi);
                    const g = ora(O2, p.lo, p.hi);
                    let exp, r;
                    if (kind === 0) { r = t.add(b); exp = p.m | BIT[b]; g.add(b); }
                    else if (kind === 1) { r = t.remove(b); exp = p.m & ~BIT[b]; g.remove(b); }
                    else { r = t.toggle(b); exp = p.m ^ BIT[b]; g.toggle(b); }
                    const w = ['add', 'remove', 'toggle'][kind] + '(' + b + ') on ' + p.lo + ',' + p.hi;
                    eq(r, t, w + ' returns this');
                    eq(t.lo, loOf(exp), w + ' lo'); eq(t.hi, hiOf(exp), w + ' hi');
                    eq(g.equals(ora(O3, t.lo, t.hi)), true, w + ' vs 1024');
                    ops++;
                }
            }
        }
        assert.ok(ops >= 700 * 64 * 3, 'mutator ops ' + ops);
    });
});

describe('FastBit64 A3 -- cross-set methods and raw words', () => {
    it('10 cross-set methods + setWords / equalsWords on every pair, 3 partners each', () => {
        CUR = 'A3';
        let n = 0;
        for (let i = 0; i < N; i++) {
            const p = PAIRS[i];
            for (const j of [(i * 31 + 7) % N, (i + 1) % N, i]) {
                const q = PAIRS[j], w = ' (' + p.lo + ',' + p.hi + ') x (' + q.lo + ',' + q.hi + ')';
                const fx = ora(O1, p.lo, p.hi), fy = ora(O2, q.lo, q.hi);
                const y = new FastBit64(q.lo, q.hi), x = new FastBit64(p.lo, p.hi);
                eq(x.hasAll(y), (q.m & ~p.m) === 0n, 'hasAll' + w); eq(x.hasAll(y), fx.hasAll(fy), 'hasAll vs 1024' + w);
                eq(x.hasAny(y), (p.m & q.m) !== 0n, 'hasAny' + w); eq(x.hasAny(y), fx.hasAny(fy), 'hasAny vs 1024' + w);
                eq(x.hasNone(y), (p.m & q.m) === 0n, 'hasNone' + w); eq(x.hasNone(y), !fx.hasAny(fy), 'hasNone vs 1024' + w);
                eq(x.isSubsetOf(y), (p.m & ~q.m) === 0n, 'isSubsetOf' + w); eq(x.isSubsetOf(y), fy.hasAll(fx), 'isSubsetOf vs 1024' + w);
                eq(x.equals(y), p.m === q.m, 'equals' + w); eq(x.equals(y), fx.equals(fy), 'equals vs 1024' + w);
                eq(x.countMasked(y), pcBig(p.m & q.m), 'countMasked' + w); eq(x.countMasked(y), fx.intersectionSize(fy), 'countMasked vs 1024' + w);
                eq(x.equalsWords(q.lo, q.hi), p.m === q.m, 'equalsWords' + w);
                eq(x.equalsWords(q.lo >>> 0, q.hi >>> 0), p.m === q.m, 'equalsWords unsigned' + w);
                eq(x.equalsWords(p.lo, p.hi), true, 'equalsWords self' + w);
                eq(x.equalsWords(p.lo ^ 1, p.hi), false, 'equalsWords lo bit 0 flipped' + w);
                eq(x.equalsWords(p.lo, p.hi ^ MIN), false, 'equalsWords hi bit 63 flipped' + w);
                eq(y.lo, q.lo, 'other lo untouched' + w); eq(y.hi, q.hi, 'other hi untouched' + w);
                eq(x.lo, p.lo, 'receiver untouched by queries' + w); eq(x.hi, p.hi, 'receiver untouched by queries' + w);
                const run = (name, exp, oracleCount) => {
                    const t = new FastBit64(p.lo, p.hi);
                    const r = t[name](y);
                    eq(r, t, name + ' returns this' + w);
                    eq(t.lo, loOf(exp), name + ' lo' + w); eq(t.hi, hiOf(exp), name + ' hi' + w);
                    eq(y.lo, q.lo, name + ' other lo' + w); eq(y.hi, q.hi, name + ' other hi' + w);
                    if (oracleCount !== undefined) eq(pcBig(exp), oracleCount, name + ' count vs 1024' + w);
                };
                run('union', p.m | q.m, fx.unionSize(fy));
                run('difference', p.m & ~q.m, fx.differenceSize(fy));
                run('intersect', p.m & q.m, fx.intersectionSize(fy));
                run('copy', q.m);
                const fc = ora(O3, p.lo, p.hi).copy(fy);
                eq(fc.equals(fy), true, 'copy vs 1024' + w);
                const s = new FastBit64(1, 2);
                eq(s.setWords(q.lo >>> 0, q.hi >>> 0), s, 'setWords returns this' + w);
                eq(s.lo, q.lo, 'setWords lo' + w); eq(s.hi, q.hi, 'setWords hi' + w);
                s.setWords(q.lo, q.hi);
                eq(s.lo, q.lo, 'setWords signed lo' + w); eq(s.hi, q.hi, 'setWords signed hi' + w);
                n++;
            }
        }
        assert.ok(n >= 3 * 2621, 'partner rows ' + n);
    });

    it('a subclass instance is accepted as receiver and as other, same results', () => {
        CUR = 'A3';
        class Sub extends FastBit64 {}
        for (let i = 0; i < 300; i++) {
            const p = PAIRS[i], q = PAIRS[(i * 17 + 3) % N];
            const a = new Sub(p.lo, p.hi), b = new Sub(q.lo, q.hi), c = new FastBit64(q.lo, q.hi);
            for (const name of ['hasAll', 'hasAny', 'hasNone', 'isSubsetOf', 'equals', 'countMasked']) {
                eq(a[name](b), new FastBit64(p.lo, p.hi)[name](c), name + ' with subclass other');
            }
            for (const name of ['union', 'difference', 'intersect', 'copy']) {
                const t1 = new FastBit64(p.lo, p.hi), t2 = new FastBit64(p.lo, p.hi);
                t1[name](b); t2[name](c);
                eq(t1.lo, t2.lo, name + ' lo'); eq(t1.hi, t2.hi, name + ' hi');
                const s = new Sub(p.lo, p.hi);
                eq(s[name](c), s, name + ' on a subclass returns this');
                eq(s.lo, t2.lo, name + ' subclass receiver lo');
            }
        }
    });
});

describe('FastBit64 A3 -- cold members vs both oracles', () => {
    it('forEach, toArray, clone, fromArray, toBinaryString, clear on every pair', () => {
        CUR = 'A3';
        for (let i = 0; i < N; i++) {
            const p = PAIRS[i], x = new FastBit64(p.lo, p.hi), g = g1024(p.list), w = 'pair ' + p.lo + ',' + p.hi + ' ';
            const seen = [], seenG = [];
            eq(x.forEach((b) => { seen.push(b); }), x, w + 'forEach returns this');
            g.forEach((b) => { seenG.push(b); });
            same(seen, p.list, w + 'forEach order'); same(seen, seenG, w + 'forEach vs 1024');
            const arr = x.toArray();
            eq(Array.isArray(arr), true, w + 'toArray is an Array');
            same(arr, p.list, w + 'toArray'); eq(x.toArray() !== arr, true, w + 'toArray fresh');
            const c = x.clone();
            eq(c instanceof FastBit64, true, w + 'clone class'); eq(c !== x, true, w + 'clone distinct');
            eq(c.lo, p.lo, w + 'clone lo'); eq(c.hi, p.hi, w + 'clone hi');
            c.toggle(0); eq(x.lo, p.lo, w + 'clone independent'); eq(x.hi, p.hi, w + 'clone independent');
            const f1 = new FastBit64(MIN, MIN), f2 = new FastBit64(-1, -1), f3 = new FastBit64(3, 3);
            eq(f1.fromArray(p.list), f1, w + 'fromArray returns this');
            eq(f1.lo, p.lo, w + 'fromArray(Array) lo'); eq(f1.hi, p.hi, w + 'fromArray(Array) hi');
            f2.fromArray(Int32Array.from(p.list)); eq(f2.lo, p.lo, w + 'fromArray(Int32Array) lo'); eq(f2.hi, p.hi, w + 'fromArray(Int32Array) hi');
            f3.fromArray(Float64Array.from(p.list.slice().reverse())); eq(f3.lo, p.lo, w + 'fromArray(Float64Array) lo'); eq(f3.hi, p.hi, w + 'fromArray(Float64Array) hi');
            const bin = p.m.toString(2);
            eq(x.toBinaryString(), bin.padStart(64, '0'), w + 'toBinaryString()');
            eq(x.toBinaryString(true), bin.padStart(64, '0'), w + 'toBinaryString(true)');
            eq(x.toBinaryString(false), bin, w + 'toBinaryString(false)');
            eq(x.toBinaryString().length, 64, w + 'toBinaryString length');
            eq(x.clear(), x, w + 'clear returns this'); eq(x.lo, 0, w + 'clear lo'); eq(x.hi, 0, w + 'clear hi');
        }
    });
});

// ---------------------------------------------------------------- A3: ranges
const RW = [[0, 0], [-1, -1], [MIN, 0], [0, MIN], [MAX, -1], [-1, 0], [0, -1], [1, 1], [0x55555555, 0xAAAAAAAA | 0],
    [0xAAAAAAAA | 0, 0x55555555], [MIN, 1], [0xFFFF, 0xFFFF0000 | 0], [0xFFFF0000 | 0, 0xFFFF], [MIN, MIN]].map(([a, b]) => mk(a, b));
{
    const rr = stream(0xbb67ae85);
    while (RW.length < 40) RW.push(mk(rr() | 0, rr() | 0));
}
const RANGES = [];
for (let a = 0; a <= 64; a++) for (let b = a; b <= 64; b++) {
    const m = ((1n << BigInt(b)) - 1n) ^ ((1n << BigInt(a)) - 1n);          // bits a..b-1
    RANGES.push({ a, b, m });
}

describe('FastBit64 A3 -- half-open ranges', () => {
    it('there are exactly 2,145 ranges 0 <= a <= b <= 64 and 40 words (hand count: 65 * 66 / 2)', () => {
        CUR = 'A3';
        assert.equal(RANGES.length, 2145);
        assert.ok(RW.length >= 40);
    });
    it('addRange / removeRange / countRange, all 2,145 ranges on 40 words, vs BigInt and FastBit1024', () => {
        CUR = 'A3';
        let n = 0;
        for (const p of RW) {
            for (const r of RANGES) {
                const w = 'range [' + r.a + ',' + r.b + ') on ' + p.lo + ',' + p.hi;
                const t = new FastBit64(p.lo, p.hi), g = ora(O1, p.lo, p.hi);
                eq(t.addRange(r.a, r.b), t, w + ' addRange returns this');
                g.addRange(r.a, r.b);
                const ea = p.m | r.m;
                eq(t.lo, loOf(ea), w + ' addRange lo'); eq(t.hi, hiOf(ea), w + ' addRange hi');
                eq(g.equals(ora(O3, t.lo, t.hi)), true, w + ' addRange vs 1024');
                const u = new FastBit64(p.lo, p.hi), h = ora(O2, p.lo, p.hi);
                eq(u.removeRange(r.a, r.b), u, w + ' removeRange returns this');
                h.removeRange(r.a, r.b);
                const er = p.m & ~r.m;
                eq(u.lo, loOf(er), w + ' removeRange lo'); eq(u.hi, hiOf(er), w + ' removeRange hi');
                eq(h.equals(ora(O3, u.lo, u.hi)), true, w + ' removeRange vs 1024');
                const v = new FastBit64(p.lo, p.hi), k = ora(O3, p.lo, p.hi);
                const cnt = v.countRange(r.a, r.b);
                k.removeRange(0, r.a); k.removeRange(r.b, 64);                     // FastBit1024 identity: size of what is left
                eq(cnt, p.pre[r.b] - p.pre[r.a], w + ' countRange vs prefix counts');
                eq(cnt, k.size, w + ' countRange vs 1024');
                eq(v.lo, p.lo, w + ' countRange leaves lo'); eq(v.hi, p.hi, w + ' countRange leaves hi');
                n += 3;
            }
        }
        assert.ok(n >= 40 * 2145 * 3, 'range rows ' + n);
    });
});

// ---------------------------------------------------------------- A3: randomized op sequence (independent key / op streams)
describe('FastBit64 A3 -- seeded random op sequence vs BigInt', () => {
    it('20,000 mixed ops; every op kind at least 1,000 times; state equals the model after every op', () => {
        CUR = 'A3';
        const ops = stream(0x13198a2e), keys = stream(0xc0ffee11);
        const NAMES = ['add', 'remove', 'toggle', 'setWords', 'union', 'difference', 'intersect', 'copy', 'addRange', 'removeRange', 'clear', 'fromArray'];
        const hit = new Array(12).fill(0);
        const x = new FastBit64();
        let m = 0n;
        const STEPS = 20000;
        for (let s = 0; s < STEPS; s++) {
            const op = ops() % 12;
            hit[op]++;
            if (op <= 2) {
                const b = keys() & 63;
                if (op === 0) { x.add(b); m |= BIT[b]; } else if (op === 1) { x.remove(b); m &= ~BIT[b]; } else { x.toggle(b); m ^= BIT[b]; }
            } else if (op === 3) {
                const a = keys() | 0, b = keys() | 0;
                x.setWords(a, b); m = big(a, b);
            } else if (op >= 4 && op <= 7) {
                const a = keys() | 0, b = keys() | 0;
                const y = new FastBit64(a, b), ym = big(a, b);
                if (op === 4) { x.union(y); m |= ym; } else if (op === 5) { x.difference(y); m &= ~ym; }
                else if (op === 6) { x.intersect(y); m &= ym; } else { x.copy(y); m = ym; }
            } else if (op === 8 || op === 9) {
                let a = keys() % 65, b = keys() % 65;
                if (a > b) { const t = a; a = b; b = t; }
                const rm = ((1n << BigInt(b)) - 1n) ^ ((1n << BigInt(a)) - 1n);
                if (op === 8) { x.addRange(a, b); m |= rm; } else { x.removeRange(a, b); m &= ~rm; }
            } else if (op === 10) {
                x.clear(); m = 0n;
            } else {
                const len = keys() % 6, list = [];
                m = 0n;
                for (let i = 0; i < len; i++) { const b = keys() & 63; list.push(b); m |= BIT[b]; }
                x.fromArray(list);
            }
            const w = 'step ' + s + ' op ' + NAMES[op];
            eq(x.lo, loOf(m), w + ' lo'); eq(x.hi, hiOf(m), w + ' hi');
            if ((s & 15) === 0) {
                const q = mkBig(m);
                eq(x.count(), q.list.length, w + ' count');
                same(x.toArray(), q.list, w + ' toArray');
                eq(x.lowest(), q.list.length ? q.list[0] : -1, w + ' lowest');
                eq(x.highest(), q.list.length ? q.list[q.list.length - 1] : -1, w + ' highest');
            }
        }
        for (let k = 0; k < 12; k++) assert.ok(hit[k] >= 1000, 'coverage floor: ' + NAMES[k] + ' ran ' + hit[k] + ' times');
    });
});

// ---------------------------------------------------------------- A4: fail-closed rows
const R = RangeError, T = TypeError;
const describeVal = (v) => typeof v === 'symbol' ? 'Symbol' : typeof v === 'bigint' ? String(v) + 'n'
    : (typeof v === 'object' && v !== null) ? (Array.isArray(v) ? 'array' : 'object') : String(v);
const snap = (x) => x.lo + ':' + x.hi;
function rejects(x, fn, Cls, label, prefix = true) {
    CUR = 'A4';
    const before = x ? snap(x) : null;
    let err = null;
    try { fn(); } catch (e) { err = e; }
    if (!err) assert.fail(label + ': did not throw');
    if (!(err instanceof Cls)) assert.fail(label + ': expected ' + Cls.name + ', got ' + (err && err.name) + ': ' + (err && err.message));
    if (prefix && Cls === R && !String(err.message).startsWith('FastBit64: ')) assert.fail(label + ': message lacks the FastBit64: prefix: ' + err.message);
    if (x && snap(x) !== before) assert.fail(label + ': receiver changed ' + before + ' -> ' + snap(x));
    ROWS.A4++;
}
const mkPre = () => new FastBit64(0x12345678, 0x9abcdef0 | 0);

// values that are invalid in EVERY index / cursor / range-bound slot: [value, error class]
const COMMON = [[1.5, R], [-0.5, R], [NaN, R], ['3', R], ['', R], [null, R], [undefined, R], [2 ** 32 + 3, R], [true, R],
    [Infinity, R], [-Infinity, R], [{}, R], [[3], R], [{ valueOf() { return 3; } }, R], [Symbol('s'), T], [5n, T]];
const INDEX_BAD = COMMON.concat([[-1, R], [64, R], [65, R], [127, R], [128, R], [1024, R], [MIN, R], [2 ** 31, R]]);
const NEXT_BAD = COMMON.concat([[-1, R], [65, R], [127, R], [128, R], [1024, R], [MIN, R], [2 ** 31, R]]);
const PREV_BAD = COMMON.concat([[-2, R], [-64, R], [64, R], [65, R], [127, R], [128, R], [1024, R], [MIN, R]]);

describe('FastBit64 A4 -- index, cursor and range arguments', () => {
    for (const name of ['add', 'remove', 'toggle', 'has', 'rank', 'select']) {
        it(name + ': every bad index is a RangeError (TypeError for Symbol / BigInt); receiver unchanged', () => {
            for (const [v, Cls] of INDEX_BAD) {
                const x = mkPre();
                rejects(x, () => x[name](v), Cls, name + '(' + describeVal(v) + ')');
            }
            const x = mkPre();
            rejects(x, () => x[name](), R, name + '()');
        });
    }
    it('index domain edges: 0 and 63 are accepted, 64 is not (hand-derived)', () => {
        CUR = 'A4';
        const x = new FastBit64();
        x.add(0).add(63);
        eq(x.lo, 1, 'bit 0'); eq(x.hi, MIN, 'bit 63');
        eq(x.has(63), true, 'has 63'); eq(x.rank(63), 1, 'rank 63'); eq(x.select(1), 63, 'select 1');
        eq(x.select(63), -1, 'select(63) with count 2 is -1, not an error');
    });
    it('nextSetBit: bad arguments throw; 0..64 are accepted (64 returns -1)', () => {
        for (const [v, Cls] of NEXT_BAD) {
            const x = mkPre();
            rejects(x, () => x.nextSetBit(v), Cls, 'nextSetBit(' + describeVal(v) + ')');
        }
        const x = mkPre();
        rejects(x, () => x.nextSetBit(), R, 'nextSetBit()');
        CUR = 'A4';
        eq(new FastBit64(-1, -1).nextSetBit(64), -1, 'nextSetBit(64)');
        eq(new FastBit64(-1, -1).nextSetBit(63), 63, 'nextSetBit(63)');
    });
    it('prevSetBit: bad arguments throw; -1..63 are accepted (-1 returns -1)', () => {
        for (const [v, Cls] of PREV_BAD) {
            const x = mkPre();
            rejects(x, () => x.prevSetBit(v), Cls, 'prevSetBit(' + describeVal(v) + ')');
        }
        const x = mkPre();
        rejects(x, () => x.prevSetBit(), R, 'prevSetBit()');
        CUR = 'A4';
        eq(new FastBit64(-1, -1).prevSetBit(-1), -1, 'prevSetBit(-1)');
        eq(new FastBit64(-1, -1).prevSetBit(63), 63, 'prevSetBit(63)');
        eq(new FastBit64(1, 0).prevSetBit(0), 0, 'prevSetBit(0)');
    });
    for (const name of ['addRange', 'removeRange', 'countRange']) {
        it(name + ': lo AND hi each get their own bad-input rows; a > b and b > 64 are RangeErrors', () => {
            for (const [v, Cls] of COMMON.concat([[-1, R], [65, R], [128, R], [MIN, R]])) {
                const x = mkPre();
                rejects(x, () => x[name](v, 10), Cls, name + '(' + describeVal(v) + ', 10)');
                rejects(x, () => x[name](0, v), Cls, name + '(0, ' + describeVal(v) + ')');
                rejects(x, () => x[name](3, v), Cls, name + '(3, ' + describeVal(v) + ')');
            }
            const x = mkPre();
            for (const [a, b] of [[5, 3], [64, 0], [1, 0], [0, 65], [64, 65], [65, 65], [128, 128], [0, 128], [-1, -1], [0, -1], [-1, 3], [3, -1], [MIN, 0], [0, 2 ** 32]]) {
                rejects(x, () => x[name](a, b), R, name + '(' + a + ', ' + b + ')');
            }
            rejects(x, () => x[name](), R, name + '()');
            rejects(x, () => x[name](3), R, name + '(3)');
            CUR = 'A4';
            // domain edges accepted: (0, 0), (64, 64), (0, 64)
            const y = new FastBit64(5, 6);
            y[name](0, 0); y[name](64, 64);
            eq(snap(y), '5:6', name + ' empty ranges leave the set');
            y[name](0, 64);
            eq(snap(y), name === 'addRange' ? '-1:-1' : name === 'removeRange' ? '0:0' : '5:6', name + '(0, 64)');
        });
    }
});

// word arguments: lo AND hi, never converted (valueOf / toString / @@toPrimitive spy stays at 0)
describe('FastBit64 A4 -- word arguments (ctor, setWords, equalsWords)', () => {
    let spyCalls = 0;
    const spy = {
        valueOf() { spyCalls++; return 5; },
        toString() { spyCalls++; return '5'; },
        [Symbol.toPrimitive]() { spyCalls++; return 5; },
    };
    const WORD_BAD = [2 ** 32, -(2 ** 31) - 1, 2 ** 53, 1.5, -0.5, NaN, Infinity, -Infinity, '5', '', null, true, {}, [5], new Number(5), spy, Symbol('w'), 5n];
    it('constructor: bad lo and bad hi each throw RangeError (Symbol / BigInt too); valueOf never called', () => {
        spyCalls = 0;
        for (const v of WORD_BAD) {
            rejects(null, () => new FastBit64(v, 0), R, 'new FastBit64(' + describeVal(v) + ', 0)');
            rejects(null, () => new FastBit64(0, v), R, 'new FastBit64(0, ' + describeVal(v) + ')');
            rejects(null, () => new FastBit64(v), R, 'new FastBit64(' + describeVal(v) + ')');
            rejects(null, () => new FastBit64(-1, v), R, 'new FastBit64(-1, ' + describeVal(v) + ')');
        }
        eq(spyCalls, 0, 'valueOf spy calls');
    });
    for (const name of ['setWords', 'equalsWords']) {
        it(name + ': bad lo and bad hi each throw RangeError; receiver unchanged; valueOf never called', () => {
            spyCalls = 0;
            for (const v of WORD_BAD.concat([undefined])) {
                const x = mkPre();
                rejects(x, () => x[name](v, 0), R, name + '(' + describeVal(v) + ', 0)');
                rejects(x, () => x[name](0, v), R, name + '(0, ' + describeVal(v) + ')');
                rejects(x, () => x[name](-1, v), R, name + '(-1, ' + describeVal(v) + ')');
                rejects(x, () => x[name](v, -1), R, name + '(' + describeVal(v) + ', -1)');
            }
            const x = mkPre();
            rejects(x, () => x[name](), R, name + '()');
            rejects(x, () => x[name](1), R, name + '(1)');
            eq(spyCalls, 0, 'valueOf spy calls');
        });
    }
    it('both int32 and uint32 edges are accepted: -2^31, 2^31 - 1, 2^31, 2^32 - 1', () => {
        CUR = 'A4';
        const x = new FastBit64();
        x.setWords(2 ** 32 - 1, 2 ** 31);
        eq(x.lo, -1, 'lo'); eq(x.hi, MIN, 'hi');
        x.setWords(MIN, MAX);
        eq(x.lo, MIN, 'lo'); eq(x.hi, MAX, 'hi');
        eq(x.equalsWords(2 ** 31, MAX), true, 'equalsWords unsigned lo');
        eq(x.equalsWords(MIN, 2 ** 31 - 1), true, 'equalsWords signed lo');
        eq(x.equalsWords(MIN, 2 ** 31), false, 'equalsWords differs in hi');
    });
});

// cross-set methods: 10 methods x 8 fakes (+ a missing argument) -> TypeError, receiver unchanged
describe('FastBit64 A4 -- cross-set methods reject everything that is not a FastBit64', () => {
    const METHODS = ['hasAll', 'hasAny', 'hasNone', 'isSubsetOf', 'equals', 'union', 'difference', 'intersect', 'copy', 'countMasked'];
    const real = new FastBit64(3, 4);
    const FAKES = [
        ['{}', () => ({})],
        ['{lo, hi} duck', () => ({ lo: 3, hi: 4 })],
        ['Proxy of a FastBit64', () => new Proxy(new FastBit64(3, 4), {})],
        ['Object.create(FastBit64.prototype) forgery', () => Object.create(FastBit64.prototype)],
        ['FastBit32', () => new FastBit32(3)],
        ['FastBit1024', () => new FastBit1024(64)],
        ['null', () => null],
        ['number 42', () => 42],
    ];
    it('there are 10 methods and 8 fakes (A4 row shape)', () => {
        assert.equal(METHODS.length, 10);
        assert.equal(FAKES.length, 8);
    });
    for (const m of METHODS) {
        it(m + ': every fake is a TypeError; receiver and the real other are unchanged', () => {
            for (const [label, make] of FAKES) {
                const x = mkPre(), fake = make();
                rejects(x, () => x[m](fake), T, m + '(' + label + ')', false);
            }
            const x = mkPre();
            rejects(x, () => x[m](), T, m + '()', false);
            CUR = 'A4';
            eq(snap(real), '3:4', 'real other unchanged');
        });
    }
    it('a subclass instance passes where a FastBit64 is required', () => {
        CUR = 'A4';
        class Sub extends FastBit64 {}
        const s = new Sub(3, 4);
        for (const m of METHODS) {
            const a = mkPre(), b = mkPre();
            const r1 = a[m](s), r2 = b[m](new FastBit64(3, 4));
            eq(snap(a), snap(b), m + ' receiver state');
            if (typeof r2 === 'boolean' || typeof r2 === 'number') eq(r1, r2, m + ' result');
            else eq(r1, a, m + ' returns this');
        }
    });
});

// fromArray: container law (Q-13) and element law
describe('FastBit64 A4 -- fromArray', () => {
    const preset = () => new FastBit64().fromArray([1, 2, 3]);
    const CONTAINERS = [['42', 42], ['true', true], ['null', null], ['undefined', undefined], ['{}', {}], ["{length: 'x'}", { length: 'x' }],
        ['{length: 1, 0: 3}', { length: 1, 0: 3 }], ["'abc'", 'abc'], ['function', () => {}], ['Set', new Set([1])], ['Map', new Map()],
        ['DataView', new DataView(new ArrayBuffer(8))], ['ArrayBuffer', new ArrayBuffer(8)], ['Symbol', Symbol('c')], ['5n', 5n],
        ['Object.create(Array.prototype)', Object.create(Array.prototype)]];
    it('a wrong container is a TypeError before any write (receiver keeps its bits)', () => {
        for (const [label, c] of CONTAINERS) {
            const x = preset();
            rejects(x, () => x.fromArray(c), T, 'fromArray(' + label + ')');
        }
        const x = preset();
        rejects(x, () => x.fromArray(), T, 'fromArray()');
        rejects(x, () => x.fromArray(new BigInt64Array([3n])), T, 'fromArray(BigInt64Array)', false);
    });
    it('every element is index-checked (first, middle, last slot) and nothing is written on a throw', () => {
        const BADS = COMMON.concat([[-1, R], [64, R], [65, R], [128, R], [MIN, R], [2 ** 32 + 3, R]]);
        for (const [v, Cls] of BADS) {
            for (const pos of [0, 1, 2]) {
                const arr = [4, 5, 6]; arr[pos] = v;
                const x = preset();
                rejects(x, () => x.fromArray(arr), Cls, 'fromArray([..' + describeVal(v) + ' at ' + pos + '])');
            }
        }
        for (const bad of [[3, 64], [64], [-1], [0, 63, 64], [1.5], [NaN], [[1]]]) {
            const x = preset();
            rejects(x, () => x.fromArray(bad), R, 'fromArray(' + JSON.stringify(bad) + ')');
        }
        const x = preset();
        rejects(x, () => x.fromArray([1, , 3]), R, 'fromArray(sparse)');
        for (const [ta, label] of [[new Float64Array([1.5]), 'Float64Array [1.5]'], [new Float64Array([2, NaN]), 'Float64Array [2, NaN]'],
            [new Float64Array([64]), 'Float64Array [64]'], [new Int32Array([-1]), 'Int32Array [-1]'], [new Int32Array([1, 64]), 'Int32Array [1, 64]'],
            [new Uint8Array([200]), 'Uint8Array [200]'], [new Int8Array([-3]), 'Int8Array [-3]'], [new Uint32Array([2 ** 32 - 1]), 'Uint32Array [2^32-1]']]) {
            rejects(x, () => x.fromArray(ta), R, 'fromArray(' + label + ')');
        }
    });
    it('accepted containers overwrite (never OR); duplicates and order do not matter; returns this', () => {
        CUR = 'A4';
        // expected words by hand: bit 31 -> lo = -2^31; bit 32 -> hi = 1; bit 63 -> hi = -2^31; bit 40 -> hi bit 8 = 256; bit 8 -> lo 256
        const cases = [[[], '0:0'], [[0], '1:0'], [[63], '0:' + MIN], [[0, 63], '1:' + MIN], [[3, 3, 3], '8:0'], [[31, 32], MIN + ':1'], [[40, 8], '256:256']];
        class Arr2 extends Array {}
        const makers = [(a) => a.slice(), (a) => Int32Array.from(a), (a) => Uint8Array.from(a), (a) => Float64Array.from(a), (a) => Arr2.from(a)];
        for (const [arr, exp] of cases) {
            for (const make of makers) {
                const x = preset(), c = make(arr);
                eq(x.fromArray(c), x, 'fromArray returns this');
                eq(snap(x), exp, 'fromArray ' + JSON.stringify(arr) + ' via ' + c.constructor.name);
            }
        }
    });
    it('each element is read exactly once (getter counts)', () => {
        CUR = 'A4';
        const arr = [0, 0, 0, 0];
        const reads = [0, 0, 0, 0];
        for (let i = 0; i < 4; i++) Object.defineProperty(arr, i, { get() { reads[i]++; return i + 10; }, enumerable: true, configurable: true });
        const x = new FastBit64().fromArray(arr);
        same(reads, [1, 1, 1, 1], 'reads per element');
        eq(snap(x), (1 << 10 | 1 << 11 | 1 << 12 | 1 << 13) + ':0', 'result bits 10..13');
    });
    it('a throw on a late element still leaves the receiver untouched (all checked before the single write)', () => {
        const x = preset();
        rejects(x, () => x.fromArray([0, 1, 2, 3, 4, 5, 6, 7, 64]), R, 'late bad element');
        rejects(x, () => x.fromArray(new Proxy([5], { get: (t, k) => k === 'length' ? -1 : t[k] })), T, 'fromArray(Array proxy, length -1)');
    });
});

// image slots: saveInto / loadFrom / deserialize
const OFFSET_BAD = [[-1, R], [1.5, R], [NaN, R], ['1', R], [null, R], [2 ** 30, R], [2 ** 30 + 1, R], [2 ** 32 + 1, R], [2 ** 31, R], [Infinity, R], [-Infinity, R],
    [{}, R], [{ valueOf() { return 1; } }, R], [true, R]];
const OFFSET_ANY = [[Symbol('o'), null], [5n, null]];       // Symbol / BigInt: TypeError from `&` (FastBit1024 law) or RangeError; either must throw
function rejectsAny(x, fn, label) {
    CUR = 'A4';
    const before = x ? snap(x) : null;
    let err = null;
    try { fn(); } catch (e) { err = e; }
    if (!err || !(err instanceof T)) assert.fail(label + ': expected TypeError, got ' + err);
    if (x && snap(x) !== before) assert.fail(label + ': receiver changed');
    ROWS.A4++;
}
const sentinel = (n) => { const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = 0x5a5a0000 + i * 1111; return a; };
function imageOf(cap, words, offset = 0, len = 0) {
    const L = (cap + 31) >>> 5, a = new Int32Array(Math.max(len, offset + 1 + L + 2));
    a.fill(0x11111111);
    a[offset] = TAG | cap;
    for (let w = 0; w < L; w++) a[offset + 1 + w] = words[w] | 0;
    return a;
}
const BAD_BUFS = [['[]', () => []], ['{}', () => ({})], ['null', () => null], ['undefined', () => undefined], ['Uint32Array', () => new Uint32Array(40)],
    ['Float32Array', () => new Float32Array(40)], ['Uint8Array', () => new Uint8Array(160)], ['DataView', () => new DataView(new ArrayBuffer(160))],
    ['ArrayBuffer', () => new ArrayBuffer(160)], ['Object.create(Int32Array.prototype)', () => Object.create(Int32Array.prototype)], ['42', () => 42],
    ['array-like', () => ({ length: 40, 0: TAG | 64 })],
    ['Uint32Array with Int32Array.prototype', () => Object.setPrototypeOf(new Uint32Array(40), Int32Array.prototype)]];

describe('FastBit64 A4 -- saveInto', () => {
    it('bad buffers are TypeErrors; nothing is written; receiver unchanged', () => {
        for (const [label, make] of BAD_BUFS) {
            const x = mkPre();
            rejects(x, () => x.saveInto(make()), T, 'saveInto(' + label + ')');
        }
        const x = mkPre();
        rejects(x, () => x.saveInto(), T, 'saveInto()');
    });
    it('bad offsets are RangeErrors; `out` is byte-for-byte unwritten', () => {
        const x = mkPre();
        for (const [v, Cls] of OFFSET_BAD.concat([[8, R], [9, R], [10, R], [11, R], [1000, R]])) {
            const out = sentinel(10), ref = Array.from(out);
            rejects(x, () => x.saveInto(out, v), Cls, 'saveInto(out, ' + describeVal(v) + ')');
            same(Array.from(out), ref, 'out after saveInto(out, ' + describeVal(v) + ')');
        }
        for (const [v] of OFFSET_ANY) {
            const out = sentinel(10), ref = Array.from(out);
            rejectsAny(x, () => x.saveInto(out, v), 'saveInto(out, ' + describeVal(v) + ')');
            same(Array.from(out), ref, 'out after saveInto(out, ' + describeVal(v) + ')');
        }
        for (const len of [0, 1, 2]) {
            const out = sentinel(len), ref = Array.from(out);
            rejects(x, () => x.saveInto(out, 0), R, 'saveInto(Int32Array(' + len + '))');
            same(Array.from(out), ref, 'short out untouched');
        }
        // an own `length` property cannot widen the buffer (intrinsic length is read)
        const lie = Object.defineProperty(sentinel(2), 'length', { value: 100 }), lref = Array.from(lie);
        rejects(x, () => x.saveInto(lie, 0), R, 'saveInto(out with a lying own length)');
        same(Array.from(lie), lref, 'lying out untouched');
    });
    it('a forged receiver is a TypeError and `out` is unchanged word for word', () => {
        const fakes = [['Object.create(FastBit64.prototype)', Object.create(FastBit64.prototype)], ['{}', {}], ['Proxy of a FastBit64', new Proxy(new FastBit64(1, 2), {})]];
        for (const [label, fake] of fakes) {
            const out = sentinel(10), ref = Array.from(out);
            rejects(null, () => FastBit64.prototype.saveInto.call(fake, out, 0), T, 'saveInto.call(' + label + ')', false);
            same(Array.from(out), ref, 'out after saveInto.call(' + label + ')');
        }
    });
    it('good offsets write exactly [header, lo, hi] at offset, return offset + 3, touch nothing else', () => {
        CUR = 'A4';
        const x = new FastBit64(0x80000001, 0xFFFFFFFE);
        for (const off of [undefined, 0, 1, 3, 7]) {
            const out = sentinel(10), ref = Array.from(out), o = off === undefined ? 0 : off;
            eq(x.saveInto(out, off), o + 3, 'return for offset ' + off);
            ref[o] = HEADER; ref[o + 1] = x.lo; ref[o + 2] = x.hi;
            same(Array.from(out), ref, 'out for offset ' + off);
        }
        class I32 extends Int32Array {}
        eq(x.saveInto(new I32(3)), 3, 'an Int32Array subclass is accepted');
    });
});

describe('FastBit64 A4 -- loadFrom and deserialize', () => {
    const good = () => imageOf(64, [7, 9], 0, 10);
    for (const kind of ['loadFrom', 'deserialize']) {
        const call = (x, src, off) => kind === 'loadFrom' ? (off === undefined ? x.loadFrom(src) : x.loadFrom(src, off))
            : (off === undefined ? FastBit64.deserialize(src) : FastBit64.deserialize(src, off));
        it(kind + ': bad buffers are TypeErrors; receiver and src unchanged', () => {
            for (const [label, make] of BAD_BUFS) {
                const x = mkPre();
                rejects(x, () => call(x, make()), T, kind + '(' + label + ')');
            }
            const x = mkPre();
            rejects(x, () => call(x, undefined), T, kind + '()');
        });
        it(kind + ': bad offsets are RangeErrors; offset >= length and an image that does not fit too', () => {
            const x = mkPre(), src = good(), ref = Array.from(src);
            for (const [v, Cls] of OFFSET_BAD.concat([[10, R], [11, R], [1000, R], [8, R], [9, R]])) {
                rejects(x, () => call(x, src, v), Cls, kind + '(src, ' + describeVal(v) + ')');
                if (v !== 8 && v !== 9) assert.throws(() => call(x, src, v), /^RangeError: FastBit64: offset/, kind + ' offset checked first: ' + describeVal(v));
            }
            for (const [v] of OFFSET_ANY) rejectsAny(x, () => call(x, src, v), kind + '(src, ' + describeVal(v) + ')');
            rejects(x, () => call(x, new Int32Array(0), 0), R, kind + '(empty)');
            same(Array.from(src), ref, 'src unchanged');
        });
        it(kind + ': bad images are RangeErrors (tag, version, capacity, length, bits at / above the capacity, bits >= 64)', () => {
            const rows = [];
            const withHdr = (h, words, len = 40) => { const a = new Int32Array(len); a[0] = h; for (let i = 0; i < words.length; i++) a[1 + i] = words[i]; return a; };
            rows.push(['zero header', withHdr(0, [])]);
            rows.push(['wrong tag FB -> GB', withHdr(0x47420840, [1, 1])]);
            rows.push(['version 0 (bits 11..15 clear)', withHdr(0x46420040, [1, 1])]);
            rows.push(['version 2', withHdr(0x46421040, [1, 1])]);
            rows.push(['capacity 0', withHdr(TAG, [0, 0])]);
            rows.push(['capacity 1025', withHdr(TAG | 1025, [0, 0])]);
            rows.push(['capacity 2047', withHdr(TAG | 2047, [0, 0])]);
            rows.push(['cap 64 truncated to header + 1 word', withHdr(HEADER, [1], 2)]);
            rows.push(['cap 65 needs 4 words, 3 given', withHdr(TAG | 65, [1, 1], 3)]);
            rows.push(['cap 1024 needs 33 words, 10 given', withHdr(TAG | 1024, [1, 1], 10)]);
            rows.push(['cap 1: bit 1 set', withHdr(TAG | 1, [2])]);
            rows.push(['cap 31: bit 31 set', withHdr(TAG | 31, [MIN])]);
            rows.push(['cap 33: bit 33 set', withHdr(TAG | 33, [0, 2])]);
            rows.push(['cap 63: bit 63 set', withHdr(TAG | 63, [0, MIN])]);
            rows.push(['cap 65: bit 64 set (does not fit 64)', withHdr(TAG | 65, [0, 0, 1])]);
            rows.push(['cap 65: bit 65 set (above image cap)', withHdr(TAG | 65, [0, 0, 2])]);
            rows.push(['cap 500: bit 499 set (fits the image, not 64)', (() => { const a = withHdr(TAG | 500, []); a[1 + 15] = 1 << 19; return a; })()]);
            rows.push(['cap 500: bit 500 set (above image cap)', (() => { const a = withHdr(TAG | 500, []); a[1 + 15] = 1 << 20; return a; })()]);
            rows.push(['cap 1024: bit 64 set', (() => { const a = withHdr(TAG | 1024, []); a[1 + 2] = 1; return a; })()]);
            rows.push(['cap 1024: bit 1023 set', (() => { const a = withHdr(TAG | 1024, []); a[1 + 31] = MIN; return a; })()]);
            rows.push(['cap 100: lo and hi valid, word 3 bit 4 (bit 100) set', (() => { const a = withHdr(TAG | 100, [1, 1]); a[1 + 3] = 16; return a; })()]);
            for (const [label, src] of rows) {
                const x = mkPre(), ref = Array.from(src);
                rejects(x, () => call(x, src, 0), R, kind + ' ' + label);
                same(Array.from(src), ref, 'src unchanged: ' + label);
            }
            // the same bad images, placed at offset 5
            for (const [label, src] of rows.slice(0, 12)) {
                const shifted = new Int32Array(src.length + 5); shifted.set(src, 5);
                const x = mkPre();
                rejects(x, () => call(x, shifted, 5), R, kind + ' at offset 5: ' + label);
            }
        });
    }
    it('loadFrom: a good image overwrites (never ORs) and returns offset + 1 + ceil(cap / 32); nothing else in src moves', () => {
        CUR = 'A4';
        const x = mkPre(), src = imageOf(64, [7, 9], 0, 10), ref = Array.from(src);
        eq(x.loadFrom(src), 3, 'return at offset 0');
        eq(snap(x), '7:9', 'words');
        const y = new FastBit64(-1, -1);
        eq(y.loadFrom(imageOf(1, [1]), 0), 2, 'cap 1 returns 2');
        eq(snap(y), '1:0', 'cap 1 image clears the rest');
        same(Array.from(src), ref, 'src unchanged');
    });
    it('deserialize: returns a FastBit64 with the image words, at any fitting offset', () => {
        CUR = 'A4';
        const src = imageOf(64, [MIN, 5], 4, 12);
        const d = FastBit64.deserialize(src, 4);
        eq(d instanceof FastBit64, true, 'class'); eq(snap(d), MIN + ':5', 'words');
        eq(snap(FastBit64.deserialize(imageOf(64, [3, 4]))), '3:4', 'default offset');
    });
});

// ---------------------------------------------------------------- A5: FastBit1024(64) interop
describe('FastBit64 A5 -- serialize equals FastBit1024(64) word for word', () => {
    it('header constant: 0x46420800 + 64 === 1178732608 (hand-derived in the file header)', () => {
        CUR = 'A5';
        eq(TAG + 64, HEADER, 'arithmetic');
        eq(HEADER, 1178732608, 'literal');
        eq(new FastBit64().serialize()[0], 1178732608, 'FastBit64 header word');
        eq(new FastBit1024(64).serialize()[0], 1178732608, 'FastBit1024(64) header word');
    });
    it('imageLength is 3 on the instance and the class', () => {
        CUR = 'A5';
        eq(new FastBit64().imageLength, 3, 'instance'); eq(FastBit64.imageLength, 3, 'static');
    });
    it('serialize, saveInto, deserialize and loadFrom match FastBit1024(64) on every pair', () => {
        CUR = 'A5';
        for (let i = 0; i < N; i++) {
            const p = PAIRS[i], x = new FastBit64(p.lo, p.hi), g = g1024(p.list), w = 'pair ' + p.lo + ',' + p.hi + ' ';
            const s = x.serialize(), sg = g.serialize();
            eq(s instanceof Int32Array, true, w + 'serialize is an Int32Array');
            eq(s.length, 3, w + 'serialize length');
            same(Array.from(s), Array.from(sg), w + 'serialize vs FastBit1024(64)');
            same(Array.from(s), [HEADER, p.lo, p.hi], w + 'serialize vs hand image');
            const o1 = sentinel(9), o2 = sentinel(9);
            eq(x.saveInto(o1, 5), g.saveInto(o2, 5), w + 'saveInto return'); eq(x.saveInto(o1, 5), 8, w + 'saveInto return is offset + 3');
            same(Array.from(o1), Array.from(o2), w + 'saveInto arena vs FastBit1024(64)');
            const d = FastBit64.deserialize(sg);
            eq(d.lo, p.lo, w + 'deserialize(FastBit1024 image) lo'); eq(d.hi, p.hi, w + 'deserialize(FastBit1024 image) hi');
            const l = new FastBit64(MIN, MIN);
            eq(l.loadFrom(sg), 3, w + 'loadFrom return'); eq(l.lo, p.lo, w + 'loadFrom lo'); eq(l.hi, p.hi, w + 'loadFrom hi');
            const back = FastBit1024.deserialize(s);
            eq(back.capacity, 64, w + 'FastBit1024 loads the FastBit64 image at capacity 64');
            eq(back.equals(g), true, w + 'FastBit1024.deserialize(FastBit64 image) equals');
        }
    });
});

describe('FastBit64 A5 -- loading both ways for capacities {1,31,32,33,63,64,65,500,1024}', () => {
    const CAPS = [1, 31, 32, 33, 63, 64, 65, 500, 1024];
    it('FastBit1024(cap) image -> FastBit64 (deserialize, loadFrom at offset 0 and 5); FastBit64 image -> FastBit1024(cap)', () => {
        CUR = 'A5';
        const rk = stream(0x3c6ef372);
        let loads = 0;
        for (const cap of CAPS) {
            const lim = cap < 64 ? cap : 64, L = (cap + 31) >>> 5;
            const lists = [[], [0], [lim - 1]];
            const all = []; for (let b = 0; b < lim; b++) all.push(b);
            lists.push(all);
            for (let r = 0; r < 12; r++) {
                const list = [];
                for (let b = 0; b < lim; b++) if ((rk() & 3) === 0) list.push(b);
                lists.push(list);
            }
            for (const list of lists) {
                const g = new FastBit1024(cap);
                let m = 0n;
                for (const b of list) { g.add(b); m |= BIT[b]; }
                const img = g.serialize(), w = 'cap ' + cap + ' bits ' + list.join(',') + ' ';
                eq(img.length, 1 + L, w + 'FastBit1024 image length');
                const d = FastBit64.deserialize(img);
                eq(d.lo, loOf(m), w + 'deserialize lo'); eq(d.hi, hiOf(m), w + 'deserialize hi');
                const x = new FastBit64(-1, -1);
                eq(x.loadFrom(img), 1 + L, w + 'loadFrom return offset 0');
                eq(x.lo, loOf(m), w + 'loadFrom lo'); eq(x.hi, hiOf(m), w + 'loadFrom hi');
                const arena = new Int32Array(5 + 1 + L + 4).fill(-1);
                g.saveInto(arena, 5);
                const y = new FastBit64(MIN, 1);
                eq(y.loadFrom(arena, 5), 5 + 1 + L, w + 'loadFrom return offset 5');
                eq(y.lo, loOf(m), w + 'offset-5 lo'); eq(y.hi, hiOf(m), w + 'offset-5 hi');
                const d5 = FastBit64.deserialize(arena, 5);
                eq(d5.lo, loOf(m), w + 'deserialize offset 5 lo'); eq(d5.hi, hiOf(m), w + 'deserialize offset 5 hi');
                // the other way: FastBit64 image into FastBit1024(cap) (bits are all below cap by construction)
                const img64 = new FastBit64(loOf(m), hiOf(m)).serialize();
                const g2 = new FastBit1024(cap);
                g2.loadFrom(img64, 0);
                eq(g2.size, list.length, w + 'FastBit1024 loads the FastBit64 image: size');
                for (let b = 0; b < lim; b++) eq(g2.has(b), (m & BIT[b]) !== 0n, w + 'FastBit1024 has ' + b);
                loads += 4;
            }
        }
        assert.ok(loads >= 9 * 16 * 4, 'load rows ' + loads);
    });
    it('a FastBit1024 image whose set bits reach 64 or more is refused by FastBit64 (caps 65, 500, 1024)', () => {
        for (const cap of [65, 500, 1024]) {
            const g = new FastBit1024(cap).add(3).add(64);
            const x = mkPre();
            rejects(x, () => x.loadFrom(g.serialize()), R, 'loadFrom(cap ' + cap + ' with bit 64)');
            rejects(null, () => FastBit64.deserialize(g.serialize()), R, 'deserialize(cap ' + cap + ' with bit 64)');
            const ok = new FastBit1024(cap).add(3).add(63);
            const y = new FastBit64();
            y.loadFrom(ok.serialize());
            CUR = 'A5';
            eq(y.lo, 8, 'bit 3'); eq(y.hi, MIN, 'bit 63');
        }
    });
    it('loadFrom(offset 5, cap 1024) returns 38 (5 + 1 + 32, hand count); cap 500 returns 22', () => {
        CUR = 'A5';
        const g = new FastBit1024(1024).add(3).add(40).add(63);
        const arena = new Int32Array(50).fill(7);
        eq(g.saveInto(arena, 5), 38, 'FastBit1024 saveInto return (oracle)');
        const x = new FastBit64();
        eq(x.loadFrom(arena, 5), 38, 'FastBit64 loadFrom return');
        eq(x.lo, 8, 'lo = bit 3'); eq(x.hi, (1 << 8) | MIN, 'hi = bits 40 and 63');
        const g5 = new FastBit1024(500).add(1);
        const a5 = new Int32Array(40).fill(7);
        eq(g5.saveInto(a5, 5), 5 + 1 + 16, 'oracle: 5 + 1 + ceil(500 / 32) = 22');
        eq(x.loadFrom(a5, 5), 22, 'FastBit64 loadFrom cap 500');
        eq(snap(x), '2:0', 'cap 500 words');
    });
});

describe('FastBit64 row counts', () => {
    it('reports the number of checked rows per assertion family', () => {
        console.log('FastBit64 rows: A3 ' + ROWS.A3 + ', A4 ' + ROWS.A4 + ', A5 ' + ROWS.A5 + ', pairs ' + N + ', ranges ' + RANGES.length + ' x ' + RW.length + ' words');
        assert.ok(ROWS.A3 > 0 && ROWS.A4 > 0 && ROWS.A5 > 0);
    });
});
