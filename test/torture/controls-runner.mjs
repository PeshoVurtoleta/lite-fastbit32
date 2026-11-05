// test/torture/controls-runner.mjs -- spawns torture.mjs once per control and
// asserts each makes EVERY target tier fail: exit status 1 with `FAIL <tier>`
// on stderr for every tier it lists. An unknown control name must exit 2.
// Prints a per-control summary to stderr and exits 0 only if every control
// behaved. (A control that lists a tier it does not actually break would leave
// that gate decorative -- hence `every`, not `some`.)
//
// A control may also carry `expect` (a RegExp): its stderr must match it, so a
// control that must fail for ONE reason cannot pass by failing for another.
//
// node --allow-natives-syntax --expose-gc --min-semi-space-size=4 --max-semi-space-size=4 test/torture/controls-runner.mjs [name ...]
// With control names as arguments only those run (an unknown name exits 2);
// with none, every control runs.
//
// CI-5, maintainer ruling 2026-11-05: "T6 needs V8 >= 14; named SKIP". Below V8
// 14 a control whose tiers include T6 is not spawned (torture.mjs would refuse it
// with exit 1): it prints "[control <name>] SKIP tiers=..: <reason>" and is
// counted in the success line, never read as ok. Named on argv, it skips the same.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONTROLS, CONTROL_NAMES } from './controls.mjs';
import { t6Floor } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, '..', 'torture.mjs');
const NODE_FLAGS = ['--allow-natives-syntax', '--expose-gc', '--min-semi-space-size=4', '--max-semi-space-size=4'];

function runControl(name) {
    return spawnSync(process.execPath, [...NODE_FLAGS, ENTRY], {
        env: { ...process.env, TORTURE_CONTROL: name, TORTURE_FAST: '1' },
        encoding: 'utf8'
    });
}

const ARGS = process.argv.slice(2);
for (const a of ARGS) {
    if (!CONTROLS[a]) { console.error('controls-runner: unknown control "' + a + '" (known: ' + CONTROL_NAMES.join(', ') + ')'); process.exit(2); }
}
let T6_SKIP;
try {
    T6_SKIP = t6Floor(process.versions.v8);
} catch (e) {
    console.error('controls-runner: ' + e.message);
    process.exit(1);
}
let bad = 0;
let t6Skipped = 0;

for (const name of ARGS.length > 0 ? ARGS : CONTROL_NAMES) {
    const control = CONTROLS[name];
    if (T6_SKIP !== null && control.tiers.includes('T6')) {
        console.error('[control ' + name + '] SKIP tiers=' + control.tiers.join(',') + ': ' + T6_SKIP);
        t6Skipped++;
        continue;
    }
    const res = runControl(name);
    const stderr = res.stderr || '';
    const code = res.status;
    const missing = control.tiers.filter((t) => !stderr.includes('FAIL ' + t));
    const expectOk = control.expect === undefined || control.expect.test(stderr);
    const ok = code === 1 && missing.length === 0 && expectOk;
    console.error('[control ' + name + '] exit=' + code + ' tiers=' + control.tiers.join(',') + ' -> ' + (ok ? 'ok' : 'BAD'));
    if (!ok) {
        bad++;
        console.error('  expected exit 1 with "FAIL <tier>" for EVERY one of ' + control.tiers.join(',') + (missing.length ? ' (missing: ' + missing.join(',') + ')' : '') + (expectOk ? '' : ' and stderr matching ' + control.expect));
        if (stderr) console.error('  stderr tail: ' + stderr.split('\n').slice(-6).join(' | '));
    }
}

// unknown control -> exit 2
{
    const res = runControl('does-not-exist');
    const ok = res.status === 2;
    console.error('[control does-not-exist] exit=' + res.status + ' -> ' + (ok ? 'ok (exit 2)' : 'BAD'));
    if (!ok) bad++;
}

if (bad === 0) {
    console.log(t6Skipped > 0 ? 'controls ok (' + t6Skipped + ' T6 controls skipped: V8 ' + process.versions.v8 + ' < 14)' : 'controls ok');
    process.exit(0);
} else {
    console.error(bad + ' control(s) misbehaved');
    process.exit(1);
}
