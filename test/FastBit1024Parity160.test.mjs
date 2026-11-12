// test/FastBit1024Parity160.test.mjs -- 1.6.0 parity suite (SPEC C-6, G1-7).
// The tree is compared with the published 1.5.0 body, `git show cd49e4d:FastBit32.js`
// (pinned by commit so the check survives the release commit). Fails closed if git
// cannot produce the base. Under GIT_DIR=<real .git> this also runs in a scratch
// copy of the tree (the "before build" teeth run).
//   (a) the bytes before the `// -- FastBit1024 --` marker are equal (VERSION line normalized);
//   (b) Function#toString is equal for every 1.5.0 function, class and member except
//       FastBit1024#hasAll / #hasAny (their guard changes by design);
//   (c) BASE exports and members are a subset of the tree's, same kind (data, method,
//       getter / setter presence) and arity -- the subset, not an exact list; the
//       1.6.0 additions are pinned separately as HEAD-only;
//   (d) a seeded differential over caps [1,31,32,33,64,500,1023,1024]: return value,
//       error class + message, callback log and the receiver's public state;
//   (e) the ONE intended difference: a forgery / a Proxy of a real set -- BASE answers,
//       the tree throws TypeError 'FastBit1024: expected a FastBit1024, got object'.
// Expected values come from the SPEC, or are derived by hand (see each comment);
// the differential's oracle is the BASE build itself.
// PATCHES (below) are the maintainer-ruled changes applied to the BASE side of (a) / (b); nothing else is accepted:
// the 1.6.1 T6-FIX2 (highest() `| 0`, never boxes) and the two AF-1 edits that fall in this suite's scope
// (test/fixtures/af1-patches.mjs: U-2 header :8, U-3 countRange :205; the AF-1 acquire JSDoc / saveInto edits are
// past the FastBit1024 marker and outside 1.5.0's member set). (a) applies them count-checked (each `from` exactly once).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as NEW from '../FastBit32.js';
import { AF1_HEADER, AF1_COUNTRANGE, applyExact, applyAtMostOnce } from './fixtures/af1-patches.mjs';

const ROOT = new URL('../', import.meta.url);
const BASE = 'cd49e4d';
const MARK = '// -- FastBit1024 --';
let baseSrc = null, OLD = null, baseErr = null;
try {
    baseSrc = execFileSync('git', ['show', BASE + ':FastBit32.js'], { cwd: fileURLToPath(ROOT), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (!baseSrc.includes("export const VERSION = '1.5.0';")) throw new Error('base is not the 1.5.0 body');
    OLD = await import('data:text/javascript;base64,' + Buffer.from(baseSrc).toString('base64'));
} catch (e) { baseErr = e; }
const headSrc = readFileSync(new URL('../FastBit32.js', import.meta.url), 'utf8');

const norm = (s) => s.replace(/export const VERSION = '[^']*';/, 'export const VERSION = X;');
const PATCHES = [['return 31 - Math.clz32(this.value);', 'return 31 - Math.clz32(this.value | 0);', '1.6.1 T6-FIX2: highest() never boxes (HighestParity161.test.mjs proves identical results)'],
    AF1_HEADER, AF1_COUNTRANGE];   // AF-1 re-pin (U-2, U-3): AF1Parity.test.mjs proves countRange results identical
const patched = (text) => applyAtMostOnce(text, PATCHES);
const SKIP = new Set(['FastBit1024.hasAll', 'FastBit1024.hasAny']);

function kind(d) {
    if (!d) return 'absent';
    if ('value' in d) return typeof d.value === 'function' ? 'method' : 'data:' + typeof d.value;
    return 'accessor:' + (d.get ? 'get' : '') + (d.set ? 'set' : '');
}
// own members of a class: prototype + statics, constructor excluded
function members(M, cname) {
    const C = M[cname], out = new Map();
    for (const [holder, tag] of [[C.prototype, 'p'], [C, 's']]) {
        for (const n of Reflect.ownKeys(holder)) {
            if (n === 'constructor' || (tag === 's' && (n === 'length' || n === 'name' || n === 'prototype'))) continue;
            out.set(tag + ':' + String(n), Object.getOwnPropertyDescriptor(holder, n));
        }
    }
    return out;
}
function fnTexts(d) {
    if (!d) return [];
    return 'value' in d ? [typeof d.value === 'function' ? d.value.toString() : String(d.value)] : [d.get && d.get.toString(), d.set && d.set.toString()];
}
function arities(d) {
    if (!d) return [];
    return 'value' in d ? [typeof d.value === 'function' ? d.value.length : -1] : [d.get && d.get.length, d.set && d.set.length];
}

describe('FastBit1024 1.5.0 -> tree parity (base ' + BASE + ')', () => {
    it('the base is available', () => { assert.strictEqual(baseErr, null, String(baseErr)); });

    it('(a0) every PATCHES from occurs once in the base prefix; every to once (from zero times) in the head prefix', () => {
        const bp = baseSrc.slice(0, baseSrc.indexOf(MARK)), hp = headSrc.slice(0, headSrc.indexOf(MARK));
        for (const [from, to, why] of PATCHES) {
            assert.strictEqual(bp.split(from).length - 1, 1, 'base: from x1 -- ' + why);
            assert.strictEqual(hp.split(to).length - 1, 1, 'head: to x1 -- ' + why);
            assert.strictEqual(hp.split(from).length - 1, 0, 'head: from x0 -- ' + why);
        }
    });

    it('(a) bytes before the FastBit1024 marker are equal (VERSION line normalized)', () => {
        const bi = baseSrc.indexOf(MARK), hi = headSrc.indexOf(MARK);
        assert.ok(bi > 0 && hi > 0);
        assert.strictEqual(headSrc.indexOf(MARK, hi + 1), -1);
        assert.strictEqual(norm(headSrc.slice(0, hi)), norm(applyExact(baseSrc.slice(0, bi), PATCHES)));
    });

    it('(b) Function#toString equal for every 1.5.0 export and member except hasAll / hasAny', () => {
        let checked = 0;
        for (const [name, v] of Object.entries(OLD)) {
            if (typeof v !== 'function') continue;
            if (name !== 'FastBit1024') { assert.strictEqual(NEW[name].toString(), patched(v.toString()), name); checked++; }
        }
        for (const cname of ['FastBit32', 'BitMapper', 'FastBit1024']) {
            for (const [key, d] of members(OLD, cname)) {
                const id = cname + '.' + key.slice(2);
                if (SKIP.has(id)) continue;
                const nd = members(NEW, cname).get(key);
                assert.deepStrictEqual(fnTexts(nd), fnTexts(d).map((t) => (typeof t === 'string' ? patched(t) : t)), id);
                checked++;
            }
        }
        // the FastBit1024 constructor body (the class text itself grows): sliced from the source
        const ctor = (s) => { const i = s.indexOf('    constructor(capacity = 1024) {'); return s.slice(i, s.indexOf('    add(bit) {', i)); };
        assert.strictEqual(ctor(headSrc), ctor(baseSrc));
        assert.ok(checked > 60, 'checked ' + checked);
    });

    it('(b2) hasAll / hasAny are the two members that DO differ (the brand guard)', () => {
        for (const n of ['hasAll', 'hasAny']) {
            assert.notStrictEqual(NEW.FastBit1024.prototype[n].toString(), OLD.FastBit1024.prototype[n].toString(), n);
        }
    });

    it('(c) base exports and members are a subset of the tree: same kind (accessors included) and arity', () => {
        for (const [name, v] of Object.entries(OLD)) {
            assert.ok(name in NEW, 'export ' + name);
            assert.strictEqual(typeof NEW[name], typeof v, name);
        }
        let n = 0;
        for (const cname of ['FastBit32', 'BitMapper', 'FastBit1024']) {
            const nm = members(NEW, cname);
            for (const [key, d] of members(OLD, cname)) {
                const nd = nm.get(key);
                assert.ok(nd, cname + ' ' + key + ' missing');
                assert.strictEqual(kind(nd), kind(d), cname + ' ' + key);
                assert.deepStrictEqual(arities(nd), arities(d), cname + ' ' + key);
                assert.strictEqual(nd.enumerable, d.enumerable, cname + ' ' + key);
                n++;
            }
            assert.strictEqual(NEW[cname].length, OLD[cname].length, cname + ' ctor arity');
        }
        // the base's accessors are really covered (size, capacity at least)
        assert.strictEqual(kind(members(OLD, 'FastBit1024').get('p:size')), 'accessor:get');
        assert.strictEqual(kind(members(OLD, 'FastBit1024').get('p:capacity')), 'accessor:get');
        assert.ok(n > 60, 'compared ' + n);
    });

    // HEAD-only: the 1.6.0 L1 + L2 members (SPEC: PROPOSAL s1 + C-13); fails on the 1.5.0 build.
    it('(c2) HEAD-only: the 14 L1 + L2 + L3 members exist with the spec kind and arity', () => {
        const nm = members(NEW, 'FastBit1024');
        assert.strictEqual(kind(nm.get('p:imageLength')), 'accessor:get');
        assert.strictEqual(nm.get('p:imageLength').set, undefined);
        const want = { 'p:saveInto': 1, 'p:loadFrom': 1, 'p:serialize': 0, 'p:copy': 1, 'p:clone': 0, 'p:equals': 1, 's:deserialize': 1,
            'p:prevSetBit': 1, 'p:intersectionSize': 1, 'p:unionSize': 1, 'p:differenceSize': 1, 'p:addRange': 2, 'p:removeRange': 2 };
        for (const [k, len] of Object.entries(want)) {
            assert.strictEqual(kind(nm.get(k)), 'method', k);
            assert.strictEqual(nm.get(k).value.length, len, k);
        }
        // exactly these were added to FastBit1024 so far: eight in L1, four in L2, two in L3
        const added = [...nm.keys()].filter((k) => !members(OLD, 'FastBit1024').has(k)).sort();
        assert.deepStrictEqual(added, ['p:clone', 'p:copy', 'p:differenceSize', 'p:equals', 'p:imageLength', 'p:intersectionSize', 'p:loadFrom', 'p:prevSetBit', 'p:saveInto', 'p:removeRange', 'p:serialize', 'p:unionSize', 's:deserialize', 'p:addRange'].sort());
    });
});

// ---- (d) seeded differential ---------------------------------------------------
// 32-bit xorshift (Marsaglia 13/17/5), seeded; the op stream and the argument
// stream are independent generators (different seeds), as is the pool-fill stream.
function xs(seed) {
    let s = seed >>> 0 || 1;
    return (n) => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s % n; };
}
const CAPS = [1, 31, 32, 33, 64, 500, 1023, 1024];
const POOL_CAPS = [1, 33, 500, 1024];
const STEPS = 1500;
const OPS = ['add', 'remove', 'toggle', 'has', 'acquire', 'release', 'size', 'capacity', 'isEmpty', 'isFull', 'lowest', 'highest',
    'nextClearBit', 'nextSetBit', 'forEach', 'clear', 'hasAll', 'hasAny'];
const SPECIAL = [1.5, NaN, undefined, null, '3', true, 1024, 2048, 4294967296, -0, 'OBJ', 'SYM', 'BIG', 2 ** 53, -2147483649];
const OTHERS = ['P0', 'P1', 'P2', 'P3', 'SUB', 'SELF', 'NULL', 'UNDEF', 42, 'x', 'OBJ', 'FB32', 'SYM', 'EMPTY'];

function snapState(s) { return JSON.stringify([s._cap, s._active, s._full, s._n, Array.from(s._data)]); }
function show(r, recv) {
    if (r === recv) return 'this';
    if (typeof r === 'number') return Object.is(r, -0) ? 'n:-0' : 'n:' + r;
    return typeof r + ':' + String(r);
}
function build(M, cap, fillSeed) {
    const fill = xs(fillSeed);
    const mk = (C, c) => { const s = new C(c); const k = fill(c + 1); for (let i = 0; i < k; i++) s.add(fill(c)); return s; };
    class Sub extends M.FastBit1024 {}
    const pool = POOL_CAPS.map((c) => mk(M.FastBit1024, c));
    return { recv: new M.FastBit1024(cap), pool, sub: mk(Sub, 64), fb32: new M.FastBit32(0x0F0F0F0F), M };
}
function resolve(ctx, tok) {
    if (typeof tok !== 'string') return tok;
    if (tok.length === 2 && tok[0] === 'P') return ctx.pool[+tok[1]];
    switch (tok) {
        case 'SUB': return ctx.sub;
        case 'SELF': return ctx.recv;
        case 'NULL': return null;
        case 'UNDEF': return undefined;
        case 'OBJ': return {};
        case 'SYM': return Symbol('s');
        case 'BIG': return 5n;
        case 'FB32': return ctx.fb32;
        case 'EMPTY': return new ctx.M.FastBit1024(7);
        default: return tok;
    }
}
function apply(ctx, op, tok) {
    const log = [];
    let res;
    try {
        const r = ctx.recv;
        const arg = resolve(ctx, tok);
        if (op === 'size' || op === 'capacity') res = r[op];
        else if (op === 'forEach') res = r.forEach((b) => log.push(b));
        else if (op === 'acquire' || op === 'isEmpty' || op === 'isFull' || op === 'lowest' || op === 'highest' || op === 'nextClearBit' || op === 'clear') res = r[op]();
        else res = r[op](arg);
        res = show(res, r);
    } catch (e) { res = 'throw:' + e.constructor.name + ':' + e.message; }
    return res + ' | ' + JSON.stringify(log);
}

describe('(d) seeded differential vs the 1.5.0 body', () => {
    it('same return, error class + message, callback log and public state over 8 caps (> 2,000 comparisons, 0 diffs)', () => {
        let comparisons = 0, diffs = 0;
        const cov = { threw: 0, typeErr: 0, rangeErr: 0, hasAllTrue: 0, hasAllFalse: 0, hasAnyTrue: 0, hasAnyFalse: 0, acquireOk: 0, releaseOk: 0, nextHit: 0, forEachNonEmpty: 0 };
        const perOp = Object.fromEntries(OPS.map((o) => [o, 0]));
        let first = null;
        for (let ci = 0; ci < CAPS.length; ci++) {
            const cap = CAPS[ci];
            const opR = xs(0x2545f491 + ci), argR = xs(0x9e3779b9 + ci);   // independent streams
            const A = build(OLD, cap, 0x1234567 + ci), B = build(NEW, cap, 0x1234567 + ci);
            for (let step = 0; step < STEPS; step++) {
                const op = OPS[opR(OPS.length)];
                let tok;
                if (op === 'hasAll' || op === 'hasAny') tok = OTHERS[argR(OTHERS.length)];
                else {
                    const k = argR(100);
                    // in-range bits dominate; the rest probes the edges and the fail-closed values
                    tok = k < 62 ? argR(cap) : k < 72 ? cap + argR(3) : k < 78 ? -1 : k < 82 ? argR(cap + 1) : SPECIAL[argR(SPECIAL.length)];
                }
                const ra = apply(A, op, tok), rb = apply(B, op, tok);
                const sa = snapState(A.recv), sb = snapState(B.recv);
                comparisons += 2;
                perOp[op]++;
                if (ra !== rb || sa !== sb) { diffs++; if (!first) first = { cap, step, op, tok: String(tok), ra, rb }; }
                if (ra.startsWith('throw:')) { cov.threw++; if (ra.startsWith('throw:TypeError')) cov.typeErr++; if (ra.startsWith('throw:RangeError')) cov.rangeErr++; }
                if (op === 'hasAll') ra.startsWith('boolean:true') ? cov.hasAllTrue++ : ra.startsWith('boolean:false') && cov.hasAllFalse++;
                if (op === 'hasAny') ra.startsWith('boolean:true') ? cov.hasAnyTrue++ : ra.startsWith('boolean:false') && cov.hasAnyFalse++;
                if (op === 'acquire' && ra.startsWith('n:') && !ra.startsWith('n:-1')) cov.acquireOk++;
                if (op === 'release' && ra.startsWith('this')) cov.releaseOk++;
                if (op === 'nextSetBit' && ra.startsWith('n:') && !ra.startsWith('n:-1')) cov.nextHit++;
                if (op === 'forEach' && !ra.endsWith('| []')) cov.forEachNonEmpty++;
            }
        }
        assert.strictEqual(diffs, 0, JSON.stringify(first));
        assert.ok(comparisons > 2000, 'comparisons ' + comparisons);
        // coverage floor: every op ran, and both outcomes of the interesting ones occurred
        for (const o of OPS) assert.ok(perOp[o] >= 100, o + ' ran ' + perOp[o]);
        for (const [k, floor] of Object.entries({ threw: 1000, typeErr: 100, rangeErr: 300, hasAllTrue: 20, hasAllFalse: 20, hasAnyTrue: 20, hasAnyFalse: 20, acquireOk: 100, releaseOk: 20, nextHit: 100, forEachNonEmpty: 100 })) {
            assert.ok(cov[k] >= floor, k + ' ' + cov[k] + ' < ' + floor);
        }
        console.log('# parity (d): ' + comparisons + ' comparisons, ' + diffs + ' diffs, cov ' + JSON.stringify(cov));
    });
});

// ---- (e) the one intended difference ------------------------------------------
const BRAND_MSG = 'FastBit1024: expected a FastBit1024, got object';
function forgery(M) {
    const f = Object.create(M.FastBit1024.prototype);
    f._cap = 1024; f._active = 0; f._full = 0; f._n = 0; f._data = new Int32Array(32);
    return f;
}
function proxyOf(M, bits) {
    const s = new M.FastBit1024(500);
    for (const b of bits) s.add(b);
    return new Proxy(s, {});
}
describe('(e) hasAll / hasAny with a forgery or a Proxy of a real set', () => {
    // By hand: an empty `other` is a subset of anything (hasAll true) and meets nothing (hasAny false).
    it('BASE answers (no throw): forgery of the empty set', () => {
        const r = new OLD.FastBit1024(100); r.add(5);
        assert.strictEqual(r.hasAll(forgery(OLD)), true);
        assert.strictEqual(r.hasAny(forgery(OLD)), false);
    });
    // By hand: other = {3, 70}; receiver {3, 5, 70} contains both, receiver {5} neither.
    it('BASE answers (no throw): Proxy of a real set', () => {
        const big = new OLD.FastBit1024(500); big.add(3); big.add(5); big.add(70);
        const small = new OLD.FastBit1024(500); small.add(5);
        assert.strictEqual(big.hasAll(proxyOf(OLD, [3, 70])), true);
        assert.strictEqual(big.hasAny(proxyOf(OLD, [3, 70])), true);
        assert.strictEqual(small.hasAll(proxyOf(OLD, [3, 70])), false);
        assert.strictEqual(small.hasAny(proxyOf(OLD, [3, 70])), false);
    });
    // Fails on the 1.5.0 build (it answers instead of throwing).
    it('HEAD throws TypeError with the brand message, for hasAll and hasAny, receiver unchanged', () => {
        const r = new NEW.FastBit1024(100); r.add(5);
        const before = snapState(r);
        for (const make of [() => forgery(NEW), () => proxyOf(NEW, [3, 70])]) {
            for (const m of ['hasAll', 'hasAny']) {
                assert.throws(() => r[m](make()), (e) => e instanceof TypeError && e.message === BRAND_MSG, m);
            }
        }
        assert.strictEqual(snapState(r), before);
    });
    // Fails on the 1.5.0 build (no copy / equals there: a different TypeError message).
    it('HEAD: copy / equals use the same brand and message', () => {
        const r = new NEW.FastBit1024(100); r.add(5);
        const before = snapState(r);
        for (const make of [() => forgery(NEW), () => proxyOf(NEW, [3])]) {
            for (const m of ['copy', 'equals']) {
                assert.throws(() => r[m](make()), (e) => e instanceof TypeError && e.message === BRAND_MSG, m);
            }
        }
        assert.strictEqual(snapState(r), before);
    });
    // Regression pin: primitives keep the 1.5.0 messages (the guard screens them before `#brand in`).
    it('HEAD: primitives and null keep the 1.5.0 messages, not V8\'s "Cannot use \'in\'"', () => {
        const r = new NEW.FastBit1024(100), o = new OLD.FastBit1024(100);
        for (const v of [null, undefined, 42, 'x', true, 5n, Symbol('s')]) {
            for (const m of ['hasAll', 'hasAny']) {
                let a, b;
                try { o[m](v); } catch (e) { a = e.constructor.name + ':' + e.message; }
                try { r[m](v); } catch (e) { b = e.constructor.name + ':' + e.message; }
                assert.ok(a && a.startsWith('TypeError:FastBit1024: expected a FastBit1024, got '), a);
                assert.strictEqual(b, a);
            }
        }
    });
});
