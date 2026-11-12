// test/fixtures/af2-mutants.mjs -- AF-2 (audit 1.7) mutant data + runner (run as main; importing it only
// reads the data). LEDGER Law 3: every new row fails on its mutant, for its own reason (`expect`); E4: a
// mutant is compared with an UNMUTATED copy of the same tree, never with "0 failures".
//
// Per run: copy the package tree (no .git / node_modules / .handoff / audit) to <root>/<id>, symlink
// node_modules, overwrite FastBit32.js / FastBit32.d.ts / package.json with the frozen bb4e41c set
// (.handoff/frozen-af2, sha256/8 checked against its SHA.txt), apply ONE mutant (every anchor must match
// exactly once), then run two lanes with the TAP reporter:
//   new: the 3 AF-2 files (AF2Pins, AF2Rows, the new Hygiene)  -> must red exactly the mutant's rows
//   old: HEAD's test/*.test.mjs with the frozen HEAD Hygiene     -> the gap: does the old set survive?
// The old lane reads git history (git show) through GIT_DIR = the live .git, read-only.
//
// Fails closed (exit 1) on: a missing frozen file or a SHA.txt mismatch, an anchor count != 1, a non-empty
// scratch root at start or end, a TAP stream with no tests or whose fail count disagrees with the parsed
// rows, a control with any new-lane failure, a mutant with an empty or unexpected verdict.
//
// Run (spawns processes; untimed verdicts, shared host -> under the quiet lock):
//   node ~/.claude/hooks/quiet-lock.mjs run "fastbit32 af2 mutants" -- node test/fixtures/af2-mutants.mjs
// Env: AF2_MUT_ROOT (scratch root; default <tmpdir>/fastbit32-af2-mut), AF2_JOBS (default 2).
// AF2_ONLY=<id,id> runs a subset (plus the control). Flag: --new-only skips the old lane. AF2_DUMP=<id> prints that mutant's red-row TAP blocks.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, rmdirSync, cpSync, symlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, isAbsolute, sep, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const JS = 'FastBit32.js', DTS = 'FastBit32.d.ts', PKG = 'package.json';
export const NEW_FILES = ['test/AF2Pins.test.mjs', 'test/AF2Rows.test.mjs', 'test/Hygiene.test.mjs'];
const HYG = 'test/Hygiene.test.mjs', HYG_FROZEN = 'test/HygieneFrozen.test.mjs';

// FIX-2 guards (anchors from the audit-scratch confirm/edits.mjs, one site each) need the cold helper
const HELPER = [JS, 'export class FastBit32 {\n    constructor(initial = 0) {',
    'function fb32BadOther(other) {\n    throw new TypeError(\'FastBit32: expected a FastBit32, got \' + ' +
    '(other === null ? \'null\' : typeof other));\n}\n\nexport class FastBit32 {\n    constructor(initial = 0) {'];
const FOREACH_LIVE = '        for (let v = this.#lo; v !== 0; v &= v - 1) callback(31 - Math.clz32(v & -v));\n' +
    '        for (let v = this.#hi; v !== 0; v &= v - 1) callback(63 - Math.clz32(v & -v));\n        return this;';
const FOREACH_SNAP = '        const h = this.#hi;\n' +
    '        for (let v = this.#lo; v !== 0; v &= v - 1) callback(31 - Math.clz32(v & -v));\n' +
    '        for (let v = h; v !== 0; v &= v - 1) callback(63 - Math.clz32(v & -v));\n        return this;';
// an AF2Pins cell that became a throw: a `+` (actual-only) diff line holding 'throws TypeError'
const PLUS_THROW = /^\s*\+\s+'throws TypeError'/m;
const PIN = (fam) => new RegExp('^AF2Pins\\.test\\.mjs :: characterization: .*AF-2 U-1 ' + fam);

// id, why, edits [file, from, to], expect { rows: every new row matches one, each matched; text: all match }
export const MUTANTS = [
    { id: 'fix2-copy', why: 'FIX-2 guard: copy(other) throws on a non-number other.value',
        edits: [HELPER, [JS, '    copy(other) {\n        this.value = other.value;',
            '    copy(other) {\n        const v = other.value;\n        if (typeof v !== \'number\') fb32BadOther(other);\n        this.value = v;']],
        expect: { rows: [PIN('FastBit32#copy')], text: [PLUS_THROW] } },
    { id: 'fix2-equals', why: 'FIX-2 guard: equals(other) throws on a non-number other.value',
        edits: [HELPER, [JS, '    equals(other) {\n        return (this.value ^ other.value) === 0;',
            '    equals(other) {\n        const v = other.value;\n        if (typeof v !== \'number\') fb32BadOther(other);\n        return (this.value ^ v) === 0;']],
        expect: { rows: [PIN('FastBit32#equals')], text: [PLUS_THROW] } },
    { id: 'fix2-forEachArray', why: 'FIX-2 iterator guard, forEachArray only',
        edits: [HELPER, [JS, 'export function forEachArray(mask, array, callback) {\n    let v = mask.value;\n',
            'export function forEachArray(mask, array, callback) {\n    let v = mask.value;\n    if (typeof v !== \'number\') fb32BadOther(mask);\n']],
        expect: { rows: [PIN('forEachArray')], text: [PLUS_THROW] } },
    { id: 'fix2-pair', why: 'FIX-2 pair guard, forEachMaskPair',
        edits: [HELPER, [JS, '    let v = maskA.value & maskB.value;',
            '    const a = maskA.value, b = maskB.value;\n    if (typeof a !== \'number\' || typeof b !== \'number\') ' +
            'fb32BadOther(typeof a !== \'number\' ? maskA : maskB);\n    let v = a & b;']],
        expect: { rows: [PIN('forEachMaskPair')], text: [PLUS_THROW] } },
    { id: 'fix2-fromArray', why: 'FIX-2 guard: FastBit32#fromArray throws when bits.length is not a number',
        edits: [[JS, '    fromArray(bits) {\n        let v = 0;\n        for (let i = 0; i < bits.length; i++) {',
            '    fromArray(bits) {\n        if (typeof bits.length !== \'number\') throw new TypeError(\'FastBit32: fromArray expects an ' +
            'Array or a TypedArray, got \' + typeof bits);\n        let v = 0;\n        for (let i = 0; i < bits.length; i++) {']],
        expect: { rows: [PIN('FastBit32#fromArray')], text: [PLUS_THROW] } },
    { id: 'hasall-typeof', why: 'hasAll(mask) throws on a non-number mask',
        edits: [[JS, '    hasAll(mask) {\n        return (~this.value & mask) === 0;',
            '    hasAll(mask) {\n        if (typeof mask !== \'number\') throw new TypeError(\'FastBit32: hasAll expects a number mask\');\n' +
            '        return (~this.value & mask) === 0;']],
        expect: { rows: [PIN('FastBit32 mask ops')], text: [PLUS_THROW] } },
    { id: 'foreach-snap', why: 'CONFIRM FIX-13: FastBit64.forEach snapshots #hi before the walk',
        edits: [[JS, FOREACH_LIVE, FOREACH_SNAP]],
        expect: { rows: [/^AF2Rows\.test\.mjs :: U-13 FastBit64\.forEach/],
            text: [/FastBit64 forEach visit order/, /actual:\s+0: 1\s+1: 5\s+2: 40\b/] } },
    { id: 'clone-subclass', why: 'clone() returns new this.constructor',
        edits: [[JS, '    clone() { return new FastBit64(this.#lo, this.#hi); }',
            '    clone() { return new this.constructor(this.#lo, this.#hi); }']],
        expect: { rows: [/^AF2Rows\.test\.mjs :: U-14 clone\(\)/], text: [/U-14 clone: not a base FastBit64/] } },
    { id: 'deser-subclass', why: 'static deserialize() builds new this()',
        edits: [[JS, '        const s = new FastBit64();\n        s.loadFrom(src, offset);',
            '        const s = new this();\n        s.loadFrom(src, offset);']],
        expect: { rows: [/^AF2Rows\.test\.mjs :: U-14 Sub\.deserialize\(\)/], text: [/U-14 deserialize: not a base FastBit64/] } },
    { id: 'ctor-hi-first', why: 'the constructor checks hi before lo',
        edits: [[JS, '    constructor(lo = 0, hi = 0) {\n        if (!isWord(lo)) fb64BadWord(lo);\n        if (!isWord(hi)) fb64BadWord(hi);',
            '    constructor(lo = 0, hi = 0) {\n        if (!isWord(hi)) fb64BadWord(hi);\n        if (!isWord(lo)) fb64BadWord(lo);']],
        expect: { rows: [/^AF2Rows\.test\.mjs :: U-14 two bad words/], text: [/got 2\.5/] } },
    { id: 'fromarray-ownlength', why: 'FastBit64#fromArray reads bits.length (A-13)',
        edits: [[JS, '        else if (fb1024TaTag.call(bits) !== undefined) n = fb1024TaLength.call(bits);',
            '        else if (fb1024TaTag.call(bits) !== undefined) n = bits.length;']],
        expect: { rows: [/^AF2Rows\.test\.mjs :: U-14 fromArray/], text: [/fromArray\(Short\): intrinsic length/] } },
    { id: 'loadfrom-ownlength', why: 'FastBit64#loadFrom reads src.length (A-12)',
        edits: [[JS, '        const len = fb1024TaLength.call(src);\n        if (offset >= len) fb64BadOffset(offset);',
            '        const len = src.length;\n        if (offset >= len) fb64BadOffset(offset);']],
        expect: { rows: [/^AF2Rows\.test\.mjs :: U-21 loadFrom/], text: [/Liar \(length \+ 64\)/] } },
    { id: 'fields-undefined', why: 'B-15: #lo / #hi start as undefined',
        edits: [[JS, '    #lo = 0; #hi = 0;', '    #lo = undefined; #hi = undefined;']],
        expect: { rows: [/^Hygiene\.test\.mjs :: live FastBit32\.js: one bare field/], text: [/Smi integer literal/, /undefined/] } },
    { id: 'fields-null', why: 'B-15: #lo / #hi start as null',
        edits: [[JS, '    #lo = 0; #hi = 0;', '    #lo = null; #hi = null;']],
        expect: { rows: [/^Hygiene\.test\.mjs :: live FastBit32\.js: one bare field/], text: [/Smi integer literal/, /null/] } },
    { id: 'sideeffects-true', why: 'B-17: package.json sideEffects true',
        edits: [[PKG, '"sideEffects": false,', '"sideEffects": true,']],
        expect: { rows: [/^Hygiene\.test\.mjs :: U-17 sideEffects/], text: [/true !== false/] } },
    { id: 'engines-16', why: 'B-17: package.json engines node >=16',
        edits: [[PKG, '"node": ">=18"', '"node": ">=16"']],
        expect: { rows: [/^Hygiene\.test\.mjs :: U-17 engines/], text: [/>=16/] } }
];

// ---- TAP: leaf failures (type test, not a suite's subtestsFailed) keyed `<file> :: <name>` -----------------
export function parseTap(out) {
    const lines = out.split('\n'), rows = new Map();
    const tot = {};
    for (const m of out.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)) tot[m[1]] = Number(m[2]);
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(\s*)not ok \d+ - (.*)$/);
        if (!m || /# (TODO|SKIP)\b/.test(m[2])) continue;
        const block = [];
        let j = i + 1;
        // the YAML block opens / closes at the test's indent + 2 (a diff's own '...' lines sit deeper)
        if (lines[j] === m[1] + '  ---') {
            for (j++; j < lines.length && lines[j] !== m[1] + '  ...'; j++) block.push(lines[j]);
            if (j >= lines.length) fail('unterminated TAP YAML block for ' + m[2]);
        }
        const b = block.join('\n');
        const type = (b.match(/^\s*type: '(\w+)'/m) || [])[1];
        const ft = (b.match(/^\s*failureType: '(\w+)'/m) || [])[1];
        if (type === 'suite' || ft === 'subtestsFailed') continue;
        const loc = (b.match(/^\s*location: '([^']*)'/m) || [])[1];
        const file = loc ? basename(loc.replace(/:\d+:\d+$/, '')) : '?';
        // TAP escapes # and \ in a test name
        rows.set(file + ' :: ' + m[2].replace(/\\([#\\])/g, '$1'), { ft, block: b });
    }
    return { tot, rows };
}

function fail(msg) { throw new Error('af2-mutants FAIL CLOSED: ' + msg); }
const sha8 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 8);

async function main() {
    const HERE = dirname(fileURLToPath(import.meta.url));
    const ROOT = resolve(HERE, '..', '..');
    const FROZEN = join(ROOT, '.handoff', 'frozen-af2');
    const MUT_ROOT = resolve(process.env.AF2_MUT_ROOT || join(tmpdir(), 'fastbit32-af2-mut'));
    const JOBS = Number(process.env.AF2_JOBS || 2);
    const OLD = !process.argv.includes('--new-only');
    if (!isAbsolute(MUT_ROOT) || MUT_ROOT === ROOT || (MUT_ROOT + sep).startsWith(ROOT + sep)) fail('scratch root inside the package: ' + MUT_ROOT);
    if (!(JOBS >= 1 && JOBS <= 8)) fail('AF2_JOBS out of 1..8');

    // frozen set, hashes from SHA.txt
    const shaTxt = join(FROZEN, 'SHA.txt');
    if (!existsSync(shaTxt)) fail('missing ' + shaTxt);
    const want = new Map();
    for (const l of readFileSync(shaTxt, 'utf8').split('\n')) { const m = l.match(/^([0-9a-f]{8}) (\S+)$/); if (m) want.set(m[2], m[1]); }
    for (const f of [JS, DTS, PKG, HYG]) {
        const p = join(FROZEN, f);
        if (!existsSync(p)) fail('missing frozen ' + f);
        if (want.get(f) !== sha8(p)) fail('frozen ' + f + ' sha ' + sha8(p) + ' != SHA.txt ' + want.get(f));
    }
    for (const f of NEW_FILES) if (!existsSync(join(ROOT, f))) fail('missing ' + f);

    // the old set = HEAD's test/*.test.mjs; every file but Hygiene must be HEAD's bytes in the working tree
    const git = (args) => {
        const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
        if (r.status !== 0) fail('git ' + args.join(' ') + ': ' + r.stderr);
        return r.stdout;
    };
    const oldFiles = git(['ls-tree', '--name-only', 'HEAD', 'test/']).split('\n').filter((f) => /^test\/[^/]+\.test\.mjs$/.test(f));
    if (oldFiles.length < 40 || !oldFiles.includes(HYG)) fail('HEAD test list looks wrong: ' + oldFiles.length);
    const same = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', ...oldFiles.filter((f) => f !== HYG)], { cwd: ROOT, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
    if (same.status !== 0) fail('an old-set test file differs from HEAD');
    if (createHash('sha256').update(git(['show', 'HEAD:' + HYG])).digest('hex').slice(0, 8) !== want.get(HYG)) fail('frozen Hygiene is not HEAD\'s');
    const OLD_RUN = oldFiles.map((f) => (f === HYG ? HYG_FROZEN : f));

    if (existsSync(MUT_ROOT) && readdirSync(MUT_ROOT).length) fail('leftover scratch dir(s) in ' + MUT_ROOT + ': ' + readdirSync(MUT_ROOT).join(', '));
    mkdirSync(MUT_ROOT, { recursive: true });

    const SKIP = new Set(['.git', 'node_modules', '.handoff', 'audit', '.bundle-check']);
    const tree = (id, edits) => {
        const dir = join(MUT_ROOT, id);
        if (existsSync(dir)) fail('scratch dir exists: ' + dir);
        cpSync(ROOT, dir, { recursive: true, filter: (s) => !SKIP.has(relative(ROOT, s).split(sep)[0]) });
        symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
        for (const f of [JS, DTS, PKG]) cpSync(join(FROZEN, f), join(dir, f));
        cpSync(join(FROZEN, HYG), join(dir, HYG_FROZEN));
        for (const [file, from, to] of edits) {
            const p = join(dir, file), s = readFileSync(p, 'utf8'), n = s.split(from).length - 1;
            if (n !== 1) fail(id + ': anchor matched ' + n + ' (want 1) in ' + file + ': ' + JSON.stringify(from.slice(0, 60)));
            writeFileSync(p, s.split(from).join(to));
        }
        return dir;
    };
    const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NODE_OPTIONS: '', GIT_DIR: join(ROOT, '.git'), GIT_OPTIONAL_LOCKS: '0' };
    delete env.NODE_TEST_CONTEXT;
    const lane = (dir, files, what) => new Promise((res, rej) => {
        const p = spawn(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: dir, env });
        let out = '';
        const kill = setTimeout(() => { p.kill('SIGKILL'); rej(new Error(what + ': timeout')); }, 20 * 60 * 1000);
        p.stdout.on('data', (d) => { out += d; });
        p.stderr.on('data', (d) => { out += d; });
        p.on('close', (code) => {
            clearTimeout(kill);
            const t = parseTap(out);
            if (!(t.tot.tests > 0)) return rej(new Error(what + ': empty verdict (no tests in the TAP stream); exit ' + code + '\n' + out.slice(-800)));
            const counted = [...t.rows.values()].filter((r) => r.ft !== 'cancelledByParent').length;
            if (counted !== t.tot.fail) return rej(new Error(what + ': parsed ' + counted + ' failing rows, TAP says fail ' + t.tot.fail));
            res({ code, ...t });
        });
    });
    const job = async (id, edits) => {
        const dir = tree(id, edits);
        try {
            const nw = await lane(dir, NEW_FILES, id + ' new');
            const old = OLD ? await lane(dir, OLD_RUN, id + ' old') : null;
            return { nw, old };
        } finally { rmSync(dir, { recursive: true, force: true }); }
    };

    const t0 = Date.now();
    const ONLY = process.env.AF2_ONLY ? process.env.AF2_ONLY.split(',') : null;
    for (const id of ONLY || []) if (!MUTANTS.some((m) => m.id === id)) fail('AF2_ONLY: unknown mutant ' + id);
    const RUN = ONLY ? MUTANTS.filter((m) => ONLY.includes(m.id)) : MUTANTS;
    const jobs = [['control', []], ...RUN.map((m) => [m.id, m.edits])];
    const res = new Map();
    let err = null;
    await Promise.all(Array.from({ length: JOBS }, async () => {
        while (jobs.length && !err) {
            const [id, e] = jobs.shift();
            try { res.set(id, await job(id, e)); } catch (x) { err = x; }
        }
    }));
    const left = existsSync(MUT_ROOT) ? readdirSync(MUT_ROOT) : [];
    if (left.length) fail('scratch root not empty after the runs: ' + left.join(', '));
    if (existsSync(MUT_ROOT)) rmdirSync(MUT_ROOT);
    if (err) throw err;

    const tot = (t) => 'tests ' + t.tests + ' pass ' + t.pass + ' fail ' + t.fail + ' skip ' + t.skipped + ' todo ' + t.todo;
    const C = res.get('control');
    console.log('af2-mutants: frozen ' + JS + ' ' + want.get(JS) + ', ' + DTS + ' ' + want.get(DTS) + ', ' + PKG + ' ' + want.get(PKG) +
        ', ' + HYG + ' (old lane) ' + want.get(HYG) + '; node ' + process.version + '; jobs ' + JOBS + '; scratch ' + MUT_ROOT);
    console.log('control new lane: ' + tot(C.nw.tot) + (C.nw.rows.size ? ' :: ' + [...C.nw.rows.keys()].join(' | ') : ''));
    if (OLD) console.log('control old lane: ' + tot(C.old.tot) + (C.old.rows.size ? ' :: ' + [...C.old.rows.keys()].join(' | ') : ''));
    let bad = C.nw.tot.fail !== 0 || C.nw.rows.size !== 0 ? ['control new lane is not 0 fail'] : [];
    let survive = 0;
    for (const m of RUN) {
        const r = res.get(m.id);
        const fresh = [...r.nw.rows.keys()].filter((k) => !C.nw.rows.has(k));
        const text = fresh.map((k) => r.nw.rows.get(k).block).join('\n');
        const stray = fresh.filter((k) => !m.expect.rows.some((rx) => rx.test(k)));
        const unmet = m.expect.rows.filter((rx) => !fresh.some((k) => rx.test(k)));
        const noText = m.expect.text.filter((rx) => !rx.test(text));
        const ok = fresh.length > 0 && !stray.length && !unmet.length && !noText.length;
        if (!ok) bad.push(m.id);
        if (process.env.AF2_DUMP === m.id) console.log(text);
        let oldV = '';
        if (OLD) {
            const of = [...r.old.rows.keys()].filter((k) => !C.old.rows.has(k));
            if (!of.length) survive++;
            oldV = ' | old: ' + (of.length ? 'KILLED by ' + of.length + ' (' + of.join(' | ') + ')' : 'survives');
        }
        console.log((ok ? 'PASS ' : 'FAIL ') + m.id.padEnd(20) + ' new rows red ' + fresh.length +
            (fresh.length ? ' (' + fresh.join(' | ') + ')' : '') + '; expect ' + (unmet.length || stray.length ? 'NOT matched' : 'matched') +
            (noText.length ? '; reason text missing ' + noText.join(' ') : '') + oldV);
    }
    if (OLD) console.log('old lane: ' + survive + ' of ' + RUN.length + ' mutants survive HEAD\'s test set + the frozen Hygiene');
    console.log('scratch root after the runs: 0 entries (removed); wall ' + Math.round((Date.now() - t0) / 1000) + ' s');
    console.log(bad.length ? 'VERDICT FAIL: ' + bad.join(', ') : 'VERDICT ok: ' + RUN.length + ' of ' + RUN.length + (ONLY ? ' (AF2_ONLY subset)' : '') + ' mutants red exactly their rows, for their reason; control 0 fail');
    if (bad.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch((e) => { console.error(e && e.stack ? e.stack : String(e)); process.exitCode = 1; });
}
