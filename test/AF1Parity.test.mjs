// test/AF1Parity.test.mjs -- AF-1 ASSERTION 1: output parity of the AF-1 edits
// against the base build de9a5d9 (`git show de9a5d9:FastBit32.js`, written to a
// temp dir and imported by file URL; the whole file fails closed if git cannot
// produce it). The only live-vs-base behavior change allowed on the paths below
// is NONE: countRange drops `>>> 0` (the mask stays int32, `&` applies ToInt32),
// and FastBit1024#saveInto gains a brand check that real receivers never trip.
// Expected values come from the base build (the oracle), compared with Object.is.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as LIVE from '../FastBit32.js';

const BASE = 'de9a5d9';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let baseSrc = '';
try {
    baseSrc = execFileSync('git', ['show', BASE + ':FastBit32.js'], { cwd: ROOT, encoding: 'utf8' });
} catch (e) {
    assert.fail('git show ' + BASE + ':FastBit32.js failed: ' + e.message);
}
assert.ok(baseSrc.length > 1000 && /class FastBit1024/.test(baseSrc), 'base text must be the FastBit32.js body');
const TMP = mkdtempSync(join(tmpdir(), 'af1-parity-'));
let OLD, MUT;
const MASK_LINE = 'const mask = ((0xFFFFFFFF >>> (31 - (end - start))) << start) >>> 0;';
before(async () => {
    writeFileSync(join(TMP, 'base.mjs'), baseSrc);
    OLD = await import(pathToFileURL(join(TMP, 'base.mjs')).href);
    // In-test control: mutate the base's mask line, count-checked single match.
    const n = baseSrc.split(MASK_LINE).length - 1;
    assert.equal(n, 1, 'mutation target must match exactly once, matched ' + n);
    const mut = baseSrc.replace(MASK_LINE, MASK_LINE.replace('<< start)', '<< (start + 1))'));
    assert.notEqual(mut, baseSrc);
    writeFileSync(join(TMP, 'mut.mjs'), mut);
    MUT = await import(pathToFileURL(join(TMP, 'mut.mjs')).href);
});
after(() => { rmSync(TMP, { recursive: true, force: true }); });

// 32 words built through the constructor (unsigned, includes >= 2^31), 32 through union() (int32).
const CTOR_WORDS = [0, 0xFFFFFFFF, 0x80000000, 0x7FFFFFFF, 1, 0x40000000, 0xFFFFFFFE, 0xAAAAAAAA, 0x55555555,
    0xA5A5A5A5, 0xDEADBEEF, 0x00FF00FF, 0xFF00FF00, 0x0000FFFF, 0xFFFF0000, 0x12345678];
for (let i = 0; i < 16; i++) CTOR_WORDS.push((1 << i) >>> 0, (0x80000000 >>> i) >>> 0);
CTOR_WORDS.length = 32;
const UNION_WORDS = [-1, 0, -2147483648, 2147483647, 1, -2, 0x5A5A5A5A | 0, 0xA5A5A5A5 | 0, 0xDEADBEEF | 0, 0x7EADBEEF | 0,
    0x0F0F0F0F, 0xF0F0F0F0 | 0, 0x00010001, 0x80008000 | 0, 0x13579BDF, 0xFDB97531 | 0];
for (let i = 0; i < 16; i++) UNION_WORDS.push((1 << i) | 0, (-2147483648 >>> i) | 0);
UNION_WORDS.length = 32;

// FB-05 inputs: Pinned.test.mjs "countRange has no domain" (3 calls on new FastBit32(-1)) and
// Boundary.test.mjs T1 BIT_ROWS (each bit b: countRange(b, 31) and countRange(0, b) on new FastBit32(-1)).
const PINNED_CALLS = [[5, 2], [0, 32], [-1, 3]];
const BIT_INPUTS = [0, 31, 32, 33, -1, -0, 1.5, NaN, Infinity, undefined, null, '3', 2 ** 31, 2 ** 32];

describe('AF-1 countRange parity vs ' + BASE, () => {
    function sweep(A, B, tally) {
        let calls = 0, diffs = 0;
        const grid = (a, b) => {
            for (let s = -2; s <= 34; s++) for (let e = -2; e <= 34; e++) {
                calls++;
                if (!Object.is(a.countRange(s, e), b.countRange(s, e))) diffs++;
            }
        };
        for (const w of CTOR_WORDS) grid(new A.FastBit32(w), new B.FastBit32(w));
        for (const w of UNION_WORDS) grid(new A.FastBit32(0).union(w), new B.FastBit32(0).union(w));
        for (const [s, e] of PINNED_CALLS) {
            calls++;
            if (!Object.is(new A.FastBit32(-1).countRange(s, e), new B.FastBit32(-1).countRange(s, e))) diffs++;
        }
        for (const b of BIT_INPUTS) {
            calls += 2;
            if (!Object.is(new A.FastBit32(-1).countRange(b, 31), new B.FastBit32(-1).countRange(b, 31))) diffs++;
            if (!Object.is(new A.FastBit32(-1).countRange(0, b), new B.FastBit32(-1).countRange(0, b))) diffs++;
        }
        tally.calls = calls;
        return diffs;
    }

    test('word sets are 32 + 32 distinct-enough words with the required members', () => {
        assert.equal(CTOR_WORDS.length, 32);
        assert.equal(UNION_WORDS.length, 32);
        assert.ok(CTOR_WORDS.some((w) => w >= 2 ** 31) && CTOR_WORDS.includes(0) && CTOR_WORDS.includes(0xFFFFFFFF));
        assert.ok(CTOR_WORDS.filter((w) => w !== 0 && (w & (w - 1)) === 0 || w === 0x80000000).length >= 8, 'single bits');
    });

    test('live === base on every call (Object.is)', () => {
        const t = {};
        const diffs = sweep(LIVE, OLD, t);
        // 64 words x 37 x 37 = 87,616 grid calls + 3 Pinned + 14 x 2 Boundary = 87,647.
        assert.equal(t.calls, 87616 + 3 + 28);
        assert.equal(diffs, 0);
    });

    test('control: base with `<< start` -> `<< (start + 1)` shows >= 1 diff', () => {
        const t = {};
        const diffs = sweep(MUT, OLD, t);
        assert.equal(t.calls, 87647);
        assert.ok(diffs >= 1, 'mutant must be caught, diffs=' + diffs);
    });
});

describe('AF-1 FastBit1024#saveInto parity vs ' + BASE, () => {
    const CAPS = [1, 31, 32, 33, 64, 500, 1023, 1024];
    const SENT = 0x7EADBEEF;
    function fill(M, cap) {
        const s = new M.FastBit1024(cap);
        let x = 0x5EED; // tiny LCG, seed 0x5EED
        for (let b = 0; b < cap; b++) {
            x = (Math.imul(x, 1103515245) + 12345) >>> 0;
            if (((x >>> 16) & 3) === 0) s.add(b);
        }
        s.add(cap - 1); // top bit always set: exercises the last partial word
        return s;
    }
    function run(M, cap, off) {
        const s = fill(M, cap);
        const arena = new Int32Array(40 + 33).fill(SENT);
        const ret = s.saveInto(arena, off);
        return { ret, arena };
    }
    function compare(A, B) {
        let rows = 0, diffs = 0;
        for (const cap of CAPS) for (const off of [0, 7]) {
            const a = run(A, cap, off), b = run(B, cap, off);
            rows++;
            if (!Object.is(a.ret, b.ret)) diffs++;
            else if (Buffer.compare(Buffer.from(a.arena.buffer), Buffer.from(b.arena.buffer)) !== 0) diffs++;
        }
        return { rows, diffs };
    }
    test('return value and the whole arena are byte-identical (8 caps x offsets {0, 7})', () => {
        const r = compare(LIVE, OLD);
        assert.equal(r.rows, 16);
        assert.equal(r.diffs, 0);
        // sanity: the images are not trivially empty
        const x = run(LIVE, 500, 7);
        assert.equal(x.ret, 7 + 1 + 16);
        assert.equal(x.arena[7], (OLD.FastBit1024 ? run(OLD, 500, 7).arena[7] : 0));
        assert.ok(x.arena.slice(8, 24).some((w) => w !== 0));
    });
    test('control: a mutated base saveInto result would be detected (compare() has teeth)', () => {
        const a = run(LIVE, 64, 0), b = run(OLD, 64, 0);
        b.arena[1] ^= 1;
        assert.notEqual(Buffer.compare(Buffer.from(a.arena.buffer), Buffer.from(b.arena.buffer)), 0);
    });
});
