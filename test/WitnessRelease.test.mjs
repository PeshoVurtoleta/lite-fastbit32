// Release gate tests (2026-10-12): batch B2 task 5 of .handoff/plan-release-gate.md
// (A1-A4 + addendum 1-2). Written from the spec's RULE and ASSERTIONS as an
// independent oracle. In-process only: NOTHING is spawned. Expected values come
// from the spec (counts 69 = 54 real + 15 teeth, the A2 table), not from running
// the implementation.
//
// Mutant evidence (A2 revert): in a scratch COPY of witness-release.mjs, MAJORITY=6
// makes the "real row FAIL 5/5" case exit 2, not 1 (5 < 6, so it is inconclusive);
// MAJORITY=2 makes the "FAIL 2/5 -> 0" case exit 1. Both are asserted below, so
// each mutant turns exactly those cases red. (Scratch copies live outside the tree.)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from './witness-release.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OK_TXT = readFileSync(join(HERE, 'fixtures', 'witness-fast-ok.txt'), 'utf8');
const FAIL_TXT = readFileSync(join(HERE, 'fixtures', 'witness-fast-fail.txt'), 'utf8');
const { parseRound, decide, runRelease } = M;
const count = (x) => (Array.isArray(x) ? x.length : x instanceof Set || x instanceof Map ? x.size : x);

describe('A1 parseRound', () => {
  it('exports K=5 and MAJORITY=3', () => {
    assert.equal(M.K, 5);
    assert.equal(M.MAJORITY, 3);
  });

  it('ok fixture, status 0 -> valid, 69 rows (54 real / 15 teeth), 0 FAIL', () => {
    const r = parseRound(OK_TXT, 0);
    assert.equal(r.kind, 'valid', r.why);
    assert.equal(r.rows.size, 69);
    let real = 0, teeth = 0, fail = 0;
    for (const v of r.rows.values()) {
      if (v.cls === 'real') real++;
      else if (v.cls === 'teeth') teeth++;
      if (v.verdict === 'FAIL') fail++;
    }
    assert.equal(real, 54);
    assert.equal(teeth, 15);
    assert.equal(fail, 0);
  });

  it('fail fixture, status 1 -> valid, exactly one FAIL: FLAT select (position)', () => {
    const r = parseRound(FAIL_TXT, 1);
    assert.equal(r.kind, 'valid', r.why);
    const fails = [...r.rows].filter(([, v]) => v.verdict === 'FAIL').map(([k]) => k);
    assert.deepEqual(fails, ['FLAT select (position)']);
    assert.equal(r.rows.get('FLAT select (position)').cls, 'real');
  });

  const harness = (name, txt, status) => it('harness: ' + name, () => {
    const r = parseRound(txt, status);
    assert.equal(r.kind, 'harness');
  });
  harness('done line removed', OK_TXT.split('\n').filter((l) => !l.startsWith('witness FAST done')).join('\n'), 0);
  harness('one FLAT line deleted', (() => {
    const L = OK_TXT.split('\n');
    const i = L.findIndex((l) => /^ {2}FLAT HOT {6}count \(density\)/.test(l));
    assert.ok(i >= 0);
    L.splice(i, 1);
    return L.join('\n');
  })(), 0);
  harness('status 1 with no FAIL lines', OK_TXT, 1);
  harness('status 3', OK_TXT, 3);
  harness('status null', OK_TXT, null);
});

// Synthetic HOST round text: the ok fixture with the NOISE HOT cap failed, one NOISE HOT
// FAILURES entry and the HOST banner (spec RULE: status 2 = exactly one NOISE HOT entry + banner).
const HOST_TXT = (() => {
  const t = OK_TXT.replace(/noise\/floor=([0-9.]+) max=([0-9.]+) ok;/, 'noise/floor=0.300 max=$2 FAIL;')
    .replace(/witness FAST done in ([0-9.]+)s -- ok/, 'witness FAST done in $1s -- 1 FAIL');
  return t.replace(/\n*$/, '\n') + '\nFAILURES:\n  NOISE HOT: noise/floor 0.300 > 0.27\n\nHOST: re-run on a quiet host -- noise cap\n';
})();

describe('A1b parseRound HARNESS triggers (RULE), built from the fixtures in memory', () => {
  const lines = (t) => t.split('\n');
  const sub = (t, re, to) => { assert.ok(re.test(t), 'mutation target present: ' + re); return t.replace(re, to); };
  const hostTxt = () => HOST_TXT;
  const cases = [
    ['an unparsed line carrying FAIL', () => OK_TXT.replace('--- slope HOT ---', '--- slope HOT ---\n  FLAT weird garbage line FAIL'), 0],
    ['FAILURES count differs from the FAIL lines (done says 2, one FAIL line)', () => sub(FAIL_TXT, /-- 1 FAIL/, '-- 2 FAIL'), 1],
    ['NOISE FAIL with status 1', () => sub(FAIL_TXT, /max=([0-9.]+) ok;/, 'max=$1 FAIL;'), 1],
    ['status 2 without the HOST banner', () => lines(hostTxt()).filter((l) => !l.startsWith('HOST: re-run')).join('\n'), 2],
    ['status 2 with 2 NOISE entries', () => sub(sub(hostTxt(), /-- 1 FAIL/, '-- 2 FAIL'), /\n\nHOST: re-run/, '\n  NOISE HOT: again\n\nHOST: re-run'), 2],
    ['status 2 with a host-block count mismatch', () => sub(hostTxt(), /\nHOST: re-run/, '\nHOST: 3 gate line(s) in a lane whose NOISE precondition failed have NO verdict (not findings):\n  (host) one\n\nHOST: re-run'), 2],
    // done "1 FAIL" + one FAILURES entry, as witness.mjs:633 prints, so only the :632 line itself can reject it.
    ['witness.mjs:632 malformed re-measure line (done 1 FAIL, 1 entry)', () => sub(sub(OK_TXT, /^ {2}SLOPE HOT {5}forEach {20}r2=.*$/m, '  SLOPE HOT     forEach                    median of 3: a re-measure was malformed or misaligned FAIL(no verdict)'), /-- ok\n/, '-- 1 FAIL\n\nFAILURES:\n  SLOPE forEach: confirm re-measure malformed or misaligned -- no verdict (fail closed)\n'), 1],
    // witness.mjs:344 shape (malformed spawn): done "2 FAIL" + 2 entries, but only 1 FAIL line.
    ['done 2 FAIL, 2 FAILURES entries, 1 FAIL line (:344 shape)', () => sub(sub(FAIL_TXT, /-- 1 FAIL/, '-- 2 FAIL'), /(FAILURES:\n  select \(position\).*\n)/, '$1  malformed spawn: x\n'), 1],
    // truncated FAILURES block: done "2 FAIL", 1 entry, 2 FAIL lines.
    ['done 2 FAIL, 1 FAILURES entry, 2 FAIL lines (truncated block)', () => sub(sub(FAIL_TXT, /-- 1 FAIL/, '-- 2 FAIL'), /(count \(density\) .*\]) ok$/m, '$1 FAIL'), 1],
    ['NaN in a FLAT field', () => sub(OK_TXT, /ratio=1\.24\/2\.5/, 'ratio=NaN/2.5'), 0],
    ['a duplicate row', () => { const L = lines(OK_TXT); const i = L.findIndex((l) => /^ {2}FLAT HOT {6}count \(density\)/.test(l)); L.splice(i, 0, L[i]); return L.join('\n'); }, 0],
    ['NOISE over 43 rows (not 2 x CONST_OPS)', () => sub(OK_TXT, /of 44 real-op rows/, 'of 43 real-op rows'), 0],
    ['a HOST row in a status-0 round', () => sub(OK_TXT, /(count \(density\) .*\]) ok$/m, '$1 HOST(no verdict: lane NOISE failed)'), 0],
    ['foil wording on a real SLOPE row', () => sub(OK_TXT, /(SLOPE HOT {5}forEach {20}.*xslope) ok$/m, '$1 ok(foil rejected by: resid)'), 0],
    ['status 0 with a FAIL line', () => FAIL_TXT, 0],
  ];
  for (const [name, mk, status] of cases) {
    it('harness: ' + name, () => {
      const r = parseRound(mk(), status);
      assert.equal(r.kind, 'harness', r.why);
    });
  }
  // Regression pin for the coder's :648 fix. The 648 line is "median of 3 malformed" with a FAIL(malformed re-measure: no teeth) verdict: a harness
  it('harness: witness.mjs:648 CTRL confirm-slope "median of 3 malformed" line', () => {
    let t = sub(OK_TXT, /median of 3 resid=\S+xslope ok\(non-linear: resid\)/, 'median of 3 malformed FAIL(malformed re-measure: no teeth)');
    t = sub(t, /-- ok\n/, '-- 1 FAIL\n\nFAILURES:\n  CTRL confirm-slope: malformed re-measure\n');
    assert.equal(parseRound(t, 1).kind, 'harness');
  });
});

// ---- A2 decide: synthetic records, built directly in parseRound's shape ----
const REAL = 'FLAT x (density)';
const TEETH = 'RED y';
const OTHER = 'FLAT z (density)';
function rec(kind, real = 'ok', teeth = 'ok') {
  if (kind === 'harness') return { status: 3, kind, why: 'synthetic', rows: new Map() };
  const hv = kind === 'host' ? 'HOST' : null;
  return {
    status: kind === 'host' ? 2 : 0,
    kind,
    why: '',
    rows: new Map([
      [REAL, { cls: 'real', verdict: hv || real }],
      [OTHER, { cls: 'real', verdict: hv || 'ok' }],
      [TEETH, { cls: 'teeth', verdict: hv || teeth }],
    ]),
  };
}
const rep = (n, f) => Array.from({ length: n }, f);

describe('A2 decide (strict majority per row)', () => {
  const real = (fails, hosts = 0) => [
    ...rep(hosts, () => rec('host')),
    ...rep(fails, () => rec('valid', 'FAIL')),
    ...rep(5 - hosts - fails, () => rec('valid')),
  ];
  const teeth = (fails, hosts = 0) => [
    ...rep(hosts, () => rec('host')),
    ...rep(fails, () => rec('valid', 'ok', 'FAIL')),
    ...rep(5 - hosts - fails, () => rec('valid')),
  ];

  it('real row FAIL 0/5 -> 0', () => assert.equal(decide(real(0)).exit, 0));
  it('real row FAIL 2/5 -> 0', () => assert.equal(decide(real(2)).exit, 0));
  it('real row FAIL 3/5 -> 1 (finding)', () => {
    const d = decide(real(3));
    assert.equal(d.exit, 1);
    assert.equal(count(d.findings), 1);
  });
  it('real row FAIL 5/5 (MUST-FAIL) -> 1', () => assert.equal(decide(real(5)).exit, 1));
  it('3 HOST + 2 clean -> 2', () => {
    const d = decide(real(0, 3));
    assert.equal(d.exit, 2);
    assert.equal(count(d.host), 3);
  });
  it('2 HOST + 3 clean -> 0', () => assert.equal(decide(real(0, 2)).exit, 0));
  it('2 HOST + the row FAIL in the other 3 -> 1', () => assert.equal(decide(real(3, 2)).exit, 1));
  it('1 HOST + the row 2 FAIL / 2 ok -> 2 (inconclusive)', () => {
    const d = decide(real(2, 1));
    assert.equal(d.exit, 2);
    assert.equal(count(d.inconclusive), 1);
  });
  it('teeth FAIL 3/5 -> 1', () => assert.equal(decide(teeth(3)).exit, 1));
  it('teeth FAIL 1/5 -> 0, demoted 1', () => {
    const d = decide(teeth(1));
    assert.equal(d.exit, 0);
    assert.equal(count(d.demoted), 1);
  });
  it('teeth FAIL 1 + 2 HOST -> 2', () => assert.equal(decide(teeth(1, 2)).exit, 2));
  it('4 records -> 1', () => assert.equal(decide(real(0).slice(1)).exit, 1));
  it('6 records -> 1', () => assert.equal(decide([...real(0), rec('valid')]).exit, 1));
  it('1 harness + 4 HOST -> 1', () => {
    const d = decide([rec('harness'), ...rep(4, () => rec('host'))]);
    assert.equal(d.exit, 1);
    assert.equal(count(d.harness), 1);
  });
});


describe('A2b decide: demotion', () => {
  it('teeth FAIL in rounds {1,2} + real FAIL in {1,2,3} -> exit 2, demoted [0,1] (demotion excludes those rounds)', () => {
    const recs = [rec('valid', 'FAIL', 'FAIL'), rec('valid', 'FAIL', 'FAIL'), rec('valid', 'FAIL'), rec('valid'), rec('valid')];
    const d = decide(recs);
    assert.equal(d.exit, 2);   // counted rounds 3..5: real FAIL 1, ok 2 -> no majority either way
    assert.deepEqual(d.demoted, [0, 1]);
    assert.equal(count(d.findings), 0);
  });
  it('teeth FAIL 2/5 -> exit 0, demoted length 2', () => {
    const d = decide([rec('valid', 'ok', 'FAIL'), rec('valid', 'ok', 'FAIL'), rec('valid'), rec('valid'), rec('valid')]);
    assert.equal(d.exit, 0);
    assert.equal(d.demoted.length, 2);
  });
});

// ---- A3 runRelease with a fake spawnRound (signature: spawnRound(env, roundIndex)) ----
describe('A3 runRelease (fake spawnRound)', () => {
  const okRound = () => ({ status: 0, stdout: OK_TXT, signal: null });
  const quiet = { log: () => {}, err: () => {} };
  function drive(fake) {
    const calls = [];
    const r = runRelease((env, i) => { calls.push({ env, i }); return fake(calls.length, env); }, quiet);
    return { calls, exit: r.exit, r };
  }

  it('5 calls, each WITNESS_FAST=1 and no WITNESS_CALIBRATE; clean -> exit 0', () => {
    const saved = process.env.WITNESS_CALIBRATE;
    process.env.WITNESS_CALIBRATE = '1';   // must be stripped by the gate
    let d;
    try { d = drive(okRound); } finally { if (saved === undefined) delete process.env.WITNESS_CALIBRATE; else process.env.WITNESS_CALIBRATE = saved; }
    assert.equal(d.calls.length, 5);
    for (const c of d.calls) {
      assert.equal(c.env.WITNESS_FAST, '1');
      assert.ok(!('WITNESS_CALIBRATE' in c.env));
    }
    assert.equal(d.exit, 0);
  });

  it('harness round at call 2 -> 2 calls, exit 1', () => {
    const d = drive((n) => (n === 2 ? { status: 3, stdout: 'garbage', signal: null } : okRound()));
    assert.equal(d.calls.length, 2);
    assert.equal(d.exit, 1);
  });

  it('timed-out round {status:null, signal:SIGTERM} -> harness, stops, exit 1 (addendum 1)', () => {
    const d = drive((n) => (n === 1 ? { status: null, signal: 'SIGTERM', stdout: '' } : okRound()));
    assert.equal(d.calls.length, 1);
    assert.equal(d.exit, 1);
  });

  it('a spawn error (ETIMEDOUT) round -> harness, exit 1', () => {
    const d = drive((n) => (n === 3 ? { status: null, signal: null, stdout: '', error: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }) } : okRound()));
    assert.equal(d.calls.length, 3);
    assert.equal(d.exit, 1);
  });
});

// ---- A4 package.json strings ----
describe('A4 package.json', () => {
  const pj = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
  it('verify has no "witness"', () => assert.ok(!/witness/.test(pj.scripts.verify), pj.scripts.verify));
  it('gate:release exact', () => assert.equal(pj.scripts['gate:release'], 'node test/witness-release.mjs'));
  it('prepublishOnly exact', () =>
    assert.equal(pj.scripts.prepublishOnly, 'npm run verify && node test/witness-release.mjs --if-stale && npm run bundle-check'));
});

// ---- addendum 2: stamp, in a temp dir (no spawning) ----
describe('addendum 2 stamp (--if-stale)', () => {
  const SHIPPED = ['FastBit32.js', 'README.md'];
  const HARNESS = ['test/witness.mjs', 'test/witness/run-one.mjs', 'test/witness-release.mjs'];
  const dirs = [];
  function mk() {
    const d = realpathSync(mkdtempSync(join(tmpdir(), 'fb32-stamp-')));
    dirs.push(d);
    mkdirSync(join(d, 'test', 'witness'), { recursive: true });
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 't', files: SHIPPED }));
    for (const f of [...SHIPPED, ...HARNESS]) writeFileSync(join(d, f), 'content of ' + f + '\n');
    return d;
  }
  const passRun = () => ({ exit: 0, records: rep(5, () => ({ status: 0 })) });
  const stamped = () => { const d = mk(); assert.equal(M.writeStamp(d, passRun()).written, true); return d; };

  it('a match skips (checkStamp.match true) right after a pass is stamped', () => {
    const d = stamped();
    assert.equal(M.checkStamp(d).match, true);
  });
  it('a changed shipped file reruns', () => {
    const d = stamped();
    writeFileSync(join(d, 'FastBit32.js'), 'edited\n');
    assert.equal(M.checkStamp(d).match, false);
  });
  for (const h of HARNESS) {
    it('a changed harness file reruns: ' + h, () => {
      const d = stamped();
      writeFileSync(join(d, h), 'edited\n');
      assert.equal(M.checkStamp(d).match, false);
    });
  }
  it('a missing stamp reruns', () => assert.equal(M.checkStamp(mk()).match, false));
  it('a corrupt stamp reruns (garbage, truncated, wrong type, empty object)', () => {
    const d = stamped();
    const path = join(d, '.gate-release.json');
    const good = readFileSync(path, 'utf8');
    for (const bad of ['not json', good.slice(0, good.length >> 1), '[]', '{}', 'null', '']) {
      writeFileSync(path, bad);
      assert.equal(M.checkStamp(d).match, false, JSON.stringify(bad.slice(0, 20)));
    }
  });
  it('a non-0 result is never written (exit 1 and 2)', () => {
    for (const exit of [1, 2]) {
      const d = mk();
      assert.equal(M.writeStamp(d, { exit, records: rep(5, () => ({ status: 0 })) }).written, false);
      assert.equal(existsSync(join(d, '.gate-release.json')), false);
      assert.equal(M.checkStamp(d).match, false);
    }
  });
  it('the stamp lists sha256 of every files[] and harness entry', () => {
    const d = stamped();
    const st = JSON.parse(readFileSync(join(d, '.gate-release.json'), 'utf8'));
    assert.deepEqual(Object.keys(st.files).sort(), [...SHIPPED, ...HARNESS].sort());
    for (const h of Object.values(st.files)) assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(st.node, process.version);
  });
  it('cleanup', () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
});

describe('addendum 5 stamp: package.json hash, runRelease stamp lifecycle', () => {
  const SHIPPED = ['FastBit32.js', 'README.md'];
  const HARNESS = ['test/witness.mjs', 'test/witness/run-one.mjs', 'test/witness-release.mjs'];
  const dirs = [];
  const PJ = (v) => JSON.stringify({ name: 't', version: v, files: SHIPPED });
  function mk() {
    const d = realpathSync(mkdtempSync(join(tmpdir(), 'fb32-stamp5-')));
    dirs.push(d);
    mkdirSync(join(d, 'test', 'witness'), { recursive: true });
    writeFileSync(join(d, 'package.json'), PJ('1.0.0'));
    for (const f of [...SHIPPED, ...HARNESS]) writeFileSync(join(d, f), 'content of ' + f + '\n');
    return d;
  }
  const quiet = { log: () => {}, err: () => {} };
  const stampPath = (d) => join(d, '.gate-release.json');
  const gate = (d, txt, status) => runRelease(() => ({ status, stdout: txt, signal: null }), { ...quiet, stampDir: d });

  it('a changed package.json reruns; restoring the bytes matches again', () => {
    const d = mk();
    assert.equal(M.writeStamp(d, { exit: 0, records: rep(5, () => ({ status: 0 })) }).written, true);
    const orig = readFileSync(join(d, 'package.json'));
    assert.equal(M.checkStamp(d).match, true);
    writeFileSync(join(d, 'package.json'), PJ('1.0.1'));
    assert.equal(M.checkStamp(d).match, false);
    writeFileSync(join(d, 'package.json'), orig);
    assert.equal(M.checkStamp(d).match, true);
  });

  it('a stamp with no pkg field -> no match', () => {
    const d = mk();
    M.writeStamp(d, { exit: 0, records: rep(5, () => ({ status: 0 })) });
    const st = JSON.parse(readFileSync(stampPath(d), 'utf8'));
    delete st.pkg;
    writeFileSync(stampPath(d), JSON.stringify(st));
    assert.equal(M.checkStamp(d).match, false);
  });

  it('the stamp holds pkg (64 hex) and files = files[] + harness', () => {
    const d = mk();
    M.writeStamp(d, { exit: 0, records: rep(5, () => ({ status: 0 })) });
    const st = JSON.parse(readFileSync(stampPath(d), 'utf8'));
    assert.match(st.pkg, /^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(st.files).sort(), [...SHIPPED, ...HARNESS].sort());
  });

  it('runRelease stampDir: exit 0 writes the stamp', () => {
    const d = mk();
    assert.equal(gate(d, OK_TXT, 0).exit, 0);
    assert.equal(M.checkStamp(d).match, true);
  });

  it('runRelease stampDir: a later exit 1 (fail fixture, 3 rounds) deletes the old stamp', () => {
    const d = mk();
    assert.equal(gate(d, OK_TXT, 0).exit, 0);
    assert.equal(M.checkStamp(d).match, true);
    const r = runRelease((env, i) => (i < 3 ? { status: 1, stdout: FAIL_TXT, signal: null } : { status: 0, stdout: OK_TXT, signal: null }), { ...quiet, stampDir: d });
    assert.equal(r.exit, 1);
    assert.equal(existsSync(stampPath(d)), false);
    assert.equal(M.checkStamp(d).match, false);
  });

  it('runRelease stampDir: a later exit 2 (3 HOST rounds) deletes the old stamp', () => {
    const d = mk();
    assert.equal(gate(d, OK_TXT, 0).exit, 0);
    assert.equal(M.parseRound(HOST_TXT, 2).kind, 'host');   // the synthetic HOST text is a real HOST round
    const r = runRelease((env, i) => (i < 3 ? { status: 2, stdout: HOST_TXT, signal: null } : { status: 0, stdout: OK_TXT, signal: null }), { ...quiet, stampDir: d });
    assert.equal(r.exit, 2);
    assert.equal(existsSync(stampPath(d)), false);
    assert.equal(M.checkStamp(d).match, false);
  });

  it('cleanup', () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
});

describe('addendum 5b stamp: node, exit, edit during the run', () => {
  const SHIPPED = ['FastBit32.js', 'README.md'];
  const HARNESS = ['test/witness.mjs', 'test/witness/run-one.mjs', 'test/witness-release.mjs'];
  const dirs = [];
  function mk() {
    const d = realpathSync(mkdtempSync(join(tmpdir(), 'fb32-stamp5b-')));
    dirs.push(d);
    mkdirSync(join(d, 'test', 'witness'), { recursive: true });
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0', files: SHIPPED }));
    for (const f of [...SHIPPED, ...HARNESS]) writeFileSync(join(d, f), 'content of ' + f + '\n');
    return d;
  }
  const stamped = () => { const d = mk(); M.writeStamp(d, { exit: 0, records: rep(5, () => ({ status: 0 })) }); return d; };
  const edit = (d, f) => { const p = join(d, '.gate-release.json'); const st = JSON.parse(readFileSync(p, 'utf8')); f(st); writeFileSync(p, JSON.stringify(st)); };

  it('a node-version mismatch -> no match', () => {
    const d = stamped();
    assert.equal(M.checkStamp(d).match, true);
    edit(d, (st) => { st.node = 'v0.0.0-other'; });
    assert.equal(M.checkStamp(d).match, false);
  });
  it('a stamp holding exit != 0 -> no match', () => {
    for (const x of [1, 2]) {
      const d = stamped();
      edit(d, (st) => { st.exit = x; });
      assert.equal(M.checkStamp(d).match, false, 'exit ' + x);
    }
  });
  it('a stamped file edited during round 4 -> exit 1 (HARNESS), NO stamp written', () => {
    const d = mk();
    const r = runRelease((env, i) => {
      if (i === 3) writeFileSync(join(d, 'FastBit32.js'), 'edited mid-run\n');
      return { status: 0, stdout: OK_TXT, signal: null };
    }, { log: () => {}, err: () => {}, stampDir: d });
    assert.equal(r.exit, 1);
    assert.ok(r.decision.harness.some((h) => /stamp not written/.test(h)), r.decision.harness.join('|'));
    assert.equal(existsSync(join(d, '.gate-release.json')), false);
  });
  it('a stamped dir + a spawnRound that THROWS in round 2 -> no stamp left (old one dropped before round 1)', () => {
    const d = stamped();
    assert.equal(M.checkStamp(d).match, true);
    assert.throws(() => runRelease((env, i) => {
      if (i === 1) throw new Error('boom');
      return { status: 0, stdout: OK_TXT, signal: null };
    }, { log: () => {}, err: () => {}, stampDir: d }), /boom/);
    assert.equal(existsSync(join(d, '.gate-release.json')), false);
  });
  it('files[] naming a missing file -> exit 1 with 0 spawnRound calls', () => {
    const d = mk();
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 't', files: [...SHIPPED, 'missing.js'] }));
    let calls = 0;
    const r = runRelease(() => { calls++; return { status: 0, stdout: OK_TXT, signal: null }; }, { log: () => {}, err: () => {}, stampDir: d });
    assert.equal(r.exit, 1);
    assert.equal(calls, 0);
  });
  it('cleanup', () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
});
