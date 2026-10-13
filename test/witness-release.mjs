/**
 * @zakkster/lite-fastbit32 -- the per-release STATISTICAL gate over witness:fast.
 *
 *     node test/witness-release.mjs              # K = 5 serial FAST rounds, gated
 *     node test/witness-release.mjs --if-stale   # exit 0 at once on an exact stamp match
 *     node test/witness-release.mjs --keep <dir> # the same gate, every round kept in <dir>
 *
 * `verify` keeps only DETERMINISTIC gates. One witness:fast run is a STATISTICAL
 * gate (fixed thresholds over this run's own NOISE): it false-failed 14 of 58 fast
 * rounds. This file runs it K = 5 times, SERIALLY (one host, one round at a time),
 * each round a separate `WITNESS_FAST=1 node test/witness.mjs` process with
 * WITNESS_CALIBRATE deleted, parses every round's stdout + exit status, and votes
 * PER ROW by strict majority (MAJORITY = 3 of 5).
 *
 * The decision logic is PURE and exported (parseRound, decide, roundRecord,
 * checkStamp); spawning lives only in the default spawnRound, which a test
 * replaces.
 *
 * ROUND CLASSES (parseRound + roundRecord). Fail closed: anything not recognised
 * is a HARNESS round.
 *   status 2   -> HOST round (no verdicts) -- only with the HOST banner AND
 *                 exactly one FAILURES entry, the `NOISE HOT` cap;
 *   status 0/1 -> valid round, one verdict per row;
 *   HARNESS    -> the gate exits 1 and STOPS (no further rounds):
 *                 a status not in 0/1/2 or null; a timeout (ROUND_TIMEOUT_MS) or a
 *                 signal; no `witness FAST done` line, or CALIBRATE in it; an
 *                 unparsed line, a duplicate key, a missing or unknown row; the
 *                 FAILURES count differs from the count of FAIL lines; a
 *                 malformed, misaligned or non-finite value (a malformed slope
 *                 re-measure, witness.mjs:632, and a malformed confirm-slope
 *                 re-measure, witness.mjs:648 "median of 3 malformed", are
 *                 harness faults, never a FAIL vote); a NOISE FAIL with status
 *                 0/1; status 2 without banner + exactly one NOISE HOT entry.
 *
 * ROWS. Key = tag + name, from witness.mjs's note() formats (388 NOISE -- not a
 * row; 415 FLAT; 431 RED; 580 SLOPE; 632 SLOPE malformed re-measure; 648 CTRL
 * confirm-slope; 790 CTRL broken-floor; 800 SELF; 806 CTRL self-check; 832 done).
 * A FAST round has EXACTLY 69 rows (checked per round):
 *   54 real  -- 44 const-op FLAT (22 CONST_OPS x density/position), 2 ctlRead,
 *               5 FastBit1024, SELF repeat, SLOPE forEach, SLOPE forEachMaskUnion;
 *   15 teeth -- 9 RED, 3 SLOPE foils, CTRL broken-floor, CTRL self-check
 *               control, CTRL confirm-slope.
 *
 * VOTES (decide). Exactly K records, or exit 1. Every round's key set (and each
 * key's class) must be identical, or HARNESS.
 *   teeth row: FAIL in >= MAJORITY of the valid rounds -> FINDING ("no teeth");
 *              FAIL in 1..MAJORITY-1 rounds -> those rounds are DEMOTED to HOST
 *              (a foil that came out flat says the round could not resolve).
 *   every row, over the counted rounds (valid, not demoted):
 *              FAIL >= MAJORITY -> FINDING; ok >= MAJORITY -> pass; else
 *              INCONCLUSIVE. (Always inconclusive once host + demoted >= 3.)
 * Gate exit: 1 any finding or harness; else 2 any inconclusive; else 0.
 * Exit 2 shares its code with quiet-lock's BUSY: stderr says which.
 *
 * STAMP (once per release). On exit 0 only, the gate writes STAMP_FILE
 * (gitignored, never in files[]): sha256 of package.json itself (`pkg`; /release
 * bumps the version BEFORE the gate, so the stamp still matches at publish), of
 * every package.json files[] entry and of HARNESS_FILES (`files`), the node
 * version, the date and the per-round exits. The gate DELETES any old stamp
 * before round 1 (a run that is killed or crashes leaves no pass behind) and
 * hashes the stamp inputs BEFORE round 1; on exit 0 it stamps that pre-run hash
 * only if the files still hash the same after the vote (a file edited while the
 * rounds ran is not stamped, and the gate then exits 1). `--if-stale` skips the gate ONLY when the stamp
 * matches exactly (same package.json, same file set, same hashes, same node); a
 * missing, corrupt or mismatched stamp reruns the full gate.
 *
 * KEEP (--keep <dir>, opts.keepDir; evidence for a noise study). <dir> must NOT
 * exist and its parent MUST exist; it is made with a non-recursive mkdir first,
 * before the old stamp is touched (any failure: HARNESS, exit 1, no round runs,
 * an old stamp kept: the run measured nothing). After each round, BEFORE
 * it is parsed, round-N.stdout.txt (the exact stdout) and round-N.json
 * ({status, signal, wall}) are written with flag 'wx' (never overwrite), so a
 * HARNESS round is kept too; decision.json is written at the end, after the stamp
 * step, so it holds the final exit. Any write error is HARNESS: no further round,
 * exit 1, no stamp (the old one was deleted before round 1; a stamp just written
 * is deleted if decision.json cannot be written).
 * `--keep` with `--if-stale` exits 1 (a skipped gate keeps nothing). Without
 * --keep the log is byte-identical to the build before --keep existed.
 *
 * Known weaknesses (expected, from logs; METHODOLOGY): the rounds are serial on
 * one host, so they are correlated -- in the low-NOISE state the gate still
 * false-fails ~21%; a marginal (~0.15 ns) select step is missed 50-73% of the
 * time (a single run: 50-63%). A per-round timeout kills witness.mjs, not a
 * run-one.mjs child it is waiting on; that child is a single short cell and
 * exits on its own.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, unlinkSync, statSync, lstatSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { loadavg } from 'node:os';
import { CONST_OPS } from './witness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const WITNESS = join(HERE, 'witness.mjs');

// --- FROZEN gate constants (fixed before any run; plan-release-gate.md) -----
export const K = 5;                           // rounds per release
export const MAJORITY = 3;                    // strict majority of K
export const ROUND_TIMEOUT_MS = 120000;       // FAST is ~14 s; a hung round is HARNESS
export const STAMP_FILE = '.gate-release.json';
// hashed into the stamp next to package.json files[]: the gate's own harness.
export const HARNESS_FILES = ['test/witness.mjs', 'test/witness/run-one.mjs', 'test/witness-release.mjs'];

// --- the 69-row census of a FAST round --------------------------------------
const FB1024_ROWS = ['acquire', 'nextClearBit', 'lowest', 'highest', 'has'];
const HOT_FOIL_ROWS = ['foilKernighan', 'foilEarlyExit', 'foilNaiveLowest', 'foilSet', 'foilSubEps'];
export const REAL_KEYS = [
  ...CONST_OPS.flatMap((op) => [`FLAT ${op} (density)`, `FLAT ${op} (position)`]),
  'FLAT ctlRead (density) [control]', 'FLAT ctlRead (position) [control]',
  ...FB1024_ROWS.map((op) => `FLAT FastBit1024.${op} (slot word)`),
  'SELF repeat', 'SLOPE forEach', 'SLOPE forEachMaskUnion',
];
export const TEETH_KEYS = [
  'RED foilWordScan (lane)', 'RED foilWordScan (acquire-est)', 'RED foilWordScan (has-est)',
  ...HOT_FOIL_ROWS.map((f) => `RED ${f} (density)`), 'RED foilSubEps (position)',
  'SLOPE foilIterQuad', 'SLOPE foilIterScan32', 'SLOPE foilIterStep',
  'CTRL broken-floor', 'CTRL self-check control', 'CTRL confirm-slope',
];
const ROW_CLASS = new Map([...REAL_KEYS.map((k) => [k, 'real']), ...TEETH_KEYS.map((k) => [k, 'teeth'])]);

// --- line grammar (witness.mjs note() formats) -------------------------------
const HOSTV = 'HOST\\(no verdict: lane NOISE failed\\)';
const NOISE_RE = /^ {2}NOISE (\S+) +(\S+) ns \(median cell-to-cell spread of (\d+) real-op rows; pass dispersion median (\S+) ns\), floor (\S+) ns, noise\/floor=(\S+) max=(\S+) (ok|FAIL); EPS=(\S+?)N=(\S+) ns$/;
const FLAT_RE = new RegExp(`^ {2}FLAT (\\S+) +(.+?) +ratio=(\\S+?)/(\\S+) spread=(\\S+?)ns=(\\S+?)N/(\\S+?)N \\[(\\S+?),(\\S+?)\\] (ok|FAIL|${HOSTV})$`);
const RED_RE = new RegExp(`^ {2}RED {2}(\\S+) +(.+?) +ratio=(\\S+?)\\(info\\) spread=(\\S+?)ns=(\\S+?)N>=(\\S+?)N (ok\\(non-flat\\)|FAIL\\(came out flat\\)|${HOSTV})$`);
const SLOPE_RE = new RegExp(`^ {2}SLOPE (\\S+) +(.+?) +r2=(\\S+) slope=(\\S+) a=(\\S+?)=(\\S+?)xslope rise=(\\S+?)N curv=(\\S+) ` +
  `resid=(\\S+?)ns=(\\S+?)xslope (ok|ok\\(foil rejected by: [a-z0-9,]+\\)|FAIL\\([a-z0-9,]*\\)|FAIL\\(foil passed as linear\\)|${HOSTV})$`);
const SLOPE_BAD_RE = /^ {2}SLOPE (\S+) +(.+?) +median of 3: a re-measure was malformed or misaligned FAIL\(no verdict\)$/;
const BF_RE = /^ {2}CTRL (\S+) +broken-floor \(Kernighan floor\) net=\[([^\]]*)\] negative-cell gate (fired ok|FAIL\(did not fire\))$/;
const SELF_RE = /^ {2}SELF repeat count@d4,8,16 two processes \|a-b\|=\[([^\]]*)\] tol=(\S+?)N=(\S+) (ok|FAIL)$/;
const SC_RE = /^ {2}CTRL self-check control count vs Kernighan \|a-c\|=\[([^\]]*)\] (disagrees ok|FAIL\(agreed\))$/;
const CS_RE = new RegExp('^ {2}CTRL confirm-slope foilIterStep as a real iterator: (?:not run \\((.*)\\)|process 1 (?:linear|not linear\\([a-z0-9,]*\\)); ' +
  '(?:not re-measured |median of 3 resid=(\\S+?)xslope |median of 3 malformed )(ok\\(non-linear: [a-z0-9,]*\\)|FAIL\\((?:malformed re-measure|ended linear): no teeth\\)))$');
const DONE_RE = /^witness (FAST )?(CALIBRATE )?done in (\S+)s -- (ok|(\d+) FAIL)$/;
// body lines that carry no verdict
const NOTE_RES = [
  /^ {2}\(advisory, not a gate\) load average \S+( -- busy host: .*)?$/,
  /^--- lane HOT ---$/, /^--- slope HOT ---$/,
  /^ {6}flags .+$/,
  /^ {6}FastBit1024\.\w+ HOT median net .+$/,
  /^ {2}\(info\) .+$/,
  /^ {2}CONFIRM HOT +.+$/,
];
const HOSTSUP_RE = /^HOST: (\d+) gate line\(s\) in a lane whose NOISE precondition failed have NO verdict \(not findings\):$/;
const BANNER_RE = /^HOST: re-run on a quiet host -- /;

// strict decimal (toFixed output); NaN / Infinity / '' are not numbers here.
const isNum = (x) => typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x);
const allNum = (xs) => xs.every(isNum);
const list = (s, n) => { const a = s.split(','); return a.length === n && allNum(a); };

// one verdict line -> { key, verdict, form? } | { bad } | null (not a row line).
// form: true = foil verdict wording, false = real-row wording (SLOPE only).
function rowOf(s) {
  let m;
  if ((m = FLAT_RE.exec(s))) {
    if (m[1] !== 'HOT') return { bad: `FLAT row in lane ${m[1]} (a FAST round is HOT only)` };
    if (!allNum([m[3], m[4], m[5], m[6], m[7], m[8], m[9]])) return { bad: `non-finite value in FLAT ${m[2]}` };
    return { key: 'FLAT ' + m[2], verdict: m[10] === 'ok' ? 'ok' : m[10] === 'FAIL' ? 'FAIL' : 'HOST' };
  }
  if ((m = RED_RE.exec(s))) {
    if (m[1] !== 'HOT') return { bad: `RED row in lane ${m[1]} (a FAST round is HOT only)` };
    if (!allNum([m[3], m[4], m[5], m[6]])) return { bad: `non-finite value in RED ${m[2]}` };
    return { key: 'RED ' + m[2], verdict: m[7].startsWith('ok') ? 'ok' : m[7].startsWith('FAIL') ? 'FAIL' : 'HOST' };
  }
  if ((m = SLOPE_RE.exec(s))) {
    if (m[1] !== 'HOT') return { bad: `SLOPE row in lane ${m[1]}` };
    if (!allNum([m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10]])) return { bad: `non-finite value in SLOPE ${m[2]}` };
    const v = m[11];
    const verdict = v.startsWith('ok') ? 'ok' : v.startsWith('FAIL') ? 'FAIL' : 'HOST';
    const form = verdict === 'HOST' ? null : (v.startsWith('ok(foil') || v === 'FAIL(foil passed as linear)');
    return { key: 'SLOPE ' + m[2], verdict, form };
  }
  if ((m = SLOPE_BAD_RE.exec(s))) return { bad: `SLOPE ${m[2]}: malformed slope re-measure (a harness fault, no verdict)` };
  if ((m = BF_RE.exec(s))) {
    if (m[1] !== 'HOT') return { bad: `CTRL broken-floor in lane ${m[1]}` };
    if (!list(m[2], 2)) return { bad: 'CTRL broken-floor: malformed or non-finite net (2 cells)' };
    return { key: 'CTRL broken-floor', verdict: m[3] === 'fired ok' ? 'ok' : 'FAIL' };
  }
  if ((m = SELF_RE.exec(s))) {
    if (!list(m[1], 3) || !allNum([m[2], m[3]])) return { bad: 'SELF repeat: malformed or non-finite |a-b| (3 cells) or tol' };
    return { key: 'SELF repeat', verdict: m[4] === 'ok' ? 'ok' : 'FAIL' };
  }
  if ((m = SC_RE.exec(s))) {
    if (!list(m[1], 3)) return { bad: 'CTRL self-check control: malformed or non-finite |a-c| (3 cells)' };
    return { key: 'CTRL self-check control', verdict: m[2] === 'disagrees ok' ? 'ok' : 'FAIL' };
  }
  if ((m = CS_RE.exec(s))) {
    // a malformed re-measure is a harness fault, not a teeth FAIL (a teeth FAIL
    // in 1-2 rounds would only demote the round and let the gate pass).
    if (/; median of 3 malformed /.test(s)) return { bad: 'CTRL confirm-slope: a re-measure was malformed or misaligned (harness fault, no verdict)' };
    if (m[1] !== undefined) return { key: 'CTRL confirm-slope', verdict: 'HOST' };   // not run
    if (m[2] !== undefined && !isNum(m[2])) return { bad: 'CTRL confirm-slope: non-finite median resid' };
    return { key: 'CTRL confirm-slope', verdict: m[3].startsWith('ok') ? 'ok' : 'FAIL' };
  }
  return null;
}

/**
 * Parse ONE witness:fast round. Pure.
 * @param {string} stdout  the round's whole stdout (no npm banner)
 * @param {number|null} status  its exit status
 * @returns {{status, kind: 'valid'|'host'|'harness', why: string,
 *   rows: Map<string, {cls: 'real'|'teeth', verdict: 'ok'|'FAIL'|'HOST'}>,
 *   noise: {ns: number, ratio: number, ok: boolean}|null, secs: number, fails: number}}
 * A host round's rows all read 'HOST'. A harness round's rows are whatever was
 * parsed before the fault (never voted on).
 */
export function parseRound(stdout, status) {
  const rows = new Map();
  const out = { status, kind: 'harness', why: '', rows, noise: null, secs: NaN, fails: 0 };
  const bad = (why) => { out.kind = 'harness'; out.why = why; return out; };
  if (!(status === 0 || status === 1 || status === 2)) return bad(`exit status ${status} (not 0, 1 or 2)`);
  if (typeof stdout !== 'string') return bad('no stdout text');
  const L = stdout.split('\n');
  let done = null, noise = null, banner = false, hostBlock = -1, hostLines = 0, failures = null, tail = '';
  for (let i = 0; i < L.length; i++) {
    const s = L[i];
    const at = `line ${i + 1}`;
    let m;
    if (done === null) {
      // --- body: notes, the NOISE line, verdict rows, then the done line ---
      if (s === '' || NOTE_RES.some((re) => re.test(s))) continue;
      if ((m = DONE_RE.exec(s))) {
        if (!isNum(m[3])) return bad(`${at}: non-finite wall time in the done line`);
        done = { fast: m[1] !== undefined, calibrate: m[2] !== undefined, secs: Number(m[3]), n: m[5] === undefined ? 0 : Number(m[5]) };
        continue;
      }
      if ((m = NOISE_RE.exec(s))) {
        if (noise !== null) return bad(`${at}: a second NOISE line`);
        if (m[1] !== 'HOT') return bad(`${at}: NOISE ${m[1]} (a FAST round is HOT only)`);
        if (!allNum([m[2], m[4], m[5], m[6], m[7], m[9], m[10]])) return bad(`${at}: non-finite NOISE HOT value`);
        if (Number(m[3]) !== 2 * CONST_OPS.length) return bad(`${at}: NOISE HOT over ${m[3]} rows, expected ${2 * CONST_OPS.length} (a malformed real-op row)`);
        noise = { ns: Number(m[2]), ratio: Number(m[6]), ok: m[8] === 'ok' };
        continue;
      }
      const row = rowOf(s);
      if (row === null) return bad(`${at}: unparsed line: ${s.trim().slice(0, 120)}`);
      if (row.bad) return bad(`${at}: ${row.bad}`);
      if (rows.has(row.key)) return bad(`${at}: duplicate row key "${row.key}"`);
      const cls = ROW_CLASS.get(row.key);
      if (cls === undefined) return bad(`${at}: unknown row key "${row.key}"`);
      if (row.form !== undefined && row.form !== null && row.form !== (cls === 'teeth')) {
        return bad(`${at}: "${row.key}" printed a ${row.form ? 'foil' : 'real-row'} verdict, expected the ${cls} wording`);
      }
      rows.set(row.key, { cls, verdict: row.verdict });
      continue;
    }
    // --- tail (after the done line): HOST-suppressed block, FAILURES, banner ---
    if (s === '') { tail = ''; continue; }
    if (tail === 'failures' && s.startsWith('  ')) { failures.push(s.slice(2)); continue; }
    if (tail === 'host' && s.startsWith('  (host) ')) { hostLines++; continue; }
    if (s === 'FAILURES:') {
      if (failures !== null) return bad(`${at}: a second FAILURES block`);
      failures = []; tail = 'failures'; continue;
    }
    if ((m = HOSTSUP_RE.exec(s))) {
      if (hostBlock >= 0) return bad(`${at}: a second HOST-suppressed block`);
      hostBlock = Number(m[1]); tail = 'host'; continue;
    }
    if (BANNER_RE.test(s)) {
      if (banner) return bad(`${at}: a second HOST banner`);
      banner = true; tail = ''; continue;
    }
    return bad(`${at}: unparsed line after the done line: ${s.trim().slice(0, 120)}`);
  }
  if (done === null) return bad('no "witness FAST done" line (crashed or truncated)');
  if (done.calibrate) return bad('CALIBRATE in the done line (no verdicts)');
  if (!done.fast) return bad('not a FAST round (done line without FAST)');
  if (noise === null) return bad('no NOISE HOT line');
  out.noise = noise;
  out.secs = done.secs;
  for (const k of ROW_CLASS.keys()) if (!rows.has(k)) return bad(`missing row "${k}" (${rows.size}/${ROW_CLASS.size} rows)`);
  if (hostBlock >= 0 && hostLines !== hostBlock) return bad(`HOST-suppressed block says ${hostBlock} line(s), has ${hostLines}`);
  if (done.n === 0 && failures !== null) return bad('the done line says ok but a FAILURES block follows');
  if (done.n > 0 && (failures === null || failures.length !== done.n)) {
    return bad(`the done line says ${done.n} FAIL, the FAILURES block has ${failures === null ? 'no' : failures.length} entr(ies)`);
  }
  let nFail = 0, nHost = 0;
  for (const r of rows.values()) { if (r.verdict === 'FAIL') nFail++; else if (r.verdict === 'HOST') nHost++; }
  out.fails = nFail;
  if (status === 2) {
    if (!banner) return bad('status 2 without the HOST banner');
    if (!(failures !== null && failures.length === 1 && failures[0].startsWith('NOISE HOT:'))) {
      return bad('status 2 needs exactly one FAILURES entry, the NOISE HOT cap');
    }
    if (noise.ok) return bad('status 2 but the NOISE HOT line reads ok');
    for (const r of rows.values()) r.verdict = 'HOST';
    out.kind = 'host';
    out.why = `HOST: NOISE HOT cap (noise/floor ${noise.ratio}; no verdicts)`;
    return out;
  }
  if (banner) return bad(`HOST banner with status ${status}`);
  if (hostBlock >= 0) return bad(`HOST-suppressed block with status ${status}`);
  if (!noise.ok) return bad(`NOISE HOT FAIL with status ${status}`);
  if (nHost > 0) return bad(`${nHost} HOST row(s) in a status ${status} round`);
  if (status === 0 && done.n !== 0) return bad(`status 0 with ${done.n} FAIL in the done line`);
  if (status === 1 && done.n === 0) return bad('status 1 with no FAIL lines');
  if (nFail !== done.n) return bad(`${nFail} FAIL line(s) vs ${done.n} FAILURES entr(ies)`);
  out.kind = 'valid';
  out.why = nFail === 0 ? 'ok' : `${nFail} FAIL`;
  return out;
}

/**
 * spawnSync result -> round record. Pure. A spawn error (ETIMEDOUT at
 * ROUND_TIMEOUT_MS), a signal or a null status is a HARNESS round.
 */
export function roundRecord(r) {
  const harness = (why) => ({ status: r && r.status !== undefined ? r.status : null, kind: 'harness', why, rows: new Map(), noise: null, secs: NaN, fails: 0 });
  if (!r || typeof r !== 'object') return harness('no spawn result');
  if (r.error) return harness(`spawn error: ${r.error.code || r.error.message || String(r.error)} (timeout ${ROUND_TIMEOUT_MS} ms)`);
  if (r.signal) return harness(`killed by ${r.signal} (timeout ${ROUND_TIMEOUT_MS} ms or a signal)`);
  const stdout = typeof r.stdout === 'string' ? r.stdout : (r.stdout && typeof r.stdout.toString === 'function' && !Array.isArray(r.stdout) ? r.stdout.toString('utf8') : null);
  return parseRound(stdout, r.status);
}

/**
 * The vote. Pure.
 * @param {Array} records  exactly K round records (parseRound / roundRecord)
 * @returns {{exit: 0|1|2, findings: Array<{key, cls, fail, ok}>,
 *   inconclusive: Array<{key, cls, fail, ok}>, host: number[], demoted: number[],
 *   harness: string[]}}  host / demoted: 0-based round indices.
 */
export function decide(records) {
  const out = { exit: 1, findings: [], inconclusive: [], host: [], demoted: [], harness: [] };
  const recs = Array.isArray(records) ? records : [];
  if (!Array.isArray(records)) out.harness.push('records is not an array');
  recs.forEach((r, i) => {
    if (!r || typeof r !== 'object') out.harness.push(`round ${i + 1}: missing record`);
    else if (r.kind === 'harness') out.harness.push(`round ${i + 1}: ${r.why}`);
    else if (r.kind === 'host') out.host.push(i);
    else if (r.kind !== 'valid') out.harness.push(`round ${i + 1}: unknown kind ${String(r.kind)}`);
  });
  if (recs.length !== K) out.harness.push(`${recs.length} round record(s), expected exactly ${K}`);
  if (out.harness.length) return out;
  // every round: the same key set, the same class per key, known verdicts.
  const keys = recs[0].rows instanceof Map ? [...recs[0].rows.keys()] : null;
  if (keys === null || keys.length === 0) { out.harness.push('round 1: no rows'); return out; }
  for (let i = 0; i < K; i++) {
    const rows = recs[i].rows;
    if (!(rows instanceof Map) || rows.size !== keys.length) { out.harness.push(`round ${i + 1}: key set differs from round 1`); return out; }
    for (const k of keys) {
      const r = rows.get(k), r0 = recs[0].rows.get(k);
      if (!r) { out.harness.push(`round ${i + 1}: key set differs from round 1 (no "${k}")`); return out; }
      if (!(r.cls === 'real' || r.cls === 'teeth') || r.cls !== r0.cls) { out.harness.push(`round ${i + 1}: "${k}" class ${String(r.cls)}`); return out; }
      if (!(r.verdict === 'ok' || r.verdict === 'FAIL' || r.verdict === 'HOST')) { out.harness.push(`round ${i + 1}: "${k}" verdict ${String(r.verdict)}`); return out; }
      if (recs[i].kind === 'valid' && r.verdict === 'HOST') { out.harness.push(`round ${i + 1}: "${k}" HOST in a valid round`); return out; }
    }
  }
  const valid = [];
  for (let i = 0; i < K; i++) if (recs[i].kind === 'valid') valid.push(i);
  // teeth: >= MAJORITY FAIL is a finding; 1..MAJORITY-1 FAIL demotes those rounds.
  const demoted = new Set();
  for (const k of keys) {
    if (recs[0].rows.get(k).cls !== 'teeth') continue;
    const failed = valid.filter((i) => recs[i].rows.get(k).verdict === 'FAIL');
    if (failed.length >= MAJORITY) out.findings.push({ key: k, cls: 'teeth', fail: failed.length, ok: valid.length - failed.length });
    else for (const i of failed) demoted.add(i);
  }
  out.demoted = [...demoted].sort((a, b) => a - b);
  const counted = valid.filter((i) => !demoted.has(i));
  for (const k of keys) {
    const cls = recs[0].rows.get(k).cls;
    if (cls === 'teeth' && out.findings.some((f) => f.key === k)) continue;
    let fail = 0, ok = 0;
    for (const i of counted) { if (recs[i].rows.get(k).verdict === 'FAIL') fail++; else ok++; }
    if (fail >= MAJORITY) out.findings.push({ key: k, cls, fail, ok });
    else if (!(ok >= MAJORITY)) out.inconclusive.push({ key: k, cls, fail, ok });
  }
  out.exit = out.findings.length ? 1 : out.inconclusive.length ? 2 : 0;
  return out;
}

// --- stamp ------------------------------------------------------------------
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * sha256 of package.json itself (pkg), of every package.json files[] entry +
 * HARNESS_FILES under `dir` (files), and the node version. Throws (fail closed) on a missing / non-array files[], an entry
 * that is not a plain relative path to a regular file (a directory or a glob
 * cannot be stamped), or an unreadable file.
 * @returns {{node: string, pkg: string, files: Object<string, string>}}
 */
export function computeStamp(dir) {
  const raw = readFileSync(join(dir, 'package.json'));   // hashed as bytes: any edit reruns
  const pkg = JSON.parse(raw.toString('utf8'));
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) throw new Error('package.json files[] missing or empty');
  const files = {};
  for (const p of [...pkg.files, ...HARNESS_FILES]) {
    if (typeof p !== 'string' || p === '' || isAbsolute(p) || /[*?[\]{}!]/.test(p) || p.split(/[\\/]/).includes('..')) {
      throw new Error(`files[] entry ${JSON.stringify(p)} is not a plain relative file path`);
    }
    const full = join(dir, p);
    if (!statSync(full).isFile()) throw new Error(`${p} is not a regular file`);
    files[p] = sha256(readFileSync(full));
  }
  return { node: process.version, pkg: sha256(raw), files };
}

/**
 * Does `dir`/STAMP_FILE match the current files EXACTLY? Pure apart from reads.
 * A missing, corrupt or mismatched stamp, or one that cannot be checked, is NOT
 * a match (the gate reruns).
 * @returns {{match: boolean, why: string}}
 */
export function checkStamp(dir) {
  const path = join(dir, STAMP_FILE);
  if (!existsSync(path)) return { match: false, why: 'no stamp' };
  let st;
  try { st = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return { match: false, why: 'corrupt stamp (not JSON)' }; }
  if (!st || typeof st !== 'object' || Array.isArray(st) || Object.getPrototypeOf(st) !== Object.prototype) return { match: false, why: 'corrupt stamp (not an object)' };
  if (st.exit !== 0) return { match: false, why: 'corrupt stamp (exit is not 0)' };
  if (typeof st.node !== 'string' || typeof st.date !== 'string' || typeof st.pkg !== 'string' ||
    !st.files || typeof st.files !== 'object' || Array.isArray(st.files)) {
    return { match: false, why: 'corrupt stamp (node / date / pkg / files)' };
  }
  if (!(Array.isArray(st.rounds) && st.rounds.length === K && st.rounds.every((s) => s === 0 || s === 1 || s === 2))) {
    return { match: false, why: `corrupt stamp (rounds must be ${K} exits in 0..2)` };
  }
  let now;
  try { now = computeStamp(dir); } catch (e) { return { match: false, why: 'cannot hash the current files: ' + e.message }; }
  if (st.node !== now.node) return { match: false, why: `node ${st.node} in the stamp, running ${now.node}` };
  if (st.pkg !== now.pkg) return { match: false, why: 'package.json changed since the stamp' };
  const a = Object.keys(st.files).sort(), b = Object.keys(now.files).sort();
  if (a.length !== b.length || a.some((k, i) => k !== b[i])) return { match: false, why: 'the stamped file set differs from files[] + harness' };
  for (const k of b) if (st.files[k] !== now.files[k]) return { match: false, why: `${k} changed since the stamp` };
  return { match: true, why: `stamp matches ${b.length} files, node ${now.node}, gated ${st.date}` };
}

/**
 * Write the stamp for a gate run. ONLY on exit 0 (any other run returns
 * written: false and writes nothing). Atomic (tmp + rename).
 * `pre` = computeStamp(dir) taken BEFORE round 1 (runRelease passes it): the
 * stamp records `pre`, and only if a fresh computeStamp now equals it exactly
 * -- a file edited while the rounds ran was not the code that was gated.
 * Without `pre` the fresh hash is stamped.
 * @param {string} dir
 * @param {{exit: number, records: Array}} run
 * @param {{node: string, pkg: string, files: Object<string, string>}} [pre]
 * @returns {{written: boolean, why: string}}
 */
export function writeStamp(dir, run, pre) {
  if (!run || run.exit !== 0) return { written: false, why: `gate exit ${run ? run.exit : 'none'} (a stamp is written on exit 0 only)` };
  if (!Array.isArray(run.records) || run.records.length !== K) return { written: false, why: `${run.records ? run.records.length : 0} rounds (not ${K})` };
  let now;
  try { now = computeStamp(dir); } catch (e) { return { written: false, why: 'cannot hash the files: ' + e.message }; }
  if (pre !== undefined) {
    const diff = stampDiff(pre, now);
    if (diff) return { written: false, why: `stamp inputs changed while the gate ran (${diff}): not stamped` };
    now = pre;
  }
  const st = { gate: 'gate:release', exit: 0, node: now.node, date: new Date().toISOString(), rounds: run.records.map((r) => r.status), pkg: now.pkg, files: now.files };
  const path = join(dir, STAMP_FILE);
  writeFileSync(path + '.tmp', JSON.stringify(st, null, 2) + '\n');
  renameSync(path + '.tmp', path);
  return { written: true, why: path };
}

// '' when two computeStamp results are identical, else the first difference.
function stampDiff(a, b) {
  if (!a || !b || typeof a.files !== 'object' || typeof b.files !== 'object' || a.files === null || b.files === null) return 'malformed pre-run hash';
  if (a.node !== b.node) return 'node version';
  if (a.pkg !== b.pkg) return 'package.json';
  const ka = Object.keys(a.files).sort(), kb = Object.keys(b.files).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return 'the file set';
  for (const k of ka) if (a.files[k] !== b.files[k]) return k;
  return '';
}

// remove a stamp left from an earlier run (a failed / inconclusive run must not
// leave an older pass in place for --if-stale to find).
function dropStamp(dir) {
  const path = join(dir, STAMP_FILE);
  if (existsSync(path + '.tmp')) unlinkSync(path + '.tmp');
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

// --- keep dir ---------------------------------------------------------------------
// make the --keep dir: '' when made, else why not. Fail closed: not a non-empty
// string, it exists (never reused, even as a dangling link), its parent is missing
// or not a directory, or the non-recursive mkdir throws.
function keepOpen(dir, mkdir) {
  if (typeof dir !== 'string' || dir === '') return `keep dir ${JSON.stringify(dir)} is not a non-empty path`;
  try {
    lstatSync(dir);
    return `keep dir ${dir} already exists (a keep dir is never reused)`;
  } catch (e) {
    if (!e || e.code !== 'ENOENT') return `keep dir ${dir}: cannot check it (${e && (e.code || e.message)})`;
  }
  const parent = dirname(resolve(dir));
  let st;
  try { st = statSync(parent); } catch (e) { return `keep dir parent ${parent} is missing (${e && (e.code || e.message)})`; }
  if (!st.isDirectory()) return `keep dir parent ${parent} is not a directory`;
  try { mkdir(dir); } catch (e) { return `keep dir ${dir}: mkdir failed (${e && (e.code || e.message)})`; }
  return '';
}

// --- the driver -----------------------------------------------------------------
/** The default round: one `WITNESS_FAST=1 node test/witness.mjs` process. */
export function spawnRoundDefault(env) {
  return spawnSync(process.execPath, [WITNESS], {
    env, encoding: 'utf8', timeout: ROUND_TIMEOUT_MS, killSignal: 'SIGTERM',
    maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
  });
}

/**
 * K serial rounds -> decide. Stops at the first HARNESS round.
 * @param {(env: object, round: number) => {status, signal, stdout, error?}} spawnRound
 *   called with a FRESH env copy per round (WITNESS_FAST '1', no
 *   WITNESS_CALIBRATE) and the 0-based round index.
 * @param {{stampDir?: string, keepDir?: string, log?: Function, err?: Function,
 *   writeFile?: Function, mkdir?: Function}} opts  ONLY when
 *   stampDir is given: an old stamp is DELETED before round 1 (a run killed or
 *   crashing mid-way leaves no pass behind), the stamp inputs are hashed before
 *   round 1 (a hash failure exits 1, no round runs), and on exit 0 that pre-run
 *   hash is stamped iff the files still hash the same after the vote; if the
 *   stamp is not written, a 0 vote becomes exit 1 (HARNESS).
 *   ONLY when keepDir is given (any value, even null: a bad one fails closed): see
 *   KEEP in the header. The dir is made BEFORE the stamp step above (a bad dir
 *   leaves an old stamp in place); decision.json is written after the stamp step at the end, and if it cannot be
 *   written the stamp just written is deleted (exit 1). writeFile (default
 *   fs.writeFileSync, called (path, data, {flag: 'wx'})) and mkdir (default
 *   fs.mkdirSync, called (dir): non-recursive) are injectable for tests.
 * @returns {{exit: 0|1|2, records: Array, decision: object, stamp: object|null}}
 */
export function runRelease(spawnRound = spawnRoundDefault, opts = {}) {
  const log = opts.log || ((s) => process.stdout.write(s + '\n'));
  const err = opts.err || ((s) => process.stderr.write(s + '\n'));
  const la = loadavg();
  log(`gate:release -- ${K} serial witness:fast rounds, strict majority ${MAJORITY}/${K} per row`);
  log(`  node ${process.version} ${process.platform}/${process.arch}; load average ${la.map((x) => x.toFixed(2)).join(' ')} (advisory)`);
  const keep = opts.keepDir !== undefined;
  // '' when written, else the HARNESS reason. data: a thunk, so a serialisation
  // error is a write error too.
  const keepWrite = (name, data) => {
    try { (opts.writeFile || writeFileSync)(join(opts.keepDir, name), data(), { flag: 'wx' }); return ''; } catch (e) {
      return `keep: cannot write ${name} in ${opts.keepDir}: ${e && (e.code || e.message) ? (e.code || e.message) : String(e)}`;
    }
  };
  if (keep) {
    const why = keepOpen(opts.keepDir, opts.mkdir || mkdirSync);
    if (why) {
      const decision = { exit: 1, findings: [], inconclusive: [], host: [], demoted: [], harness: [why] };
      log(`  HARNESS ${why}`);
      err('gate:release FAIL (exit 1): HARNESS (keep dir)');
      // checked BEFORE the stamp step: a bad --keep measured nothing, so an old
      // stamp from an earlier pass is left as it is.
      return { exit: 1, records: [], decision, stamp: opts.stampDir ? { written: false, why } : null };
    }
    log(`  keep: every round + decision.json -> ${opts.keepDir}`);
  }
  let pre;
  if (opts.stampDir) {
    if (dropStamp(opts.stampDir)) log(`  old ${STAMP_FILE} deleted before round 1`);
    try { pre = computeStamp(opts.stampDir); } catch (e) {
      const why = 'cannot hash the stamp inputs before round 1: ' + e.message;
      const decision = { exit: 1, findings: [], inconclusive: [], host: [], demoted: [], harness: [why] };
      log(`  HARNESS ${why}`);
      err('gate:release FAIL (exit 1): HARNESS (stamp inputs)');
      return { exit: 1, records: [], decision, stamp: { written: false, why } };
    }
  }
  const base = { ...process.env, WITNESS_FAST: '1' };
  delete base.WITNESS_CALIBRATE;
  const records = [];
  let keepFail = '';
  for (let i = 0; i < K; i++) {
    const t0 = Date.now();
    const raw = spawnRound({ ...base }, i);
    const wall = ((Date.now() - t0) / 1000).toFixed(1);
    if (keep) {
      // saved BEFORE parsing: a HARNESS round is kept too.
      const r = raw && typeof raw === 'object' ? raw : {};
      keepFail = keepWrite(`round-${i + 1}.stdout.txt`, () => (typeof r.stdout === 'string' || Buffer.isBuffer(r.stdout) ? r.stdout : '')) ||
        keepWrite(`round-${i + 1}.json`, () => JSON.stringify({
          status: r.status === undefined ? null : r.status, signal: r.signal === undefined ? null : r.signal, wall: Number(wall),
        }) + '\n');
    }
    const rec = roundRecord(raw);
    records.push(rec);
    const nz = rec.noise ? `NOISE HOT ${rec.noise.ns} ns noise/floor=${rec.noise.ratio} ${rec.noise.ok ? 'ok' : 'FAIL'}` : 'NOISE HOT ?';
    log(`  round ${i + 1}/${K} status=${rec.status} ${rec.kind} ${nz} wall=${wall}s -- ${rec.why}`);
    if (rec.kind === 'valid') for (const [k, r] of rec.rows) if (r.verdict === 'FAIL') log(`      FAIL ${r.cls.padEnd(5)} ${k}`);
    if (keepFail) { log(`  round ${i + 1}: HARNESS (keep write) -- stop`); break; }
    if (rec.kind === 'harness') { log(`  round ${i + 1}: HARNESS -- stop`); break; }
  }
  const d = decide(records);
  if (keepFail) { d.exit = 1; d.harness.push(keepFail); }
  if (d.host.length) log(`  HOST rounds: ${d.host.map((i) => i + 1).join(',')} (no verdicts)`);
  if (d.demoted.length) log(`  demoted to HOST (a teeth row FAIL in < ${MAJORITY} rounds): ${d.demoted.map((i) => i + 1).join(',')}`);
  for (const f of d.findings) log(`  FINDING ${f.cls.padEnd(5)} ${f.key}: FAIL ${f.fail}, ok ${f.ok}${f.cls === 'teeth' ? ' -- no teeth' : ''}`);
  for (const f of d.inconclusive) log(`  INCONCLUSIVE ${f.cls.padEnd(5)} ${f.key}: FAIL ${f.fail}, ok ${f.ok} of the counted rounds`);
  for (const h of d.harness) log(`  HARNESS ${h}`);
  let stamp = null;
  if (opts.stampDir) {
    if (d.exit === 0) {
      stamp = writeStamp(opts.stampDir, { exit: d.exit, records }, pre);
      log(stamp.written ? `  stamp written: ${STAMP_FILE}` : `  stamp NOT written: ${stamp.why}`);
      // a pass the stamp cannot vouch for (files changed mid-run, or unhashable
      // at the end) is not a pass: the bytes npm would publish were not all gated.
      if (!stamp.written) {
        d.exit = 1;
        d.harness.push('stamp not written: ' + stamp.why);
        log(`  HARNESS ${d.harness[d.harness.length - 1]}`);
      }
    } else if (dropStamp(opts.stampDir)) log(`  stale ${STAMP_FILE} deleted (exit ${d.exit})`);
  }
  if (keep) {
    const kf = keepWrite('decision.json', () => JSON.stringify({
      gate: 'gate:release', exit: d.exit, node: process.version,
      rounds: records.map((r, i) => ({ round: i + 1, status: r.status, kind: r.kind, why: r.why })),
      findings: d.findings, inconclusive: d.inconclusive, host: d.host, demoted: d.demoted, harness: d.harness, stamp,
    }, null, 2) + '\n');
    if (kf) {
      d.exit = 1;
      d.harness.push(kf);
      log(`  HARNESS ${kf}`);
      // a pass whose decision was not kept is not a pass: drop the stamp just written.
      if (opts.stampDir && dropStamp(opts.stampDir)) log(`  ${STAMP_FILE} deleted (decision.json not kept)`);
    } else log(`  kept ${records.length} round(s) + decision.json in ${opts.keepDir}`);
  }
  if (d.exit === 0) log(`gate:release ok -- ${records.length} rounds, ${d.host.length} HOST, ${d.demoted.length} demoted`);
  else if (d.exit === 1) err(`gate:release FAIL (exit 1): ${d.harness.length ? 'HARNESS -- ' + d.harness.join('; ') : d.findings.length + ' finding(s)'}`);
  else err(`gate:release INCONCLUSIVE (exit 2, the GATE, not quiet-lock): ${d.inconclusive.length} row(s) without a majority -- re-run on a quiet host`);
  return { exit: d.exit, records, decision: d, stamp };
}

/**
 * The command line. Pure. Fail closed: an unknown option (with a did-you-mean
 * hint), `--keep` without a value or with one starting with `--`, `--keep` twice,
 * or `--keep` with `--if-stale` -> error (main exits 1, no round runs).
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {{ifStale: boolean, keep: string|null, error: string|null}}
 */
export function parseArgs(argv) {
  const fail = (error) => ({ ifStale: false, keep: null, error });
  if (!Array.isArray(argv)) return fail('argv is not an array');
  let ifStale = false, keep = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--if-stale') { ifStale = true; continue; }
    if (a === '--keep') {
      if (keep !== null) return fail('--keep given twice');
      const v = argv[i + 1];
      if (typeof v !== 'string' || v === '' || v.startsWith('--')) return fail('--keep needs a directory: --keep <dir>');
      keep = v;
      i++;
      continue;
    }
    const hint = typeof a === 'string' && (a.startsWith('--k') || a.includes('keep')) ? '--keep <dir>' : '--if-stale';
    return fail(`unknown option ${JSON.stringify(a)} (did you mean ${hint}?)`);
  }
  if (keep !== null && ifStale) return fail('--keep with --if-stale: a skipped gate keeps nothing (give one of them)');
  return { ifStale, keep, error: null };
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.error !== null) {
    process.stderr.write(`gate:release: ${args.error}\n`);
    process.exitCode = 1;
    return;
  }
  if (args.ifStale) {
    const c = checkStamp(ROOT);
    if (c.match) {
      process.stdout.write(`gate:release skipped (--if-stale): ${c.why}\n`);
      process.exitCode = 0;
      return;
    }
    process.stdout.write(`gate:release --if-stale: ${c.why} -- running the gate\n`);
  }
  const opts = { stampDir: ROOT };
  if (args.keep !== null) opts.keepDir = resolve(args.keep);
  process.exitCode = runRelease(spawnRoundDefault, opts).exit;
}

// run only as the entry point; importing (the tests) only exports. realpath on
// BOTH sides: through a symlinked path (or --preserve-symlinks-main) a plain
// resolve() never matches, main() never runs and the process exits 0 -- a gate
// that never ran would pass prepublishOnly.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
