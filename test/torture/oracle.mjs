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

// ---- S4 Tier-1 oracles (true definitions over the bit array) --------------
// lowest set bit at index >= from, or -1 (from in 0..32).
export function oNextSetBit(v, from) {
    for (let i = from; i < 32; i++) if (ubit(v, i)) return i;
    return -1;
}

// highest set bit at index <= from, or -1 (from in -1..31).
export function oPrevSetBit(v, from) {
    for (let i = from; i >= 0; i--) if (ubit(v, i)) return i;
    return -1;
}

// set bits strictly below `bit` (bit in 0..31).
export function oRank(v, bit) {
    let c = 0;
    for (let i = 0; i < bit; i++) if (ubit(v, i)) c++;
    return c;
}

// every set bit of v is also set in m.
export function oIsSubsetOf(v, m) {
    for (let i = 0; i < 32; i++) if (ubit(v, i) && !ubit(m, i)) return false;
    return true;
}

// same set (bit by bit).
export function oEquals(a, b) {
    for (let i = 0; i < 32; i++) if (ubit(a, i) !== ubit(b, i)) return false;
    return true;
}

// ---- FastBit1024 truth model (S4b) ------------------------------------------
// A Uint8Array(cap) of bits and naive scans; shares no code or idiom with the
// class (no summaries, no clz32). Ported from benchmark/experiments/fb1024-check.mjs.
export class O1024 {
    constructor(cap) { this.cap = cap; this.b = new Uint8Array(cap); }
    lowest() { for (let i = 0; i < this.cap; i++) if (this.b[i]) return i; return -1; }
    highest() { for (let i = this.cap - 1; i >= 0; i--) if (this.b[i]) return i; return -1; }
    clearLow() { for (let i = 0; i < this.cap; i++) if (!this.b[i]) return i; return -1; }
    next(f) { for (let i = f; i < this.cap; i++) if (this.b[i]) return i; return -1; }
    count() { let c = 0; for (let i = 0; i < this.cap; i++) c += this.b[i]; return c; }
    list() { const out = []; for (let i = 0; i < this.cap; i++) if (this.b[i]) out.push(i); return out; }
    // true iff some 32-bit word w >= w0 lies wholly below cap with all 32 bits set
    fullWordFrom(w0) {
        for (let w = w0; w < 32 && (w << 5) + 32 <= this.cap; w++) {
            let all = true;
            for (let b = 0; b < 32; b++) if (!this.b[(w << 5) + b]) { all = false; break; }
            if (all) return true;
        }
        return false;
    }
}

// I1-I4 on a FastBit1024 (reads its fields). Returns null or the first breach.
// Bits are read per position with `>>> b & 1`, never through a summary.
export function fb1024Invariants(s) {
    let n = 0;
    for (let w = 0; w < 32; w++) {
        const d = s._data[w];
        if ((((s._active >>> w) & 1) === 1) !== (d !== 0)) return 'I1 active word ' + w;
        if ((((s._full >>> w) & 1) === 1) !== (d === -1)) return 'I2 full word ' + w;
        for (let b = 0; b < 32; b++) {
            if (((d >>> b) & 1) === 1) { n++; if ((w << 5) + b >= s._cap) return 'I4 bit ' + ((w << 5) + b) + ' >= cap ' + s._cap; }
        }
    }
    if (n !== s._n) return 'I3 n=' + s._n + ' want ' + n;
    return null;
}

// Full observable + internal state as one string (byte-identity checks).
export function fb1024Snapshot(s) {
    return s._cap + '|' + s._active + '|' + s._full + '|' + s._n + '|' + Array.prototype.join.call(s._data, ',');
}

// The T3 bad-index matrix (capacity-relative rows are built by the caller).
export function fb1024BadInputs(cap) {
    return [
        ['undefined', undefined], ['null', null], ['NaN', NaN], ['1.5', 1.5], ["'3'", '3'],
        ['true', true], ['-1', -1], ['cap', cap], ['1024', 1024], ['2^32', 2 ** 32],
        ['Symbol', Symbol('x')], ['BigInt', 3n], ['{}', {}], ['null-proto', Object.create(null)],
        ['Infinity', Infinity], ['-2^31', -(2 ** 31)]
    ];
}
