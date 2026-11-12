// AF-2 (U-16 / U-6 / U-1): d.ts mutation runner. Run as main:  node test/types/af2-dts-mutants.mjs
// Each mutant is applied to a COPY of the package (FastBit32.js, FastBit32.d.ts, test/types,
// package.json; node_modules symlinked), compared against an UNMUTATED control copy (exit 0).
// A mutant is killed when tsc exits != 0 with `want` reported at the line of its own
// @ts-expect-error row (Law 3). Fails closed: anchor count != 1, leftover dir, empty verdict.
// Also records the directive-stripped U-6 codes and the OLD d.ts (7 x TS2578). ASCII-only.
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, symlinkSync, mkdtempSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRATCH = process.env.AF2_SCRATCH || join(tmpdir(), 'af2-dts');
const TSC = join(ROOT, 'node_modules', '.bin', 'tsc');
const ROWS = 'test/types/af2.test-d.ts';
const DTS = 'FastBit32.d.ts';
const fail = (m) => { console.error('FAIL-CLOSED: ' + m); process.exitCode = 1; throw new Error(m); };

const priv = (name, type) => '\n    /** Reserves the runtime field name (not API). */\n    private readonly ' + name + ': ' + type + ';\n';
const DROP = [
    ['U-6 drop _cap', '_cap', 'number', 'U-6 _cap'],
    ['U-6 drop _n', '_n', 'number', 'U-6 _n'],
    ['U-6 drop _active', '_active', 'number', 'U-6 _active'],
    ['U-6 drop _full', '_full', 'number', 'U-6 _full'],
    ['U-6 drop _data', '_data', 'Int32Array', 'U-6 _data'],
    ['U-6 drop _map', '_map', 'Map<string, number>', 'U-6 _map'],
    ['U-6 drop _reverse', '_reverse', '(string | undefined)[]', 'U-6 _reverse']
];
// [name, anchor, replacement, row marker, extra expected code]
const MUT = [
    ['B-16 size-writable', '    /** Number of set bits (exact, O(1)). */\n    readonly size: number;', '    /** Number of set bits (exact, O(1)). */\n    size: number;', 'FastBit1024.size is readonly', []],
    ['B-16 getname-string', '    getName(bit: number): string | undefined;', '    getName(bit: number): string;', 'getName returns string | undefined', []],
    ['B-16 select-optional', '    select(k: number): number;\n\n    // half-open ranges', '    select(k?: number): number;\n\n    // half-open ranges', 'select needs k', []],
    ['B-16 hasall-takes-set', '    hasAll(mask: number): boolean;\n\n    /**\n     * Tests whether **any**', '    hasAll(mask: number | FastBit32): boolean;\n\n    /**\n     * Tests whether **any**', 'a set object is not a mask', []],
    ['A-5 count-Numbr', 'count(): number;                 // 0..64', 'count(): Numbr;                  // 0..64', 'count() is a number', ['TS2552']],
    ...DROP.map(([n, f, t, row]) => [n, priv(f, t), '', row, []])
];

function tree(dir, edits) {
    mkdirSync(join(dir, 'test'), { recursive: true });
    for (const f of ['FastBit32.js', DTS, 'package.json']) cpSync(join(ROOT, f), join(dir, f));
    cpSync(join(ROOT, 'test', 'types'), join(dir, 'test', 'types'), { recursive: true, filter: (s) => !/af2-dts-mutants\.mjs$/.test(s) });
    symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
    for (const [file, from, to] of edits) {
        const p = join(dir, file), s = readFileSync(p, 'utf8'), n = s.split(from).length - 1;
        if (n !== 1) fail('anchor matched ' + n + ' (want 1) in ' + file + ': ' + JSON.stringify(from.slice(0, 60)));
        writeFileSync(p, s.split(from).join(to));
    }
}
const tsc = (dir) => { const r = spawnSync(TSC, ['-p', 'test/types/tsconfig.json'], { cwd: dir, encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
// error lines in af2.test-d.ts -> [{line, code}]
const errs = (out) => [...out.matchAll(/af2\.test-d\.ts\((\d+),\d+\): error (TS\d+)/g)].map((m) => ({ line: +m[1], code: m[2] }));
const allCodes = (out) => [...new Set((out.match(/error (TS\d+)/g) || []).map((x) => x.slice(6)))];
// line number of the @ts-expect-error directive whose text contains `marker`
function rowLine(marker) {
    const ls = readFileSync(join(ROOT, ROWS), 'utf8').split('\n');
    const hit = ls.map((l, i) => (/@ts-expect-error/.test(l) && l.includes(marker) ? i + 1 : 0)).filter(Boolean);
    if (hit.length !== 1) fail('row marker ' + JSON.stringify(marker) + ' matched ' + hit.length);
    return hit[0];
}

const lines = [];
const say = (s) => { lines.push(s); console.log(s); };
if (existsSync(SCRATCH)) fail('leftover scratch dir ' + SCRATCH);
mkdirSync(SCRATCH, { recursive: true });
let bad = 0;

const ctl = join(SCRATCH, 'control'); tree(ctl, []);
const c = tsc(ctl);
say('control (unmutated): exit ' + c.code + (c.code ? ' ' + allCodes(c.out) : ''));
if (c.code !== 0) { bad++; say('FAIL control must exit 0\n' + c.out); }

say('\nmutant | exit | codes at row | row line | verdict');
let n = 0;
for (const [name, from, to, marker, extra] of MUT) {
    const d = join(SCRATCH, 'm' + n++); tree(d, [[DTS, from, to]]);
    const r = tsc(d), line = rowLine(marker), at = errs(r.out).filter((e) => e.line === line).map((e) => e.code);
    const ok = r.code !== 0 && at.includes('TS2578') && extra.every((x) => allCodes(r.out).includes(x));
    if (!ok) bad++;
    say([name, r.code, at.join(',') || 'none', line, ok ? 'KILLED' : 'SURVIVES/WRONG-REASON'].join(' | ') + (extra.length ? ' (+' + extra + ' in output)' : ''));
}

// directive-stripped U-6 rows on the patched d.ts: each shadow class errors TS2415 / TS2416 at its own line
say('\nU-6 directive-stripped (patched d.ts): row | codes');
const sd = join(SCRATCH, 'stripped'); tree(sd, []);
const rp = join(sd, ROWS), src = readFileSync(rp, 'utf8').split('\n');
const u6 = []; src.forEach((l, i) => { if (/@ts-expect-error -- U-6 /.test(l)) u6.push([l.replace(/^.*U-6 /, ''), i + 2]); });
if (u6.length !== 7) fail('expected 7 U-6 rows, saw ' + u6.length);
writeFileSync(rp, src.map((l) => (/@ts-expect-error -- U-6 /.test(l) ? '//' : l)).join('\n'));
const sr = tsc(sd), se = errs(sr.out);
for (const [nm, ln] of u6) { const cs = se.filter((e) => e.line === ln).map((e) => e.code); if (!cs.some((x) => x === 'TS2415' || x === 'TS2416')) bad++; say(nm + ' | ' + (cs.join(',') || 'none')); }
if (se.length !== 7) { bad++; say('FAIL: expected exactly 7 errors with U-6 directives stripped, saw ' + se.length); }

// old d.ts: the 7 U-6 expect-errors are unused -> 7 x TS2578 (all at U-6 rows)
const old = join(SCRATCH, 'old'); tree(old, []);
const OLD = process.env.AF2_OLD_DTS || join(ROOT, '.handoff', 'frozen-af2', DTS);
if (!existsSync(OLD)) fail('frozen d.ts missing: ' + OLD);
cpSync(OLD, join(old, DTS));
const orr = tsc(old), oe = errs(orr.out), u6lines = new Set(u6.map((x) => x[1] - 1));
const o2578 = oe.filter((e) => e.code === 'TS2578' && u6lines.has(e.line));
say('\nOLD d.ts: exit ' + orr.code + ', TS2578 at U-6 rows: ' + o2578.length + ' (want 7), other errors: ' + (oe.length - o2578.length));
if (orr.code === 0 || o2578.length !== 7 || oe.length !== 7) bad++;

rmSync(SCRATCH, { recursive: true, force: true });
if (existsSync(SCRATCH)) fail('scratch dir not removed');
if (lines.length < 10 || n !== 12) fail('empty / short verdict');
say('\n' + (bad ? 'FAILED: ' + bad : 'ALL ' + n + ' MUTANTS KILLED; control green; OLD d.ts red x7'));
if (bad) process.exitCode = 1;
