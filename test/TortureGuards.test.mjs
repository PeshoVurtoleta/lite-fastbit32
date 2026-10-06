// test/TortureGuards.test.mjs -- the torture entry must fail closed (ROADMAP
// section 5, Harness rules). Spawns test/torture.mjs; every case except the
// replay exits at a guard before any tier runs, so this file is fast.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'torture.mjs');
const PINS = ['--min-semi-space-size=4', '--max-semi-space-size=4'];

function run(flags, env = {}) {
    const clean = { ...process.env };
    delete clean.NODE_OPTIONS;
    delete clean.TORTURE_SEED;
    delete clean.TORTURE_CONTROL;
    return spawnSync(process.execPath, [...flags, ENTRY], {
        env: { ...clean, ...env },
        encoding: 'utf8'
    });
}

describe('torture entry guards (fail closed)', () => {
    it('without --expose-gc: exit 1 with a remedy, no stack trace', () => {
        const r = run([]);
        assert.strictEqual(r.status, 1);
        assert.match(r.stderr, /globalThis\.gc is missing/);
        assert.match(r.stderr, /remedy:/);
        assert.doesNotMatch(r.stderr, /\n\s+at /);
        assert.strictEqual(r.stdout, '');
    });

    for (const [label, flags] of [
        ['no pins', ['--expose-gc']],
        ['min pin only', ['--expose-gc', PINS[0]]],
        ['max pin only', ['--expose-gc', PINS[1]]],
        ['pins at 8', ['--expose-gc', '--min-semi-space-size=8', '--max-semi-space-size=8']]
    ]) {
        it('with --expose-gc but ' + label + ': exit 1', () => {
            const r = run(flags);
            assert.strictEqual(r.status, 1);
            assert.match(r.stderr, /semi-space-size=4 must be set/);
            assert.strictEqual(r.stdout, '');
        });
    }

    // The pin guard parses exact flag values (not a substring), so `=44` (which
    // contains `min-semi-space-size=4`) must still fail closed before any tier.
    it('pins at 44 must fail closed (substring guard bypass)', () => {
        const r = run(['--expose-gc', '--min-semi-space-size=44', '--max-semi-space-size=44'], { TORTURE_CONTROL: 'mapper-dedup' });
        assert.strictEqual(r.status, 1);
        assert.match(r.stderr, /semi-space-size=4 must be set/);
        assert.strictEqual(r.stdout, '');
    });

    // V8 honours the LAST occurrence of a repeated flag (and accepts the
    // underscore spelling). semiSpacePins() collects EVERY occurrence and the
    // guard fails unless every one is exactly '4', so `=4 ... =64` (which V8
    // would run under a 64 MB semi-space) and `--min_semi_space_size=64` both
    // fail closed before any tier runs.
    for (const [label, extra] of [
        ['repeated flag, last=64', ['--min-semi-space-size=64', '--max-semi-space-size=64']],
        ['underscore spelling =64', ['--min_semi_space_size=64', '--max_semi_space_size=64']]
    ]) {
        it('pins 4 then ' + label + ' must fail closed', () => {
            const r = run(['--expose-gc', ...PINS, ...extra], { TORTURE_CONTROL: 'mapper-dedup' });
            assert.strictEqual(r.status, 1);
            assert.match(r.stderr, /semi-space-size=4 must be set/);
            assert.strictEqual(r.stdout, '');
        });
    }

    // Under --minor-ms V8 reports young-generation GCs as perf_hooks kind 2, not
    // kind 1, which blinds the scavenge watcher (the T6 lane would read 0 while
    // allocating). The entry refuses the flag before any tier (guard 2b), and
    // the detector self-validation (guard 5) would also fail closed on any other
    // blinding. (test:perf independently fails closed here via lite-perf-gate's
    // own detector validation.)
    it('--minor-ms: the entry refuses it (exit 1, no stdout)', () => {
        const r = run(['--expose-gc', ...PINS, '--minor-ms'], { TORTURE_CONTROL: 'foreach-closure', TORTURE_FAST: '1' });
        assert.strictEqual(r.status, 1);
        assert.match(r.stderr, /--minor-ms is unsupported/);
        assert.strictEqual(r.stdout, '');
    });

    // The underscore spelling must be refused too (name normalised before match).
    it('--minor_ms: the entry refuses it (exit 1, no stdout)', () => {
        const r = run(['--expose-gc', ...PINS, '--minor_ms'], { TORTURE_CONTROL: 'foreach-closure', TORTURE_FAST: '1' });
        assert.strictEqual(r.status, 1);
        assert.match(r.stderr, /--minor-ms is unsupported/);
        assert.strictEqual(r.stdout, '');
    });

    // Guard 5 teeth (QA round 4): blind the GC watcher itself with a preload that
    // stubs PerformanceObserver.observe (any future GC-kind change looks like
    // this). The detector self-validation must refuse to run any tier.
    it('a blinded GC watcher fails closed at the detector self-validation (exit 1, no stdout)', () => {
        const blind = 'data:text/javascript,' + encodeURIComponent(
            'import { PerformanceObserver } from "node:perf_hooks";' +
            'PerformanceObserver.prototype.observe = function () {};'
        );
        const r = run(['--expose-gc', ...PINS, '--import', blind]);
        assert.strictEqual(r.status, 1);
        assert.match(r.stderr, /young-GC detector blind \(positive control scavenges=0/);
        assert.doesNotMatch(r.stderr, /\[T0\]/);
        assert.strictEqual(r.stdout, '');
    });

    it('unknown TORTURE_CONTROL: exit 2 with did-you-mean', () => {
        const r = run(['--expose-gc', ...PINS], { TORTURE_CONTROL: 'hasall-fixd' });
        assert.strictEqual(r.status, 2);
        assert.match(r.stderr, /did you mean: hasall-fixed/);
    });

    for (const bad of ['abc', '1.5', '0x10', 'NaN', '1e3', ' ']) {
        it('TORTURE_SEED=' + JSON.stringify(bad) + ': exit 2', () => {
            const r = run(['--expose-gc', ...PINS], { TORTURE_SEED: bad, TORTURE_CONTROL: 'oracle-flip' });
            assert.strictEqual(r.status, 2);
            assert.match(r.stderr, /TORTURE_SEED must be an integer/);
        });
    }

    // out-of-range integers must be rejected (exit 2), not silently wrapped by |0
    for (const over of ['99999999999999999999', '4294967296', '-2147483649']) {
        it('TORTURE_SEED=' + over + ' (out of range): exit 2', () => {
            const r = run(['--expose-gc', ...PINS], { TORTURE_SEED: over, TORTURE_CONTROL: 'oracle-flip' });
            assert.strictEqual(r.status, 2);
            assert.match(r.stderr, /TORTURE_SEED must be an integer/);
        });
    }

    it('a numeric TORTURE_SEED replays (identical stderr twice; -5 aliases 4294967291)', () => {
        const env = { TORTURE_SEED: '12345', TORTURE_CONTROL: 'oracle-flip' };
        const a = run(['--expose-gc', ...PINS], env);
        const b = run(['--expose-gc', ...PINS], env);
        assert.strictEqual(a.status, 1);
        assert.match(a.stderr, /FAIL T5/);
        assert.match(a.stderr, /TORTURE_SEED=12345 npm run torture # op \d+/);
        assert.strictEqual(a.stderr, b.stderr);
        const neg = run(['--expose-gc', ...PINS], { TORTURE_SEED: '-5', TORTURE_CONTROL: 'oracle-flip' });
        const uns = run(['--expose-gc', ...PINS], { TORTURE_SEED: '4294967291', TORTURE_CONTROL: 'oracle-flip' });
        assert.strictEqual(neg.stderr, uns.stderr);
    });
});
