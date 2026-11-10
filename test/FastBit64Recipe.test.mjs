// FastBit64 docs recipes, executed from README.md and llms.txt (C.D2).
// The oracle is independent of the doc code: a Uint8Array(4096) model driven by two
// separate seeded xorshift32 streams (op kind / index). Expected values come from the
// recipe CONTRACT (PLAN-fastbit64-C ASSERTIONS 1, 2, 4), never from the docs' code.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { FastBit64 } = await import(new URL('../FastBit32.js', import.meta.url).href);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const FILES = [
    ['README.md', '```js'],
    ['llms.txt', '```javascript'],
];
const M4096 = '64 x 64 = 4096 recipe (1.7.0';
const MMAP = 'Names above 32 (1.7.0';

function rawBlock(file, marker, fence) {
    const text = readFileSync(ROOT + file, 'utf8');
    const at = text.indexOf(marker);
    assert.ok(at >= 0, file + ': recipe marker missing: ' + marker);
    const f = text.indexOf(fence, at);
    assert.ok(f >= 0, file + ': fence missing after ' + marker);
    const start = f + fence.length;
    const end = text.indexOf('\n```', start);
    assert.ok(end > start, file + ': unterminated fence after ' + marker);
    return text.slice(start, end);
}
function block(file, marker, fence) {
    return rawBlock(file, marker, fence).split('\n').filter((l) => !/^\s*import /.test(l)).join('\n');
}

// 32-bit exact xorshift32 (Marsaglia 13/17/5); seed must be nonzero
function xs32(seed) {
    let x = seed >>> 0;
    return () => {
        x ^= x << 13; x >>>= 0;
        x ^= x >>> 17;
        x ^= x << 5; x >>>= 0;
        return x;
    };
}

const BAD = [-1, 4096, 4097, 1.5, NaN, '1', Infinity, -Infinity, 2 ** 31, 2 ** 32 + 1, null, undefined, {}, [], 0.1];

describe('FastBit64 docs recipes -- 4096 = 64 x 64', () => {
    for (const [file, fence] of FILES) {
        test(file + ': 200,000 ops vs a Uint8Array(4096) oracle, 0 mismatches, coverage floors met', () => {
            const code = block(file, M4096, fence);
            assert.ok(code.includes('full.remove('), file + ': missing literal full.remove(');
            assert.ok(code.includes('active.remove('), file + ': missing literal active.remove(');
            const { Bits4096 } = new Function('FastBit64', code + '\nreturn { Bits4096 };')(FastBit64);
            const b = new Bits4096();

            const bits = new Uint8Array(4096);
            const cnt = new Int32Array(64); // set bits per 64-bit slot
            let size = 0;
            const opRng = xs32(0x9e3779b9);
            const idxRng = xs32(0x85ebca6b);
            let mismatches = 0;
            let firstMsg = '';
            const bad = (msg) => { if (mismatches++ === 0) firstMsg = msg; };

            const oLowest = () => {
                for (let s = 0; s < 64; s++) {
                    if (cnt[s] === 0) continue;
                    for (let i = s << 6; ; i++) if (bits[i]) return i;
                }
                return -1;
            };
            const oNext = (from) => {
                let i = from;
                while (i < 4096) {
                    if ((i & 63) === 0 && cnt[i >> 6] === 0) { i += 64; continue; }
                    if (bits[i]) return i;
                    i++;
                }
                return -1;
            };
            const oSet = (i) => { if (!bits[i]) { bits[i] = 1; cnt[i >> 6]++; size++; } };
            const oClr = (i) => { if (bits[i]) { bits[i] = 0; cnt[i >> 6]--; size--; } };
            const oFree = () => { for (let i = 0; i < 4096; i++) if (!bits[i]) return i; return -1; };

            let acqFull = 0, relSet = 0, relClear = 0, badOps = 0, acqOk = 0, sawFull = 0, sawEmpty = 0;
            const N = 200000;
            const PH = 8000;
            for (let n = 0; n < N; n++) {
                const phase = ((n / PH) | 0) & 3; // 0 fill, 1 mixed, 2 drain, 3 mixed
                const r = opRng() % 100;
                const idx = idxRng() % 4096;
                const from = idxRng() % 4097;
                let kind; // 0 add 1 remove 2 has 3 acquire 4 release 5 lowest 6 nextSetBit 7 bad
                if (phase === 0) kind = r < 85 ? 3 : r < 90 ? 0 : r < 94 ? 2 : r < 97 ? 6 : 7;
                else if (phase === 2) kind = r < 85 ? 4 : r < 90 ? 1 : r < 94 ? 2 : r < 97 ? 5 : 7;
                else kind = r < 16 ? 0 : r < 32 ? 1 : r < 40 ? 2 : r < 55 ? 3 : r < 75 ? 4 : r < 80 ? 5 : r < 90 ? 6 : 7;

                try {
                    if (kind === 0) { b.add(idx); oSet(idx); }
                    else if (kind === 1) { b.remove(idx); oClr(idx); }
                    else if (kind === 2) { if (b.has(idx) !== (bits[idx] === 1)) bad('has ' + idx); }
                    else if (kind === 3) {
                        const want = oFree();
                        if (want === -1) {
                            acqFull++;
                            const got = b.acquire();
                            if (got !== -1) bad('acquire on full returned ' + got);
                        } else {
                            acqOk++;
                            const got = b.acquire();
                            if (got !== want) bad('acquire ' + got + ' != ' + want);
                            oSet(want);
                        }
                    } else if (kind === 4) {
                        // phase 2 aims at a set slot (scan forward from idx); elsewhere the raw index
                        let t = idx;
                        if (phase === 2 && size > 0) { t = oNext(idx); if (t === -1) t = oNext(0); }
                        if (bits[t]) {
                            relSet++;
                            b.release(t); oClr(t);
                        } else {
                            relClear++;
                            let threw = null;
                            try { b.release(t); } catch (e) { threw = e; }
                            if (!(threw instanceof RangeError)) bad('release of clear slot ' + t + ' did not throw RangeError');
                        }
                    } else if (kind === 5) {
                        if (b.lowest() !== oLowest()) bad('lowest');
                    } else if (kind === 6) {
                        if (b.nextSetBit(from) !== oNext(from)) bad('nextSetBit ' + from);
                    } else {
                        badOps++;
                        let v = BAD[idxRng() % BAD.length];
                        const m = ['add', 'remove', 'has', 'release', 'nextSetBit'][opRng() % 5];
                        if (m === 'nextSetBit' && v === 4096) v = 4097; // 4096 is a valid cursor start
                        let threw = null;
                        try { b[m](v); } catch (e) { threw = e; }
                        if (!(threw instanceof RangeError)) bad(m + '(' + String(v) + ') did not throw RangeError');
                    }
                } catch (e) {
                    bad('op ' + n + ' kind ' + kind + ' threw ' + e);
                }

                if (b.size !== size) bad('size ' + b.size + ' != ' + size + ' at op ' + n);
                if (b.has(idx) !== (bits[idx] === 1)) bad('post has ' + idx);
                if (b.lowest() !== oLowest()) bad('post lowest at op ' + n);
                if (b.nextSetBit(from) !== oNext(from)) bad('post nextSetBit ' + from);
                if (size === 4096) sawFull++;
                if (size === 0) sawEmpty++;
                for (let s = 0; s < 64; s++) {
                    if (b.active.has(s) !== (cnt[s] > 0)) { bad('active slot ' + s + ' at op ' + n); break; }
                    if (b.full.has(s) !== (cnt[s] === 64)) { bad('full slot ' + s + ' at op ' + n); break; }
                }
                if (mismatches > 20) break;
            }
            assert.equal(mismatches, 0, file + ': ' + firstMsg);
            assert.ok(acqFull >= 4, 'acquire-on-full floor: ' + acqFull);
            assert.ok(relSet >= 1000, 'release-of-set floor: ' + relSet);
            assert.ok(relClear >= 1000, 'release-of-clear floor: ' + relClear);
            assert.ok(badOps >= 1000, 'bad-index floor: ' + badOps);
            assert.ok(sawFull >= 4, 'full-state floor: ' + sawFull);
            assert.ok(sawEmpty >= 4, 'empty-state floor: ' + sawEmpty);
            if (process.env.D2_VERBOSE) console.log(file, { acqFull, acqOk, relSet, relClear, badOps, sawFull, sawEmpty });
        });

        test(file + ': 10 fill/drain cycles leave size 0 and active / full empty every time', () => {
            const code = block(file, M4096, fence);
            const { Bits4096 } = new Function('FastBit64', code + '\nreturn { Bits4096 };')(FastBit64);
            const b = new Bits4096();
            const rng = xs32(0x2545f491);
            for (let c = 0; c < 10; c++) {
                for (let i = 0; i < 4096; i++) assert.equal(b.acquire(), i, file + ': cycle ' + c + ' acquire ' + i);
                assert.equal(b.size, 4096);
                assert.equal(b.acquire(), -1);
                assert.equal(b.full.count(), 64);
                assert.equal(b.active.count(), 64);
                // release in a seeded pseudo-random order (Fisher-Yates), so slots empty at varied times
                const order = new Int32Array(4096);
                for (let i = 0; i < 4096; i++) order[i] = i;
                for (let i = 4095; i > 0; i--) { const j = rng() % (i + 1); const t = order[i]; order[i] = order[j]; order[j] = t; }
                for (let i = 0; i < 4096; i++) b.release(order[i]);
                assert.equal(b.size, 0, file + ': cycle ' + c + ' size');
                assert.equal(b.lowest(), -1);
                assert.equal(b.active.isEmpty(), true, file + ': cycle ' + c + ' active not empty');
                assert.equal(b.full.isEmpty(), true, file + ': cycle ' + c + ' full not empty');
            }
        });
    }

    test('README.md and llms.txt carry byte-identical 4096 and Map recipe code', () => {
        for (const marker of [M4096, MMAP]) {
            assert.equal(rawBlock('README.md', marker, '```js'), rawBlock('llms.txt', marker, '```javascript'), marker);
        }
    });
});

describe('FastBit64 docs recipes -- names above 32 (Map)', () => {
    for (const [file, fence] of FILES) {
        test(file + ': BIT has >= 40 distinct names in 0..63; signature builds exactly those bits; hasAll rows', () => {
            const code = block(file, MMAP, fence);
            assert.ok(code.includes('hasAll'), file + ': hot line does not use hasAll');
            const { BIT, signature } = new Function('FastBit64', code + '\nreturn { BIT, signature };')(FastBit64);
            assert.ok(BIT instanceof Map);
            assert.ok(BIT.size >= 40, file + ': BIT.size ' + BIT.size);
            const seen = new Set();
            for (const [k, v] of BIT) {
                assert.equal(typeof k, 'string');
                assert.ok(Number.isInteger(v) && v >= 0 && v <= 63, k + ' -> ' + v);
                assert.ok(!seen.has(v), 'duplicate index ' + v);
                seen.add(v);
            }
            const names = [...BIT.keys()];
            const rng = xs32(0x1b873593);
            for (let round = 0; round < 200; round++) {
                const pick = [];
                const k = rng() % (names.length + 1);
                for (let i = 0; i < k; i++) pick.push(names[rng() % names.length]);
                const want = [...new Set(pick.map((n) => BIT.get(n)))].sort((a, c) => a - c);
                const sig = signature(pick);
                assert.ok(sig instanceof FastBit64);
                assert.deepEqual(sig.toArray(), want, file + ': round ' + round);
                // hasAll true: a sub-selection of the picked names
                const sub = pick.filter(() => rng() % 2 === 0);
                assert.equal(sig.hasAll(signature(sub)), true);
                // hasAll false: one name not in the picked set (when one exists)
                const missing = names.filter((n) => !want.includes(BIT.get(n)));
                if (missing.length) {
                    const extra = missing[rng() % missing.length];
                    assert.equal(sig.hasAll(signature([...pick, extra])), false);
                    assert.equal(signature([...pick, extra]).hasAll(sig), true);
                }
            }
            assert.equal(signature([]).isEmpty(), true);
            assert.throws(() => signature(['no-such-name-' + names.length]));
            assert.throws(() => signature([names[0], 'no-such-name-' + names.length]));
        });
    }
});

describe('FastBit64 docs recipes -- README member table equals the shipped surface', () => {
    test('README.md FastBit64 member table names == prototype names + own statics', () => {
        const text = readFileSync(ROOT + 'README.md', 'utf8');
        const h = text.indexOf('## FastBit64: 64 flags in two words');
        assert.ok(h >= 0, 'README.md: FastBit64 H2 missing');
        const next = text.indexOf('\n## ', h + 4);
        const section = text.slice(h, next < 0 ? text.length : next).split('\n');
        // first contiguous run of table lines in the section
        let i = 0;
        while (i < section.length && !/^\s*\|/.test(section[i])) i++;
        assert.ok(i < section.length, 'README.md: no table under the FastBit64 H2');
        const rows = [];
        for (; i < section.length && /^\s*\|/.test(section[i]); i++) rows.push(section[i]);
        const documented = new Set();
        for (const row of rows) {
            const cell = row.trim().replace(/^\|/, '').split('|')[0];
            if (/^[\s:-]*$/.test(cell)) continue; // separator row
            for (const m of cell.matchAll(/`([^`]+)`/g)) {
                if (/^new\s/.test(m[1])) continue; // the constructor row; 'constructor' is excluded from the surface
                const id = m[1].replace(/^FastBit64\./, '').match(/^[A-Za-z_$][\w$]*/);
                if (id) documented.add(id[0]);
            }
        }
        const actual = new Set([
            ...Object.getOwnPropertyNames(FastBit64.prototype).filter((n) => n !== 'constructor'),
            ...Object.getOwnPropertyNames(FastBit64).filter((n) => n !== 'length' && n !== 'name' && n !== 'prototype'),
        ]);
        const missing = [...actual].filter((n) => !documented.has(n));
        const extra = [...documented].filter((n) => !actual.has(n));
        assert.deepEqual({ missing, extra }, { missing: [], extra: [] });
    });
});
