// test/torture/t6-fb32-noinline.mjs -- AF-1 (PLAN-af1 task 9): FastBit32
// countRange B/op in a CHILD process under --no-turbo-inlining.
//
// Spawned by t6-alloc.mjs fb32NoinlineLane with the torture flags
// (--allow-natives-syntax --expose-gc --min-semi-space-size=4
// --max-semi-space-size=4) plus --no-turbo-inlining, argv[2] = the absolute
// path of the FastBit32.js under test. Under that flag countRange calls
// countMasked out of line, so a mask that is not an int32 (the de9a5d9 body's
// trailing `>>> 0` makes it a uint32 >= 2^31 whenever bit 31 is in range) is
// one HeapNumber per call. Lanes, in order:
//   countRange(i & 15, 31)  on new FB(0).union(0xA5A5A5A5 | 0)   (bit 31 in range)
//   countRange(0, 15)       same instance                         (bit 31 out of range)
//   witness                 OldCountRangeWitness below, countRange(i & 15, 31)
// The witness is a byte copy of de9a5d9's constructor + countMasked +
// countRange in its own class: it MUST box (the parent gates it >= 15.9 B/op),
// proof every run that this child can see the box the live lanes must not have.
// Each lane goes through harness measureBop with callees = [countRange,
// countMasked] of its class; after the lane both callees must carry the
// TurboFan bit (calleesTurbofan), else the run measured something else.
// Prints exactly ONE stdout line `RESULT <json>`; the parent gates it (this
// child gates nothing and never poisons feedback).
//
// RESULT fields: execArgv, target (argv[2] as given), v8, pins (semi-space
// pins ok), lanes [{ name, perOp, window0, valid, status, calleesTurbofan }]
// (NaN -> JSON null; the parent reads a non-number as NaN, never 0), moved
// (null = no lane word moved), fails (load / build / oracle rows). Output goes
// through a write callback and process.exitCode, never a bare process.exit
// after a pending write (CI-3).

import { pathToFileURL } from 'node:url';
import * as h from './harness.mjs';

// byte copy of de9a5d9 (FastBit32.js 95ab856e) :31-33, :103-108, :204-207
class OldCountRangeWitness {
    constructor(initial = 0) {
        this.value = initial >>> 0;
    }

    countMasked(mask) {
        let v = this.value & mask;
        v = v - ((v >>> 1) & 0x55555555);
        v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
        return Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
    }

    countRange(start, end) {
        const mask = ((0xFFFFFFFF >>> (31 - (end - start))) << start) >>> 0;
        return this.countMasked(mask);
    }
}

const WORD = 0xA5A5A5A5 | 0;     // int32 with bit 31 set
const LANE_NAMES = ['countRange(i & 15, 31)', 'countRange(0, 15)', 'witness de9a5d9 countRange(i & 15, 31)'];

const res = {
    execArgv: process.execArgv.slice(),
    target: process.argv[2] === undefined ? null : process.argv[2],
    v8: process.versions.v8,
    pins: h.pinsOk(h.semiSpacePins()),
    lanes: [],
    moved: null,
    fails: []
};

function threw(e) { return (e && e.constructor ? e.constructor.name : typeof e) + ': ' + (e && e.message); }

// TurboFan bit of f after a lane, in the V8 14 layout (cold).
function turbofan(f) {
    const L = h.statusLayout();
    if (L === null || L.shift === null) return false;
    const raw = new Function('f', 'return %GetOptimizationStatus(f);');
    return (h.normalizeStatus(raw(f), L.shift) & h.OPT_TURBOFAN) !== 0;
}

// oracle: set bits of w in [start, end], by a bit loop (no mask arithmetic)
function popRange(w, start, end) {
    let n = 0;
    for (let b = start; b <= end; b++) if (((w >>> b) & 1) === 1) n++;
    return n;
}

// module-scope op factories; each is called once with a throwaway instance
// first, so no measured op is specialized on its context
function hiOp(SINK, inst) { return (i) => { SINK[0] = inst.countRange(i & 15, 31) | 0; }; }
function loOp(SINK, inst) { return (i) => { SINK[0] = inst.countRange(0, 15) | 0; }; }
function witnessHiOp(SINK, inst) { return (i) => { SINK[0] = inst.countRange(i & 15, 31) | 0; }; }

async function main() {
    if (res.target === null) { res.fails.push('argv[2] (target FastBit32.js path) is not set'); return; }
    let M;
    try { M = await import(pathToFileURL(res.target).href); } catch (e) { res.fails.push('import of ' + res.target + ' threw ' + threw(e)); return; }
    const FB = M.FastBit32;
    if (typeof FB !== 'function') { res.fails.push(res.target + ' exports no FastBit32 class'); return; }
    const W = OldCountRangeWitness;
    const SINK = h.SINK;
    const inst = new FB(0).union(WORD);
    const wit = new W(WORD);
    const wWant = WORD >>> 0;
    if (!Object.is(inst.value, WORD)) { res.fails.push('live lane word built ' + inst.value + ' (want int32 ' + WORD + ')'); return; }
    if (!Object.is(wit.value, wWant)) { res.fails.push('witness lane word built ' + wit.value + ' (want uint32 ' + wWant + ')'); return; }
    for (let s = 0; s < 16; s++) {
        const want = popRange(WORD, s, 31);
        if (inst.countRange(s, 31) !== want) res.fails.push('oracle: live countRange(' + s + ', 31) = ' + inst.countRange(s, 31) + ' (want ' + want + ')');
        if (wit.countRange(s, 31) !== want) res.fails.push('oracle: witness countRange(' + s + ', 31) = ' + wit.countRange(s, 31) + ' (want ' + want + ')');
    }
    if (inst.countRange(0, 15) !== popRange(WORD, 0, 15)) res.fails.push('oracle: live countRange(0, 15) = ' + inst.countRange(0, 15) + ' (want ' + popRange(WORD, 0, 15) + ')');
    if (res.fails.length !== 0) return;
    hiOp(SINK, new FB(0)); loOp(SINK, new FB(0)); witnessHiOp(SINK, new W(0));   // throwaway first closures
    const liveCallees = [FB.prototype.countRange, FB.prototype.countMasked];
    const witCallees = [W.prototype.countRange, W.prototype.countMasked];
    const table = [
        [hiOp(SINK, inst), liveCallees, inst, WORD],
        [loOp(SINK, inst), liveCallees, inst, WORD],
        [witnessHiOp(SINK, wit), witCallees, wit, wWant]
    ];
    const baseline = (i) => { SINK[0] = i | 0; };
    h.startScavengeWatch();
    try {
        for (let li = 0; li < table.length; li++) {
            const [op, callees, o, want] = table[li];
            const m = await h.measureBop(op, baseline, { callees });
            let tf = 0;
            for (let k = 0; k < callees.length; k++) if (turbofan(callees[k])) tf++;
            res.lanes.push({ name: LANE_NAMES[li], perOp: m.perOp, window0: m.window0, valid: m.valid, status: m.status, calleesTurbofan: tf });
            if (res.moved === null && !Object.is(o.value, want)) res.moved = 'after lane ' + LANE_NAMES[li] + ': word ' + o.value + ' (want ' + want + ')';
        }
    } finally {
        h.stopScavengeWatch();
    }
}

try { await main(); } catch (e) { res.fails.push('child threw ' + threw(e)); }
process.stdout.write('RESULT ' + JSON.stringify(res) + '\n', () => { process.exitCode = 0; });
