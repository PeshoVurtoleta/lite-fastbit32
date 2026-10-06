// test/torture/t1-degenerate.mjs -- GENERATED from FastBit32.js by gen-t1.mjs.
// A GOLDEN SNAPSHOT of the library's own literal answers for degenerate bit /
// mask / ctor inputs (not an independent oracle): the working library must
// reproduce every pinned row. The four hasAll C5 rows (0xFFFFFFFF / 2**32 / NaN /
// undefined) carry the FB-01 fix answer (true); hasAll is signedness-agnostic
// from 1.2.1 on. hasAll(NaN|undefined) === true even on an empty instance is a
// deliberate fail-open (ToInt32 -> 0), pinned here and in test/Pinned.test.mjs,
// to be closed in S6 / SC-3.
// Regenerate: node test/torture/gen-t1.mjs FastBit32.js

const GOLDEN = [
    { op: "add", tag: "0", want: 1 },
    { op: "remove", tag: "0", want: -2 },
    { op: "toggle", tag: "0", want: 1 },
    { op: "has", tag: "0", want: true },
    { op: "add", tag: "31", want: -2147483648 },
    { op: "remove", tag: "31", want: 2147483647 },
    { op: "toggle", tag: "31", want: -2147483648 },
    { op: "has", tag: "31", want: false },
    { op: "add", tag: "32", want: 1 },
    { op: "remove", tag: "32", want: -2 },
    { op: "toggle", tag: "32", want: 1 },
    { op: "has", tag: "32", want: true },
    { op: "add", tag: "33", want: 2 },
    { op: "remove", tag: "33", want: -3 },
    { op: "toggle", tag: "33", want: 2 },
    { op: "has", tag: "33", want: false },
    { op: "add", tag: "-1", want: -2147483648 },
    { op: "remove", tag: "-1", want: 2147483647 },
    { op: "toggle", tag: "-1", want: -2147483648 },
    { op: "has", tag: "-1", want: false },
    { op: "add", tag: "-0", want: 1 },
    { op: "remove", tag: "-0", want: -2 },
    { op: "toggle", tag: "-0", want: 1 },
    { op: "has", tag: "-0", want: true },
    { op: "add", tag: "1.5", want: 2 },
    { op: "remove", tag: "1.5", want: -3 },
    { op: "toggle", tag: "1.5", want: 2 },
    { op: "has", tag: "1.5", want: false },
    { op: "add", tag: "NaN", want: 1 },
    { op: "remove", tag: "NaN", want: -2 },
    { op: "toggle", tag: "NaN", want: 1 },
    { op: "has", tag: "NaN", want: true },
    { op: "add", tag: "Infinity", want: 1 },
    { op: "remove", tag: "Infinity", want: -2 },
    { op: "toggle", tag: "Infinity", want: 1 },
    { op: "has", tag: "Infinity", want: true },
    { op: "add", tag: "undefined", want: 1 },
    { op: "remove", tag: "undefined", want: -2 },
    { op: "toggle", tag: "undefined", want: 1 },
    { op: "has", tag: "undefined", want: true },
    { op: "add", tag: "null", want: 1 },
    { op: "remove", tag: "null", want: -2 },
    { op: "toggle", tag: "null", want: 1 },
    { op: "has", tag: "null", want: true },
    { op: "add", tag: "'3'", want: 8 },
    { op: "remove", tag: "'3'", want: -9 },
    { op: "toggle", tag: "'3'", want: 8 },
    { op: "has", tag: "'3'", want: false },
    { op: "add", tag: "2**31", want: 1 },
    { op: "remove", tag: "2**31", want: -2 },
    { op: "toggle", tag: "2**31", want: 1 },
    { op: "has", tag: "2**31", want: true },
    { op: "add", tag: "2**32", want: 1 },
    { op: "remove", tag: "2**32", want: -2 },
    { op: "toggle", tag: "2**32", want: 1 },
    { op: "has", tag: "2**32", want: true },
    { op: "hasAll", tag: "0", want: true },
    { op: "hasAny", tag: "0", want: false },
    { op: "hasNone", tag: "0", want: true },
    { op: "hasAll", tag: "-1", want: true },
    { op: "hasAny", tag: "-1", want: true },
    { op: "hasNone", tag: "-1", want: true },
    { op: "hasAll", tag: "0xFFFFFFFF", want: true },
    { op: "hasAny", tag: "0xFFFFFFFF", want: true },
    { op: "hasNone", tag: "0xFFFFFFFF", want: true },
    { op: "hasAll", tag: "2**32", want: true },
    { op: "hasAny", tag: "2**32", want: false },
    { op: "hasNone", tag: "2**32", want: true },
    { op: "hasAll", tag: "NaN", want: true },
    { op: "hasAny", tag: "NaN", want: false },
    { op: "hasNone", tag: "NaN", want: true },
    { op: "hasAll", tag: "undefined", want: true },
    { op: "hasAny", tag: "undefined", want: false },
    { op: "hasNone", tag: "undefined", want: true },
    { op: "ctor", tag: "'garbage'", want: 0 },
    { op: "deserialize", tag: "'garbage'", want: 0 },
    { op: "lowest", tag: "'garbage'", want: -1 },
    { op: "highest", tag: "'garbage'", want: -1 },
    { op: "nextClearBit", tag: "'garbage'", want: 0 },
    { op: "highestClearBit", tag: "'garbage'", want: 31 },
    { op: "count", tag: "'garbage'", want: 0 },
    { op: "isFull", tag: "'garbage'", want: false },
    { op: "isEmpty", tag: "'garbage'", want: true },
    { op: "ctor", tag: "NaN", want: 0 },
    { op: "deserialize", tag: "NaN", want: 0 },
    { op: "lowest", tag: "NaN", want: -1 },
    { op: "highest", tag: "NaN", want: -1 },
    { op: "nextClearBit", tag: "NaN", want: 0 },
    { op: "highestClearBit", tag: "NaN", want: 31 },
    { op: "count", tag: "NaN", want: 0 },
    { op: "isFull", tag: "NaN", want: false },
    { op: "isEmpty", tag: "NaN", want: true },
    { op: "ctor", tag: "1.5", want: 1 },
    { op: "deserialize", tag: "1.5", want: 1 },
    { op: "lowest", tag: "1.5", want: 0 },
    { op: "highest", tag: "1.5", want: 0 },
    { op: "nextClearBit", tag: "1.5", want: 1 },
    { op: "highestClearBit", tag: "1.5", want: 31 },
    { op: "count", tag: "1.5", want: 1 },
    { op: "isFull", tag: "1.5", want: false },
    { op: "isEmpty", tag: "1.5", want: false },
    { op: "ctor", tag: "2**32+1", want: 1 },
    { op: "deserialize", tag: "2**32+1", want: 1 },
    { op: "lowest", tag: "2**32+1", want: 0 },
    { op: "highest", tag: "2**32+1", want: 0 },
    { op: "nextClearBit", tag: "2**32+1", want: 1 },
    { op: "highestClearBit", tag: "2**32+1", want: 31 },
    { op: "count", tag: "2**32+1", want: 1 },
    { op: "isFull", tag: "2**32+1", want: false },
    { op: "isEmpty", tag: "2**32+1", want: false },
    { op: "ctor", tag: "-1", want: 4294967295 },
    { op: "deserialize", tag: "-1", want: 4294967295 },
    { op: "lowest", tag: "-1", want: 0 },
    { op: "highest", tag: "-1", want: 31 },
    { op: "nextClearBit", tag: "-1", want: -1 },
    { op: "highestClearBit", tag: "-1", want: -1 },
    { op: "count", tag: "-1", want: 32 },
    { op: "isFull", tag: "-1", want: true },
    { op: "isEmpty", tag: "-1", want: false },
    { op: "ctor", tag: "null", want: 0 },
    { op: "deserialize", tag: "null", want: 0 },
    { op: "lowest", tag: "null", want: -1 },
    { op: "highest", tag: "null", want: -1 },
    { op: "nextClearBit", tag: "null", want: 0 },
    { op: "highestClearBit", tag: "null", want: 31 },
    { op: "count", tag: "null", want: 0 },
    { op: "isFull", tag: "null", want: false },
    { op: "isEmpty", tag: "null", want: true },
    { op: "ctor", tag: "{}", want: 0 },
    { op: "deserialize", tag: "{}", want: 0 },
    { op: "lowest", tag: "{}", want: -1 },
    { op: "highest", tag: "{}", want: -1 },
    { op: "nextClearBit", tag: "{}", want: 0 },
    { op: "highestClearBit", tag: "{}", want: 31 },
    { op: "count", tag: "{}", want: 0 },
    { op: "isFull", tag: "{}", want: false },
    { op: "isEmpty", tag: "{}", want: true },
];

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
    "0": () => (0),
    "31": () => (31),
    "32": () => (32),
    "33": () => (33),
    "-1": () => (-1),
    "-0": () => (-0),
    "1.5": () => (1.5),
    "NaN": () => (NaN),
    "Infinity": () => (Infinity),
    "undefined": () => (undefined),
    "null": () => (null),
    "'3'": () => ('3'),
    "2**31": () => (2**31),
    "2**32": () => (2**32),
    "0xFFFFFFFF": () => (0xFFFFFFFF),
    "'garbage'": () => ('garbage'),
    "2**32+1": () => (2**32 + 1),
    "{}": () => ({}),
};

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
    return { fails, green: 0 };
}
