// test/torture/fb64-variants.mjs -- B-S2 (PLAN-fastbit64-B task 1). FastBit64
// variants built from the LIVE FastBit32.js text (read at call time from the
// package root) with exact-count string edits, imported from a data: URL (so
// each variant is its own module and its own class, distinct private brand),
// cached per process. A needle whose match count differs from the expected
// count is a named FAIL row in the result, never a throw: the variant is then
// not built (C === null) and every caller fails closed on it.
//
// Variants:
//   faithful  no edit (the control-fidelity copy; must agree with ctx.FB64)
//   reread    loadFrom re-reads the high word (X-6: cut from the LANDED loadFrom):
//             `this.#lo = w0; this.#hi = w1;` (1) -> `this.#lo = w0; this.#hi = src[base + 1];`
//   u32       FastBit64's `| 0` word STORAGE -> `>>> 0`. On the landed Smi-first
//             `#lo = 0; #hi = 0;` fields a uint32 >= 2^31 makes the private field
//             Double: the `>>> 0` store is in place and the box is on the poisoned
//             READ (one HeapNumber per read; t6-alloc.mjs witness rows). The sites
//             (#lo / #hi are private to FastBit64, so a whole-file count is the
//             class count):
//             `this.#lo = lo | 0;` (2: constructor, setWords)
//             `this.#hi = hi | 0;` (2: constructor, setWords)
//             Every other #lo / #hi store is a compound bit op (int32 already),
//             loadFrom's Int32Array reads, or fromArray's `|`-built locals.
//   kexport   the private kernels between the `fb64-kernels:begin/end` markers
//             exported (each marker 1), so B-S4 can verify them optimized; the
//             kernel list is pinned (KEXPORT_KERNELS): a kernel added or removed
//             in the source is a FAIL row until this list is updated.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LIB_PATH = join(HERE, '..', '..', 'FastBit32.js');
export const FB64_VARIANT_NAMES = ['faithful', 'reread', 'u32', 'kexport'];
export const KEXPORT_KERNELS = ['ctz32', 'popcnt32', 'select32', 'upTo'];

const K_BEGIN = '// fb64-kernels:begin';
const K_END = '// fb64-kernels:end';
const REREAD_NEEDLE = 'this.#lo = w0; this.#hi = w1;';
const REREAD_REPL = 'this.#lo = w0; this.#hi = src[base + 1];';

function countOf(text, needle) { return text.split(needle).length - 1; }
function sha8(s) { return createHash('sha256').update(s).digest('hex').slice(0, 8); }

// The edits of one variant: [{ needle, repl, expected }]. kexport derives its
// export line from the text between the markers (checked against the pin).
function editsFor(name, text, fails) {
    if (name === 'faithful') return [];
    if (name === 'reread') return [{ needle: REREAD_NEEDLE, repl: REREAD_REPL, expected: 1 }];
    if (name === 'u32') {
        return [
            { needle: 'this.#lo = lo | 0;', repl: 'this.#lo = lo >>> 0;', expected: 2 },
            { needle: 'this.#hi = hi | 0;', repl: 'this.#hi = hi >>> 0;', expected: 2 }
        ];
    }
    // kexport
    const b = text.indexOf(K_BEGIN), e = text.indexOf(K_END);
    const names = b >= 0 && e > b ? Array.from(text.slice(b, e).matchAll(/^function (\w+)\(/gm), (m) => m[1]) : [];
    if (names.join(',') !== KEXPORT_KERNELS.join(',')) {
        fails.push('FB64 variant kexport: kernels between the markers are [' + names.join(',') + '], pinned [' + KEXPORT_KERNELS.join(',') + ']');
    }
    return [
        { needle: K_BEGIN, repl: K_BEGIN, expected: 1 },
        { needle: K_END, repl: K_END + '\nexport { ' + KEXPORT_KERNELS.join(', ') + ' };', expected: 1 }
    ];
}

// Uncached build from a given source text (the sabotage check passes its own).
// Never throws: { name, C, mod, needles, kernels, sha8, fails }.
export async function buildFb64Variant(name, text) {
    const fails = [];
    const r = { name, C: null, mod: null, needles: [], kernels: [], sha8: null, fails };
    if (!FB64_VARIANT_NAMES.includes(name)) {
        fails.push('FB64 variant "' + name + '": unknown (known: ' + FB64_VARIANT_NAMES.join(', ') + ')');
        return r;
    }
    if (typeof text !== 'string' || text.length === 0) {
        fails.push('FB64 variant ' + name + ': no source text');
        return r;
    }
    const edits = editsFor(name, text, fails);
    let out = text;
    for (const ed of edits) {
        const actual = countOf(text, ed.needle);
        r.needles.push({ needle: ed.needle, expected: ed.expected, actual });
        if (actual !== ed.expected) {
            fails.push('FB64 variant ' + name + ': needle ' + JSON.stringify(ed.needle) + ' matched ' + actual + ' time(s), expected ' + ed.expected);
        } else {
            out = out.split(ed.needle).join(ed.repl);
        }
    }
    if (fails.length > 0) return r;
    if ((name === 'faithful') !== (out === text)) {
        fails.push('FB64 variant ' + name + ': edited text ' + (out === text ? 'equals' : 'differs from') + ' the source');
        return r;
    }
    r.sha8 = sha8(out);
    let mod;
    try {
        mod = await import('data:text/javascript;base64,' + Buffer.from(out, 'utf8').toString('base64'));
    } catch (e) {
        fails.push('FB64 variant ' + name + ': import threw ' + (e && e.constructor ? e.constructor.name : typeof e) + ': ' + (e && e.message));
        return r;
    }
    if (typeof mod.FastBit64 !== 'function') {
        fails.push('FB64 variant ' + name + ': module has no FastBit64 class');
        return r;
    }
    if (name === 'kexport') {
        for (const k of KEXPORT_KERNELS) {
            if (typeof mod[k] === 'function') r.kernels.push(k);
            else fails.push('FB64 variant kexport: kernel ' + k + ' not exported');
        }
        if (fails.length > 0) return r;
    }
    r.mod = mod;
    r.C = mod.FastBit64;
    return r;
}

const CACHE = new Map();

// Cached per process; the live FastBit32.js is read on the first call per name.
export function fb64Variant(name) {
    let p = CACHE.get(name);
    if (p === undefined) {
        p = (async () => {
            let text;
            try { text = readFileSync(LIB_PATH, 'utf8'); } catch (e) {
                return { name, C: null, mod: null, needles: [], kernels: [], sha8: null, fails: ['FB64 variant ' + name + ': cannot read ' + LIB_PATH + ' (' + e.message + ')'] };
            }
            return buildFb64Variant(name, text);
        })();
        CACHE.set(name, p);
    }
    return p;
}

// ctx.control.fb64Variant = '<name>' makes ctx.FB64 that variant for every tier
// run with this ctx (torture.mjs applies it after control.apply and in the
// fidelity block). Returns the fail rows ([] when unset or built).
export async function applyFb64Variant(ctx) {
    const name = ctx.control.fb64Variant;
    if (name === undefined) return [];
    const r = await fb64Variant(name);
    if (r.C === null) return r.fails.length > 0 ? r.fails : ['FB64 variant ' + name + ': not built'];
    ctx.FB64 = r.C;
    return [];
}

// ---- the variant row (torture.mjs fidelity step) --------------------------

const WORDS = [
    [0, 0], [1, 0], [0, 1], [-1, -1], [0xFFFFFFFF, 0xFFFFFFFF], [0x80000000, 0], [0, 0x80000000],
    [0x80000001, 0xC0000003], [0x12345678, 0x9ABCDEF0], [-0x40000001, 0x40000000], [0x55555555, 0xAAAAAAAA]
];

function brandDistinct(Shipped, C) {
    try { new Shipped().equals(new C()); } catch (e) { return e instanceof TypeError; }
    return false;
}

function threw(e) { return (e && e.constructor ? e.constructor.name : typeof e) + ': ' + (e && e.message); }

// Runs one probe; a throw is a named fail row, never an unhandled rejection.
function guarded(F, label, fn) {
    try { fn(); } catch (e) { F(label + ': threw ' + threw(e)); }
}

function agreeRow(Shipped, C, label, F) {
    for (const [lo, hi] of WORDS) {
        const tag = label + ' (' + lo + ', ' + hi + ')';
        guarded(F, tag, () => agreeWords(Shipped, C, lo, hi, tag, F));
    }
}

function agreeWords(Shipped, C, lo, hi, tag, F) {
    const a = new Shipped(lo, hi), b = new C(lo, hi);
    if (a.lo !== b.lo || a.hi !== b.hi) F(tag + ': words ' + b.lo + ',' + b.hi + ' want ' + a.lo + ',' + a.hi);
    for (let bit = 0; bit < 64; bit++) if (a.has(bit) !== b.has(bit)) { F(tag + ': has(' + bit + ') differs'); break; }
    if (a.count() !== b.count()) F(tag + ': count ' + b.count() + ' want ' + a.count());
    if (a.lowest() !== b.lowest() || a.highest() !== b.highest()) F(tag + ': lowest / highest differ');
    if (a.toArray().join(',') !== b.toArray().join(',')) F(tag + ': toArray differs');
    const sa = a.serialize(), sb = b.serialize();
    if (Array.prototype.join.call(sa, ',') !== Array.prototype.join.call(sb, ',')) F(tag + ': serialize differs');
    const ra = C.deserialize(sa), rb = Shipped.deserialize(sb);
    if (ra.lo !== a.lo || ra.hi !== a.hi || rb.lo !== a.lo || rb.hi !== a.hi) F(tag + ': serialize -> deserialize round trip differs');
    const ca = new Shipped(lo, hi).add(63).remove(0).toggle(31), cb = new C(lo, hi).add(63).remove(0).toggle(31);
    if (ca.lo !== cb.lo || ca.hi !== cb.hi) F(tag + ': add / remove / toggle differ');
}

// Builds all four variants and checks them against the shipped class.
// Returns { fails, needles: [{ variant, needle, expected, actual }], kernels }.
export async function fb64VariantRow(Shipped) {
    const fails = [];
    const F = (m) => fails.push('FB64 variants: ' + m);
    const needles = [];
    const v = {};
    for (const name of FB64_VARIANT_NAMES) {
        let r;
        try { r = await fb64Variant(name); } catch (e) {
            r = { name, C: null, mod: null, needles: [], kernels: [], sha8: null, fails: ['FB64 variant ' + name + ': build threw ' + threw(e)] };
        }
        v[name] = r;
        for (const n of r.needles) needles.push({ variant: name, needle: n.needle, expected: n.expected, actual: n.actual });
        for (const f of r.fails) fails.push(f);
        if (r.C === null && r.fails.length === 0) F(name + ': not built');
    }
    if (typeof Shipped !== 'function') { F('ctx.FB64 is not a class'); return { fails, needles, kernels: [] }; }
    for (const name of FB64_VARIANT_NAMES) {
        const C = v[name].C;
        if (C === null) continue;
        if (C === Shipped || !brandDistinct(Shipped, C)) F(name + ': is the shipped class (same private brand)');
    }
    if (v.faithful.C !== null) agreeRow(Shipped, v.faithful.C, 'faithful', F);
    if (v.kexport.C !== null) {
        agreeRow(Shipped, v.kexport.C, 'kexport', F);
        const k = v.kexport.mod;
        guarded(F, 'kexport kernels', () => {
            if (k.ctz32(0) !== 32 || k.ctz32(8) !== 3 || k.popcnt32(-1) !== 32 || k.select32(10, 1) !== 3 || k.upTo(32) !== -1 || k.upTo(5) !== 31) F('kexport: exported kernels give wrong results');
        });
    }
    if (v.reread.C !== null) {
        // deterministic (no race): the re-read is invisible, so it must still agree
        agreeRow(Shipped, v.reread.C, 'reread', F);
        guarded(F, 'reread loadFrom source', () => {
            const src = String(v.reread.C.prototype.loadFrom);
            if (!src.includes(REREAD_REPL) || String(Shipped.prototype.loadFrom).includes(REREAD_REPL)) F('reread: loadFrom does not carry the re-read (or the shipped one does)');
        });
    }
    if (v.u32.C !== null) {
        const U = v.u32.C;
        guarded(F, 'u32 storage', () => {
            const a = new Shipped(-1, 0x80000000), b = new U(-1, 0x80000000);
            if (a.lo !== -1 || a.hi !== -0x80000000) F('u32: shipped stores ' + a.lo + ',' + a.hi + ' (want int32 -1,-2147483648)');
            if (b.lo !== 0xFFFFFFFF || b.hi !== 0x80000000) F('u32: variant stores ' + b.lo + ',' + b.hi + ' (want uint32 4294967295,2147483648: the edit did not take)');
            const c = new U().setWords(0xFFFFFFFF, 1);
            if (c.lo !== 0xFFFFFFFF) F('u32: setWords stores ' + c.lo + ' (want 4294967295)');
        });
    }
    return { fails, needles, kernels: v.kexport.kernels };
}
