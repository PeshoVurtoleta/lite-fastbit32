// test/nightly/soak-lane.mjs -- lane S (soak-nightly.yml) helpers: input guards,
// log checkers and the per-leg result record. DETERMINISTIC: no timing, no
// torture spawn; the workflow runs torture itself and hands the logs here.
//
//   node test/nightly/soak-lane.mjs seeds  [--out <dir>]
//       env SEEDS_IN (''= 3 fresh crypto.randomInt seeds, else exactly 3 decimal
//       uint32, space / comma separated), SOAK_CYCLES_IN (multiple of 1024 in
//       [8192, 65536]). Refuses a non-empty TORTURE_FAST / TORTURE_CONTROL. The
//       first 3 stdout lines are the replay commands; then GITHUB_ENV gets
//       SOAK_SEED_1..3 + NIGHTLY_CYCLES, GITHUB_STEP_SUMMARY the replay lines,
//       <dir>/seeds.json the record. Exit 1 on any bad value, before any torture.
//   node test/nightly/soak-lane.mjs check --d8 ran|skip --cycles <n>
//       [--torture <log>]... [--controls <log>] [--soak-controls <log>]
//       Exit 1 when any log shows a problem (each printed), else "check ok".
//   node test/nightly/soak-lane.mjs result --out <dir>
//       Writes <dir>/soak-result.json from <dir>/seeds.json + the OUTCOME_* env.
//
// Importing this module runs nothing (the CLI is guarded on argv[1]).

import { randomInt } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cpus, loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseSoakCycles } from '../torture/harness.mjs';

export const NIGHTLY_DEFAULT_CYCLES = 16384;
export const SOAK_CONTROL_NAMES = ['soak-stash', 'soak-retain'];
// torture.mjs ORDER, then the three control-fidelity rows
export const TIER_NAMES = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T8', 'T6', 'T7', 'T9'];
export const FAITHFUL_NAMES = ['T0', 'T3', 'T5'];

const U32_MAX = 4294967295;

// Exactly 3 decimal uint32 (no sign, no leading zero, no exponent), separated by
// whitespace or one comma. Returns the numbers, or null.
export function parseSeeds(s) {
    if (typeof s !== 'string') return null;
    const t = s.trim();
    if (t === '') return null;
    const parts = t.split(/\s*,\s*|\s+/);
    if (parts.length !== 3) return null;
    const out = [];
    for (const p of parts) {
        if (!/^(0|[1-9]\d{0,9})$/.test(p)) return null;
        const n = Number(p);
        if (!(n <= U32_MAX)) return null;
        out.push(n);
    }
    return out;
}

// Nightly volume guard: a harness-valid TORTURE_SOAK_CYCLES that is also in
// [8192, 65536] (at least 2x the push volume, at most 64 segments per seed).
export function parseNightlyCycles(s) {
    if (typeof s !== 'string' || s === '') return null;
    const n = parseSoakCycles(s);
    if (n === null || !(n >= 8192) || !(n <= 65536)) return null;
    return n;
}

function linesOf(text) {
    return String(text).split(/\r?\n/);
}

function countExact(lines, want) {
    let n = 0;
    for (const l of lines) if (l === want) n++;
    return n;
}

const D8_RAN = /^MEASURE FastBit1024 d8 pointer-compressed loadFrom lane scavenges=(\S+) per 1e5 loads \[gated <=2\], box control=(\S+) \[gated >=2\], result=(\S+)$/;
const D8_SKIP = /^MEASURE FastBit1024 d8 pointer-compressed loadFrom lane SKIP: \S/;
// B-S1 T3 FastBit64 SAB race row (t3-adversarial.mjs fb64SabMeasureLine). Lane S legs
// have >= 3 cores (SPEC-fastbit64 A1 / X-10), so its SKIP line is a problem there,
// and the ran line must appear exactly once with its gates met.
const FB64_SAB_RAN = /^MEASURE FastBit64 T3 SAB row shipped fail-open=(\S+) control\((\S+)\) fail-open=(\S+) chunks=(\S+)\/(\S+) rounds=(\S+) calls=(\S+) \[gated: [^\]]*\]$/;
const FB64_SAB_SKIP = 'MEASURE FastBit64 T3 SAB row SKIP';
const SOAK = /^MEASURE soak live=(\S+) findings=(\S+) postDrainKB=\[([^\]]*)\] growthKB=(\S+)$/;

// Problems in ONE `npm run torture` log (stdout + stderr). [] = clean.
export function checkTortureLog(text, opts) {
    const problems = [];
    const d8 = opts && opts.d8;
    const cycles = opts && opts.cycles;
    if (d8 !== 'ran' && d8 !== 'skip') problems.push('option d8 must be "ran" or "skip", got ' + JSON.stringify(d8));
    if (!(Number.isInteger(cycles) && parseSoakCycles(String(cycles)) === cycles)) {
        problems.push('option cycles must be a multiple of 1024 in [4096, 131072], got ' + JSON.stringify(cycles));
    }
    if (typeof text !== 'string' || text === '') {
        problems.push('empty torture log');
        return problems;
    }
    const lines = linesOf(text);

    const okLines = countExact(lines, 'ok');
    if (okLines !== 1) problems.push('stdout "ok" line count ' + okLines + ' (want 1)');

    for (const t of TIER_NAMES) {
        const n = countExact(lines, '[' + t + '] fails=0 green=0');
        if (n !== 1) problems.push('tier ' + t + ': "[' + t + '] fails=0 green=0" seen ' + n + ' times (want 1)');
    }
    for (const t of FAITHFUL_NAMES) {
        const want = '[' + t + ' faithful fb1024Img copy] fails=0 green=0';
        const n = countExact(lines, want);
        if (n !== 1) problems.push('control fidelity ' + t + ': "' + want + '" seen ' + n + ' times (want 1)');
    }
    for (const l of lines) {
        if (l.startsWith('[T6] SKIP') || l.startsWith('T6 SKIP')) problems.push('T6 skipped: ' + l);
        else if (/^(FAIL|TODO\/FAIL)\b/.test(l)) problems.push('failure line: ' + l);
        else if (l.startsWith('torture: ')) problems.push('guard line: ' + l);
    }

    // soak volume: one postDrainKB entry per 1024-cycle segment
    const soak = [];
    for (const l of lines) { const m = SOAK.exec(l); if (m) soak.push(m); }
    if (soak.length !== 1) {
        problems.push('MEASURE soak line seen ' + soak.length + ' times (want 1)');
    } else {
        const m = soak[0];
        const kb = m[3] === '' ? [] : m[3].split(',');
        if (Number.isInteger(cycles) && kb.length !== cycles / 1024) {
            problems.push('soak volume: ' + kb.length + ' postDrainKB entries, want ' + (cycles / 1024) + ' (cycles ' + cycles + ' / 1024) -- TORTURE_SOAK_CYCLES not applied');
        }
        if (m[1] !== '0' || m[2] !== '0') problems.push('soak live=' + m[1] + ' findings=' + m[2] + ' (want 0 / 0)');
        if (!(Number(m[4]) < 1024)) problems.push('soak growthKB=' + m[4] + ' (want < 1024)');
    }

    // T3 FastBit64 SAB row: never skipped on a soak leg; one ran line, gates met
    const sab = [];
    for (const l of lines) {
        const m = FB64_SAB_RAN.exec(l);
        if (m) sab.push(m);
        else if (l.startsWith(FB64_SAB_SKIP)) problems.push('T3 FastBit64 SAB row skipped on a soak leg (lane S legs have >= 3 cores): ' + l);
    }
    if (sab.length !== 1) problems.push('T3 FastBit64 SAB row line seen ' + sab.length + ' times (want 1)');
    else {
        const [, shipped, ctl, cOpen, chunks, cap, rounds] = sab[0];
        if (shipped !== '0' || ctl !== 'reread' || !(Number(cOpen) >= 20) || !(Number(chunks) <= Number(cap)) || !(Number(rounds) >= 10)) {
            problems.push('T3 FastBit64 SAB row shipped fail-open=' + shipped + ' control(' + ctl + ') fail-open=' + cOpen + ' chunks=' + chunks + '/' + cap + ' rounds=' + rounds + ' (want 0, reread, >= 20, chunks <= cap, >= 10)');
        }
    }

    // d8 lane: "ran" = the scavenges line with its gates met; "skip" = the named SKIP line
    const ran = [];
    let skips = 0;
    for (const l of lines) {
        const m = D8_RAN.exec(l);
        if (m) ran.push(m);
        else if (D8_SKIP.test(l)) skips++;
    }
    if (d8 === 'ran') {
        if (skips > 0) problems.push('d8 lane SKIPPED on a d8=ran leg');
        if (ran.length !== 1) problems.push('d8 loadFrom lane line seen ' + ran.length + ' times (want 1 on a d8=ran leg)');
        else {
            const [, loads, box, result] = ran[0];
            if (!(Number(loads) <= 2) || !(Number(box) >= 2) || result !== 'true') {
                problems.push('d8 lane scavenges=' + loads + ' box=' + box + ' result=' + result + ' (want <= 2, >= 2, true)');
            }
        }
    } else if (d8 === 'skip') {
        if (ran.length > 0) problems.push('d8 lane RAN on a d8=skip leg');
        if (skips !== 1) problems.push('d8 "lane SKIP:" line seen ' + skips + ' times (want 1 on a d8=skip leg)');
    }
    return problems;
}

// Problems in ONE `npm run torture:controls [-- names]` log. `names` = the
// controls that must each print exactly one "-> ok" line; does-not-exist is
// always required (the runner always runs it).
export function checkControlsLog(text, names) {
    const problems = [];
    if (!Array.isArray(names) || names.length === 0) problems.push('names must be a non-empty array');
    if (typeof text !== 'string' || text === '') {
        problems.push('empty controls log');
        return problems;
    }
    const lines = linesOf(text);
    const okLines = countExact(lines, 'controls ok');
    if (okLines !== 1) problems.push('stdout "controls ok" line count ' + okLines + ' (want exactly 1)');
    const want = new Set(Array.isArray(names) ? names : []);
    const seen = new Map();
    for (const l of lines) {
        if (l.startsWith('controls ok (')) problems.push('controls skipped: ' + l);
        else if (/misbehaved/.test(l)) problems.push('failure line: ' + l);
        const m = /^\[control (\S+)\] (.*)$/.exec(l);
        if (!m) continue;
        const name = m[1];
        const rest = m[2];
        if (name === 'does-not-exist') {
            if (rest !== 'exit=2 -> ok (exit 2)') problems.push('does-not-exist: ' + rest);
            seen.set(name, (seen.get(name) || 0) + 1);
            continue;
        }
        // a control outside `names` is not required, but a SKIP or a non-ok line still counts
        if (/^SKIP\b/.test(rest)) problems.push('control ' + name + ' skipped: ' + rest);
        else if (!want.has(name)) { if (!/^exit=1 tiers=\S+ -> ok$/.test(rest)) problems.push('control ' + name + ' not ok: ' + rest); }
        else if (!/^exit=1 tiers=\S+ -> ok$/.test(rest)) problems.push('control ' + name + ' not ok: ' + rest);
        else seen.set(name, (seen.get(name) || 0) + 1);
    }
    for (const n of [...want, 'does-not-exist']) {
        const c = seen.get(n) || 0;
        if (c !== 1) problems.push('control ' + n + ': ' + c + ' ok line(s) (want 1)');
    }
    return problems;
}

// ---- CLI (cold) ---------------------------------------------------------------

function replayLine(seed, cycles) {
    return 'replay: TORTURE_SEED=' + seed + ' TORTURE_SOAK_CYCLES=' + cycles + ' npm run torture';
}

function argOf(argv, flag) {
    const out = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === flag) out.push(argv[i + 1]);
    return out;
}

function checkFlags(argv, known, cmd) {
    for (let i = 0; i < argv.length; i += 2) {
        if (!known.includes(argv[i]) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) {
            console.error('soak-lane ' + cmd + ': bad argument ' + JSON.stringify(argv[i]) + ' (flags: ' + known.join(' ') + ', each with a value)');
            return false;
        }
    }
    return true;
}

function cmdSeeds(argv) {
    if (!checkFlags(argv, ['--out'], 'seeds')) return 1;
    const env = process.env;
    for (const k of ['TORTURE_FAST', 'TORTURE_CONTROL', 'TORTURE_SOAK_CYCLES']) {
        if (env[k] !== undefined && env[k] !== '') {
            console.error('soak-lane seeds: ' + k + ' must be unset for the soak lane, got ' + JSON.stringify(env[k]));
            return 1;
        }
    }
    const cyclesIn = env.SOAK_CYCLES_IN;
    const cycles = parseNightlyCycles(cyclesIn === undefined ? '' : cyclesIn);
    if (cycles === null) {
        console.error('soak-lane seeds: SOAK_CYCLES_IN must be a decimal multiple of 1024 in [8192, 65536] (nightly default ' + NIGHTLY_DEFAULT_CYCLES + '), got ' + JSON.stringify(cyclesIn));
        return 1;
    }
    const seedsIn = env.SEEDS_IN === undefined ? '' : env.SEEDS_IN;
    let seeds;
    let source;
    if (seedsIn.trim() === '') {
        seeds = [randomInt(0, 2 ** 32), randomInt(0, 2 ** 32), randomInt(0, 2 ** 32)];
        source = 'fresh';
    } else {
        seeds = parseSeeds(seedsIn);
        source = 'dispatch';
        if (seeds === null) {
            console.error('soak-lane seeds: SEEDS_IN must be exactly 3 decimal uint32 (space or comma separated), got ' + JSON.stringify(seedsIn));
            return 1;
        }
    }
    // the replay lines come first, before anything else this step prints
    for (const s of seeds) console.log(replayLine(s, cycles));
    console.log('seed source: ' + source + ', cycles ' + cycles);
    if (env.GITHUB_ENV) {
        appendFileSync(env.GITHUB_ENV, 'SOAK_SEED_1=' + seeds[0] + '\nSOAK_SEED_2=' + seeds[1] + '\nSOAK_SEED_3=' + seeds[2] + '\nNIGHTLY_CYCLES=' + cycles + '\n');
    }
    if (env.GITHUB_STEP_SUMMARY) {
        appendFileSync(env.GITHUB_STEP_SUMMARY, '### soak seeds (' + source + ')\n\n```\n' + seeds.map((s) => replayLine(s, cycles)).join('\n') + '\n```\n');
    }
    const out = argOf(argv, '--out')[0];
    if (out !== undefined) {
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'seeds.json'), JSON.stringify({ seeds, cycles, seed_source: source, loadBefore: loadavg() }, null, 2) + '\n');
    }
    return 0;
}

async function cmdCheck(argv) {
    if (!checkFlags(argv, ['--d8', '--cycles', '--torture', '--controls', '--soak-controls'], 'check')) return 1;
    const tort = argOf(argv, '--torture');
    const ctl = argOf(argv, '--controls');
    const soak = argOf(argv, '--soak-controls');
    if (tort.length + ctl.length + soak.length === 0) {
        console.error('soak-lane check: no log given (--torture / --controls / --soak-controls)');
        return 1;
    }
    const d8 = argOf(argv, '--d8')[0];
    const cyclesArg = argOf(argv, '--cycles')[0];
    // '' is NOT the push default here: a missing or empty --cycles fails every torture log
    const cycles = (cyclesArg === undefined || cyclesArg === '') ? null : parseSoakCycles(cyclesArg);
    const read = (f) => { try { return readFileSync(f, 'utf8'); } catch (e) { return ''; } };
    const all = [];
    for (const f of tort) {
        if (cycles === null) { all.push(f + ': --cycles missing or invalid (' + JSON.stringify(cyclesArg) + ')'); continue; }
        for (const p of checkTortureLog(read(f), { d8, cycles })) all.push(f + ': ' + p);
    }
    if (ctl.length > 0) {
        const { CONTROL_NAMES } = await import('../torture/controls.mjs');
        for (const f of ctl) for (const p of checkControlsLog(read(f), CONTROL_NAMES)) all.push(f + ': ' + p);
    }
    for (const f of soak) for (const p of checkControlsLog(read(f), SOAK_CONTROL_NAMES)) all.push(f + ': ' + p);
    for (const p of all) console.error('soak-lane check: ' + p);
    if (all.length > 0) {
        console.error('soak-lane check: ' + all.length + ' problem(s)');
        return 1;
    }
    console.log('check ok (' + (tort.length + ctl.length + soak.length) + ' log(s))');
    return 0;
}

const OUTCOME_KEYS = ['SEEDS', 'INSTALL', 'D8', 'SEED_1', 'SEED_2', 'SEED_3', 'CONTROLS', 'SOAK_CONTROLS'];

function cmdResult(argv) {
    if (!checkFlags(argv, ['--out'], 'result')) return 1;
    const out = argOf(argv, '--out')[0];
    if (out === undefined) { console.error('soak-lane result: --out <dir> is required'); return 1; }
    mkdirSync(out, { recursive: true });
    const env = process.env;
    let seeds = null;
    const sp = join(out, 'seeds.json');
    if (existsSync(sp)) { try { seeds = JSON.parse(readFileSync(sp, 'utf8')); } catch (e) { seeds = null; } }
    const outcome = {};
    for (const k of OUTCOME_KEYS) outcome[k.toLowerCase()] = env['OUTCOME_' + k] || 'unknown';
    const rec = {
        commit: env.GITHUB_SHA || null,
        event: env.GITHUB_EVENT_NAME || null,
        run_id: env.GITHUB_RUN_ID || null,
        run_attempt: env.GITHUB_RUN_ATTEMPT || null,
        seed_source: seeds ? seeds.seed_source : null,
        seeds: seeds ? seeds.seeds : null,
        cycles: seeds ? seeds.cycles : null,
        node: process.version,
        v8: process.versions.v8,
        os: env.MATRIX_OS || process.platform,
        cpus: cpus().length,
        loadBefore: seeds ? seeds.loadBefore : null,
        loadAfter: loadavg(),
        d8: env.D8_VERSION ? { version: env.D8_VERSION, path: env.FASTBIT_D8 || null } : { skip: env.D8_SKIP_REASON || 'no d8 step outcome recorded' },
        outcome
    };
    writeFileSync(join(out, 'soak-result.json'), JSON.stringify(rec, null, 2) + '\n');
    console.log(JSON.stringify(rec));
    return 0;
}

async function main(argv) {
    const cmd = argv[0];
    if (cmd === 'seeds') return cmdSeeds(argv.slice(1));
    if (cmd === 'check') return cmdCheck(argv.slice(1));
    if (cmd === 'result') return cmdResult(argv.slice(1));
    console.error('usage: node test/nightly/soak-lane.mjs seeds|check|result [flags] (see the file header)');
    return 1;
}

function isMain() {
    if (process.argv[1] === undefined) return false;
    try { return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch (e) { return false; }
}

if (isMain()) {
    process.exitCode = await main(process.argv.slice(2));
}
