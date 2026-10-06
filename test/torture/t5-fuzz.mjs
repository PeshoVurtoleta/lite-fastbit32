// test/torture/t5-fuzz.mjs -- differential fuzz against the oracle. 200k mixed
// ops (strict: every op checked; TORTURE_FAST=1: every 16th). Every 64th op
// re-derives the word and checks serialize() equality as a set. FB-01 (C5)
// mismatches are counted SEPARATELY and must be > 0 (proof the bug is live at
// S0). Any OTHER mismatch is a failure with a replay line. The oracle-flip
// control injects a wrong oracle -> non-C5 mismatches -> this tier fails.

export function run(ctx) {
    const FB = ctx.FB;
    const o = ctx.oracle;
    const h = ctx.h;
    const fails = [];
    let green = 0;
    const strict = process.env.TORTURE_FAST !== '1';
    const stride = strict ? 1 : 16;
    const OPS = 200000;

    const fb = new FB();
    const model = new Uint8Array(32); // truth bits
    const wordOf = () => { let r = 0; for (let i = 0; i < 32; i++) if (model[i]) r += 2 ** i; return r >>> 0; };

    let c5count = 0;
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
            for (const [name, got, want] of checks) {
                if (got !== want && firstFail < 0) { firstFail = i; fails.push('T5: ' + name + ' op ' + i + ' got ' + got + ' want ' + want); }
            }
            // hasAll on the instance's own bits as an unsigned mask (true answer).
            const selfMask = fb.value >>> 0;
            const libAll = fb.hasAll(selfMask);
            const trueAll = o.oHasAll(ew, selfMask);
            const isC5 = (selfMask !== (selfMask | 0)) && (trueAll === true);
            if (isC5) {
                if (libAll !== trueAll) c5count++;      // expected FB-01 divergence
                else green++;                            // fixed -> green (fails under hasall-fixed)
            } else if (libAll !== trueAll && firstFail < 0) {
                firstFail = i; fails.push('T5: hasAll op ' + i);
            }
        }

        if ((i % 64) === 0) {
            const r = FB.deserialize(fb.serialize());
            if (((r.value ^ fb.value) >>> 0) !== 0 && firstFail < 0) { firstFail = i; fails.push('T5: serialize roundtrip op ' + i); }
        }
    }

    if (firstFail >= 0) fails.push('T5: replay -> ' + h.replayLine(ctx.seed, firstFail));
    if (c5count === 0) fails.push('T5: expected FB-01 (C5) divergences > 0, saw 0 (positive control)');

    // c5count = FB-01 rows that stayed buggy (red); green = rows that got fixed.
    return { fails, green, fb01Red: c5count };
}
