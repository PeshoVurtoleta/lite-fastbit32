// test/S3Parity.test.mjs -- S3 (1.3.0) output-identical parity. The SC-1 idiom
// change (`31 - Math.clz32` everywhere, branchless scans) and FB-09 (dead
// `>>> 0` dropped in forEachMaskPair/Diff/Union) must not change ONE output.
// Every changed method plus forEach/toArray/the 7 forEach* helpers is compared
// against the 1.2.1 body (`git show <BASE>:FastBit32.js`, loaded from a data:
// URL) over the T5 corpus, the key matrix and 1e6 seeded random words, in BOTH
// representations: built via add() (signed int32) and via the constructor
// (unsigned). Expect 0 mismatches. Fails closed if git cannot produce the base.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as NEW from '../FastBit32.js';
import { seedRng, nextU32, randBelow } from './torture/harness.mjs';

// The pre-S3 baseline commit (HEAD when S3 was written). Pinned so the check
// keeps comparing against the old body after the S3 commit lands.
const BASE = '27291e4';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = execFileSync('git', ['show', BASE + ':FastBit32.js'], { cwd: ROOT, encoding: 'utf8' });
assert.ok(/\^ 31/.test(src), 'base must be the pre-S3 body (it carries the XOR-31 idiom)');
const OLD = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

const NAMES = [];
const ARR = [];
const OBJ = {};
for (let i = 0; i < 32; i++) { NAMES.push('k' + i); ARR.push(i * 7 + 1); OBJ['k' + i] = i * 3 + 2; }
const MAP_NEW = new NEW.BitMapper(NAMES);
const MAP_OLD = new OLD.BitMapper(NAMES);

// Iterator digests: an order-sensitive int32 hash of (value, key, bit) per call.
const H = new Int32Array(1);
const mix = (x) => { H[0] = (Math.imul(H[0], 31) + (x | 0) + 1) | 0; };
const keyId = (k) => (typeof k === 'string' ? NAMES.indexOf(k) : -1000);
const cbBit = (b) => { mix(b); };
const cbArr = (v, b) => { mix(v); mix(b); };
const cbObj = (v, k, b) => { mix(v); mix(keyId(k)); mix(b); };
const cbMap = (k, b) => { mix(keyId(k)); mix(b); };

function digest(M, mapper, a, b) {
    const out = [a.lowest(), a.highest(), a.nextClearBit(), a.highestClearBit(), a.toArray().join(',')];
    const run = (fn) => { H[0] = 17; fn(); out.push(H[0]); };
    run(() => a.forEach(cbBit));
    run(() => M.forEachArray(a, ARR, cbArr));
    run(() => M.forEachObject(a, NAMES, OBJ, cbObj));
    run(() => M.forEachMapped(a, mapper, cbMap));
    run(() => M.forEachMappedObject(a, mapper, OBJ, cbObj));
    run(() => M.forEachMaskPair(a, b, cbBit));
    run(() => M.forEachMaskDiff(a, b, cbBit));
    run(() => M.forEachMaskUnion(a, b, cbBit));
    return out;
}

// signed: built through add(); unsigned: through the constructor.
function viaAdd(M, w) { const f = new M.FastBit32(); for (let i = 0; i < 32; i++) if ((w >>> i) & 1) f.add(i); return f; }
function viaCtor(M, w) { return new M.FastBit32(w); }

const stats = { words: 0, cases: 0, mismatches: 0, first: null };
function compare(wa, wb) {
    stats.words++;
    for (const buildA of [viaAdd, viaCtor]) {
        for (const buildB of [viaAdd, viaCtor]) {
            const n = digest(NEW, MAP_NEW, buildA(NEW, wa), buildB(NEW, wb));
            const o = digest(OLD, MAP_OLD, buildA(OLD, wa), buildB(OLD, wb));
            stats.cases++;
            for (let i = 0; i < n.length; i++) {
                if (n[i] !== o[i]) {
                    stats.mismatches++;
                    if (stats.first === null) stats.first = 'a=' + wa + ' b=' + wb + ' slot=' + i + ' new=' + n[i] + ' old=' + o[i] + ' (' + buildA.name + '/' + buildB.name + ')';
                    break;
                }
            }
        }
    }
}

test('S3 parity: the representations really differ (signed via add, unsigned via ctor)', () => {
    assert.equal(viaAdd(NEW, 0x80000000).value, -(2 ** 31));
    assert.equal(viaCtor(NEW, 0x80000000).value, 2 ** 31);
    assert.equal(viaAdd(NEW, 0xFFFFFFFF).value, -1);
    assert.equal(viaCtor(NEW, -1).value, 0xFFFFFFFF);
});

test('S3 parity: key matrix x key matrix, both representations, 0 mismatches', () => {
    const KEYS = [0, -1, 1, 1 << 30, 1 << 31, -(2 ** 31), 0x7FFFFFFF, 0xFFFFFFFF, 2 ** 31];
    const before = stats.mismatches; stats.first = null;
    for (const a of KEYS) for (const b of KEYS) compare(a, b);
    assert.equal(stats.mismatches - before, 0, stats.first);
});

test('S3 parity: T5 corpus (replayed T5 op stream), both representations, 0 mismatches', () => {
    seedRng(0x5EED0003);
    const fb = new NEW.FastBit32();
    let prev = 0;
    const before = stats.mismatches; stats.first = null;
    for (let i = 0; i < 20000; i++) {
        const op = randBelow(7);
        const bit = randBelow(32);
        const mask = nextU32();
        switch (op) {
            case 0: fb.add(bit); break;
            case 1: fb.remove(bit); break;
            case 2: fb.toggle(bit); break;
            case 3: fb.union(mask); break;
            case 4: fb.difference(mask); break;
            case 5: fb.intersect(mask); break;
            case 6: fb.clear(); break;
        }
        const w = fb.value >>> 0;
        compare(w, prev);
        prev = w;
    }
    assert.equal(stats.mismatches - before, 0, stats.first);
});

test('S3 parity: 1e6 seeded random words (scans + toArray + forEach + 7 helpers), 0 mismatches', () => {
    // 1e6 words x 2 representations through the cheap per-word digest; the
    // 4-way A/B representation cross runs on every 64th word.
    seedRng(0x5EED0001);
    const before = stats.mismatches; stats.first = null;
    let checked = 0;
    for (let i = 0; i < 1000000; i++) {
        // sparse / dense / uniform words so empty and full words are frequent
        const r = nextU32();
        const k = i & 3;
        const w = k === 0 ? (r & nextU32() & nextU32()) >>> 0 : k === 1 ? (r | nextU32() | nextU32()) >>> 0 : k === 2 ? (((i & 4) ? 0 : 0xFFFFFFFF) ^ (1 << (r & 31))) >>> 0 : r;
        const wb = nextU32();
        if ((i & 63) === 0) { compare(w, wb); checked++; continue; }
        const s = w | 0;
        const ns = new NEW.FastBit32().union(s), os = new OLD.FastBit32().union(s); // signed (mutator)
        const nu = new NEW.FastBit32(w), ou = new OLD.FastBit32(w);                 // unsigned (ctor)
        const nb = new NEW.FastBit32(wb), ob = new OLD.FastBit32(wb);
        for (const [n, o] of [[ns, os], [nu, ou]]) {
            const dn = digest(NEW, MAP_NEW, n, nb);
            const dO = digest(OLD, MAP_OLD, o, ob);
            stats.cases++;
            checked++;
            for (let j = 0; j < dn.length; j++) {
                if (dn[j] !== dO[j]) { stats.mismatches++; if (stats.first === null) stats.first = 'w=' + w + ' wb=' + wb + ' slot=' + j; break; }
            }
        }
    }
    console.error('  S3 parity: words=' + (stats.words + 1000000) + ' cases=' + stats.cases + ' mismatches=' + stats.mismatches);
    assert.ok(checked > 1000000);
    assert.equal(stats.mismatches - before, 0, stats.first);
});
