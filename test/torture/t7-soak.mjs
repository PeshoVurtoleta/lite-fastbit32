// test/torture/t7-soak.mjs -- retention churn (lite-leak). 4096 cycles, each
// building 1 BitMapper + 64 FastBit32, running ops, then dropping everything.
// Held-value contract: the cleanup is a module-scope noop and the tag is a
// number -- neither closes over the target, or finalization would never fire.
// C3: no onLeak is registered (owner-less finalizations would fire it on every
// clean drop); the gate is size() === 0 && audit().length === 0. The soak-stash
// control pins instances on a module array -> size() never returns to 0.

import {
    createLeakTracker,
    createOwnerCascadeOrphanKernel
} from '@zakkster/lite-leak';

function moduleNoop() { /* must not close over the tracked target */ }

const STASH = [];    // soak-stash control: retains tracked FastBit32 instances
const RETAIN = [];   // soak-retain control: retains an on-heap array per cycle

// One cycle of the image retention row. A plain (non-async) function: the
// results must not sit in the registers of run()'s suspended async frame
// across the drain's awaits (that pinned the last iteration's three objects).
function imgCycle(ctx, C1024, base, img, tracker, tag0, retain) {
    let tag = tag0;
    for (let k = 0; k < 1000; k++) {
        const c = base.clone();
        const d = C1024.deserialize(img);
        const s = c.serialize();
        ctx.h.SINK[0] = c.size ^ d.size ^ s.length;
        tracker.track(c, moduleNoop, tag++, { audit: true });
        tracker.track(d, moduleNoop, tag++, { audit: true });
        tracker.track(s, moduleNoop, tag++, { audit: true });
        if (retain) RETAIN.push(c, d, s);
    }
}

export async function run(ctx) {
    const FB = ctx.FB;
    const Mapper = ctx.Mapper;
    const fails = [];
    let green = 0;
    const stash = ctx.control.soakStash === true;
    const retain = ctx.control.soakRetain === true;

    const warnings = [];
    const tracker = createLeakTracker({
        name: 'fastbit32-soak',
        onWarning: (w) => warnings.push(w.kind + ':' + w.reason)
    });
    tracker.registerKernel(createOwnerCascadeOrphanKernel());

    const CYCLES = 4096;
    const SEGMENTS = 4;                 // 1024 cycles each
    const PER_SEG = CYCLES / SEGMENTS;
    const names = Array.from({ length: 16 }, (_, i) => 'C' + i);

    // Drain the tracker to 0 (gc + macrotask so FinalizationRegistry fires), up
    // to `rounds` rounds. Returns the live count reached.
    async function drain(rounds) {
        let live = tracker.size();
        for (let r = 0; r < rounds && live > 0; r++) {
            globalThis.gc();
            await new Promise((res) => setTimeout(res, 25));
            live = tracker.size();
        }
        return live;
    }

    // Sample RETAINED heap AFTER a drain, once per segment. Raw heapUsed mid-loop
    // grows with uncollected garbage and the tracker's own pending-FR records
    // (neither is a FastBit32 leak), so we sample only post-drain: a real leak
    // would climb segment-over-segment even after every record has drained.
    const postDrainKB = [];

    // SAME gate logic for the clean run and every control (a control must not
    // change the gate). The controls differ only in what they RETAIN.
    for (let seg = 0; seg < SEGMENTS; seg++) {
        for (let c = 0; c < PER_SEG; c++) {
            const mapper = new Mapper(names);
            for (let n = 0; n < 64; n++) {
                const inst = new FB(n * 2654435761);
                inst.add(n & 31).toggle((n >> 1) & 31).remove(n & 7);
                inst.count();
                inst.hasAll(mapper.getMask([names[n & 15]]));
                // S5 Tier-2 members in the churn, sunk (no dead call)
                ctx.h.SINK[0] = inst.select(n & 31) ^ FB.nextSubset(inst.value & 0xFF, inst.value) ^ FB.nextCombination(inst.value);
                tracker.track(inst, moduleNoop, (seg * PER_SEG + c) * 64 + n, { audit: true });
                if (stash) STASH.push(inst);
            }
            // a packed on-heap array (~4KB of V8 heap; a typed array would live
            // in external memory and heapUsed would not see it). ~16MB over 4096
            // cycles -> trips the post-drain heap gate while tracker.size() == 0.
            if (retain) RETAIN.push(new Array(512).fill((seg << 16) | c));
            void mapper;
        }
        const live = await drain(50);
        globalThis.gc();
        await new Promise((res) => setTimeout(res, 25));
        postDrainKB.push(Math.round(process.memoryUsage().heapUsed / 1024));
        if (live !== 0) fails.push('T7: segment ' + seg + ' did not drain to 0 (live=' + live + ')');
    }

    // ---- G1 (1.6.0) FastBit1024 retention row --------------------------------
    // 5 cycles of 1,000 x (clone + deserialize + serialize), every result
    // tracked (number tag, module-scope cleanup); tracker.size() must drain to
    // 0 after EVERY cycle. Under soak-retain each cycle's results are pinned on
    // RETAIN, so size() stays >= 1 and this row FAILs too (ASSERTION 4).
    const imgLive = [];
    try {
        const C1024 = ctx.FB1024;
        const base = new C1024(1000);
        for (let b = 0; b < 1000; b += 3) base.add(b);
        const img = new Int32Array(33);
        img[0] = 0x46420800 | 1000;
        for (let b = 0; b < 1000; b += 3) img[1 + (b >>> 5)] |= 1 << (b & 31);
        for (let cyc = 0; cyc < 5; cyc++) {
            imgCycle(ctx, C1024, base, img, tracker, (1 << 24) + cyc * 3000, retain);
            const live = await drain(50);
            imgLive.push(live);
            if (live !== 0) fails.push('T7: FastBit1024 image cycle ' + cyc + ' did not drain to 0 (live=' + live + '; clone / deserialize / serialize results retained)');
        }
    } catch (e) {
        fails.push('T7: FastBit1024 image retention row threw ' + e.constructor.name + ': ' + e.message);
    }
    ctx.measures.fb1024ImgLive = imgLive;

    const finalLive = tracker.size();
    const findings = tracker.audit();
    ctx.measures.soakLive = finalLive;
    ctx.measures.soakFindings = findings.length;
    ctx.measures.soakPostDrainKB = postDrainKB;

    if (finalLive !== 0) fails.push('T7: tracker.size() = ' + finalLive + ' (expected 0 after drain)');
    if (findings.length !== 0) fails.push('T7: audit() returned ' + findings.length + ' findings');

    // Gate: total post-drain retained-heap growth < 1024KB. A per-cycle leak
    // (tracked instance stashed, or a side buffer retained) adds MBs per
    // 1024-cycle segment; 1024KB absorbs V8 heap-sizing jitter (observed
    // clean growth is within +/- 100KB) while still catching a real leak. The
    // soak-retain control (a 4KB buffer kept per cycle, ~16MB) trips THIS gate
    // on its own, with tracker.size() still 0 -- a leak the FR-based size()
    // check cannot see. (Strict monotonicity is noisy and is NOT gated; the
    // per-segment samples are recorded as a diagnostic.)
    if (postDrainKB.length >= 2) {
        const growthKB = postDrainKB[postDrainKB.length - 1] - postDrainKB[0];
        ctx.measures.soakHeapGrowthKB = growthKB;
        if (!(growthKB < 1024)) fails.push('T7: post-drain heap grew ' + growthKB + 'KB across the soak (expected < 1024KB)');
    }

    if (stash) STASH.length = 0; // release for the next process
    if (retain) RETAIN.length = 0;
    void green; void warnings;
    return { fails, green };
}
