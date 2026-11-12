// test/fixtures/af1-patches.mjs -- the AF-1 edits to FastBit32.js (PLAN-af1 TASKS 1-4), as
// [from, to, why] entries. The parity suites (FastBit1024Parity160, FastBit64Parity161,
// HighestParity161) apply them to their BASE text and compare with the tree, so the
// AF-1 change is accepted entry by entry and any other byte change still fails.
// Each `from` is unique in every base it is applied to and in the whole tree file
// (the saveInto entry includes the fb1024BadBuf line: FastBit64#saveInto has the
// same signature line). Nothing here is loosened: a `from` that does not match
// exactly once is an error (applyExact throws).
export const AF1_HEADER = [
    ' * converted to unsigned 32-bit integers (e.g., `-1 >>> 0` becomes `4294967295`).\n',
    ' * converted to 32-bit integers: `value` is int32 after any bit mutator or\n'
        + ' * `set`; uint32 straight from the constructor / `clone` / `fromArray` /\n'
        + ' * `deserialize` (FB-03); `copy` stores `other.value` as-is. Compare with\n'
        + ' * `equalsValue` or `>>> 0`.\n',
    'AF-1 U-2: header :8 was false (union(-1).value === -1); comment only',
];
export const AF1_COUNTRANGE = [
    'const mask = ((0xFFFFFFFF >>> (31 - (end - start))) << start) >>> 0;',
    'const mask = (0xFFFFFFFF >>> (31 - (end - start))) << start;',
    'AF-1 U-3: FastBit32#countRange mask stays int32 (no box across a non-inlined countMasked); results unchanged',
];
export const AF1_ACQUIRE_DOC = [
    '     * inlined (one word read reused for the write): ~3.0-3.2 ns per\n'
        + '     * acquire+release pair vs ~4.9 ns when it called nextClearBit() with the\n'
        + '     * same zero test (5.4 ns for the original draft; RESEARCH 13).\n',
    '     * written out in this body (one word read reused for the write) instead of\n'
        + '     * a call to nextClearBit() with the same zero test.\n',
    'AF-1 U-10 + U-8: FastBit1024#acquire JSDoc drops the unsourced ns figures; comment only',
];
export const AF1_SAVEINTO = [
    'saveInto(out, offset = 0) {\n'
        + "        if (!ArrayBuffer.isView(out) || !(out instanceof Int32Array) || fb1024TaTag.call(out) !== 'Int32Array') fb1024BadBuf('out');",
    'saveInto(out, offset = 0) {\n'
        + '        if (!(#brand in this)) fb1024BadOther(this);\n'
        + "        if (!ArrayBuffer.isView(out) || !(out instanceof Int32Array) || fb1024TaTag.call(out) !== 'Int32Array') fb1024BadBuf('out');",
    'AF-1 U-5: FastBit1024#saveInto throws TypeError on a non-FastBit1024 receiver before any write',
];
export const AF1_PATCHES = [AF1_HEADER, AF1_COUNTRANGE, AF1_ACQUIRE_DOC, AF1_SAVEINTO];

export function countOf(text, s) { return text.split(s).length - 1; }

// Source-level patch: every `from` must occur EXACTLY once in `text`, else throw (fail closed).
export function applyExact(text, entries) {
    for (const [from, to, why] of entries) {
        const n = countOf(text, from);
        if (n !== 1) throw new Error('af1-patches: from matched ' + n + ' times (want 1) -- ' + why);
        text = text.split(from).join(to);
    }
    return text;
}

// Member-level patch (one Function#toString): a `from` occurs at most once, else throw.
export function applyAtMostOnce(text, entries) {
    for (const [from, to, why] of entries) {
        const n = countOf(text, from);
        if (n > 1) throw new Error('af1-patches: from matched ' + n + ' times (want <= 1) -- ' + why);
        if (n === 1) text = text.split(from).join(to);
    }
    return text;
}
