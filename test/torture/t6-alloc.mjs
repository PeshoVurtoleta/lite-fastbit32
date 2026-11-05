// test/torture/t6-alloc.mjs -- the zero-alloc gate.
//
//   Budget lane (C1): the GATE is a manual GcProfiler over the hot mix,
//     checkNoGc(summary, {maxMajor:0, maxPauseMs:4}) AFTER an awaited settle so
//     the PerformanceObserver has delivered its GC entries. The budget-major
//     control fires one gc() in the mix -> a major and/or a > 4ms pause -> fail.
//
//   Blind-measureOps pin (ROADMAP "Upstream gaps"): measureOps with a gc()
//     injected in its steady phase STILL reports verdict 'pass' / major 0 (its
//     summary is built before the observer fires). Pinned here so if a
//     lite-gc-profiler release fixes it, this pin goes red and must be flipped
//     on purpose (and the budget gate can then move onto measureOps).
//
//   Steady-state B/op lane (C9): new-space delta over K ops (windows that
//     scavenged are discarded, read after an awaited settle), min over windows
//     1..7, minus an empty-loop baseline. SIGNED lanes are built THROUGH A
//     MUTATOR (new FB(0).union(int32)) so the stored word is a real signed int32,
//     asserted === LANE_INT32 both BEFORE and AFTER the measurement. The
//     composite hot surface uses a WORD-PRESERVING mutator pair (toggle b;
//     toggle b) so the lane word never collapses to 0. UNSIGNED double lanes are
//     READ-ONLY (a mutator would coerce them to int32); their value is re-checked
//     unchanged. EVERY lane (signed and unsigned) is gated < 0.1 B/op -- the
//     threshold never changes under a control. highestClearBit has its own lane
//     per signed word, gated < 0.1 on bit-31-SET and bit-31-CLEAR words alike
//     (until S3 / 1.3.0 the bit-31-clear rows were EXPECTED-RED at ~32 B/op:
//     the 1.2.1 body's `~value >>> 0` boxed; the branchless body does not). The shared megamorphic
//     call site is measured (sharedHasAll + sharedForEach), gated < 0.1. Every
//     comparison is NaN-fails-closed (`valid < 3 || !(perOp < 0.1)`).
//
//   S5 Tier-2 lane (1.5.0): select + the two statics on every key-matrix lane,
//     gated < 0.1 B/op like the S4 lane; the bop-box control turns it red.
//
//   Closure scavenge lane: the ROADMAP FB-11 shape forEach(b => a += b + i)
//     through the real forEach. Module-scope callback churns 0; a per-op closure
//     (foreach-closure control) churns dozens. Gate <= 2.

import { measureOps, GcProfiler, checkNoGc } from '@zakkster/lite-gc-profiler';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MASK = 0x0F0F0F0F;       // int32 mask (no bit 31): signedness-safe
// a lane whose code was not verified-optimized names the reason (cold path)
const optNote = (m) => (m.status === 'optimized' ? '' : ' -- ' + m.status);
const BOX = [{}];              // tagged-elements array: forces a HeapNumber box

// ---- T6-FIX2 feedback-poisoning pre-pass (harness poisonCallFeedback) ------
// One row per FB method that feeds this.value to a Math.* call: [name, args
// source] (args see only literals and `cb`, the harness no-op callback that
// forEach gets). The rows must equal harness mathFieldCensus(ctx.FB) both
// ways -- a method added or removed without its row fails T6 closed. The
// census excludes `constructor` explicitly (its source is the class text).
const POISON_ROWS = [
    ['count', ''],
    ['countMasked', '0x0F0F0F0F'],
    ['lowest', ''],
    ['highest', ''],
    ['forEach', 'cb'],
    ['nextClearBit', ''],
    ['highestClearBit', ''],
    ['nextSetBit', '0'],
    ['prevSetBit', '31'],
    ['rank', '31'],
    ['toArray', '']
];

// The poison witness: a byte copy of the 9f57c7c (1.6.0) FastBit32
// constructor + highest in its own class. After the same pre-pass (tag
// 'witness') its unsigned lanes MUST read >= 15.9 B/op (the old body boxes
// through the poisoned clz32 slot) and its 0x40000000 lane < 0.1 (an int32
// passes as a Smi): proof, every run, that the pre-pass mechanism poisons a
// clz32 slot on this V8. It is a fresh class, so it does NOT see FB's feedback
// history (R1, the 1.6.0 body in a full run, is the check for that).
class OldHighestWitness {
    constructor(initial = 0) {
        this.value = initial >>> 0;
    }

    highest() {
        return 31 - Math.clz32(this.value);
    }
}
const WITNESS_LANES = new Float64Array([0xFFFFFFFF, 2 ** 31, 0x40000000]);
const WITNESS_NAMES = ['0xFFFFFFFF', '2**31', '0x40000000'];

// Measured ops come from module-scope factories, each called once with a
// throwaway instance before its first measured lane: the op literal's
// feedback cell is then "many closures", so TurboFan cannot specialize a
// measured op on its context (the first closure of a literal would fold
// `inst.value` to a constant and read 0 B/op even through a poisoned slot --
// orch-confirm: 2**31 first = -0.017, 0xFFFFFFFF second = 16.000).
function witnessOp(h, inst) {
    return (i) => { h.SINK[0] = inst.highest() | 0; };
}

// composite ops: bodies identical to the pre-T6-FIX2 inline literals
function compositeSigned(h, inst, bopBox) {
    return (i) => {
        const b = i & 31;
        h.SINK[0] = inst.count() | 0;
        h.SINK[1] = inst.lowest() | 0;
        h.SINK[2] = inst.highest() | 0;
        h.SINK[3] = inst.nextClearBit() | 0;
        h.SINK[0] = inst.has(b) ? 1 : 0;
        h.SINK[1] = inst.hasAll(MASK) ? 1 : 0;
        h.SINK[2] = inst.hasAny(MASK) ? 1 : 0;
        h.SINK[3] = inst.hasNone(MASK) ? 1 : 0;
        h.SINK[0] = inst.countMasked(MASK) | 0;
        h.SINK[1] = inst.countRange(0, 15) | 0;
        inst.toggle(b); inst.toggle(b);           // WORD-PRESERVING
        if (bopBox) { BOX[0] = i + 0.5; h.SINK[2] = BOX[0] | 0; }
    };
}

function compositeUnsigned(h, inst, bopBox) {
    return (i) => {                                     // unsigned: READ-ONLY
        const b = i & 31;
        h.SINK[0] = inst.count() | 0;
        h.SINK[1] = inst.lowest() | 0;
        h.SINK[2] = inst.highest() | 0;
        h.SINK[3] = inst.nextClearBit() | 0;
        h.SINK[0] = inst.has(b) ? 1 : 0;
        h.SINK[1] = inst.hasAll(MASK) ? 1 : 0;
        h.SINK[2] = inst.hasAny(MASK) ? 1 : 0;
        h.SINK[3] = inst.hasNone(MASK) ? 1 : 0;
        h.SINK[0] = inst.countMasked(MASK) | 0;
        h.SINK[1] = inst.countRange(0, 15) | 0;
        if (bopBox) { BOX[0] = i + 0.5; h.SINK[2] = BOX[0] | 0; }
    };
}

export async function run(ctx) {
    const FB = ctx.FB;
    const h = ctx.h;
    const fails = [];
    let green = 0;
    const measures = ctx.measures;

    // ---- budget lane: manual GcProfiler is the gate -------------------------
    const budgetInst = new FB(0xA5A5A5A5);
    const bm = ctx.control.budgetMajor === true;
    const mix = (i) => {
        budgetInst.add(i & 31);
        budgetInst.toggle((i >> 1) & 31);
        h.SINK[0] = budgetInst.count() | 0;
        h.SINK[1] = budgetInst.lowest() | 0;
        budgetInst.remove(i & 31);
        if (bm && i > 0 && (i % 40000) === 0) globalThis.gc();
    };
    // diagnostic only (NOT a gate): bytesPerOp
    const r = measureOps(mix, { ops: 200000, warmup: 20000, stabilize: 'deep' });
    measures.budgetBytesPerOp = r.bytesPerOp;
    // the real gate: manual profiler + awaited settle + checkNoGc
    {
        const p = new GcProfiler().start();
        for (let i = 0; i < 200000; i++) mix(i);
        await h.settle(50);
        const s = p.summary();
        p.stop();
        const g = checkNoGc(s, { maxMajor: 0, maxPauseMs: 4 });
        measures.budgetMajor = s.gc.major;
        measures.budgetMaxMs = s.gc.maxMs;
        measures.budgetVerdict = g.verdict;
        if (g.verdict !== 'pass') {
            fails.push('T6 budget: checkNoGc ' + g.verdict + ' (major=' + s.gc.major + ' maxMs=' + s.gc.maxMs.toFixed(2) + ')');
        }
    }

    // ---- blind-measureOps pin (expected-blind; see ROADMAP Upstream gaps) ---
    {
        const bi = new FB(0x5A5A5A5A);
        const blindMix = (i) => {
            bi.add(i & 31); bi.toggle((i >> 1) & 31);
            h.SINK[0] = bi.count() | 0; bi.remove(i & 31);
            if (i > 0 && (i % 40000) === 0) globalThis.gc(); // injected collection
        };
        const br = measureOps(blindMix, { ops: 200000, warmup: 20000, stabilize: 'deep' });
        const bg = checkNoGc(br.summary, { phases: { steady: { maxMajor: 0 } } });
        measures.blindVerdict = bg.verdict;
        measures.blindMajor = br.summary.gc.major;
        // S0 behaviour: measureOps is BLIND to the injected gc() -> pass / 0.
        // If that changes (upstream fix), this fails -> flip the pin on purpose
        // and move the budget gate onto measureOps.
        if (!(bg.verdict === 'pass' && br.summary.gc.major === 0)) {
            fails.push('T6 blind-pin: measureOps now SEES an injected steady gc() (verdict=' + bg.verdict + ' major=' + br.summary.gc.major + ') -- upstream fixed, flip the pin');
        }
    }

    // ---- shared call site warmup (megamorphic) ------------------------------
    h.warmShared(FB);
    function sinkCb(bit) { h.SINK[3] = bit; }
    const baseline = (i) => { h.SINK[0] = i | 0; };
    const bopBox = ctx.control.bopBox === true;
    // Verified optimization (harness measureBop): every lane's op, the baseline
    // and EVERY function an op can reach -- all methods / getters / statics of
    // FB, FB1024, BitMapper and the look-alikes, the shared call sites and
    // sinkCb -- are forced to TurboFan and verified before and after each
    // window; an unverified lane fails closed with the reason. bop-unoptimized
    // withholds optimization of each op and MUST fail every lane that way.
    const bopOpts = {
        callees: [...h.collectMethods(FB, ctx.FB1024, ctx.Mapper, ...h.LOOKALIKES), h.sharedHasAll, h.sharedForEach, sinkCb],
        withhold: ctx.control.bopUnoptimized === true ? true : (ctx.control.bopUnoptimizedCallee === true ? 'callee' : false)
    };
    const bopOpt = { lanes: 0, verified: 0, tracked: 2 + bopOpts.callees.length, first: null };
    measures.bopOpt = bopOpt;
    const bop = async (op, opts = bopOpts) => {
        const m = await h.measureBop(op, baseline, opts);
        bopOpt.lanes++;
        if (m.status === 'optimized') bopOpt.verified++;
        else if (bopOpt.first === null) bopOpt.first = m.status;
        return m;
    };

    // ---- T6-FIX2 pre-pass: census check, then poison FB and the witness ----
    // Setup only (no window is open): census + callers allocate here, never in
    // a measured window. measures.poison holds strings / ints only.
    const census = h.mathFieldCensus(FB);
    const rowNames = POISON_ROWS.map((r) => r[0]);
    const missing = census.filter((n) => !rowNames.includes(n));
    const extra = rowNames.filter((n) => !census.includes(n));
    if (missing.length > 0 || extra.length > 0) {
        fails.push('T6 poison census: POISON_ROWS != mathFieldCensus(FB) (constructor excluded): missing rows [' + missing.join(',') + '], rows not in the census [' + extra.join(',') + '] -- fail closed');
    }
    const pz = h.poisonCallFeedback(FB, POISON_ROWS, 't6poison_fb');
    if (pz.fail !== null) fails.push('T6 poison pre-pass: ' + pz.fail);
    const pw = h.poisonCallFeedback(OldHighestWitness, [['highest', '']], 't6poison_witness');
    if (pw.fail !== null) fails.push('T6 poison pre-pass (witness): ' + pw.fail);
    measures.poison = {
        rows: POISON_ROWS.length | 0,
        census: census.length | 0,
        censusNames: census.join(','),
        maglev: pz.maglev | 0,
        deopted: pz.deopted.join(','),
        witnessMaglev: pw.maglev | 0,
        witnessDeopted: pw.deopted.join(','),
        fail: (pz.fail === null ? '' : pz.fail) + (pw.fail === null ? '' : (pz.fail === null ? '' : ' | ') + pw.fail)
    };
    console.error('MEASURE T6 poison pre-pass rows=' + POISON_ROWS.length + ' census=' + census.length + ' (constructor excluded) maglev=' + pz.maglev + '/' + POISON_ROWS.length +
        ' deopted=[' + measures.poison.deopted + ']; witness maglev=' + pw.maglev + '/1 deopted=[' + measures.poison.witnessDeopted + '] [gated: rows == census both ways, every caller Maglev-compiled]');

    // ---- poison witness (1.6.0 highest body), measured before the composite lane
    const witnessOpts = { callees: [...bopOpts.callees, OldHighestWitness.prototype.highest], withhold: bopOpts.withhold };
    witnessOp(h, new OldHighestWitness(0));                // throwaway first closure
    const witnessByLane = [];
    for (let li = 0; li < WITNESS_LANES.length; li++) {
        const inst = new OldHighestWitness(WITNESS_LANES[li]);
        const m = await bop(witnessOp(h, inst), witnessOpts);
        const boxes = li < 2;                              // unsigned lanes box, 0x40000000 does not
        witnessByLane.push({ name: WITNESS_NAMES[li], perOp: m.perOp, window0: m.window0, valid: m.valid, boxes });
        console.error('MEASURE T6 poison witness (1.6.0 highest body, poisoned slot) lane ' + WITNESS_NAMES[li] + ' = ' + Number(m.perOp).toFixed(3) + ' B/op (window0 ' + Number(m.window0).toFixed(3) + ', ' + m.valid + ' valid, ' + m.status + ') [gated ' + (boxes ? '>=15.9' : '<0.1') + ']');
        if (boxes) {
            if (m.valid < 3 || !(m.perOp >= 15.9)) fails.push('T6 poison witness: lane ' + WITNESS_NAMES[li] + ' = ' + Number(m.perOp).toFixed(3) + ' B/op, valid=' + m.valid + ' (expected >= 15.9, >= 3 valid: the 1.6.0 highest body boxes through a poisoned clz32 slot) -- the pre-pass did not take' + optNote(m));
        } else if (m.valid < 3 || !(m.perOp < 0.1)) {
            fails.push('T6 poison witness: lane ' + WITNESS_NAMES[li] + ' = ' + Number(m.perOp).toFixed(3) + ' B/op, valid=' + m.valid + ' (expected < 0.1, >= 3 valid: an int32 passes a poisoned slot as a Smi)' + optNote(m));
        }
    }
    measures.witnessByLane = witnessByLane;

    // ---- per-lane composite B/op (signed gated, unsigned read-only/printed) -
    const bopByLane = [];
    compositeSigned(h, new FB(0), bopBox);                 // throwaway first closures
    compositeUnsigned(h, new FB(0), bopBox);
    for (let li = 0; li < h.LANE_VALUES.length; li++) {
        const signed = h.LANE_SIGNED[li] === 1;
        const want = signed ? h.LANE_INT32[li] : h.LANE_VALUES[li];
        const inst = signed ? new FB(0).union(h.LANE_INT32[li]) : new FB(h.LANE_VALUES[li]);
        if (!Object.is(inst.value, want)) {
            fails.push('T6 B/op: lane ' + h.LANE_NAMES[li] + ' built value ' + inst.value + ' !== ' + want + ' (fail closed)');
            continue;
        }
        const op = signed ? compositeSigned(h, inst, bopBox) : compositeUnsigned(h, inst, bopBox);
        const m = await bop(op);
        if (!Object.is(inst.value, want)) {
            fails.push('T6 B/op: lane ' + h.LANE_NAMES[li] + ' value moved to ' + inst.value + ' during measurement (expected ' + want + ')');
        }
        bopByLane.push({ name: h.LANE_NAMES[li], perOp: m.perOp, window0: m.window0, valid: m.valid, signed });
        // EVERY lane is gated < 0.1 B/op (clean lanes read within +/-0.02; the
        // threshold must not change under a control). The bop-box control injects
        // one HeapNumber per op -> ~16 B/op -> every lane fails.
        if (m.valid < 3 || !(m.perOp < 0.1)) {
            fails.push('T6 B/op: ' + (signed ? 'SIGNED' : 'unsigned') + ' lane ' + h.LANE_NAMES[li] + ' = ' + Number(m.perOp).toFixed(3) + ' B/op, valid=' + m.valid + ' (expected < 0.1, >= 3 valid)' + optNote(m));
        }
    }
    measures.bopByLane = bopByLane;

    // ---- highestClearBit: gated < 0.1 on bit-31-set AND bit-31-clear words --
    const hcbByLane = [];
    for (let li = 0; li < 4; li++) {           // signed lanes only
        const inst = new FB(0).union(h.LANE_INT32[li]);
        const bit31Clear = ((inst.value >>> 31) & 1) === 0; // ~value has bit 31 -> boxes
        const op = (i) => { h.SINK[0] = inst.highestClearBit() | 0; };
        const m = await bop(op);
        hcbByLane.push({ name: h.LANE_NAMES[li], perOp: m.perOp, valid: m.valid, red: bit31Clear });
        if (m.valid < 3) { fails.push('T6 hcb: lane ' + h.LANE_NAMES[li] + ' had < 3 valid windows (NaN fails closed)' + optNote(m)); continue; }
        // Flipped in S3 (FB-09): the bit-31-clear rows were expected-red
        // (~32 B/op) under the 1.2.1 `~value >>> 0` body; now every row is gated.
        if (!(m.perOp < 0.1)) fails.push('T6 hcb: bit-31-' + (bit31Clear ? 'clear' : 'set') + ' lane ' + h.LANE_NAMES[li] + ' = ' + Number(m.perOp).toFixed(3) + ' B/op (expected < 0.1)' + optNote(m));
    }
    measures.hcbByLane = hcbByLane;

    // ---- S4 Tier-1 lane: cursor loop, rank, equals, equalsValue, isSubsetOf, set, copy, BitMapper.bit/size --
    // Every key-matrix lane (signed AND unsigned). `inst` is READ-ONLY (its
    // value is re-checked unchanged); set/copy write a scratch instance, so the
    // unsigned lanes are measured too. Gated < 0.1 B/op, NaN fails closed.
    const s4ByLane = [];
    const scratch = new FB(0);
    const S4_NAMES = [];                                   // built once, cold
    for (let n = 0; n < 32; n++) S4_NAMES.push('c' + n);
    const s4Mapper = new ctx.Mapper(S4_NAMES);
    for (let li = 0; li < h.LANE_VALUES.length; li++) {
        const signed = h.LANE_SIGNED[li] === 1;
        const want = signed ? h.LANE_INT32[li] : h.LANE_VALUES[li];
        const inst = signed ? new FB(0).union(h.LANE_INT32[li]) : new FB(h.LANE_VALUES[li]);
        const twin = signed ? new FB(h.LANE_VALUES[li]) : new FB(0).union(h.LANE_VALUES[li] | 0);
        const op = (i) => {
            let acc = 0;
            for (let b = inst.nextSetBit(0); b !== -1; b = inst.nextSetBit(b + 1)) acc = (acc + b) | 0;
            h.SINK[0] = acc;
            h.SINK[2] = inst.rank(i & 31) | 0;
            h.SINK[3] = (inst.equals(twin) ? 1 : 0) | (inst.isSubsetOf(MASK) ? 2 : 0);
            scratch.set(inst.value);
            scratch.copy(inst);
            // every result reaches a sink (no dead store): prevSetBit, equalsValue,
            // BitMapper.bit (Map lookup + shift) and BitMapper.size (getter)
            h.SINK[1] = (inst.prevSetBit(i & 31) | 0) ^ (scratch.equalsValue(inst.value) ? 64 : 0) ^
                s4Mapper.bit(S4_NAMES[i & 31]) ^ s4Mapper.size;
            if (bopBox) { BOX[0] = i + 0.5; h.SINK[2] = BOX[0] | 0; }
        };
        const m = await bop(op);
        if (!Object.is(inst.value, want)) {
            fails.push('T6 S4: lane ' + h.LANE_NAMES[li] + ' value moved to ' + inst.value + ' during measurement (expected ' + want + ')');
        }
        s4ByLane.push({ name: h.LANE_NAMES[li], perOp: m.perOp, window0: m.window0, valid: m.valid, signed });
        if (m.valid < 3 || !(m.perOp < 0.1)) {
            fails.push('T6 S4: lane ' + h.LANE_NAMES[li] + ' = ' + Number(m.perOp).toFixed(3) + ' B/op, valid=' + m.valid + ' (expected < 0.1, >= 3 valid)' + optNote(m));
        }
    }
    measures.s4ByLane = s4ByLane;

    // ---- S5 Tier-2 lane: select, static nextSubset, static nextCombination --
    // Every key-matrix lane (signed AND unsigned). `inst` is READ-ONLY (value
    // re-checked unchanged). select(i % 33) sweeps k = 0..32 (32 is past every
    // count but the full word's: the -1 sentinel path). The static walk state
    // lives in an Int32Array(2) so nothing boxes: S5W[0] walks the submasks of
    // the lane word (nextSubset(0, m) wraps to m, so it cycles), S5W[1] walks
    // the 3-of-32 combinations from 7 and restarts at 7 on the 0 sentinel
    // (bit-31 words included). nextCombination(inst.value) feeds the raw lane
    // word (an unsigned double on the unsigned lanes). Gated < 0.1 B/op, >= 3
    // valid windows, NaN fails closed. The MEASURE line is printed here.
    const s5ByLane = [];
    const S5W = new Int32Array(2);
    for (let li = 0; li < h.LANE_VALUES.length; li++) {
        const signed = h.LANE_SIGNED[li] === 1;
        const want = signed ? h.LANE_INT32[li] : h.LANE_VALUES[li];
        const inst = signed ? new FB(0).union(h.LANE_INT32[li]) : new FB(h.LANE_VALUES[li]);
        S5W[0] = 0;
        S5W[1] = 7;
        const op = (i) => {
            h.SINK[0] = inst.select(i % 33);
            S5W[0] = FB.nextSubset(S5W[0], inst.value);
            const nc = FB.nextCombination(S5W[1]);
            S5W[1] = nc === 0 ? 7 : nc;
            h.SINK[1] = S5W[0] ^ nc;
            h.SINK[3] = FB.nextCombination(inst.value);
            if (bopBox) { BOX[0] = i + 0.5; h.SINK[2] = BOX[0] | 0; }
        };
        const m = await bop(op);
        if (!Object.is(inst.value, want)) {
            fails.push('T6 S5: lane ' + h.LANE_NAMES[li] + ' value moved to ' + inst.value + ' during measurement (expected ' + want + ')');
        }
        s5ByLane.push({ name: h.LANE_NAMES[li], perOp: m.perOp, window0: m.window0, valid: m.valid, signed });
        if (m.valid < 3 || !(m.perOp < 0.1)) {
            fails.push('T6 S5: lane ' + h.LANE_NAMES[li] + ' = ' + Number(m.perOp).toFixed(3) + ' B/op, valid=' + m.valid + ' (expected < 0.1, >= 3 valid)' + optNote(m));
        }
    }
    measures.s5ByLane = s5ByLane;
    for (const lane of s5ByLane) {
        console.error('MEASURE S5 select/nextSubset/nextCombination lane ' + lane.name + ' = ' + Number(lane.perOp).toFixed(3) + ' B/op (window0 ' + Number(lane.window0).toFixed(3) + ', ' + lane.valid + ' valid) [gated <0.1]');
    }

    // ---- S4b FastBit1024 lane: acquire+release, has, nextClearBit, lowest,
    // highest, the nextSetBit cursor loop, hasAll/hasAny. Two pool shapes: the
    // one free slot in word 0 (slot 5) and in word 31 (slot 1000); every other
    // word is full (bit 31 set in every word). The pool snapshot is re-checked
    // unchanged after the measurement. Gated < 0.1 B/op, NaN fails closed.
    const fb1024ByLane = [];
    const C1024 = ctx.FB1024;
    const sig1024 = new C1024().add(0).add(31).add(63).add(992).add(1023);
    for (const freeSlot of [5, 1000]) {
        const pool = new C1024();
        for (let i = 0; i < 1024; i++) if (i !== freeSlot) pool.add(i);
        const snap = ctx.oracle.fb1024Snapshot(pool);
        const op = (i) => {
            const x = pool.acquire();
            pool.release(x);
            let acc = x ^ (pool.has(i & 1023) ? 1 : 0) ^ pool.nextClearBit() ^ pool.lowest() ^ pool.highest();
            for (let b = sig1024.nextSetBit(0), n = 0; b !== -1 && n <= 1024; b = sig1024.nextSetBit(b + 1), n++) acc = (acc + b) | 0; // bounded: a wrapping cursor must not hang T6
            h.SINK[0] = acc ^ (pool.hasAll(sig1024) ? 2 : 0) ^ (pool.hasAny(sig1024) ? 4 : 0);
            if (bopBox) { BOX[0] = i + 0.5; h.SINK[2] = BOX[0] | 0; }
        };
        const m = await bop(op);
        const name = 'free slot ' + freeSlot + ' (word ' + (freeSlot >>> 5) + ')';
        if (ctx.oracle.fb1024Snapshot(pool) !== snap) fails.push('T6 FB1024: ' + name + ' pool state moved during measurement');
        fb1024ByLane.push({ name, perOp: m.perOp, window0: m.window0, valid: m.valid });
        if (m.valid < 3 || !(m.perOp < 0.1)) {
            fails.push('T6 FB1024: ' + name + ' = ' + Number(m.perOp).toFixed(3) + ' B/op, valid=' + m.valid + ' (expected < 0.1, >= 3 valid)' + optNote(m));
        }
    }
    measures.fb1024ByLane = fb1024ByLane;

    // ---- G2 (1.6.0) FastBit1024 counts + prevSetBit lane (its own measure key,
    // so fb1024ByLane keeps its 2 lanes): the same two pool shapes; the three
    // counts vs sig1024 and vs a cap-500 partner (full -1 words, bit-31 words,
    // a 0x55555555 word: every SWAR input outside the 31-bit Smi range), plus
    // the bounded prevSetBit reverse walk over sig1024 and one prevSetBit probe
    // into the pool. Pool, sig1024 and partner snapshots are re-checked
    // unchanged; the six counts are re-checked against a naive has() count. Gated
    // < 0.1 B/op with >= 3 valid windows, NaN fails closed; bop-box turns it red.
    const fb1024CountsByLane = [];
    const part500 = new C1024(500);
    for (let b = 0; b < 500; b++) if ((b >>> 5) === 3 || (b >>> 5) === 9 ? true : (b >>> 5) === 6 ? (b & 1) === 0 : (b % 3) === 0 || (b & 31) === 31) part500.add(b);
    const snapSig = ctx.oracle.fb1024Snapshot(sig1024), snapPart = ctx.oracle.fb1024Snapshot(part500);
    for (const freeSlot of [5, 1000]) {
        const pool = new C1024();
        for (let i = 0; i < 1024; i++) if (i !== freeSlot) pool.add(i);
        const snap = ctx.oracle.fb1024Snapshot(pool);
        const op = (i) => {
            let acc = pool.intersectionSize(sig1024) ^ (pool.unionSize(sig1024) << 11) ^ (pool.differenceSize(sig1024) << 22);
            acc = (acc + (pool.intersectionSize(part500) ^ (pool.unionSize(part500) << 11) ^ (part500.differenceSize(pool) << 22))) | 0;
            for (let b = sig1024.prevSetBit(1023), n = 0; b !== -1 && n <= 1024; b = sig1024.prevSetBit(b - 1), n++) acc = (acc + b) | 0; // bounded
            h.SINK[0] = acc ^ pool.prevSetBit(i & 1023);
            if (bopBox) { BOX[0] = i + 0.5; h.SINK[2] = BOX[0] | 0; }
        };
        const m = await bop(op);
        const name = 'free slot ' + freeSlot + ' (word ' + (freeSlot >>> 5) + ')';
        if (ctx.oracle.fb1024Snapshot(pool) !== snap || ctx.oracle.fb1024Snapshot(sig1024) !== snapSig || ctx.oracle.fb1024Snapshot(part500) !== snapPart) fails.push('T6 FB1024 counts+prev: ' + name + ' a set moved during measurement');
        let ni = 0, np = 0;
        for (let b = 0; b < 1024; b++) { if (b !== freeSlot && sig1024.has(b)) ni++; if (b < 500 && b !== freeSlot && part500.has(b)) np++; }
        if (pool.intersectionSize(sig1024) !== ni || pool.unionSize(sig1024) !== 1023 + sig1024.size - ni || pool.differenceSize(sig1024) !== 1023 - ni ||
            pool.intersectionSize(part500) !== np || pool.unionSize(part500) !== 1023 + part500.size - np || part500.differenceSize(pool) !== part500.size - np) {
            fails.push('T6 FB1024 counts+prev: ' + name + ' counts disagree with a naive has() count (inter ' + ni + ' / ' + np + ')');
        }
        fb1024CountsByLane.push({ name, perOp: m.perOp, window0: m.window0, valid: m.valid });
        if (m.valid < 3 || !(m.perOp < 0.1)) {
            fails.push('T6 FB1024 counts+prev: ' + name + ' = ' + Number(m.perOp).toFixed(3) + ' B/op, valid=' + m.valid + ' (expected < 0.1, >= 3 valid)' + optNote(m));
        }
    }
    measures.fb1024CountsByLane = fb1024CountsByLane;

    // ---- L3 (1.6.0) FastBit1024 addRange / removeRange lane (its own measure
    // key): capacity 1024, lo = i & 511, hi = lo + (i & 255) (so 1 in 256 ops is
    // the lo === hi early-out, and ranges span 1..9 words, partial edges both
    // ends). "empty base" runs addRange then removeRange on an empty set, "full
    // base" removeRange then addRange on a full one, so each op returns the set
    // to its base: the snapshot is re-checked unchanged after measuring, plus the
    // base fields read directly (empty: _n 0, _active 0, every word 0; full:
    // _n 1024, _full -1, every word -1). Gated < 0.1 B/op with >= 3 valid
    // windows, NaN fails closed, verified-optimized like every lane; bop-box
    // turns both red.
    const fb1024RangeByLane = [];
    for (const full of [false, true]) {
        const pool = new C1024();
        if (full) for (let b = 0; b < 1024; b++) pool.add(b);
        const snap = ctx.oracle.fb1024Snapshot(pool);
        const op = full
            ? (i) => {
                const lo = i & 511, hi = lo + (i & 255);
                pool.removeRange(lo, hi);
                h.SINK[1] = pool.size;
                h.SINK[0] = pool.addRange(lo, hi).size;
                if (bopBox) { BOX[0] = i + 0.5; h.SINK[2] = BOX[0] | 0; }
            }
            : (i) => {
                const lo = i & 511, hi = lo + (i & 255);
                pool.addRange(lo, hi);
                h.SINK[1] = pool.size;
                h.SINK[0] = pool.removeRange(lo, hi).size;
                if (bopBox) { BOX[0] = i + 0.5; h.SINK[2] = BOX[0] | 0; }
            };
        const m = await bop(op);
        const name = full ? 'full base (removeRange then addRange)' : 'empty base (addRange then removeRange)';
        let words = true;
        for (let w = 0; w < 32; w++) if (pool._data[w] !== (full ? -1 : 0)) words = false;
        const base = full ? pool._n === 1024 && pool._full === -1 : pool._n === 0 && pool._active === 0;
        if (ctx.oracle.fb1024Snapshot(pool) !== snap || !base || !words) fails.push('T6 FB1024 range: ' + name + ' pool state moved during measurement (_n ' + pool._n + ', _active ' + pool._active + ', _full ' + pool._full + ')');
        fb1024RangeByLane.push({ name, perOp: m.perOp, window0: m.window0, valid: m.valid, status: m.status });
        if (m.valid < 3 || !(m.perOp < 0.1)) {
            fails.push('T6 FB1024 range: ' + name + ' = ' + Number(m.perOp).toFixed(3) + ' B/op, valid=' + m.valid + ' (expected < 0.1, >= 3 valid)' + optNote(m));
        }
    }
    measures.fb1024RangeByLane = fb1024RangeByLane;

    // ---- G1 (1.6.0) image lanes (see fb1024ImageLanes) ----------------------
    try { await fb1024ImageLanes(ctx, fails, baseline, bopBox, bop); } catch (e) { fails.push('T6 FB1024 img: lanes threw ' + e.constructor.name + ': ' + e.message); }

    // ---- shared megamorphic site: actually measured, NaN fails closed -------
    const si = new FB(0).union(h.LANE_INT32[2]); // -1
    const shHasAll = (i) => { h.SINK[0] = h.sharedHasAll(si, MASK) ? 1 : 0; };
    const shForEach = (i) => { h.sharedForEach(si, sinkCb); };
    const mha = await bop(shHasAll);
    const mfe = await bop(shForEach);
    measures.sharedHasAllBop = mha.perOp;
    measures.sharedForEachBop = mfe.perOp;
    if (mha.valid < 3 || !(mha.perOp < 0.1)) fails.push('T6 shared: sharedHasAll = ' + Number(mha.perOp).toFixed(3) + ' B/op, valid=' + mha.valid + ' (expected < 0.1, >= 3 valid)' + optNote(mha));
    if (mfe.valid < 3 || !(mfe.perOp < 0.1)) fails.push('T6 shared: sharedForEach = ' + Number(mfe.perOp).toFixed(3) + ' B/op, valid=' + mfe.valid + ' (expected < 0.1, >= 3 valid)' + optNote(mfe));

    // ---- closure scavenge lane (FB-11 shape, direct forEach) ----------------
    const fcInst = new FB(0x0F0F0F0F);
    const closure = ctx.control.foreachClosure === true;
    const sharedOp = closure
        ? (i) => { let a = 0; fcInst.forEach((b) => { a = (a + b + i) | 0; }); h.SINK[3] = (h.SINK[3] + a) | 0; }
        : (i) => { fcInst.forEach(sinkCb); };
    const scav = await h.measureScavenges(sharedOp, 2000000);
    measures.closureScavenges = scav;
    if (!(scav <= 2)) fails.push('T6 scavenge: forEach closure lane churned ' + scav + ' scavenges over 2e6 ops (expected <= 2)');

    console.error('MEASURE T6 verified-optimized (TurboFan) measureBop lanes ' + bopOpt.verified + '/' + bopOpt.lanes + ', ' + bopOpt.tracked + ' functions forced + verified per lane' + (bopOpt.first === null ? '' : ' -- first unverified: ' + bopOpt.first) + ' [gated: every lane verified]');

    void green;
    return { fails, green };
}

// ---- G1 (1.6.0) FastBit1024 image lanes ------------------------------------
// Zero lanes (measureBop, gated < 0.1 B/op with >= 3 valid windows, NaN fails
// closed; the bop-box control turns each red): saveInto (offset 3), loadFrom
// (offset 2; the image holds -1, bit-30, bit-31, 0x7FFFFFFF and 0x55555555
// words, values outside the 31-bit Smi range), copy (alternating two sources,
// so every op writes), equals (a twin: the full scan; and a set differing in
// one word). Scavenge lane: the four mixed, 2e6 ops, gated <= 2. Must-fail
// lanes: serialize / deserialize / clone allocate by contract; a small-K
// window (K = 512, so a window stays far below the 4 MB semi-space) must read
// >= 100 B/op, else the lane is blind. d8 lane: test/torture/d8-loadfrom.mjs
// on a pointer-compressed d8 (`FASTBIT_D8` or ~/.jsvu/engines/v8/d8),
// scavenges counted between MARK lines: loadFrom <= 2 per 1e5 loads, the
// box control >= 2; no d8 (or not pointer-compressed) prints SKIP, never PASS.
const IMG_WORDS = new Int32Array([-1, 0x40000000, -0x80000000, 0x7FFFFFFF, 0x55555555, -0x55555556, 0x40000001, 0]);
const IMG_HOLD = [null, null, null, null];   // small-K results escape here
const SMALL_K = 512;

async function smallKWindow(h, fn, K) {
    const before = h.newSpaceUsed();
    const m0 = h.minorCount();
    for (let i = 0; i < K; i++) fn(i);
    const after = h.newSpaceUsed();
    await h.settle(10);
    return { delta: after - before, scav: h.minorCount() - m0 };
}

async function measureSmallK(h, fn, base, K) {
    let valid = 0, min = Infinity, window0 = NaN;
    for (let w = 0; w < 8; w++) {
        const b = await smallKWindow(h, base, K);
        const r = await smallKWindow(h, fn, K);
        const per = (r.delta - b.delta) / K;
        if (w === 0) { window0 = per; continue; }
        if (!(r.delta >= 0) || !(b.delta >= 0) || r.scav > 0 || b.scav > 0) continue;
        valid++;
        if (per < min) min = per;
    }
    return { perOp: valid >= 3 ? min : NaN, valid, window0 };
}

function d8Lane() {
    const bin = process.env.FASTBIT_D8 || join(homedir(), '.jsvu', 'engines', 'v8', 'd8');
    if (!existsSync(bin)) return { skip: 'no d8 on this host (' + bin + '; set FASTBIT_D8 or install jsvu v8)' };
    let pc = null;
    try { pc = JSON.parse(readFileSync(join(dirname(bin), 'v8_build_config.json'), 'utf8')).pointer_compression; } catch (e) { pc = null; }
    if (pc !== true) return { skip: 'd8 at ' + bin + ' is not a pointer-compressed build (v8_build_config.json pointer_compression=' + pc + ')' };
    const script = fileURLToPath(new URL('./d8-loadfrom.mjs', import.meta.url));
    const r = spawnSync(bin, ['--expose-gc', '--trace-gc', '--min-semi-space-size=1', '--max-semi-space-size=1', script], { encoding: 'utf8', timeout: 60000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const counts = {};
    let cur = null;
    let result = null;
    for (const line of out.split('\n')) {
        const mb = /^MARK begin (\S+)/.exec(line);
        if (mb) { cur = mb[1]; counts[cur] = 0; continue; }
        if (line.startsWith('MARK end')) { cur = null; continue; }
        if (cur !== null && line.includes('Scavenge')) counts[cur]++;
        const rm = /^RESULT size=(\d+) want=(\d+)/.exec(line);
        if (rm) result = rm[1] === rm[2];
    }
    return { loads: counts.loadFrom, box: counts.box, result, tail: out.split('\n').filter((l) => l && !l.includes('Scavenge')).slice(-3).join(' | ') };
}

async function fb1024ImageLanes(ctx, fails, baseline, bopBox, bop) {
    const C = ctx.FB1024;
    const h = ctx.h;
    const o = ctx.oracle;
    const lanes = [];
    const fill = (s, rot) => { for (let w = 0; w < 32; w++) for (let b = 0; b < 32; b++) if (((IMG_WORDS[(w + rot) & 7] >>> b) & 1) === 1) s.add((w << 5) + b); return s; };
    const lane = async (name, op, after) => {
        let m;
        try { m = await bop(op); } catch (e) { fails.push('T6 FB1024 img: lane ' + name + ' threw ' + e.constructor.name + ': ' + e.message); return; }
        lanes.push({ name, perOp: m.perOp, window0: m.window0, valid: m.valid });
        if (m.valid < 3 || !(m.perOp < 0.1)) fails.push('T6 FB1024 img: lane ' + name + ' = ' + Number(m.perOp).toFixed(3) + ' B/op, valid=' + m.valid + ' (expected < 0.1, >= 3 valid)' + optNote(m));
        const v = after();
        if (v !== null) fails.push('T6 FB1024 img: lane ' + name + ' ' + v);
    };
    const src = fill(new C(1024), 0);
    const src2 = fill(new C(1024), 3);
    const twin = fill(new C(1024), 0);
    const snapSrc = o.fb1024Snapshot(src);
    // the image, built naively at offset 2 (header + LSB-first words)
    const IMG = new Int32Array(40);
    IMG[2] = 0x46420800 | 1024;
    for (let w = 0; w < 32; w++) IMG[3 + w] = IMG_WORDS[w & 7];
    const OUT = new Int32Array(40);

    await lane('saveInto', (i) => {
        h.SINK[0] = src.saveInto(OUT, 3);
        if (bopBox) { BOX[0] = i + 0.5; h.SINK[2] = BOX[0] | 0; }
    }, () => {
        for (let w = 0; w < 33; w++) if (OUT[3 + w] !== IMG[2 + w]) return 'wrote word ' + w + ' = ' + OUT[3 + w] + ' want ' + IMG[2 + w];
        return o.fb1024Snapshot(src) === snapSrc ? null : 'moved its source';
    });
    const recv = new C(1024);
    await lane('loadFrom (-1 / bit-30 / bit-31 words)', (i) => {
        h.SINK[0] = recv.loadFrom(IMG, 2);
        if (bopBox) { BOX[0] = i + 0.5; h.SINK[2] = BOX[0] | 0; }
    }, () => {
        const r = o.fb1024Snapshot(recv);
        return r === snapSrc ? null : 'loaded a wrong state';
    });
    const dst = new C(1024);
    await lane('copy', (i) => {
        dst.copy((i & 1) === 0 ? src : src2);
        h.SINK[0] = dst._n;
        if (bopBox) { BOX[0] = i + 0.5; h.SINK[2] = BOX[0] | 0; }
    }, () => {
        const v = o.fb1024Invariants(dst);
        return v === null ? null : 'left ' + v;
    });
    await lane('equals', (i) => {
        h.SINK[0] = (src.equals(twin) ? 1 : 0) ^ (src.equals(src2) ? 2 : 0);
        if (bopBox) { BOX[0] = i + 0.5; h.SINK[2] = BOX[0] | 0; }
    }, () => (h.SINK[0] === 1 ? null : 'answered ' + h.SINK[0] + ' want 1'));
    ctx.measures.fb1024ImgLanes = lanes;

    // scavenge lane: the four mixed, 2e6 ops
    try {
        const mix = (i) => {
            h.SINK[0] = src.saveInto(OUT, 3);
            h.SINK[1] = recv.loadFrom(IMG, 2);
            dst.copy((i & 1) === 0 ? src : src2);
            h.SINK[2] = src.equals(twin) ? 1 : 0;
        };
        const scav = await h.measureScavenges(mix, 2000000);
        ctx.measures.fb1024ImgScavenges = scav;
        if (!(scav <= 2)) fails.push('T6 FB1024 img: scavenge lane (saveInto + loadFrom + copy + equals) churned ' + scav + ' scavenges over 2e6 ops (expected <= 2)');
    } catch (e) {
        fails.push('T6 FB1024 img: scavenge lane threw ' + e.constructor.name + ': ' + e.message);
    }

    // must-fail lanes: allocating by contract, the detector must see >= 100 B/op
    const alloc = [];
    for (const [name, fn] of [
        ['serialize', (i) => { IMG_HOLD[i & 3] = src.serialize(); }],
        ['deserialize', (i) => { IMG_HOLD[i & 3] = C.deserialize(IMG, 2); }],
        ['clone', (i) => { IMG_HOLD[i & 3] = src.clone(); }]
    ]) {
        let m;
        try { m = await measureSmallK(h, fn, baseline, SMALL_K); } catch (e) { fails.push('T6 FB1024 img: must-fail lane ' + name + ' threw ' + e.constructor.name + ': ' + e.message); continue; }
        alloc.push({ name, perOp: m.perOp, window0: m.window0, valid: m.valid });
        if (m.valid < 3 || !(m.perOp >= 100)) fails.push('T6 FB1024 img: must-fail lane ' + name + ' = ' + Number(m.perOp).toFixed(1) + ' B/op, valid=' + m.valid + ' (expected >= 100 with >= 3 valid: the B/op detector is blind)');
    }
    IMG_HOLD.fill(null);
    ctx.measures.fb1024ImgAlloc = alloc;

    // d8 pointer-compressed lane
    const d = d8Lane();
    ctx.measures.fb1024ImgD8 = d;
    if (d.skip === undefined) {
        if (d.result !== true || !(d.loads <= 2) || !(d.box >= 2)) fails.push('T6 FB1024 img: d8 lane loadFrom scavenges=' + d.loads + ' (expected <= 2 per 1e5), box control=' + d.box + ' (expected >= 2), result=' + d.result + ' -- ' + d.tail);
    }
}
