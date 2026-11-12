// FastBit64 docs qa (GROUP C.D1 / C.D2, 1.7.0): every FastBit64 claim in README.md, llms.txt and
// CHANGELOG.md [Unreleased] that can be executed or counted is bound to FastBit32.d.ts, the live class,
// the torture lane table and the control registry. Oracles are the TRUE definitions (a Uint8Array model,
// the d.ts text, Object.getOwnPropertyNames), never the docs' own code.
// FB64_DOCS_ROOT=<dir> points the doc reads (README.md, llms.txt, CHANGELOG.md, ROADMAP.md) at a copy,
// for mutant checks. FB64_TORTURE_LOG=<file> adds the torture-log lane check (row D3).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const { FastBit64, FastBit1024, FastBit32 } = await import(new URL('../FastBit32.js', import.meta.url).href);
const { FB64_LANES } = await import(new URL('./torture/fb64-lanes.mjs', import.meta.url).href);
const { CONTROL_NAMES } = await import(new URL('./torture/controls.mjs', import.meta.url).href);
const T3C = await import(new URL('./torture/t3-adversarial.mjs', import.meta.url).href);

const DOCS = process.env.FB64_DOCS_ROOT ? process.env.FB64_DOCS_ROOT.replace(/\/?$/, '/') : PKG;
const read = (f) => readFileSync(DOCS + f, 'utf8');
const README_H = '## FastBit64: 64 flags in two words';
const LLMS_H = '## FastBit64 -- 64 flags, two int32 words (1.7.0)';

function section(text, head, file) {
    const at = text.indexOf(head);
    assert.ok(at >= 0, file + ': FastBit64 heading missing: ' + head);
    const next = text.indexOf('\n## ', at + head.length);
    return text.slice(at, next < 0 ? text.length : next);
}
const readmeSec = () => section(read('README.md'), README_H, 'README.md');
const llmsSec = () => section(read('llms.txt'), LLMS_H, 'llms.txt');
const SECTIONS = [['README.md', readmeSec], ['llms.txt', llmsSec]];
const prose = (s) => s.replace(/```[\s\S]*?```/g, '');           // drop fenced code
const paragraphs = (s) => prose(s).split(/\n\s*\n/);

// the shipped surface: prototype (minus constructor) + own statics
const SURFACE = new Set([
    ...Object.getOwnPropertyNames(FastBit64.prototype).filter((n) => n !== 'constructor'),
    ...Object.getOwnPropertyNames(FastBit64).filter((n) => n !== 'length' && n !== 'name' && n !== 'prototype'),
]);
const diffSets = (doc, actual) => ({
    missing: [...actual].filter((n) => !doc.has(n)).sort(),
    extra: [...doc].filter((n) => !actual.has(n)).sort(),
});
// drop parenthesised remarks outside backticks (cross-references such as FastBit32's `set`)
function stripParens(line) {
    let out = '', depth = 0, bt = false;
    for (const ch of line) {
        if (ch === '`') bt = !bt;
        if (!bt && ch === '(') { depth++; continue; }
        if (!bt && ch === ')' && depth > 0) { depth--; continue; }
        if (depth === 0) out += ch;
    }
    return out;
}
// parameter names the prose quotes (`bit` 0..63), never members
const PARAMS = new Set(['bit', 'other', 'from', 'k', 'callback', 'bits', 'out', 'src', 'offset', 'padded']);
const ID = /^(?:static\s+)?([A-Za-z_$][\w$]*)(?:\([^`]*\))?$/;
function backtickIds(s) {
    const ids = new Set();
    for (const m of s.matchAll(/`([^`]+)`/g)) {
        if (/^new\s/.test(m[1])) continue;
        const id = m[1].match(ID);
        if (id && !PARAMS.has(id[1])) ids.add(id[1]);
    }
    return ids;
}

// ---- A: section hygiene (ASSERTIONS 3 / 5) ------------------------------------------------------
describe('A FastBit64 doc sections: hygiene', () => {
    for (const [file, sec] of SECTIONS) {
        test(file + ': ASCII-only, no stray tool-call tags', () => {
            const s = sec();
            const high = [...s].filter((c) => c.codePointAt(0) > 0x7f);
            assert.deepEqual(high, [], file + ': code points > 0x7f');
            assert.equal(/<\/?(?:antml:|function_calls|invoke\b|parameter\b)/.test(s), false, file + ': tool-call tag');
        });
        test(file + ': no "flat" claim; every `\\d ns` timing sits in a REPORTED, dated paragraph (A15)', () => {
            const s = sec();
            assert.equal((prose(s).match(/\bflat\b/gi) || []).length, 0, file + ': "flat"');
            let hits = 0;
            for (const p of paragraphs(s)) {
                for (const piece of p.split(/(?=\(b\) REPORTED)/)) {
                    const n = (piece.match(/\d ns/g) || []).length;
                    if (n === 0) continue;
                    hits += n;
                    assert.ok(/REPORTED, not gated/.test(piece) && /2026-\d\d-\d\d/.test(piece) && /K = \d/.test(piece)
                        && /one run/.test(piece) && /load1/.test(piece),
                        file + ': a ns timing outside a REPORTED + provenance clause: ' + piece.slice(0, 120));
                }
            }
            // A15: the measured d8 Smi-mutator cost must be stated (exactly once per section)
            assert.equal(hits, 1, file + ': A15 cost sentence count');
        });
    }
});

// ---- B: member lists == d.ts == runtime (ASSERTION 4, C-S2) -------------------------------------
describe('B FastBit64 member lists', () => {
    test('FastBit32.d.ts class FastBit64 member names == the shipped surface', () => {
        const dts = readFileSync(PKG + 'FastBit32.d.ts', 'utf8');
        const at = dts.indexOf('export class FastBit64 {');
        assert.ok(at >= 0);
        const body = dts.slice(at, dts.indexOf('\n}', at));
        const names = new Set();
        for (const m of body.matchAll(/^\s+(?:static\s+)?(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*[(:?]/gm)) {
            if (m[1] !== 'constructor') names.add(m[1]);
        }
        assert.deepEqual(diffSets(names, SURFACE), { missing: [], extra: [] });
    });
    test('llms.txt "Members" list names == the shipped surface (0 missing, 0 extra)', () => {
        const s = llmsSec();
        const at = s.indexOf('Members (the shipped surface');
        assert.ok(at >= 0, 'llms.txt: Members list missing');
        const end = s.indexOf('\n\n', at);
        const lines = s.slice(at, end).split('\n').filter((l) => /^- /.test(l));
        assert.ok(lines.length >= 8, 'llms.txt: Members bullets ' + lines.length);
        const ids = backtickIds(lines.map(stripParens).join('\n'));
        assert.deepEqual(diffSets(ids, SURFACE), { missing: [], extra: [] });
    });
    for (const [file, sec] of SECTIONS) {
        test(file + ': every "Not carried" member is absent from FastBit64 (instance and static)', () => {
            const s = prose(sec());
            const at = s.indexOf('Not carried from FastBit32');
            assert.ok(at >= 0, file + ': Not carried paragraph missing');
            const para = s.slice(at, s.indexOf('\n\n', at) < 0 ? s.length : s.indexOf('\n\n', at));
            const ids = [...backtickIds(para)].filter((n) => !/^(addRange|nextClearBit|add|forEachArray|forEachMapped|BitMapper|serialize|deserialize)$/.test(n));
            for (const want of ['rangeMask', 'nextSubset', 'nextCombination', 'acquire', 'release', 'size']) {
                assert.ok(ids.includes(want), file + ': Not carried omits ' + want);
            }
            for (const n of ids) {
                assert.equal(n in FastBit64.prototype || Object.hasOwn(FastBit64, n), false, file + ': listed as not carried but present: ' + n);
            }
        });
    }
});

// ---- C: executed claims, parsed from the doc text -----------------------------------------------
const ADVERSARIAL = [2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 53 - 1, 2 ** 53, -(2 ** 31), NaN,
    Infinity, -Infinity, null, undefined, 1.5, '1', true, [], {}];
const TYPEERR = [Symbol('s'), 1n, Object.create(null)];
const words = (b) => [b.lo, b.hi];
function domainRows(name, call, lo, hi) {
    // lo..hi accepted (incl. -0 when 0 is inside); lo-1, hi+1 and every adversarial value: RangeError,
    // Symbol / BigInt / null-proto: TypeError; the receiver is unchanged on every throw.
    const b = new FastBit64(0x12345678, -0x0f0f0f10);
    const before = words(b);
    for (const v of [lo, hi, ...(lo <= 0 && hi >= 0 ? [-0] : [])]) {
        assert.doesNotThrow(() => call(new FastBit64(0x12345678, -0x0f0f0f10), v), name + '(' + v + ')');
    }
    for (const v of [lo - 1, hi + 1, ...ADVERSARIAL]) {
        assert.throws(() => call(b, v), RangeError, name + '(' + String(v) + ')');
        assert.deepEqual(words(b), before, name + ' wrote on a rejected ' + String(v));
    }
    for (const v of TYPEERR) {
        assert.throws(() => call(b, v), TypeError, name + ' ' + typeof v);
        assert.deepEqual(words(b), before);
    }
}
const range = (s, re, file, what) => {
    const m = s.match(re);
    assert.ok(m, file + ': domain text missing for ' + what);
    return [Number(m[1]), Number(m[2])];
};

describe('C FastBit64 doc claims, executed', () => {
    for (const [file, sec] of SECTIONS) {
        test(file + ': quick-start values (lo / hi comment, hasAll true, has(64) RangeError, nothing written)', () => {
            const s = sec();
            const m = s.match(/const entity = (new FastBit64\(\)(?:\.add\(\d+\))+);/);
            assert.ok(m, file + ': quick-start builder');
            const entity = new Function('FastBit64', 'return ' + m[1])(FastBit64);
            const c = s.match(/entity\.lo; entity\.hi;\s*\/\/\s*(-?\d+),\s*(-?\d+)/);
            assert.ok(c, file + ': lo / hi comment');
            assert.deepEqual(words(entity), [Number(c[1]), Number(c[2])]);
            const sg = s.match(/const sig = (new FastBit64\(\)(?:\.add\(\d+\))+);/);
            assert.equal(entity.hasAll(new Function('FastBit64', 'return ' + sg[1])(FastBit64)), true);
            assert.throws(() => entity.has(64), RangeError);
            assert.deepEqual(words(entity), [Number(c[1]), Number(c[2])]);
        });

        test(file + ': image header, imageLength and the cross-class loads', () => {
            const s = sec();
            const h = s.match(/`\[(0x[0-9A-Fa-f]+), lo, hi\]`/);
            assert.ok(h, file + ': image text');
            const header = Number(h[1]);
            assert.equal(header, 1178732608);
            const b = new FastBit64(-1, 7);
            assert.deepEqual([...b.serialize()], [header, -1, 7]);
            const f = new FastBit1024(64); f.add(0).add(63);
            const o = new Int32Array(3); f.saveInto(o);
            assert.deepEqual([...o], [header, 1, -2147483648]);
            const il = s.match(/`imageLength`(?: \| `|\s*\()(\d+)/);
            assert.ok(il, file + ': imageLength value');
            assert.equal(b.imageLength, Number(il[1]));
            assert.equal(FastBit64.imageLength, Number(il[1]));
            assert.throws(() => { 'use strict'; b.imageLength = 4; }, TypeError);
            assert.throws(() => { 'use strict'; b.lo = 4; }, TypeError);
            // each class loads the other's; FastBit64 takes any capacity 1..1024 with bits < 64
            for (const cap of [1, 31, 32, 33, 63, 64, 65, 500, 1024]) {
                const src = new FastBit1024(cap); src.add(0).add(Math.min(cap, 64) - 1);
                const img = src.serialize();
                const g = new FastBit64().add(17);
                assert.equal(g.loadFrom(img), img.length, 'next offset, cap ' + cap);
                assert.ok(img.length <= 33);
                assert.deepEqual(g.toArray(), [...new Set([0, Math.min(cap, 64) - 1])].sort((x, y) => x - y));
                if (cap > 64) {
                    src.add(64); const bad = src.serialize();
                    const k = new FastBit64().add(9);
                    assert.throws(() => k.loadFrom(bad), RangeError);
                    assert.deepEqual(k.toArray(), [9], 'nothing written, cap ' + cap);
                }
            }
            const back = new FastBit1024(64); back.loadFrom(b.serialize());
            assert.equal(back.has(31) && back.has(34) && !back.has(35), true);
        });

        test(file + ': index / cursor / range domains as written (boundary matrix, fail closed)', () => {
            const s = prose(sec());
            const nx = file === 'README.md'
                ? range(s, /`nextSetBit\(from\)` \| index or `-1` \| `from` in `(-?\d+)\.\.(-?\d+)`/, file, 'nextSetBit')
                : range(s, /`nextSetBit\(from\)` \(from (-?\d+)\.\.(-?\d+);/, file, 'nextSetBit');
            const pv = file === 'README.md'
                ? range(s, /`prevSetBit\(from\)` \| index or `-1` \| `from` in `(-?\d+)\.\.(-?\d+)`/, file, 'prevSetBit')
                : range(s, /`prevSetBit\(from\)` \(from (-?\d+)\.\.(-?\d+)/, file, 'prevSetBit');
            const sl = file === 'README.md'
                ? range(s, /`select\(k\)` \|[^|]*\| the k-th set bit, `k` (\d+)\.\.(\d+)/, file, 'select')
                : range(s, /`select\(k\)` \(k (\d+)\.\.(\d+)/, file, 'select');
            const ix = range(s, /[Ee]very index is an integer (\d+)\.\.(\d+)/, file, 'index');
            const rg = range(s, /`?(\d+) <= lo <= hi <= (\d+)`?/, file, 'ranges');
            for (const m of ['add', 'remove', 'toggle', 'has', 'rank']) domainRows(m, (b, v) => b[m](v), ix[0], ix[1]);
            domainRows('nextSetBit', (b, v) => b.nextSetBit(v), nx[0], nx[1]);
            domainRows('prevSetBit', (b, v) => b.prevSetBit(v), pv[0], pv[1]);
            domainRows('select', (b, v) => b.select(v), sl[0], sl[1]);
            domainRows('addRange(lo)', (b, v) => b.addRange(v, rg[1]), rg[0], rg[1]);
            domainRows('removeRange(hi)', (b, v) => b.removeRange(rg[0], v), rg[0], rg[1]);
            domainRows('countRange(hi)', (b, v) => b.countRange(rg[0], v), rg[0], rg[1]);
            assert.equal(new FastBit64().add(5).nextSetBit(nx[1]), -1, 'nextSetBit(top) ends a walk');
            assert.equal(new FastBit64().add(5).prevSetBit(pv[0]), -1);
            assert.throws(() => new FastBit64().addRange(5, 3), RangeError, 'lo > hi');
            const full = new FastBit64(-1, -1);
            assert.equal(full.count(), 64); assert.equal(full.nextClearBit(), -1); assert.equal(full.highestClearBit(), -1);
            assert.equal(full.select(63), 63); assert.equal(full.countRange(rg[0], rg[1]), 64);
            const empty = new FastBit64();
            assert.equal(empty.lowest(), -1); assert.equal(empty.highest(), -1); assert.equal(empty.select(0), -1);
            assert.equal(empty.toBinaryString(false), '0'); assert.equal(empty.toBinaryString().length, 64);
            assert.equal(new FastBit64().add(63).toBinaryString()[0], '1');
            for (let b = 0; b < 64; b++) assert.equal(full.select(full.rank(b)), b);
        });

        test(file + ': word law [-2^31, 2^32), stored | 0, for the constructor, setWords and equalsWords', () => {
            const s = prose(sec());
            assert.ok(/\[-2\^31, 2\^32\)/.test(s), file + ': word range text');
            const ok = [-(2 ** 31), -1, 0, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1];
            const bad = [-(2 ** 31) - 1, 2 ** 32, 2 ** 53 - 1, 2 ** 53, NaN, 1.5, null, '5', Infinity];
            for (const w of ok) {
                assert.deepEqual(words(new FastBit64(w, w)), [w | 0, w | 0]);
                assert.deepEqual(words(new FastBit64().setWords(w, 0)), [w | 0, 0]);
                assert.equal(new FastBit64(w, 0).equalsWords(w, 0), true);
            }
            for (const w of bad) {
                assert.throws(() => new FastBit64(w, 0), RangeError, 'ctor ' + w);
                const b = new FastBit64(3, 4);
                assert.throws(() => b.setWords(0, w), RangeError);
                assert.throws(() => b.equalsWords(w, 0), RangeError);
                assert.deepEqual(words(b), [3, 4]);
            }
        });

        test(file + ': brand law (TypeError, receiver unchanged), subclass passes, conversion runs once', () => {
            const s = prose(sec());
            for (const t of ['Proxy', 'Object.create(FastBit64.prototype)', 'FastBit32', 'FastBit1024']) assert.ok(s.includes(t), file + ': brand list omits ' + t);
            const others = [{}, { lo: 0, hi: 0 }, new Proxy(new FastBit64(), {}), Object.create(FastBit64.prototype),
                new FastBit32(), new FastBit1024(64), null, undefined];
            const b = new FastBit64(5, 6);
            for (const m of ['hasAll', 'hasAny', 'hasNone', 'isSubsetOf', 'equals', 'union', 'difference', 'intersect', 'copy', 'countMasked']) {
                for (const o of others) {
                    assert.throws(() => b[m](o), TypeError, m);
                    assert.deepEqual(words(b), [5, 6], m + ' wrote');
                }
            }
            class Sub extends FastBit64 {}
            assert.equal(b.hasAll(new Sub(5, 6)), true);
            assert.equal(new FastBit64(-1, 3).countMasked(new FastBit64(0xf0, -1)), 6);
            let n = 0;
            assert.throws(() => b.add({ valueOf() { n++; return 3; } }), RangeError);
            assert.equal(n, 1, 'conversion runs once');
            // input law: a conversion that itself throws propagates its own error; the receiver stays empty
            const th = new FastBit64();
            assert.throws(() => th.add({ valueOf() { throw new SyntaxError('x'); } }), SyntaxError);
            assert.deepEqual(words(th), [0, 0], 'throwing conversion: receiver untouched');
            // adversarial: the conversion writes the receiver re-entrantly; the rejected call itself writes nothing
            const r = new FastBit64();
            assert.throws(() => r.add({ valueOf() { r.add(7); return 64; } }), RangeError);
            assert.deepEqual(r.toArray(), [7]);
            const fa = new FastBit64().add(1).add(9);
            assert.throws(() => fa.fromArray([2, 64]), RangeError);
            assert.deepEqual(fa.toArray(), [1, 9], 'fromArray checks every index before its single write');
            assert.deepEqual(fa.fromArray([5]).toArray(), [5], 'fromArray overwrites');
        });
    }

    test('forEach: duplicate-free ascending visit that terminates under a re-entrant clear / add (no doc claim beyond O(k) ascending)', () => {
        const b = new FastBit64(-1, -1);
        const seen = [];
        b.forEach((i) => { seen.push(i); if (seen.length > 200) throw new Error('runaway'); if (i === 10) { b.clear(); b.add(63); } });
        for (let i = 1; i < seen.length; i++) assert.ok(seen[i] > seen[i - 1]);
        assert.ok(seen.length <= 64);
    });
});

// ---- D: GC claims vs the torture lane table and the control registry (ASSERTION 3, C-S9) --------
function readmeLanes() {
    const s = readmeSec();
    const m = s.match(/0 B\/op(?: on Node \([^)]*\))? in torture T6[\s\S]*? on (\d+) FastBit64 lanes[^:]*:\s*([\s\S]*?)\.\s+`serialize`/);
    assert.ok(m, 'README.md: lane sentence');
    const names = [...m[2].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
    return [Number(m[1]), names];
}
function llmsLanes() {
    const s = llmsSec();
    const m = s.match(/0 B\/op on Node(?: \([^)]*\))? in torture T6[\s\S]*? on the (\d+) FastBit64 lanes[^:]*:\s*([\s\S]*?)\. serialize/);
    assert.ok(m, 'llms.txt: lane sentence');
    return [Number(m[1]), m[2].split(/,\s*/).map((x) => x.trim())];
}
const SHIPPED_LANES = FB64_LANES.filter((l) => !l.control).map((l) => l.name);

describe('D FastBit64 GC claims', () => {
    for (const [file, get] of [['README.md', readmeLanes], ['llms.txt', llmsLanes]]) {
        test(file + ': the 0 B/op lane list == the T6 lane table (names, count, order-free)', () => {
            const [n, names] = get();
            assert.equal(n, names.length, file + ': stated count vs listed names');
            assert.equal(new Set(names).size, names.length, file + ': duplicate lane name');
            assert.deepEqual(diffSets(new Set(names), new Set(SHIPPED_LANES)), { missing: [], extra: [] });
        });
    }
    test('CHANGELOG [Unreleased]: "N inlined lanes plus one u32 control" == the lane table', () => {
        const c = read('CHANGELOG.md');
        const un = c.slice(c.indexOf('## [Unreleased]'), c.indexOf('\n## [', c.indexOf('## [Unreleased]') + 5));
        const m = un.match(/T6 FastBit64 lanes: (\d+) inlined lanes plus one u32 control/);
        assert.ok(m, 'CHANGELOG: lane line');
        assert.equal(Number(m[1]), SHIPPED_LANES.length);
        assert.equal(FB64_LANES.filter((l) => l.control).length, 1);
    });
    test('CHANGELOG [Unreleased]: control counts and the T3 control names == the control registry', () => {
        const c = read('CHANGELOG.md');
        const un = c.slice(c.indexOf('## [Unreleased]'), c.indexOf('\n## [', c.indexOf('## [Unreleased]') + 5));
        const m = un.match(/Torture controls: (\d+) at 1\.6\.1 -> (\d+) \((\d+) FastBit64 controls\)/);
        assert.ok(m, 'CHANGELOG: controls line');
        const fb64 = CONTROL_NAMES.filter((n) => n.startsWith('fb64-'));
        assert.equal(Number(m[2]), CONTROL_NAMES.length, 'total controls');
        assert.equal(Number(m[3]), fb64.length, 'FastBit64 controls');
        assert.equal(Number(m[2]) - Number(m[1]), fb64.length, 'delta');
        const t3 = un.match(/T3 FastBit64 SAB[^\n]*(?:\n {2}[^\n]*)*/)[0];
        const listed = new Set([...t3.matchAll(/fb64-sab-[a-z]+/g)].map((x) => x[0]));
        assert.deepEqual([...listed].sort(), fb64.filter((n) => n.startsWith('fb64-sab-')).sort());
        // the T3 line names all 3 SAB controls (spec C.D3), not only "whatever the registry holds"
        assert.deepEqual([...listed].sort(), ['fb64-sab-blind', 'fb64-sab-flip', 'fb64-sab-reread']);
    });
    test('CHANGELOG [Unreleased]: the T3 SAB dwell bars ">= A of B sampled reads ... >= C of D bursts" == the A18 / A22 constants', () => {
        const c = read('CHANGELOG.md');
        const un = c.slice(c.indexOf('## [Unreleased]'), c.indexOf('\n## [', c.indexOf('## [Unreleased]') + 5));
        const t3m = un.match(/T3 FastBit64 SAB[^\n]*(?:\n {2}[^\n]*)*/);
        assert.ok(t3m, 'CHANGELOG: T3 FastBit64 SAB line missing');
        const t3 = t3m[0].replace(/\s+/g, ' ');
        const m = t3.match(/>= ([\d,]+) of ([\d,]+) sampled reads see the invalid high word and >= (\d+) of (\d+) bursts/);
        assert.ok(m, 'CHANGELOG: T3 dwell bars line');
        const num = (x) => Number(x.replace(/,/g, ''));
        assert.equal(num(m[1]), T3C.FB64_SAB_DWELL_MIN, 'dwell floor');
        assert.equal(num(m[2]), T3C.FB64_SAB_DWELL_N, 'reads');
        assert.equal(num(m[3]), T3C.FB64_SAB_DWELL_MIXED, 'mixed bar');
        assert.equal(num(m[4]), T3C.FB64_SAB_DWELL_K, 'bursts');
    });
    test('torture log (FB64_TORTURE_LOG): every documented lane reads < 0.1 B/op inlined AND noinline; a missing lane FAILS',
        { skip: process.env.FB64_TORTURE_LOG ? false : 'FB64_TORTURE_LOG unset (a release-time row; point it at the final torture log)' }, () => {
            const log = readFileSync(process.env.FB64_TORTURE_LOG, 'utf8');
            const [, rn] = readmeLanes();
            const [, ln] = llmsLanes();
            for (const name of new Set([...rn, ...ln])) {
                for (const kind of ['lane', 'noinline lane']) {
                    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const m = log.match(new RegExp('^MEASURE FastBit64 ' + kind + ' ' + esc + ' = (-?\\d+\\.\\d+) B/op .*optimized\\) \\[gated <0\\.1\\]$', 'm'));
                    assert.ok(m, 'log has no ' + kind + ' line for ' + name);
                    assert.ok(Number(m[1]) < 0.1, kind + ' ' + name + ' = ' + m[1]);
                }
            }
            assert.match(log, /^MEASURE FastBit64 d8 pointer-compressed lane inlined read scavenges=[0-2] per 1e6 ops \[gated <=2\], store scavenges=[0-2] per 1e6 ops \[gated <=2\], mutator scavenges=[0-2] per 1e6 ops/m);
        });
});

// ---- E: parity pins (ASSERTION 5) ----------------------------------------------------------------
describe('E parity pins', () => {
    test('ROADMAP SC-4 SETTLED block (heading .. the 2026-11-05 amendment) is byte-identical to its pre-C text', () => {
        const r = read('ROADMAP.md');
        const a = r.indexOf('### SC-4 -- `FastBit64`');
        const b = r.indexOf('**Amended 2026-11-05 (PROPOSAL-fastbit64 section 7).**', a);
        assert.ok(a >= 0 && b > a, 'ROADMAP: SC-4 block anchors');
        // sha256 of the block at 57fd897 (pre-D0) == aab22d2 == HEAD 54a9f2d
        assert.equal(createHash('sha256').update(r.slice(a, b)).digest('hex'), SC4_SHA);
    });
    test('llms.txt line 1 names the package.json version (v1.6.1 until /release)', () => {
        const v = JSON.parse(readFileSync(PKG + 'package.json', 'utf8')).version;
        assert.equal(read('llms.txt').split('\n')[0], '# @zakkster/lite-fastbit32 v' + v);
    });
});
const SC4_SHA = '86a3d6881f5a9a2218cfb5da269674d2e3c50a2cff9d6134b587695c211927e3';

// ---- F: recipe path coverage (queued C.D2 nit: summary-skip / hi-word branches, counters + floors) -
function bits4096(file) {
    const text = read(file);
    const marker = '64 x 64 = 4096 recipe (1.7.0';
    const fence = file === 'README.md' ? '```js' : '```javascript';
    const at = text.indexOf(marker);
    assert.ok(at >= 0, file + ': recipe marker');
    const f = text.indexOf(fence, at) + fence.length;
    const code = text.slice(f, text.indexOf('\n```', f)).split('\n').filter((l) => !/^\s*import /.test(l)).join('\n');
    return new Function('FastBit64', code + '\nreturn Bits4096;')(FastBit64);
}
function xs32(seed) {
    let x = seed >>> 0;
    return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
}

describe('F Bits4096 recipe: branch coverage with floors, boundary matrix', () => {
    for (const file of ['README.md', 'llms.txt']) {
        test(file + ': lowest / acquire hi-word branches and the nextSetBit summary skip, counted, 0 mismatches', () => {
            const Bits4096 = bits4096(file);
            const rng = xs32(0x6a09e667);
            let mism = 0, first = '';
            const bad = (m) => { if (mism++ === 0) first = m; };
            let lowHi = 0, acqHi = 0, skipHit = 0, skipHitHi = 0, skipNone = 0, last63 = 0, inSlot = 0;
            for (let round = 0; round < 600; round++) {
                const b = new Bits4096();
                const o = new Uint8Array(4096);
                // sparse: 1..6 active slots; per slot a random shape, biased to empty lo words
                const k = 1 + (rng() % 6);
                for (let j = 0; j < k; j++) {
                    const s = rng() % 64, shape = rng() % 4, base = s << 6;
                    if (shape === 0) { const i = base + 32 + (rng() % 32); b.add(i); o[i] = 1; }
                    else if (shape === 1) { for (let i = base; i < base + 32; i++) { b.add(i); o[i] = 1; } }
                    else if (shape === 2) { for (let i = base; i < base + 32; i++) { b.add(i); o[i] = 1; } const i = base + 32 + (rng() % 32); b.add(i); o[i] = 1; }
                    else { const i = base + (rng() % 64); b.add(i); o[i] = 1; }
                }
                let low = -1; for (let i = 0; i < 4096; i++) if (o[i]) { low = i; break; }
                if (b.lowest() !== low) bad('lowest ' + b.lowest() + ' != ' + low);
                if (low !== -1 && (low & 63) >= 32) lowHi++;
                for (let q = 0; q < 40; q++) {
                    const from = q === 0 ? 4032 + (rng() % 65) : rng() % 4097;
                    let want = -1; for (let i = from; i < 4096; i++) if (o[i]) { want = i; break; }
                    if (b.nextSetBit(from) !== want) bad('nextSetBit(' + from + ') ' + b.nextSetBit(from) + ' != ' + want);
                    if (from < 4096) {
                        if ((from >> 6) === 63) last63++;
                        else if (want === -1) skipNone++;
                        else if ((want >> 6) > (from >> 6)) { skipHit++; if ((want & 63) >= 32) skipHitHi++; }
                        else inSlot++;
                    }
                }
                let free = -1; for (let i = 0; i < 4096; i++) if (!o[i]) { free = i; break; }
                const got = b.acquire();
                if (got !== free) bad('acquire ' + got + ' != ' + free);
                if (free !== -1) { o[free] = 1; if ((free & 63) >= 32) acqHi++; }
            }
            // acquire phase: slots below s full, slot s's lo word full (3 in 4) with random hi bits
            for (let round = 0; round < 300; round++) {
                const b = new Bits4096();
                const o = new Uint8Array(4096);
                const sl = rng() % 64, base = sl << 6;
                for (let i = 0; i < base; i++) { b.add(i); o[i] = 1; }
                if (rng() % 4 !== 0) for (let i = base; i < base + 32; i++) { b.add(i); o[i] = 1; }
                for (let j = rng() % 8; j > 0; j--) { const i = base + 32 + (rng() % 32); b.add(i); o[i] = 1; }
                for (let q = 0; q < 3; q++) {
                    let free = -1; for (let i = 0; i < 4096; i++) if (!o[i]) { free = i; break; }
                    const got = b.acquire();
                    if (got !== free) bad('acquire phase ' + got + ' != ' + free);
                    if (free === -1) break;
                    o[free] = 1; if ((free & 63) >= 32) acqHi++;
                }
            }
            const counts = { lowHi, acqHi, skipHit, skipHitHi, skipNone, last63, inSlot };
            assert.equal(mism, 0, file + ': ' + first + ' ' + JSON.stringify(counts));
            assert.ok(lowHi >= 100, 'lowest hi-word floor ' + JSON.stringify(counts));
            assert.ok(acqHi >= 100, 'acquire hi-word floor ' + JSON.stringify(counts));
            assert.ok(skipHit >= 1000 && skipHitHi >= 200, 'summary-skip floors ' + JSON.stringify(counts));
            assert.ok(skipNone >= 500 && last63 >= 300 && inSlot >= 200, 'skip -1 / slot 63 / in-slot floors ' + JSON.stringify(counts));
            if (process.env.FB64_DOCS_VERBOSE) console.log(file, counts);
        });

        test(file + ': index boundary matrix, duplicate release, release during a nextSetBit walk', () => {
            const Bits4096 = bits4096(file);
            const b = new Bits4096();
            b.add(-0); assert.equal(b.has(0), true); b.remove(0);
            for (const v of [-1, 4096, 4097, 2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 53 - 1, 2 ** 53,
                NaN, null, undefined, 1.5, '1', { valueOf() { return 5; } }, Infinity]) {
                for (const m of ['add', 'remove', 'has', 'release']) assert.throws(() => b[m](v), RangeError, m + '(' + String(v) + ')');
            }
            for (const v of [-1, 4097, 8191, 2 ** 31, NaN, null]) assert.throws(() => b.nextSetBit(v), RangeError);
            assert.equal(b.nextSetBit(4096), -1);
            assert.equal(b.size, 0); assert.equal(b.active.isEmpty(), true);
            for (let i = 0; i < 4096; i += 7) b.add(i);
            const n0 = b.size;
            b.release(4095 - (4095 % 7));
            assert.throws(() => b.release(4095 - (4095 % 7)), RangeError, 'duplicate release');
            assert.equal(b.size, n0 - 1);
            // re-entrant write: release every visited index during the walk
            let walked = 0;
            for (let i = b.nextSetBit(0); i !== -1; i = b.nextSetBit(i + 1)) { b.release(i); walked++; }
            assert.equal(walked, n0 - 1); assert.equal(b.size, 0);
            assert.equal(b.active.isEmpty() && b.full.isEmpty(), true);
        });
    }
});
