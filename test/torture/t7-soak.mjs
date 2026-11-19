// test/torture/t7-soak.mjs -- retention churn (lite-leak). CYCLES (4096; TORTURE_SOAK_CYCLES), each
// building 1 BitMapper + 64 FastBit32, running ops, then dropping everything.
// Held-value contract: the cleanup is a module-scope noop and the tag is a
// number -- neither closes over the target, or finalization would never fire.
// C3: no onLeak is registered (owner-less finalizations would fire it on every
// clean drop); the gate is size() === 0 && audit().length === 0. The soak-stash
// control pins instances on a module array -> size() never returns to 0.
// G2 (1.6.0): each cycle also churns one FastBit1024 (the three counts vs a
// long-lived partner, a prevSetBit reverse walk), tracked with tags from
// FB1024_TAG0 (disjoint from the FastBit32 and image-row ranges) and stashed
// under soak-stash like the FastBit32 instances.
// B-S7 (FastBit64): 5 cycles of 1,000 x (clone + serialize + deserialize +
// toArray), every result tracked from FB64_TAG0; the fb64-soak-retain control
// (ctx.control.fb64Retain) pins every result on FB64_RETAIN -> that row FAILs.
// T7-FIX (2026-11-19, soak-nightly 44299365353, node 27 alpha): the per-cycle
// FastBit32 churn runs in the plain function fb32Cycle, never inline in run().
// Inline, the dead loop-local `inst` (the segment's last instance) could be
// saved into run()'s suspended async frame across `await drain(50)`, depending
// on the tier running run() at the await: concurrent-compile timing decided.
// Under --jitless (interpreter only, no tier change) every segment pins live=1
// on node 20 / 22 / 24 / 26 and the 27 alpha (maintainer ruling 2026-11-19; the
// no-concurrent-compile flags pinned nothing on node 20 / 22). The t7-frame-pin
// control (ctx.control.t7FramePin) re-runs that inline shape (a statement copy
// of fb32Cycle's body, pinned by FastBit64TortureQA) and must fail;
// framePinLane runs this module in a child under --jitless
// (t7-frame-pin-lane.mjs) on every `npm run torture` and must pass.

import {
    createLeakTracker,
    createOwnerCascadeOrphanKernel
} from '@zakkster/lite-leak';
import { soakCycles } from './harness.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// NIGHTLY S-5: read once at load, so a bad TORTURE_SOAK_CYCLES exits 2 before any tier runs.
const CYCLES = soakCycles();          // 4096 unset; multiple of 1024 in [4096, 131072]
const PER_SEG = 1024;
const SEGMENTS = CYCLES / PER_SEG;    // 1024 cycles each

function moduleNoop() { /* must not close over the tracked target */ }

const STASH = [];    // soak-stash control: retains tracked FastBit32 instances
const RETAIN = [];   // soak-retain control: retains an on-heap array per cycle
const FB1024_TAG0 = 1 << 23; // 8388608 + cycle: FastBit32 tags < 64 * CYCLES <= 1 << 23 (CYCLES <= 131072), below the image row's 1 << 24
// B-S7 tag family. Ranges for CYCLES <= 131072: FastBit32 [0, 64 * CYCLES) within [0, 2^23);
// FastBit1024 [2^23, 2^23 + 131072); image row [2^24, 2^24 + 5 * 3000 = 2^24 + 15000);
// FastBit64 [2^25, 2^25 + 5 * 4000 = 2^25 + 20000) = [33554432, 33574432): above all
// three (2^24 + 15000 < 2^25) and a Smi.
const FB64_TAG0 = 1 << 25;
const FB64_RETAIN = []; // fb64-soak-retain control: pins every FastBit64 row result

// One cycle of the FastBit32 churn: 1 BitMapper + 64 FastBit32 instances. A
// plain (non-async) function, like imgCycle: no instance (and no mapper) may sit
// in run()'s suspended async frame across a drain (T7-FIX). The mapper moved in
// with the loop: it is created first in the cycle as before, is not tracked, and
// only the loop reads it, so keeping it here keeps run()'s frame free of every
// per-cycle object. run()'s t7-frame-pin copy must stay statement-identical to
// this body (FastBit64TortureQA pins it).
function fb32Cycle(ctx, FB, Mapper, names, seg, c, tracker, stash) {
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
}

// One G2 churn instance per cycle. A plain (non-async) function, like imgCycle,
// so the instance never sits in run()'s suspended async frame across a drain.
function fb1024Churn(ctx, C1024, partner, cyc, tracker, stash) {
    const cap = 1 + ((cyc * 37) & 1023);
    const s = new C1024(cap);
    for (let b = cyc & 7; b < cap; b += 1 + (cyc & 15)) s.add(b);
    let acc = s.intersectionSize(partner) ^ s.unionSize(partner) ^ s.differenceSize(partner) ^ partner.differenceSize(s);
    for (let b = s.prevSetBit(cap - 1), n = 0; b !== -1 && n <= cap; b = s.prevSetBit(b - 1), n++) acc = (acc + b) | 0;
    ctx.h.SINK[0] = acc;
    tracker.track(s, moduleNoop, FB1024_TAG0 + cyc, { audit: true });
    if (stash) STASH.push(s);
}

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

// One cycle of the FastBit64 retention row (B-S7). A plain (non-async) function
// for the same reason as imgCycle: no result may sit in run()'s async frame.
function fb64Cycle(ctx, C64, base, tracker, tag0, retain) {
    let tag = tag0;
    for (let k = 0; k < 1000; k++) {
        const c = base.clone();
        const s = c.serialize();
        const d = C64.deserialize(s);
        const a = d.toArray();
        ctx.h.SINK[0] = c.lo ^ d.hi ^ s.length ^ a.length;
        tracker.track(c, moduleNoop, tag++, { audit: true });
        tracker.track(s, moduleNoop, tag++, { audit: true });
        tracker.track(d, moduleNoop, tag++, { audit: true });
        tracker.track(a, moduleNoop, tag++, { audit: true });
        if (retain) FB64_RETAIN.push(c, s, d, a);
    }
}

// Failure-only diagnostic: names which tracked objects survived a drain. Walks
// the audited records through the kernel ctx and reads ONLY record.tag (a
// number); it never touches or keeps a handle or a target. Output is bounded:
// total, per-kind counts, and at most 8 decoded survivors (decoded text is
// built only for those 8). Decodes the tag families above; returns the text.
const IMG_KIND = ['clone', 'deserialize', 'serialize'];
const FB64_KIND = ['clone', 'serialize', 'deserialize', 'toArray'];
function tagKind(tag) {
    if (typeof tag !== 'number') return 'other';
    if (tag >= 0 && tag < FB1024_TAG0) return 'fb32';
    if (tag >= FB1024_TAG0 && tag < (1 << 24)) return 'fb1024';
    if (tag >= (1 << 24) && tag < (1 << 24) + 15000) return 'img';
    if (tag >= FB64_TAG0 && tag < FB64_TAG0 + 20000) return 'fb64';
    return 'other';
}
function decodeTag(kind, tag) {
    if (kind === 'fb32') {
        const n = tag % 64, q = (tag - n) / 64;
        return 'fb32 seg=' + Math.floor(q / PER_SEG) + ' cyc=' + (q % PER_SEG) + ' n=' + n + ' tag=' + tag;
    }
    if (kind === 'fb1024') {
        const q = tag - FB1024_TAG0;
        return 'fb1024 seg=' + Math.floor(q / PER_SEG) + ' cyc=' + (q % PER_SEG) + ' tag=' + tag;
    }
    if (kind === 'img') {
        const r = tag - (1 << 24), m = r % 3000, k = (m - (m % 3)) / 3;
        return 'img cyc=' + Math.floor(r / 3000) + ' k=' + k + ' ' + IMG_KIND[m % 3] + ' tag=' + tag;
    }
    if (kind === 'fb64') {
        const r = tag - FB64_TAG0, m = r % 4000, k = (m - (m % 4)) / 4;
        return 'fb64 cyc=' + Math.floor(r / 4000) + ' k=' + k + ' ' + FB64_KIND[m % 4] + ' tag=' + tag;
    }
    return 'other tag=' + String(tag);
}
function describeSurvivors(kctx) {
    if (kctx === null) return 'no kernel ctx';
    const cnt = { fb32: 0, fb1024: 0, img: 0, fb64: 0, other: 0 };
    let total = 0;
    let shown = 0;
    let first = '';
    kctx.forEachAuditedHandle((handle, record) => {
        const kind = tagKind(record.tag);
        total++;
        cnt[kind]++;
        if (shown < 8) first += (shown++ === 0 ? '' : ' | ') + decodeTag(kind, record.tag);
    });
    return total + ' survivors (fb32=' + cnt.fb32 + ' fb1024=' + cnt.fb1024 + ' img=' + cnt.img +
        ' fb64=' + cnt.fb64 + ' other=' + cnt.other + '); first ' + shown + ': ' + first;
}

// T7-FIX lane: this module's run() in a CHILD process (t7-frame-pin-lane.mjs)
// under --jitless, at push volume (4096 cycles: the child's env drops
// TORTURE_SOAK_CYCLES). With no JIT, run() is interpreted at every await on every
// run, so an async-frame pin reproduces every time instead of only when a
// concurrent compile lands late (the alpha failure). Called
// by torture.mjs after T7 in the normal run only (never in control mode); each
// returned string is a T7 fail line. `target` = the t7-soak.mjs the child runs
// (default: this file; a revert check passes another copy). Fails closed on a
// spawn error, a non-zero exit, a missing RESULT, a missing flag, a segment count
// other than 4, any live > 0, or any fail line of the child's run().
export const FRAME_PIN_FLAGS = ['--jitless'];
const LANE_FLAGS = ['--allow-natives-syntax', '--expose-gc', '--min-semi-space-size=4', '--max-semi-space-size=4', ...FRAME_PIN_FLAGS];
const LANE_TIMEOUT_MS = 300000; // generous: the clean child takes a few seconds on an idle host
export function framePinLane(ctx, target = fileURLToPath(import.meta.url)) {
    const fails = [];
    const F = (m) => fails.push('T7 frame-pin lane: ' + m);
    const script = fileURLToPath(new URL('./t7-frame-pin-lane.mjs', import.meta.url));
    const env = { ...process.env };
    delete env.TORTURE_SOAK_CYCLES;
    delete env.TORTURE_CONTROL;
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [...LANE_FLAGS, script, target], { env, encoding: 'utf8', timeout: LANE_TIMEOUT_MS, maxBuffer: 1 << 24 });
    const wallMs = Date.now() - t0;
    const m = { flags: false, segLive: null, fails: null, wallMs };
    ctx.measures.t7FramePinLane = m;
    if (r.error) { F('child spawn error ' + (r.error.code || '') + ' ' + r.error.message + ' (timeout ' + LANE_TIMEOUT_MS + ' ms, signal ' + r.signal + ') -- fail closed'); return fails; }
    if (r.status !== 0) F('child exit ' + r.status + ' signal ' + r.signal + ' (stderr tail: ' + String(r.stderr || '').split('\n').slice(-4).join(' | ') + ') -- fail closed');
    const line = String(r.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
    let res = null;
    if (line !== undefined) { try { res = JSON.parse(line.slice(7)); } catch { res = null; } }
    if (res === null || typeof res !== 'object' || !Array.isArray(res.execArgv) || !Array.isArray(res.fails)) { F('child printed no parsable RESULT line -- fail closed'); return fails; }
    m.flags = FRAME_PIN_FLAGS.every((f) => res.execArgv.includes(f));
    m.segLive = Array.isArray(res.segLive) ? res.segLive : null;
    m.fails = res.fails.length;
    if (!m.flags) F('child execArgv [' + res.execArgv.join(' ') + '] lacks ' + FRAME_PIN_FLAGS.join(' ') + ': the JIT tiers run() and the pin is timing-dependent -- fail closed');
    if (res.target !== target) F('child ran ' + res.target + ' (want ' + target + ') -- fail closed');
    if (m.segLive === null || m.segLive.length !== 4) F('child segment live counts ' + JSON.stringify(res.segLive) + ' (want 4 segments at 4096 cycles) -- fail closed');
    else if (!m.segLive.every((v) => v === 0)) F('segment live counts [' + m.segLive.join(',') + '] (want 0 each: an object outlived its segment)');
    for (const f of res.fails) F(String(f));
    return fails;
}

export async function run(ctx) {
    const FB = ctx.FB;
    const Mapper = ctx.Mapper;
    const fails = [];
    let green = 0;
    const stash = ctx.control.soakStash === true;
    const retain = ctx.control.soakRetain === true;
    const fb64Retain = ctx.control.fb64Retain === true;
    // t7-frame-pin control: the pre-T7-FIX inline churn below; meaningful only
    // under FRAME_PIN_FLAGS (--jitless; controls-runner passes them), so without
    // them the control fails closed on this line instead of running blind.
    const framePin = ctx.control.t7FramePin === true;
    if (framePin && !FRAME_PIN_FLAGS.every((f) => process.execArgv.includes(f))) fails.push('T7: t7-frame-pin control needs ' + FRAME_PIN_FLAGS.join(' ') + ' in execArgv (got ' + process.execArgv.join(' ') + ')');

    const warnings = [];
    const tracker = createLeakTracker({
        name: 'fastbit32-soak',
        onWarning: (w) => warnings.push(w.kind + ':' + w.reason)
    });
    tracker.registerKernel(createOwnerCascadeOrphanKernel());
    // Diagnostic only: keeps the kernel ctx (no target) so a drain failure can name survivors.
    let diagCtx = null;
    tracker.registerKernel({ name: 't7-survivors', install(kctx) { diagCtx = kctx; } });
    function survivors() {
        return '; survivors: ' + describeSurvivors(diagCtx);
    }

    const names = Array.from({ length: 16 }, (_, i) => 'C' + i);
    const C1024 = ctx.FB1024;
    const partner = new C1024(700);
    for (let b = 0; b < 700; b += 5) partner.add(b);

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
    const segLive = [];   // per-segment live after the drain (framePinLane reads it)

    // SAME gate logic for the clean run and every control (a control must not
    // change the gate). The controls differ only in what they RETAIN, except
    // t7-frame-pin, which differs only in WHERE the FastBit32 churn runs.
    // Every per-cycle object is made in a plain function (fb32Cycle,
    // fb1024Churn), so none is left in run()'s frame when it suspends at a drain.
    for (let seg = 0; seg < SEGMENTS; seg++) {
        for (let c = 0; c < PER_SEG; c++) {
            if (framePin) {
                // t7-frame-pin control ONLY: the pre-T7-FIX shape, fb32Cycle's
                // body inline in this async function. Statement-identical to
                // fb32Cycle (FastBit64TortureQA pins it); do not edit one alone.
                // <t7-frame-pin copy>
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
                // </t7-frame-pin copy>
            } else {
                fb32Cycle(ctx, FB, Mapper, names, seg, c, tracker, stash);
            }
            // a packed on-heap array (~4KB of V8 heap; a typed array would live
            // in external memory and heapUsed would not see it). ~16MB over 4096
            // cycles -> trips the post-drain heap gate while tracker.size() == 0.
            if (retain) RETAIN.push(new Array(512).fill((seg << 16) | c));
            fb1024Churn(ctx, C1024, partner, seg * PER_SEG + c, tracker, stash);
        }
        const live = await drain(50);
        segLive.push(live);
        globalThis.gc();
        await new Promise((res) => setTimeout(res, 25));
        postDrainKB.push(Math.round(process.memoryUsage().heapUsed / 1024));
        // survivors() walks the tracker AFTER the extra gc + 25 ms above, so its
        // count can be below `live` (a late finalizer ran); `live` is the gate.
        if (live !== 0) fails.push('T7: segment ' + seg + ' did not drain to 0 (live=' + live + ')' + survivors());
    }

    // ---- G1 (1.6.0) FastBit1024 retention row --------------------------------
    // 5 cycles of 1,000 x (clone + deserialize + serialize), every result
    // tracked (number tag, module-scope cleanup); tracker.size() must drain to
    // 0 after EVERY cycle. Under soak-retain each cycle's results are pinned on
    // RETAIN, so size() stays >= 1 and this row FAILs too (ASSERTION 4).
    const imgLive = [];
    try {
        const base = new C1024(1000);
        for (let b = 0; b < 1000; b += 3) base.add(b);
        const img = new Int32Array(33);
        img[0] = 0x46420800 | 1000;
        for (let b = 0; b < 1000; b += 3) img[1 + (b >>> 5)] |= 1 << (b & 31);
        for (let cyc = 0; cyc < 5; cyc++) {
            imgCycle(ctx, C1024, base, img, tracker, (1 << 24) + cyc * 3000, retain);
            const live = await drain(50);
            imgLive.push(live);
            if (live !== 0) fails.push('T7: FastBit1024 image cycle ' + cyc + ' did not drain to 0 (live=' + live + '; clone / deserialize / serialize results retained)' + survivors());
        }
    } catch (e) {
        fails.push('T7: FastBit1024 image retention row threw ' + e.constructor.name + ': ' + e.message);
    }
    ctx.measures.fb1024ImgLive = imgLive;

    // ---- B-S7 FastBit64 retention row ------------------------------------------
    // 5 cycles of 1,000 x (clone + serialize + deserialize + toArray), every
    // result tracked (number tag, module-scope cleanup, audit); tracker.size()
    // must drain to 0 after EVERY cycle. Under fb64-soak-retain every result is
    // pinned on FB64_RETAIN, so size() stays >= 4000 per cycle and this row FAILs.
    // It also FAILs under soak-stash / soak-retain: like the image row it reads the
    // tracker's ABSOLUTE size, which includes the objects those controls pin.
    // Coverage teeth: size() is read right before and right after each fb64Cycle
    // (synchronous, no await between, so no finalizer can run): the delta must be
    // exactly 4000 = 1000 x (clone + serialize + deserialize + toArray), else a
    // dropped track() would let a leak of that result pass as a clean drain.
    const fb64Live = [];
    try {
        const C64 = ctx.FB64;
        const base = new C64(0x80000001, 0xC0000003); // bits 0, 31, 32, 33, 62, 63
        for (let cyc = 0; cyc < 5; cyc++) {
            const before = tracker.size();
            fb64Cycle(ctx, C64, base, tracker, FB64_TAG0 + cyc * 4000, fb64Retain);
            const tracked = tracker.size() - before;
            if (tracked !== 4000) fails.push('T7: FastBit64 retention cycle ' + cyc + ' tracked ' + tracked + ' results (expected exactly 4000 = 1000 x clone / serialize / deserialize / toArray)');
            const live = await drain(50);
            fb64Live.push(live);
            if (live !== 0) fails.push('T7: FastBit64 retention cycle ' + cyc + ' did not drain to 0 (live=' + live + '; clone / serialize / deserialize / toArray results retained)' + survivors());
        }
    } catch (e) {
        fails.push('T7: FastBit64 retention row threw ' + e.constructor.name + ': ' + e.message);
    }
    ctx.measures.fb64RetainLive = fb64Live;

    const finalLive = tracker.size();
    const findings = tracker.audit();
    ctx.measures.soakLive = finalLive;
    ctx.measures.soakFindings = findings.length;
    ctx.measures.soakPostDrainKB = postDrainKB;
    ctx.measures.soakSegLive = segLive;

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
    if (fb64Retain) FB64_RETAIN.length = 0;
    void green; void warnings;
    return { fails, green };
}
