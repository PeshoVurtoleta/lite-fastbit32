// test/torture/t8-cross.mjs -- copied consumer patterns (never imports them).
//   lite-ecs:       sig = (1 << idx) >>> 0; mask.hasAll(sig). idx 31 is FB-01.
//   lite-depth:     1 << mapper.get(name) into a Uint32Array lane, read back.
//   lite-scheduler: 31 - clz32(x & -x) === lowest() on every non-zero word.
// The idx-31 ECS row is expected-red: green under hasall-fixed -> this tier fails.

import { oLowest } from './oracle.mjs';

export function run(ctx) {
    const FB = ctx.FB;
    const Mapper = ctx.Mapper;
    const h = ctx.h;
    const fails = [];
    let green = 0;
    let fb01Red = 0;
    const F = (m) => fails.push('T8: ' + m);

    // ---- lite-ecs ------------------------------------------------------------
    for (let idx = 0; idx < 32; idx++) {
        const sig = (1 << idx) >>> 0;
        const entity = new FB().add(idx);
        const libMatch = entity.hasAll(sig);
        if (sig !== (sig | 0)) {
            // unsigned sig (idx 31): FB-01 zone. true answer is true.
            if (libMatch === true) green++;        // fixed -> green -> fail
            else fb01Red++;                        // still buggy -> red (S0)
        } else {
            if (libMatch !== true) F('lite-ecs idx ' + idx + ' did not match');
        }
        // a sibling entity missing the component must never match
        const missing = new FB();
        if (missing.hasAll(sig) === true && sig === (sig | 0)) F('lite-ecs false match idx ' + idx);
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

    return { fails, green, fb01Red };
}
