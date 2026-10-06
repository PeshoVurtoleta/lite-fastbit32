// test/torture/t2-representation.mjs -- the representation matrix (FB-01 lives
// here). 5 build forms x {m, m>>>0, m|0} x key matrix x every mask op. Sets are
// compared as (a ^ b) === 0, never === on .value. Any mask carrying bit 31 in
// unsigned form is an FB-01 "expected-red" row: at S0 the library disagrees with
// the oracle (red). A GREEN such row (e.g. under the hasall-fixed control) is a
// FAIL, which is how this tier proves it can fail.

import {
    oHasAll, oHasAny, oHasNone, oCountMasked, oUnion, oIntersect, oDifference, ubit
} from './oracle.mjs';

export function run(ctx) {
    const FB = ctx.FB;
    const fails = [];
    let green = 0;
    let fb01Red = 0;

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
                    // hasAll: FB-01 zone is exactly C5 -- a non-int32 mask
                    // (m !== (m|0)) whose true answer is true. Elsewhere the
                    // op is signedness-agnostic and must match the oracle.
                    const libAll = inst.hasAll(m);
                    const trueAll = oHasAll(w, m);
                    const isC5 = (m !== (m | 0)) && (trueAll === true);
                    if (isC5) {
                        // expected-red: at S0 lib must DISAGREE (red). agreement = green = fail.
                        if (libAll === trueAll) green++; else fb01Red++;
                    } else {
                        if (libAll !== trueAll) {
                            fails.push('T2: hasAll lane ' + names[vi] + ' mask ' + names[mi] + '/' + repTags[r]);
                        }
                    }
                    void signed;
                    void ubit;
                }
            }
        }
    }

    return { fails, green, fb01Red };
}
