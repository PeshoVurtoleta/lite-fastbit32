// test/torture/context.mjs -- builds the shared ctx the tiers receive. Tiers
// never import the library themselves; they read ctx.FB / ctx.Mapper / ctx.iter.
// ctx.FB64 is the shipped FastBit64; torture.mjs swaps in a variant when
// ctx.control.fb64Variant is set (fb64-variants.mjs applyFb64Variant).

import {
    FastBit32, BitMapper, FastBit1024, FastBit64,
    forEachArray, forEachObject, forEachMapped, forEachMappedObject,
    forEachMaskPair, forEachMaskDiff, forEachMaskUnion
} from '../../FastBit32.js';
import * as oracle from './oracle.mjs';
import * as h from './harness.mjs';

export function buildBaseCtx(seed) {
    return {
        FB: FastBit32,
        Mapper: BitMapper,
        FB1024: FastBit1024,
        FB64: FastBit64,
        iter: {
            forEachArray, forEachObject, forEachMapped, forEachMappedObject,
            forEachMaskPair, forEachMaskDiff, forEachMaskUnion
        },
        oracle,
        h,
        seed,
        control: {},
        measures: {}
    };
}
