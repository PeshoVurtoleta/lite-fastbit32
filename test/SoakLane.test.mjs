// test/SoakLane.test.mjs -- lane S (NIGHTLY-1) DETERMINISTIC oracle, written from plan-S.md A2 / A3 / A4 and
// rules S-1..S-9 (never from the implementation). O-1: no torture run, no timing; the only spawns are
// `git show` and the fast, pure `soak-lane.mjs seeds` CLI. Every expected value below is a literal from the
// spec (e.g. 16384 / 1024 = 16 postDrainKB entries) or from the real log formats in test/torture*.
// New tests; they fail (import error) until test/nightly/soak-lane.mjs and soak-nightly.yml land.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseSoakCycles } from './torture/harness.mjs';
import { parseSeeds, parseNightlyCycles, checkTortureLog, checkControlsLog } from './nightly/soak-lane.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const LANE = join(HERE, 'nightly', 'soak-lane.mjs');
const WF = join(ROOT, '.github', 'workflows', 'soak-nightly.yml');
const FROZEN = 'e8b4b8e';

// ---- A2 parseSoakCycles ----------------------------------------------------
test('A2 parseSoakCycles: unset / empty -> 4096 (push volume unchanged)', () => {
    assert.equal(parseSoakCycles(undefined), 4096); // mutant: undefined -> null or NaN
    assert.equal(parseSoakCycles(''), 4096);        // mutant: '' parsed as 0 -> null
});

test('A2 parseSoakCycles: accepts the bounds and in-range multiples of 1024', () => {
    assert.equal(parseSoakCycles('4096'), 4096);     // mutant: lower bound exclusive
    assert.equal(parseSoakCycles('131072'), 131072); // mutant: upper bound exclusive / ceiling lowered
    assert.equal(parseSoakCycles('16384'), 16384);
    assert.equal(parseSoakCycles('5120'), 5120);     // 5 * 1024; mutant: only powers of two
});

test('A2 parseSoakCycles: rejects everything else with null', () => {
    const bad = ['4095', '5000', '0', '-4096', '4096.0', ' 8192', '1e4', '0x1000', '132096', '3072', '8192 ', '+8192', '131073', 'abc'];
    for (const s of bad) assert.equal(parseSoakCycles(s), null, 'must reject ' + JSON.stringify(s)); // mutants: Number()/parseInt leniency, wrong range
    assert.equal(parseSoakCycles('135168'), null); // 132 * 1024: multiple of 1024 above the ceiling
});

// ---- A3 parseSeeds / parseNightlyCycles ------------------------------------
test('A3 parseSeeds: space or comma separated -> 3 numbers', () => {
    assert.deepEqual(parseSeeds('1 2 3'), [1, 2, 3]); // mutant: only commas
    assert.deepEqual(parseSeeds('1,2,3'), [1, 2, 3]); // mutant: only spaces
    assert.deepEqual(parseSeeds('4294967295 0 7'), [4294967295, 0, 7]); // uint32 max and zero are valid
});

test('A3 parseSeeds: wrong count / out of range / junk -> null', () => {
    const bad = ['1 2', '1 2 3 4', '4294967296', '-1', '1 2 $(id)', '', '1 2 -1', '1 2 4294967296', '1 2 3.0', '1 2 0x3', '1 2 x', '1,2,', ',1,2,3'];
    for (const s of bad) assert.equal(parseSeeds(s), null, 'must reject ' + JSON.stringify(s)); // mutants: no count check, <= 2**32, parseInt
});

test('A3 parseNightlyCycles: multiple of 1024 in [8192, 65536]', () => {
    assert.equal(parseNightlyCycles('8192'), 8192);   // mutant: lower bound exclusive
    assert.equal(parseNightlyCycles('65536'), 65536); // mutant: upper bound exclusive
    assert.equal(parseNightlyCycles('16384'), 16384);
    for (const s of ['4096', '16000', '66560', '7168', '0', '', '8192.0', '1e4', ' 8192', '131072', '-8192', '65537', '0x2000']) {
        assert.equal(parseNightlyCycles(s), null, 'must reject ' + JSON.stringify(s)); // mutant: reuses the harness range [4096, 131072]
    }
});

// ---- A3 CLI `seeds` ---------------------------------------------------------
function cleanEnv(extra) {
    const env = { ...process.env };
    for (const k of ['TORTURE_FAST', 'TORTURE_CONTROL', 'TORTURE_SEED', 'TORTURE_SOAK_CYCLES', 'SEEDS_IN', 'SOAK_CYCLES_IN', 'GITHUB_ENV', 'GITHUB_STEP_SUMMARY', 'GITHUB_OUTPUT']) delete env[k];
    return { ...env, ...extra };
}
function seedsCli(extra) {
    return spawnSync(process.execPath, [LANE, 'seeds'], { env: cleanEnv(extra), encoding: 'utf8', timeout: 20000 });
}

test('A3 CLI seeds: pinned seeds -> exactly the 3 replay lines first, in order', () => {
    const r = seedsCli({ SEEDS_IN: '5 6 7', SOAK_CYCLES_IN: '16384' });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split('\n');
    assert.deepEqual(lines.slice(0, 3), [
        'replay: TORTURE_SEED=5 TORTURE_SOAK_CYCLES=16384 npm run torture',
        'replay: TORTURE_SEED=6 TORTURE_SOAK_CYCLES=16384 npm run torture',
        'replay: TORTURE_SEED=7 TORTURE_SOAK_CYCLES=16384 npm run torture'
    ]); // mutants: replay line not first, cycles omitted, seeds reordered/dropped
});

test('A3 CLI seeds: comma-separated pin and a non-default volume are echoed', () => {
    const r = seedsCli({ SEEDS_IN: '10,20,4294967295', SOAK_CYCLES_IN: '8192' });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split('\n');
    assert.equal(lines[0], 'replay: TORTURE_SEED=10 TORTURE_SOAK_CYCLES=8192 npm run torture');
    assert.equal(lines[2], 'replay: TORTURE_SEED=4294967295 TORTURE_SOAK_CYCLES=8192 npm run torture'); // mutant: hard-coded cycles
});

test('A3 CLI seeds: no pin -> 3 fresh uint32 seeds, differing between invocations', () => {
    const RE = /^replay: TORTURE_SEED=(\d+) TORTURE_SOAK_CYCLES=16384 npm run torture$/;
    const grab = () => {
        const r = seedsCli({ SEEDS_IN: '', SOAK_CYCLES_IN: '16384' });
        assert.equal(r.status, 0, r.stderr);
        return r.stdout.split('\n').slice(0, 3).map((l) => {
            const m = RE.exec(l);
            assert.ok(m, 'replay line shape: ' + l);
            const n = Number(m[1]);
            assert.ok(Number.isInteger(n) && n >= 0 && n <= 4294967295, 'uint32: ' + m[1]);
            return n;
        });
    };
    const a = grab();
    const b = grab();
    assert.notDeepEqual(a, b); // mutant: constant / fixed default seeds (collision odds ~2^-96)
});

test('A3 / S-4 CLI seeds: bad SEEDS_IN or SOAK_CYCLES_IN exits 1', () => {
    for (const s of ['1 2', '1 2 3 4', '4294967296', '-1', '1 2 $(id)']) {
        assert.equal(seedsCli({ SEEDS_IN: s, SOAK_CYCLES_IN: '16384' }).status, 1, 'SEEDS_IN=' + s); // mutant: CLI ignores parseSeeds null
    }
    for (const c of ['4096', '16000', '66560', '1e4']) {
        assert.equal(seedsCli({ SEEDS_IN: '1 2 3', SOAK_CYCLES_IN: c }).status, 1, 'SOAK_CYCLES_IN=' + c); // mutant: wrong range in the CLI
    }
});

test('S-4 CLI seeds: a non-empty TORTURE_FAST / TORTURE_CONTROL exits 1; empty is fine', () => {
    const ok = { SEEDS_IN: '1 2 3', SOAK_CYCLES_IN: '16384' };
    assert.equal(seedsCli(ok).status, 0); // positive control
    assert.equal(seedsCli({ ...ok, TORTURE_FAST: '1' }).status, 1);        // mutant: guard missing
    assert.equal(seedsCli({ ...ok, TORTURE_CONTROL: 'soak-stash' }).status, 1);
    assert.equal(seedsCli({ ...ok, TORTURE_FAST: '' }).status, 0);         // mutant: "is set" instead of "is non-empty"
    assert.equal(seedsCli({ ...ok, TORTURE_CONTROL: '' }).status, 0);
});

test('B2 CLI seeds: never writes the parent GITHUB_ENV / GITHUB_STEP_SUMMARY / GITHUB_OUTPUT', () => {
    const dir = mkdtempSync(join(tmpdir(), 'soak-test-'));
    const files = { GITHUB_ENV: join(dir, 'env'), GITHUB_STEP_SUMMARY: join(dir, 'sum'), GITHUB_OUTPUT: join(dir, 'out') };
    for (const f of Object.values(files)) writeFileSync(f, '');
    // the parent env carries the CI files; cleanEnv must strip them (mutant: they leak into the child)
    const saved = {};
    for (const k of Object.keys(files)) { saved[k] = process.env[k]; process.env[k] = files[k]; }
    try {
        const r = seedsCli({ SEEDS_IN: '1 2 3', SOAK_CYCLES_IN: '16384' });
        assert.equal(r.status, 0, r.stderr);
    } finally {
        for (const k of Object.keys(files)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
    for (const f of Object.values(files)) assert.equal(readFileSync(f, 'utf8'), '', f);
});

test('B1 CLI check: --cycles "" exits 1 (empty is never push volume)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'soak-test-'));
    const f = join(dir, 't.log');
    writeFileSync(f, tortureLog({ d8: 'ran', entries: 4 })); // clean for 4096 cycles, so only the empty --cycles can fail it
    const run = (cyc) => spawnSync(process.execPath, [LANE, 'check', '--d8', 'ran', '--cycles', cyc, '--torture', f], { env: cleanEnv({}), encoding: 'utf8', timeout: 20000 });
    assert.equal(run('4096').status, 0, 'positive control'); // mutant: check broken for every input
    assert.equal(run('').status, 1);                          // mutant: '' -> 4096 via parseSoakCycles
});

// ---- A4 checker teeth -------------------------------------------------------
const TIERS = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T8', 'T6', 'T7', 'T9']; // torture.mjs ORDER
const D8_RAN = 'MEASURE FastBit1024 d8 pointer-compressed loadFrom lane scavenges=0 per 1e5 loads [gated <=2], box control=5 [gated >=2], result=true';
const D8_SKIP = 'MEASURE FastBit1024 d8 pointer-compressed loadFrom lane SKIP: no d8 on PATH (set FASTBIT_D8)';
// B.B1b (SPEC-fastbit64 X-10 / A1): the T3 FastBit64 SAB race row; lane S legs have >= 3 cores.
const SAB_SKIP = 'MEASURE FastBit64 T3 SAB row SKIP: availableParallelism 2 < 3';
function sabRan(o) {
    return 'MEASURE FastBit64 T3 SAB row shipped fail-open=' + (o.shipped === undefined ? 0 : o.shipped) + ' control(' + (o.ctl || 'reread') + ') fail-open=' + (o.cOpen === undefined ? 37 : o.cOpen) +
        ' chunks=' + (o.chunks === undefined ? 1 : o.chunks) + '/1024 rounds=' + (o.rounds === undefined ? 55 : o.rounds) + ' calls=20000 [gated: shipped 0, control>=20 within 1024 chunks, rounds>=10]';
}

function tortureLog(o) {
    const n = o.entries === undefined ? 16 : o.entries;
    const kb = [];
    for (let i = 0; i < n; i++) kb.push(5000 + i);
    const L = [];
    for (const t of TIERS) L.push(o.t6skip && t === 'T6' ? '[T6] SKIP' : '[' + t + '] fails=0 green=0');
    for (const t of ['T0', 'T3', 'T5']) L.push('[' + t + ' faithful fb1024Img copy] fails=0 green=0');
    L.push('MEASURE FastBit1024 image scavenge lane (saveInto+loadFrom+copy+equals) over 2e6 = 0 [gated <=2]');
    const sab = o.sab || {};
    if (sab.skip) L.push(SAB_SKIP);
    for (let i = 0; i < (sab.ran === undefined ? 1 : sab.ran); i++) L.push(sabRan(sab));
    if (o.d8 === 'ran') L.push(D8_RAN);
    if (o.d8 === 'skip') L.push(D8_SKIP);
    L.push('MEASURE soak live=' + (o.live === undefined ? 0 : o.live) + ' findings=' + (o.findings === undefined ? 0 : o.findings) + ' postDrainKB=[' + kb.join(',') + '] growthKB=' + (o.growth === undefined ? (n > 1 ? 15 : 0) : o.growth));
    if (o.ok !== false) L.push('ok');
    return L.join('\n') + '\n';
}
const nonEmpty = (p) => Array.isArray(p) && p.length >= 1 && p.every((x) => typeof x === 'string' && x.length > 0);

test('A4 checkTortureLog: complete fixtures are clean (positive controls)', () => {
    assert.deepEqual(checkTortureLog(tortureLog({ d8: 'ran' }), { d8: 'ran', cycles: 16384 }), []);   // 16384 / 1024 = 16 entries
    assert.deepEqual(checkTortureLog(tortureLog({ d8: 'skip' }), { d8: 'skip', cycles: 16384 }), []);
    assert.deepEqual(checkTortureLog(tortureLog({ d8: 'ran', entries: 8 }), { d8: 'ran', cycles: 8192 }), []);   // 8192 / 1024 = 8
    assert.deepEqual(checkTortureLog(tortureLog({ d8: 'ran', entries: 64 }), { d8: 'ran', cycles: 65536 }), []); // 65536 / 1024 = 64
});

test('A4 checkTortureLog: d8 SKIP line under d8=ran -> problem', () => {
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'skip' }), { d8: 'ran', cycles: 16384 }))); // mutant: SKIP tolerated on ubuntu
});

test('A4 checkTortureLog: no d8 line at all -> problem under both modes', () => {
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'none' }), { d8: 'ran', cycles: 16384 })));  // mutant: absence read as ok
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'none' }), { d8: 'skip', cycles: 16384 }))); // mutant: macOS leg does not require the named SKIP line
});

test('A4 checkTortureLog: d8 "ran" line under d8=skip -> problem', () => {
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'ran' }), { d8: 'skip', cycles: 16384 }))); // mutant: skip leg accepts either
});

test('A4 checkTortureLog: [T6] SKIP -> problem', () => {
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'ran', t6skip: true }), { d8: 'ran', cycles: 16384 })));   // mutant: T6 SKIP tolerated
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'skip', t6skip: true }), { d8: 'skip', cycles: 16384 }))); // also on the macOS leg
});

test('A4 checkTortureLog: postDrainKB count != cycles / 1024 -> problem', () => {
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'ran', entries: 4 }), { d8: 'ran', cycles: 16384 })));  // knob ignored: push volume
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'ran', entries: 15 }), { d8: 'ran', cycles: 16384 }))); // off by one low
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'ran', entries: 17 }), { d8: 'ran', cycles: 16384 }))); // off by one high (mutant: >=)
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'ran', entries: 16 }), { d8: 'ran', cycles: 8192 })));  // count right for another volume
});

test('A4 checkTortureLog: no final ok -> problem', () => {
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'ran', ok: false }), { d8: 'ran', cycles: 16384 }))); // mutant: ok not required
});

test('S-5 checkTortureLog: T7 heap growth >= 1024 KB, live != 0, findings != 0 -> problem', () => {
    const c = { d8: 'ran', cycles: 16384 };
    assert.deepEqual(checkTortureLog(tortureLog({ d8: 'ran', growth: 1023 }), c), []); // boundary positive control (gate is < 1024)
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'ran', growth: 1024 }), c)));  // mutant: <= 1024 accepted / gate dropped
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'ran', growth: 5000 }), c)));
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'ran', live: 1 }), c)));       // mutant: live not checked
    assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8: 'ran', findings: 2 }), c)));   // mutant: findings not checked
});

test('B.B1b checkTortureLog: T3 FastBit64 SAB row SKIP on a soak leg -> problem (X-10: lane S legs have >= 3 cores)', () => {
    assert.deepEqual(checkTortureLog(tortureLog({ d8: 'ran', sab: { ran: 1 } }), { d8: 'ran', cycles: 16384 }), []); // positive control
    for (const d8 of ['ran', 'skip']) {
        const c = { d8, cycles: 16384 };
        const p = checkTortureLog(tortureLog({ d8, sab: { skip: true, ran: 0 } }), c);
        assert.ok(nonEmpty(p), 'SKIP alone, d8=' + d8);                                   // mutant: SKIP read as a pass
        assert.ok(p.some((x) => x.includes(SAB_SKIP)), 'the SKIP line is named: ' + p.join(' | ')); // mutant: only "line missing" fires
        assert.ok(nonEmpty(checkTortureLog(tortureLog({ d8, sab: { skip: true, ran: 1 } }), c)), 'SKIP beside a ran line, d8=' + d8); // mutant: SKIP ignored when a ran line exists
    }
});

test('B.B1b checkTortureLog: T3 FastBit64 SAB ran line required exactly once, gates met', () => {
    const c = { d8: 'ran', cycles: 16384 };
    const T = (sab) => checkTortureLog(tortureLog({ d8: 'ran', sab }), c);
    assert.deepEqual(T({ cOpen: 20, rounds: 10, chunks: 1024 }), []);  // boundary positive (gates are >= 20, >= 10, <= cap)
    assert.ok(nonEmpty(T({ ran: 0 })));                 // mutant: the row may vanish silently
    assert.ok(nonEmpty(T({ ran: 2 })));                 // mutant: >= 1 instead of exactly 1
    assert.ok(nonEmpty(T({ shipped: 1 })));             // mutant: shipped fail-open not gated
    assert.ok(nonEmpty(T({ cOpen: 19 })));              // mutant: floor off by one / dropped
    assert.ok(nonEmpty(T({ rounds: 9 })));              // mutant: writer rounds not gated
    assert.ok(nonEmpty(T({ chunks: 1025 })));           // mutant: chunks over the cap accepted
    assert.ok(nonEmpty(T({ ctl: 'faithful' })));        // mutant: any control variant accepted
});

test('A4 checkTortureLog: empty log -> problem', () => {
    assert.ok(nonEmpty(checkTortureLog('', { d8: 'ran', cycles: 16384 }))); // mutant: empty text vacuously clean
});

// controls log (stderr lines + stdout `controls ok`), real shapes from controls-runner.mjs
const NAMES = ['alpha', 'beta', 'gamma'];
function controlsLog(o) {
    const L = [];
    for (const n of NAMES) {
        if (n === o.missing) continue;
        if (n === o.bad) { L.push('[control ' + n + '] exit=0 tiers=T0 -> BAD'); continue; }
        if (n === o.skipped) { L.push('[control ' + n + '] SKIP tiers=T6: V8 11.3 < 14'); continue; }
        L.push('[control ' + n + '] exit=1 tiers=T0,T3 -> ok');
    }
    if (o.noDne !== true) L.push('[control does-not-exist] exit=2 -> ok (exit 2)');
    if (o.bad) L.push('1 control(s) misbehaved');
    else L.push(o.okLine === undefined ? 'controls ok' : o.okLine);
    return L.join('\n') + '\n';
}

test('A4 checkControlsLog: complete fixture is clean (positive control)', () => {
    assert.deepEqual(checkControlsLog(controlsLog({}), NAMES), []);
});

test('A4 checkControlsLog: each defect -> >= 1 problem', () => {
    assert.ok(nonEmpty(checkControlsLog(controlsLog({ okLine: '' }).replace(/\n\n/, '\n'), NAMES)), 'no controls ok line'); // mutant: ok line not required
    assert.ok(nonEmpty(checkControlsLog(controlsLog({ okLine: 'controls ok (6 T6 controls skipped: V8 11.3 < 14)' }), NAMES)), 'skipped suffix'); // mutant: prefix match
    assert.ok(nonEmpty(checkControlsLog(controlsLog({ missing: 'beta' }), NAMES)), 'one control missing'); // mutant: count-only / first-only check
    assert.ok(nonEmpty(checkControlsLog(controlsLog({ missing: 'gamma' }), NAMES)), 'last control missing'); // mutant: off-by-one loop
    assert.ok(nonEmpty(checkControlsLog(controlsLog({ bad: 'alpha' }), NAMES)), '-> BAD'); // mutant: BAD ignored
    assert.ok(nonEmpty(checkControlsLog(controlsLog({ skipped: 'beta' }), NAMES)), 'SKIP line instead of ok'); // mutant: SKIP counted as ok
    assert.ok(nonEmpty(checkControlsLog(controlsLog({ noDne: true }), NAMES)), 'does-not-exist line missing'); // mutant: only CONTROL_NAMES checked
});

test('S-6 checkControlsLog: a SKIP / BAD line for a control outside names -> problem', () => {
    // names lists only alpha, beta; gamma's non-ok line must still count (mutant: unlisted names ignored)
    const base = (g) => controlsLog({}).replace(/\[control gamma\].*/, g);
    assert.deepEqual(checkControlsLog(base('[control gamma] exit=1 tiers=T0,T3 -> ok'), ['alpha', 'beta']), []); // positive control
    assert.ok(nonEmpty(checkControlsLog(base('[control gamma] SKIP tiers=T6: V8 11.3 < 14'), ['alpha', 'beta'])));
    assert.ok(nonEmpty(checkControlsLog(base('[control gamma] exit=0 tiers=T0 -> BAD'), ['alpha', 'beta'])));
});

test('A4 checkControlsLog: a name with no log line is not satisfied by a different name', () => {
    // mutant: substring/any `-> ok` count instead of per-name. 'alpha' has no line; two others + dne give 3 ok lines.
    assert.ok(nonEmpty(checkControlsLog(controlsLog({ missing: 'alpha' }), NAMES)));
    assert.deepEqual(checkControlsLog(controlsLog({}), ['alpha', 'beta']), []); // extra lines for unlisted names are not a problem here
});

// ---- workflow text (S-1, S-2, S-4, S-8) ------------------------------------
const wfText = () => {
    assert.ok(existsSync(WF), 'soak-nightly.yml must exist');
    return readFileSync(WF, 'utf8');
};
const noComments = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

// run: blocks by indentation. A block scalar (| or >) owns every following line that is blank or indented deeper
// than the `run:` key; an inline `run: cmd` is its own block.
function runBlocks(text) {
    const lines = text.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const m = /^(\s*(?:-\s+)?)run:\s*(.*)$/.exec(lines[i]);
        if (!m) continue;
        const keyIndent = m[1].length;
        const val = m[2];
        if (/^[|>][+-]?\d*\s*(#.*)?$/.test(val)) {
            const body = [];
            let j = i + 1;
            while (j < lines.length && (lines[j].trim() === '' || lines[j].match(/^\s*/)[0].length > keyIndent)) { body.push(lines[j]); j++; }
            out.push(body.join('\n'));
            i = j - 1;
        } else {
            out.push(val);
        }
    }
    return out;
}

test('S-4 workflow: run-block extractor sanity (parser itself is not vacuous)', () => {
    const sample = 'steps:\n  - name: a\n    run: |\n      echo one\n      echo ${{ x }}\n  - name: b\n    run: echo two\n    env:\n      K: ${{ y }}\n';
    const b = runBlocks(sample);
    assert.equal(b.length, 2);
    assert.ok(b[0].includes('${{') && b[0].includes('echo one'));
    assert.equal(b[1], 'echo two'); // env: ${{ y }} after the inline run is NOT in a run block
});

test('S-4 workflow: no run: block contains ${{; there is at least one run block', () => {
    const blocks = runBlocks(wfText());
    assert.ok(blocks.length >= 5, 'run blocks found: ' + blocks.length); // mutant: parser finds nothing -> vacuous pass
    for (const b of blocks) assert.ok(!b.includes('${{'), 'expression inside run: ' + b.slice(0, 80)); // mutant: input interpolated into the shell
});

test('S-4 workflow: inputs reach the shell only via SEEDS_IN / SOAK_CYCLES_IN env', () => {
    const t = noComments(wfText());
    assert.match(t, /SEEDS_IN:\s*\$\{\{[^}]*inputs\.seeds/);
    assert.match(t, /SOAK_CYCLES_IN:\s*\$\{\{[^}]*inputs\.[a-z_]+/);
});

test('S-1 workflow: no continue-on-error anywhere (comments excluded)', () => {
    assert.ok(!/continue-on-error/.test(noComments(wfText()))); // mutant: a step softened to non-gating
});

test('S-1 workflow: permissions contents read, no write grants', () => {
    const t = noComments(wfText());
    assert.match(t, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
    assert.ok(!/:\s*write\b/.test(t), 'no write permission'); // mutant: contents: write
});

test('S-1 workflow: concurrency cancel-in-progress false; triggers cron 23 3 + workflow_dispatch', () => {
    const t = noComments(wfText());
    assert.match(t, /cancel-in-progress:\s*false/);
    assert.ok(!/cancel-in-progress:\s*true/.test(t));
    const crons = t.match(/cron:\s*['"]([^'"]+)['"]/g) || [];
    assert.equal(crons.length, 1);
    assert.match(crons[0], /cron:\s*['"]23 3 \* \* \*['"]/); // mutant: reuses nightly's 41 4 or lane P's slot
    assert.match(t, /^\s*workflow_dispatch:/m);
    assert.match(t, /^\s*schedule:/m);
});

test('S-2 workflow: fail-fast false, check-latest true, no npm test', () => {
    const t = noComments(wfText());
    assert.match(t, /fail-fast:\s*false/);
    assert.match(t, /check-latest:\s*true/);
    for (const b of runBlocks(t)) assert.ok(!/\bnpm\s+test\b/.test(b), 'npm test belongs to nightly.yml'); // mutant: lane duplicates npm test
});

test('S-2 workflow: matrix is include-only with exactly the 3 legs', () => {
    const t = noComments(wfText());
    const lines = t.split('\n');
    const mi = lines.findIndex((l) => /^\s*matrix:\s*$/.test(l));
    assert.ok(mi >= 0, 'matrix: block');
    const mIndent = lines[mi].match(/^\s*/)[0].length;
    let end = mi + 1;
    while (end < lines.length && (lines[end].trim() === '' || lines[end].match(/^\s*/)[0].length > mIndent)) end++;
    const block = lines.slice(mi + 1, end).join('\n');
    assert.match(block, /^\s*include:/m);
    assert.ok(!/^\s*(exclude|os|node|d8):\s*\[/m.test(block), 'no cross-product axes'); // mutant: axis list -> extra legs
    assert.ok(!/^\s*exclude:/m.test(block));
    const inc = block.slice(block.search(/include:/) + 'include:'.length);
    // entries start at '- ' ; flow `{ os: a, node: b }` or block style both reduce to key: value pairs
    const entries = inc.split(/^\s*-\s+/m).slice(1).map((e) => {
        const kv = {};
        const re = /\b(os|node|d8)\s*:\s*['"]?([A-Za-z0-9._-]+)['"]?/g;
        let m;
        while ((m = re.exec(e)) !== null) kv[m[1]] = m[2];
        return kv;
    });
    assert.equal(entries.length, 3, 'exactly 3 legs');
    const sig = entries.map((e) => (/^ubuntu/.test(e.os) ? 'ubuntu' : /^macos/.test(e.os) ? 'macos' : '?') + '|' + e.node + '|' + e.d8).sort();
    assert.deepEqual(sig, ['macos|latest|skip', 'ubuntu|26.8.2|ran', 'ubuntu|latest|ran']); // mutants: d8 flag flipped, wrong pin, extra/missing leg
});

test('S-8 workflow: artifact upload always, 90 days, error if empty, named per run + attempt', () => {
    const t = noComments(wfText());
    assert.match(t, /retention-days:\s*90\b/);
    assert.ok(!/retention-days:\s*(?!90\b)\d+/.test(t), 'no other retention'); // mutant: 30 / 7 on a second upload
    assert.match(t, /if-no-files-found:\s*error/);
    assert.match(t, /if:\s*always\(\)/);
    assert.match(t, /name:\s*soak-\$\{\{[^}]*\}\}-node-\$\{\{[^}]*\}\}-\$\{\{\s*github\.run_id\s*\}\}-\$\{\{\s*github\.run_attempt\s*\}\}/);
});

// ---- ci.yml / nightly.yml byte-identical to the frozen commit ---------------
for (const f of ['ci.yml', 'nightly.yml']) {
    test('S-1 workflow: ' + f + ' is byte-equal to git show ' + FROZEN, () => {
        const rel = '.github/workflows/' + f;
        const g = spawnSync('git', ['show', FROZEN + ':' + rel], { cwd: ROOT, maxBuffer: 1 << 24 });
        assert.equal(g.status, 0, 'git show failed (fail closed): ' + String(g.stderr)); // no git -> red, never skip
        assert.ok(g.stdout.length > 100);
        assert.ok(Buffer.compare(g.stdout, readFileSync(join(ROOT, rel))) === 0, rel + ' drifted from ' + FROZEN); // mutant: lane edits a shared workflow
    });
}
