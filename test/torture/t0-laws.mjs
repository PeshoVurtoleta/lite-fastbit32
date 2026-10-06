// test/torture/t0-laws.mjs -- metamorphic algebra over a fuzz corpus, in both
// representations (ctor-built unsigned and add-built signed). Section-5 laws
// minus the S4/S5 rows (cursor/rank/select). The hasAll <=> popcount-identity
// law is scoped to masks within bits 0..30 so FB-01 (bit 31) does not fail a
// law that is not its home tier. The lowest-noguard control (returns 63 on an
// empty word) fails the lowest/highest laws here.

import {
    oCount, oCountMasked, oLowest, oHighest, oNextClearBit, oHighestClearBit,
    oIsEmpty, oIsFull, oUnion, oIntersect, oDifference, oToArray, ubit
} from './oracle.mjs';

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
        // hasAll <=> countMasked(m)===popcount(m), scoped to bits 0..30
        const m30 = m & 0x7FFFFFFF;
        if (u.hasAll(m30) !== (u.countMasked(m30) === oCount(m30))) F('hasAll popcount-identity w=' + w + ' m=' + m30);

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

        // deserialize(serialize(x)) equals x as a set
        const r = FB.deserialize(u.serialize());
        if (((r.value ^ u.value) >>> 0) !== 0) F('serialize roundtrip w=' + w);
    }

    void green;
    return { fails, green };
}
