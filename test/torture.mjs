// test/torture.mjs -- node --expose-gc --min-semi-space-size=4 --max-semi-space-size=4 test/torture.mjs
//
// Ten tiers over a seeded harness. Prints exactly "ok" on stdout when every
// gate passes AND every expected-red (FB-01) row is actually red; all diagnostic
// TODO/MEASURE lines go to stderr (so `npm run -s torture 2>/dev/null` is "ok").
// TORTURE_CONTROL=<name> runs a broken variant against its target tier(s) and
// exits 1 with `FAIL <tier>` on stderr (controls-runner.mjs asserts this).
//
// Guard order (fail closed, remedy not stack trace):
//   1. globalThis.gc present       else exit 1
//   2. both semi-space pins set    else exit 1
//   3. devDeps importable          else exit 2 ("npm install")
//   4. known TORTURE_CONTROL       else exit 2 (did-you-mean)

import * as h from './torture/harness.mjs';
import { buildBaseCtx } from './torture/context.mjs';
import { CONTROLS, CONTROL_NAMES, suggest } from './torture/controls.mjs';

// ---- guard 1: --expose-gc ------------------------------------------------
if (typeof globalThis.gc !== 'function') {
    console.error('torture: globalThis.gc is missing.');
    console.error('  remedy: node --expose-gc --min-semi-space-size=4 --max-semi-space-size=4 test/torture.mjs');
    console.error('  or run: npm run torture');
    process.exit(1);
}

// ---- guard 2: semi-space pins --------------------------------------------
{
    const pins = h.semiSpacePins();
    if (!h.pinsOk(pins)) {
        console.error('torture: both --min-semi-space-size=4 and --max-semi-space-size=4 must be set exactly to 4 (got ' + h.pinsDetail(pins) + '; V8 applies the LAST occurrence and accepts the underscore spelling, so every occurrence must be 4; B/op scale drifts otherwise).');
        console.error('  remedy: npm run torture');
        process.exit(1);
    }
}

// ---- guard 2b: unsupported young-GC mode ---------------------------------
{
    const ms = h.youngGcModeFlags();
    if (ms.length > 0) {
        console.error('torture: --minor-ms is unsupported (MinorMS reports young GCs as perf_hooks kind 2, not 1, which blinds the scavenge/B-op lanes -- they would read 0 while allocating). Remove ' + ms.join(' ') + '.');
        console.error('  remedy: npm run torture');
        process.exit(1);
    }
}

// ---- guard 3: devDeps importable -----------------------------------------
try {
    await import('@zakkster/lite-gc-profiler');
    await import('@zakkster/lite-leak');
    await import('@zakkster/lite-perf-gate');
    await import('@zakkster/lite-signal'); // required static peer of lite-leak
} catch (e) {
    console.error('torture: a dev dependency failed to import (' + e.message + ').');
    console.error('  remedy: npm install');
    process.exit(2);
}

// ---- guard 4: known control ----------------------------------------------
const controlName = process.env.TORTURE_CONTROL;
if (controlName !== undefined && controlName !== '' && !CONTROLS[controlName]) {
    const hint = suggest(controlName);
    console.error('torture: unknown TORTURE_CONTROL "' + controlName + '".');
    console.error('  known: ' + CONTROL_NAMES.join(', '));
    if (hint) console.error('  did you mean: ' + hint + ' ?');
    process.exit(2);
}

// ---- tier registry (dynamic: devDeps already verified) -------------------
const seed = h.installSeed();
h.startScavengeWatch();

// ---- guard 5: young-GC detector self-validation --------------------------
// Before any tier: a positive allocation control MUST register scavenges and a
// negative (pure arithmetic) control must register none. This catches ANY
// future blinding of the watcher (a changed GC kind, a new young-GC mode) by
// failing closed here instead of silently reading 0 B/op while allocating.
{
    const base = h.minorCount();
    const pos = h.churnPositive(1500000);
    await h.settle(30);
    const posScav = h.minorCount() - base;
    globalThis.gc(); // drop the positive ring BEFORE sampling the negative lane
    await h.settle(30);
    const negBase = h.minorCount();
    const neg = h.churnNegative(1500000);
    await h.settle(30);
    const negScav = h.minorCount() - negBase;
    // keep both controls live so V8 cannot elide them (branches never taken)
    if (pos.acc === -1 && neg === -1) console.error(String(pos.RING[0]));
    if (!(posScav > 0) || negScav !== 0) {
        console.error('torture: young-GC detector blind (positive control scavenges=' + posScav + ' need > 0, negative=' + negScav + ' need 0; flags: ' + h.gcFlagsLine() + '). The scavenge and B/op lanes would read 0 while allocating.');
        console.error('  remedy: run under a Scavenger young generation (no --minor-ms), npm run torture');
        h.stopScavengeWatch();
        process.exit(1);
    }
}

const TIERS = {
    T0: (await import('./torture/t0-laws.mjs')).run,
    T1: (await import('./torture/t1-degenerate.mjs')).run,
    T2: (await import('./torture/t2-representation.mjs')).run,
    T3: (await import('./torture/t3-adversarial.mjs')).run,
    T4: (await import('./torture/t4-mapper.mjs')).run,
    T5: (await import('./torture/t5-fuzz.mjs')).run,
    T6: (await import('./torture/t6-alloc.mjs')).run,
    T7: (await import('./torture/t7-soak.mjs')).run,
    T8: (await import('./torture/t8-cross.mjs')).run,
    T9: (await import('./torture/t9-controls.mjs')).run
};
const ORDER = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T8', 'T6', 'T7', 'T9'];

async function runTier(name, ctx) {
    const r = TIERS[name](ctx);
    return r && typeof r.then === 'function' ? await r : r;
}

// ---- control mode --------------------------------------------------------
if (controlName) {
    const control = CONTROLS[controlName];
    const ctx = buildBaseCtx(seed);
    control.apply(ctx);
    let anyFailed = false;
    for (const tierName of control.tiers) {
        const r = await runTier(tierName, ctx);
        if (r.fails.length > 0 || r.green > 0) {
            console.error('FAIL ' + tierName);
            for (const f of r.fails) console.error('  ' + f);
            if (r.green > 0) console.error('  green expected-red rows: ' + r.green);
            anyFailed = true;
        } else {
            console.error('control "' + controlName + '" left ' + tierName + ' GREEN (decorative gate)');
        }
    }
    h.stopScavengeWatch();
    process.exit(anyFailed ? 1 : 0);
}

// ---- normal run ----------------------------------------------------------
const ctx = buildBaseCtx(seed);
const allFails = [];
let totalGreen = 0;
for (const name of ORDER) {
    const r = await runTier(name, ctx);
    for (const f of r.fails) allFails.push(f);
    totalGreen += r.green;
    console.error('[' + name + '] fails=' + r.fails.length + ' green=' + r.green);
}

// MEASURE lines (stderr only)
const m = ctx.measures;
if (m.bopByLane) {
    for (const lane of m.bopByLane) {
        console.error('MEASURE B/op lane ' + lane.name + ' = ' + Number(lane.perOp).toFixed(3) +
            ' (window0 ' + Number(lane.window0).toFixed(3) + ', ' + lane.valid + ' valid)' +
            ' [gated <0.1]');
    }
}
if (m.hcbByLane) {
    for (const lane of m.hcbByLane) {
        console.error('MEASURE highestClearBit lane ' + lane.name + ' = ' + Number(lane.perOp).toFixed(3) + ' B/op' + (lane.red ? ' [expected-red: bit-31-clear boxes]' : ' [gated <0.1]'));
    }
}
if (m.sharedHasAllBop !== undefined) console.error('MEASURE shared-site sharedHasAll = ' + Number(m.sharedHasAllBop).toFixed(3) + ' B/op, sharedForEach = ' + Number(m.sharedForEachBop).toFixed(3) + ' B/op [gated <0.1]');
if (m.closureScavenges !== undefined) console.error('MEASURE forEach-closure lane scavenges over 2e6 = ' + m.closureScavenges + ' [gated <=2]');
if (m.budgetBytesPerOp !== undefined) console.error('MEASURE budget bytesPerOp = ' + m.budgetBytesPerOp + ' (diagnostic); manual-gate verdict=' + m.budgetVerdict + ' major=' + m.budgetMajor + ' maxMs=' + Number(m.budgetMaxMs).toFixed(2));
if (m.soakLive !== undefined) console.error('MEASURE soak live=' + m.soakLive + ' findings=' + m.soakFindings + ' postDrainKB=[' + (m.soakPostDrainKB || []).join(',') + '] growthKB=' + m.soakHeapGrowthKB);

h.stopScavengeWatch();

const ok = allFails.length === 0 && totalGreen === 0;
if (ok) {
    console.log('ok');
    process.exit(0);
} else {
    for (const f of allFails) console.error('TODO/FAIL ' + f);
    if (totalGreen > 0) console.error('FAIL: ' + totalGreen + ' expected-red row(s) came out green');
    console.error('seed was ' + (seed >>> 0) + ' (TORTURE_SEED=' + (seed >>> 0) + ' npm run torture to replay)');
    process.exit(1);
}
