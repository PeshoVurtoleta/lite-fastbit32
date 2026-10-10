// test/torture/t0-laws.mjs -- metamorphic algebra over a fuzz corpus, in both
// representations (ctor-built unsigned and add-built signed). Section-5 laws
// plus the S4 Tier-1 rows (cursor, rank, equals, isSubsetOf, set/copy,
// rangeMask); select is S5. The hasAll <=> popcount-identity
// law runs over the full word (bit 31 included) now that FB-01 is fixed. The
// lowest-noguard control (returns 63 on an empty word) fails the lowest/highest
// laws here.

import {
    oCount, oCountMasked, oLowest, oHighest, oNextClearBit, oHighestClearBit,
    oIsEmpty, oIsFull, oUnion, oIntersect, oDifference, oToArray, ubit,
    oNextSetBit, oPrevSetBit, oRank, oIsSubsetOf
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
    return { fails, green };
}
