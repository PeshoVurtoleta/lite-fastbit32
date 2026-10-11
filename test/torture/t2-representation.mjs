// test/torture/t2-representation.mjs -- the representation matrix (FB-01's home
// tier). 5 build forms x {m, m>>>0, m|0} x key matrix x every mask op. Sets are
// compared as (a ^ b) === 0, never === on .value. hasAll is signedness-agnostic
// from 1.2.1 / FB-01 on, so every mask representation (bit 31 included) is a
// plain oracle check. The hasall-old control reinstalls the 1.2.0 body and must
// fail here.

import {
    oHasAll, oHasAny, oHasNone, oCountMasked, oUnion, oIntersect, oDifference, ubit,
    oNextSetBit, oPrevSetBit, oRank, oIsSubsetOf, oEquals
} from './oracle.mjs';

const CURSOR_FROM = [0, 1, 15, 16, 29, 30, 31];

export function run(ctx) {
    const FB = ctx.FB;
    const fails = [];

    const lanes = ctx.h.LANE_VALUES; // 6 lanes
    const signed = ctx.h.LANE_SIGNED;
    const names = ctx.h.LANE_NAMES;

    // five build forms for a word w, each yielding the same set
    function builds(w) {
        const bitsArr = [];
        for (let i = 0; i < 32; i++) if (ubit(w, i)) bitsArr.push(i);
        const byAdd = new FB();
        for (const b of bitsArr) byAdd.add(b);
        return [
            new FB(w),                         // ctor (unsigned-built)
            byAdd,                             // add() (signed-built)
            new FB().fromArray(bitsArr),       // fromArray
            FB.deserialize(w),                 // deserialize
            new FB(w).clone()                  // clone
        ];
    }

    for (let vi = 0; vi < lanes.length; vi++) {
        const w = lanes[vi];
        const forms = builds(w);
        // all build forms are the same set
        for (let f = 1; f < forms.length; f++) {
            if (((forms[0].value ^ forms[f].value) >>> 0) !== 0) {
                fails.push('T2: build form ' + f + ' diverged on value lane ' + names[vi]);
            }
        }

        // S4: cursors, rank and equals per build form (no mask operand)
        for (let f = 0; f < forms.length; f++) {
            const inst = forms[f];
            for (const from of CURSOR_FROM) {
                if (inst.nextSetBit(from) !== oNextSetBit(w, from)) fails.push('T2: nextSetBit(' + from + ') lane ' + names[vi] + ' form ' + f);
                if (inst.prevSetBit(from) !== oPrevSetBit(w, from)) fails.push('T2: prevSetBit(' + from + ') lane ' + names[vi] + ' form ' + f);
                if (inst.rank(from) !== oRank(w, from)) fails.push('T2: rank(' + from + ') lane ' + names[vi] + ' form ' + f);
            }
            if (inst.nextSetBit(32) !== -1) fails.push('T2: nextSetBit(32) lane ' + names[vi] + ' form ' + f);
            if (inst.prevSetBit(-1) !== -1) fails.push('T2: prevSetBit(-1) lane ' + names[vi] + ' form ' + f);
            for (let g = 0; g < forms.length; g++) {
                if (!inst.equals(forms[g])) fails.push('T2: equals lane ' + names[vi] + ' form ' + f + ' vs ' + g);
            }
            if (!new FB().set(w).equals(inst)) fails.push('T2: set lane ' + names[vi] + ' form ' + f);
            if (!new FB().copy(inst).equals(inst)) fails.push('T2: copy lane ' + names[vi] + ' form ' + f);
        }

        for (let mi = 0; mi < lanes.length; mi++) {
            const base = lanes[mi];
            const reps = [base, base >>> 0, base | 0];
            const repTags = ['m', 'm>>>0', 'm|0'];
            for (let r = 0; r < reps.length; r++) {
                const m = reps[r];
                for (let f = 0; f < forms.length; f++) {
                    const inst = forms[f];
                    // hasAny / hasNone are signedness-agnostic -> hard assert
                    if (inst.hasAny(m) !== oHasAny(w, m)) {
                        fails.push('T2: hasAny lane ' + names[vi] + ' mask ' + names[mi] + '/' + repTags[r]);
                    }
                    if (inst.hasNone(m) !== oHasNone(w, m)) {
                        fails.push('T2: hasNone lane ' + names[vi] + ' mask ' + names[mi] + '/' + repTags[r]);
                    }
                    if (inst.countMasked(m) !== oCountMasked(w, m)) {
                        fails.push('T2: countMasked lane ' + names[vi] + ' mask ' + names[mi] + '/' + repTags[r]);
                    }
                    // mutating set math against the oracle word
                    if (((new FB(w).union(m).value ^ oUnion(w, m)) >>> 0) !== 0) {
                        fails.push('T2: union lane ' + names[vi] + ' mask ' + names[mi] + '/' + repTags[r]);
                    }
                    if (((new FB(w).intersect(m).value ^ oIntersect(w, m)) >>> 0) !== 0) {
                        fails.push('T2: intersect lane ' + names[vi] + ' mask ' + names[mi] + '/' + repTags[r]);
                    }
                    if (((new FB(w).difference(m).value ^ oDifference(w, m)) >>> 0) !== 0) {
                        fails.push('T2: difference lane ' + names[vi] + ' mask ' + names[mi] + '/' + repTags[r]);
                    }
                    // hasAll is signedness-agnostic after the FB-01 fix: it
                    // must match the oracle for every mask representation, bit
                    // 31 included (C5 is no longer an expected-red zone).
                    if (inst.hasAll(m) !== oHasAll(w, m)) {
                        fails.push('T2: hasAll lane ' + names[vi] + ' mask ' + names[mi] + '/' + repTags[r]);
                    }
                    // S4: isSubsetOf and equalsValue are signedness-agnostic
                    if (inst.isSubsetOf(m) !== oIsSubsetOf(w, m)) {
                        fails.push('T2: isSubsetOf lane ' + names[vi] + ' mask ' + names[mi] + '/' + repTags[r]);
                    }
                    if (inst.equalsValue(m) !== oEquals(w, m)) {
                        fails.push('T2: equalsValue lane ' + names[vi] + ' mask ' + names[mi] + '/' + repTags[r]);
                    }
                    if (inst.equals(new FB(m)) !== oEquals(w, m)) {
                        fails.push('T2: equals lane ' + names[vi] + ' other ' + names[mi] + '/' + repTags[r]);
                    }
                    void signed;
                    void ubit;
                }
            }
        }
    }

    // a broken variant (T9 control) may throw mid-sequence: that is a FAIL row, never a crash
    try { fb1024Words(ctx, fails); } catch (e) { fails.push('T2 ' + 'FastBit1024 rows threw ' + e.constructor.name + ': ' + e.message); }
    return { fails, green: 0 };
}

// ---- S4b FastBit1024: every word value in every word (law 8 teeth) ----------
// Each of 32 words holds 0, 1, 1<<30, -1 (full word), -2^31 (bit 31 alone),
// 2^31-1, -2 and two alternating patterns, built through add(); every query is
// compared to the O1024 truth model, and hasAll/hasAny run against an `other`
// holding the same word (bit 31 per word) and the same word plus one more bit.
const FB1024_VALS = [0, 1, 1 << 30, -1, -(2 ** 31), 0x7fffffff, -2, 0x55555555, 0xAAAAAAAA | 0];
function fb1024Words(ctx, fails) {
    const C = ctx.FB1024;
    const O = ctx.oracle.O1024;
    const F = (m) => fails.push('T2 FB1024: ' + m);
    for (let w = 0; w < 32; w++) {
        for (const v of FB1024_VALS) {
            const s = new C();
            const o = new O(1024);
            const other = new C();
            for (let b = 0; b < 32; b++) {
                if (((v >>> b) & 1) === 1) { s.add((w << 5) + b); other.add((w << 5) + b); o.b[(w << 5) + b] = 1; }
            }
            const tag = 'word ' + w + ' value ' + v;
            if (((s._data[w] ^ v) | 0) !== 0) F(tag + ' stored ' + s._data[w]);
            const bad = ctx.oracle.fb1024Invariants(s);
            if (bad !== null) F(tag + ' ' + bad);
            if (s.size !== o.count()) F(tag + ' size ' + s.size);
            if (s.lowest() !== o.lowest()) F(tag + ' lowest ' + s.lowest());
            if (s.highest() !== o.highest()) F(tag + ' highest ' + s.highest());
            if (s.nextClearBit() !== o.clearLow()) F(tag + ' nextClearBit ' + s.nextClearBit());
            for (let b = 0; b < 32; b++) {
                const i = (w << 5) + b;
                if (s.has(i) !== (o.b[i] === 1)) F(tag + ' has(' + i + ')');
                if (s.nextSetBit(i) !== o.next(i)) F(tag + ' nextSetBit(' + i + ')');
            }
            if (!s.hasAll(other) || !other.hasAll(s)) F(tag + ' hasAll(same word)');
            if (s.hasAny(other) !== (v !== 0)) F(tag + ' hasAny(same word)');
            const clr = o.clearLow();
            if (clr !== -1) {
                other.add(clr);
                if (s.hasAll(other)) F(tag + ' hasAll(+bit ' + clr + ') true');
                if (!other.hasAll(s)) F(tag + ' superset hasAll false');
            }
            if (((v >>> 31) & 1) === 1) {
                s.remove((w << 5) + 31);
                if (((s._data[w] ^ (v & 0x7fffffff)) | 0) !== 0 || ((s._full >>> w) & 1) !== 0) F(tag + ' remove bit 31');
                const bad2 = ctx.oracle.fb1024Invariants(s);
                if (bad2 !== null) F(tag + ' after remove bit 31: ' + bad2);
            }
        }
    }
    // hasAll/hasAny across capacities (allowed: words above a capacity are 0)
    const small = new C(33);
    const big = new C(1024);
    small.add(0).add(31).add(32);
    big.add(0).add(31).add(32).add(1023);
    if (!big.hasAll(small) || small.hasAll(big) || !small.hasAny(big) || !big.hasAny(small)) F('cross-capacity hasAll/hasAny (33 vs 1024)');
    const bigOnlyHigh = new C(1024).add(1023);
    if (small.hasAny(bigOnlyHigh) || small.hasAll(bigOnlyHigh) || !bigOnlyHigh.hasAll(new C(1))) F('cross-capacity word above capacity');
}
