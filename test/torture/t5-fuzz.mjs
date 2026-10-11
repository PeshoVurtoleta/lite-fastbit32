// test/torture/t5-fuzz.mjs -- differential fuzz against the oracle. 200k mixed
// ops (strict: every op checked; TORTURE_FAST=1: every 16th). Every 64th op
// re-derives the word and checks serialize() equality as a set. hasAll is
// signedness-agnostic from 1.2.1 / FB-01 on, so it is a plain oracle check over
// every word (the instance's own bits as an unsigned mask, bit 31 included). Any
// mismatch is a failure with a replay line. The oracle-flip control injects a
// wrong oracle -> mismatches -> this tier fails; the hasall-old control
// reinstalls the 1.2.0 body -> the self-mask hasAll check diverges -> fails.
// S4: nextSetBit/prevSetBit/rank/isSubsetOf/equalsValue and a bounded cursor
// walk (== toArray, ascending and descending) are subjects too. S5: select
// (random k and count(), both representations), nextSubset and nextCombination
// (word, unsigned twin, top block) against the oracle.

export function run(ctx) {
    const FB = ctx.FB;
    const o = ctx.oracle;
    const h = ctx.h;
    const fails = [];
    const strict = process.env.TORTURE_FAST !== '1';
    const stride = strict ? 1 : 16;
    const OPS = 200000;

    const fb = new FB();
    const ub = new FB();   // unsigned twin: .value = the oracle word (uint32 double)
    const model = new Uint8Array(32); // truth bits
    const wordOf = () => { let r = 0; for (let i = 0; i < 32; i++) if (model[i]) r += 2 ** i; return r >>> 0; };

    let firstFail = -1;

    for (let i = 0; i < OPS; i++) {
        const op = h.randBelow(7);
        const bit = h.randBelow(32);
        const mask = h.nextU32();
        switch (op) {
            case 0: fb.add(bit); model[bit] = 1; break;
            case 1: fb.remove(bit); model[bit] = 0; break;
            case 2: fb.toggle(bit); model[bit] ^= 1; break;
            case 3: fb.union(mask); for (let k = 0; k < 32; k++) if (((mask >>> k) & 1)) model[k] = 1; break;
            case 4: fb.difference(mask); for (let k = 0; k < 32; k++) if (((mask >>> k) & 1)) model[k] = 0; break;
            case 5: fb.intersect(mask); for (let k = 0; k < 32; k++) if (!((mask >>> k) & 1)) model[k] = 0; break;
            case 6: fb.clear(); model.fill(0); break;
        }

        if ((i % stride) === 0) {
            const ew = wordOf();
            // set identity first
            if (((fb.value ^ ew) >>> 0) !== 0 && firstFail < 0) { firstFail = i; fails.push('T5: value diverged op ' + i); }
            const checks = [
                ['count', fb.count(), o.oCount(ew)],
                ['lowest', fb.lowest(), o.oLowest(ew)],
                ['highest', fb.highest(), o.oHighest(ew)],
                ['nextClearBit', fb.nextClearBit(), o.oNextClearBit(ew)],
                ['highestClearBit', fb.highestClearBit(), o.oHighestClearBit(ew)],
                ['isEmpty', fb.isEmpty(), o.oIsEmpty(ew)],
                ['isFull', fb.isFull(), o.oIsFull(ew)],
                ['hasAny', fb.hasAny(mask), o.oHasAny(ew, mask)],
                ['hasNone', fb.hasNone(mask), o.oHasNone(ew, mask)],
                ['countMasked', fb.countMasked(mask), o.oCountMasked(ew, mask)]
            ];
            // S4 Tier-1 subjects: cursors at a random from, rank, isSubsetOf,
            // equalsValue (both mask forms), and a bounded full cursor walk.
            checks.push(
                ['nextSetBit', fb.nextSetBit(bit), o.oNextSetBit(ew, bit)],
                ['prevSetBit', fb.prevSetBit(bit), o.oPrevSetBit(ew, bit)],
                ['rank', fb.rank(bit), o.oRank(ew, bit)],
                ['isSubsetOf', fb.isSubsetOf(mask), o.oIsSubsetOf(ew, mask)],
                ['isSubsetOf(s)', fb.isSubsetOf(mask | 0), o.oIsSubsetOf(ew, mask)],
                ['equalsValue(u)', fb.equalsValue(ew), true],
                ['equalsValue(s)', fb.equalsValue(ew | 0), true],
                ['equalsValue(m)', fb.equalsValue(mask), o.oEquals(ew, mask)]
            );
            {
                let walk = '';
                for (let b = fb.nextSetBit(0), n = 0; b !== -1 && n < 33; b = fb.nextSetBit(b + 1), n++) walk += b + ',';
                let want = '';
                const ta = o.oToArray(ew);
                for (let k = 0; k < ta.length; k++) want += ta[k] + ',';
                checks.push(['cursor==toArray', walk, want]);
                let down = '';
                for (let b = fb.prevSetBit(31), n = 0; b !== -1 && n < 33; b = fb.prevSetBit(b - 1), n++) down = b + ',' + down;
                checks.push(['prevSetBit walk', down, want]);
                ub.value = ew; // ctor representation (unsigned) of the same set
                let uw = '';
                for (let b = ub.nextSetBit(0), n = 0; b !== -1 && n < 33; b = ub.nextSetBit(b + 1), n++) uw += b + ',';
                checks.push(['cursor==toArray(u)', uw, want]);
                checks.push(['equals(u,s)', ub.equals(fb), true]);
                checks.push(['rank(u)', ub.rank(bit), o.oRank(ew, bit)]);
                // S5 Tier-2 subjects: select at a random k and at count() (-1),
                // both representations; nextSubset on a submask of the random
                // mask (both input forms); nextCombination on the word, its
                // unsigned twin, and the top block of bit + 1 bits (sentinel 0).
                // The statics return a signed int32, so the oracle's uint32 is
                // compared as `| 0`.
                checks.push(
                    ['select(bit)', fb.select(bit), o.oSelect(ew, bit)],
                    ['select(count)', fb.select(fb.count()), -1],
                    ['select(bit)(u)', ub.select(bit), o.oSelect(ew, bit)],
                    ['select(count)(u)', ub.select(ub.count()), -1]
                );
                const sub = (ew & mask) >>> 0;
                const tb = -1 << (31 - bit);
                checks.push(
                    ['nextSubset', FB.nextSubset(sub, mask), o.oNextSubset(sub, mask) | 0],
                    ['nextSubset(s)', FB.nextSubset(sub | 0, mask | 0), o.oNextSubset(sub, mask) | 0],
                    ['nextCombination', FB.nextCombination(fb.value), o.oNextCombination(ew) | 0],
                    ['nextCombination(u)', FB.nextCombination(ub.value), o.oNextCombination(ew) | 0],
                    ['nextCombination(top)', FB.nextCombination(tb), o.oNextCombination(tb) | 0],
                    ['nextCombination(top u)', FB.nextCombination(tb >>> 0), o.oNextCombination(tb) | 0]
                );
            }
            for (const [name, got, want] of checks) {
                if (got !== want && firstFail < 0) { firstFail = i; fails.push('T5: ' + name + ' op ' + i + ' got ' + got + ' want ' + want); }
            }
            // hasAll on the instance's own bits as an unsigned mask (true
            // answer is true). Signedness-agnostic after the FB-01 fix: must
            // match the oracle for every word, bit 31 included.
            const selfMask = fb.value >>> 0;
            if (fb.hasAll(selfMask) !== o.oHasAll(ew, selfMask) && firstFail < 0) {
                firstFail = i; fails.push('T5: hasAll op ' + i);
            }
            // false case: a mask with one bit NOT in the word -> true answer is
            // false. Both unsigned and signed mask forms. The self-mask check
            // above is always-true, so a `return true` body would pass it; this
            // catches that (and the oracle-flip control stays caught elsewhere).
            const clr = o.oNextClearBit(ew);   // lowest clear bit, or -1 if full
            if (clr >= 0) {
                const missU = (ew | (1 << clr)) >>> 0;
                const missS = (ew | (1 << clr)) | 0;
                if (fb.hasAll(missU) !== o.oHasAll(ew, missU) && firstFail < 0) { firstFail = i; fails.push('T5: hasAll-false(u) op ' + i); }
                if (fb.hasAll(missS) !== o.oHasAll(ew, missS) && firstFail < 0) { firstFail = i; fails.push('T5: hasAll-false(s) op ' + i); }
            }
        }

        if ((i % 64) === 0) {
            const r = FB.deserialize(fb.serialize());
            if (((r.value ^ fb.value) >>> 0) !== 0 && firstFail < 0) { firstFail = i; fails.push('T5: serialize roundtrip op ' + i); }
        }
    }

    if (firstFail >= 0) fails.push('T5: replay -> ' + h.replayLine(ctx.seed, firstFail));

    // a broken variant (T9 control) may throw mid-sequence: that is a FAIL row, never a crash
    try { fb1024Fuzz(ctx, fails); } catch (e) { fails.push('T5 ' + 'FastBit1024 rows threw ' + e.constructor.name + ': ' + e.message); }
    return { fails, green: 0 };
}

// ---- S4b FastBit1024 oracle fuzz (ported from benchmark/experiments/fb1024-check.mjs) --
// Trials over capacities {1, 2, 31, 32, 33, 63, 64, 65, 500, 991, 992, 993, 1023,
// 1024} plus random ones. Each trial PRE-FILLS by acquire to a random level
// (every 4th trial: to capacity, then one acquire must be -1), then runs a mixed
// op stream: the op comes from the harness RNG, the key from a SECOND xorshift
// stream. The clear decision is drawn FIRST, every op, from the key stream:
// clear() fires 1 in 50 ops below capacity 128 and 1 in 2000 at >= 128, so
// large pools stay near-full. Every 16th op (and the last) checks 8 queries +
// forEach + the cursor walk against O1024, and I1-I4; then hasAll/hasAny against
// a random other of the SAME or a DIFFERENT capacity. Coverage is COUNTED and
// fails closed when a minimum is unmet: acquire === -1 at cap >= 128, acquires
// in words >= 16, a full word >= 16 (read from the ORACLE, not the class),
// releases of bit 31 of a word, and clears at cap >= 512 while a word >= 16 holds
// a bit (the clear-low16 control's teeth). Strict: 3000 trials; TORTURE_FAST=1: 400. The fb1024-sparse (first
// EMPTY word) and fb1024-nofull controls MUST fail here.
const CLEARBIG_MIN = 20;
const FB1024_CAPS = [1, 2, 31, 32, 33, 63, 64, 65, 500, 991, 992, 993, 1023, 1024];
// Minimums sit ~3x below the TORTURE_FAST counts measured over 5 seeds (see
// CHANGELOG [Unreleased]; strict runs read ~7x those).
const FB1024_MIN = { fullBig: 50, acqHigh: 10000, fullHigh: 1000, rel31: 1000, clearBig: CLEARBIG_MIN };
function fb1024Fuzz(ctx, fails) {
    const C = ctx.FB1024;
    const O = ctx.oracle.O1024;
    const h = ctx.h;
    const trials = process.env.TORTURE_FAST === '1' ? 400 : 3000;
    const KEY = new Int32Array(1);
    KEY[0] = (h.nextU32() | 0) || 0x2545f491;
    const key = (n) => { let x = KEY[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; KEY[0] = x; return (x >>> 0) % n; };
    const cov = { fullBig: 0, acqHigh: 0, fullHigh: 0, rel31: 0, clearBig: 0 };
    let bad = 0;
    const F = (m) => { if (bad++ < 5) fails.push('T5 FB1024: ' + m); };
    const LIST = [];
    const cb = (b) => { LIST.push(b); };
    const acq = (s, o, cap) => {
        const got = s.acquire();
        const want = o.clearLow();
        if (got !== want) F('acquire cap ' + cap + ' got ' + got + ' want ' + want);
        if (want !== -1) { o.b[want] = 1; if ((want >>> 5) >= 16) cov.acqHigh++; }
        else if (cap >= 128 && got === -1) cov.fullBig++;
    };
    for (let trial = 0; trial < trials && bad === 0; trial++) {
        const cap = trial < (trials * 2 / 3) ? FB1024_CAPS[trial % FB1024_CAPS.length] : 1 + key(1024);
        const s = new C(cap);
        const o = new O(cap);
        const level = (trial & 3) === 0 ? cap : key(cap + 1);
        for (let k = 0; k < level; k++) acq(s, o, cap);
        if (level === cap) acq(s, o, cap);                 // must be -1
        const clearOdds = cap >= 128 ? 2000 : 50;
        const steps = 50 + h.randBelow(3000);
        for (let k = 0; k < steps && bad === 0; k++) {
            const i = key(cap);
            const r = h.randBelow(100);
            if (key(clearOdds) === 0) {
                if (cap >= 512 && o.next(512) !== -1) cov.clearBig++;
                s.clear(); o.b.fill(0);
            } else if (r < 20) { s.add(i); o.b[i] = 1; }
            else if (r < 32) { s.remove(i); o.b[i] = 0; }
            else if (r < 40) { s.toggle(i); o.b[i] ^= 1; }
            else if (r < 70) acq(s, o, cap);
            else {
                const x = o.next(i);
                if (x !== -1) { s.release(x); o.b[x] = 0; if ((x & 31) === 31) cov.rel31++; }
                else if (o.b[i] === 0) {
                    let threw = false;
                    try { s.release(i); } catch { threw = true; }
                    if (!threw) F('release of free slot ' + i + ' did not throw cap ' + cap);
                }
            }
            if ((k & 15) !== 0 && k !== steps - 1) continue;
            if (o.fullWordFrom(16)) cov.fullHigh++;
            const f = key(cap + 1);
            const cnt = o.count();
            if (s.lowest() !== o.lowest()) F('lowest cap ' + cap + ' got ' + s.lowest() + ' want ' + o.lowest());
            if (s.highest() !== o.highest()) F('highest cap ' + cap + ' got ' + s.highest() + ' want ' + o.highest());
            if (s.nextClearBit() !== o.clearLow()) F('nextClearBit cap ' + cap + ' got ' + s.nextClearBit() + ' want ' + o.clearLow());
            if (s.size !== cnt) F('size cap ' + cap + ' got ' + s.size + ' want ' + cnt);
            if (s.isEmpty() !== (cnt === 0)) F('isEmpty cap ' + cap);
            if (s.isFull() !== (cnt === cap)) F('isFull cap ' + cap);
            if (s.has(i) !== (o.b[i] === 1)) F('has(' + i + ') cap ' + cap);
            if (s.nextSetBit(f) !== o.next(f)) F('nextSetBit(' + f + ') cap ' + cap + ' got ' + s.nextSetBit(f) + ' want ' + o.next(f));
            const want = o.list().join();
            LIST.length = 0;
            s.forEach(cb);
            if (LIST.join() !== want) F('forEach cap ' + cap);
            const walk = [];
            for (let b = s.nextSetBit(0), n = 0; b !== -1 && n <= cap; b = s.nextSetBit(b + 1), n++) walk.push(b);
            if (walk.join() !== want) F('cursor walk cap ' + cap);
            const inv = ctx.oracle.fb1024Invariants(s);
            if (inv !== null) F(inv + ' cap ' + cap);
        }
        // relations: a random other of the same capacity, or (every 3rd trial) a different one
        const ocap = (trial % 3) === 2 ? 1 + key(1024) : cap;
        const t = new C(ocap);
        const ot = new Uint8Array(ocap);
        const mode = key(4);
        for (let k = 0; k < 20; k++) {
            const i = key(ocap);
            if (mode === 0 ? (i < cap && o.b[i] === 1) : true) { t.add(i); ot[i] = 1; }
        }
        let all = true;
        let any = false;
        for (let b = 0; b < ocap; b++) {
            const here = b < cap && o.b[b] === 1;
            if (ot[b] === 1 && !here) all = false;
            if (ot[b] === 1 && here) any = true;
        }
        if (s.hasAll(t) !== all) F('hasAll cap ' + cap + ' other cap ' + ocap);
        if (s.hasAny(t) !== any) F('hasAny cap ' + cap + ' other cap ' + ocap);
    }
    if (bad > 0) { fails.push('T5 FB1024: ' + bad + ' mismatch(es); replay -> ' + h.replayLine(ctx.seed, 0)); return; }
    for (const k of Object.keys(FB1024_MIN)) {
        if (!(cov[k] >= FB1024_MIN[k])) fails.push('T5 FB1024 coverage: ' + k + ' = ' + cov[k] + ' < ' + FB1024_MIN[k] + ' (fail closed: the fuzz did not reach near-full pools)');
    }
    ctx.measures.fb1024Coverage = cov;
}
