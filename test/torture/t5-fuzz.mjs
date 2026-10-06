// test/torture/t5-fuzz.mjs -- differential fuzz against the oracle. 200k mixed
// ops (strict: every op checked; TORTURE_FAST=1: every 16th). Every 64th op
// re-derives the word and checks serialize() equality as a set. hasAll is
// signedness-agnostic from 1.2.1 / FB-01 on, so it is a plain oracle check over
// every word (the instance's own bits as an unsigned mask, bit 31 included). Any
// mismatch is a failure with a replay line. The oracle-flip control injects a
// wrong oracle -> mismatches -> this tier fails; the hasall-old control
// reinstalls the 1.2.0 body -> the self-mask hasAll check diverges -> fails.

export function run(ctx) {
    const FB = ctx.FB;
    const o = ctx.oracle;
    const h = ctx.h;
    const fails = [];
    const strict = process.env.TORTURE_FAST !== '1';
    const stride = strict ? 1 : 16;
    const OPS = 200000;

    const fb = new FB();
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

    return { fails, green: 0 };
}
