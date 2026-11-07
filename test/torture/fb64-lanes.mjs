// test/torture/fb64-lanes.mjs -- B-S3 / B-S4 (PLAN-fastbit64-B tasks 5, 6): the ONE
// FastBit64 lane table. T6 (t6-alloc.mjs fb64Lanes) measures it inlined; B.B3's
// --no-turbo-inlining child reuses it unchanged. Free of t6 / harness internals:
// a lane builder takes a fixture (fb64Fixture(C, sink)) and returns the op
// `(i) => { ... }`; every result goes to the caller's Int32Array sink.
//
// Words (the research p3-alloc.mjs table): A and B carry bit 31 (lo < 0) and A
// bit 63 (hi < 0), E is bit 63 only, F is full (-1, -1); W is the scratch
// instance the mutating lanes write. A / B / E / F are READ-ONLY: the caller
// re-reads their words after every lane (fb64FixtureMoved).
//
// Lanes: the 21 FastBit64 lanes of p3 plus isEmpty/isFull, clear and
// rank(31)/rank(63) ((1 << bit) - 1 is a double at bit 31 and 63, consumed only
// bitwise) = 24 FastBit64 lanes, plus 1 control (`control: true`): u32(lo)
// returned through a call -- inlined it reads 0 B/op; under
// --no-turbo-inlining it MUST box (B-S4), or that run cannot see boxing.
// Setup allocates (instances, the image, the callback); a lane op allocates
// nothing by contract.

export const FB64_WORDS = Object.freeze({
    A: Object.freeze([-0x80000000 | 0x00F01234, -0x7FFF0F00]),   // bit 31 and bit 63 set
    B: Object.freeze([0x00F00004 | -0x80000000, 0x40000000]),    // bit 31 set, bit 62
    E: Object.freeze([0, -0x80000000]),                          // only bit 63
    F: Object.freeze([-1, -1])                                   // full
});

// The control's callee: the unsigned form of a bit-31 word returned through a call.
export function u32(x) { return x >>> 0; }

// Setup (cold). C = a FastBit64 class (shipped or a variant), sink = an
// Int32Array(>= 2) the ops write. Returns the fixture every builder reads.
export function fb64Fixture(C, sink) {
    const W0 = FB64_WORDS;
    const A = new C(W0.A[0], W0.A[1]);
    const f = {
        C, sink, A,
        B: new C(W0.B[0], W0.B[1]),
        E: new C(W0.E[0], W0.E[1]),
        F: new C(W0.F[0], W0.F[1]),
        W: new C(),
        OUT: new Int32Array(6),
        IMG: A.serialize(),
        cb: null
    };
    f.cb = (b) => { sink[1] = (sink[1] + b) | 0; };
    return f;
}

// Every function a lane op may reach besides the class's own methods (for the
// caller's verified-optimized callee list).
export function fb64LaneCallees(f) { return [f.cb, u32]; }

// null, or which read-only word moved (reads lo / hi back; int32 contract).
export function fb64FixtureMoved(f) {
    for (const k of ['A', 'B', 'E', 'F']) {
        const x = f[k], w = FB64_WORDS[k];
        if (!Object.is(x.lo, w[0]) || !Object.is(x.hi, w[1])) return k + ' reads (' + x.lo + ', ' + x.hi + '), want (' + w[0] + ', ' + w[1] + ')';
    }
    return null;
}

export const FB64_LANES = Object.freeze([
    { name: 'has', op: (f) => { const A = f.A, S = f.sink; return (i) => { S[0] = A.has(i & 63) ? 1 : 0; }; } },
    { name: 'add+remove', op: (f) => { const W = f.W, S = f.sink; return (i) => { W.add(i & 63); W.remove((i + 1) & 63); S[0] = W.lo; }; } },
    { name: 'toggle', op: (f) => { const W = f.W, S = f.sink; return (i) => { W.toggle(i & 63); S[0] = W.hi; }; } },
    { name: 'hasAll', op: (f) => { const A = f.A, B = f.B, E = f.E, S = f.sink; return (i) => { S[0] = ((i & 1) === 0 ? A : B).hasAll((i & 2) === 0 ? E : B) ? 1 : 0; }; } },
    { name: 'hasAny/hasNone', op: (f) => { const A = f.A, B = f.B, E = f.E, S = f.sink; return (i) => { S[0] = (A.hasAny(B) ? 1 : 0) + (A.hasNone(E) ? 2 : 0); }; } },
    { name: 'isSubsetOf/equals', op: (f) => { const A = f.A, B = f.B, E = f.E, S = f.sink; return (i) => { S[0] = (E.isSubsetOf(A) ? 1 : 0) + (A.equals((i & 1) === 0 ? A : B) ? 2 : 0); }; } },
    { name: 'union/diff/intersect', op: (f) => { const A = f.A, B = f.B, E = f.E, W = f.W, S = f.sink; return (i) => { W.copy(A).union(B).difference(E).intersect(A); S[0] = W.hi; }; } },
    { name: 'count/countMasked', op: (f) => { const A = f.A, B = f.B, S = f.sink; return (i) => { S[0] = A.count() + A.countMasked(B); }; } },
    { name: 'lowest/highest', op: (f) => { const A = f.A, B = f.B, E = f.E, S = f.sink; return (i) => { S[0] = ((i & 1) === 0 ? A : E).lowest() + ((i & 1) === 0 ? E : B).highest(); }; } },
    { name: 'nextClearBit/hiClear', op: (f) => { const A = f.A, B = f.B, S = f.sink; return (i) => { S[0] = A.nextClearBit() + B.highestClearBit(); }; } },
    { name: 'nextSetBit walk', op: (f) => { const A = f.A, S = f.sink; return (i) => { let n = 0; for (let b = A.nextSetBit(0); b !== -1; b = A.nextSetBit(b + 1)) n += b; S[0] = n; }; } },
    { name: 'prevSetBit walk', op: (f) => { const A = f.A, S = f.sink; return (i) => { let n = 0; for (let b = A.prevSetBit(63); b !== -1; b = A.prevSetBit(b - 1)) n += b; S[0] = n; }; } },
    { name: 'rank/select', op: (f) => { const A = f.A, S = f.sink; return (i) => { S[0] = A.rank(i & 63) + A.select(i & 15); }; } },
    { name: 'rank(31)/rank(63)', op: (f) => { const A = f.A, B = f.B, E = f.E, S = f.sink; return (i) => { S[0] = A.rank(31) + B.rank(63) + E.rank(31 + (i & 32)); }; } },
    { name: 'addRange/removeRange', op: (f) => { const W = f.W, S = f.sink; return (i) => { const a = i & 31; W.addRange(a, a + (i & 31)); W.removeRange(a, 64); S[0] = W.lo; }; } },
    { name: 'countRange', op: (f) => { const A = f.A, S = f.sink; return (i) => { const a = i & 31; S[0] = A.countRange(a, a + 33); }; } },
    { name: 'setWords/equalsWords', op: (f) => { const W = f.W, S = f.sink; return (i) => { W.setWords(i | -0x80000000, 0xFFFFFFFF); S[0] = W.equalsWords(-1, 0xFFFFFFFF) ? 1 : 0; }; } },
    { name: 'lo/hi getters', op: (f) => { const A = f.A, S = f.sink; return (i) => { S[0] = A.lo ^ A.hi; }; } },
    { name: 'isEmpty/isFull', op: (f) => { const A = f.A, E = f.E, F = f.F, S = f.sink; return (i) => { S[0] = (E.isEmpty() ? 1 : 0) | (F.isFull() ? 2 : 0) | (((i & 1) === 0 ? A : F).isFull() ? 4 : 0); }; } },
    { name: 'clear', op: (f) => { const W = f.W, S = f.sink; return (i) => { S[0] = W.add(i & 63).clear().hi; }; } },
    { name: 'forEach (hoisted cb)', op: (f) => { const A = f.A, cb = f.cb, S = f.sink; return (i) => { A.forEach(cb); S[0] = S[1]; }; } },
    { name: 'saveInto', op: (f) => { const A = f.A, OUT = f.OUT, S = f.sink; return (i) => { S[0] = A.saveInto(OUT, (i & 1) * 3); }; } },
    { name: 'loadFrom', op: (f) => { const W = f.W, IMG = f.IMG, S = f.sink; return (i) => { S[0] = W.loadFrom(IMG, 0); }; } },
    { name: 'copy', op: (f) => { const A = f.A, B = f.B, W = f.W, S = f.sink; return (i) => { S[0] = W.copy((i & 1) === 0 ? A : B).hi; }; } },
    { name: 'CONTROL u32(lo) return', control: true, op: (f) => { const A = f.A, S = f.sink; return (i) => { S[0] = u32(A.lo ^ (i & 1)) > 3e9 ? 1 : 0; }; } }
]);

export const FB64_LANE_NAMES = Object.freeze(FB64_LANES.map((l) => l.name));
