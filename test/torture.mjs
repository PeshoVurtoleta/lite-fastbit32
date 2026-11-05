// test/torture.mjs -- node --allow-natives-syntax --expose-gc --min-semi-space-size=4 --max-semi-space-size=4 test/torture.mjs
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
//   5. young-GC detector sees      else exit 1
//   6. --allow-natives-syntax and a working TurboFan, when T6 will run
//                                  else exit 1 (T6 measures verified-optimized code)

import * as h from './torture/harness.mjs';
import { buildBaseCtx } from './torture/context.mjs';
import { CONTROLS, CONTROL_NAMES, suggest, fb1024Faithful } from './torture/controls.mjs';

// ---- guard 1: --expose-gc ------------------------------------------------
if (typeof globalThis.gc !== 'function') {
    console.error('torture: globalThis.gc is missing.');
    console.error('  remedy: node --allow-natives-syntax --expose-gc --min-semi-space-size=4 --max-semi-space-size=4 test/torture.mjs');
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

// ---- guard 6: natives + TurboFan (only when T6 will run) -----------------
// T6 forces every measured op to TurboFan and verifies it (harness
// measureBop); without --allow-natives-syntax it could only fail every lane.
// Placed after guards 4 / 5 so their exits (and test/TortureGuards.test.mjs,
// which runs non-T6 paths without the flag) keep their meaning.
if (!controlName || CONTROLS[controlName].tiers.includes('T6')) {
    const why = h.optimizationUnavailable();
    if (why !== null) {
        console.error('torture: ' + why);
        console.error('  remedy: ' + h.NATIVES_REMEDY);
        console.error('  or run: npm run torture');
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

// ---- control fidelity: the G1 / G2 mutant controls subclass a line-for-line copy
// (controls.mjs fb1024Img). With no flag set that copy must keep T0, T3 and T5
// green, so each fb1024-img / -copy / -set / -deser / -prev / -inter / -range / -remove
// control fails its tier because of its one flag, not because the copy drifted from FastBit32.js.
{
    const fctx = buildBaseCtx(seed);
    fctx.FB1024 = fb1024Faithful(fctx.FB1024);
    for (const name of ['T0', 'T3', 'T5']) {
        const r = await runTier(name, fctx);
        for (const f of r.fails) allFails.push('control fidelity (faithful fb1024Img copy) ' + f);
        totalGreen += r.green;
        console.error('[' + name + ' faithful fb1024Img copy] fails=' + r.fails.length + ' green=' + r.green);
    }
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
        console.error('MEASURE highestClearBit lane ' + lane.name + ' = ' + Number(lane.perOp).toFixed(3) + ' B/op' + (lane.red ? ' [bit-31-clear, gated <0.1]' : ' [gated <0.1]'));
    }
}
if (m.s4ByLane) {
    for (const lane of m.s4ByLane) {
        console.error('MEASURE S4 cursor/rank/equals/equalsValue/isSubsetOf/set/copy/BitMapper.bit+size lane ' + lane.name + ' = ' + Number(lane.perOp).toFixed(3) + ' B/op (window0 ' + Number(lane.window0).toFixed(3) + ', ' + lane.valid + ' valid) [gated <0.1]');
    }
}
if (m.fb1024ByLane) {
    for (const lane of m.fb1024ByLane) {
        console.error('MEASURE FastBit1024 acquire+release/has/nextClearBit/lowest/highest/cursor/hasAll/hasAny lane ' + lane.name + ' = ' + Number(lane.perOp).toFixed(3) + ' B/op (window0 ' + Number(lane.window0).toFixed(3) + ', ' + lane.valid + ' valid) [gated <0.1]');
    }
}
if (m.fb1024CountsByLane) {
    for (const lane of m.fb1024CountsByLane) {
        console.error('MEASURE FastBit1024 counts+prev (intersectionSize/unionSize/differenceSize vs sig1024 and a cap-500 set, prevSetBit walk) lane ' + lane.name + ' = ' + Number(lane.perOp).toFixed(3) + ' B/op (window0 ' + Number(lane.window0).toFixed(3) + ', ' + lane.valid + ' valid) [gated <0.1]');
    }
}
if (m.fb1024RangeByLane) {
    for (const lane of m.fb1024RangeByLane) {
        console.error('MEASURE FastBit1024 addRange/removeRange lane ' + lane.name + ' = ' + Number(lane.perOp).toFixed(3) + ' B/op (window0 ' + Number(lane.window0).toFixed(3) + ', ' + lane.valid + ' valid, ' + lane.status + ') [gated <0.1]');
    }
}
if (m.fb1024RangeCoverage) console.error('MEASURE FastBit1024 T5 range coverage ' + JSON.stringify(m.fb1024RangeCoverage) + ' [gated: rangeMulti>=3064 rangeFill>=684 rangeEmpty>=635 rangeTail>=1619 rangeNoop>=650]');
if (m.fb1024Coverage) console.error('MEASURE FastBit1024 T5 coverage ' + JSON.stringify(m.fb1024Coverage) + ' [gated: fullBig>=50 acqHigh>=10000 fullHigh>=1000 rel31>=1000 clearBig>=20]');
if (m.fb1024CountsT0) console.error('MEASURE FastBit1024 T0 prevSetBit/count laws ' + JSON.stringify(m.fb1024CountsT0) + ' [gated: 0 failed, walks>=300 diffCap>=300 sharedMiss>=100 subset>=50, <=3 top-up rounds]');
if (m.fb1024T0) console.error('MEASURE FastBit1024 T0 coverage ' + JSON.stringify(m.fb1024T0) + ' [gated: acqHigh>=100 clearBig>=3; fullBig reported only, T5 gates it]');
if (m.sharedHasAllBop !== undefined) console.error('MEASURE shared-site sharedHasAll = ' + Number(m.sharedHasAllBop).toFixed(3) + ' B/op, sharedForEach = ' + Number(m.sharedForEachBop).toFixed(3) + ' B/op [gated <0.1]');
if (m.closureScavenges !== undefined) console.error('MEASURE forEach-closure lane scavenges over 2e6 = ' + m.closureScavenges + ' [gated <=2]');
if (m.budgetBytesPerOp !== undefined) console.error('MEASURE budget bytesPerOp = ' + m.budgetBytesPerOp + ' (diagnostic); manual-gate verdict=' + m.budgetVerdict + ' major=' + m.budgetMajor + ' maxMs=' + Number(m.budgetMaxMs).toFixed(2));
if (m.fb1024ImgLanes) {
    for (const lane of m.fb1024ImgLanes) {
        console.error('MEASURE FastBit1024 image lane ' + lane.name + ' = ' + Number(lane.perOp).toFixed(3) + ' B/op (window0 ' + Number(lane.window0).toFixed(3) + ', ' + lane.valid + ' valid) [gated <0.1]');
    }
}
if (m.fb1024ImgScavenges !== undefined) console.error('MEASURE FastBit1024 image scavenge lane (saveInto+loadFrom+copy+equals) over 2e6 = ' + m.fb1024ImgScavenges + ' [gated <=2]');
if (m.fb1024ImgAlloc) {
    for (const lane of m.fb1024ImgAlloc) {
        console.error('MEASURE FastBit1024 must-fail lane ' + lane.name + ' = ' + Number(lane.perOp).toFixed(1) + ' B/op (K=512, window0 ' + Number(lane.window0).toFixed(1) + ', ' + lane.valid + ' valid) [gated >=100]');
    }
}
if (m.fb1024ImgD8) {
    const d = m.fb1024ImgD8;
    if (d.skip !== undefined) console.error('MEASURE FastBit1024 d8 pointer-compressed loadFrom lane SKIP: ' + d.skip);
    else console.error('MEASURE FastBit1024 d8 pointer-compressed loadFrom lane scavenges=' + d.loads + ' per 1e5 loads [gated <=2], box control=' + d.box + ' [gated >=2], result=' + d.result);
}
if (m.fb1024ImgT0) console.error('MEASURE FastBit1024 T0 image laws ' + JSON.stringify(m.fb1024ImgT0) + ' [gated: 0 failed, fullLoads>=20 crossLoads>=100]');
if (m.fb1024ImgT3) console.error('MEASURE FastBit1024 T3 image rows ' + JSON.stringify(m.fb1024ImgT3) + ' [gated: 0 failed]');
if (m.fb1024Sab) console.error('MEASURE FastBit1024 T3 SAB row ' + JSON.stringify(m.fb1024Sab) + ' [gated: br 0, torn>=20 per scenario, deserialize hits>=64, cap500 tail hits>=8, <=64 chunks, rounds>=10]');
if (m.fb1024ImgLive) console.error('MEASURE FastBit1024 T7 image retention live per cycle=[' + m.fb1024ImgLive.join(',') + '] [gated: 0 each]');
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
