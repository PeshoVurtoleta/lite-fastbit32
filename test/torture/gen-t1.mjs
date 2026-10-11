// test/torture/gen-t1.mjs -- regenerates t1-degenerate.mjs's golden snapshot from
// a copy of FastBit32.js. The golden pins the library's own literal answers for
// degenerate inputs; it is regenerated only when behaviour changes ON PURPOSE
// (e.g. the FB-01 hasAll fix in S1) and the resulting diff is reviewed row by
// row.
//
// Usage:
//   node test/torture/gen-t1.mjs FastBit32.js
//
// With no argument it defaults to ../../FastBit32.js (the working file).

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 't1-degenerate.mjs');

const arg = process.argv[2];
if (!arg) console.error('gen-t1: no source path given; defaulting to the working ../../FastBit32.js.');
const srcPath = arg ? resolve(arg) : join(HERE, '..', '..', 'FastBit32.js');
const { FastBit32: HEAD } = await import(pathToFileURL(srcPath).href);

const BITS = [
    ['0', '0'], ['31', '31'], ['32', '32'], ['33', '33'], ['-1', '-1'],
    ['-0', '-0'], ['1.5', '1.5'], ['NaN', 'NaN'], ['Infinity', 'Infinity'],
    ['undefined', 'undefined'], ['null', 'null'], ["'3'", "'3'"],
    ['2**31', '2**31'], ['2**32', '2**32']
];
const MASKS = [
    ['0', '0'], ['-1', '-1'], ['0xFFFFFFFF', '0xFFFFFFFF'], ['2**32', '2**32'],
    ['NaN', 'NaN'], ['undefined', 'undefined']
];
const CTORS = [
    ["'garbage'", "'garbage'"], ['NaN', 'NaN'], ['1.5', '1.5'],
    ['2**32+1', '2**32 + 1'], ['-1', '-1'], ['null', 'null'], ['{}', '{}']
];

const valOf = (lit) => eval('(' + lit + ')');
const rows = [];
const push = (op, tag, lit, want) => rows.push({ op, tag, lit, want });

for (const [tag, lit] of BITS) {
    const b = valOf(lit);
    push('add', tag, lit, new HEAD().add(b).value);
    push('remove', tag, lit, new HEAD(-1).remove(b).value);
    push('toggle', tag, lit, new HEAD().toggle(b).value);
    push('has', tag, lit, new HEAD().add(0).has(b));
}
for (const [tag, lit] of MASKS) {
    const m = valOf(lit);
    push('hasAll', tag, lit, new HEAD(-1).hasAll(m));
    push('hasAny', tag, lit, new HEAD(-1).hasAny(m));
    push('hasNone', tag, lit, new HEAD(0).hasNone(m));
}
for (const [tag, lit] of CTORS) {
    const c = valOf(lit);
    push('ctor', tag, lit, new HEAD(c).value);
    push('deserialize', tag, lit, HEAD.deserialize(c).value);
    push('lowest', tag, lit, new HEAD(c).lowest());
    push('highest', tag, lit, new HEAD(c).highest());
    push('nextClearBit', tag, lit, new HEAD(c).nextClearBit());
    push('highestClearBit', tag, lit, new HEAD(c).highestClearBit());
    push('count', tag, lit, new HEAD(c).count());
    push('isFull', tag, lit, new HEAD(c).isFull());
    push('isEmpty', tag, lit, new HEAD(c).isEmpty());
}

const serWant = (w) => (typeof w === 'boolean' ? String(w) : Object.is(w, -0) ? '-0' : String(w));

let out = `// test/torture/t1-degenerate.mjs -- GENERATED from FastBit32.js by gen-t1.mjs.
// A GOLDEN SNAPSHOT of the library's own literal answers for degenerate bit /
// mask / ctor inputs (not an independent oracle): the working library must
// reproduce every pinned row. The four hasAll C5 rows (0xFFFFFFFF / 2**32 / NaN /
// undefined) carry the FB-01 fix answer (true); hasAll is signedness-agnostic
// from 1.2.1 on. hasAll(NaN|undefined) === true even on an empty instance is a
// deliberate fail-open (ToInt32 -> 0), pinned here and in test/Pinned.test.mjs,
// to be closed in S6 / SC-3.
// Regenerate: node test/torture/gen-t1.mjs FastBit32.js

const GOLDEN = [
`;
for (const r of rows) {
    out += `    { op: ${JSON.stringify(r.op)}, tag: ${JSON.stringify(r.tag)}, want: ${serWant(r.want)} },\n`;
}
out += `];

// apply(FB, op, inputLit) -- recompute a row's value with the working library.
function apply(FB, op, lit) {
    const b = lit;
    switch (op) {
        case 'add': return new FB().add(b).value;
        case 'remove': return new FB(-1).remove(b).value;
        case 'toggle': return new FB().toggle(b).value;
        case 'has': return new FB().add(0).has(b);
        case 'hasAll': return new FB(-1).hasAll(b);
        case 'hasAny': return new FB(-1).hasAny(b);
        case 'hasNone': return new FB(0).hasNone(b);
        case 'ctor': return new FB(b).value;
        case 'deserialize': return FB.deserialize(b).value;
        case 'lowest': return new FB(b).lowest();
        case 'highest': return new FB(b).highest();
        case 'nextClearBit': return new FB(b).nextClearBit();
        case 'highestClearBit': return new FB(b).highestClearBit();
        case 'count': return new FB(b).count();
        case 'isFull': return new FB(b).isFull();
        case 'isEmpty': return new FB(b).isEmpty();
        default: throw new Error('unknown op ' + op);
    }
}

// Rebuild the live input for a row by tag (same literals the generator used).
const INPUT = {
${[...BITS, ...MASKS, ...CTORS].reduce((acc, [tag, lit]) => {
    if (!acc.seen.has(tag)) { acc.seen.add(tag); acc.s += `    ${JSON.stringify(tag)}: () => (${lit}),\n`; }
    return acc;
}, { seen: new Set(), s: '' }).s}};

export function run(ctx) {
    const FB = ctx.FB;
    const fails = [];
    for (let i = 0; i < GOLDEN.length; i++) {
        const row = GOLDEN[i];
        const lit = INPUT[row.tag]();
        let got;
        try { got = apply(FB, row.op, lit); } catch (e) { got = 'THROW:' + e.message; }
        if (!Object.is(got, row.want)) fails.push('T1: ' + row.op + '(' + row.tag + ') got ' + String(got) + ' want ' + String(row.want));
    }
    // a broken variant (T9 control) may throw mid-sequence: that is a FAIL row, never a crash
    try { runFb1024(ctx, fails); } catch (e) { fails.push('T1 ' + 'FastBit1024 rows threw ' + e.constructor.name + ': ' + e.message); }
    return { fails, green: 0 };
}

// ---- S4b FastBit1024 degenerate rows (hand-written in gen-t1.mjs's template) --
// Capacities 1, 31, 32, 33, 1023, 1024: the empty state, a full pool (acquire
// hands out 0..cap-1 in order, then -1), a pool drained top-down (each release
// is the new lowest free slot), and the fill-1024 / free-{1023, 31, 0}
// extremes (bit 31 of every word, the last word, word 0). The fb1024-sparse
// control (first EMPTY word) fails the fill order here.
function runFb1024(ctx, fails) {
    const C = ctx.FB1024;
    const F = (m) => fails.push('T1 FB1024: ' + m);
    const pin = (tag, got, want) => { if (!Object.is(got, want)) F(tag + ' got ' + String(got) + ' want ' + String(want)); };
    for (const cap of [1, 31, 32, 33, 1023, 1024]) {
        const s = new C(cap);
        const t = 'cap ' + cap + ' ';
        pin(t + 'empty lowest', s.lowest(), -1);
        pin(t + 'empty highest', s.highest(), -1);
        pin(t + 'empty nextClearBit', s.nextClearBit(), 0);
        pin(t + 'empty nextSetBit(0)', s.nextSetBit(0), -1);
        pin(t + 'empty nextSetBit(cap)', s.nextSetBit(cap), -1);
        pin(t + 'empty size', s.size, 0);
        pin(t + 'capacity', s.capacity, cap);
        pin(t + 'empty isEmpty', s.isEmpty(), true);
        pin(t + 'empty isFull', s.isFull(), false);
        let order = true;
        for (let i = 0; i < cap; i++) if (s.acquire() !== i) { order = false; break; }
        pin(t + 'fill order 0..cap-1', order, true);
        if (!order) continue;
        pin(t + 'full acquire', s.acquire(), -1);
        pin(t + 'full nextClearBit', s.nextClearBit(), -1);
        pin(t + 'full isFull', s.isFull(), true);
        pin(t + 'full size', s.size, cap);
        pin(t + 'full lowest', s.lowest(), 0);
        pin(t + 'full highest', s.highest(), cap - 1);
        pin(t + 'full nextSetBit(cap-1)', s.nextSetBit(cap - 1), cap - 1);
        pin(t + 'full nextSetBit(cap)', s.nextSetBit(cap), -1);
        pin(t + 'full summary', s._full, cap === 1024 ? -1 : (cap >>> 5 === 0 ? 0 : (-1 >>> (32 - (cap >>> 5))) | 0));
        let drain = true;
        for (let i = cap - 1; i >= 0; i--) { s.release(i); if (s.nextClearBit() !== i) { drain = false; break; } }
        pin(t + 'drain: each release is the lowest free slot', drain, true);
        pin(t + 'drained isEmpty', s.isEmpty(), true);
        pin(t + 'drained size', s.size, 0);
        pin(t + 'drained active', s._active, 0);
        pin(t + 'drained full', s._full, 0);
        pin(t + 'drained lowest', s.lowest(), -1);
        let threw = false;
        try { s.release(0); } catch (e) { threw = e instanceof RangeError; }
        pin(t + 'drained release(0) throws RangeError', threw, true);
    }
    const s = new C();
    for (let i = 0; i < 1024; i++) s.acquire();
    pin('fill-1024 full', s._full, -1);
    pin('fill-1024 active', s._active, -1);
    s.release(1023);
    pin('free 1023 nextClearBit', s.nextClearBit(), 1023);
    pin('free 1023 full', s._full, 0x7fffffff);
    pin('free 1023 word 31', s._data[31], 0x7fffffff);
    s.release(31);
    pin('free 31 nextClearBit', s.nextClearBit(), 31);
    pin('free 31 word 0', s._data[0], 0x7fffffff);
    s.release(0);
    pin('free 0 nextClearBit', s.nextClearBit(), 0);
    pin('free 0 word 0', s._data[0], 0x7ffffffe);
    pin('refill acquire 0', s.acquire(), 0);
    pin('refill acquire 31', s.acquire(), 31);
    pin('refill acquire 1023', s.acquire(), 1023);
    pin('refill acquire -1', s.acquire(), -1);
    pin('refill word 0', s._data[0], -1);
}
`;

writeFileSync(OUT, out);
console.error('wrote t1-degenerate.mjs with ' + rows.length + ' rows from ' + srcPath);
