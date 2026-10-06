// test/torture/gen-t1.mjs -- regenerates t1-degenerate.mjs's golden table from a
// HEAD copy of FastBit32.js. The golden is the pin that proves S0 changed no
// behaviour; it must be derived from git HEAD, not the working file.
//
// Usage:
//   git show HEAD:FastBit32.js > /tmp/head-FastBit32.js
//   node test/torture/gen-t1.mjs /tmp/head-FastBit32.js
//
// With no argument it defaults to ../../FastBit32.js (the working file) and
// prints a warning -- use that only to refresh the loop/apply scaffolding, never
// to re-pin the golden.

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { oHasAll } from './oracle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 't1-degenerate.mjs');

const arg = process.argv[2];
if (!arg) console.error('gen-t1: no HEAD path given; defaulting to the WORKING FastBit32.js (not a valid re-pin).');
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
const push = (op, tag, lit, want, todo = false) => rows.push({ op, tag, lit, want, todo });

for (const [tag, lit] of BITS) {
    const b = valOf(lit);
    push('add', tag, lit, new HEAD().add(b).value);
    push('remove', tag, lit, new HEAD(-1).remove(b).value);
    push('toggle', tag, lit, new HEAD().toggle(b).value);
    push('has', tag, lit, new HEAD().add(0).has(b));
}
for (const [tag, lit] of MASKS) {
    const m = valOf(lit);
    const todo = m !== (m | 0) && oHasAll(-1, m) === true;
    push('hasAll', tag, lit, new HEAD(-1).hasAll(m), todo);
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

let out = `// test/torture/t1-degenerate.mjs -- GENERATED from git HEAD:FastBit32.js.
// Degenerate bit/mask/ctor inputs pinned to HEAD's literal answers. Comparing
// the working library against this table proves S0 changed no behaviour. Rows
// matching C5 (non-int32 mask whose true hasAll answer is true) are todo.
// Regenerate: git show HEAD:FastBit32.js > /tmp/h.js && node test/torture/gen-t1.mjs /tmp/h.js

const GOLDEN = [
`;
for (const r of rows) {
    out += `    { op: ${JSON.stringify(r.op)}, tag: ${JSON.stringify(r.tag)}, want: ${serWant(r.want)}${r.todo ? ', todo: true' : ''} },\n`;
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
    let green = 0;   // expected-red (FB-01/C5) rows that came out GREEN = failures
    let fb01Red = 0;
    for (let i = 0; i < GOLDEN.length; i++) {
        const row = GOLDEN[i];
        const lit = INPUT[row.tag]();
        let got;
        try { got = apply(FB, row.op, lit); } catch (e) { got = 'THROW:' + e.message; }
        if (row.todo) {
            // C5 expected-red: \`want\` is the pinned BUGGY answer. Still buggy
            // (got === want) = red; changed to the true answer = green (fixed),
            // which fails the run (flips only on purpose, in S1).
            if (Object.is(got, row.want)) fb01Red++; else green++;
            continue;
        }
        if (!Object.is(got, row.want)) fails.push('T1: ' + row.op + '(' + row.tag + ') got ' + String(got) + ' want ' + String(row.want));
    }
    return { fails, green, fb01Red };
}
`;

writeFileSync(OUT, out);
console.error('wrote t1-degenerate.mjs with ' + rows.length + ' rows (' + rows.filter((r) => r.todo).length + ' todo) from ' + srcPath);
