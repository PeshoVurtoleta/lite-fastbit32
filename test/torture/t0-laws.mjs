// test/torture/t0-laws.mjs -- metamorphic algebra over a fuzz corpus, in both
// representations (ctor-built unsigned and add-built signed). Section-5 laws
// plus the S4 Tier-1 rows (cursor, rank, equals, isSubsetOf, set/copy,
// rangeMask) and the S5 Tier-2 rows (select vs the oracle and both inverse
// laws per representation; bounded nextSubset / nextCombination walks, see
// s5StaticWalks). The hasAll <=> popcount-identity
// law runs over the full word (bit 31 included) now that FB-01 is fixed. The
// lowest-noguard control (returns 63 on an empty word) fails the lowest/highest
// laws here.

import {
    oCount, oCountMasked, oLowest, oHighest, oNextClearBit, oHighestClearBit,
    oIsEmpty, oIsFull, oUnion, oIntersect, oDifference, oToArray, ubit,
    oNextSetBit, oPrevSetBit, oRank, oIsSubsetOf,
    oSelect, oNextSubset, oNextCombination, oRangeMask
} from './oracle.mjs';

// S4 cursor walks, BOUNDED at 33 steps so a wrapping cursor (the
// nextset-nowrap control) yields a wrong list instead of hanging the tier.
function walkUp(inst) {
    const out = [];
    for (let b = inst.nextSetBit(0), n = 0; b !== -1 && n < 33; b = inst.nextSetBit(b + 1), n++) out.push(b);
    return out;
}
function walkDown(inst) {
    const out = [];
    for (let b = inst.prevSetBit(31), n = 0; b !== -1 && n < 33; b = inst.prevSetBit(b - 1), n++) out.push(b);
    return out;
}

export function run(ctx) {
    const FB = ctx.FB;
    const h = ctx.h;
    const fails = [];
    let green = 0;
    const F = (m) => fails.push('T0: ' + m);

    // corpus: 0, -1, every lone bit, plus random words
    const corpus = [0, 0xFFFFFFFF >>> 0];
    for (let i = 0; i < 32; i++) corpus.push((1 << i) >>> 0);
    for (let i = 0; i < 300; i++) corpus.push(h.nextU32());

    for (let ci = 0; ci < corpus.length; ci++) {
        const w = corpus[ci];
        const u = new FB(w);
        const s = new FB();
        for (let b = 0; b < 32; b++) if (ubit(w, b)) s.add(b);
        if (((u.value ^ s.value) >>> 0) !== 0) F('representation divergence w=' + w);

        if (u.count() !== oCount(w)) F('count w=' + w);
        if (s.count() !== oCount(w)) F('count(signed) w=' + w);
        if (u.lowest() !== oLowest(w)) F('lowest w=' + w);
        if (u.highest() !== oHighest(w)) F('highest w=' + w);
        if (u.nextClearBit() !== oNextClearBit(w)) F('nextClearBit w=' + w);
        if (u.highestClearBit() !== oHighestClearBit(w)) F('highestClearBit w=' + w);
        if (u.isEmpty() !== oIsEmpty(w)) F('isEmpty w=' + w);
        if (u.isFull() !== oIsFull(w)) F('isFull w=' + w);

        // nextClearBit(v) === lowest(~v); highestClearBit(v) === highest(~v)
        if (u.nextClearBit() !== new FB((~w) >>> 0).lowest()) F('nextClearBit==lowest(~v) w=' + w);
        if (u.highestClearBit() !== new FB((~w) >>> 0).highest()) F('highestClearBit==highest(~v) w=' + w);

        // forEach visits exactly count() bits ascending, matching toArray()
        const visited = [];
        u.forEach((b) => visited.push(b));
        const arr = oToArray(w);
        if (visited.length !== oCount(w)) F('forEach count w=' + w);
        if (JSON.stringify(visited) !== JSON.stringify(arr)) F('forEach order w=' + w);
        if (JSON.stringify(u.toArray()) !== JSON.stringify(arr)) F('toArray w=' + w);
        if ((u.lowest()) !== (arr.length ? arr[0] : -1)) F('lowest==toArray[0] w=' + w);
        if ((u.highest()) !== (arr.length ? arr[arr.length - 1] : -1)) F('highest==toArray.at(-1) w=' + w);

        // pick a companion mask from the corpus (wrap)
        const m = corpus[(ci + 7) % corpus.length];
        // count(v) === countMasked(m) + countMasked(~m)
        if (u.count() !== u.countMasked(m) + u.countMasked((~m) >>> 0)) F('count split w=' + w + ' m=' + m);
        // hasAny === !hasNone
        if (u.hasAny(m) !== !u.hasNone(m)) F('hasAny==!hasNone w=' + w);
        // hasAll <=> countMasked(m) === popcount(m), full word (bit 31 included;
        // hasAll is signedness-agnostic from 1.2.1 / FB-01 on)
        if (u.hasAll(m) !== (u.countMasked(m) === oCount(m))) F('hasAll popcount-identity w=' + w + ' m=' + m);
        // The FB-01 teeth: run the identity on a mask that is actually a SUBSET
        // of the word, passed in UNSIGNED form so a bit-31 mask arrives as
        // 2147483648. hasAll(ms) must be true (true answer) and the identity must
        // hold. The 1.2.0 body reads false here (signed value vs unsigned double),
        // so hasall-old fails T0. (Full-word m alone cannot catch it: no corpus
        // word fully contains a bit-31 mask whose true answer is true.)
        const ms = (m & w) >>> 0;              // subset of w
        if (u.hasAll(ms) !== (u.countMasked(ms) === oCount(ms))) F('hasAll subset-mask w=' + w + ' ms=' + ms);
        // the set's own bits as an unsigned mask, on the ADD-BUILT signed
        // instance: always true, and the identity holds; bit-31 words carry the
        // FB-01 shape directly.
        const wu = w >>> 0;
        if (s.hasAll(wu) !== (s.countMasked(wu) === oCount(wu))) F('hasAll self-mask w=' + w);

        // De Morgan on the int32 bit pattern
        if ((((~(w | m)) ^ ((~w) & (~m))) | 0) !== 0) F('de morgan w=' + w + ' m=' + m);

        // union/intersect/difference match the oracle (as sets)
        if (((new FB(w).union(m).value ^ oUnion(w, m)) >>> 0) !== 0) F('union w=' + w + ' m=' + m);
        if (((new FB(w).intersect(m).value ^ oIntersect(w, m)) >>> 0) !== 0) F('intersect w=' + w + ' m=' + m);
        if (((new FB(w).difference(m).value ^ oDifference(w, m)) >>> 0) !== 0) F('difference w=' + w + ' m=' + m);

        // countRange(s,e) === countMasked(rangeMask(s,e)) for a valid range
        const start = oLowest(m) < 0 ? 0 : (oLowest(m) % 16);
        const end = start + ((oHighest(m) < 0 ? 0 : oHighest(m)) % 16);
        if (u.countRange(start, end) !== u.countMasked(h.rangeMask(start, end))) F('countRange law w=' + w);

        // ---- S4 Tier-1 laws, both representations (u ctor-built, s add-built)
        const arrS = JSON.stringify(arr);
        const revS = JSON.stringify(arr.slice().reverse());
        for (const [tag, inst] of [['u', u], ['s', s]]) {
            const up = walkUp(inst);
            // cursor == forEach == toArray, ascending
            if (JSON.stringify(up) !== arrS) F('cursor==forEach(' + tag + ') w=' + w);
            if (JSON.stringify(walkDown(inst)) !== revS) F('prevSetBit descending(' + tag + ') w=' + w);
            // the cursor's end conditions
            if (inst.nextSetBit(32) !== -1) F('nextSetBit(32)===-1(' + tag + ') w=' + w);
            if (inst.prevSetBit(-1) !== -1) F('prevSetBit(-1)===-1(' + tag + ') w=' + w);
            // rank(lowest()) === 0 when non-empty; rank vs the oracle at every bit
            if (arr.length > 0 && inst.rank(inst.lowest()) !== 0) F('rank(lowest)===0(' + tag + ') w=' + w);
            for (let b = 0; b < 32; b++) {
                if (inst.rank(b) !== oRank(w, b)) { F('rank(' + tag + ') w=' + w + ' bit=' + b); break; }
                if (inst.nextSetBit(b) !== oNextSetBit(w, b)) { F('nextSetBit(' + tag + ') w=' + w + ' from=' + b); break; }
                if (inst.prevSetBit(b) !== oPrevSetBit(w, b)) { F('prevSetBit(' + tag + ') w=' + w + ' from=' + b); break; }
            }
            // isSubsetOf(m) === new FB(m).hasAll(this.value), and vs the oracle
            if (inst.isSubsetOf(m) !== new FB(m).hasAll(inst.value)) F('isSubsetOf==hasAll dual(' + tag + ') w=' + w + ' m=' + m);
            if (inst.isSubsetOf(m) !== oIsSubsetOf(w, m)) F('isSubsetOf oracle(' + tag + ') w=' + w + ' m=' + m);
            if (!inst.isSubsetOf(w)) F('isSubsetOf(self)(' + tag + ') w=' + w);
            // equals / equalsValue <=> xor is empty, across representations
            const eqx = new FB(w).union(m).difference(m).union(m & w).value; // same set as w, rebuilt signed
            if (!inst.equals(u) || !inst.equals(s) || !inst.equalsValue(w) || !inst.equalsValue(w | 0)) F('equals self(' + tag + ') w=' + w);
            if (!inst.equalsValue(eqx)) F('equalsValue rebuilt(' + tag + ') w=' + w);
            const xm = new FB(w).toggle(0).value ^ 0; // differs from w in bit 0
            if (inst.equalsValue(m) !== ((((w ^ m) >>> 0) === 0))) F('equalsValue xor law(' + tag + ') w=' + w + ' m=' + m);
            if (inst.equalsValue(xm)) F('equalsValue one-bit diff(' + tag + ') w=' + w);
            // set / copy store the same set
            if (!new FB().set(w).equals(inst) || !new FB(7).copy(inst).equals(inst)) F('set/copy(' + tag + ') w=' + w);
            // ---- S5 select: the oracle at k = -1..33, both inverse laws, the ends
            for (let k = -1; k <= 33; k++) {
                if (inst.select(k) !== oSelect(w, k)) { F('select oracle(' + tag + ') w=' + w + ' k=' + k + ' got ' + inst.select(k) + ' want ' + oSelect(w, k)); break; }
            }
            for (let k = 0; k < arr.length; k++) {
                if (inst.select(inst.rank(arr[k])) !== arr[k]) { F('select(rank(b))===b(' + tag + ') w=' + w + ' b=' + arr[k]); break; }
                if (inst.rank(inst.select(k)) !== k) { F('rank(select(k))===k(' + tag + ') w=' + w + ' k=' + k); break; }
            }
            if (inst.select(0) !== inst.lowest()) F('select(0)===lowest()(' + tag + ') w=' + w);
            if (inst.select(inst.count() - 1) !== inst.highest()) F('select(count()-1)===highest()(' + tag + ') w=' + w);
        }
        // rangeMask/countRange law: countMasked(rangeMask(s,e)) === countRange(s,e)
        {
            const rs = ci & 31;
            const re = rs + ((w >>> 3) % (32 - rs));
            if (u.countMasked(FB.rangeMask(rs, re)) !== u.countRange(rs, re)) F('rangeMask/countRange law w=' + w + ' s=' + rs + ' e=' + re);
            if (((FB.rangeMask(rs, re) ^ h.rangeMask(rs, re)) | 0) !== 0) F('rangeMask pattern s=' + rs + ' e=' + re);
        }

        // deserialize(serialize(x)) equals x as a set
        const r = FB.deserialize(u.serialize());
        if (((r.value ^ u.value) >>> 0) !== 0) F('serialize roundtrip w=' + w);
    }

    void green;
    // a broken variant (T9 control) may throw mid-sequence: that is a FAIL row, never a crash
    try { fb1024Laws(ctx, F); } catch (e) { F('FastBit1024 rows threw ' + e.constructor.name + ': ' + e.message); }
    try { s5StaticWalks(ctx, F); } catch (e) { F('S5 static walks threw ' + e.constructor.name + ': ' + e.message); }
    try { fb1024ImageLaws(ctx, F); } catch (e) { F('FastBit1024 image laws threw ' + e.constructor.name + ': ' + e.message); }
    return { fails, green };
}

// ---- S5 statics: bounded walks, called as FB.<static> so a control reaches them.
// A2 nextSubset: from mask down, visit, stop after 0. Masks {0, -2^31,
// 0x80000001, 0xF000000F, 0x0000FFFF, 0xFFFF0000} plus 64 random masks of
// popcount <= 12 (a PRIVATE xorshift stream seeded from ctx.seed, so the
// harness RNG sequence the other rows read is unchanged). Each step: the oracle
// value, a submask, strictly decreasing as uint32, an int32 (Object.is(x, x|0)),
// the same output for the uint32 forms of both inputs; exactly 2^popcount
// values, 0 last. A3 nextCombination: k = 1..4, 28..32 from the low block;
// each step the oracle value, popcount k, strictly increasing as uint32, an
// int32, the same output for the uint32 input; exactly C(32, k) words, the last
// the top block `-1 << (32 - k)`, then the 0 sentinel. Both walks are bounded
// at count + 1 steps so a control without a mask or a sentinel yields a wrong
// count instead of hanging the tier.
// The uint32 reading of an int32 by arithmetic (no bitwise compare, law 8).
function u32(x) { return x < 0 ? x + 4294967296 : x; }
function s5StaticWalks(ctx, F) {
    const FB = ctx.FB;
    const SX = new Int32Array(1);
    SX[0] = (ctx.seed ^ 0x5bd1e995) | 0 || 0x2545f491;
    const rnd = (n) => { let x = SX[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; SX[0] = x; return (x >>> 0) % n; };
    const masks = [0, -(2 ** 31), 0x80000001 | 0, 0xF000000F | 0, 0x0000FFFF, 0xFFFF0000 | 0];
    for (let i = 0; i < 64; i++) {
        const p = rnd(13);
        let mk = 0;
        for (let n = 0; n < p;) { const b = rnd(32); if (!ubit(mk, b)) { mk = (mk | (1 << b)) | 0; n++; } }
        masks.push(mk);
    }
    for (let mi = 0; mi < masks.length; mi++) {
        const mask = masks[mi];
        const um = mask >>> 0;
        const want = 2 ** oCount(mask);
        let x = mask;
        let n = 1;
        let bad = null;
        while (n <= want) {
            const nx = FB.nextSubset(x, mask);
            if (!Object.is(nx, nx | 0)) { bad = 'not an int32 ' + nx; break; }
            if (((nx ^ oNextSubset(x, mask)) >>> 0) !== 0) { bad = 'oracle x=' + x + ' got ' + nx + ' want ' + oNextSubset(x, mask); break; }
            if (!Object.is(FB.nextSubset(x >>> 0, um), nx)) { bad = 'uint32 inputs differ x=' + x; break; }
            if (x === 0) break;
            if ((nx & ~mask) !== 0) { bad = 'not a submask ' + nx; break; }
            if (!(u32(nx) < u32(x))) { bad = 'not strictly decreasing ' + x + ' -> ' + nx; break; }
            x = nx;
            n++;
        }
        if (bad === null && (n !== want || x !== 0)) bad = 'visited ' + n + ' values ending at ' + x + ', want ' + want + ' ending at 0';
        if (bad !== null) F('nextSubset walk mask=' + mask + ': ' + bad);
    }
    const KS = [1, 2, 3, 4, 28, 29, 30, 31, 32];
    for (let ki = 0; ki < KS.length; ki++) {
        const k = KS[ki];
        let want = 1;
        for (let i = 0; i < k; i++) want = want * (32 - i) / (i + 1);
        let v = oRangeMask(0, k - 1) | 0;
        let n = 1;
        let bad = null;
        while (n <= want) {
            const nv = FB.nextCombination(v);
            if (!Object.is(nv, nv | 0)) { bad = 'not an int32 ' + nv; break; }
            if (((nv ^ oNextCombination(v)) >>> 0) !== 0) { bad = 'oracle v=' + v + ' got ' + nv + ' want ' + oNextCombination(v); break; }
            if (!Object.is(FB.nextCombination(v >>> 0), nv)) { bad = 'uint32 input differs v=' + v; break; }
            if (nv === 0) break;
            if (oCount(nv) !== k) { bad = 'popcount ' + oCount(nv) + ' at ' + nv; break; }
            if (!(u32(nv) > u32(v))) { bad = 'not strictly increasing ' + v + ' -> ' + nv; break; }
            v = nv;
            n++;
        }
        if (bad === null && (n !== want || ((v ^ (-1 << (32 - k))) | 0) !== 0)) bad = 'visited ' + n + ' words ending at ' + v + ', want ' + want + ' ending at ' + (-1 << (32 - k));
        if (bad !== null) F('nextCombination walk k=' + k + ': ' + bad);
    }
    // pinned points: f(0) = 0, f(-1) = 0, the k = 3 top block -> 0, and a carry into bit 31
    const pins = [[0, 0], [-1, 0], [0xE0000000 | 0, 0], [0x7FFFFFFF, 0xBFFFFFFF | 0]];
    for (let i = 0; i < pins.length; i++) {
        const got = FB.nextCombination(pins[i][0]);
        if (!Object.is(got, pins[i][1])) F('nextCombination(' + pins[i][0] + ') got ' + got + ' want ' + pins[i][1]);
    }
}

// ---- S4b FastBit1024: invariants I1-I4 after EVERY op + metamorphic laws ----
// Per capacity (the T1 set plus a seeded random one): pre-fill by acquire (to
// capacity at 1023 and at a random cap >= 128, then one acquire must be -1;
// else to a random level), then 4000 random add/remove/toggle/acquire/release
// ops. The clear decision is drawn FIRST, every op: clear() 1 in 500 at cap >= 128
// (then a re-fill by acquire to a random level), 1 in 100 below. The op comes from the harness RNG, the key and the clear
// decision from a second xorshift stream. Laws every 32nd op:
// acquire() === the nextClearBit() read before it; size === forEach count;
// cursor walk === forEach list; lowest === nextSetBit(0); highest === last
// visited; nextSetBit(cap) === -1; isEmpty/isFull agree with size; hasAll(self);
// hasAny(self) === !isEmpty. Coverage counted and gated: >= 1 acquire === -1 at
// cap >= 128, >= 100 acquires in words >= 16, and >= 3 clears at cap >= 512
// while a raw word >= 16 is non-zero (read from _data directly, not a method).
// The fb1024-nofull (no _full summary) and fb1024-clear-low16 controls break I1/I2 here.
// After the random part, FIXED rows (fb1024FixedRows below; no RNG drawn, so h,
// KEY and measures.fb1024T0 / fb1024CountsT0 are unchanged) build the
// distinguishing acquire state on purpose: a target word >= 16 that is
// non-empty, has bit 0 clear and >= 2 clear bits (words 16, 23 and 31 at cap
// 1024, word 31 at the partial cap 999). The random part may never reach that
// state for some RNG states (lane S seed 2503656438), so fb1024-acq-highword
// fails T0 here deterministically.
// G2 (1.6.0) laws at the same checkpoints (fb1024G2 below), over a PRIVATE
// xorshift seeded KEY[0] ^ 0x9e3779b9 before the first key() draw, so the h
// and KEY streams -- and measures.fb1024T0 -- are unchanged.
function fb1024Laws(ctx, F) {
    const C = ctx.FB1024;
    const h = ctx.h;
    const KEY = new Int32Array(1);
    KEY[0] = (h.nextU32() | 0) || 0x2545f491;
    const g2 = fb1024G2(C, F, (KEY[0] ^ 0x9e3779b9) | 0);
    const key = (n) => { let x = KEY[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; KEY[0] = x; return (x >>> 0) % n; };
    const cb = (b) => { LIST.push(b); };
    let LIST = [];
    let fullBig = 0;
    let acqHigh = 0;
    let clearBig = 0;
    const caps = [1, 31, 32, 33, 1023, 1024, 128 + h.randBelow(897)];
    for (let ci = 0; ci < caps.length; ci++) {
        const cap = caps[ci];
        const s = new C(cap);
        // pre-fill (and re-fill after a clear at cap >= 128) through acquire, each
        // checked against the nextClearBit() read before it
        const fill = (lv) => {
            for (let k = 0; k < lv; k++) {
                const want = s.nextClearBit();
                const got = s.acquire();
                if (got !== want) return 'FB1024 fill acquire ' + got + ' !== prior nextClearBit ' + want + ' cap ' + cap;
                if (got !== -1 && (got >>> 5) >= 16) acqHigh++;
            }
            return null;
        };
        const level = (ci === 4 || ci === 6) ? cap : key(cap + 1);
        const fe = fill(level);
        if (fe !== null) { F(fe); return; }
        if (level === cap) {
            if (s.acquire() !== -1) { F('FB1024 acquire on a full pool != -1 cap ' + cap); return; }
            if (cap >= 128) fullBig++;
        }
        const bad0 = ctx.oracle.fb1024Invariants(s);
        if (bad0 !== null) { F('FB1024 ' + bad0 + ' after pre-fill cap ' + cap); return; }
        const clearOdds = cap >= 128 ? 500 : 100;
        for (let k = 0; k < 4000; k++) {
            const r = h.randBelow(100);
            const i = key(cap);
            if (key(clearOdds) === 0) {
                if (cap >= 512) { let hi = false; for (let w = 16; w < 32; w++) if (s._data[w] !== 0) hi = true; if (hi) clearBig++; }
                s.clear();
                if (cap >= 128) { const fe2 = fill(key(cap + 1)); if (fe2 !== null) { F(fe2); return; } }
            } else if (r < 20) s.add(i);
            else if (r < 30) s.remove(i);
            else if (r < 40) s.toggle(i);
            else if (r < 70) {
                const want = s.nextClearBit();
                const got = s.acquire();
                if (got !== want) { F('FB1024 acquire ' + got + ' !== prior nextClearBit ' + want + ' cap ' + cap); return; }
                if (got !== -1 && !s.has(got)) { F('FB1024 acquired slot ' + got + ' not held cap ' + cap); return; }
                if (got === -1 && cap >= 128) fullBig++;
                if (got !== -1 && (got >>> 5) >= 16) acqHigh++;
            } else {
                const x = s.nextSetBit(i);
                if (x !== -1) s.release(x);
            }
            const bad = ctx.oracle.fb1024Invariants(s);
            if (bad !== null) { F('FB1024 ' + bad + ' after op ' + k + ' cap ' + cap); return; }
            if ((k & 31) !== 0) continue;
            LIST = [];
            s.forEach(cb);
            const walk = [];
            for (let b = s.nextSetBit(0), n = 0; b !== -1 && n <= cap; b = s.nextSetBit(b + 1), n++) walk.push(b);
            const lw = LIST.join(), ww = walk.join();
            if (lw !== ww) { F('FB1024 cursor walk != forEach cap ' + cap); return; }
            if (s.size !== LIST.length) F('FB1024 size ' + s.size + ' != forEach count ' + LIST.length + ' cap ' + cap);
            if (s.lowest() !== s.nextSetBit(0)) F('FB1024 lowest != nextSetBit(0) cap ' + cap);
            if (s.highest() !== (LIST.length ? LIST[LIST.length - 1] : -1)) F('FB1024 highest != last visited cap ' + cap);
            if (s.nextSetBit(cap) !== -1) F('FB1024 nextSetBit(cap) != -1 cap ' + cap);
            if (s.isEmpty() !== (s.size === 0) || s.isFull() !== (s.size === cap)) F('FB1024 isEmpty/isFull vs size cap ' + cap);
            if ((s.nextClearBit() === -1) !== s.isFull()) F('FB1024 nextClearBit -1 iff isFull cap ' + cap);
            if (!s.hasAll(s) || s.hasAny(s) !== !s.isEmpty()) F('FB1024 hasAll/hasAny(self) cap ' + cap);
            g2.check(s, cap, LIST);
        }
    }
    // fullBig is reported, not gated here: the forced pre-fill to capacity always
    // counts it, so a T0 minimum could never fail. T5 gates it from the oracle.
    if (!(acqHigh >= 100) || !(clearBig >= 3)) F('FB1024 coverage: acquires in words >= 16 ' + acqHigh + ' (need >= 100), clears at cap >= 512 with a high word set ' + clearBig + ' (need >= 3) -- fail closed');
    ctx.measures.fb1024T0 = { fullBig, acqHigh, clearBig };
    ctx.measures.fb1024CountsT0 = g2.finish();
    fb1024FixedRows(C, ctx, F);
}

// ---- FB1024 fixed acquire rows (SOAK-1) -------------------------------------
// Deterministic, NO RNG: per row, new C(cap), add bits 0..fill-1 (whole words
// below the target word), add the extra bits of the target word, then
// acquire() === the nextClearBit() read before it, the slot is held, and I1-I4
// hold. Each target word must be non-empty, have bit 0 clear and >= 2 clear
// bits -- the state where fb1024-acq-highword takes the second-lowest clear bit.
// That precondition is ASSERTED before the acquire (fail closed), so a table
// edit that drops the state fails here instead of passing vacuously.
// [cap, fill, extra bits]: word 16 = 0b110 at cap 1024; word 23 = 0b110 at cap
// 1024 (a middle word); word 31 = 0b110 at cap 1024; word 31 = 0b10 at the
// partial cap 999 (its last word holds 7 bits).
const FB1024_FIXED = [[1024, 512, [513, 514]], [1024, 736, [737, 738]], [1024, 992, [993, 994]], [999, 992, [993]]];
function fb1024FixedRows(C, ctx, F) {
    for (let r = 0; r < FB1024_FIXED.length; r++) {
        const cap = FB1024_FIXED[r][0], fill = FB1024_FIXED[r][1], extra = FB1024_FIXED[r][2];
        const s = new C(cap);
        for (let b = 0; b < fill; b++) s.add(b);
        for (let j = 0; j < extra.length; j++) s.add(extra[j]);
        const tw = fill >>> 5;
        const old = s._data[tw], cw = ~old;
        if (tw < 16 || old === 0 || (old & 1) !== 0 || (cw & (cw - 1)) === 0) { F('FB1024 fixed row: word ' + tw + ' is not in the acq-highword state (word >= 16, non-empty, bit 0 clear, >= 2 clear bits) cap ' + cap); continue; }
        const want = s.nextClearBit();
        const got = s.acquire();
        if (got !== want) { F('FB1024 fixed row: acquire ' + got + ' !== prior nextClearBit ' + want + ' (word ' + tw + ' non-empty, bit 0 clear) cap ' + cap); continue; }
        if (want !== fill) { F('FB1024 fixed row: nextClearBit ' + want + ' !== ' + fill + ' (word ' + tw + ') cap ' + cap); continue; }
        if (!s.has(got)) { F('FB1024 fixed row: acquired slot ' + got + ' not held cap ' + cap); continue; }
        const bad = ctx.oracle.fb1024Invariants(s);
        if (bad !== null) F('FB1024 fixed row: ' + bad + ' after acquire cap ' + cap);
    }
}

// ---- G2 (1.6.0) FastBit1024 prevSetBit + count laws ------------------------
// check(s, cap, list) runs at every fb1024Laws checkpoint; list is s's forEach
// list (ascending), the truth. prevSetBit: the bounded reverse walk
// (prevSetBit(cap - 1), then prevSetBit(b - 1), at most cap + 1 steps) ===
// list reversed; prevSetBit(cap - 1) === highest(); prevSetBit(-1) === -1;
// prevSetBit(q) === the largest list bit <= q for a random q. Self: inter =
// union = size, diff = 0. Pair (partner t, cap from G2_PCAPS; 1 in 4 a random
// subset of s, else a density from G2_PDENS): inter symmetric; inter === a
// naive t.has count over the list; union + inter === size + t.size; diff +
// inter === size; hasAny === inter > 0; hasAll(t) === (t.differenceSize(s) ===
// 0). Coverage, gated (fail closed): reverse walks over a non-empty set,
// pairs with differing capacities, pairs sharing a non-empty word where t
// holds a bit s lacks (a popcount of od[w] alone over-counts there), and
// non-empty subset pairs (hasAll true). A COVERAGE miss (never a broken law)
// gets up to 3 top-up rounds of 256 fresh random pairs from the same stream,
// then fails closed. Controls: fb1024-prev-strict (M8) and
// fb1024-inter-other-only (M9).
const G2_PCAPS = [1, 33, 500, 1024];
const G2_PDENS = [0, 10, 300, 700, 1000];
const G2_SCAPS = [1, 31, 32, 33, 500, 1023, 1024];
const G2_FLOOR = { walks: 300, diffCap: 300, sharedMiss: 100, subset: 50 };

function fb1024G2(C, F, seed) {
    const PK = new Int32Array(1);
    PK[0] = seed || 0x2545f491;
    const pk = (n) => { let x = PK[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; PK[0] = x; return (x >>> 0) % n; };
    const cnt = { checks: 0, pairs: 0, walks: 0, diffCap: 0, sharedMiss: 0, subset: 0, topUp: 0, failedLaws: 0 };
    const failed = Object.create(null);
    const bad = (law, msg) => { if (failed[law] === undefined) { failed[law] = 0; cnt.failedLaws++; F('FB1024 G2 law ' + law + ': ' + msg); } failed[law]++; };
    const check = (s, cap, list) => {
        const L = list.length;
        cnt.checks++;
        const rev = [];
        for (let b = s.prevSetBit(cap - 1), n = 0; b !== -1 && n <= cap; b = s.prevSetBit(b - 1), n++) rev.push(b);
        let same = rev.length === L;
        for (let i = 0; same && i < L; i++) if (rev[i] !== list[L - 1 - i]) same = false;
        if (!same) bad('prevSetBit reverse walk', rev.length + ' bits, want ' + L + ' (forEach reversed) cap ' + cap);
        if (L > 0) cnt.walks++;
        if (s.prevSetBit(cap - 1) !== s.highest()) bad('prevSetBit(cap - 1) === highest', 'got ' + s.prevSetBit(cap - 1) + ' want ' + s.highest() + ' cap ' + cap);
        if (s.prevSetBit(-1) !== -1) bad('prevSetBit(-1) === -1', 'got ' + s.prevSetBit(-1) + ' cap ' + cap);
        const q = pk(cap);
        let want = -1;
        for (let i = 0; i < L && list[i] <= q; i++) want = list[i];
        if (s.prevSetBit(q) !== want) bad('prevSetBit(q) === largest bit <= q', 'q ' + q + ' got ' + s.prevSetBit(q) + ' want ' + want + ' cap ' + cap);
        if (s.intersectionSize(s) !== L || s.unionSize(s) !== L || s.differenceSize(s) !== 0) bad('self inter = union = size, diff = 0', 'inter ' + s.intersectionSize(s) + ' union ' + s.unionSize(s) + ' diff ' + s.differenceSize(s) + ' size ' + L + ' cap ' + cap);
        const tcap = G2_PCAPS[pk(4)];
        const t = new C(tcap);
        if (pk(4) === 0) {
            for (let i = 0; i < L && list[i] < tcap; i++) if (pk(2) === 0) t.add(list[i]);
        } else {
            const dens = G2_PDENS[pk(5)];
            for (let b = 0; b < tcap; b++) if (pk(1000) < dens) t.add(b);
        }
        cnt.pairs++;
        if (tcap !== cap) cnt.diffCap++;
        const tn = t.size;
        const inter = s.intersectionSize(t), back = t.intersectionSize(s);
        let naive = 0;
        for (let i = 0; i < L && list[i] < tcap; i++) if (t.has(list[i])) naive++;
        for (let a = s._active & t._active; a !== 0; a &= a - 1) {
            const w = 31 - Math.clz32(a & -a);
            if ((t._data[w] & ~s._data[w]) !== 0) { cnt.sharedMiss++; break; }
        }
        const at = ' (caps ' + cap + ' / ' + tcap + ', sizes ' + L + ' / ' + tn + ')';
        if (inter !== back) bad('inter symmetric', inter + ' vs ' + back + at);
        if (inter !== naive) bad('inter === naive count', inter + ' want ' + naive + at);
        if (s.unionSize(t) + inter !== L + tn) bad('union + inter === size + t.size', 'union ' + s.unionSize(t) + ' inter ' + inter + at);
        if (s.differenceSize(t) + inter !== L) bad('diff + inter === size', 'diff ' + s.differenceSize(t) + ' inter ' + inter + at);
        if (s.hasAny(t) !== inter > 0) bad('hasAny === inter > 0', 'hasAny ' + s.hasAny(t) + ' inter ' + inter + at);
        const all = s.hasAll(t);
        if (all !== (t.differenceSize(s) === 0)) bad('hasAll(t) === (t.differenceSize(s) === 0)', 'hasAll ' + all + ' t.diff ' + t.differenceSize(s) + at);
        if (all && tn > 0) cnt.subset++;
    };
    const short = () => !(cnt.walks >= G2_FLOOR.walks) || !(cnt.diffCap >= G2_FLOOR.diffCap) || !(cnt.sharedMiss >= G2_FLOOR.sharedMiss) || !(cnt.subset >= G2_FLOOR.subset);
    const finish = () => {
        const list = [];
        const push = (b) => { list.push(b); };
        while (short() && cnt.failedLaws === 0 && cnt.topUp < 3) {
            cnt.topUp++;
            for (let r = 0; r < 256; r++) {
                const cap = G2_SCAPS[pk(G2_SCAPS.length)];
                const dens = G2_PDENS[pk(5)];
                const s = new C(cap);
                for (let b = 0; b < cap; b++) if (pk(1000) < dens) s.add(b);
                list.length = 0;
                s.forEach(push);
                check(s, cap, list);
            }
        }
        if (short()) F('FB1024 G2 coverage: non-empty reverse walks ' + cnt.walks + ' (need >= ' + G2_FLOOR.walks + '), differing-cap pairs ' + cnt.diffCap + ' (need >= ' + G2_FLOOR.diffCap + '), shared-word over-count pairs ' + cnt.sharedMiss + ' (need >= ' + G2_FLOOR.sharedMiss + '), non-empty subset pairs ' + cnt.subset + ' (need >= ' + G2_FLOOR.subset + ') after ' + cnt.topUp + ' top-up round(s) -- fail closed');
        return cnt;
    };
    return { check, finish };
}

// ---- G1 (1.6.0) FastBit1024 image laws -------------------------------------
// Over a PRIVATE xorshift stream (seeded from ctx.seed; the harness stream the
// other rows read is unchanged): 16 capacities x 7 densities x 2 reps. The
// truth is a bit list (the model) and a naive image builder (header + LSB-first
// words), never the class. Per set: imageLength; saveInto at an offset > 0
// writes exactly the naive image and nothing outside it; loadFrom into a junk
// receiver; serialize === the naive image; deserialize (and its JSON path)
// keeps the image capacity; copy; clone (independent of its source); equals
// both ways, across capacities, after a one-bit change, and against the model
// for a random second set; cross-capacity loads (into 1024; a fitting
// 1024-image into this capacity); a three-image arena with chained offsets.
// fb1024Invariants (I1-I4) after every load / copy / clone / deserialize.
// Coverage gated (fail closed): >= 20 loads carrying a full (-1) word (the
// fb1024-img-nofull control's teeth) and >= 100 cross-capacity loads.
const G1_CAPS = [1, 2, 31, 32, 33, 63, 64, 65, 500, 511, 512, 513, 993, 1000, 1023, 1024];
const G1_DENS = [0, 5, 100, 500, 900, 995, 1000];

function g1Image(cap, bits) {
    const a = new Int32Array(1 + ((cap + 31) >>> 5));
    a[0] = 0x46420800 | cap;
    for (let i = 0; i < bits.length; i++) a[1 + (bits[i] >>> 5)] |= 1 << (bits[i] & 31);
    return a;
}

function fb1024ImageLaws(ctx, F) {
    const C = ctx.FB1024;
    const inv = ctx.oracle.fb1024Invariants;
    const KEY = new Int32Array(1);
    KEY[0] = (ctx.seed ^ 0x3c6ef372) | 0 || 0x2545f491;
    const rnd = (n) => { let x = KEY[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; KEY[0] = x; return (x >>> 0) % n; };
    const model = (cap, dens) => { const b = []; for (let i = 0; i < cap; i++) if (rnd(1000) < dens) b.push(i); return b; };
    const mk = (cap, bits) => { const s = new C(cap); for (let i = 0; i < bits.length; i++) s.add(bits[i]); return s; };
    const failed = Object.create(null);
    const bad = (law, msg) => { if (failed[law] === undefined) { failed[law] = 0; F('FB1024 image law ' + law + ': ' + msg); } failed[law]++; };
    // raw bits of s equal the model list, capacity is `cap`, I1-I4 hold
    const same = (s, cap, bits) => {
        if (s._cap !== cap) return '_cap ' + s._cap + ' want ' + cap;
        const want = new Uint8Array(1024);
        for (let i = 0; i < bits.length; i++) want[bits[i]] = 1;
        for (let b = 0; b < 1024; b++) if (((s._data[b >>> 5] >>> (b & 31)) & 1) !== want[b]) return 'bit ' + b + ' is ' + (want[b] ^ 1);
        return inv(s);
    };
    const sameList = (x, y) => { if (x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
    let laws = 0, fullLoads = 0, crossLoads = 0;
    const law = (name, cap, fn) => {
        laws++;
        let why;
        try { why = fn(); } catch (e) { why = 'threw ' + (e && e.constructor ? e.constructor.name : typeof e) + ' "' + (e && e.message) + '"'; }
        if (why !== null) bad(name, why + ' (cap ' + cap + ')');
    };
    for (let rep = 0; rep < 14; rep++) {
        for (const cap of G1_CAPS) {
            const dens = G1_DENS[rep % 7];
            const bits = model(cap, dens);
            const L = (cap + 31) >>> 5;
            const img = g1Image(cap, bits);
            let full = false;
            for (let w = 1; w < img.length; w++) if (img[w] === -1) full = true;
            const a = mk(cap, bits);
            law('imageLength', cap, () => (a.imageLength === 1 + L ? null : 'imageLength ' + a.imageLength + ' want ' + (1 + L)));
            law('saveInto writes exactly the image', cap, () => {
                const off = 1 + rnd(3);
                const out = new Int32Array(off + 1 + L + 2).fill(0x5A5A5A5A);
                const ret = a.saveInto(out, off);
                if (ret !== off + 1 + L) return 'returned ' + ret + ' want ' + (off + 1 + L);
                for (let i = 0; i < out.length; i++) {
                    const want = i >= off && i < off + 1 + L ? img[i - off] : 0x5A5A5A5A;
                    if (out[i] !== want) return 'out[' + i + '] = ' + out[i] + ' want ' + want;
                }
                return null;
            });
            law('loadFrom into a junk receiver', cap, () => {
                const r = mk(cap, model(cap, rnd(1001)));
                const ret = r.loadFrom(img, 0);
                if (ret !== img.length) return 'returned ' + ret;
                if (full) fullLoads++;
                return same(r, cap, bits);
            });
            law('serialize is the image', cap, () => {
                const s = a.serialize();
                if (!(s instanceof Int32Array) || s.length !== img.length) return 'length ' + s.length;
                for (let i = 0; i < img.length; i++) if (s[i] !== img[i]) return 'word ' + i;
                return null;
            });
            law('deserialize keeps the image capacity', cap, () => {
                const d = C.deserialize(img);
                if (full) fullLoads++;
                const v = same(d, cap, bits);
                if (v !== null) return v;
                const j = C.deserialize(new Int32Array(JSON.parse(JSON.stringify(Array.from(img)))));
                return same(j, cap, bits);
            });
            law('copy', cap, () => {
                const r = mk(cap, model(cap, rnd(1001)));
                if (r.copy(a) !== r) return 'copy did not return this';
                return same(r, cap, bits);
            });
            law('clone is equal and independent', cap, () => {
                const c = a.clone();
                const v = same(c, cap, bits);
                if (v !== null) return v;
                const t = rnd(cap);
                c.toggle(t);
                const v2 = same(a, cap, bits);
                return v2 === null ? null : 'source moved after a clone write: ' + v2;
            });
            law('equals', cap, () => {
                const c = mk(cap, bits);
                if (!a.equals(c) || !c.equals(a) || !a.equals(a)) return 'equal sets not equal';
                const wide = mk(1024, bits);
                if (!a.equals(wide) || !wide.equals(a)) return 'equal bits across capacity 1024 not equal';
                const t = rnd(cap);
                c.toggle(t);
                if (a.equals(c) || c.equals(a)) return 'equal after toggling bit ' + t;
                const bb = model(cap, G1_DENS[rnd(7)]);
                const b = mk(cap, bb);
                if (a.equals(b) !== sameList(bits, bb)) return 'equals vs the model for a random set';
                return null;
            });
            law('cross-capacity loads', cap, () => {
                const big = mk(1024, model(1024, rnd(1001)));
                big.loadFrom(img);
                crossLoads++;
                const v = same(big, 1024, bits);
                if (v !== null) return 'into 1024: ' + v;
                const wideImg = g1Image(1024, bits);
                const r = mk(cap, model(cap, rnd(1001)));
                r.loadFrom(wideImg);
                crossLoads++;
                const v2 = same(r, cap, bits);
                if (v2 !== null) return 'fitting 1024-image: ' + v2;
                const r2 = mk(cap, model(cap, rnd(1001)));
                r2.copy(mk(1024, bits));
                const v3 = same(r2, cap, bits);
                return v3 === null ? null : 'copy from a fitting 1024-set: ' + v3;
            });
            law('arena', cap, () => {
                const cap2 = G1_CAPS[rnd(G1_CAPS.length)];
                const bits2 = model(cap2, G1_DENS[rnd(7)]);
                const b = mk(cap2, bits2);
                const arena = new Int32Array(1 + a.imageLength * 2 + b.imageLength);
                const o1 = a.saveInto(arena, 1), o2 = b.saveInto(arena, o1), o3 = a.saveInto(arena, o2);
                if (o3 !== arena.length) return 'chained save ends at ' + o3 + ' want ' + arena.length;
                const x = new C(cap), y = new C(cap2), z = new C(cap);
                const p1 = x.loadFrom(arena, 1), p2 = y.loadFrom(arena, p1), p3 = z.loadFrom(arena, p2);
                if (p1 !== o1 || p2 !== o2 || p3 !== o3) return 'chained load offsets ' + [p1, p2, p3] + ' want ' + [o1, o2, o3];
                return same(x, cap, bits) || same(y, cap2, bits2) || same(z, cap, bits);
            });
        }
    }
    if (!(fullLoads >= 20) || !(crossLoads >= 100)) F('FB1024 image laws coverage: loads with a full word ' + fullLoads + ' (need >= 20), cross-capacity loads ' + crossLoads + ' (need >= 100) -- fail closed');
    ctx.measures.fb1024ImgT0 = { laws, fullLoads, crossLoads, failedLaws: Object.keys(failed).length };
}
