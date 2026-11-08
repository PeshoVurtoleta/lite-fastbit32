// test/torture/t6-fb64-noinline.mjs -- B-S4 (PLAN-fastbit64-B task 6): the T6
// FastBit64 lane table in a CHILD process under --no-turbo-inlining.
//
// Spawned by t6-alloc.mjs fb64NoinlineLane with the torture flags
// (--allow-natives-syntax --expose-gc --min-semi-space-size=4
// --max-semi-space-size=4) plus --no-turbo-inlining, env FB64_VARIANT=kexport.
// It builds that variant (fb64-variants.mjs; kexport exports the private
// kernels so they can be verified TurboFan too), runs the SAME FB64_LANES table
// (fb64-lanes.mjs, unchanged) on fb64Fixture(variant class) through harness
// measureBop with callees = the class's methods + fb64LaneCallees(f) + the
// exported kernels, and prints exactly ONE stdout line `RESULT <json>`.
// The parent gates it (this child gates nothing and never poisons feedback:
// the ONE FastBit64 poisoning call site is t6-alloc.mjs fb64Poison, A5).
//
// RESULT fields: execArgv, variant, v8, pins (semi-space pins ok), lanes
// [{ name, control, perOp, window0, valid, status }] (NaN -> JSON null; the
// parent reads a non-number as NaN, never 0), moved (fb64FixtureMoved after the
// table, null = unmoved), kernels (names in the callee list), kernelsTurbofan
// (names whose status carries the TurboFan bit after the table), fails (build /
// setup rows). Output goes through a write callback and process.exitCode, never
// a bare process.exit after a pending write (CI-3).

import * as h from './harness.mjs';
import { fb64Variant, KEXPORT_KERNELS } from './fb64-variants.mjs';
import { FB64_LANES, fb64Fixture, fb64LaneCallees, fb64FixtureMoved } from './fb64-lanes.mjs';

const res = {
    execArgv: process.execArgv.slice(),
    variant: process.env.FB64_VARIANT === undefined ? null : process.env.FB64_VARIANT,
    v8: process.versions.v8,
    pins: h.pinsOk(h.semiSpacePins()),
    lanes: [],
    moved: null,
    kernels: [],
    kernelsTurbofan: [],
    fails: []
};

function threw(e) { return (e && e.constructor ? e.constructor.name : typeof e) + ': ' + (e && e.message); }

// TurboFan bit of f after the table, in the V8 14 layout (cold; natives were
// already proven available by measureBop, else every lane carries the reason).
function turbofan(f) {
    const L = h.statusLayout();
    if (L === null || L.shift === null) return false;
    const raw = new Function('f', 'return %GetOptimizationStatus(f);');
    return (h.normalizeStatus(raw(f), L.shift) & h.OPT_TURBOFAN) !== 0;
}

async function main() {
    if (res.variant === null) { res.fails.push('FB64_VARIANT is not set'); return; }
    let v;
    try { v = await fb64Variant(res.variant); } catch (e) { res.fails.push('variant ' + res.variant + ' build threw ' + threw(e)); return; }
    for (const f of v.fails) res.fails.push(f);
    if (v.C === null) { if (v.fails.length === 0) res.fails.push('variant ' + res.variant + ' not built'); return; }
    const C = v.C;
    const kernels = [];
    for (const k of KEXPORT_KERNELS) {
        if (v.mod !== null && typeof v.mod[k] === 'function') { kernels.push(v.mod[k]); res.kernels.push(k); }
    }
    h.startScavengeWatch();
    try {
        const SINK = h.SINK;
        const baseline = (i) => { SINK[0] = i | 0; };
        const tf = fb64Fixture(C, SINK);                      // throwaway first closures
        for (const L of FB64_LANES) L.op(tf);
        const f = fb64Fixture(C, SINK);
        const built = fb64FixtureMoved(f);
        if (built !== null) res.fails.push('fixture built off the int32 word contract: ' + built);
        const callees = [...h.collectMethods(C), ...fb64LaneCallees(f), ...kernels];
        for (const L of FB64_LANES) {
            const m = await h.measureBop(L.op(f), baseline, { callees });
            res.lanes.push({ name: L.name, control: L.control === true, perOp: m.perOp, window0: m.window0, valid: m.valid, status: m.status });
            if (res.moved === null && built === null) {
                const mv = fb64FixtureMoved(f);
                if (mv !== null) res.moved = 'after lane ' + L.name + ': ' + mv;
            }
        }
        for (let i = 0; i < kernels.length; i++) if (turbofan(kernels[i])) res.kernelsTurbofan.push(res.kernels[i]);
    } finally {
        h.stopScavengeWatch();
    }
}

try { await main(); } catch (e) { res.fails.push('child threw ' + threw(e)); }
process.stdout.write('RESULT ' + JSON.stringify(res) + '\n', () => { process.exitCode = 0; });
