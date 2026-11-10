// test/FastBit64QA.test.mjs -- qa GROUP A (FastBit64 surface + correctness + parity), 1.7.0 burst.
// Written from .handoff/PLAN-fastbit64-A.md ASSERTIONS A3 / A4 / A5 and FastBit32.d.ts, not from the section.
//
// (1) A seeded 400,000-op three-way differential: the live FastBit64, a BigInt model (the TRUE definition,
//     bit by bit), and the PRE-PC shipped class (`git show 0fd010ff:FastBit32.js`, sha256 a60bcedf..., bare
//     `#lo; #hi;` fields), loaded from a temp file. Every mutator and every query; words drawn so >= 30% are
//     outside the 31-bit Smi range (bit 30 != bit 31); word arguments alternate int32 / uint32 forms; index
//     arguments use -0 for 0 part of the time. State (lo, hi) and every return value (Object.is) must agree
//     after every op; per-op-kind floor 1,000; mismatch count 0. A missing PRE-PC base FAILS, never skips.
// (2) Gap rows the A3 / A4 / A5 suites (test/FastBit64.test.mjs) do not have: -0 in every numeric slot;
//     the integer boundary matrix (-1, 2^30, 2^31-1, 2^31, 2^32-1, 2^32, 2^53-1, 2^53) in every slot;
//     null-prototype objects (the d.ts TypeError claim); self-aliasing cross-set calls; re-entrant writes
//     (valueOf / getter / forEach callback mutating the receiver); fromArray lengths 0 / 63 / 64 / 65;
//     clone / copy independence both ways on both words; detached and cross-realm buffers; a second module
//     copy's FastBit64 as `other`.
// Node 18 APIs only. No timing. Mutant runs (qa evidence) copy this file next to a mutated FastBit32.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { FastBit64, FastBit1024 } from '../FastBit32.js';

// ---------------------------------------------------------------- the PRE-PC class (fails, never skips)
const ROOT = new URL('../', import.meta.url);
const PREPC = '0fd010ff4e79cc41f7678662d539037409b4974b';
let PrePC = null, prepcErr = null;
try {
    const src = execFileSync('git', ['show', PREPC + ':FastBit32.js'], { cwd: fileURLToPath(ROOT), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const sha = createHash('sha256').update(src).digest('hex');
    if (!sha.startsWith('a60bcedf')) throw new Error('PRE-PC FastBit32.js sha256 ' + sha.slice(0, 8) + ', expected a60bcedf');
    if (!src.includes('\n    #lo; #hi;\n')) throw new Error('PRE-PC body lacks the bare `#lo; #hi;` fields');
    const dir = mkdtempSync(join(tmpdir(), 'fb64qa-prepc-'));
    try {
        const f = join(dir, 'FastBit32.prepc.mjs');
        writeFileSync(f, src);
        PrePC = (await import(pathToFileURL(f).href)).FastBit64;
    } finally { rmSync(dir, { recursive: true, force: true }); }
    if (typeof PrePC !== 'function') throw new Error('PRE-PC module has no FastBit64 export');
} catch (e) { prepcErr = e; }

// ---------------------------------------------------------------- helpers
function stream(seed) {
    let x = seed | 0;
    if (x === 0) x = 1;
    return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
}
const MIN = -2147483648, MAX = 2147483647, HEADER = 1178732608;
const BIT = [];
for (let i = 0; i < 64; i++) BIT.push(1n << BigInt(i));
const M64 = (1n << 64n) - 1n;
const big = (lo, hi) => (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
const loOf = (m) => Number(BigInt.asIntN(32, m));
const hiOf = (m) => Number(BigInt.asIntN(32, m >> 32n));
const outOfSmi = (w) => w < -0x40000000 || w >= 0x40000000;
const rmask = (a, b) => ((1n << BigInt(b)) - 1n) ^ ((1n << BigInt(a)) - 1n);
// BigInt model queries: the true definitions, one bit at a time
const mHas = (m, i) => (m & BIT[i]) !== 0n;
function mPc(m) { let n = 0; for (let i = 0; i < 64; i++) if ((m & BIT[i]) !== 0n) n++; return n; }
function mList(m) { const l = []; for (let i = 0; i < 64; i++) if ((m & BIT[i]) !== 0n) l.push(i); return l; }
function mNext(m, f) { for (let i = f; i < 64; i++) if ((m & BIT[i]) !== 0n) return i; return -1; }
function mPrev(m, f) { for (let i = f; i >= 0; i--) if ((m & BIT[i]) !== 0n) return i; return -1; }
function mSelect(m, k) { let n = 0; for (let i = 0; i < 64; i++) if ((m & BIT[i]) !== 0n) { if (n === k) return i; n++; } return -1; }
const show = (v) => (Object.is(v, -0) ? '-0' : Array.isArray(v) ? '[' + v.join(',') + ']' : typeof v === 'bigint' ? v + 'n' : String(v));
const snap = (x) => x.lo + ':' + x.hi;

function throwsCls(fn) { try { fn(); } catch (e) { return e; } return null; }
function expectThrow(x, fn, Cls, label) {
    const before = x ? snap(x) : null;
    const e = throwsCls(fn);
    assert.ok(e, label + ': did not throw');
    assert.ok(e instanceof Cls, label + ': expected ' + Cls.name + ', got ' + (e && e.name) + ': ' + (e && e.message));
    if (x) assert.equal(snap(x), before, label + ': receiver changed');
}

// ---------------------------------------------------------------- (1) the differential
const OPS = ['add', 'remove', 'toggle', 'has', 'union', 'difference', 'intersect', 'copy', 'hasAll', 'hasAny',
    'hasNone', 'isSubsetOf', 'equals', 'countMasked', 'setWords', 'equalsWords', 'constructor', 'count', 'isEmpty',
    'isFull', 'clear', 'lowest', 'highest', 'nextClearBit', 'highestClearBit', 'nextSetBit', 'prevSetBit', 'rank',
    'select', 'addRange', 'removeRange', 'countRange', 'forEach', 'toArray', 'fromArray', 'saveInto', 'serialize',
    'loadFrom', 'deserialize', 'clone', 'toBinaryString', 'imageLength'];
const EDGE = [0, -1, MIN, MAX, 0x40000000, 0x3FFFFFFF, -0x40000000, -0x40000001, 0x7FFFFFFE, MIN + 1, 0x55555555,
    0xAAAAAAAA | 0, 1, 0x80000001 | 0, 0xC0000000 | 0, 0xBFFFFFFF | 0];

function differential(Live, Pre, STEPS, seed) {
    const rnd = stream(seed);
    const R = { steps: STEPS, mism: 0, first: [], hit: new Array(OPS.length).fill(0), drawn: 0, oos: 0, negZero: 0, stateOos: 0, selfHits: 0 };
    class SubL extends Live {}
    class SubP extends Pre {}
    const word = () => {
        const k = rnd() & 3;
        let w;
        if (k === 0) w = rnd() | 0;
        else if (k === 1) { w = rnd() | 0; if (!outOfSmi(w)) w ^= 0x40000000; }
        else if (k === 2) w = (rnd() & rnd() & rnd()) | 0;
        else w = EDGE[rnd() % EDGE.length];
        R.drawn++; if (outOfSmi(w)) R.oos++;
        return w;
    };
    const asArg = (w) => ((rnd() & 1) ? (w >>> 0) : w);
    const idx = (n) => { const v = rnd() % n; if (v === 0 && (rnd() & 1)) { R.negZero++; return -0; } return v; };
    let s = 0, op = 0;
    const bad = (what, l, p, e) => {
        R.mism++;
        if (R.first.length < 8) R.first.push('step ' + s + ' ' + OPS[op] + ' ' + what + ': live ' + show(l) + ' prepc ' + show(p) + ' model ' + show(e));
    };
    const cmp = (what, l, p, e) => { if (!Object.is(l, e) || !Object.is(p, e)) bad(what, l, p, e); };
    const cmpS = (what, l, p, e) => { const a = show(l), b = show(p), c = show(e); if (a !== c || b !== c) bad(what, a, b, c); };
    const FEL = [], FEP = [];
    const cbL = (b) => { FEL.push(b); }, cbP = (b) => { FEP.push(b); };
    const partner = () => {
        const r = rnd() % 10;
        if (r === 0) { R.selfHits++; return [L, P, m]; }
        const a = word(), b = word();
        if (r === 1) return [new SubL(asArg(a), asArg(b)), new SubP(a, b), big(a, b)];
        return [new Live(asArg(a), asArg(b)), new Pre(a, b), big(a, b)];
    };
    // start just below the Smi edge on lo and just inside it on hi, so the first ops cross it
    const L = new Live(0x3FFFFFFF, -0x40000000), P = new Pre(0x3FFFFFFF, -0x40000000);
    let m = big(0x3FFFFFFF, -0x40000000);
    for (s = 0; s < STEPS; s++) {
        op = rnd() % OPS.length;
        R.hit[op]++;
        switch (OPS[op]) {
            case 'add': case 'remove': case 'toggle': {
                const b = idx(64), name = OPS[op];
                cmp('returns this', L[name](b) === L, P[name](b) === P, true);
                const bb = b | 0;
                m = name === 'add' ? m | BIT[bb] : name === 'remove' ? m & ~BIT[bb] : m ^ BIT[bb];
                break;
            }
            case 'has': { const b = idx(64); cmp('has(' + show(b) + ')', L.has(b), P.has(b), mHas(m, b | 0)); break; }
            case 'union': case 'difference': case 'intersect': case 'copy': {
                const [ol, op2, om] = partner(), name = OPS[op];
                cmp('returns this', L[name](ol) === L, P[name](op2) === P, true);
                m = name === 'union' ? m | om : name === 'difference' ? m & ~om : name === 'intersect' ? m & om : om;
                break;
            }
            case 'hasAll': { const [ol, op2, om] = partner(); cmp('hasAll', L.hasAll(ol), P.hasAll(op2), (m & om) === om); break; }
            case 'hasAny': { const [ol, op2, om] = partner(); cmp('hasAny', L.hasAny(ol), P.hasAny(op2), (m & om) !== 0n); break; }
            case 'hasNone': { const [ol, op2, om] = partner(); cmp('hasNone', L.hasNone(ol), P.hasNone(op2), (m & om) === 0n); break; }
            case 'isSubsetOf': { const [ol, op2, om] = partner(); cmp('isSubsetOf', L.isSubsetOf(ol), P.isSubsetOf(op2), (m & ~om) === 0n); break; }
            case 'equals': {
                const [ol, op2, om] = (rnd() & 3) === 0 ? [new Live(loOf(m), hiOf(m)), new Pre(loOf(m), hiOf(m)), m] : partner();
                cmp('equals', L.equals(ol), P.equals(op2), m === om); break;
            }
            case 'countMasked': { const [ol, op2, om] = partner(); cmp('countMasked', L.countMasked(ol), P.countMasked(op2), mPc(m & om)); break; }
            case 'setWords': {
                const a = word(), b = word();
                cmp('returns this', L.setWords(asArg(a), asArg(b)) === L, P.setWords(asArg(a), asArg(b)) === P, true);
                m = big(a, b); break;
            }
            case 'equalsWords': {
                const same = (rnd() & 1) === 1, a = same ? loOf(m) : word(), b = same ? hiOf(m) : word();
                cmp('equalsWords', L.equalsWords(asArg(a), asArg(b)), P.equalsWords(asArg(a), asArg(b)), m === big(a, b)); break;
            }
            case 'constructor': {
                const a = word(), b = word(), cl = new Live(asArg(a), asArg(b)), cp = new Pre(asArg(a), asArg(b)), cm = big(a, b);
                cmp('ctor lo', cl.lo, cp.lo, loOf(cm)); cmp('ctor hi', cl.hi, cp.hi, hiOf(cm)); break;
            }
            case 'count': cmp('count', L.count(), P.count(), mPc(m)); break;
            case 'isEmpty': cmp('isEmpty', L.isEmpty(), P.isEmpty(), m === 0n); break;
            case 'isFull': cmp('isFull', L.isFull(), P.isFull(), m === M64); break;
            case 'clear': cmp('returns this', L.clear() === L, P.clear() === P, true); m = 0n; break;
            case 'lowest': cmp('lowest', L.lowest(), P.lowest(), mNext(m, 0)); break;
            case 'highest': cmp('highest', L.highest(), P.highest(), mPrev(m, 63)); break;
            case 'nextClearBit': cmp('nextClearBit', L.nextClearBit(), P.nextClearBit(), mNext(~m & M64, 0)); break;
            case 'highestClearBit': cmp('highestClearBit', L.highestClearBit(), P.highestClearBit(), mPrev(~m & M64, 63)); break;
            case 'nextSetBit': { const f = idx(65); cmp('nextSetBit(' + show(f) + ')', L.nextSetBit(f), P.nextSetBit(f), mNext(m, f | 0)); break; }
            case 'prevSetBit': { const f = idx(65) - 1; const g = f === 0 && (rnd() & 1) ? -0 : f; cmp('prevSetBit(' + show(g) + ')', L.prevSetBit(g), P.prevSetBit(g), g === -1 ? -1 : mPrev(m, g | 0)); break; }
            case 'rank': { const b = idx(64); cmp('rank(' + show(b) + ')', L.rank(b), P.rank(b), mPc(m & (BIT[b | 0] - 1n))); break; }
            case 'select': { const k = idx(64); cmp('select(' + show(k) + ')', L.select(k), P.select(k), mSelect(m, k | 0)); break; }
            case 'addRange': case 'removeRange': case 'countRange': {
                let a = idx(65), b = idx(65);
                if (a > b) { const t = a; a = b; b = t; }
                const name = OPS[op], rm = rmask(a | 0, b | 0);
                if (name === 'countRange') { cmp('countRange(' + show(a) + ',' + show(b) + ')', L.countRange(a, b), P.countRange(a, b), mPc(m & rm)); break; }
                cmp('returns this', L[name](a, b) === L, P[name](a, b) === P, true);
                m = name === 'addRange' ? m | rm : m & ~rm; break;
            }
            case 'forEach': {
                FEL.length = 0; FEP.length = 0;
                cmp('returns this', L.forEach(cbL) === L, P.forEach(cbP) === P, true);
                cmpS('forEach order', FEL, FEP, mList(m)); break;
            }
            case 'toArray': {
                const a = L.toArray(), b = P.toArray();
                cmp('toArray is Array', Array.isArray(a), Array.isArray(b), true);
                cmpS('toArray', a, b, mList(m)); break;
            }
            case 'fromArray': {
                const len = rnd() % 70, kind = rnd() % 3, list = [];
                let nm = 0n;
                for (let i = 0; i < len; i++) { const b = idx(64); list.push(b); nm |= BIT[b | 0]; }
                const mk = () => (kind === 0 ? list.slice() : kind === 1 ? Int32Array.from(list) : Float64Array.from(list));
                cmp('returns this', L.fromArray(mk()) === L, P.fromArray(mk()) === P, true);
                m = nm; break;
            }
            case 'saveInto': {
                const off = idx(5), oL = new Int32Array((off | 0) + 5).fill(0x5A5A5A5A), oP = oL.slice();
                const exp = Array.from(oL);
                exp[(off | 0)] = HEADER; exp[(off | 0) + 1] = loOf(m); exp[(off | 0) + 2] = hiOf(m);
                cmp('saveInto return', L.saveInto(oL, off), P.saveInto(oP, off), (off | 0) + 3);
                cmpS('saveInto image', Array.from(oL), Array.from(oP), exp); break;
            }
            case 'serialize': cmpS('serialize', Array.from(L.serialize()), Array.from(P.serialize()), [HEADER, loOf(m), hiOf(m)]); break;
            case 'loadFrom': case 'deserialize': {
                const r = rnd() & 3;
                const cap = r === 0 ? 64 : r === 1 ? 1 + (rnd() % 63) : r === 2 ? 65 + (rnd() % 960) : 64;
                const L32 = (cap + 31) >>> 5, off = idx(5);
                const src = new Int32Array((off | 0) + 1 + L32 + 2).fill(0x77777777);
                let a = word(), b = word();
                if (cap < 32) a &= (1 << cap) - 1;
                if (cap <= 32) b = 0; else if (cap < 64) b &= (1 << (cap - 32)) - 1;
                src[off | 0] = 0x46420800 | cap;
                for (let w = 0; w < L32; w++) src[(off | 0) + 1 + w] = w === 0 ? a : w === 1 ? b : 0;
                const im = big(a, b), ret = (off | 0) + 1 + L32;
                if (OPS[op] === 'loadFrom') { cmp('loadFrom return', L.loadFrom(src, off), P.loadFrom(src, off), ret); m = im; }
                else {
                    const dl = Live.deserialize(src, off), dp = Pre.deserialize(src, off);
                    cmp('deserialize class', dl instanceof Live, dp instanceof Pre, true);
                    cmp('deserialize lo', dl.lo, dp.lo, loOf(im)); cmp('deserialize hi', dl.hi, dp.hi, hiOf(im));
                }
                break;
            }
            case 'clone': {
                const cl = L.clone(), cp = P.clone();
                cmp('clone distinct', cl !== L && cl instanceof Live, cp !== P && cp instanceof Pre, true);
                cmp('clone lo', cl.lo, cp.lo, loOf(m)); cmp('clone hi', cl.hi, cp.hi, hiOf(m));
                const b = idx(64); cl.toggle(b); cp.toggle(b);
                cmp('clone toggled lo', cl.lo, cp.lo, loOf(m ^ BIT[b | 0])); cmp('clone toggled hi', cl.hi, cp.hi, hiOf(m ^ BIT[b | 0]));
                break;
            }
            case 'toBinaryString': {
                const r = rnd() % 3, pad = r === 0 ? undefined : r === 1;
                const e = pad === false ? m.toString(2) : m.toString(2).padStart(64, '0');
                cmp('toBinaryString(' + pad + ')', L.toBinaryString(pad), P.toBinaryString(pad), e); break;
            }
            case 'imageLength': cmp('imageLength', L.imageLength + Live.imageLength, P.imageLength + Pre.imageLength, 6); break;
            default: throw new Error('unhandled op ' + OPS[op]);
        }
        // state after EVERY op, three ways
        const elo = loOf(m), ehi = hiOf(m);
        cmp('state lo', L.lo, P.lo, elo); cmp('state hi', L.hi, P.hi, ehi);
        if (outOfSmi(elo) || outOfSmi(ehi)) R.stateOos++;
    }
    return R;
}

describe('FastBit64 qa A -- 400,000-op differential: live vs BigInt model vs PRE-PC (0fd010f, bare fields)', () => {
    it('the PRE-PC base is available, sha256 a60bcedf, bare fields (a missing base FAILS)', () => {
        assert.equal(prepcErr, null, String(prepcErr && prepcErr.stack));
        assert.notEqual(PrePC, FastBit64);
    });
    it('400,000 seeded ops; every op kind >= 1,000 hits; >= 30% of drawn words out of Smi; 0 mismatches', () => {
        assert.equal(prepcErr, null, 'PRE-PC base missing: ' + String(prepcErr));
        const R = differential(FastBit64, PrePC, 400000, 0x2545f491);
        const kinds = OPS.map((n, i) => n + '=' + R.hit[i]).join(' ');
        console.log('# FB64QA differential steps=' + R.steps + ' kinds=' + OPS.length + ' mism=' + R.mism +
            ' drawn=' + R.drawn + ' oosDrawn=' + (R.oos / R.drawn).toFixed(4) + ' stateOos=' + (R.stateOos / R.steps).toFixed(4) +
            ' negZero=' + R.negZero + ' self=' + R.selfHits);
        console.log('# FB64QA hits ' + kinds);
        for (const f of R.first) console.log('# FB64QA MISMATCH ' + f);
        assert.equal(R.mism, 0, 'mismatches: ' + R.mism + '\n' + R.first.join('\n'));
        for (let i = 0; i < OPS.length; i++) assert.ok(R.hit[i] >= 1000, 'floor: ' + OPS[i] + ' ran ' + R.hit[i] + ' times');
        assert.ok(R.oos / R.drawn >= 0.30, 'out-of-Smi drawn fraction ' + R.oos / R.drawn);
        assert.ok(R.negZero >= 1000, '-0 index arguments used ' + R.negZero + ' times');
        assert.ok(R.selfHits >= 1000, 'self-aliased partners ' + R.selfHits);
    });
    it('must-fail controls: a hi-word toggle bug and a union that drops hi are each caught (mism > 0)', () => {
        assert.equal(prepcErr, null, 'PRE-PC base missing: ' + String(prepcErr));
        class BadToggle extends FastBit64 { toggle(b) { if ((b | 0) >= 32) return this.add(b); return super.toggle(b); } }
        class BadUnion extends FastBit64 { union(o) { return this.setWords(this.lo | o.lo, this.hi); } }
        for (const [name, C] of [['BadToggle', BadToggle], ['BadUnion', BadUnion]]) {
            const R = differential(C, PrePC, 20000, 0x2545f491);
            console.log('# FB64QA control ' + name + ' mism=' + R.mism + ' first: ' + (R.first[0] || 'none'));
            assert.ok(R.mism > 0, name + ' was not caught');
        }
    });
});

// ---------------------------------------------------------------- (2) gap rows
const IDX1 = ['add', 'remove', 'toggle', 'has', 'rank', 'select'];
const RANGE = ['addRange', 'removeRange', 'countRange'];
const CROSS = ['hasAll', 'hasAny', 'hasNone', 'isSubsetOf', 'equals', 'union', 'difference', 'intersect', 'copy', 'countMasked'];
const OOS = [[0x40000000, 0x7FFFFFFF], [-0x40000001, MIN], [0xC0000000 | 0, 0x3FFFFFFF], [-1, 0x40000000]];

describe('FastBit64 qa A -- -0 in every numeric slot is +0, and no method returns -0', () => {
    it('index, cursor, range, word, offset and fromArray slots accept -0 exactly like 0', () => {
        for (const [lo, hi] of OOS) {
            for (const name of IDX1) {
                const a = new FastBit64(lo, hi), b = new FastBit64(lo, hi);
                const ra = a[name](-0), rb = b[name](0);
                assert.ok(Object.is(ra === a ? 'this' : ra, rb === b ? 'this' : rb), name + '(-0) ' + show(ra) + ' vs ' + show(rb));
                assert.equal(snap(a), snap(b), name + '(-0) state');
            }
            const x = new FastBit64(lo, hi);
            assert.ok(Object.is(x.nextSetBit(-0), x.nextSetBit(0)), 'nextSetBit(-0)');
            assert.ok(Object.is(x.prevSetBit(-0), x.prevSetBit(0)), 'prevSetBit(-0)');
            for (const name of RANGE) for (const [p, q] of [[-0, -0], [-0, 33], [-0, 64]]) {
                const a = new FastBit64(lo, hi), b = new FastBit64(lo, hi);
                const ra = a[name](p, q), rb = b[name](0, q);
                assert.ok(Object.is(ra === a ? 'this' : ra, rb === b ? 'this' : rb), name + '(' + show(p) + ',' + q + ')');
                assert.equal(snap(a), snap(b), name + ' state');
            }
        }
        const w = new FastBit64(-0, -0);
        assert.ok(Object.is(w.lo, 0) && Object.is(w.hi, 0), 'ctor(-0, -0) stores +0');
        w.setWords(5, 5).setWords(-0, -0);
        assert.ok(Object.is(w.lo, 0) && Object.is(w.hi, 0), 'setWords(-0, -0) stores +0');
        assert.equal(w.equalsWords(-0, -0), true);
        const out = new Int32Array(4);
        assert.ok(Object.is(new FastBit64(1, 2).saveInto(out, -0), 3), 'saveInto(out, -0) returns +3');
        assert.deepEqual(Array.from(out), [HEADER, 1, 2, 0]);
        const y = new FastBit64(9, 9);
        assert.ok(Object.is(y.loadFrom(out, -0), 3), 'loadFrom(src, -0) returns 3');
        assert.equal(snap(y), '1:2');
        assert.equal(snap(FastBit64.deserialize(out, -0)), '1:2');
        assert.equal(snap(new FastBit64(-1, -1).fromArray([-0])), '1:0');
        assert.equal(snap(new FastBit64(-1, -1).fromArray(Float64Array.of(-0, 63))), '1:' + MIN);
    });
    it('no numeric return is -0 (empty, full and out-of-Smi sets, every argument 0 / -0)', () => {
        const NUM = (x) => [x.count(), x.lowest(), x.highest(), x.nextClearBit(), x.highestClearBit(), x.lo, x.hi,
            x.nextSetBit(-0), x.prevSetBit(-0), x.rank(-0), x.select(-0), x.countRange(-0, -0), x.countRange(0, 64), x.countMasked(x)];
        for (const [lo, hi] of [[0, 0], [-1, -1], ...OOS]) for (const v of NUM(new FastBit64(lo, hi))) assert.ok(!Object.is(v, -0), lo + ',' + hi + ' returned -0');
    });
});

describe('FastBit64 qa A -- integer boundary matrix in every slot', () => {
    const MAT = [-1, 2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 53 - 1, 2 ** 53];
    it('index / cursor / range slots: all eight are RangeErrors (prevSetBit(-1) returns -1); receiver unchanged', () => {
        for (const v of MAT) {
            for (const name of IDX1) { const x = new FastBit64(0x40000000, MIN); expectThrow(x, () => x[name](v), RangeError, name + '(' + v + ')'); }
            const x = new FastBit64(0x40000000, MIN);
            expectThrow(x, () => x.nextSetBit(v), RangeError, 'nextSetBit(' + v + ')');
            if (v === -1) assert.equal(x.prevSetBit(v), -1); else expectThrow(x, () => x.prevSetBit(v), RangeError, 'prevSetBit(' + v + ')');
            for (const name of RANGE) {
                expectThrow(x, () => x[name](v, 64), RangeError, name + '(' + v + ', 64)');
                expectThrow(x, () => x[name](0, v), RangeError, name + '(0, ' + v + ')');
            }
        }
    });
    it('word slots: -1, 2^30, 2^31-1, 2^31, 2^32-1 store v | 0; 2^32, 2^53-1, 2^53 are RangeErrors in lo AND hi', () => {
        for (const v of MAT) {
            const ok = v < 2 ** 32;
            for (const pos of [0, 1]) {
                const args = pos === 0 ? [v, 7] : [7, v];
                if (ok) {
                    const x = new FastBit64(...args), e = pos === 0 ? (v | 0) + ':7' : '7:' + (v | 0);
                    assert.equal(snap(x), e, 'ctor ' + args);
                    assert.equal(snap(new FastBit64(1, 1).setWords(...args)), e, 'setWords ' + args);
                    assert.equal(x.equalsWords(...args), true, 'equalsWords ' + args);
                    assert.equal(outOfSmi(pos === 0 ? x.lo : x.hi), outOfSmi(v | 0), 'getter out of Smi ' + v);
                } else {
                    assert.ok(throwsCls(() => new FastBit64(...args)) instanceof RangeError, 'ctor ' + args);
                    const x = new FastBit64(0x40000000, MIN);
                    expectThrow(x, () => x.setWords(...args), RangeError, 'setWords ' + args);
                    expectThrow(x, () => x.equalsWords(...args), RangeError, 'equalsWords ' + args);
                }
            }
        }
    });
    it('offset slots: all eight are RangeErrors for saveInto / loadFrom / deserialize; out unwritten', () => {
        const img = new FastBit64(0x40000000, MIN).serialize();
        const buf = new Int32Array(8);
        for (let i = 0; i < 8; i++) buf[i] = img[i % 3];
        for (const v of MAT) {
            const x = new FastBit64(-0x40000001, 0x7FFFFFFF), out = new Int32Array(8).fill(-7);
            expectThrow(x, () => x.saveInto(out, v), RangeError, 'saveInto(out, ' + v + ')');
            assert.deepEqual(Array.from(out), new Array(8).fill(-7), 'saveInto wrote at ' + v);
            expectThrow(x, () => x.loadFrom(buf, v), RangeError, 'loadFrom(src, ' + v + ')');
            assert.ok(throwsCls(() => FastBit64.deserialize(buf, v)) instanceof RangeError, 'deserialize(src, ' + v + ')');
        }
    });
});

describe('FastBit64 qa A -- null-prototype objects (d.ts: TypeError in index slots)', () => {
    it('index / cursor / range / fromArray element: TypeError; word slots: RangeError; nothing written', () => {
        const np = Object.create(null);
        const x = new FastBit64(0x40000000, MIN);
        for (const name of IDX1) expectThrow(x, () => x[name](np), TypeError, name + '(nullproto)');
        expectThrow(x, () => x.nextSetBit(np), TypeError, 'nextSetBit');
        expectThrow(x, () => x.prevSetBit(np), TypeError, 'prevSetBit');
        for (const name of RANGE) { expectThrow(x, () => x[name](np, 3), TypeError, name + ' lo'); expectThrow(x, () => x[name](0, np), TypeError, name + ' hi'); }
        expectThrow(x, () => x.fromArray([1, np]), TypeError, 'fromArray element');
        expectThrow(x, () => x.setWords(np, 0), RangeError, 'setWords lo');
        expectThrow(x, () => x.equalsWords(0, np), RangeError, 'equalsWords hi');
        assert.ok(throwsCls(() => new FastBit64(np)) instanceof RangeError, 'ctor');
        expectThrow(x, () => x.fromArray(np), TypeError, 'fromArray container');
        expectThrow(x, () => x.saveInto(new Int32Array(3), np), TypeError, 'saveInto offset');
    });
});

describe('FastBit64 qa A -- self-aliasing and a second module copy', () => {
    it('x.op(x) for all 10 cross-set methods, on out-of-Smi, empty and full sets', () => {
        for (const [lo, hi] of [[0, 0], [-1, -1], ...OOS]) {
            const ref = new FastBit64(lo, hi), c = ref.count(), mk = () => new FastBit64(lo, hi);
            let x;
            x = mk(); assert.equal(x.hasAll(x), true); assert.equal(x.isSubsetOf(x), true); assert.equal(x.equals(x), true);
            assert.equal(x.hasAny(x), c > 0); assert.equal(x.hasNone(x), c === 0); assert.equal(x.countMasked(x), c);
            for (const n of ['union', 'intersect', 'copy']) { x = mk(); assert.equal(x[n](x), x); assert.equal(snap(x), snap(ref), n + ' self'); }
            x = mk(); assert.equal(x.difference(x), x); assert.equal(snap(x), '0:0', 'difference self');
            assert.equal(CROSS.length, 10);
        }
    });
    it('a FastBit64 from another module copy (PRE-PC) is a TypeError as `other`, both ways; nothing written', () => {
        assert.equal(prepcErr, null, String(prepcErr));
        for (const n of CROSS) {
            const x = new FastBit64(0x40000000, MIN), o = new PrePC(-1, -1);
            expectThrow(x, () => x[n](o), TypeError, 'live.' + n + '(prepc)');
            expectThrow(o, () => o[n](x), TypeError, 'prepc.' + n + '(live)');
        }
    });
});

describe('FastBit64 qa A -- re-entrant writes during a call', () => {
    it('an index valueOf that mutates the receiver: RangeError, and the method itself writes nothing', () => {
        for (const name of [...IDX1, 'nextSetBit', 'prevSetBit', 'addRange', 'removeRange', 'countRange']) {
            const x = new FastBit64(1, 1);
            const evil = { valueOf() { x.setWords(0x40000000, MIN); return 3; } };
            const args = RANGE.includes(name) ? [evil, 5] : [evil];
            const e = throwsCls(() => x[name](...args));
            assert.ok(e instanceof RangeError, name + ': ' + (e && e.name));
            assert.equal(snap(x), 0x40000000 + ':' + MIN, name + ': state is exactly what valueOf wrote');
        }
    });
    it('fromArray: an element getter that rewrites the receiver is overwritten by the single final write', () => {
        const x = new FastBit64(0, 0), arr = [1, 2, 40];
        Object.defineProperty(arr, 1, { get() { x.setWords(-1, -1); return 2; } });
        x.fromArray(arr);
        assert.equal(snap(x), (2 + 4) + ':' + (1 << 8));
    });
    it('forEach: a callback that clears / fills / toggles the set terminates, ascends, and visits a subset of 0..63', () => {
        for (const mut of ['clear', 'fill', 'toggleNext', 'removeHi']) {
            for (const [lo, hi] of [[-1, -1], ...OOS]) {
                const x = new FastBit64(lo, hi), seen = [], first = x.lowest();
                let n = 0;
                const r = x.forEach((b) => {
                    seen.push(b);
                    if (++n > 200) throw new Error('runaway');
                    if (mut === 'clear') x.clear(); else if (mut === 'fill') x.setWords(-1, -1);
                    else if (mut === 'toggleNext') x.toggle((b + 1) & 63); else x.setWords(x.lo, 0);
                });
                assert.equal(r, x);
                assert.equal(seen[0], first, mut + ' first visit');
                for (let i = 1; i < seen.length; i++) assert.ok(seen[i] > seen[i - 1], mut + ' ascending ' + seen);
                for (const b of seen) assert.ok(b >= 0 && b <= 63);
            }
        }
    });
    it('duplicate clear and fromArray of every length edge: 0, 63, 64, 65 (duplicate)', () => {
        const x = new FastBit64(0x40000000, MIN);
        assert.equal(x.clear().clear(), x); assert.equal(snap(x), '0:0');
        const all = Array.from({ length: 64 }, (_, i) => i);
        assert.equal(snap(new FastBit64(5, 5).fromArray([])), '0:0');
        assert.equal(snap(new FastBit64(5, 5).fromArray(new Int32Array(0))), '0:0');
        assert.equal(snap(new FastBit64().fromArray(all.slice(0, 63))), '-1:' + MAX);
        assert.equal(snap(new FastBit64().fromArray(all.slice(1))), '-2:-1');
        assert.equal(snap(new FastBit64().fromArray(all)), '-1:-1');
        assert.equal(snap(new FastBit64().fromArray(all.concat([63]))), '-1:-1');
        assert.equal(snap(new FastBit64().fromArray(Int32Array.from(all.concat([0])))), '-1:-1');
    });
});

describe('FastBit64 qa A -- clone / copy independence, both directions, both words', () => {
    it('mutating the source after clone / copy never moves the copy, and vice versa', () => {
        for (const [lo, hi] of OOS) {
            const x = new FastBit64(lo, hi), c = x.clone(), y = new FastBit64().copy(x), s0 = snap(x);
            x.toggle(3).toggle(40);
            assert.equal(snap(c), s0, 'clone moved with source'); assert.equal(snap(y), s0, 'copy moved with source');
            c.toggle(31).toggle(63); y.add(30).add(62).remove(31);
            assert.equal(snap(x), new FastBit64(lo, hi).toggle(3).toggle(40).lo + ':' + new FastBit64(lo, hi).toggle(3).toggle(40).hi, 'source moved with a copy');
            assert.notEqual(snap(c), snap(y));
        }
    });
});

describe('FastBit64 qa A -- detached and cross-realm buffers', () => {
    const detached = () => { const a = new Int32Array(8); structuredClone(a.buffer, { transfer: [a.buffer] }); return a; };
    it('a detached Int32Array: saveInto / loadFrom / deserialize are RangeErrors, nothing written', () => {
        const x = new FastBit64(0x40000000, MIN), d = detached();
        assert.equal(d.length, 0);
        expectThrow(x, () => x.saveInto(d, 0), RangeError, 'saveInto detached');
        expectThrow(x, () => x.loadFrom(d, 0), RangeError, 'loadFrom detached');
        assert.ok(throwsCls(() => FastBit64.deserialize(d)) instanceof RangeError, 'deserialize detached');
    });
    it('fromArray(detached Int32Array) reads length 0 and clears (observed; Array.from(detached) is [] too)', () => {
        assert.equal(snap(new FastBit64(-1, -1).fromArray(detached())), '0:0');
    });
    it('a cross-realm Int32Array gets the same error class from FastBit64 and FastBit1024(64) (fail closed)', () => {
        const foreign = vm.runInNewContext('new Int32Array(8)');
        const x = new FastBit64(0x40000000, MIN), g = new FastBit1024(64);
        const e64s = throwsCls(() => x.saveInto(foreign, 0)), e1024s = throwsCls(() => g.saveInto(foreign, 0));
        const e64l = throwsCls(() => x.loadFrom(foreign, 0)), e1024l = throwsCls(() => g.loadFrom(foreign, 0));
        assert.ok(e64s instanceof TypeError, 'FastBit64.saveInto cross-realm: ' + (e64s && e64s.name));
        assert.ok(e64l instanceof TypeError, 'FastBit64.loadFrom cross-realm: ' + (e64l && e64l.name));
        assert.equal(e64s && e64s.constructor, e1024s && e1024s.constructor, 'saveInto class vs FastBit1024');
        assert.equal(e64l && e64l.constructor, e1024l && e1024l.constructor, 'loadFrom class vs FastBit1024');
        assert.equal(snap(x), 0x40000000 + ':' + MIN);
        assert.deepEqual(Array.from(foreign), new Array(8).fill(0));
    });
});
