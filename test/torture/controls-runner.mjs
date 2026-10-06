// test/torture/controls-runner.mjs -- spawns torture.mjs once per control and
// asserts each makes EVERY target tier fail: exit status 1 with `FAIL <tier>`
// on stderr for every tier it lists. An unknown control name must exit 2.
// Prints a per-control summary to stderr and exits 0 only if every control
// behaved. (A control that lists a tier it does not actually break would leave
// that gate decorative -- hence `every`, not `some`.)
//
// node --expose-gc --min-semi-space-size=4 --max-semi-space-size=4 test/torture/controls-runner.mjs

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONTROLS, CONTROL_NAMES } from './controls.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, '..', 'torture.mjs');
const NODE_FLAGS = ['--expose-gc', '--min-semi-space-size=4', '--max-semi-space-size=4'];

function runControl(name) {
    return spawnSync(process.execPath, [...NODE_FLAGS, ENTRY], {
        env: { ...process.env, TORTURE_CONTROL: name, TORTURE_FAST: '1' },
        encoding: 'utf8'
    });
}

let bad = 0;

for (const name of CONTROL_NAMES) {
    const control = CONTROLS[name];
    const res = runControl(name);
    const stderr = res.stderr || '';
    const code = res.status;
    const missing = control.tiers.filter((t) => !stderr.includes('FAIL ' + t));
    const ok = code === 1 && missing.length === 0;
    console.error('[control ' + name + '] exit=' + code + ' tiers=' + control.tiers.join(',') + ' -> ' + (ok ? 'ok' : 'BAD'));
    if (!ok) {
        bad++;
        console.error('  expected exit 1 with "FAIL <tier>" for EVERY one of ' + control.tiers.join(',') + (missing.length ? ' (missing: ' + missing.join(',') + ')' : ''));
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
    console.log('controls ok');
    process.exit(0);
} else {
    console.error(bad + ' control(s) misbehaved');
    process.exit(1);
}
