// test/FastBit1024Counts.test.mjs -- 1.6.0 L2: FastBit1024#prevSetBit and the cross-set
// counts intersectionSize / unionSize / differenceSize.
// Oracle: O1024 (a Uint8Array of bits + naive scans) and plain bit loops from
// test/torture/oracle.mjs; no expected value derives from the class's summaries or its words.
// Expected values come from the SPEC (.handoff/plan-fastbit1024-160.md, G2 plan A1 / A2),
// never from the implementation. Deterministic: seeded xorshift32, no timing.
// Totals: 278,200 prevSetBit queries = sum over caps of (cap + 1) x 5 densities x 20 reps
//   (caps 1,31,32,33,64,65,500,1023,1024 -> sum(cap + 1) = 2 + 32 + 33 + 34 + 65 + 66 + 501 + 1024 + 1025
//   = 2782; 2782 x 100 = 278,200); 900 reverse walks (9 x 5 x 20); 12,000 count checks (4,000 x 3).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FastBit1024, FastBit32 } from '../FastBit32.js';
import { O1024, fb1024Snapshot } from './torture/oracle.mjs';

// independent seeded xorshift32 streams (32-bit exact): one factory, separate states per stream
function stream(seed) {
    let x = seed | 0;
    if (x === 0) x = 1;
    return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
}
const SEED = 0x2545f491;

const CAPS = [1, 31, 32, 33, 64, 65, 500, 1023, 1024];

// Build the same random set in a FastBit1024 and in the oracle. density is per mille.
function build(cap, density, bits) {
    const s = new FastBit1024(cap), o = new O1024(cap);
    for (let i = 0; i < cap; i++) {
        if (bits() % 1000 < density) { s.add(i); o.b[i] = 1; }
    }
    return [s, o];
}

// naive descending scan from `from` (inclusive) over the oracle bits
function naivePrev(o, from) {
    for (let i = from; i >= 0; i--) if (o.b[i]) return i;
    return -1;
}

describe('FastBit1024#prevSetBit -- randomized vs a naive descending scan', () => {
    it('every from in -1..cap-1, 9 caps x 5 densities x 20 reps = 278,200 queries', () => {
        const bits = stream(SEED);
        let queries = 0, hits = 0, misses = 0, bad = 0;
        for (const cap of CAPS) {
            for (const density of [0, 3, 50, 500, 1000]) {
                for (let rep = 0; rep < 20; rep++) {
                    const [s, o] = build(cap, density, bits);
                    for (let from = -1; from < cap; from++) {
                        const want = naivePrev(o, from);
                        const got = s.prevSetBit(from);
                        queries++;
                        if (got === -1) misses++; else hits++;
                        if (got !== want || !Object.is(got, got | 0)) bad++;
                    }
                }
            }
        }
        assert.strictEqual(bad, 0);
        assert.strictEqual(queries, 278200);
        assert.ok(hits > 100000 && misses > 5000, 'coverage floor: hits ' + hits + ' misses ' + misses);
        console.log('prevSetBit queries: ' + queries + ' (hits ' + hits + ', misses ' + misses + '), fails ' + bad);
    });

    it('a bounded reverse cursor equals O1024.list() reversed: 900 walks', () => {
        const bits = stream(SEED ^ 0x6a09e667);
        let walks = 0, nonEmpty = 0;
        for (const cap of CAPS) {
            for (const density of [0, 3, 50, 500, 1000]) {
                for (let rep = 0; rep < 20; rep++) {
                    const [s, o] = build(cap, density, bits);
                    const want = o.list().reverse();
                    const got = [];
                    let steps = 0;
                    for (let b = s.prevSetBit(cap - 1); b !== -1 && steps <= cap + 1; b = s.prevSetBit(b - 1)) {
                        got.push(b);
                        steps++;
                    }
                    assert.ok(steps <= cap, 'walk exceeded capacity steps');
                    assert.deepStrictEqual(got, want);
                    walks++;
                    if (want.length) nonEmpty++;
                }
            }
        }
        assert.strictEqual(walks, 900);
        // density 0 gives 180 empty walks; sparse small caps add more -> floor 500 of 900
        assert.ok(nonEmpty >= 500, 'coverage floor: non-empty walks ' + nonEmpty);
        console.log('reverse walks: ' + walks + ' (non-empty ' + nonEmpty + ')');
    });
});

describe('FastBit1024 counts -- randomized pairs vs a naive bit loop', () => {
    it('4,000 pairs with independently drawn capacities x 3 counts = 12,000 checks', () => {
        // three independent streams: capacities, densities, bits
        const capS = stream(SEED ^ 0x3c6ef372), denS = stream(SEED ^ 0xa54ff53a), bits = stream(SEED ^ 0x510e527f);
        const DENS = [0, 10, 300, 700, 1000];
        let pairs = 0, checks = 0, bad = 0, diffCap = 0, interPos = 0, fullFull = 0, emptyEnds = 0;
        for (let p = 0; p < 4000; p++) {
            const capA = (capS() & 3) === 0 ? CAPS[capS() % CAPS.length] : 1 + capS() % 1024;
            const capB = (capS() & 3) === 0 ? CAPS[capS() % CAPS.length] : 1 + capS() % 1024;
            const dA = DENS[denS() % 5], dB = DENS[denS() % 5];
            const [a, oa] = build(capA, dA, bits), [b, ob] = build(capB, dB, bits);
            let inter = 0, uni = 0, dif = 0;
            for (let i = 0; i < 1024; i++) {
                const x = i < capA ? oa.b[i] : 0, y = i < capB ? ob.b[i] : 0;
                inter += x & y; uni += x | y; dif += x & (y ^ 1);
            }
            const got = [a.intersectionSize(b), a.unionSize(b), a.differenceSize(b)];
            const want = [inter, uni, dif];
            for (let k = 0; k < 3; k++) {
                checks++;
                const g = got[k];
                if (g !== want[k] || !Object.is(g, g | 0) || g < 0 || g > 1024) bad++;
            }
            pairs++;
            if (capA !== capB) diffCap++;
            if (inter > 0) interPos++;
            if (dA === 1000 && dB === 1000) fullFull++;
            if (dA === 0 || dB === 0) emptyEnds++;
        }
        assert.strictEqual(bad, 0);
        assert.strictEqual(pairs, 4000);
        assert.strictEqual(checks, 12000);
        assert.ok(diffCap >= 3500 && interPos >= 1500 && fullFull >= 50 && emptyEnds >= 1000,
            'coverage floor: ' + [diffCap, interPos, fullFull, emptyEnds].join(','));
        console.log('count pairs: ' + pairs + ', checks: ' + checks + ', fails ' + bad);
    });
});

describe('FastBit1024 prevSetBit / counts -- fail closed', () => {
    const BAD_FROM = [-2, 'cap', 1.5, NaN, null, undefined, '0', 1024, 2 ** 32, true]; // the 10 p2 rows ('cap' = capacity)
    const METHODS = ['intersectionSize', 'unionSize', 'differenceSize'];

    function seeded(cap) {
        const bits = stream(SEED ^ cap);
        return build(cap, 500, bits)[0];
    }

    it('prevSetBit: 10 bad values x caps {1,100,1023,1024} = 40 RangeError rows, receiver unchanged', () => {
        let rows = 0;
        for (const cap of [1, 100, 1023, 1024]) {
            const s = seeded(cap);
            for (const raw of BAD_FROM) {
                const f = raw === 'cap' ? cap : raw;
                const before = fb1024Snapshot(s);
                // <cap-1> in the spec text is the number capacity - 1
                const re = new RegExp('^FastBit1024: from must be an integer -1\\.\\.' + (cap - 1) + ', got ');
                assert.throws(() => s.prevSetBit(f), (e) => e instanceof RangeError && re.test(e.message),
                    'cap ' + cap + ' from ' + String(f));
                assert.strictEqual(fb1024Snapshot(s), before);
                rows++;
            }
        }
        assert.strictEqual(rows, 40);
    });

    it('prevSetBit: the domain edges are accepted (-1 and cap-1)', () => {
        for (const cap of [1, 100, 1023, 1024]) {
            const s = new FastBit1024(cap);
            assert.strictEqual(s.prevSetBit(-1), -1);
            assert.strictEqual(s.prevSetBit(cap - 1), -1);
            s.add(cap - 1);
            assert.strictEqual(s.prevSetBit(cap - 1), cap - 1);
            assert.strictEqual(s.prevSetBit(-1), -1);
        }
    });

    it('counts: 9 wrong others x 3 methods x 3 caps = 81 TypeError rows; 121 rows leave both sides unchanged', () => {
        let rows = 0;
        for (const cap of [1, 100, 1024]) {
            const s = seeded(cap);
            const real = seeded(33);
            const others = [
                null, undefined, 42, 'x', {}, s._data, new FastBit32(), Object.create(FastBit1024.prototype),
                new Proxy(real, {})
            ];
            for (const m of METHODS) {
                for (const o of others) {
                    const before = fb1024Snapshot(s), beforeT = fb1024Snapshot(real);
                    assert.throws(() => s[m](o), (e) => e instanceof TypeError
                        && e.message.startsWith('FastBit1024: expected a FastBit1024, got '),
                        m + ' cap ' + cap + ' other ' + Object.prototype.toString.call(o));
                    assert.strictEqual(fb1024Snapshot(s), before);
                    assert.strictEqual(fb1024Snapshot(real), beforeT);
                    rows++;
                }
            }
        }
        assert.strictEqual(rows, 81);
        // 40 prevSetBit RangeError rows (10 values x 4 caps) + the 81 TypeError rows
        assert.strictEqual(10 * 4 + rows, 121);
    });

    it('unionSize / differenceSize guard on their own: a receiver whose intersectionSize never throws', () => {
        // Sub#intersectionSize returns 0 without a brand check, so only the method's OWN guard can throw.
        class Sub extends FastBit1024 { intersectionSize() { return 0; } }
        let rows = 0;
        for (const cap of [100]) { // 2 methods x 9 wrong others = 18 rows
            const s = new Sub(cap);
            s.add(0);
            const real = seeded(33);
            const others = [
                null, undefined, 42, 'x', {}, s._data, new FastBit32(), Object.create(FastBit1024.prototype),
                new Proxy(real, {})
            ];
            for (const m of ['unionSize', 'differenceSize']) {
                for (const o of others) {
                    const before = fb1024Snapshot(s), beforeT = fb1024Snapshot(real);
                    assert.throws(() => s[m](o), (e) => e instanceof TypeError
                        && e.message.startsWith('FastBit1024: expected a FastBit1024, got '),
                        m + ' cap ' + cap + ' other ' + Object.prototype.toString.call(o));
                    assert.strictEqual(fb1024Snapshot(s), before);
                    assert.strictEqual(fb1024Snapshot(real), beforeT);
                    rows++;
                }
            }
        }
        assert.strictEqual(rows, 18);
    });
});

describe('FastBit1024 prevSetBit / counts -- pins', () => {
    it('prevSetBit(cap - 1) === highest() on a spread of sets', () => {
        const bits = stream(SEED ^ 0x1f83d9ab);
        for (const cap of CAPS) {
            for (const density of [0, 3, 500, 1000]) {
                const [s] = build(cap, density, bits);
                assert.strictEqual(s.prevSetBit(cap - 1), s.highest());
            }
        }
    });

    it('word boundaries 31 / 32 and bit 1023; a bit above from is ignored, from itself counts', () => {
        const s = new FastBit1024(1024);
        s.add(31).add(32).add(1023);
        assert.strictEqual(s.prevSetBit(1023), 1023);
        assert.strictEqual(s.prevSetBit(1022), 32);
        assert.strictEqual(s.prevSetBit(33), 32);
        assert.strictEqual(s.prevSetBit(32), 32);
        assert.strictEqual(s.prevSetBit(31), 31);
        assert.strictEqual(s.prevSetBit(30), -1);
        assert.strictEqual(s.prevSetBit(0), -1);
        const t = new FastBit1024(64);
        t.add(31).add(63);
        assert.strictEqual(t.prevSetBit(62), 31);
        assert.strictEqual(t.prevSetBit(32), 31);
        assert.strictEqual(t.prevSetBit(30), -1);
        // a lone bit at the top of word 0 and a query at the bottom of word 1
        const u = new FastBit1024(64);
        u.add(31);
        assert.strictEqual(u.prevSetBit(32), 31);
        assert.strictEqual(u.prevSetBit(63), 31);
    });

    it('full 1024 vs full 1024: all three counts are as the set algebra says', () => {
        const a = new FastBit1024(1024), b = new FastBit1024(1024);
        for (let i = 0; i < 1024; i++) { a.acquire(); b.acquire(); }
        assert.strictEqual(a.intersectionSize(b), 1024);
        assert.strictEqual(a.unionSize(b), 1024);
        assert.strictEqual(a.differenceSize(b), 0);
        assert.strictEqual(a.intersectionSize(a), 1024);
        assert.strictEqual(a.differenceSize(a), 0);
    });

    it('counts are exact across capacities and change neither set', () => {
        const a = new FastBit1024(1024), b = new FastBit1024(33);
        a.add(0).add(5).add(32).add(33).add(1000);
        b.add(5).add(32);
        const sa = fb1024Snapshot(a), sb = fb1024Snapshot(b);
        // A = {0,5,32,33,1000}, B = {5,32}: A&B = 2, A|B = 5, A\B = 3, B\A = 0
        assert.strictEqual(a.intersectionSize(b), 2);
        assert.strictEqual(a.unionSize(b), 5);
        assert.strictEqual(a.differenceSize(b), 3);
        assert.strictEqual(b.intersectionSize(a), 2);
        assert.strictEqual(b.unionSize(a), 5);
        assert.strictEqual(b.differenceSize(a), 0);
        assert.strictEqual(fb1024Snapshot(a), sa);
        assert.strictEqual(fb1024Snapshot(b), sb);
        const e = new FastBit1024(1);
        assert.strictEqual(a.intersectionSize(e), 0);
        assert.strictEqual(a.unionSize(e), 5);
        assert.strictEqual(a.differenceSize(e), 5);
        assert.strictEqual(e.differenceSize(a), 0);
    });

    it('a subclass instance is accepted as `other` and answers exactly', () => {
        class Sub extends FastBit1024 {}
        const a = new FastBit1024(100), s = new Sub(100);
        a.add(1).add(2).add(3);
        s.add(2).add(3).add(4);
        assert.strictEqual(a.intersectionSize(s), 2);
        assert.strictEqual(a.unionSize(s), 4);
        assert.strictEqual(a.differenceSize(s), 1);
        assert.strictEqual(s.intersectionSize(a), 2);
        assert.strictEqual(s.prevSetBit(99), 4);
    });
});
