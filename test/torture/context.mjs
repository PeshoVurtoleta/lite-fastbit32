// test/torture/context.mjs -- builds the shared ctx the tiers receive. Tiers
// never import the library themselves; they read ctx.FB / ctx.Mapper / ctx.iter.

import {
    FastBit32, BitMapper,
    forEachArray, forEachObject, forEachMapped, forEachMappedObject,
    forEachMaskPair, forEachMaskDiff, forEachMaskUnion
} from '../../FastBit32.js';
import * as oracle from './oracle.mjs';
import * as h from './harness.mjs';

export function buildBaseCtx(seed) {
    return {
        FB: FastBit32,
        Mapper: BitMapper,
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
