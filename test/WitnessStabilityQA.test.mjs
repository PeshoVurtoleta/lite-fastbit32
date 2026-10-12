// QA (witness slope confirm, 2026-10-12): batch B3-slope, task 8s of
// .handoff/plan-witness-stability-delta1.md section (a). Written from the spec
// and ASSERTIONS only, independent of the coder's WitnessConfirm.test.mjs.
//
// The REAL driver (a byte copy of test/witness.mjs) and the FROZEN efbb377
// driver (.handoff/frozen-efbb377/test/witness.mjs, gitignored) each run end to
// end against a FAKE run-one.mjs returning synthetic deterministic rows. The
// fake keeps a PER-SPAWN COUNTER per row (subject/op/mode/lane, a file in the
// temp dir) so a scenario can make only the 1st spawn of a row bad.
//
// Expected exits (spec 8s; frozen values follow the HEAD driver, where a NOISE
// cap failure is an ordinary fails.push -> exit 1):
//   1 MaskUnion resid outlier, 1st spawn only : frozen 1, new 0 + a CONFIRM line
//   2 MaskUnion step on every spawn           : 1 / 1
//   3 select outlier, 1st spawn only          : 1 / 1 (flat rows stay single-shot)
//   4 NOISE cap failure only                  : frozen 1, new 2 + "re-run on a quiet host"
//   5 NOISE cap failure + a real finding      : 1 / 1
//   6 full mode: malformed PRESSURE density subset + PRESSURE NOISE cap failure:
//       1 / 1, new: that row's line reads FAIL (frozen: HOST)
// Every new-driver scenario: `CTRL confirm-slope` reads ok.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

delete process.env.WITNESS_CALIBRATE;
delete process.env.WITNESS_FAST;

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE = join(HERE, 'witness.mjs');
const FROZEN = join(HERE, '..', '.handoff', 'frozen-efbb377', 'test', 'witness.mjs');
const HAVE_FROZEN = existsSync(FROZEN);
const FROZEN_SKIP = HAVE_FROZEN ? false : 'frozen driver .handoff/frozen-efbb377/test/witness.mjs is missing (gitignored): frozen half skipped';

// ---------------------------------------------------------------------------
// fake run-one: argv[2] = JSON spec. WQA_CNT = counter dir. Clean rows mirror
// WitnessSubsetQA's fake (flat 1.00..1.02, linear slope 0.5 + k, the
// foilIterStep shape for the step foil, etc.).
const FAKE = String.raw`
import fs from 'node:fs';
const spec = JSON.parse(process.argv[2]);
const S = process.env.WQA_SCENARIO || 'base';
const { subject, op, lane, mode, params } = spec;
const key = [subject, op, mode, lane].join('_');
const cf = process.env.WQA_CNT + '/' + key;
fs.appendFileSync(cf, 'x');
const n = fs.statSync(cf).size;             // 1 = first spawn of this row
const flat = () => params.map((_, i) => 1 + 0.01 * ((i * 7) % 3));
const noisy = (amp) => params.map((_, i) => 1 + amp * ((i * 7) % 3));
const ramp = () => params.map((d) => 1 + 0.1 * d);
const stepNet = () => params.map((k) => 0.5 + k + (k >= 16 ? 16 : 0));
let net;
if (mode === 'slope') {
  if (subject === 'foilIterQuad') net = params.map((k) => 0.2 + 0.25 * k * k);
  else if (subject === 'foilIterScan32') net = params.map((k) => 9.6 + 0.3 * k);
  else if (subject === 'foilIterStep') net = stepNet();
  else net = params.map((k) => 0.5 + k);
  if (subject === 'fb' && op === 'forEachMaskUnion' && lane === 'HOT') {
    if (S === 'union1' && n === 1) net = net.map((v, i) => (params[i] === 16 ? v + 40 : v));
    if (S === 'unionall') net = stepNet();
  }
  if (S === 'noisefind' && subject === 'fb' && op === 'forEach' && lane === 'HOT') net = net.slice(1);   // malformed: spawn() pushes a finding
} else if (mode === 'kwords') {
  net = params.map(() => 1);
} else if (subject === 'ctlRead' && spec.floor === 'foilKernighan') {
  net = params.map(() => -1);
} else if (mode === 'slot') {
  net = op === 'foilWordScan' ? ramp() : flat();
} else if (subject === 'foilLut16') {
  net = lane === 'PRESSURE' ? params.map((d) => 1 + 0.5 * Math.sin(Math.PI * d / 32)) : flat();
} else if (subject === 'foilSubEps') {
  net = params.map((p) => 1 + (p === 32 || p === 101 ? 0.7 : 0));
} else if (subject !== 'fb' && subject !== 'ctlRead') {
  net = ramp();
} else {
  net = flat();
  const sel = subject === 'fb' && op === 'select';
  // real-op rows of one lane noisy enough for the NOISE cap (HOT 0.27, PRESSURE 0.08 x floor 1):
  // median spread 0.4 (HOT) / 0.1 (PRESSURE) -- and nothing else wrong.
  if ((S === 'noiseonly' || S === 'noisefind') && subject === 'fb' && lane === 'HOT') net = noisy(0.2);
  if (S === 'full6' && subject === 'fb' && lane === 'PRESSURE') net = noisy(0.05);
  if (S === 'sel1' && sel && lane === 'HOT' && mode === 'density' && n === 1) net = net.map((v, i) => (i === 3 ? v + 0.7 : v));
}
let outParams = params;
if (S === 'full6' && subject === 'fb' && op === 'select' && lane === 'PRESSURE' && mode === 'density') {
  outParams = params.map(() => 16);          // spawn-valid (aligned, finite) but the d1..d31 subset repeats one density: malformed
}
const floor = net.map(() => 1);
process.stdout.write(JSON.stringify({ subject, op, lane, mode, params: outParams, raw: net.map((v) => v + 1), floor, net,
  disp: net.map(() => 0.005), rounds: [net], flags: [] }) + '\n');
`;

const SCEN = [
  { id: 1, name: 'union1', fast: true },
  { id: 2, name: 'unionall', fast: true },
  { id: 3, name: 'sel1', fast: true },
  { id: 4, name: 'noiseonly', fast: true },
  { id: 5, name: 'noisefind', fast: true },
  { id: 6, name: 'full6', fast: false },
];

let ROOT;
const runs = { frozen: {}, live: {} };
let cntSeq = 0;

function runDriver(dir, s) {
  return new Promise((res) => {
    const cnt = join(ROOT, 'cnt' + (++cntSeq));
    mkdirSync(cnt);
    const env = { ...process.env, WQA_SCENARIO: s.name, WQA_CNT: cnt };
    delete env.WITNESS_CALIBRATE;
    if (s.fast) env.WITNESS_FAST = '1'; else delete env.WITNESS_FAST;
    execFile(process.execPath, [join(dir, 'witness.mjs')], { env, encoding: 'utf8', maxBuffer: 64 << 20 }, (err, stdout) => {
      const code = err ? err.code : 0;
      const i = stdout.indexOf('\nFAILURES:\n');
      const failures = i < 0 ? [] : stdout.slice(i + 11).split('\n').filter((l) => l.startsWith('  ')).map((l) => l.slice(2));
      res({ code, stdout, failures, lines: stdout.split('\n') });
      rmSync(cnt, { recursive: true, force: true });
    });
  });
}

function mkDriverDir(name, src) {
  const dir = join(ROOT, name);
  mkdirSync(join(dir, 'witness'), { recursive: true });
  copyFileSync(src, join(dir, 'witness.mjs'));
  writeFileSync(join(dir, 'witness', 'run-one.mjs'), FAKE);
  return dir;
}

describe('witness slope confirm / exit codes -- frozen efbb377 vs live driver, synthetic run-one', () => {
  before(async () => {
    // realpath: macOS tmpdir() is a symlink; the FROZEN efbb377 driver runs only when argv[1] is its real path
    // (the live driver realpaths both sides of its entry guard, so for it this is belt-and-braces).
    ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'fb32-wstab-')));
    const t0 = Date.now();
    const targets = [['live', LIVE]];
    if (HAVE_FROZEN) targets.unshift(['frozen', FROZEN]);
    // serial, one driver at a time
    for (const [who, src] of targets) {
      const dir = mkDriverDir(who, src);
      for (const s of SCEN) runs[who][s.id] = await runDriver(dir, s);
    }
    console.log('WitnessStabilityQA scenario runs wall time: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  }, { timeout: 900000 });
  after(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

  const ctl = (r) => r.lines.filter((l) => /^ {2}CTRL confirm-slope/.test(l));
  const ctlOk = (r, id) => {
    const c = ctl(r);
    assert.equal(c.length, 1, 'scenario ' + id + ': expected one CTRL confirm-slope line, got ' + c.length + '\n' + r.stdout.slice(-1500));
    assert.ok(/\bok\b/.test(c[0]) && !/FAIL/.test(c[0]), c[0]);
  };
  // HOT lane NOISE-failed (scenarios 4, 5): the live driver always prints the CTRL line, and it must be
  // exactly the not-run HOST form (confirmSlope is skipped under HOST_BAD.HOT).
  const NOT_RUN = '  CTRL confirm-slope foilIterStep as a real iterator: not run (HOST(no verdict: lane NOISE failed))';
  const ctlNotRun = (r, id) => {
    const c = ctl(r);
    assert.equal(c.length, 1, 'scenario ' + id + ': expected one CTRL confirm-slope line, got ' + c.length);
    assert.equal(c[0], NOT_RUN);
  };
  const confirmLines = (r) => r.lines.filter((l) => /^ {2}CONFIRM/.test(l));

  for (const who of ['frozen', 'live']) {
    const sk = who === 'frozen' ? FROZEN_SKIP : false;
    const R = (id) => runs[who][id];

    it(who + ' 1: MaskUnion resid outlier on the 1st spawn only -> ' + (who === 'frozen' ? 'exit 1' : 'exit 0 + CONFIRM line'), { skip: sk }, () => {
      const r = R(1);
      if (who === 'frozen') {
        assert.equal(r.code, 1, r.stdout.slice(-1500));
        assert.ok(r.failures.some((f) => /^SLOPE forEachMaskUnion/.test(f)), r.failures.join('\n'));
      } else {
        assert.equal(r.code, 0, r.failures.join('\n'));
        assert.deepEqual(r.failures, []);
        const c = confirmLines(r).filter((l) => /forEachMaskUnion/.test(l));
        assert.equal(c.length, 1, 'CONFIRM lines: ' + confirmLines(r).join('\n'));
        assert.equal(confirmLines(r).length, 1, 'only the bad row confirms: ' + confirmLines(r).join('\n'));
        ctlOk(r, 1);
      }
    });

    it(who + ' 2: MaskUnion step on every spawn -> exit 1', { skip: sk }, () => {
      const r = R(2);
      assert.equal(r.code, 1, r.stdout.slice(-1500));
      assert.ok(r.failures.some((f) => /^SLOPE forEachMaskUnion/.test(f)), r.failures.join('\n'));
      if (who === 'live') ctlOk(r, 2);
    });

    it(who + ' 3: select outlier on the 1st spawn only -> exit 1 (flat rows stay single-shot)', { skip: sk }, () => {
      const r = R(3);
      assert.equal(r.code, 1, r.stdout.slice(-1500));
      assert.ok(r.failures.some((f) => /^select \(density\) \[HOT\]/.test(f)), r.failures.join('\n'));
      if (who === 'live') {
        assert.equal(confirmLines(r).filter((l) => /select/.test(l)).length, 0, 'no CONFIRM for a flat row');
        ctlOk(r, 3);
      }
    });

    it(who + ' 4: NOISE cap failure only -> ' + (who === 'frozen' ? 'exit 1' : 'exit 2 + "re-run on a quiet host"'), { skip: sk }, () => {
      const r = R(4);
      // nothing else wrong: the single failure is the HOT NOISE cap
      assert.equal(r.failures.length, 1, r.failures.join('\n') + '\n' + r.stdout.slice(-1500));
      assert.match(r.failures[0], /^NOISE HOT/);
      if (who === 'frozen') {
        assert.equal(r.code, 1);
      } else {
        assert.equal(r.code, 2, r.stdout.slice(-1500));
        assert.ok(r.stdout.includes('re-run on a quiet host'), r.stdout.slice(-1500));
        ctlNotRun(r, 4);
      }
    });

    it(who + ' 5: NOISE cap failure plus a real finding -> exit 1', { skip: sk }, () => {
      const r = R(5);
      assert.equal(r.code, 1, r.stdout.slice(-1500));
      assert.ok(r.failures.some((f) => /^NOISE HOT/.test(f)), r.failures.join('\n'));
      assert.ok(r.failures.some((f) => /malformed or non-finite result/.test(f)), r.failures.join('\n'));
      if (who === 'live') {
        assert.ok(!r.stdout.includes('re-run on a quiet host'), 'a real finding must not be reported as a host-only exit');
        ctlNotRun(r, 5);
      }
    });

    it(who + ' 6: full mode, malformed PRESSURE density subset + NOISE cap failure -> exit 1' + (who === 'live' ? ', row line reads FAIL not HOST' : ''), { skip: sk }, () => {
      const r = R(6);
      assert.equal(r.code, 1, r.stdout.slice(-1500));
      assert.ok(r.failures.some((f) => /^NOISE PRESSURE/.test(f)), r.failures.join('\n'));
      const row = r.lines.filter((l) => /^ {2}FLAT +PRESSURE +select \(density\).*malformed or misaligned/.test(l));
      assert.equal(row.length, 1, r.stdout.slice(-2500));
      if (who === 'live') {
        assert.ok(/ FAIL$/.test(row[0]) && !/HOST/.test(row[0]), row[0]);
        assert.ok(r.failures.some((f) => /^select \(density\) \[PRESSURE\].*malformed or misaligned/.test(f)), r.failures.join('\n'));
        assert.ok(!r.failures.some((f) => /malformed or non-finite result/.test(f)), 'the finding must come from the subset, not from spawn(): ' + r.failures.join('\n'));
        ctlOk(r, 6);
      } else {
        // frozen relabels the malformed subset HOST (the intentional 10b change)
        assert.ok(/HOST/.test(row[0]), row[0]);
      }
    });
  }
});
