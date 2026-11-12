// test/AF1QA.test.mjs -- AF-1 qa boundary suite (written from PLAN-af1 ASSERTIONS 1-2 and
// the U-2 / U-3 / U-5 rulings, independent of the coder's AF1Parity / AF1Receiver).
//
// Rows are labelled:
//   [CHANGE] the AF-1 behaviour change; FAILS on the pre-AF-1 build (de9a5d9 / 95ab856e).
//   [PIN]    holds on both builds; teeth come from an independent oracle (named per row).
// The base build is `git show de9a5d9:FastBit32.js` written to a temp dir (fails closed);
// it is the oracle only for parity rows, never for the [CHANGE] values, which are literals.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as LIVE from '../FastBit32.js';

const BASE = 'de9a5d9';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIVE_SRC = readFileSync(join(ROOT, 'FastBit32.js'), 'utf8');
let baseSrc = '';
try {
    baseSrc = execFileSync('git', ['show', BASE + ':FastBit32.js'], { cwd: ROOT, encoding: 'utf8' });
} catch (e) {
    assert.fail('git show ' + BASE + ':FastBit32.js failed: ' + e.message);
}
assert.ok(baseSrc.length > 1000 && /class FastBit1024/.test(baseSrc), 'base text must be the FastBit32.js body');
const TMP = mkdtempSync(join(tmpdir(), 'af1-qa-'));
let OLD;
before(async () => {
    writeFileSync(join(TMP, 'base.mjs'), baseSrc);
    OLD = await import(pathToFileURL(join(TMP, 'base.mjs')).href);
});
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const U32 = 2 ** 32;

// ---------------------------------------------------------------- U-2 header wording
const RULED_U2 = 'converted to 32-bit integers: `value` is int32 after any bit mutator or `set`; '
    + 'uint32 straight from the constructor / `clone` / `fromArray` / `deserialize` (FB-03); '
    + '`copy` stores `other.value` as-is. Compare with `equalsValue` or `>>> 0`.';
const OLD_U2 = 'converted to unsigned 32-bit integers';

function headerText(src) {
    const end = src.indexOf('*/');
    assert.ok(src.startsWith('/**') && end > 0, 'file must open with a /** header block');
    return src.slice(3, end).split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join(' ').replace(/\s+/g, ' ');
}

describe('AF-1 U-2: header wording and the behaviour behind each clause', () => {
    test('[CHANGE] header carries the ruled U-2 sentence (whitespace-normalised), once', () => {
        const h = headerText(LIVE_SRC);
        assert.equal(h.split(RULED_U2).length - 1, 1, 'ruled U-2 sentence must appear exactly once in the header');
        assert.equal(h.includes(OLD_U2), false, 'the false "unsigned" wording must be gone');
        assert.ok(h.includes('TRUNCATION: Floats and negative numbers are silently truncated and ' + RULED_U2));
    });

    // Oracle for every behaviour row: literal expected values (no build is consulted).
    const HI = [0x80000000, 0xFFFFFFFF, 0xDEADBEEF, 2 ** 31 + 1];
    test('[PIN] constructor / clone / deserialize / fromArray give uint32 (>= 2^31 stays positive)', () => {
        for (const w of HI) {
            assert.equal(new LIVE.FastBit32(w).value, w, 'ctor ' + w);
            assert.equal(new LIVE.FastBit32(w | 0).value, w, 'ctor of int32 ' + (w | 0));
            assert.equal(new LIVE.FastBit32(w | 0).clone().value, w, 'clone');
            assert.equal(new LIVE.FastBit32(0).set(w).clone().value, w, 'clone of an int32 word re-normalises');
            assert.equal(LIVE.FastBit32.deserialize(w | 0).value, w, 'deserialize');
        }
        assert.equal(new LIVE.FastBit32(-1).value, 4294967295);
        assert.equal(new LIVE.FastBit32(0).fromArray([31]).value, 2147483648);
        assert.equal(new LIVE.FastBit32(0).fromArray([0, 31]).value, 2147483649);
        assert.equal(new LIVE.FastBit32(0).fromArray([]).value, 0);
    });

    test('[PIN] every bit mutator and set give int32 (bit 31 reads negative)', () => {
        const F = () => new LIVE.FastBit32(0xFFFFFFFF);
        assert.equal(new LIVE.FastBit32(0).add(31).value, -2147483648, 'add');
        assert.equal(F().remove(0).value, -2, 'remove');
        assert.equal(new LIVE.FastBit32(0).toggle(31).value, -2147483648, 'toggle');
        assert.equal(new LIVE.FastBit32(0).union(-1).value, -1, 'union(-1)');
        assert.equal(new LIVE.FastBit32(0).union(0xFFFFFFFF).value, -1, 'union(uint32)');
        const d = F(); d.difference(1); assert.equal(d.value, -2, 'difference');
        const i = F(); i.intersect(0x80000000); assert.equal(i.value, -2147483648, 'intersect');
        assert.equal(new LIVE.FastBit32(0).set(0xFFFFFFFF).value, -1, 'set(uint32)');
        assert.equal(new LIVE.FastBit32(0).set(2 ** 31).value, -2147483648, 'set(2^31)');
        assert.equal(new LIVE.FastBit32(0).set(U32).value, 0, 'set(2^32)');
        assert.equal(F().add(0).value, -1, 'add on a uint32 word yields int32');
    });

    test('[PIN] copy stores other.value as-is (int32 AND uint32 source)', () => {
        assert.equal(new LIVE.FastBit32(5).copy(new LIVE.FastBit32(0).union(-1)).value, -1, 'int32 source');
        assert.equal(new LIVE.FastBit32(5).copy(new LIVE.FastBit32(-1)).value, 4294967295, 'uint32 source');
        assert.equal(new LIVE.FastBit32(5).copy({ value: 2 ** 53 }).value, 2 ** 53, 'not normalised at all');
    });

    test('[PIN] equalsValue agrees across signedness', () => {
        const u = new LIVE.FastBit32(0xFFFFFFFF), s = new LIVE.FastBit32(0).union(-1);
        assert.notEqual(u.value, s.value);
        for (const x of [-1, 0xFFFFFFFF]) {
            assert.equal(u.equalsValue(x), true, 'uint32 word vs ' + x);
            assert.equal(s.equalsValue(x), true, 'int32 word vs ' + x);
        }
        assert.equal(new LIVE.FastBit32(0x80000000).equalsValue(-2147483648), true);
        assert.equal(new LIVE.FastBit32(0).add(31).equalsValue(2147483648), true);
        assert.equal(u.equalsValue(0x7FFFFFFF), false);
        assert.equal(u.value >>> 0, s.value >>> 0, 'the `>>> 0` compare the header names');
    });
});

// ---------------------------------------------------------------- U-3 countRange
function capClass(M) {
    return class Cap extends M.FastBit32 {
        constructor(v) { super(v); this.masks = []; }
        countMasked(m) { this.masks.push(m); return super.countMasked(m); }
    };
}
function oracleMask(s, e) { let m = 0; for (let b = s; b <= e; b++) m |= 1 << b; return m; }
function oracleCount(v, s, e) { let c = 0; for (let b = s; b <= e; b++) if (((v >>> b) & 1) === 1) c++; return c; }
const CTOR_W = [0, 1, 0xFFFFFFFF, 0x80000000, 0x7FFFFFFF, 0x40000000, 0xC0000001, 0xA5A5A5A5, 0xDEADBEEF];
const UNION_W = CTOR_W.map((w) => w | 0);

describe('AF-1 U-3: countRange boundaries and the signed mask', () => {
    test('[PIN] every legal (start, end): count === bit-loop oracle; mask === bit-loop oracle mask', () => {
        const Cap = capClass(LIVE);
        let rows = 0;
        for (const [tag, words, mk] of [['ctor', CTOR_W, (w) => new Cap(w)], ['union', UNION_W, (w) => new Cap(0).union(w)]]) {
            for (const w of words) {
                const f = mk(w);
                for (let s = 0; s <= 31; s++) for (let e = s; e <= 31; e++) {
                    rows++;
                    assert.equal(f.countRange(s, e), oracleCount(w, s, e), tag + ' ' + w + ' (' + s + ', ' + e + ')');
                    assert.equal(f.masks.pop() >>> 0, oracleMask(s, e) >>> 0, 'mask bits (' + s + ', ' + e + ')');
                }
            }
        }
        assert.equal(rows, 2 * CTOR_W.length * 528);
    });

    test('[PIN] named boundaries on ctor uint32 and union int32 words (start === end, (0,31), (31,31), (0,0))', () => {
        for (const mk of [(w) => new LIVE.FastBit32(w), (w) => new LIVE.FastBit32(0).union(w | 0)]) {
            const full = mk(0xFFFFFFFF), top = mk(0x80000000), low = mk(1);
            assert.equal(full.countRange(0, 31), 32);
            assert.equal(full.countRange(0, 0), 1);
            assert.equal(full.countRange(31, 31), 1);
            assert.equal(full.countRange(30, 31), 2);
            assert.equal(full.countRange(0, 30), 31);
            assert.equal(top.countRange(31, 31), 1);
            assert.equal(top.countRange(0, 30), 0);
            assert.equal(low.countRange(0, 0), 1);
            assert.equal(low.countRange(1, 31), 0);
            for (let s = 0; s <= 31; s++) assert.equal(full.countRange(s, s), 1, 'start === end ' + s);
        }
    });

    test('[CHANGE] a countMasked override receives the int32 mask: (0,31) -> -1, never 4294967295', () => {
        const Cap = capClass(LIVE);
        const f = new Cap(0xFFFFFFFF);
        const want = [[0, 31, -1], [31, 31, -2147483648], [30, 31, -1073741824], [0, 30, 0x7FFFFFFF], [0, 0, 1], [16, 31, -65536]];
        for (const [s, e, m] of want) {
            f.countRange(s, e);
            assert.ok(Object.is(f.masks.pop(), m), '(' + s + ', ' + e + ') mask must be ' + m);
        }
        for (let s = 0; s <= 31; s++) for (let e = s; e <= 31; e++) {
            f.countRange(s, e);
            const m = f.masks.pop();
            assert.ok(Object.is(m | 0, m), 'mask int32 for (' + s + ', ' + e + '), got ' + m);
        }
    });

    // Boundary matrix (FB-05: countRange has no domain). Values: 0, 1, N-1, N, N+1, -1, 2^30,
    // 2^31-1, 2^31, 2^32-1, 2^32, 2^53-1, 2^53, NaN, -0, null, undefined, '' (empty), 0.5, '31'.
    const V = [0, 1, 30, 31, 32, -1, 2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 53 - 1, 2 ** 53,
        NaN, -0, null, undefined, '', 0.5, '31'];
    test('[PIN] boundary matrix: live count === base count (Object.is), 20 x 20 inputs x 18 words', () => {
        let calls = 0, diffs = 0;
        const words = [...CTOR_W.map((w) => [w, false]), ...UNION_W.map((w) => [w, true])];
        for (const [w, u] of words) {
            const a = u ? new LIVE.FastBit32(0).union(w) : new LIVE.FastBit32(w);
            const b = u ? new OLD.FastBit32(0).union(w) : new OLD.FastBit32(w);
            for (const s of V) for (const e of V) {
                calls++;
                if (!Object.is(a.countRange(s, e), b.countRange(s, e))) diffs++;
            }
        }
        assert.equal(calls, 18 * 400);
        assert.equal(diffs, 0);
    });

    test('[CHANGE] boundary matrix: live mask === ToInt32(base mask) and >>> 0 agrees, every input pair', () => {
        const A = new (capClass(LIVE))(0xFFFFFFFF), B = new (capClass(OLD))(0xFFFFFFFF);
        let neg = 0;
        for (const s of V) for (const e of V) {
            A.countRange(s, e); B.countRange(s, e);
            const a = A.masks.pop(), b = B.masks.pop();
            assert.ok(Object.is(a, b | 0), 'live mask ' + a + ' vs base ' + b + ' at (' + String(s) + ', ' + String(e) + ')');
            assert.equal(a >>> 0, b >>> 0);
            if (b >= 2 ** 31) neg++;
        }
        assert.ok(neg >= 20, 'the matrix must reach base masks >= 2^31 (got ' + neg + ')');
    });

    test('[PIN] re-entrant write: an override that set()s the word before super sees the same result as base', () => {
        const mk = (M) => class R extends M.FastBit32 { countMasked(m) { this.set(this.value ^ 0x80000001); return super.countMasked(m); } };
        const RA = mk(LIVE), RB = mk(OLD);
        for (const w of CTOR_W) for (const [s, e] of [[0, 31], [31, 31], [0, 0], [5, 20]]) {
            const a = new RA(w), b = new RB(w);
            assert.equal(a.countRange(s, e), b.countRange(s, e));
            assert.equal(a.value, b.value);
        }
    });
});

// ---------------------------------------------------------------- U-5 saveInto
const SENT = 0x7EADBEEF;
const MSG = (t) => 'FastBit1024: expected a FastBit1024, got ' + t;
const isRecvErr = (t) => (e) => e instanceof TypeError && e.message === MSG(t);

describe('AF-1 U-5: FastBit1024#saveInto receiver check runs first', () => {
    const save = (r, out, off) => LIVE.FastBit1024.prototype.saveInto.call(r, out, off);

    test('[CHANGE] forged receiver + bad `out` throws the RECEIVER TypeError; a typed `out` stays untouched', () => {
        const bad = [undefined, null, [], { length: 40 }, new Float64Array(40), new Int16Array(80),
            new DataView(new ArrayBuffer(160))];
        const u32 = new Uint32Array(40).fill(SENT);
        bad.push(u32);
        for (const out of bad) {
            assert.throws(() => save({ _cap: 64 }, out, 0), isRecvErr('object'), 'out ' + Object.prototype.toString.call(out));
        }
        assert.ok(u32.every((x) => x === SENT));
        const outHits = [], oh = {};
        for (const k of ['get', 'has', 'getPrototypeOf', 'getOwnPropertyDescriptor', 'set', 'ownKeys', 'defineProperty']) oh[k] = (...a) => { outHits.push(k); return Reflect[k](...a); };
        assert.throws(() => save({ _cap: 64 }, new Proxy(new Int32Array(40), oh), 0), isRecvErr('object'));
        assert.deepEqual(outHits, [], 'out must not be read before the receiver check');
    });

    test('[CHANGE] forged receiver + bad offset throws the receiver TypeError; offset is never coerced', () => {
        let coerced = 0;
        const evil = { valueOf() { coerced++; return 0; } };
        for (const off of [-1, 2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 53 - 1, 2 ** 53, NaN, 0.5, '1', 39, 40, evil]) {
            const out = new Int32Array(40).fill(SENT);
            assert.throws(() => save({}, out, off), isRecvErr('object'), 'offset ' + String(off));
            assert.ok(out.every((x) => x === SENT));
        }
        assert.equal(coerced, 0, 'the offset valueOf must not run before the receiver check');
    });

    test('[CHANGE] adversarial: a Proxy of a real set is rejected with ZERO trap calls', () => {
        const real = new LIVE.FastBit1024(64); real.add(1);
        const hits = [];
        const h = {};
        for (const k of ['get', 'has', 'getPrototypeOf', 'getOwnPropertyDescriptor', 'set', 'ownKeys']) {
            h[k] = (...a) => { hits.push(k); return Reflect[k](...a); };
        }
        const out = new Int32Array(40).fill(SENT);
        assert.throws(() => save(new Proxy(real, h), out, 0), isRecvErr('object'));
        assert.deepEqual(hits, []);
        assert.ok(out.every((x) => x === SENT));
    });

    test('[CHANGE] a function receiver and a FastBit1024 from ANOTHER module copy are rejected', () => {
        const out = new Int32Array(40).fill(SENT);
        assert.throws(() => save(function f() {}, out, 0), isRecvErr('function'));
        const foreign = new OLD.FastBit1024(64); foreign.add(2);
        assert.throws(() => save(foreign, out, 0), isRecvErr('object'));
        assert.ok(out.every((x) => x === SENT));
    });

    test('[CHANGE] duplicate rejected save: every repeat throws, out never touched', () => {
        const out = new Int32Array(40).fill(SENT);
        const forged = { _cap: 1024 };
        for (let i = 0; i < 3; i++) assert.throws(() => save(forged, out, i), isRecvErr('object'));
        assert.ok(out.every((x) => x === SENT));
    });

    test('[PIN] real receiver + bad `out` still throws the `out` error (brand passes, order after it unchanged)', () => {
        for (const M of [LIVE, OLD]) {
            const s = new M.FastBit1024(64);
            assert.throws(() => s.saveInto(new Uint32Array(40), 0), (e) => e instanceof TypeError && e.message === 'FastBit1024: out must be an Int32Array');
            assert.throws(() => s.saveInto(null), (e) => e instanceof TypeError && e.message === 'FastBit1024: out must be an Int32Array');
        }
    });

    test('[PIN] subclasses (caps 1, 33, 1024) and a real set with a swapped prototype save the base-class image', () => {
        class S extends LIVE.FastBit1024 { constructor(c) { super(c); this.extra = 1; } }
        for (const cap of [1, 33, 1024]) {
            const s = new S(cap), b = new OLD.FastBit1024(cap);
            for (const bit of [0, cap - 1, cap >>> 1]) { s.add(bit); b.add(bit); }
            const o1 = new Int32Array(40).fill(SENT), o2 = new Int32Array(40).fill(SENT);
            assert.equal(s.saveInto(o1, 3), b.saveInto(o2, 3));
            assert.deepEqual(Array.from(o1), Array.from(o2));
        }
        const r = new LIVE.FastBit1024(64); r.add(63);
        Object.setPrototypeOf(r, Object.prototype);
        const o = new Int32Array(40).fill(SENT);
        assert.equal(save(r, o, 0), 3);
        assert.equal(o[2], -2147483648);
    });

    // Offsets: 0, 1, N-1, N, N+1 (N = the last fitting offset), -1, 2^30, 2^31-1, 2^31, 2^32-1, 2^32,
    // 2^53-1, 2^53, NaN, -0, null, undefined (default), '' , '1', 0.5. Oracle: the base build.
    test('[PIN] real receiver offset matrix: live === base (return or error message, and the whole arena)', () => {
        let rows = 0;
        for (const cap of [1, 31, 32, 33, 1023, 1024]) {
            const L = 1 + ((cap + 31) >>> 5), N = 40 - L;
            const offs = [0, 1, N - 1, N, N + 1, -1, 2 ** 30, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1, 2 ** 32, 2 ** 53 - 1, 2 ** 53,
                NaN, -0, null, undefined, '', '1', 0.5];
            for (const off of offs) {
                const res = [];
                for (const M of [LIVE, OLD]) {
                    const s = new M.FastBit1024(cap); s.add(0).add(cap - 1);
                    const out = new Int32Array(40).fill(SENT);
                    let r;
                    try { r = 'ret ' + s.saveInto(out, off); } catch (e) { r = e.constructor.name + ' ' + e.message; }
                    res.push(r + ' | ' + Array.from(out).join(','));
                }
                rows++;
                assert.equal(res[0], res[1], 'cap ' + cap + ' offset ' + String(off));
            }
            const s = new LIVE.FastBit1024(cap), out = new Int32Array(40);
            assert.equal(s.saveInto(out, N), 40, 'N fits exactly');
            assert.throws(() => s.saveInto(out, N + 1), RangeError, 'N+1 does not');
        }
        assert.equal(rows, 6 * 20);
    });
});
