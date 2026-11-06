/**
 * @zakkster/lite-fastbit32 -- lane P: one STATISTICAL perf night (REPORT-ONLY until NIGHTLY-2).
 *
 *     node test/perf-nightly.mjs --out <dir>   # <dir> must not exist; its parent must
 *
 * One night = gate:release's statistic, unchanged (test/witness-release.mjs: per
 * row, strict majority MAJORITY of K witness:fast rounds, each round NOISE-relative),
 * run on TWO arms in ONE process on ONE host, interleaved ABBA:
 *   arm A -- the live tree (test/witness.mjs + FastBit32.js, never edited);
 *   arm B -- a mkdtemp copy of test/witness.mjs + test/witness/run-one.mjs +
 *            FastBit32.js whose countMasked(mask) body is Kernighan over
 *            (value & mask): O(popcount), so `FLAT countMasked (density)` must come
 *            out non-flat. That row is the night's must-fail control (P-4).
 * Rounds run A B, B A, A B, B A, A B (order ABBAABBAAB); the vote is the IMPORTED
 * roundRecord + decide, never a copy. Both arms stop after the first round pair in
 * which either arm was HARNESS. The slowed root is removed in a finally.
 * stampDir is never passed: .gate-release.json is never read or written here.
 *
 * VERDICT (P-5; verdictOf):
 *   NO DATA      exit 3 -- HARNESS in either arm (a timeout is HARNESS), a failed
 *                          slowed build / parity, a bad --out, or night.json unwritten;
 *   INCONCLUSIVE exit 2 -- the control did not trip ("control-miss": no arm-B real
 *                          FINDING on FLAT countMasked (density)), or arm A exit 2;
 *   FAIL         exit 1 -- control tripped and arm A found a real / teeth FINDING;
 *   PASS         exit 0 -- control tripped and arm A exit 0.
 * DECISIVE <=> PASS or FAIL. INCONCLUSIVE is never a PASS and never blocks.
 *
 * OUTPUT (--out <dir>): <arm>-round-<n>.stdout.txt + <arm>-round-<n>.json per
 * round, written as each round ends (flag 'wx'), then night.json (P-7) and
 * summary.md (one table, this OS). A write error is NO DATA.
 *
 * Importing this file runs nothing. Every spawn / fs / clock dependency is a
 * parameter (tests stub them; test/PerfNightly.test.mjs is DETERMINISTIC).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, lstatSync, statSync, realpathSync,
} from 'node:fs';
import { tmpdir, loadavg, cpus, arch, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  K, MAJORITY, ROUND_TIMEOUT_MS, HARNESS_FILES, spawnRoundDefault, roundRecord, decide,
} from './witness-release.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

export const SCHEMA = 'perf-nightly/1';
export const ORDER = 'ABBAABBAAB';              // round i: even -> A B, odd -> B A
export const CONTROL_OP = 'countMasked';
export const CONTROL_KEY = 'FLAT countMasked (density)';
export const PARITY_PAIRS = 4096;
// sha256 in night.json: the library + the 4 harness files (a change restarts CAL-1).
export const SHA_FILES = ['FastBit32.js', ...HARNESS_FILES, 'test/perf-nightly.mjs'];
// the slowed root: these 3 files, same relative layout (witness.mjs finds
// witness/run-one.mjs beside it; run-one.mjs imports ../../FastBit32.js).
export const SLOWED_FILES = ['FastBit32.js', 'test/witness.mjs', 'test/witness/run-one.mjs'];
export const OS_CHOICES = ['both', 'ubuntu-latest', 'macos-latest'];

// The exact live countMasked body (FastBit32.js, HEAD e8b4b8e :103-108).
export const ANCHOR =
  '    countMasked(mask) {\n' +
  '        let v = this.value & mask;\n' +
  '        v = v - ((v >>> 1) & 0x55555555);\n' +
  '        v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);\n' +
  '        return Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;\n' +
  '    }\n';
// Kernighan over (value & mask): same int32 operand, one loop pass per set bit.
export const SLOWED_BODY =
  '    countMasked(mask) {\n' +
  '        // lane P arm B (perf-nightly.mjs): SLOWED control, Kernighan over (value & mask). Never shipped.\n' +
  '        let v = this.value & mask;\n' +
  '        let c = 0;\n' +
  '        while (v !== 0) { v &= v - 1; c++; }\n' +
  '        return c;\n' +
  '    }\n';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * slowedText(liveText: string) -> string. Pure. The live FastBit32.js text with
 * the countMasked body replaced by SLOWED_BODY. Throws unless ANCHOR occurs
 * exactly once (0 or > 1 = HARNESS).
 */
export function slowedText(liveText) {
  if (typeof liveText !== 'string') throw new TypeError('slowedText: liveText is not a string');
  const parts = liveText.split(ANCHOR);
  if (parts.length !== 2) throw new Error(`slowedText: countMasked anchor found ${parts.length - 1} time(s), expected exactly 1`);
  return parts[0] + SLOWED_BODY + parts[1];
}

// seeded xorshift32 (parity pairs only; never timed)
function xorshift32(seed) {
  let s = seed | 0 || 0x9e3779b9;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
}

/**
 * parityPairs(n = PARITY_PAIRS, seed = 0x5eed32) -> Array<[value, mask]>. Pure.
 * The first 8 pairs are edges (0, 2^31, 2^32-1 ...); the rest are seeded uint32.
 */
export function parityPairs(n = PARITY_PAIRS, seed = 0x5eed32) {
  const edges = [[0, 0], [0xffffffff, 0xffffffff], [0x80000000, 0xffffffff], [0xffffffff, 0x80000000],
    [0x7fffffff, 0xffffffff], [0xffffffff, 0x0f0f0f0f], [0x55555555, 0xaaaaaaaa], [1, 1]];
  const r = xorshift32(seed);
  const out = [];
  for (let i = 0; i < n; i++) out.push(i < edges.length ? edges[i] : [r(), r()]);
  return out;
}

/**
 * async buildSlowedRoot({srcRoot?, tmpBase?, importer?, fsx?}) ->
 *   {root: string, sha: string, liveSha: string, parity: {pairs: number, equal: number}}
 * Copies SLOWED_FILES from srcRoot (default: this package) into a fresh
 * mkdtemp(tmpBase/'fastbit32-slowed-'), FastBit32.js through slowedText, plus a
 * {"type":"module"} package.json. Checks: slowed sha != live sha, and
 * countMasked equal on all PARITY_PAIRS pairs (importer(path) -> module, default
 * a dynamic import). Any failure removes the root and throws. The caller removes
 * the root on success.
 * fsx: {readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync} (default node:fs).
 */
export async function buildSlowedRoot(opts = {}) {
  const srcRoot = opts.srcRoot || ROOT;
  const tmpBase = opts.tmpBase || tmpdir();
  const importer = opts.importer || ((p) => import(pathToFileURL(p).href));
  const fsx = opts.fsx || { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync };
  const liveText = fsx.readFileSync(join(srcRoot, 'FastBit32.js'), 'utf8');
  const slow = slowedText(liveText);                 // throws before any dir is made
  const root = fsx.mkdtempSync(join(tmpBase, 'fastbit32-slowed-'));
  try {
    fsx.mkdirSync(join(root, 'test', 'witness'), { recursive: true });
    fsx.writeFileSync(join(root, 'package.json'), '{"type":"module"}\n', { flag: 'wx' });
    fsx.writeFileSync(join(root, 'FastBit32.js'), slow, { flag: 'wx' });
    for (const f of SLOWED_FILES.slice(1)) fsx.writeFileSync(join(root, f), fsx.readFileSync(join(srcRoot, f)), { flag: 'wx' });
    const sha = sha256(slow), liveSha = sha256(liveText);
    if (sha === liveSha) throw new Error('slowed FastBit32.js hashes the same as the live one (a no-op control)');
    const live = await importer(join(srcRoot, 'FastBit32.js'));
    const slowed = await importer(join(root, 'FastBit32.js'));
    const pairs = parityPairs();
    let equal = 0;
    for (const [v, m] of pairs) if (new live.FastBit32(v).countMasked(m) === new slowed.FastBit32(v).countMasked(m)) equal++;
    if (equal !== pairs.length) throw new Error(`slowed countMasked parity ${equal}/${pairs.length} (must be ${pairs.length}/${pairs.length})`);
    return { root, sha, liveSha, parity: { pairs: pairs.length, equal } };
  } catch (e) {
    fsx.rmSync(root, { recursive: true, force: true });
    throw e;
  }
}

/**
 * spawnArm(arm: 'A'|'B', env: object, round: number, witness: string) -> spawnSync result.
 * Arm A is gate:release's own spawnRoundDefault (the live test/witness.mjs); arm B
 * is the same call (same options) on the slowed root's witness.mjs.
 */
export function spawnArm(arm, env, round, witness) {
  if (arm === 'A') return spawnRoundDefault(env);
  return spawnSync(process.execPath, [witness], {
    env, encoding: 'utf8', timeout: ROUND_TIMEOUT_MS, killSignal: 'SIGTERM',
    maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
  });
}

/**
 * async runNight({spawn?, build?, buildOpts?, rm?, now?, load1?, loadavg?, env?, log?, onRound?}) -> night
 *   spawn(arm, env, round, witnessPath) -> {status, signal, stdout, error?} (default spawnArm);
 *   build(buildOpts) -> Promise<{root, sha, liveSha, parity}> (default buildSlowedRoot);
 *   rm(root) (default recursive rmSync); now() -> ms; load1() -> number (per round);
 *   loadavg() -> number[3] (night before / after);
 *   onRound({arm, round, raw, rec, wall, load1}) -> void, after each round (before the next).
 * night = {calls: string[], order: string, harness: string[], slowed: {sha, liveSha, parity}|null,
 *   loadBefore: number[], loadAfter: number[], wallSecs: number,
 *   arms: {A|B: {records, stdout: string[], walls: number[], loads: number[], decision}}}
 * Each arm's decision = decide(records) (the imported vote). The env per round is a
 * FRESH copy of env with WITNESS_FAST '1' and no WITNESS_CALIBRATE (as runRelease).
 */
export async function runNight(opts = {}) {
  const spawn = opts.spawn || spawnArm;
  const build = opts.build || buildSlowedRoot;
  const rm = opts.rm || ((p) => rmSync(p, { recursive: true, force: true }));
  const now = opts.now || Date.now;
  const load1 = opts.load1 || (() => loadavg()[0]);
  const la = opts.loadavg || loadavg;
  const log = opts.log || ((s) => process.stdout.write(s + '\n'));
  const onRound = opts.onRound || (() => {});
  const base = { ...(opts.env || process.env), WITNESS_FAST: '1' };
  delete base.WITNESS_CALIBRATE;
  const t0 = now();
  const night = {
    calls: [], order: '', harness: [], slowed: null, loadBefore: la(), loadAfter: null, wallSecs: NaN,
    arms: { A: armInit(), B: armInit() },
  };
  let root = null;
  try {
    let slowed;
    try { slowed = await build(opts.buildOpts || {}); } catch (e) {
      night.harness.push('slowed build: ' + (e && e.message ? e.message : String(e)));
    }
    if (slowed) {
      root = slowed.root;
      night.slowed = { sha: slowed.sha, liveSha: slowed.liveSha, parity: slowed.parity };
      const witness = { A: join(ROOT, 'test', 'witness.mjs'), B: join(root, 'test', 'witness.mjs') };
      log(`perf-nightly: ${K} round pairs, order ${ORDER}, majority ${MAJORITY}/${K} per row per arm; control ${CONTROL_KEY} on arm B (sha ${slowed.sha.slice(0, 8)})`);
      for (let i = 0; i < K; i++) {
        const pair = (i & 1) === 0 ? ['A', 'B'] : ['B', 'A'];
        let stop = false;
        for (const arm of pair) {
          night.calls.push(arm);
          const l1 = load1();
          const s0 = now();
          let raw;
          try { raw = spawn(arm, { ...base }, i, witness[arm]); } catch (e) {
            raw = { status: null, signal: null, stdout: '', error: e instanceof Error ? e : new Error(String(e)) };
          }
          const wall = Math.round((now() - s0) / 100) / 10;
          const rec = roundRecord(raw);
          const a = night.arms[arm];
          a.records.push(rec);
          a.stdout.push(raw && typeof raw.stdout === 'string' ? raw.stdout : '');
          a.walls.push(wall);
          a.loads.push(l1);
          const nz = rec.noise ? `NOISE ${rec.noise.ns} ns noise/floor=${rec.noise.ratio}` : 'NOISE ?';
          log(`  round ${i + 1}/${K} arm ${arm} status=${rec.status} ${rec.kind} ${nz} wall=${wall}s load1=${Number(l1).toFixed(2)} -- ${rec.why}`);
          onRound({ arm, round: i, raw, rec, wall, load1: l1 });
          if (rec.kind === 'harness') stop = true;
        }
        if (stop) { log(`  round ${i + 1}: HARNESS -- both arms stop`); break; }
      }
    }
  } finally {
    if (root !== null) rm(root);
  }
  night.order = night.calls.join('');
  night.arms.A.decision = decide(night.arms.A.records);
  night.arms.B.decision = decide(night.arms.B.records);
  night.loadAfter = la();
  night.wallSecs = Math.round((now() - t0) / 100) / 10;
  return night;
}

function armInit() { return { records: [], stdout: [], walls: [], loads: [], decision: null }; }

/**
 * verdictOf({a, b, harness?}) -> {verdict: 'PASS'|'FAIL'|'INCONCLUSIVE'|'NO DATA',
 *   exit: 0|1|2|3, decisive: boolean, reason: string, kind: 'real'|'teeth'|null, tripped: boolean}
 * a / b: decide() outputs of arm A / arm B; harness: night-level reasons (slowed
 * build, writes). Pure. P-5: any harness -> NO DATA; else no arm-B real FINDING on
 * CONTROL_KEY -> INCONCLUSIVE control-miss; else arm A exit 0 / 1 / 2.
 */
export function verdictOf(x) {
  const out = (verdict, exit, reason, kind = null, tripped = false) =>
    ({ verdict, exit, decisive: exit === 0 || exit === 1, reason, kind, tripped });
  const ok = (d) => d && typeof d === 'object' && Array.isArray(d.harness) && Array.isArray(d.findings) && Array.isArray(d.inconclusive);
  if (!x || typeof x !== 'object') return out('NO DATA', 3, 'harness: no night');
  const h = [];
  if (Array.isArray(x.harness)) h.push(...x.harness); else if (x.harness !== undefined) h.push('night harness is not an array');
  if (!ok(x.a)) h.push('arm A: no decision'); else for (const s of x.a.harness) h.push('arm A: ' + s);
  if (!ok(x.b)) h.push('arm B: no decision'); else for (const s of x.b.harness) h.push('arm B: ' + s);
  if (h.length) return out('NO DATA', 3, 'harness: ' + h.join('; '));
  const tripped = x.b.findings.some((f) => f && f.key === CONTROL_KEY && f.cls === 'real');
  if (!tripped) {
    const other = x.b.findings.map((f) => f && f.key).filter(Boolean);
    return out('INCONCLUSIVE', 2, 'control-miss: no arm-B FINDING on ' + CONTROL_KEY + (other.length ? ` (arm-B findings: ${other.join(', ')})` : ''));
  }
  if (x.a.exit === 0) return out('PASS', 0, 'arm A exit 0, control tripped', null, true);
  if (x.a.exit === 1 && x.a.findings.length) {
    const kind = x.a.findings.some((f) => f && f.cls === 'real') ? 'real' : 'teeth';
    return out('FAIL', 1, `arm A ${x.a.findings.length} ${kind} finding(s): ${x.a.findings.map((f) => f.key).join(', ')}`, kind, true);
  }
  if (x.a.exit === 2) return out('INCONCLUSIVE', 2, `arm A inconclusive: ${x.a.inconclusive.map((f) => f.key).join(', ')}`, null, true);
  return out('NO DATA', 3, `harness: arm A exit ${String(x.a.exit)} with ${x.a.findings.length} finding(s)`, null, true);
}

const FLAT_SPREAD_RE = /^ {2}FLAT (\S+) +(.+?) +ratio=\S+?\/\S+ spread=\S+?ns=(\S+?)N\//;
const RED_SPREAD_RE = /^ {2}RED {2}(\S+) +(.+?) +ratio=\S+?\(info\) spread=\S+?ns=(\S+?)N>=/;

/**
 * rowStats(records: Array, stdouts: string[], decision: object) ->
 *   {[key]: {cls, fail, ok, host, spreadN: Array<number|null>}}. Pure.
 * fail / ok: over the rounds decide() counts for that row's class -- a teeth row
 * over EVERY valid round (witness-release.mjs decide: teeth vote before any
 * demotion), a real / reported row over the valid rounds that are not demoted;
 * host: the row's other non-harness rounds (HOST, or demoted for a non-teeth
 * row). So fail + ok + host = the non-harness round count. spreadN: one entry per record (FLAT / RED rows
 * only, null where the round has no parsable value; [] for other rows), in N.
 */
export function rowStats(records, stdouts, decision) {
  const recs = Array.isArray(records) ? records : [];
  const outs = Array.isArray(stdouts) ? stdouts : [];
  const demoted = new Set(decision && Array.isArray(decision.demoted) ? decision.demoted : []);
  const spreads = recs.map((r, i) => {
    const m = new Map();
    const txt = typeof outs[i] === 'string' ? outs[i] : '';
    for (const s of txt.split('\n')) {
      const f = FLAT_SPREAD_RE.exec(s) || RED_SPREAD_RE.exec(s);
      if (f) { const v = Number(f[3]); m.set((s.startsWith('  FLAT') ? 'FLAT ' : 'RED ') + f[2], Number.isFinite(v) ? v : null); }
    }
    return m;
  });
  const stats = {};
  recs.forEach((rec, i) => {
    if (!rec || !(rec.rows instanceof Map)) return;
    for (const [k, r] of rec.rows) {
      const s = stats[k] || (stats[k] = { cls: r.cls, fail: 0, ok: 0, host: 0, spreadN: [] });
      const cnt = rec.kind === 'valid' && (r.cls === 'teeth' || !demoted.has(i));
      if (cnt) { if (r.verdict === 'FAIL') s.fail++; else s.ok++; } else if (rec.kind === 'host' || rec.kind === 'valid') s.host++;
    }
  });
  for (const k of Object.keys(stats)) {
    if (k.startsWith('FLAT ') || k.startsWith('RED ')) stats[k].spreadN = spreads.map((m) => (m.has(k) ? m.get(k) : null));
  }
  return stats;
}

/**
 * guardInputs(env: object) -> '' when valid, else the reason. Pure. Fail closed.
 * INPUT_OS: '' only on a schedule run, else one of OS_CHOICES; MATRIX_OS one of
 * the 2 runners and equal to INPUT_OS when one runner was chosen; PIN_NODE equal
 * to the running node (no check-latest drift).
 */
export function guardInputs(env, nodeVersion = process.version) {
  if (!env || typeof env !== 'object') return 'no env';
  const ev = env.GITHUB_EVENT_NAME, inp = env.INPUT_OS, mos = env.MATRIX_OS, pin = env.PIN_NODE;
  if (ev !== 'schedule' && ev !== 'workflow_dispatch') return `event ${JSON.stringify(ev)} (schedule or workflow_dispatch only)`;
  if (typeof inp !== 'string') return 'INPUT_OS unset';
  if (ev === 'schedule' ? inp !== '' : !OS_CHOICES.includes(inp)) return `INPUT_OS ${JSON.stringify(inp)} is not one of ${OS_CHOICES.join(' | ')}`;
  if (!(mos === 'ubuntu-latest' || mos === 'macos-latest')) return `MATRIX_OS ${JSON.stringify(mos)}`;
  if (inp !== '' && inp !== 'both' && mos !== inp) return `MATRIX_OS ${mos} but INPUT_OS ${inp}`;
  if (typeof pin !== 'string' || !/^\d+\.\d+\.\d+$/.test(pin) || nodeVersion !== 'v' + pin) return `node ${nodeVersion} is not PIN_NODE ${JSON.stringify(pin)}`;
  return '';
}

/**
 * nightJson(night, v, meta) -> the P-7 night.json object. Pure.
 * v = verdictOf(...); meta = {commit, ref, runId, runAttempt, trigger, os, arch,
 * cpus, cpuModel, node, v8, shas}.
 */
export function nightJson(night, v, meta) {
  const arm = (a) => ({
    exit: a.decision.exit,
    rounds: a.records.map((r, i) => ({
      round: i + 1, status: r.status, kind: r.kind, why: r.why,
      noise: r.noise ? { ns: r.noise.ns, ratio: r.noise.ratio } : null,
      secs: Number.isFinite(r.secs) ? r.secs : null, wall: a.walls[i], load1: a.loads[i],
    })),
    findings: a.decision.findings, inconclusive: a.decision.inconclusive, reported: a.decision.reported,
    host: a.decision.host, demoted: a.decision.demoted, harness: a.decision.harness,
    rows: rowStats(a.records, a.stdout, a.decision),
  });
  const A = arm(night.arms.A), B = arm(night.arms.B);
  const c = B.rows[CONTROL_KEY];
  return {
    schema: SCHEMA, commit: meta.commit, ref: meta.ref, run_id: meta.runId, run_attempt: meta.runAttempt,
    trigger: meta.trigger, os: meta.os, arch: meta.arch, cpus: meta.cpus, cpuModel: meta.cpuModel,
    node: meta.node, v8: meta.v8,
    loadBefore: night.loadBefore, loadAfter: night.loadAfter, wallSecs: night.wallSecs,
    sha256: meta.shas,
    K, MAJORITY, order: night.order,
    arms: { A, B },
    control: {
      op: CONTROL_OP, key: CONTROL_KEY,
      sha: night.slowed ? night.slowed.sha : null,
      parity: night.slowed ? night.slowed.parity : null,
      tripped: v.tripped, fail: c ? c.fail : 0, ok: c ? c.ok : 0,
    },
    harness: night.harness,
    verdict: v.verdict, exit: v.exit, decisive: v.decisive, reason: v.reason, kind: v.kind,
  };
}

/**
 * summaryMarkdown(j: night.json object) -> string. Pure. One table for this OS.
 */
export function summaryMarkdown(j) {
  const n = (x) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(2) : String(x));
  const la = (a) => (Array.isArray(a) ? a.map(n).join(' ') : String(a));
  const armRow = (name, a) => `| ${name} | ${a.exit} | ${a.rounds.map((r) => (r.kind === 'valid' ? 'V' : r.kind === 'host' ? 'H' : 'X')).join('') || '-'} | ` +
    `${a.findings.map((f) => f.key + ' ' + f.fail + '/' + (f.fail + f.ok)).join('; ') || '-'} | ` +
    `${a.inconclusive.length} | ${a.host.length} | ${a.demoted.length} | ${a.harness.join('; ') || '-'} |`;
  const L = [
    `### lane P (REPORT-ONLY) -- ${j.os} -- **${j.verdict}** (exit ${j.exit}, ${j.decisive ? 'decisive' : 'not decisive'})`,
    '',
    `${j.reason}`,
    '',
    `commit \`${String(j.commit).slice(0, 12)}\` ${j.trigger}; node ${j.node} v8 ${j.v8}; ${j.cpus} x ${j.cpuModel} ${j.arch}; ` +
    `load1 before ${la(j.loadBefore)} after ${la(j.loadAfter)}; wall ${n(j.wallSecs)} s; order ${j.order}`,
    '',
    '| arm | exit | rounds (V valid, H host, X harness) | findings (fail/counted) | inconclusive | host | demoted | harness |',
    '|---|---|---|---|---|---|---|---|',
    armRow('A live', j.arms.A),
    armRow('B slowed', j.arms.B),
    '',
    `control ${j.control.key}: tripped ${j.control.tripped} (FAIL ${j.control.fail}, ok ${j.control.ok}); ` +
    `parity ${j.control.parity ? j.control.parity.equal + '/' + j.control.parity.pairs : '-'}; slowed sha ${j.control.sha ? j.control.sha.slice(0, 8) : '-'}`,
    '',
  ];
  return L.join('\n') + '\n';
}

/**
 * parseArgs(argv: string[]) -> {out: string|null, error: string|null}. Pure.
 * Exactly `--out <dir>`; anything else is an error (with a did-you-mean hint).
 */
export function parseArgs(argv) {
  if (!Array.isArray(argv)) return { out: null, error: 'argv is not an array' };
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') {
      if (out !== null) return { out: null, error: '--out given twice' };
      const v = argv[i + 1];
      if (typeof v !== 'string' || v === '' || v.startsWith('--')) return { out: null, error: '--out needs a directory: --out <dir>' };
      out = v; i++; continue;
    }
    return { out: null, error: `unknown option ${JSON.stringify(a)} (did you mean --out <dir>?)` };
  }
  if (out === null) return { out: null, error: 'missing --out <dir>' };
  return { out, error: null };
}

/**
 * async main(argv: string[], deps?: {env?, runNight?, nightOpts?, writeFile?, mkdir?,
 *   log?, err?, gitHead?, readFile?}) -> exit 0|1|2|3. Never sets process.exitCode
 * itself. <out> must not exist; its parent must (non-recursive mkdir). Writes
 * every round as it ends, then night.json + summary.md. Any write error -> 3.
 */
export async function main(argv, deps = {}) {
  const env = deps.env || process.env;
  const log = deps.log || ((s) => process.stdout.write(s + '\n'));
  const err = deps.err || ((s) => process.stderr.write(s + '\n'));
  const writeFile = deps.writeFile || writeFileSync;
  const mkdir = deps.mkdir || mkdirSync;
  const readFile = deps.readFile || readFileSync;
  const args = parseArgs(argv);
  if (args.error) { err('perf-nightly: ' + args.error + ' -- NO DATA (exit 3)'); return 3; }
  const out = resolve(args.out);
  try {
    let exists = true;
    try { lstatSync(out); } catch (e) { if (e && e.code === 'ENOENT') exists = false; else throw e; }
    if (exists) throw new Error(`${out} already exists (an --out dir is never reused)`);
    if (!statSync(dirname(out)).isDirectory()) throw new Error(`parent of ${out} is not a directory`);
    mkdir(out);
  } catch (e) { err(`perf-nightly: --out: ${e && e.message ? e.message : String(e)} -- NO DATA (exit 3)`); return 3; }
  const writes = [];
  const put = (name, data) => {
    try { writeFile(join(out, name), data, { flag: 'wx' }); } catch (e) { writes.push(`write ${name}: ${e && (e.code || e.message)}`); }
  };
  const shas = {};
  for (const f of SHA_FILES) {
    try { shas[f] = sha256(readFile(join(ROOT, f))); } catch (e) { shas[f] = null; writes.push(`hash ${f}: ${e && (e.code || e.message)}`); }
  }
  const night = await (deps.runNight || runNight)({
    ...(deps.nightOpts || {}),
    log,
    onRound: ({ arm, round, raw, wall, load1 }) => {
      const r = raw && typeof raw === 'object' ? raw : {};
      put(`${arm}-round-${round + 1}.stdout.txt`, typeof r.stdout === 'string' ? r.stdout : '');
      put(`${arm}-round-${round + 1}.json`, JSON.stringify({
        status: r.status === undefined ? null : r.status, signal: r.signal === undefined ? null : r.signal,
        error: r.error ? String(r.error.code || r.error.message) : null, wall, load1,
      }) + '\n');
    },
  });
  const cpu = cpus();
  const meta = {
    commit: env.GITHUB_SHA || (deps.gitHead || gitHead)(),
    ref: env.GITHUB_REF || null, runId: env.GITHUB_RUN_ID || null, runAttempt: env.GITHUB_RUN_ATTEMPT || null,
    trigger: env.GITHUB_EVENT_NAME || 'local', os: env.PERF_OS || platform(), arch: arch(),
    cpus: cpu.length, cpuModel: cpu.length ? cpu[0].model : null, node: process.version, v8: process.versions.v8, shas,
  };
  const verdict = () => verdictOf({ a: night.arms.A.decision, b: night.arms.B.decision, harness: [...night.harness, ...writes] });
  let j = nightJson(night, verdict(), meta);
  const before = writes.length;
  put('night.json', JSON.stringify(j, null, 2) + '\n');
  // night.json itself not written: the night has no record -> NO DATA (summary + exit say so).
  if (writes.length !== before) j = nightJson(night, verdict(), meta);
  put('summary.md', summaryMarkdown(j));
  log(`perf-nightly ${j.verdict} (exit ${j.exit}${j.decisive ? ', decisive' : ''}): ${j.reason}`);
  log(`  arm A exit ${j.arms.A.exit}, arm B exit ${j.arms.B.exit}; control ${CONTROL_KEY} tripped=${j.control.tripped} FAIL ${j.control.fail} ok ${j.control.ok}; wall ${j.wallSecs}s; load1 ${Number(Array.isArray(j.loadBefore) ? j.loadBefore[0] : NaN).toFixed(2)} -> ${Number(Array.isArray(j.loadAfter) ? j.loadAfter[0] : NaN).toFixed(2)}`);
  if (writes.length) err('perf-nightly: ' + writes.join('; '));
  return writes.length ? 3 : j.exit;   // summary.md unwritten is a write error too: NO DATA
}

function gitHead() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// run only as the entry point (realpath on both sides, as witness-release.mjs).
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => {
    process.stderr.write('perf-nightly: crashed: ' + (e && e.stack ? e.stack : String(e)) + ' -- NO DATA (exit 3)\n');
    process.exitCode = 3;
  });
}
