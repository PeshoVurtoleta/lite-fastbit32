// test/HighestParity161.test.mjs -- T6-FIX2 / B3: highest() parity.
// Change under test: `31 - Math.clz32(this.value)` (1.6.0, 9f57c7c) becomes
// `31 - Math.clz32(this.value | 0)` (zero-GC: the old body boxed a HeapNumber
// when V8 disabled speculation on the clz32 call). Every input must give an
// identical result (Object.is) or the same thrown constructor.
// Oracle: the BASE build itself, `git show 9f57c7c:FastBit32.js`. A missing
// commit FAILS (never skips). Receivers are built by direct `f.value = x`
// (the constructor would coerce). PRNG: xorshift32, seed 0x5EED0B3A (32-bit
// exact via >>> 0), 100000 words.
// Rows 7 / 8 were rebased at FastBit64 rung 1 (the file grew past 1.6.1): row 7
// compares the base with the bytes BEFORE the `// -- FastBit64 --` marker
// (exactly the VERSION line + highest differ; the marker must be present once),
// and the VERSION values are pinned to the base ('1.6.0') and to package.json, so
// both rows survive the next release commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as NEW from '../FastBit32.js';

const BASE = '9f57c7c';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
let baseSrc = null, OLD = null, baseErr = null;
try {
    baseSrc = execFileSync('git', ['show', BASE + ':FastBit32.js'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (!baseSrc.includes("export const VERSION = '1.6.0';")) throw new Error('base is not the 1.6.0 body');
    OLD = await import('data:text/javascript;base64,' + Buffer.from(baseSrc).toString('base64'));
} catch (e) { baseErr = e; }
const headSrc = readFileSync(new URL('../FastBit32.js', import.meta.url), 'utf8');

function run(FB, x) {
    const f = new FB(0);
    f.value = x;
    try { return { v: f.highest() }; } catch (e) { return { e: e && e.constructor }; }
}
function same(x, label) {
    const n = run(NEW.FastBit32, x), o = run(OLD.FastBit32, x);
    if ('e' in o || 'e' in n) {
        assert.ok('e' in o && 'e' in n && o.e === n.e, label + ': throw mismatch');
    } else {
        assert.ok(Object.is(n.v, o.v), label + ': new=' + n.v + ' old=' + o.v);
    }
}

test('B3 row 0: the base commit is available', () => { assert.strictEqual(baseErr, null, String(baseErr)); });

test('B3 row 1: 100000 seeded words (uint32 and |0 forms) match', () => {
    let s = 0x5EED0B3A >>> 0;
    const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
    let n = 0;
    for (let i = 0; i < 100000; i++) {
        // mix sparse / dense / uniform so small and large highest bits are common
        const r = next(), k = i & 3;
        const w = k === 0 ? (r & next() & next()) >>> 0 : k === 1 ? (r | next() | next()) >>> 0 : r;
        same(w, 'u32 ' + w);
        same(w | 0, 'i32 ' + (w | 0));
        n++;
    }
    assert.equal(n, 100000);
});

test('B3 row 2: all 32 single bits, signed and unsigned', () => {
    for (let i = 0; i < 32; i++) {
        same(1 << i, 'bit ' + i + ' signed');
        same((1 << i) >>> 0, 'bit ' + i + ' unsigned');
        // spec: highest set bit of 2^i is i
        const f = new NEW.FastBit32(0); f.value = (1 << i) >>> 0;
        assert.equal(f.highest(), i);
    }
});

test('B3 row 3: edge values', () => {
    const E = [-1, -(2 ** 31), 2 ** 31, 0xFFFFFFFF, 0, 1 << 30, 2 ** 32 + 5, -0, 1.5, NaN, Infinity, -Infinity, '5', null, undefined];
    for (const x of E) same(x, 'edge ' + String(x));
    // spec-derived: |0 of 0xFFFFFFFF is -1 -> bit 31; 2**32+5 -> 5 -> bit 2; NaN/Inf -> 0 -> -1
    const f = new NEW.FastBit32(0);
    for (const [x, want] of [[0xFFFFFFFF, 31], [2 ** 32 + 5, 2], [NaN, -1], [Infinity, -1], [-0, -1], [1.5, 0], ['5', 2], [null, -1], [undefined, -1]]) {
        f.value = x;
        assert.equal(f.highest(), want, 'edge ' + String(x));
    }
});

test('B3 row 4: toPrimitive object -- both bodies call it once, hint number', () => {
    const rec = (FB) => {
        let calls = 0, lastHint = null;
        const o = { [Symbol.toPrimitive](hint) { calls++; lastHint = hint; return 7; } };
        const f = new FB(0); f.value = o;
        const v = f.highest();
        return { v, calls, lastHint };
    };
    const n = rec(NEW.FastBit32), o = rec(OLD.FastBit32);
    assert.equal(o.calls, 1); assert.equal(n.calls, 1);
    assert.equal(o.lastHint, 'number'); assert.equal(n.lastHint, 'number');
    assert.equal(n.v, 2); // 7 = 0b111 -> highest bit 2 (by hand)
    assert.equal(o.v, 2);
});

test('B3 row 5: Symbol() and 1n throw TypeError in both', () => {
    for (const x of [Symbol('s'), 1n]) {
        const n = run(NEW.FastBit32, x), o = run(OLD.FastBit32, x);
        assert.strictEqual(o.e, TypeError);
        assert.strictEqual(n.e, TypeError);
    }
});

test('B3 row 6: source pin -- highest() text, new and old', () => {
    const nt = NEW.FastBit32.prototype.highest.toString();
    const ot = OLD.FastBit32.prototype.highest.toString();
    assert.equal(nt, 'highest() {\n        return 31 - Math.clz32(this.value | 0);\n    }');
    assert.equal(ot, 'highest() {\n        return 31 - Math.clz32(this.value);\n    }');
});

const MARK64 = '// -- FastBit64 --';
test('B3 row 7: the base and the text before the FastBit64 marker differ in exactly two lines (VERSION, highest)', () => {
    const at = headSrc.indexOf(MARK64);
    assert.ok(at > 0 && headSrc.indexOf(MARK64, at + 1) === -1, 'FastBit64 marker must occur exactly once');
    const a = baseSrc.split('\n'), b = headSrc.slice(0, at).split('\n');
    assert.equal(a.length, b.length, 'line count');
    const d = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d.push(i);
    assert.equal(d.length, 2, 'differing lines: ' + d.join(','));
    assert.equal(a[d[0]], "export const VERSION = '1.6.0';");
    assert.match(b[d[0]], /^export const VERSION = '\d+\.\d+\.\d+';$/);
    assert.ok(a[d[1]].includes('Math.clz32(this.value);') && b[d[1]].includes('Math.clz32(this.value | 0);'));
});

test('B3 row 8: VERSION is 1.6.0 in the base; the new body\'s VERSION is package.json\'s and is not 1.6.0', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(NEW.VERSION, pkg.version);
    assert.notEqual(NEW.VERSION, '1.6.0');
    assert.equal(OLD.VERSION, '1.6.0');
});
