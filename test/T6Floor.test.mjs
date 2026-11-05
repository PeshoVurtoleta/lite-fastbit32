// test/T6Floor.test.mjs -- the T6 V8 floor (CI-5, maintainer ruling 2026-11-05:
// "T6 needs V8 >= 14; named SKIP"). Below V8 14 torture runs every tier except
// T6 and prints a named SKIP line; a control that targets T6 exits 1 with the
// reason and never prints "FAIL T6" (so neither it nor controls-runner can read
// it as ok). harness t6Floor is pure; an unreadable version throws (fail closed).
//
// Version strings: process.versions.v8 of Node 26.8.2 / 24.22.2 / 22.23.4 /
// 20.20.2 / 18.x, plus a bare future version. No row depends on wall time or
// host load; full torture never runs here (only one T6 control, TORTURE_FAST=1).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { t6Floor } from './torture/harness.mjs';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'torture.mjs');
const TORTURE_FLAGS = ['--allow-natives-syntax', '--expose-gc', '--min-semi-space-size=4', '--max-semi-space-size=4'];
const V8_VERSION = process.versions.v8;
const V8_MAJOR = Number(V8_VERSION.split('.')[0]);

describe('t6Floor (pure)', () => {
    for (const v of ['14.6.202.34-node.28', '15.7.37', '14.0.0']) {
        it(JSON.stringify(v) + ' -> null (T6 runs)', () => {
            assert.strictEqual(t6Floor(v), null);
        });
    }
    for (const v of ['13.6.233.17-node.63', '12.4.254.21-node.57', '11.3.244.8-node.38', '10.2.154.26-node.39']) {
        it(JSON.stringify(v) + ' -> the named SKIP reason', () => {
            const why = t6Floor(v);
            assert.strictEqual(typeof why, 'string');
            assert.ok(why.includes('this V8 is ' + v), 'reason lacks the exact version: ' + why);
            assert.ok(why.includes('V8 >= 14'), 'reason lacks "V8 >= 14": ' + why);
            assert.ok(why.startsWith('T6 SKIP: '), 'reason is not a named SKIP: ' + why);
            assert.doesNotMatch(why, /[^\x20-\x7e]/, 'reason is not one ASCII line');
        });
    }
    for (const v of [undefined, '', 'abc', '1x.2', '13', '13.6\n', null, 13.6]) {
        it((typeof v === 'string' ? JSON.stringify(v) : String(v)) + ' -> TypeError (fail closed, never a skip)', () => {
            assert.throws(() => t6Floor(v), TypeError);
        });
    }
});

const RUNNER = join(dirname(ENTRY), 'torture', 'controls-runner.mjs');

function childEnv() {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.TORTURE_SEED;
    return env;
}

function runControl(name) {
    return spawnSync(process.execPath, [...TORTURE_FLAGS, ENTRY], {
        env: { ...childEnv(), TORTURE_CONTROL: name, TORTURE_FAST: '1' },
        encoding: 'utf8',
        timeout: 600000
    });
}

const OLD_SKIP = V8_MAJOR < 11
    ? 'V8 ' + V8_VERSION + ' < 11 (Node 18 leg): torture needs Node 20+'
    : V8_MAJOR >= 14 ? 'V8 ' + V8_VERSION + ' >= 14: T6 runs here (the controls-runner row covers it)' : false;
const RUNNER_SKIP = V8_MAJOR < 11 ? 'V8 ' + V8_VERSION + ' < 11 (Node 18 leg): torture needs Node 20+' : false;

describe('T6 control on this V8 (child torture.mjs, TORTURE_CONTROL=bop-box)', () => {
    it('V8 11-13: refused with the named reason, exit 1, no "FAIL T6"', { skip: OLD_SKIP }, () => {
        const r = runControl('bop-box');
        assert.strictEqual(r.error, undefined, 'spawn failed: ' + (r.error && r.error.message));
        assert.strictEqual(r.status, 1, 'want exit 1, got ' + r.status + ' signal=' + r.signal + '; stderr: ' + r.stderr.slice(-600));
        assert.match(r.stderr, /targets T6, which is skipped here: T6 SKIP/);
        assert.ok(r.stderr.includes('this V8 is ' + V8_VERSION), 'reason lacks this V8 version: ' + r.stderr.slice(-600));
        assert.doesNotMatch(r.stderr, /FAIL T6/);
        assert.strictEqual(r.stdout, '');
    });
});

// The runner's skip predicate (CI-5 review r1, B1). On V8 >= 14 the runner's
// "-> ok" for bop-box already requires the child's exit 1 + "FAIL T6" (the
// control still bites where T6 runs); on V8 11-13 it must skip, counted.
describe('controls-runner bop-box on this V8 (child controls-runner.mjs)', () => {
    it('V8 >= 14: spawned and ok, no SKIP; V8 11-13: a counted named SKIP; exit 0 either way', { skip: RUNNER_SKIP }, () => {
        const r = spawnSync(process.execPath, [...TORTURE_FLAGS, RUNNER, 'bop-box'], { env: childEnv(), encoding: 'utf8', timeout: 600000 });
        assert.strictEqual(r.error, undefined, 'spawn failed: ' + (r.error && r.error.message));
        assert.strictEqual(r.status, 0, 'want exit 0, got ' + r.status + ' signal=' + r.signal + '; stderr: ' + r.stderr.slice(-600));
        if (V8_MAJOR >= 14) {
            assert.strictEqual(r.stdout, 'controls ok\n');
            assert.match(r.stderr, /\[control bop-box\] exit=1 tiers=T6 -> ok/);
            assert.doesNotMatch(r.stderr, /SKIP/);
        } else {
            assert.strictEqual(r.stdout, 'controls ok (1 T6 controls skipped: V8 ' + V8_VERSION + ' < 14)\n');
            assert.ok(r.stderr.includes('[control bop-box] SKIP tiers=T6: T6 SKIP: '), 'no named SKIP line; stderr: ' + r.stderr.slice(-600));
        }
    });
});
