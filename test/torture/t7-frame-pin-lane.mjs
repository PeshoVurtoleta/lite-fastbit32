// test/torture/t7-frame-pin-lane.mjs -- T7-FIX (2026-11-19): the T7 soak in a
// CHILD process under --jitless.
//
// Spawned by t7-soak.mjs framePinLane with the torture flags plus --jitless,
// argv[2] = the absolute path of the t7-soak.mjs under test, TORTURE_SOAK_CYCLES
// removed from the env (push volume: 4096 cycles, 4 segments). With no JIT,
// run() is interpreted at each `await drain(50)` on every run, so a per-cycle
// object left in run()'s suspended async frame (the
// pre-fix inline FastBit32 churn pinned the segment's last instance, live=1)
// shows on every run, not only when a concurrent compile lands late.
// Prints exactly ONE stdout line `RESULT <json>`; the parent gates it (this child
// gates nothing).
//
// RESULT fields: execArgv, target (argv[2] as given), node, segLive (the run's
// ctx.measures.soakSegLive, null if the target records none), fails (the run's
// T7 fail lines, plus load / throw rows). Output goes through a write callback
// and process.exitCode, never a bare process.exit after a pending write (CI-3).

import { pathToFileURL } from 'node:url';
import { buildBaseCtx } from './context.mjs';

const res = {
    execArgv: process.execArgv.slice(),
    target: process.argv[2] === undefined ? null : process.argv[2],
    node: process.version,
    segLive: null,
    fails: []
};

function threw(e) { return (e && e.constructor ? e.constructor.name : typeof e) + ': ' + (e && e.message); }

async function main() {
    if (res.target === null) { res.fails.push('argv[2] (target t7-soak.mjs path) is not set'); return; }
    let M;
    try { M = await import(pathToFileURL(res.target).href); } catch (e) { res.fails.push('import of ' + res.target + ' threw ' + threw(e)); return; }
    if (typeof M.run !== 'function') { res.fails.push(res.target + ' exports no run'); return; }
    const ctx = buildBaseCtx(0);
    const r = await M.run(ctx);
    if (Array.isArray(ctx.measures.soakSegLive)) res.segLive = ctx.measures.soakSegLive.slice();
    for (const f of r.fails) res.fails.push(String(f));
    if (r.green !== 0) res.fails.push('run() returned green=' + r.green + ' (want 0)');
}

try { await main(); } catch (e) { res.fails.push('child threw ' + threw(e)); }
process.stdout.write('RESULT ' + JSON.stringify(res) + '\n', () => { process.exitCode = 0; });
