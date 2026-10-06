// test/torture/t9-controls.mjs -- in-process self-validation of the CHEAP
// controls (the synchronous tiers). Each control must make EVERY one of its
// target tiers fail; a control that leaves ANY listed tier green means that
// gate is decorative, and that is itself a T9 failure. The expensive controls (foreach-closure,
// budget-major, soak-stash) are exercised as child processes by
// controls-runner.mjs because they re-run the gc/measurement tiers.

import { buildBaseCtx } from './context.mjs';
import { CONTROLS } from './controls.mjs';
import { run as t0 } from './t0-laws.mjs';
import { run as t1 } from './t1-degenerate.mjs';
import { run as t2 } from './t2-representation.mjs';
import { run as t3 } from './t3-adversarial.mjs';
import { run as t4 } from './t4-mapper.mjs';
import { run as t5 } from './t5-fuzz.mjs';
import { run as t8 } from './t8-cross.mjs';

const SYNC_TIERS = { T0: t0, T1: t1, T2: t2, T3: t3, T4: t4, T5: t5, T8: t8 };

export function run(ctx) {
    const fails = [];
    let green = 0;

    for (const [name, control] of Object.entries(CONTROLS)) {
        if (!control.cheap) continue;
        const sub = buildBaseCtx(ctx.seed);
        control.apply(sub);
        const notFailed = [];
        for (const tierName of control.tiers) {
            const tierRun = SYNC_TIERS[tierName];
            if (!tierRun) { fails.push('T9: control ' + name + ' targets unknown sync tier ' + tierName); notFailed.push(tierName); continue; }
            const res = tierRun(sub);
            if (!(res.fails.length > 0 || res.green > 0)) notFailed.push(tierName);
        }
        if (notFailed.length > 0) fails.push('T9: control "' + name + '" did NOT fail every target tier ' + control.tiers.join(',') + ' (decorative gate; still green: ' + notFailed.join(',') + ')');
    }

    return { fails, green };
}
