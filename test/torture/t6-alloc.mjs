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
//     threshold never changes under a control. highestClearBit is split: gated
//     < 0.1 on bit-31-SET words; EXPECTED-RED on bit-31-CLEAR words (~16-32
//     B/op, a reading < 0.1 is green++ i.e. a failure). The shared megamorphic
//     call site is measured (sharedHasAll + sharedForEach), gated < 0.1. Every
//     comparison is NaN-fails-closed (`valid < 3 || !(perOp < 0.1)`).
//
//   Closure scavenge lane: the ROADMAP FB-11 shape forEach(b => a += b + i)
//     through the real forEach. Module-scope callback churns 0; a per-op closure
//     (foreach-closure control) churns dozens. Gate <= 2.

import { measureOps, GcProfiler, checkNoGc } from '@zakkster/lite-gc-profiler';

const MASK = 0x0F0F0F0F;       // int32 mask (no bit 31): signedness-safe
const BOX = [{}];              // tagged-elements array: forces a HeapNumber box

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

    // ---- per-lane composite B/op (signed gated, unsigned read-only/printed) -
    const bopByLane = [];
    for (let li = 0; li < h.LANE_VALUES.length; li++) {
        const signed = h.LANE_SIGNED[li] === 1;
        const want = signed ? h.LANE_INT32[li] : h.LANE_VALUES[li];
        const inst = signed ? new FB(0).union(h.LANE_INT32[li]) : new FB(h.LANE_VALUES[li]);
        if (!Object.is(inst.value, want)) {
            fails.push('T6 B/op: lane ' + h.LANE_NAMES[li] + ' built value ' + inst.value + ' !== ' + want + ' (fail closed)');
            continue;
        }
        const op = signed
            ? (i) => {
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
            }
            : (i) => {                                     // unsigned: READ-ONLY
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
        const m = await h.measureBop(op, baseline);
        if (!Object.is(inst.value, want)) {
            fails.push('T6 B/op: lane ' + h.LANE_NAMES[li] + ' value moved to ' + inst.value + ' during measurement (expected ' + want + ')');
        }
        bopByLane.push({ name: h.LANE_NAMES[li], perOp: m.perOp, window0: m.window0, valid: m.valid, signed });
        // EVERY lane is gated < 0.1 B/op (clean lanes read within +/-0.02; the
        // threshold must not change under a control). The bop-box control injects
        // one HeapNumber per op -> ~16 B/op -> every lane fails.
        if (m.valid < 3 || !(m.perOp < 0.1)) {
            fails.push('T6 B/op: ' + (signed ? 'SIGNED' : 'unsigned') + ' lane ' + h.LANE_NAMES[li] + ' = ' + Number(m.perOp).toFixed(3) + ' B/op, valid=' + m.valid + ' (expected < 0.1, >= 3 valid)');
        }
    }
    measures.bopByLane = bopByLane;

    // ---- highestClearBit: gated on bit-31-set, expected-red on bit-31-clear -
    const hcbByLane = [];
    for (let li = 0; li < 4; li++) {           // signed lanes only
        const inst = new FB(0).union(h.LANE_INT32[li]);
        const bit31Clear = ((inst.value >>> 31) & 1) === 0; // ~value has bit 31 -> boxes
        const op = (i) => { h.SINK[0] = inst.highestClearBit() | 0; };
        const m = await h.measureBop(op, baseline);
        hcbByLane.push({ name: h.LANE_NAMES[li], perOp: m.perOp, valid: m.valid, red: bit31Clear });
        if (m.valid < 3) { fails.push('T6 hcb: lane ' + h.LANE_NAMES[li] + ' had < 3 valid windows (NaN fails closed)'); continue; }
        if (bit31Clear) {
            // EXPECTED-RED: `~value >>> 0` >= 2^31 boxes today (~32 B/op). A
            // < 0.1 reading means the box is gone -> green (a failure; flips
            // only on purpose).
            if (m.perOp < 0.1) green++;
        } else {
            if (!(m.perOp < 0.1)) fails.push('T6 hcb: bit-31-set lane ' + h.LANE_NAMES[li] + ' = ' + Number(m.perOp).toFixed(3) + ' B/op (expected < 0.1)');
        }
    }
    measures.hcbByLane = hcbByLane;

    // ---- shared megamorphic site: actually measured, NaN fails closed -------
    const si = new FB(0).union(h.LANE_INT32[2]); // -1
    const shHasAll = (i) => { h.SINK[0] = h.sharedHasAll(si, MASK) ? 1 : 0; };
    const shForEach = (i) => { h.sharedForEach(si, sinkCb); };
    const mha = await h.measureBop(shHasAll, baseline);
    const mfe = await h.measureBop(shForEach, baseline);
    measures.sharedHasAllBop = mha.perOp;
    measures.sharedForEachBop = mfe.perOp;
    if (mha.valid < 3 || !(mha.perOp < 0.1)) fails.push('T6 shared: sharedHasAll = ' + Number(mha.perOp).toFixed(3) + ' B/op, valid=' + mha.valid + ' (expected < 0.1, >= 3 valid)');
    if (mfe.valid < 3 || !(mfe.perOp < 0.1)) fails.push('T6 shared: sharedForEach = ' + Number(mfe.perOp).toFixed(3) + ' B/op, valid=' + mfe.valid + ' (expected < 0.1, >= 3 valid)');

    // ---- closure scavenge lane (FB-11 shape, direct forEach) ----------------
    const fcInst = new FB(0x0F0F0F0F);
    const closure = ctx.control.foreachClosure === true;
    const sharedOp = closure
        ? (i) => { let a = 0; fcInst.forEach((b) => { a = (a + b + i) | 0; }); h.SINK[3] = (h.SINK[3] + a) | 0; }
        : (i) => { fcInst.forEach(sinkCb); };
    const scav = await h.measureScavenges(sharedOp, 2000000);
    measures.closureScavenges = scav;
    if (!(scav <= 2)) fails.push('T6 scavenge: forEach closure lane churned ' + scav + ' scavenges over 2e6 ops (expected <= 2)');

    void green;
    return { fails, green };
}
