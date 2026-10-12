// QA (release gate, 2026-10-12): batch B2 task 6 of .handoff/plan-release-gate.md,
// addendum 3. Written from the spec only. It SPAWNS processes (5 serial witness
// rounds per scenario, each many fake run-one processes), but its data is
// synthetic and does not depend on the host, so it runs under npm test in every
// verify / prepublishOnly.
//
// A byte copy of test/witness.mjs and test/witness-release.mjs runs in a temp
// package against a FAKE run-one.mjs (modelled on WitnessStabilityQA's fake). The
// fake keeps a per-row spawn counter, so a flat row is spawned once per round and
// its counter equals the round number.
//   clean     every row clean on every round          -> gate exit 0
//   sel3      select (density) HOT steps in rounds 1-3 -> 3 of 5 FAIL = finding -> exit 1
//   noiseonly HOT real rows noisy in every round       -> 5 HOST rounds -> exit 2
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

delete process.env.WITNESS_CALIBRATE;
delete process.env.WITNESS_FAST;

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));

const FAKE = String.raw`
import fs from 'node:fs';
const spec = JSON.parse(process.argv[2]);
const S = process.env.WQA_SCENARIO || 'clean';
const { subject, op, lane, mode, params } = spec;
const key = [subject, op, mode, lane].join('_');
const cf = process.env.WQA_CNT + '/' + key;
fs.appendFileSync(cf, 'x');
const n = fs.statSync(cf).size;             // spawn number of this row = round number for single-shot rows
const flat = () => params.map((_, i) => 1 + 0.01 * ((i * 7) % 3));
const noisy = (amp) => params.map((_, i) => 1 + amp * ((i * 7) % 3));
const ramp = () => params.map((d) => 1 + 0.1 * d);
let net;
if (mode === 'slope') {
  if (subject === 'foilIterQuad') net = params.map((k) => 0.2 + 0.25 * k * k);
  else if (subject === 'foilIterScan32') net = params.map((k) => 9.6 + 0.3 * k);
  else if (subject === 'foilIterStep') net = params.map((k) => 0.5 + k + (k >= 16 ? 16 : 0));
  else net = params.map((k) => 0.5 + k);
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
  if (S === 'noiseonly' && subject === 'fb' && lane === 'HOT') net = noisy(0.2);
  if (S === 'sel3' && sel && lane === 'HOT' && mode === 'density' && n <= 3) net = net.map((v, i) => (i === 3 ? v + 0.7 : v));
}
const floor = net.map(() => 1);
process.stdout.write(JSON.stringify({ subject, op, lane, mode, params, raw: net.map((v) => v + 1), floor, net,
  disp: net.map(() => 0.005), rounds: [net], flags: [] }) + '\n');
`;

// exit 1 is shared by FINDING and HARNESS, so each scenario also checks the stdout.
const SCEN = [
  { name: 'clean', exit: 0, has: [/stamp written/], not: [/HARNESS/] },
  { name: 'sel3', exit: 1, has: [/FINDING real +FLAT select \(density\): FAIL 3, ok 2/], not: [/HARNESS/] },
  { name: 'noiseonly', exit: 2, has: [/HOST rounds: 1,2,3,4,5/], not: [] },
];

let ROOT;
const runs = {};
let seq = 0;

// A temp package: <root>/pkgN/{package.json, stub shipped files, test/{witness.mjs, witness-release.mjs, witness/run-one.mjs}}
function mkPkg() {
  const pkg = join(ROOT, 'pkg' + (++seq));
  mkdirSync(join(pkg, 'test', 'witness'), { recursive: true });
  copyFileSync(join(HERE, 'witness.mjs'), join(pkg, 'test', 'witness.mjs'));
  copyFileSync(join(HERE, 'witness-release.mjs'), join(pkg, 'test', 'witness-release.mjs'));
  writeFileSync(join(pkg, 'test', 'witness', 'run-one.mjs'), FAKE);
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'tmp-pkg', type: 'module', files: PKG.files }));
  for (const f of PKG.files) writeFileSync(join(pkg, f), 'stub ' + f + '\n');
  return pkg;
}

function runGate(pkg, scenario) {
  return new Promise((res) => {
    const cnt = join(ROOT, 'cnt' + (++seq));
    mkdirSync(cnt);
    const env = { ...process.env, WQA_SCENARIO: scenario, WQA_CNT: cnt };
    delete env.WITNESS_CALIBRATE;
    delete env.WITNESS_FAST;
    execFile(process.execPath, [join(pkg, 'test', 'witness-release.mjs')], { env, cwd: pkg, encoding: 'utf8', maxBuffer: 256 << 20 },
      (err, stdout, stderr) => {
        res({ code: err ? err.code : 0, stdout, stderr });
        rmSync(cnt, { recursive: true, force: true });
      });
  });
}

describe('gate:release end to end -- real drivers, synthetic run-one, 5 rounds per scenario', () => {
  before(async () => {
    // realpath: belt-and-braces only. Both drivers realpath both sides of their entry guard, so a
    // symlinked tmpdir() (macOS) no longer stops them running.
    ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'fb32-wrel-')));
    for (const s of SCEN) runs[s.name] = await runGate(mkPkg(), s.name);   // serial
  }, { timeout: 1800000 });
  after(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

  for (const s of SCEN) {
    it(s.name + ' -> exit ' + s.exit, () => {
      const r = runs[s.name];
      assert.equal(r.code, s.exit, 'stdout tail:\n' + r.stdout.slice(-2000) + '\nstderr:\n' + r.stderr.slice(-1000));
      for (const re of s.has) assert.match(r.stdout, re);
      for (const re of s.not) assert.doesNotMatch(r.stdout, re);
    });
  }
});
