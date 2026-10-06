// test/torture/t8-cross.mjs -- copied consumer patterns (never imports them).
//   lite-ecs:       sig = (1 << idx) >>> 0; mask.hasAll(sig). idx 31 is FB-01.
//   lite-depth:     1 << mapper.get(name) into a Uint32Array lane, read back.
//   lite-scheduler: 31 - clz32(x & -x) === lowest() on every non-zero word.
// hasAll is signedness-agnostic from 1.2.1 / FB-01 on, so the idx-31 ECS row is
// a plain oracle check; the hasall-old control (1.2.0 body) fails this tier.

import { oLowest } from './oracle.mjs';

export function run(ctx) {
    const FB = ctx.FB;
    const Mapper = ctx.Mapper;
    const h = ctx.h;
    const fails = [];
    const F = (m) => fails.push('T8: ' + m);

    // ---- lite-ecs ------------------------------------------------------------
    for (let idx = 0; idx < 32; idx++) {
        const sig = (1 << idx) >>> 0;
        const entity = new FB().add(idx);
        // FB-01 fixed (1.2.1): the unsigned bit-31 signature matches like every
        // other index.
        if (entity.hasAll(sig) !== true) F('lite-ecs idx ' + idx + ' did not match');
        // a sibling entity missing the component must never match
        const missing = new FB();
        if (missing.hasAll(sig) === true) F('lite-ecs false match idx ' + idx);
    }

    // ---- lite-depth: 1 << get(name) into a Uint32Array lane -----------------
    const names = ['Opaque', 'Cutout', 'Transparent', 'Overlay', 'Shadow', 'UI', 'Debug', 'Sky'];
    const mapper = new Mapper(names);
    const lane = new Uint32Array(names.length);
    for (let i = 0; i < names.length; i++) lane[i] = (1 << mapper.get(names[i])) >>> 0;
    for (let i = 0; i < names.length; i++) {
        const back = new FB(lane[i]);
        if (!back.has(mapper.get(names[i]))) F('lite-depth read-back has() name ' + names[i]);
        if (back.count() !== 1) F('lite-depth lane ' + names[i] + ' count != 1');
    }

    // ---- lite-scheduler: 31 - clz32(x & -x) === lowest() --------------------
    for (let t = 0; t < 2000; t++) {
        let x = h.nextU32() | 0;
        if (x === 0) x = 1;
        const schedLowest = 31 - Math.clz32(x & -x);
        const fbLowest = new FB(x >>> 0).lowest();
        if (schedLowest !== fbLowest) F('lite-scheduler lowest mismatch x=' + (x >>> 0));
        if (fbLowest !== oLowest(x >>> 0)) F('lite-scheduler vs oracle x=' + (x >>> 0));
    }

    return { fails, green: 0 };
}
