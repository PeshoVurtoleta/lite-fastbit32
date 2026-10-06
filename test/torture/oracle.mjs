// test/torture/oracle.mjs -- the TRUTH model for FastBit32.
//
// Shares NO code with FastBit32.js: every answer is derived from a per-bit
// Uint8Array(32) model with naive loops. If the oracle agreed with the library
// by construction, it could not catch the library's bugs (the torture-harness
// law). Masks and values are read as their true uint32 bit pattern via ubit().

const SCRATCH = new Uint8Array(32);

// Naive bit extraction: bit i of the uint32 pattern of x. `>>> 0` and `>>> i`
// both perform ToUint32, so this is the hardware-true bit with no library idiom.
export function ubit(x, i) {
    return ((x >>> 0) >>> i) & 1;
}

// Fill `out` (Uint8Array(32)) with the bits of x, LSB first. Returns out.
export function toBits(x, out = SCRATCH) {
    for (let i = 0; i < 32; i++) out[i] = ubit(x, i);
    return out;
}

export function oCount(v) {
    let c = 0;
    for (let i = 0; i < 32; i++) c += ubit(v, i);
    return c;
}

export function oCountMasked(v, m) {
    let c = 0;
    for (let i = 0; i < 32; i++) c += ubit(v, i) & ubit(m, i);
    return c;
}

export function oLowest(v) {
    for (let i = 0; i < 32; i++) if (ubit(v, i)) return i;
    return -1;
}

export function oHighest(v) {
    for (let i = 31; i >= 0; i--) if (ubit(v, i)) return i;
    return -1;
}

export function oNextClearBit(v) {
    for (let i = 0; i < 32; i++) if (!ubit(v, i)) return i;
    return -1;
}

export function oHighestClearBit(v) {
    for (let i = 31; i >= 0; i--) if (!ubit(v, i)) return i;
    return -1;
}

export function oIsEmpty(v) {
    return oCount(v) === 0;
}

export function oIsFull(v) {
    return oCount(v) === 32;
}

// The TRUE hasAll: every bit of the mask is set in the value. Vacuously true
// for an empty mask. Signedness-agnostic.
export function oHasAll(v, m) {
    for (let i = 0; i < 32; i++) if (ubit(m, i) && !ubit(v, i)) return false;
    return true;
}

export function oHasAny(v, m) {
    for (let i = 0; i < 32; i++) if (ubit(m, i) && ubit(v, i)) return true;
    return false;
}

export function oHasNone(v, m) {
    return !oHasAny(v, m);
}

export function oToArray(v) {
    const out = [];
    for (let i = 0; i < 32; i++) if (ubit(v, i)) out.push(i);
    return out;
}

// union / intersect / difference as uint32 bit patterns, built per-bit.
export function oUnion(v, m) {
    let r = 0;
    for (let i = 0; i < 32; i++) if (ubit(v, i) | ubit(m, i)) r += 2 ** i;
    return r >>> 0;
}

export function oIntersect(v, m) {
    let r = 0;
    for (let i = 0; i < 32; i++) if (ubit(v, i) & ubit(m, i)) r += 2 ** i;
    return r >>> 0;
}

export function oDifference(v, m) {
    let r = 0;
    for (let i = 0; i < 32; i++) if (ubit(v, i) && !ubit(m, i)) r += 2 ** i;
    return r >>> 0;
}

// rangeMask for a VALID range 0 <= start <= end <= 31: bits [start, end] set.
export function oRangeMask(start, end) {
    let r = 0;
    for (let i = start; i <= end; i++) r += 2 ** i;
    return r >>> 0;
}

// countRange over a valid range = masked popcount of the range mask.
export function oCountRange(v, start, end) {
    return oCountMasked(v, oRangeMask(start, end));
}
