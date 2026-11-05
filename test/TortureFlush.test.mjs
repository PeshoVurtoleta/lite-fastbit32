// test/TortureFlush.test.mjs -- CI-3: torture.mjs must not lose its stderr tail
// when the parent is slow to read. On POSIX, process.stdout / process.stderr on a
// pipe or socket are asynchronous: once the kernel buffer is full libuv queues the
// remaining writes, and process.exit() discards that queue. On a 4-cpu CI runner
// the select-nosentinel control lost "FAIL T5" (exit 1, last line a T0 line).
//
// Deterministic, no host buffer size involved: a preload (--import data:) turns
// each stream into a slow transport. Every chunk reaches the real fd one
// setImmediate turn late and its callback fires only from the real write's own
// callback, never early -- so a process.exit() with a chunk still queued loses it,
// exactly like a full pipe, and a flush that waits for the write callbacks wins.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), 'torture.mjs');
const NODE_FLAGS = ['--allow-natives-syntax', '--expose-gc', '--min-semi-space-size=4', '--max-semi-space-size=4'];

// _writev is disabled so the Writable hands over one chunk per _write; the real
// _write (and its real completion callback) runs one event-loop turn later.
const PRELOAD_SRC =
    'for (const s of [process.stdout, process.stderr]) {' +
    ' const w = s._write;' +
    ' s._writev = null;' +
    ' s._write = function (chunk, enc, cb) { setImmediate(() => w.call(this, chunk, enc, cb)); };' +
    '}';
const PRELOAD = ['--import', 'data:text/javascript,' + encodeURIComponent(PRELOAD_SRC)];

// A stdout whose reader has gone: every write completes with EPIPE (what the
// real socket does after the parent closed its end), so the stream errors.
const EPIPE_SRC =
    'process.stdout._writev = null;' +
    'process.stdout._write = function (chunk, enc, cb) {' +
    ' const e = new Error("write EPIPE"); e.code = "EPIPE"; e.errno = -32; e.syscall = "write"; cb(e); };';
const EPIPE = ['--import', 'data:text/javascript,' + encodeURIComponent(EPIPE_SRC)];

function cleanEnv(extra) {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.TORTURE_SEED;
    delete env.TORTURE_CONTROL;
    delete env.TORTURE_FAST;
    return { ...env, ...extra };
}

function runTorture(preload) {
    return spawnSync(process.execPath, [...(preload ? PRELOAD : []), ...NODE_FLAGS, ENTRY], {
        env: cleanEnv({ TORTURE_CONTROL: 'select-nosentinel', TORTURE_FAST: '1', TORTURE_SEED: '12345' }),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024
    });
}

// A tiny child: N stderr lines, a trailer, then exit 1 -- either straight away
// (the old torture.mjs shape) or after awaiting an empty write's callback on
// both streams (the exitFlushed shape).
const N = 400;
function burstSrc(flush) {
    return 'for (let i = 0; i < ' + N + '; i++) console.error("  line " + i);' +
        'console.error("TRAILER");' +
        (flush
            ? 'const f = (s) => new Promise((r) => s.write("", () => r()));' +
              'await Promise.all([f(process.stdout), f(process.stderr)]);'
            : '') +
        'process.exit(1);';
}
function runBurst(flush) {
    return spawnSync(process.execPath, [...PRELOAD, '--input-type=module', '--eval', burstSrc(flush)], {
        env: cleanEnv({}),
        encoding: 'utf8'
    });
}

function codeLines(src) {
    return src.split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s+\/\/ .*$/, '')).join('\n');
}

describe('torture.mjs flushes stdout / stderr before every exit (CI-3)', () => {
    it('must-fail control: under the slow-transport preload, N lines + process.exit(1) lose the trailer', () => {
        const r = runBurst(false);
        assert.strictEqual(r.status, 1);
        assert.ok(!r.stderr.includes('TRAILER'), 'the preload did not bite: TRAILER survived a bare process.exit (stderr ' + r.stderr.length + ' B)');
    });

    it('the preload honours write callbacks: awaiting an empty write on both streams delivers every line', () => {
        const r = runBurst(true);
        assert.strictEqual(r.status, 1);
        const lines = r.stderr.split('\n');
        assert.strictEqual(lines.length, N + 2, 'want ' + N + ' lines + TRAILER + final newline, got ' + lines.length);
        assert.strictEqual(lines[N - 1], '  line ' + (N - 1));
        assert.strictEqual(lines[N], 'TRAILER');
    });

    it('select-nosentinel control under the preload: exit 1 with FAIL T0, FAIL T5 and the T5 replay line', () => {
        const r = runTorture(true);
        assert.strictEqual(r.status, 1, 'stderr tail: ' + r.stderr.split('\n').slice(-4).join(' | '));
        assert.strictEqual(r.stdout, '');
        const seen = {
            'FAIL T0': r.stderr.includes('FAIL T0\n'),
            'FAIL T5': r.stderr.includes('FAIL T5\n'),
            'T5 replay (last line)': /\n {2}T5: replay -> TORTURE_SEED=12345 npm run torture # op \d+\n$/.test(r.stderr)
        };
        assert.deepStrictEqual(seen, { 'FAIL T0': true, 'FAIL T5': true, 'T5 replay (last line)': true },
            'stderr tail lost under the slow transport (' + r.stderr.length + ' B delivered)');
    });

    it('the slow transport changes no byte: preload and plain runs print identical stdout / stderr', () => {
        const slow = runTorture(true);
        const plain = runTorture(false);
        assert.strictEqual(plain.status, 1);
        assert.strictEqual(slow.status, plain.status);
        assert.strictEqual(slow.stdout, plain.stdout);
        // Node <= 24 may print a "(node:<pid>) [DEP...]" warning; only that PID differs
        const norm = (s) => s.replace(/^\(node:\d+\) /gm, '(node:PID) ');
        assert.strictEqual(norm(slow.stderr), norm(plain.stderr));
    });

    it('a gone stdout reader (EPIPE) keeps the exit code: unknown TORTURE_CONTROL still exits 2, not a crash', () => {
        const r = spawnSync(process.execPath, [...EPIPE, ...NODE_FLAGS, ENTRY], {
            env: cleanEnv({ TORTURE_CONTROL: 'does-not-exist', TORTURE_FAST: '1' }),
            encoding: 'utf8'
        });
        assert.strictEqual(r.status, 2, 'stderr: ' + r.stderr.split('\n').slice(0, 4).join(' | '));
        assert.match(r.stderr, /unknown TORTURE_CONTROL "does-not-exist"/);
        assert.doesNotMatch(r.stderr, /Unhandled 'error' event|EPIPE/);
    });

    it('every exit site in torture.mjs goes through exitFlushed (covers the normal-run ok / FAIL tails)', () => {
        const code = codeLines(readFileSync(ENTRY, 'utf8'));
        const fn = code.match(/async function exitFlushed\(code\) \{\n([\s\S]*?)\n\}/);
        assert.ok(fn, 'async function exitFlushed(code) is missing');
        assert.match(fn[1], /flushed\(process\.stdout\)/);
        assert.match(fn[1], /flushed\(process\.stderr\)/);
        const fl = code.match(/function flushed\(stream\) \{\n([\s\S]*?)\n\}/);
        assert.ok(fl, 'function flushed(stream) is missing');
        assert.match(fl[1], /stream\.write\('', done\);/);
        assert.match(fl[1], /stream\.once\('error', done\);/);
        const exits = code.match(/process\.exit\s*\(/g) || [];
        assert.strictEqual(exits.length, 1, 'want exactly one process.exit( (inside exitFlushed), got ' + exits.length);
        assert.match(fn[1], /process\.exit\(code\)/);
        assert.doesNotMatch(code, /process\.exitCode|process\.reallyExit|process\.abort/);
        // the control-mode tail and both normal-run tails await it
        assert.match(code, /await exitFlushed\(anyFailed \? 1 : 0\);/);
        assert.match(code, /console\.log\('ok'\);\n\s+await exitFlushed\(0\);/);
        assert.match(code, /npm run torture to replay\)'\);\n\s+await exitFlushed\(1\);/);
        // every call is awaited (one extra match: the declaration); an un-awaited
        // call would let the next statement run before the exit
        const calls = (code.match(/exitFlushed\(/g) || []).length;
        const awaited = (code.match(/await exitFlushed\(/g) || []).length;
        assert.ok(awaited >= 10, 'want >= 10 awaited exit sites, got ' + awaited);
        assert.strictEqual(calls, awaited + 1, 'an exitFlushed( call is not awaited');
    });
});
