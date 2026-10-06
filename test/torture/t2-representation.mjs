// test/torture/t2-representation.mjs -- the representation matrix (FB-01's home
// tier). 5 build forms x {m, m>>>0, m|0} x key matrix x every mask op. Sets are
// compared as (a ^ b) === 0, never === on .value. hasAll is signedness-agnostic
// from 1.2.1 / FB-01 on, so every mask representation (bit 31 included) is a
// plain oracle check. The hasall-old control reinstalls the 1.2.0 body and must
// fail here.

import {
    oHasAll, oHasAny, oHasNone, oCountMasked, oUnion, oIntersect, oDifference, ubit
} from './oracle.mjs';

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
                    void signed;
                    void ubit;
                }
            }
        }
    }

    return { fails, green: 0 };
}
