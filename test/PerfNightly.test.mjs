/**
 * Lane P (test/perf-nightly.mjs) -- DETERMINISTIC tests (SPEC-nightly O-1): every spawn is a
 * stub, no witness round, no timing, no quiet lock. Oracle: SPEC section P (P-1..P-9) and
 * "P ASSERTIONS" A1-A5, NOT the implementation. Row-line fixtures follow the witness.mjs
 * line grammar documented in test/witness-release.mjs (the parser under test there).
 * Each assertion names the mutant it kills ("kills:").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ANCHOR, CONTROL_KEY, ORDER, SCHEMA, slowedText, parityPairs, buildSlowedRoot, runNight, verdictOf,
  rowStats, guardInputs, nightJson, summaryMarkdown, parseArgs, main,
} from './perf-nightly.mjs';
import {
  K, MAJORITY, REAL_KEYS, TEETH_KEYS, runRelease, roundRecord, decide,
} from './witness-release.mjs';
import { CONST_OPS } from './witness.mjs';
import { spawnSync } from 'node:child_process';

test('B2 control key is the SPEC P-4 literal and a real row', () => {
  // kills: CONTROL_KEY = 'FLAT countMasked (position)' (or any other row)
  assert.equal(CONTROL_KEY, SPEC_CONTROL_KEY);
  assert.ok(REAL_KEYS.includes(SPEC_CONTROL_KEY));
});
let dirSeq = 0;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const OTHER_REAL = 'FLAT has (density)';             // a real row that is not the control

// ---------------------------------------------------------------- fixtures: witness FAST stdout
function rowLine(key, fail, sp) {
  const name = key.slice(key.indexOf(' ') + 1);
  if (key.startsWith('FLAT ')) {
    return `  FLAT HOT ${name} ratio=1.00/2.00 spread=0.50ns=${sp}N/2.00N [1.00,2.00] ${fail ? 'FAIL' : 'ok'}`;
  }
  if (key.startsWith('RED ')) {
    return `  RED  HOT ${name} ratio=1.00(info) spread=0.50ns=${sp}N>=2.00N ${fail ? 'FAIL(came out flat)' : 'ok(non-flat)'}`;
  }
  if (key.startsWith('SLOPE ')) {
    const teeth = TEETH_KEYS.includes(key);
    const v = fail ? (teeth ? 'FAIL(foil passed as linear)' : 'FAIL(lin)') : (teeth ? 'ok(foil rejected by: a,b)' : 'ok');
    return `  SLOPE HOT ${name} r2=0.99 slope=1.00 a=1.00=1.00xslope rise=1.00N curv=0.10 resid=1.00ns=1.00xslope ${v}`;
  }
  if (key === 'SELF repeat') return `  SELF repeat count@d4,8,16 two processes |a-b|=[1,2,3] tol=1.00N=2.00 ${fail ? 'FAIL' : 'ok'}`;
  if (key === 'CTRL broken-floor') return `  CTRL HOT broken-floor (Kernighan floor) net=[1,2] negative-cell gate ${fail ? 'FAIL(did not fire)' : 'fired ok'}`;
  if (key === 'CTRL self-check control') return `  CTRL self-check control count vs Kernighan |a-c|=[1,2,3] ${fail ? 'FAIL(agreed)' : 'disagrees ok'}`;
  if (key === 'CTRL confirm-slope') {
    return `  CTRL confirm-slope foilIterStep as a real iterator: process 1 linear; not re-measured ${fail ? 'FAIL(ended linear: no teeth)' : 'ok(non-linear: a)'}`;
  }
  throw new Error('fixture: no line for ' + key);
}
const ALL_KEYS = [...REAL_KEYS, ...TEETH_KEYS];

/** A witness:fast round's spawn result. fails: array of row keys; mode 'ok'|'host'. */
function roundOut(fails = [], mode = 'ok', idx = 0) {
  const nz = 2 * CONST_OPS.length;
  const failSet = new Set(fails);
  const L = [];
  if (mode === 'host') L.push(`  NOISE HOT 100.0 ns (median cell-to-cell spread of ${nz} real-op rows; pass dispersion median 1.0 ns), floor 50.0 ns, noise/floor=9.0 max=5.0 FAIL; EPS=1.0N=3.0 ns`);
  else L.push(`  NOISE HOT 100.0 ns (median cell-to-cell spread of ${nz} real-op rows; pass dispersion median 1.0 ns), floor 50.0 ns, noise/floor=2.0 max=5.0 ok; EPS=1.0N=3.0 ns`);
  for (const k of ALL_KEYS) L.push(rowLine(k, failSet.has(k), (idx + 1).toFixed(1)));
  if (mode === 'host') {
    L.push('witness FAST done in 14.0s -- 1 FAIL', 'FAILURES:', '  NOISE HOT: noise/floor over the cap', '',
      'HOST: re-run on a quiet host -- noise');
    return { status: 2, signal: null, stdout: L.join('\n') + '\n' };
  }
  const n = failSet.size;
  L.push(`witness FAST done in 14.0s -- ${n === 0 ? 'ok' : n + ' FAIL'}`);
  if (n) { L.push('FAILURES:'); for (const k of fails) L.push('  ' + k); }
  return { status: n ? 1 : 0, signal: null, stdout: L.join('\n') + '\n' };
}
const HARNESS_OUT = { status: null, signal: 'SIGTERM', stdout: '' };

/** plan entry: 'ok' | 'host' | 'harness' | string[] of failing keys. */
function planRound(p, idx) {
  if (p === 'harness') return { ...HARNESS_OUT };
  if (p === 'ok') return roundOut([], 'ok', idx);
  if (p === 'host') return roundOut([], 'host', idx);
  return roundOut(p, 'ok', idx);
}
const rep = (p) => [p, p, p, p, p];
const SPEC_CONTROL_KEY = 'FLAT countMasked (density)';   // SPEC P-4, a literal (not the implementation's constant)
const TRIP = rep([SPEC_CONTROL_KEY]);                         // arm B: control FAIL 5/5

const FAKE_BUILD = async () => ({
  root: '/nonexistent/slowed-root', sha: 'b'.repeat(64), liveSha: 'a'.repeat(64), parity: { pairs: 4096, equal: 4096 },
});
function stubOpts(plans, extra = {}) {
  const calls = [], rmd = [], envs = [];
  let t = 0;
  return {
    calls, rmd, envs,
    opts: {
      spawn: (arm, env, round, witness) => { calls.push(arm); envs.push(env); return planRound(plans[arm][round], round); },
      build: FAKE_BUILD, rm: (r) => rmd.push(r), now: () => (t += 1000), load1: () => 0.5, loadavg: () => [0.1, 0.2, 0.3],
      env: {}, log: () => {}, ...extra,
    },
  };
}

const dec = (exit, o = {}) => ({ exit, findings: [], inconclusive: [], reported: [], host: [], demoted: [], harness: [], ...o });
const tripB = dec(1, { findings: [{ key: SPEC_CONTROL_KEY, cls: 'real', fail: 5, ok: 0 }] });

// ================================================================ A1 verdictOf
test('A1 verdictOf: 7 fixtures -> exactly 2 decisive (PASS, FAIL); INCONCLUSIVE never decisive/PASS; HARNESS -> 3', () => {
  const fx = [
    ['PASS', { a: dec(0), b: tripB }, 'PASS', 0, true],
    ['FAIL real', { a: dec(1, { findings: [{ key: OTHER_REAL, cls: 'real', fail: 3, ok: 2 }] }), b: tripB }, 'FAIL', 1, true],
    ['INCONCLUSIVE arm A exit 2', { a: dec(2, { inconclusive: [{ key: OTHER_REAL, cls: 'real', fail: 2, ok: 2 }] }), b: tripB }, 'INCONCLUSIVE', 2, true],
    ['control-miss (B exit 0)', { a: dec(0), b: dec(0) }, 'INCONCLUSIVE', 2, false],
    ['trip on a DIFFERENT row = control-miss', { a: dec(0), b: dec(1, { findings: [{ key: OTHER_REAL, cls: 'real', fail: 5, ok: 0 }] }) }, 'INCONCLUSIVE', 2, false],
    ['HARNESS in A', { a: dec(1, { harness: ['round 2: timeout'] }), b: tripB }, 'NO DATA', 3, false],
    ['HARNESS in B', { a: dec(0), b: dec(1, { harness: ['round 1: timeout'] }) }, 'NO DATA', 3, false],
  ];
  let decisive = 0;
  for (const [name, x, verdict, exit, tripped] of fx) {
    const v = verdictOf(x);
    // kills: INCONCLUSIVE-as-PASS, HARNESS-as-FAIL, control-miss-decisive (A1 title)
    assert.equal(v.verdict, verdict, name);
    assert.equal(v.exit, exit, name);
    assert.equal(v.decisive, exit === 0 || exit === 1, name);
    if (name === 'PASS' || name === 'FAIL real') { assert.equal(v.decisive, true, name); decisive++; }
    else assert.equal(v.decisive, false, name);
    if (verdict === 'INCONCLUSIVE') assert.notEqual(v.verdict, 'PASS');
    assert.equal(typeof v.reason, 'string');
    assert.ok(v.reason.length > 0, name);
    if (name.startsWith('control-miss') || name.startsWith('trip on')) assert.match(v.reason, /control-miss/, name);
    assert.equal(v.tripped, tripped, name);
  }
  assert.equal(decisive, 2);
});

test('A1 verdictOf: FAIL kind real vs teeth; a teeth-class trip on the control key is not a trip', () => {
  const real = verdictOf({ a: dec(1, { findings: [{ key: OTHER_REAL, cls: 'real', fail: 3, ok: 2 }] }), b: tripB });
  assert.equal(real.kind, 'real');
  const teeth = verdictOf({ a: dec(1, { findings: [{ key: 'RED foilSet (density)', cls: 'teeth', fail: 3, ok: 2 }] }), b: tripB });
  assert.equal(teeth.verdict, 'FAIL');
  assert.equal(teeth.kind, 'teeth');                    // kills: kind always 'real'
  assert.equal(teeth.decisive, true);
  // P-4: trip = an arm-B real FINDING on the control key; a non-real class does not count.
  const wrongCls = verdictOf({ a: dec(0), b: dec(1, { findings: [{ key: SPEC_CONTROL_KEY, cls: 'teeth', fail: 5, ok: 0 }] }) });
  assert.equal(wrongCls.verdict, 'INCONCLUSIVE');       // kills: trip matched by key only
});

test('A1 verdictOf: harness beats control-miss and beats a clean A; night-level harness; missing decisions', () => {
  // kills: control-miss reported ahead of HARNESS (an untrusted night must be NO DATA)
  assert.equal(verdictOf({ a: dec(1, { harness: ['x'] }), b: dec(0) }).exit, 3);
  assert.equal(verdictOf({ a: dec(0), b: tripB, harness: ['slowed build: boom'] }).exit, 3);
  assert.equal(verdictOf({ a: dec(0), b: tripB, harness: [] }).exit, 0);
  assert.equal(verdictOf({ a: dec(0), b: null }).exit, 3);      // kills: fail-open on a missing arm decision
  assert.equal(verdictOf({ a: null, b: tripB }).exit, 3);
  assert.equal(verdictOf(undefined).exit, 3);
  for (const x of [{ a: dec(1, { harness: ['x'] }), b: tripB }, { a: null, b: null }]) assert.equal(verdictOf(x).decisive, false);
});

// ================================================================ A1 main(): wrapper exits + night.json
function mainRun(plans, over = {}) {
  const files = new Map(), logs = [], errs = [];
  const { calls, opts, rmd } = stubOpts(plans, over.nightOpts || {});
  const out = join(tmpdir(), `pn-test-${process.pid}-${++dirSeq}`);   // never created: mkdir is stubbed
  const env = { GITHUB_SHA: 'c0ffee0123456789', GITHUB_REF: 'refs/heads/main', GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '2',
    GITHUB_EVENT_NAME: 'schedule', PERF_OS: 'ubuntu-latest', ...(over.env || {}) };
  return main(['--out', out], {
    env, nightOpts: opts, log: (s) => logs.push(s), err: (s) => errs.push(s),
    mkdir: () => {}, writeFile: over.writeFile || ((p, d) => { files.set(p.slice(out.length + 1), d); }),
    readFile: (p) => Buffer.from('file:' + p), gitHead: () => 'deadbeef',
  }).then((code) => ({ code, files, logs, errs, calls, rmd, out }));
}
const P_PASS = { A: rep('ok'), B: TRIP };
const P_FAIL_REAL = { A: rep([OTHER_REAL]), B: TRIP };
const P_FAIL_TEETH = { A: rep(['RED foilSet (density)']), B: TRIP };
// A: OTHER_REAL FAIL in 2 rounds, ok in 2, one host round -> counted 4, FAIL 2 < 3 and ok 2 < 3 -> INCONCLUSIVE
const P_INCONC = { A: [[OTHER_REAL], [OTHER_REAL], 'ok', 'ok', 'host'], B: TRIP };
const P_MISS = { A: rep('ok'), B: rep('ok') };
const P_MISS_OTHER = { A: rep('ok'), B: rep([OTHER_REAL]) };
const P_HARNESS_A = { A: ['ok', 'harness', 'ok', 'ok', 'ok'], B: TRIP };
const P_HARNESS_B = { A: rep('ok'), B: ['ok', 'ok', 'harness', 'ok', 'ok'] };

test('A1 main: wrapper exit 0/1/2/3 = PASS/FAIL/INCONCLUSIVE/NO DATA (P-5), through real roundRecord + decide', async () => {
  const cases = [
    ['PASS', P_PASS, 0, true], ['FAIL real', P_FAIL_REAL, 1, true], ['FAIL teeth', P_FAIL_TEETH, 1, true],
    ['INCONCLUSIVE arm A', P_INCONC, 2, false], ['control-miss', P_MISS, 2, false], ['trip on other row', P_MISS_OTHER, 2, false],
    ['HARNESS in A', P_HARNESS_A, 3, false], ['HARNESS in B', P_HARNESS_B, 3, false],
  ];
  for (const [name, plans, code, decisive] of cases) {
    const r = await mainRun(plans);
    assert.equal(r.code, code, name);                    // kills: wrong exit mapping, INCONCLUSIVE exit 0
    const j = JSON.parse(r.files.get('night.json'));
    assert.equal(j.exit, code, name);
    assert.equal(j.decisive, decisive, name);
    assert.equal(j.verdict, ['PASS', 'FAIL', 'INCONCLUSIVE', 'NO DATA'][code], name);
    assert.ok(r.files.has('summary.md'), name);
  }
});

test('A1 main: FAIL kind is real vs teeth in night.json', async () => {
  assert.equal(JSON.parse((await mainRun(P_FAIL_REAL)).files.get('night.json')).kind, 'real');
  assert.equal(JSON.parse((await mainRun(P_FAIL_TEETH)).files.get('night.json')).kind, 'teeth');
});

test('A1 nightJson: every P-7 key, K = 5, MAJORITY = 3, schema, order, per-arm and control shape', async () => {
  const r = await mainRun(P_PASS);
  const j = JSON.parse(r.files.get('night.json'));
  const need = ['schema', 'commit', 'ref', 'run_id', 'run_attempt', 'trigger', 'os', 'arch', 'cpus', 'cpuModel', 'node', 'v8',
    'loadBefore', 'loadAfter', 'K', 'MAJORITY', 'order', 'arms', 'control', 'verdict', 'decisive', 'reason'];
  for (const k of need) assert.ok(k in j, 'night.json lacks ' + k);   // kills: a dropped P-7 key
  // the SPEC calls the hashes "sha256 of FastBit32.js + the 4 harness files"; accept either key name
  const shas = j.shas || j.sha256;
  assert.ok(shas && typeof shas === 'object', 'no sha map (shas / sha256)');
  for (const f of ['FastBit32.js', 'test/witness.mjs', 'test/witness/run-one.mjs', 'test/witness-release.mjs']) {
    assert.equal(shas[f], sha256('file:' + join(ROOT, f)), 'sha for ' + f);   // kills: hash of the wrong file / null sha
  }
  assert.equal(j.schema, SCHEMA);
  assert.equal(j.K, 5);
  assert.equal(j.K, K);
  assert.equal(j.MAJORITY, 3);
  assert.equal(j.MAJORITY, MAJORITY);
  assert.equal(j.order, 'ABBAABBAAB');
  assert.equal(ORDER, 'ABBAABBAAB');
  assert.equal(j.commit, 'c0ffee0123456789');
  assert.equal(j.ref, 'refs/heads/main');
  assert.equal(j.run_id, '99');
  assert.equal(j.run_attempt, '2');
  assert.equal(j.trigger, 'schedule');
  assert.equal(j.os, 'ubuntu-latest');
  assert.equal(j.loadBefore.length, 3);
  assert.equal(j.loadAfter.length, 3);
  for (const arm of ['A', 'B']) {
    const a = j.arms[arm];
    for (const k of ['exit', 'rounds', 'findings', 'inconclusive', 'reported', 'host', 'demoted', 'harness', 'rows']) assert.ok(k in a, `arms.${arm}.${k}`);
    assert.equal(a.rounds.length, 5);
    for (const rd of a.rounds) for (const k of ['status', 'kind', 'noise', 'secs', 'wall']) assert.ok(k in rd, `round.${k}`);
  }
  for (const k of ['op', 'key', 'sha', 'parity', 'tripped', 'fail', 'ok']) assert.ok(k in j.control, 'control.' + k);
  assert.equal(j.control.key, SPEC_CONTROL_KEY);
  assert.equal(j.control.tripped, true);
  assert.equal(j.control.fail, 5);
  assert.equal(j.control.ok, 0);
  assert.equal(j.control.sha, 'b'.repeat(64));
  assert.deepEqual(j.control.parity, { pairs: 4096, equal: 4096 });
  const row = j.arms.A.rows['FLAT countMasked (density)'];
  for (const k of ['cls', 'fail', 'ok', 'host', 'spreadN']) assert.ok(k in row, 'rows.' + k);
  assert.deepEqual([row.cls, row.fail, row.ok, row.host], ['real', 0, 5, 0]);
  assert.deepEqual(row.spreadN, [1, 2, 3, 4, 5]);        // fixture spreads are idx+1 per round
});

test('A1 trigger: guardInputs admits schedule | workflow_dispatch only (the SPEC implies refusal of any other)', () => {
  const base = { INPUT_OS: '', MATRIX_OS: 'ubuntu-latest', PIN_NODE: '26.8.2' };
  assert.equal(guardInputs({ ...base, GITHUB_EVENT_NAME: 'schedule' }, 'v26.8.2'), '');
  assert.equal(guardInputs({ ...base, GITHUB_EVENT_NAME: 'workflow_dispatch', INPUT_OS: 'both' }, 'v26.8.2'), '');
  for (const ev of ['push', 'pull_request', 'workflow_run', '', undefined]) {
    assert.notEqual(guardInputs({ ...base, GITHUB_EVENT_NAME: ev }, 'v26.8.2'), '', String(ev));   // kills: any trigger accepted
  }
});

test('A1 main: night.json unwritten, bad args, existing --out dir -> exit 3 (NO DATA)', async () => {
  const r = await mainRun(P_PASS, { writeFile: (p) => { if (p.endsWith('night.json')) throw Object.assign(new Error('x'), { code: 'EIO' }); } });
  assert.equal(r.code, 3);                               // kills: PASS reported with no night.json
  assert.equal(await main([], { env: {}, log() {}, err() {} }), 3);
  assert.equal(await main(['--out'], { env: {}, log() {}, err() {} }), 3);
  assert.equal(await main(['--bogus', 'x'], { env: {}, log() {}, err() {} }), 3);
  assert.equal(await main(['--out', tmpdir()], { env: {}, log() {}, err() {}, mkdir() { throw new Error('must not mkdir'); } }), 3);
  assert.deepEqual(parseArgs(['--out', 'd']), { out: 'd', error: null });
  assert.ok(parseArgs(['--out', 'a', '--out', 'b']).error);
  assert.ok(parseArgs(['--out', '--x']).error);
});

test('A1 rowStats: counted vs host vs demoted, spreadN per record, from stdout text', () => {
  // round 2 (index 1): teeth row FAILs in ONE round -> that round is demoted (decide) and counts as host share.
  const tk = 'RED foilSet (density)';
  const results = [roundOut([], 'ok', 0), roundOut([tk], 'ok', 1), roundOut([SPEC_CONTROL_KEY], 'ok', 2), roundOut([SPEC_CONTROL_KEY], 'ok', 3), roundOut([SPEC_CONTROL_KEY], 'ok', 4)];
  const recs = results.map(roundRecord);
  const d = decide(recs);
  assert.deepEqual(d.demoted, [1]);
  const st = rowStats(recs, results.map((r) => r.stdout), d);
  const c = st[SPEC_CONTROL_KEY];
  assert.deepEqual([c.cls, c.fail, c.ok, c.host], ['real', 3, 1, 1]);   // 4 counted rounds (1 demoted): 3 FAIL, 1 ok
  assert.deepEqual(c.spreadN, [1, 2, 3, 4, 5]);
  assert.deepEqual(st[tk].spreadN, [1, 2, 3, 4, 5]);
  assert.deepEqual(st['SLOPE forEach'].spreadN, []);                     // no spread on SLOPE rows
  assert.equal(st[tk].cls, 'teeth');
  // teeth rows count over EVERY valid round (witness-release decide() :382): 1 FAIL, 4 ok, 0 host
  assert.deepEqual([st[tk].fail, st[tk].ok, st[tk].host], [1, 4, 0]);
  assert.equal(Object.keys(st).length, ALL_KEYS.length);
});

test('A1 summaryMarkdown: one table, names verdict and control; ASCII only', async () => {
  const r = await mainRun(P_FAIL_REAL);
  const j = JSON.parse(r.files.get('night.json'));
  const md = summaryMarkdown(j);
  assert.match(md, /FAIL/);
  assert.match(md, /countMasked/);
  assert.match(md, /REPORT-ONLY/);
  assert.equal([...md].every((ch) => ch.charCodeAt(0) < 128), true);
  assert.equal((md.match(/^\|---/gm) || []).length, 1);
});

// ================================================================ A2 slowed build
test('A2 slowedText: differs from live, only the countMasked region changes; missing or duplicated anchor throws', () => {
  const live = readFileSync(join(ROOT, 'FastBit32.js'), 'utf8');
  const slow = slowedText(live);
  assert.notEqual(slow, live);                           // kills: no-op slowed build
  assert.notEqual(sha256(slow), sha256(live));
  assert.equal(live.split(ANCHOR).length, 2);            // the live anchor occurs exactly once
  assert.equal(slow.split(ANCHOR).length, 1);            // kills: original body left in place
  assert.equal(live.split('countMasked(mask) {').length, 2);
  assert.equal(slow.split('countMasked(mask) {').length, 2);   // still exactly one method
  assert.match(slow, /v &= v - 1/);                      // Kernighan loop (P-4)
  assert.throws(() => slowedText('class A { }\n'), /anchor/);                       // kills: missing anchor ignored
  assert.throws(() => slowedText(live + '\n' + ANCHOR), /anchor/);                  // kills: duplicate anchor ignored (first match only)
  assert.throws(() => slowedText(''), /anchor/);
  assert.throws(() => slowedText(live.replace(ANCHOR, ANCHOR.replace('0x55555555', '0x55555554'))), /anchor/);   // a drifted body is not matched
});

test('A2 parityPairs: length, seeded determinism, uint32 range, edges and spread', () => {
  const p = parityPairs(4096, 7);
  assert.equal(p.length, 4096);
  assert.deepEqual(parityPairs(4096, 7), p);
  assert.notDeepEqual(parityPairs(4096, 8), p);          // kills: seed ignored
  assert.equal(parityPairs().length, 4096);              // default n = 4096 (P-4)
  let pop = 0;
  for (const [v, m] of p) {
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffffff);
    assert.ok(Number.isInteger(m) && m >= 0 && m <= 0xffffffff);
    pop += popc((v & m) >>> 0);
  }
  assert.ok(p.some(([v, m]) => v === 0 && m === 0) || p.some(([v]) => v === 0));          // an all-zero edge
  assert.ok(p.some(([v, m]) => v === 0xffffffff && m === 0xffffffff));                    // all-ones edge
  assert.ok(p.some(([v]) => v >= 0x80000000));            // the sign-bit half is exercised
  const mean = pop / p.length;
  assert.ok(mean > 6 && mean < 10, 'mean popcount(v & m) ' + mean);   // coverage floor: ~8 for uniform random words
});

function popc(x) { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0); }; }

test('A2 buildSlowedRoot: real temp build -- sha != liveSha, parity 4096/4096, files, independent popcount oracle, cleanup', async () => {
  const tmpBase = mkdtempSync(join(tmpdir(), 'pn-test-base-'));
  let built = null;
  try {
    built = await buildSlowedRoot({ tmpBase });
    assert.equal(built.parity.pairs, 4096);
    assert.equal(built.parity.equal, 4096);               // kills: parity not checked / partial
    assert.notEqual(built.sha, built.liveSha);
    assert.equal(built.liveSha, sha256(readFileSync(join(ROOT, 'FastBit32.js'))));
    assert.equal(built.sha, sha256(readFileSync(join(built.root, 'FastBit32.js'))));   // JSON sha = the file actually run
    assert.equal(dirname(built.root), tmpBase);
    assert.deepEqual(JSON.parse(readFileSync(join(built.root, 'package.json'), 'utf8')), { type: 'module' });
    for (const f of ['test/witness.mjs', 'test/witness/run-one.mjs']) {
      assert.deepEqual(readFileSync(join(built.root, f)), readFileSync(join(ROOT, f)), f);   // harness copied byte-for-byte
    }
    // independent oracle: reference popcount over (value & mask), own PRNG
    const mod = await import(pathToFileURL(join(built.root, 'FastBit32.js')).href);
    const r = mulberry32(0xC0FFEE);
    let n = 0;
    for (let i = 0; i < 2000; i++) {
      const v = r(), m = r();
      assert.equal(new mod.FastBit32(v).countMasked(m), popc((v & m) >>> 0));
      n++;
    }
    assert.equal(n, 2000);
  } finally { if (built) rmSync(built.root, { recursive: true, force: true }); }
  assert.deepEqual(readdirSync(tmpBase), []);            // (caller removes the root on success)
  rmSync(tmpBase, { recursive: true, force: true });
});

test('A2 buildSlowedRoot: failures throw and leave no temp dir (bad anchor, broken slowed module)', async () => {
  const work = mkdtempSync(join(tmpdir(), 'pn-test-fail-'));
  try {
    const live = readFileSync(join(ROOT, 'FastBit32.js'), 'utf8');
    for (const [name, text] of [['no anchor', 'export class FastBit32 {}\n'], ['dup anchor', live + '\n' + ANCHOR]]) {
      const src = join(work, 'src-' + name.replace(' ', '-'));
      mkdirSync(src);
      writeFileSync(join(src, 'FastBit32.js'), text);
      const tmpBase = join(work, 'tb-' + name.replace(' ', '-'));
      mkdirSync(tmpBase);
      await assert.rejects(() => buildSlowedRoot({ srcRoot: src, tmpBase }), /anchor/, name);   // kills: missing/duplicated anchor accepted
      assert.deepEqual(readdirSync(tmpBase), [], name);
    }
    // parity failure: the slowed module answers 0 -> must throw, and the root must be removed
    const tmpBase = join(work, 'tb-parity');
    mkdirSync(tmpBase);
    const importer = async (p) => (p.startsWith(tmpBase)
      ? { FastBit32: class { constructor(v) { this.value = v; } countMasked() { return 0; } } }
      : import(pathToFileURL(p).href));
    await assert.rejects(() => buildSlowedRoot({ tmpBase, importer }), /parity/);   // kills: parity result ignored
    assert.deepEqual(readdirSync(tmpBase), []);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('A2 NO DATA when arm B is never called / never produces a decision', async () => {
  // kills: a night with no arm-B data judged PASS
  const { opts, calls } = stubOpts(P_PASS);
  const night = await runNight({ ...opts, build: async () => { throw new Error('slowed build exploded'); } });
  assert.deepEqual(calls, []);                           // nothing spawned when the control cannot be built
  assert.ok(night.harness.length >= 1);
  assert.equal(verdictOf({ a: night.arms.A.decision, b: night.arms.B.decision, harness: night.harness }).exit, 3);
  const r = await mainRun(P_PASS, { nightOpts: { build: async () => { throw new Error('boom'); } } });
  assert.equal(r.code, 3);
  assert.equal(r.calls.length, 0);
  // a spawn that only ever serves arm A (arm B throws): B is HARNESS -> NO DATA, never PASS
  const r2 = await mainRun(P_PASS, { nightOpts: { spawn: (arm, env, round) => { if (arm === 'B') throw new Error('never ran'); return planRound('ok', round); } } });
  assert.equal(r2.code, 3);
  // arm B decision empty (spawn never called arm B)
  assert.equal(verdictOf({ a: dec(0), b: decide([]) }).exit, 3);
});

// ================================================================ A3 decide parity, stamp untouched
test('A3 arm-A decision deep-equals witness-release runRelease(stub).decision (no re-implemented vote)', async () => {
  const scenarios = {
    clean: rep('ok'),
    realFinding: rep([OTHER_REAL]),
    realInconclusive: [[OTHER_REAL], [OTHER_REAL], 'ok', 'ok', 'host'],
    tethaDemoted: [['RED foilSet (density)'], 'ok', 'ok', 'ok', 'ok'],
    teethFinding: [['RED foilSet (density)'], ['RED foilSet (density)'], ['RED foilSet (density)'], 'ok', 'ok'],
    hostRounds: ['host', 'host', 'ok', 'ok', 'ok'],
    harnessStop: ['ok', 'ok', 'harness', 'ok', 'ok'],
  };
  for (const [name, plan] of Object.entries(scenarios)) {
    const { opts } = stubOpts({ A: plan, B: TRIP });
    const night = await runNight(opts);
    const ref = runRelease((env, i) => planRound(plan[i], i), { log() {}, err() {} });
    assert.deepEqual(night.arms.A.decision, ref.decision, name);   // kills: re-implemented / altered vote
  }
});

test('A3 .gate-release.json existence and mtime unchanged across a stubbed main() run; stampDir never passed', async () => {
  const f = join(ROOT, '.gate-release.json');
  const snap = () => (existsSync(f) ? statSync(f).mtimeMs : null);
  const before = snap();
  await mainRun(P_PASS);
  await mainRun(P_FAIL_REAL);
  assert.equal(snap(), before);                          // kills: the lane stamping / dropping gate:release's pass
  const src = readFileSync(join(HERE, 'perf-nightly.mjs'), 'utf8');
  assert.equal(/stampDir\s*:/.test(src), false);
  assert.equal(/keepDir\s*:/.test(src), false);
});

test('A3 per-round env: fresh copy, WITNESS_FAST 1, no WITNESS_CALIBRATE; arm paths', async () => {
  const seen = [];
  const { opts, envs } = stubOpts({ A: rep('ok'), B: TRIP }, {
    env: { WITNESS_CALIBRATE: '1', KEEP: 'y' },
    spawn: (arm, env, round, witness) => { seen.push([arm, witness]); env.MUTATED = arm + round; return planRound(arm === 'A' ? 'ok' : [SPEC_CONTROL_KEY], round); },
  });
  await runNight(opts);
  assert.equal(envs.length, 0);                          // (stub above does not record envs)
  const envSet = new Set();
  const { opts: o2 } = stubOpts({ A: rep('ok'), B: TRIP }, {
    env: { WITNESS_CALIBRATE: '1', KEEP: 'y' },
    spawn: (arm, env, round) => {
      assert.equal(env.WITNESS_FAST, '1');                // kills: not FAST
      assert.equal('WITNESS_CALIBRATE' in env, false);    // kills: calibrate leaks into a gate round
      assert.equal(env.KEEP, 'y');
      assert.equal('MUTATED' in env, false);              // kills: shared env object across rounds
      env.MUTATED = '1';
      envSet.add(env);
      return planRound(arm === 'A' ? 'ok' : [SPEC_CONTROL_KEY], round);
    },
  });
  await runNight(o2);
  assert.equal(envSet.size, 10);
  const A = seen.filter(([a]) => a === 'A').map(([, w]) => w);
  const B = seen.filter(([a]) => a === 'B').map(([, w]) => w);
  assert.ok(A.every((w) => w === join(ROOT, 'test', 'witness.mjs')));
  assert.ok(B.every((w) => w === join('/nonexistent/slowed-root', 'test', 'witness.mjs')));   // arm B runs the SLOWED copy
});

// ================================================================ A4 workflow text
const WF_PATH = join(ROOT, '.github', 'workflows', 'perf-nightly.yml');
const wfText = readFileSync(WF_PATH, 'utf8');
const wfLines = wfText.split('\n');
const indentOf = (s) => s.length - s.trimStart().length;
const isComment = (s) => s.trimStart().startsWith('#');

function runBlocks(text) {
  const L = text.split('\n'), out = [];
  for (let i = 0; i < L.length; i++) {
    const m = /^(\s*)(?:- )?run:[ \t]*(.*)$/.exec(L[i]);
    if (!m) continue;
    const keyIndent = L[i].indexOf('run:');
    if (/^[|>][+-]?\d*$/.test(m[2].trim())) {
      const body = [];
      for (let j = i + 1; j < L.length; j++) {
        if (L[j].trim() !== '' && indentOf(L[j]) <= keyIndent) break;
        body.push(L[j]);
      }
      out.push(body.join('\n'));
    } else out.push(m[2]);
  }
  return out;
}
function ancestors(L, idx) {
  const names = [];
  let cur = indentOf(L[idx]);
  for (let j = idx - 1; j >= 0 && cur > 0; j--) {
    if (L[j].trim() === '' || isComment(L[j])) continue;
    const t = L[j].replace(/^(\s*)- /, '$1  ');
    const ind = indentOf(t);
    if (ind < cur) { names.push(t.trim().split(':')[0]); cur = ind; }
  }
  return names;
}

test('A4 parser sanity: run-block extraction finds block and inline run:, not env or name lines', () => {
  const planted = [
    'steps:',
    '  - name: x ${{ a }}',
    '    run: |',
    '      echo ${{ bad }}',
    '      echo ok',
    '    env:',
    '      Z: ${{ fine }}',
    '  - run: echo ${{ inline }}',
    '  - run: echo clean',
    '  - name: folded',
    '    run: >-',
    '      echo clean2',
  ].join('\n');
  const b = runBlocks(planted);
  assert.equal(b.length, 4);
  assert.deepEqual(b.map((s) => s.includes('${{')), [true, true, false, false]);   // kills: a parser that misses run blocks
  assert.equal(b[0].includes('Z:'), false);
  assert.deepEqual(ancestors(['env:', '  A: 1', '  B: ${{ inputs.os }}'], 2), ['env']);
});

test('A4 workflow: no ${{ inside any run: block; at least 5 run blocks parsed', () => {
  const blocks = runBlocks(wfText);
  assert.ok(blocks.length >= 5, 'parsed ' + blocks.length);
  for (const b of blocks) assert.equal(b.includes('${{'), false, b.slice(0, 80));   // kills: input spliced into a shell
  assert.equal(blocks.some((b) => b.includes('perf-nightly.mjs --out')), true);
});

test('A4 workflow: inputs.* only in env / strategy', () => {
  const hits = [];
  wfLines.forEach((s, i) => { if (!isComment(s) && /\binputs\./.test(s)) hits.push(i); });
  assert.ok(hits.length >= 2);
  for (const i of hits) {
    const anc = ancestors(wfLines, i);
    assert.ok(anc.includes('env') || anc.includes('strategy'), `line ${i + 1}: ${wfLines[i].trim()} under ${anc.join('<')}`);
    assert.equal(anc.includes('run'), false);
  }
  assert.ok(hits.some((i) => ancestors(wfLines, i).includes('strategy')));
  assert.ok(hits.some((i) => ancestors(wfLines, i).includes('env')));
  assert.equal(/github\.event\.inputs/.test(wfText), false);
});

test('A4 workflow: node 26.8.2 pinned, no check-latest; retention 90; upload errors on empty', () => {
  const code = wfLines.filter((s) => !isComment(s));
  assert.ok(code.some((s) => /^\s*PIN_NODE:\s*'?26\.8\.2'?\s*$/.test(s)));
  assert.equal(code.some((s) => /check-latest/.test(s)), false);   // kills: floating node patch
  const nv = code.filter((s) => /node-version:/.test(s));
  assert.equal(nv.length, 1);
  assert.match(nv[0], /env\.PIN_NODE/);
  for (const s of code) for (const m of s.matchAll(/\b2[0-9]\.\d+\.\d+\b/g)) assert.equal(m[0], '26.8.2');
  const ret = code.filter((s) => /retention-days:/.test(s));
  assert.ok(ret.length >= 1);
  for (const s of ret) assert.match(s, /retention-days:\s*90\s*$/);   // kills: default 30/7-day retention
  assert.ok(code.some((s) => /if-no-files-found:\s*error/.test(s)));
  assert.match(wfText, /name:\s*perf-nightly-\$\{\{ matrix\.os \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
});

test('A4 workflow: continue-on-error: true on the measure step only; summary and upload if: always()', () => {
  const code = wfLines.map((s, i) => [s, i]).filter(([s]) => !isComment(s));
  const coe = code.filter(([s]) => /continue-on-error/.test(s));
  assert.equal(coe.length, 1);                           // kills: report-only applied to the guard / install
  assert.match(coe[0][0], /continue-on-error:\s*true\s*$/);
  // the step containing it: from the previous '- name:' line to the next one
  let s0 = coe[0][1]; while (!/^\s*- name:/.test(wfLines[s0])) s0--;
  let s1 = coe[0][1] + 1; while (s1 < wfLines.length && !/^\s*- name:/.test(wfLines[s1])) s1++;
  const step = wfLines.slice(s0, s1).join('\n');
  assert.match(step, /measure/);
  assert.match(step, /node test\/perf-nightly\.mjs --out/);
  assert.match(step, /::warning/);
  assert.match(wfText, /name: step summary\n\s+if: always\(\)/);
  assert.match(wfText, /name: upload night\n\s+if: always\(\)/);
});

test('A4 workflow: exactly ubuntu-latest + macos-latest; cron; permissions; triggers; hardening', () => {
  const code = wfLines.filter((s) => !isComment(s));
  const runners = new Set();
  for (const s of code) for (const m of s.matchAll(/\b(ubuntu|macos|windows)-[\w.]+/g)) runners.add(m[0]);
  assert.deepEqual([...runners].sort(), ['macos-latest', 'ubuntu-latest']);   // kills: Windows / 3rd runner
  assert.equal(code.filter((s) => /cron:/.test(s)).length, 1);
  assert.ok(code.some((s) => /^\s*- cron: '17 3 \* \* \*'\s*$/.test(s)));
  assert.match(wfText, /^permissions:\n  contents: read\n/m);
  assert.equal(code.some((s) => /:\s*write\s*$/.test(s)), false);
  assert.equal(/^\s+(push|pull_request|pull_request_target|workflow_run):/m.test(code.join('\n')), false);
  assert.match(wfText, /^on:\n {2}schedule:/m);
  assert.match(wfText, /workflow_dispatch:/);
  assert.ok(code.some((s) => /persist-credentials:\s*false/.test(s)));
  assert.ok(code.some((s) => /timeout-minutes:\s*45\s*$/.test(s)));
  assert.ok(code.some((s) => /fail-fast:\s*false/.test(s)));
  assert.equal(code.filter((s) => /^\s*- (both|ubuntu-latest|macos-latest)\s*$/.test(s)).length, 3);   // the os input choices
  assert.ok(code.some((s) => /^\s*type:\s*choice\s*$/.test(s)));
  assert.ok(code.some((s) => /guardInputs/.test(s)));    // P-8: the guard runs (as a node -e, not shell interpolation)
});

test('A4 guardInputs: rejects injection / empty / foreign runner; accepts the 3 choices', () => {
  const ev = { GITHUB_EVENT_NAME: 'workflow_dispatch', PIN_NODE: '26.8.2' };
  const g = (inp, mos) => guardInputs({ ...ev, INPUT_OS: inp, MATRIX_OS: mos }, 'v26.8.2');
  assert.notEqual(g('ubuntu-latest;id', 'ubuntu-latest'), '');   // kills: guard missing / prefix-only match
  assert.notEqual(g('', 'ubuntu-latest'), '');                   // dispatch with no os value
  assert.notEqual(g('windows-latest', 'ubuntu-latest'), '');
  assert.notEqual(g('windows-latest', 'windows-latest'), '');
  assert.notEqual(g('ubuntu-latest ', 'ubuntu-latest'), '');
  assert.notEqual(g('$(id)', 'ubuntu-latest'), '');
  assert.equal(g('both', 'ubuntu-latest'), '');
  assert.equal(g('both', 'macos-latest'), '');
  assert.equal(g('ubuntu-latest', 'ubuntu-latest'), '');
  assert.equal(g('macos-latest', 'macos-latest'), '');
  assert.notEqual(g('ubuntu-latest', 'macos-latest'), '');       // the matrix row must match a single-OS choice
  assert.notEqual(guardInputs({ ...ev, INPUT_OS: 'both', MATRIX_OS: 'ubuntu-latest' }, 'v26.9.0'), '');   // kills: node drift
  assert.notEqual(guardInputs({ ...ev, INPUT_OS: 'both', MATRIX_OS: 'ubuntu-latest', PIN_NODE: '26.9.0' }, 'v26.8.2'), '');
  assert.notEqual(guardInputs(null), '');
  assert.notEqual(guardInputs({}), '');
});

// ================================================================ A5 temp dirs and ABBA
test('A5 full night: call order ABBAABBAAB, 5 records per arm', async () => {
  const { opts, calls, rmd } = stubOpts({ A: rep('ok'), B: TRIP });
  const night = await runNight(opts);
  assert.equal(calls.join(''), 'ABBAABBAAB');            // kills: AB AB AB (no interleave), reordered ABBA
  assert.equal(night.calls.join(''), 'ABBAABBAAB');
  assert.equal(night.order, 'ABBAABBAAB');
  assert.equal(night.order, ORDER);
  assert.equal(night.arms.A.records.length, 5);
  assert.equal(night.arms.B.records.length, 5);
  assert.deepEqual(rmd, ['/nonexistent/slowed-root']);
  assert.equal(night.arms.A.decision.exit, 0);
  assert.equal(night.arms.B.decision.exit, 1);
});

test('A5 a HARNESS at round i (either arm): exactly 2(i+1) calls, both arms stop, root removed', async () => {
  for (const arm of ['A', 'B']) {
    for (let i = 0; i < 5; i++) {
      const plan = rep('ok');
      plan[i] = 'harness';
      const plans = { A: arm === 'A' ? plan : rep('ok'), B: arm === 'B' ? plan : TRIP };
      const { opts, calls, rmd } = stubOpts(plans);
      const night = await runNight(opts);
      assert.equal(calls.length, 2 * (i + 1), `arm ${arm} round ${i}`);        // kills: stops mid-pair, runs on after HARNESS
      assert.equal(calls.join(''), 'ABBAABBAAB'.slice(0, 2 * (i + 1)));
      assert.equal(night.arms.A.records.length, i + 1);
      assert.equal(night.arms.B.records.length, i + 1);
      assert.equal(rmd.length, 1);
      const v = verdictOf({ a: night.arms.A.decision, b: night.arms.B.decision, harness: night.harness });
      assert.equal(v.exit, 3);
      assert.equal(v.decisive, false);
    }
  }
});

test('A5 3 nights (one with a HARNESS in round 2): slowed-root temp dirs return to the start count', async () => {
  const tmpBase = mkdtempSync(join(tmpdir(), 'pn-test-nights-'));
  try {
    const start = readdirSync(tmpBase).length;
    const mk = () => async () => {
      const root = mkdtempSync(join(tmpBase, 'fastbit32-slowed-'));
      mkdirSync(join(root, 'test'));
      return { root, sha: 'b'.repeat(64), liveSha: 'a'.repeat(64), parity: { pairs: 4096, equal: 4096 } };
    };
    const during = [];
    const nights = [
      { A: rep('ok'), B: TRIP },
      { A: ['ok', 'harness', 'ok', 'ok', 'ok'], B: TRIP },       // HARNESS in round 2
      { A: rep([OTHER_REAL]), B: TRIP },
    ];
    for (const plans of nights) {
      const { opts, calls } = stubOpts(plans, { build: mk(), rm: undefined, spawn: undefined });
      delete opts.rm;                                             // the default recursive rmSync
      opts.spawn = (arm, env, round, witness) => { calls.push(arm); if (arm === 'B') during.push(existsSync(dirname(dirname(witness)))); return planRound(plans[arm][round], round); };
      const night = await runNight(opts);
      assert.equal(readdirSync(tmpBase).length, start);           // kills: leaked root (rm skipped on a HARNESS stop)
      if (plans.A[1] === 'harness') assert.equal(calls.length, 4);
      else assert.equal(calls.length, 10);
      assert.equal(night.arms.A.records.length, calls.filter((c) => c === 'A').length);
    }
    assert.ok(during.length > 0 && during.every(Boolean));         // arm B's root existed while it ran
    // a throwing spawn and a throwing build also leave nothing behind
    const { opts } = stubOpts({ A: rep('ok'), B: TRIP }, { build: mk() });
    delete opts.rm;
    opts.spawn = () => { throw new Error('spawn exploded'); };
    const night = await runNight(opts);
    assert.equal(readdirSync(tmpBase).length, start);
    assert.equal(verdictOf({ a: night.arms.A.decision, b: night.arms.B.decision, harness: night.harness }).exit, 3);
    const { opts: o3 } = stubOpts({ A: rep('ok'), B: TRIP }, { build: async () => { throw new Error('no root'); } });
    await runNight(o3);
    assert.equal(readdirSync(tmpBase).length, start);
  } finally { rmSync(tmpBase, { recursive: true, force: true }); }
});

test('A5 real buildSlowedRoot inside runNight (stubbed spawns): root exists during arm B, gone after', async () => {
  const tmpBase = mkdtempSync(join(tmpdir(), 'pn-test-real-'));
  try {
    let witnessB = null, existed = false;
    const { opts } = stubOpts({ A: rep('ok'), B: TRIP });
    delete opts.build; delete opts.rm;
    opts.buildOpts = { tmpBase };
    opts.spawn = (arm, env, round, witness) => {
      if (arm === 'B') { witnessB = witness; existed = existsSync(witness); }
      return planRound(arm === 'A' ? 'ok' : [SPEC_CONTROL_KEY], round);
    };
    const night = await runNight(opts);
    assert.equal(existed, true);
    assert.ok(witnessB.startsWith(tmpBase));
    assert.deepEqual(readdirSync(tmpBase), []);
    assert.equal(night.slowed.parity.equal, 4096);
    assert.notEqual(night.slowed.sha, night.slowed.liveSha);
    assert.equal(verdictOf({ a: night.arms.A.decision, b: night.arms.B.decision, harness: night.harness }).exit, 0);
  } finally { rmSync(tmpBase, { recursive: true, force: true }); }
});

test('A1 main: summary.md write failure -> exit 3 (NO DATA)', async () => {
  const r = await mainRun(P_PASS, { writeFile: (p) => { if (p.endsWith('summary.md')) throw Object.assign(new Error('x'), { code: 'EIO' }); } });
  assert.equal(r.code, 3);                               // kills: PASS despite an unwritten summary
});

test('A1 entry point: `node test/perf-nightly.mjs --bogus` exits 3', () => {
  const r = spawnSync(process.execPath, [join(HERE, 'perf-nightly.mjs'), '--bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 3);                             // kills: process.exitCode = 0 / not propagated
});
