// test/torture/controls.mjs -- the control registry. Each control is a
// deliberately broken variant that MUST make its target tier(s) fail; if a
// control passes, the gate it targets is decorative (ROADMAP section 5, T9).
// `apply(ctx)` mutates the ctx in place. `cheap` controls run in-process inside
// T9; the rest are exercised as child processes by controls-runner.mjs.

import { FB64_LANE_NAMES } from './fb64-lanes.mjs';

function oldHasAll(FB) {
    // The 1.2.0 (pre-FB-01) body: `(value & mask) === mask` compares a signed
    // int32 to an unsigned double, so any mask carrying bit 31 in unsigned form
    // never matches. S1 fixed hasAll in place on the prototype, which also
    // reaches clone()/deserialize() results. This control REINSTALLS the buggy
    // body. clone() and static deserialize() hard-code `new FastBit32(...)`
    // (FastBit32.js), returning base (fixed) instances, so both are overridden
    // to construct the subclass -- otherwise the clone/deserialize build forms
    // in T2 would stay fixed and the control would leave rows green. With the
    // overrides every build form carries the bug and it MUST fail T0, T1, T2,
    // T3, T5, T8.
    return class extends FB {
        hasAll(mask) { return (this.value & mask) === mask; }
        clone() { return new this.constructor(this.value); }
        static deserialize(value) { return new this(value); }
    };
}

function lowestNoGuard(FB) {
    // The pre-S3 XOR-31 idiom with its zero guard removed. The shipped body
    // (S3, `31 - clz32`) needs no guard; this override keeps the T0/T1 empty-word
    // rows honest: they MUST see 63 instead of -1 and fail.
    return class extends FB {
        lowest() { return Math.clz32(this.value & -this.value) ^ 31; } // no zero guard -> 63 on empty
    };
}

function nextSetNoWrap(FB) {
    // S4 nextSetBit WITHOUT the `(from - 32) >> 31` term: at from === 32 the
    // shift count wraps to 0, so nextSetBit(32) returns lowest() instead of -1
    // and the cursor `b = nextSetBit(b + 1)` restarts at the bottom (an endless
    // walk on any word with bit 31 set). T0 (cursor == forEach, nextSetBit(32))
    // and T5 (bounded cursor walk) MUST fail.
    return class extends FB {
        nextSetBit(from) {
            const w = this.value & (-1 << (from & 31));
            return 31 - Math.clz32(w & -w);
        }
    };
}

function isFullUnsigned(FB) {
    return class extends FB {
        isFull() { return this.value === 0xFFFFFFFF; } // wrong on signed -1
    };
}

function fb1024Sparse(C) {
    // The SparseBit1024 policy (RESEARCH Appendix A, 11.2): nextClearBit and
    // acquire route through the first EMPTY word, `~_active & (_active + 1)`,
    // instead of the first NOT-FULL word. Lowest-slot reuse is lost (a free slot
    // in a partly used word is skipped). T1 (fill order) and T5 MUST fail.
    return class extends C {
        nextClearBit() {
            const a = this._active;
            const s = (31 - Math.clz32(~a & (a + 1))) << 5;
            return s >= 0 && s < this._cap ? s : -1;
        }
        acquire() {
            const s = this.nextClearBit();
            if (s !== -1) this.add(s);
            return s;
        }
    };
}

function fb1024NoFull(C) {
    // One summary instead of two (RESEARCH 11.3 d): the `_full` summary is never
    // set, so nextClearBit/acquire land on word 0 even when it is full. T0 (I2
    // after every op) and T5 MUST fail.
    return class extends C {
        add(bit) { super.add(bit); this._full = 0; return this; }
        acquire() { const s = super.acquire(); this._full = 0; return s; }
    };
}

function fb1024ClearLow16(C) {
    // The reviewer's clear-low16 mutant: clear() zeroes only words 0-15 but
    // resets every summary, so bits in words 16-31 survive under _active = 0
    // (I1 broken, has() answers true for a cleared slot). T0 and T5 MUST fail.
    return class extends C {
        clear() {
            const data = this._data;
            for (let a = this._active & 0xffff; a !== 0; a &= a - 1) data[31 - Math.clz32(a & -a)] = 0;
            this._active = 0; this._full = 0; this._n = 0;
            return this;
        }
    };
}

function fb1024AcqHighword(C) {
    // The reviewer's acq-highword mutant: in a word >= 16 that is non-empty, has
    // bit 0 clear and more than one clear bit, acquire takes the SECOND-lowest
    // clear bit. Unit tests miss it; T0 (acquire === prior nextClearBit) and T5
    // (oracle) MUST fail.
    return class extends C {
        acquire() {
            const f = ~this._full;
            if (f === 0) return -1;
            const w = 31 - Math.clz32(f & -f), data = this._data, old = data[w], c = ~old;
            const c2 = c & (c - 1);
            const m = (w >= 16 && old !== 0 && (old & 1) === 0 && c2 !== 0) ? (c2 & -c2) : (c & -c);
            const s = (w << 5) + (31 - Math.clz32(m));
            if (s >= this._cap) return -1;
            const d = old | m;
            data[w] = d;
            this._n++;
            this._active |= 1 << w;
            this._full |= (Math.clz32(~d) >>> 5) << w;
            return s;
        }
    };
}

// ---- S5 Tier-2 controls (T0 + T5 must both go red) --------------------------
function selectNoSentinel(FB) {
    // The shipped select WITHOUT the `| q` sign / count term: k >= count() and
    // k < 0 return the descent's leftover position instead of -1. T0 (oracle at
    // k = -1..33, select(count()-1) === highest() on an empty word) and T5
    // (select(count()) === -1) MUST fail.
    return class extends FB {
        select(k) {
            const v = this.value, q = k | 0;
            const c2 = v - ((v >>> 1) & 0x55555555);
            const c4 = (c2 & 0x33333333) + ((c2 >>> 2) & 0x33333333);
            const c8 = (c4 + (c4 >>> 4)) & 0x0F0F0F0F;
            const c16 = (c8 + (c8 >>> 8)) & 0x00FF00FF;
            let r = q, t = c16 & 31, m = (t - r - 1) >> 31, s = m & 16; r -= m & t;
            t = (c8 >>> s) & 15; m = (t - r - 1) >> 31; s += m & 8; r -= m & t;
            t = (c4 >>> s) & 7;  m = (t - r - 1) >> 31; s += m & 4; r -= m & t;
            t = (c2 >>> s) & 3;  m = (t - r - 1) >> 31; s += m & 2; r -= m & t;
            t = (v >>> s) & 1;   m = (t - r - 1) >> 31; s += m & 1;
            return s;
        }
    };
}

function selectDescentOff(FB) {
    // The off-by-one descent: `(t - r) >> 31` (go high when t < r) instead of
    // `(t - r - 1) >> 31` (go high when t <= r), so a half holding exactly r
    // bits is entered instead of skipped. Sentinel kept. T0 (oracle, both
    // inverse laws) and T5 (select(bit) vs the oracle) MUST fail.
    return class extends FB {
        select(k) {
            const v = this.value, q = k | 0;
            const c2 = v - ((v >>> 1) & 0x55555555);
            const c4 = (c2 & 0x33333333) + ((c2 >>> 2) & 0x33333333);
            const c8 = (c4 + (c4 >>> 4)) & 0x0F0F0F0F;
            const c16 = (c8 + (c8 >>> 8)) & 0x00FF00FF;
            let r = q, t = c16 & 31, m = (t - r) >> 31, s = m & 16; r -= m & t;
            t = (c8 >>> s) & 15; m = (t - r) >> 31; s += m & 8; r -= m & t;
            t = (c4 >>> s) & 7;  m = (t - r) >> 31; s += m & 4; r -= m & t;
            t = (c2 >>> s) & 3;  m = (t - r) >> 31; s += m & 2; r -= m & t;
            t = (v >>> s) & 1;   m = (t - r) >> 31; s += m & 1;
            return s | (((((c16 + (c16 >>> 16)) & 63) + ~q) | q) >> 31);
        }
    };
}

function nextSubsetNoMask(FB) {
    // nextSubset without the `& mask`: `(sub - 1) | 0` counts down through
    // every integer, not the submasks. T0 (bounded walk: oracle, submask,
    // 2^popcount values) and T5 (oracle on a random submask) MUST fail.
    return class extends FB {
        static nextSubset(sub, mask) { return (sub - 1) | 0; }
    };
}

function nextCombNoSentinel(FB) {
    // The brief's Gosper formula without the end mask `& ((r | -r) >> 31)`: the
    // r ^ v carry out of bit 31 is lost, so the top block of k >= 3 bits maps to
    // a low block (k = 3 -> 1) instead of 0, and f(-1) = 0x3FFFFFFF. T0 (walk
    // ends at 0 after C(32, k) words; pinned f(-1), f(0xE0000000)) and T5 (top
    // block vs the oracle) MUST fail.
    return class extends FB {
        static nextCombination(v) {
            const c = v & -v, r = (v + c) | 0;
            return (((r ^ v) >>> 2) >>> (31 - Math.clz32(c))) | r;
        }
    };
}

function dedupMapper(Mapper) {
    return class extends Mapper {
        constructor(names) {
            if (Array.isArray(names)) {
                const seen = new Set();
                const dd = [];
                for (const n of names) { if (!seen.has(n)) { seen.add(n); dd.push(n); } }
                super(dd);
            } else {
                super(names);
            }
        }
    };
}

// ---- G1 (1.6.0) save / restore / brand mutants ------------------------------
// fb1024Img(C, m) returns a subclass of the library class whose saveInto,
// loadFrom, copy, clone and static deserialize (G1) and prevSetBit,
// intersectionSize, unionSize and differenceSize (G2) are line-for-line copies
// of the shipped bodies (FastBit32.js 9bf93553), each mutation behind one flag of `m`.
// L3 addRange / removeRange (FastBit32.js 929849db) are thin overrides: the
// library body runs through super, and the flag adds one wrong step after it
// (M6 sets bit hi too, M7 puts _active back). With m = {} the subclass is
// FAITHFUL: test/torture.mjs re-runs T0, T3 and T5 on it and requires all green
// (control fidelity), so a control below fails its
// tier because of its one flag, not because the copy drifted. The copies
// cannot read the private brand; the unmutated guard is the library's own,
// borrowed side-effect free through C.prototype.hasAny.call(this, other).
// clone / deserialize construct `this` class (the library's construct the base
// class), so every build form carries the mutation.
const FB1024_TA = Object.getPrototypeOf(Int32Array.prototype);
const mTaLength = Object.getOwnPropertyDescriptor(FB1024_TA, 'length').get;
const mTaTag = Object.getOwnPropertyDescriptor(FB1024_TA, Symbol.toStringTag).get;
function mShow(v) { return typeof v === 'number' ? String(v) : typeof v; }
function mBadBuf(what) { throw new TypeError('FastBit1024: ' + what + ' must be an Int32Array'); }
function mBadOffset(off) { throw new RangeError('FastBit1024: offset must be a non-negative integer that fits the image, got ' + mShow(off)); }
function mBadImage(why) { throw new RangeError('FastBit1024: bad image: ' + why); }
function mBadFit(cap) { throw new RangeError('FastBit1024: a set bit is at or above capacity ' + cap); }
function mBadOther(o) { throw new TypeError('FastBit1024: expected a FastBit1024, got ' + (o === null ? 'null' : typeof o)); }
function mBadFrom(from, cap) { throw new RangeError('FastBit1024: from must be an integer -1..' + (cap - 1) + ', got ' + mShow(from)); }
function mPop(v) {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
}

function fb1024Img(C, m) {
    // the Int32Array brand (C-4) and its mutants M3 / M11 / M14
    const brand = (x) => {
        if (m.arrayBrand && Array.isArray(x)) return true;                       // M3
        if (m.instanceofOnly) return x instanceof Int32Array;                     // M11
        if (!ArrayBuffer.isView(x) || !(x instanceof Int32Array)) return false;
        return m.noTag === true || mTaTag.call(x) === 'Int32Array';               // M14
    };
    // one length read, through the intrinsic getter; M13 reads `.length`
    const len = (x) => (m.ownLength || Array.isArray(x) ? x.length : mTaLength.call(x));
    // the set brand (C-3); M12 / M6 / equals use `instanceof` instead
    const guard = (self, other, inst) => {
        if (inst) { if (!(other instanceof C)) mBadOther(other); } else C.prototype.hasAny.call(self, other);
    };
    class Img extends C {
        saveInto(out, offset = 0) {
            if (!brand(out)) mBadBuf('out');
            if ((offset & 0x3FFFFFFF) !== offset) mBadOffset(offset);
            const L = (this._cap + 31) >>> 5;
            if (offset + 1 + L > len(out)) mBadOffset(offset);
            const d = this._data;
            out[offset] = 0x46420800 | this._cap;
            for (let w = 0; w < L; w++) out[offset + 1 + w] = d[w];
            return offset + 1 + L;
        }

        loadFrom(src, offset = 0) {
            if (!brand(src)) mBadBuf('src');
            if ((offset & 0x3FFFFFFF) !== offset) mBadOffset(offset);
            const n0 = len(src);
            if (offset >= n0) mBadOffset(offset);
            const h = src[offset];
            if ((h & -2048) !== 0x46420800) mBadImage('header');
            const icap = h & 2047;
            if (icap < 1 || icap > 1024) mBadImage('capacity');
            const L = (icap + 31) >>> 5, base = offset + 1;
            if (base + L > n0) mBadImage('length');
            const r = icap & 31;
            if (m.noTail !== true && r !== 0 && (src[base + L - 1] & (-1 << r)) !== 0) mBadImage('bit >= image capacity'); // M1
            const cap = this._cap;
            if (m.noFit !== true && icap > cap) {                                                                       // M2
                const cw = cap >>> 5, cr = cap & 31;
                if (cr !== 0 && (src[base + cw] & (-1 << cr)) !== 0) mBadFit(cap);
                for (let w = cr !== 0 ? cw + 1 : cw; w < L; w++) if (src[base + w] !== 0) mBadFit(cap);
            }
            const lim = icap < cap ? icap : cap, lw = (lim + 31) >>> 5, lm = ~(-2 << ((lim - 1) & 31));
            const d = this._data;
            let act = 0, full = 0, n = 0;
            for (let w = 0; w < 32; w++) {
                const v = w < lw ? (w === lw - 1 && m.noMask !== true ? src[base + w] & lm : src[base + w] | 0) : 0;  // C-14 mask
                d[w] = v;
                n += mPop(v);
                act |= ((Math.clz32(v) >>> 5) ^ 1) << w;
                if (m.noFull !== true) full |= (Math.clz32(~v) >>> 5) << w;                                             // M5
            }
            this._active = act;
            this._full = full;
            this._n = n;
            return base + L;
        }

        static deserialize(src, offset = 0) {
            const s = new this(1024);
            s.loadFrom(src, offset);
            const c = src[offset] & 2047, a = s._active, hw = 31 - Math.clz32(a);
            if ((m.noCapRange !== true && (c < 1 || c > 1024)) || (a !== 0 && (hw << 5) + (31 - Math.clz32(s._data[hw])) >= c)) mBadImage('header'); // R6
            if (m.noCap !== true) s._cap = c;                                                                          // r1 M8
            return s;
        }

        copy(other) {
            guard(this, other, m.copyInstanceof === true);                                                             // M12
            if (other === this) return this;
            if (m.copyEarlyN === true) this._n = other._n;                                                             // r1 M3
            const oa = other._active;
            if (m.copyNoFit !== true && oa !== 0) {                                                                    // M4
                const w = 31 - Math.clz32(oa), hi = (w << 5) + (31 - Math.clz32(other._data[w]));
                if (hi >= this._cap) mBadFit(this._cap);
            }
            const d = this._data, od = other._data;
            for (let a = this._active | oa; a !== 0; a &= a - 1) {
                const w = 31 - Math.clz32(a & -a);
                d[w] = od[w];
            }
            this._active = oa;
            this._full = other._full;
            this._n = other._n;
            return this;
        }

        clone() { return new this.constructor(this._cap).copy(this); }

        // G2: the in-word mask keeps bit `from` (`-2 <<`); M8 drops it (`-1 <<`)
        prevSetBit(from) {
            if (from !== -1 && ((from & 1023) !== from || from >= this._cap)) mBadFrom(from, this._cap);
            if (from < 0) return -1;
            const w = from >>> 5;
            const d = this._data[w] & (m.prevStrict === true ? ~(-1 << (from & 31)) : ~(-2 << (from & 31)));      // M8
            if (d !== 0) return (w << 5) + (31 - Math.clz32(d));
            const a = this._active & ~(-1 << w);
            if (a === 0) return -1;
            const w2 = 31 - Math.clz32(a);
            return (w2 << 5) + (31 - Math.clz32(this._data[w2]));
        }

        // G2: M9 popcounts od[w] alone instead of od[w] & td[w]
        intersectionSize(other) {
            guard(this, other, false);
            const od = other._data, td = this._data;
            let n = 0;
            for (let a = other._active & this._active; a !== 0; a &= a - 1) {
                const w = 31 - Math.clz32(a & -a);
                let v = m.interOtherOnly === true ? od[w] : od[w] & td[w];                                           // M9
                v = v - ((v >>> 1) & 0x55555555);
                v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
                n += Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
            }
            return n;
        }

        unionSize(other) {
            guard(this, other, false);
            return this._n + other._n - this.intersectionSize(other);
        }

        differenceSize(other) {
            guard(this, other, false);
            return this._n - this.intersectionSize(other);
        }

        // L3: M6 makes the range INCLUSIVE ([lo, hi] instead of [lo, hi)); M7
        // leaves _active stale after a removeRange that empties a word
        addRange(lo, hi) {
            const r = super.addRange(lo, hi);
            if (m.rangeInclusive === true && lo < hi && hi < this._cap) this.add(hi);                                // M6
            return r;
        }

        removeRange(lo, hi) {
            const act = this._active;
            const r = super.removeRange(lo, hi);
            if (m.removeKeepsActive === true) this._active = act;                                                     // M7
            return r;
        }
    }
    if (m.hasAllInstanceof === true) {                                                                                 // M12
        Img.prototype.hasAll = function hasAll(other) {
            guard(this, other, true);
            if ((other._active & ~this._active) !== 0) return false;
            const od = other._data, td = this._data;
            for (let a = other._active; a !== 0; a &= a - 1) { const w = 31 - Math.clz32(a & -a); if ((od[w] & ~td[w]) !== 0) return false; }
            return true;
        };
    }
    if (m.hasAnyInstanceof === true) {                                                                                 // M12 / r1 M6
        Img.prototype.hasAny = function hasAny(other) {
            guard(this, other, true);
            const od = other._data, td = this._data;
            for (let a = other._active & this._active; a !== 0; a &= a - 1) { const w = 31 - Math.clz32(a & -a); if ((od[w] & td[w]) !== 0) return true; }
            return false;
        };
    }
    if (m.equalsInstanceof === true) {
        Img.prototype.equals = function equals(other) {
            guard(this, other, true);
            if (this._n !== other._n || this._active !== other._active) return false;
            const d = this._data, od = other._data;
            for (let a = this._active; a !== 0; a &= a - 1) { const w = 31 - Math.clz32(a & -a); if (d[w] !== od[w]) return false; }
            return true;
        };
    }
    return Img;
}

export function fb1024Faithful(C) { return fb1024Img(C, {}); }

function fb1024SabCopy(C, which) {
    // Not a library mutant: a harness control for the T3 SAB row's coverage
    // floors (DESER-FIX). 'deser': deserialize reads a private slice() of a
    // SharedArrayBuffer-backed source, so the writer can never land between its
    // two header reads. 'load': loadFrom does the same, so the tail check and
    // the write pass always see one word. Every other source passes through
    // untouched (ArrayBuffer.isView first: a Proxy never reaches .buffer).
    const shared = (x) => ArrayBuffer.isView(x) && x instanceof Int32Array && x.buffer instanceof SharedArrayBuffer;
    return class extends C {
        loadFrom(src, offset = 0) { return super.loadFrom(which === 'load' && shared(src) ? src.slice() : src, offset); }
        static deserialize(src, offset = 0) { return super.deserialize(which === 'deser' && shared(src) ? src.slice() : src, offset); }
    };
}

function highestOld(FB) {
    // T6-FIX2: reinstalls the 1.6.0 highest body `31 - Math.clz32(this.value)`
    // ON ctx.FB.prototype (the orch-confirm 3/3 mechanism: a prototype patch,
    // not a subclass, so every FB the T6 lanes build carries it). A method
    // (non-constructible, like a class method), non-enumerable as in a class.
    // cheap: false -- it mutates the shared FastBit32 prototype, so it runs only
    // in its own child process (t9-controls.mjs skips every non-cheap control).
    // The T6 pre-pass poisons its clz32 slot: both unsigned composite lanes MUST
    // read 16 B/op (optimized), no SIGNED lane may fail.
    const old = { highest() { return 31 - Math.clz32(this.value); } };
    Object.defineProperty(FB.prototype, 'highest', { value: old.highest, writable: true, enumerable: false, configurable: true });
}

// B.B2 fb64-bop-box: every FastBit64 inlined lane (fb64-lanes.mjs, the control
// lane included) must fail T6 at >= 15.9 B/op with >= 3 valid windows.
const FB64_BOXED = '(?:15\\.9\\d\\d|(?:1[6-9]|[2-9]\\d|\\d{3,})\\.\\d{3}) B\\/op, valid=[3-7] \\(expected < 0\\.1, >= 3 valid\\)';
const FB64_BOP_BOX_EXPECT = new RegExp('^' + FB64_LANE_NAMES.map((n) => '(?=[\\s\\S]*T6 FB64 lane ' + n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + ' = ' + FB64_BOXED + ')').join(''));

function flipOracle(oracle) {
    // one corrupted function: popcount off by one -> every T5 count check diverges
    return { ...oracle, oCount: (v) => oracle.oCount(v) + 1 };
}

export const CONTROLS = {
    'hasall-old': { tiers: ['T0', 'T1', 'T2', 'T3', 'T5', 'T8'], cheap: true, expect: /T3: ECS size-1 idx 31(?!\d)/, apply(ctx) { ctx.FB = oldHasAll(ctx.FB); } },
    'lowest-noguard': { tiers: ['T0', 'T1'], cheap: true, apply(ctx) { ctx.FB = lowestNoGuard(ctx.FB); } },
    'nextset-nowrap': { tiers: ['T0', 'T5'], cheap: true, apply(ctx) { ctx.FB = nextSetNoWrap(ctx.FB); } },
    'isfull-unsigned': { tiers: ['T3'], cheap: true, expect: /T3: pool not full after 32 adds \(isFull teeth\)/, apply(ctx) { ctx.FB = isFullUnsigned(ctx.FB); } },
    'fb1024-sparse': { tiers: ['T1', 'T5'], cheap: true, apply(ctx) { ctx.FB1024 = fb1024Sparse(ctx.FB1024); } },
    'fb1024-nofull': { tiers: ['T0', 'T5'], cheap: true, apply(ctx) { ctx.FB1024 = fb1024NoFull(ctx.FB1024); } },
    'fb1024-clear-low16': { tiers: ['T0', 'T5'], cheap: true, apply(ctx) { ctx.FB1024 = fb1024ClearLow16(ctx.FB1024); } },
    'fb1024-acq-highword': { tiers: ['T0', 'T5'], cheap: true, apply(ctx) { ctx.FB1024 = fb1024AcqHighword(ctx.FB1024); } },
    'select-nosentinel': { tiers: ['T0', 'T5'], cheap: true, apply(ctx) { ctx.FB = selectNoSentinel(ctx.FB); } },
    'select-descent-off': { tiers: ['T0', 'T5'], cheap: true, apply(ctx) { ctx.FB = selectDescentOff(ctx.FB); } },
    'nextsubset-nomask': { tiers: ['T0', 'T5'], cheap: true, apply(ctx) { ctx.FB = nextSubsetNoMask(ctx.FB); } },
    'nextcomb-nosentinel': { tiers: ['T0', 'T5'], cheap: true, apply(ctx) { ctx.FB = nextCombNoSentinel(ctx.FB); } },
    'mapper-dedup': { tiers: ['T4'], cheap: true, apply(ctx) { ctx.Mapper = dedupMapper(ctx.Mapper); } },
    'oracle-flip': { tiers: ['T5'], cheap: true, apply(ctx) { ctx.oracle = flipOracle(ctx.oracle); } },
    // G1 (1.6.0) save / restore / brand, all cheap; C-14 race controls are child-process only
    'fb1024-img-notail': { tiers: ['T3'], cheap: true, expect: /T3: FB1024 img cap \d+ bit == capacity: did not throw \(want RangeError\)/, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { noTail: true }); } },
    'fb1024-img-nofit': { tiers: ['T3'], cheap: true, expect: /T3: FB1024 img cap \d+ load a 1024-image with bit \d+: did not throw \(want RangeError\)/, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { noFit: true }); } },
    'fb1024-img-array': { tiers: ['T3'], cheap: true, expect: /T3: FB1024 img cap \d+ Array image: did not throw \(want TypeError\)/, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { arrayBrand: true }); } },
    'fb1024-copy-nofit': { tiers: ['T3'], cheap: true, expect: /T3: FB1024 img cap \d+ copy from a 1024-set with bit \d+: did not throw \(want RangeError\)/, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { copyNoFit: true }); } },
    'fb1024-img-nofull': { tiers: ['T0'], cheap: true, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { noFull: true }); } },
    'fb1024-img-instanceof': { tiers: ['T3'], cheap: true, expect: /T3: FB1024 img cap \d+ Proxy\(Int32Array\) image: /, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { instanceofOnly: true }); } },
    'fb1024-set-instanceof': { tiers: ['T3'], cheap: true, expect: /^(?=[\s\S]*T3: FB1024 img Q-8 copy\(forgery\): did not throw)(?=[\s\S]*T3: FB1024 img Q-8 hasAll\(forgery\): did not throw)(?=[\s\S]*T3: FB1024 img Q-8 hasAny\(forgery\): did not throw)/, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { copyInstanceof: true, hasAllInstanceof: true, hasAnyInstanceof: true }); } },
    'fb1024-img-length': { tiers: ['T3'], cheap: true, expect: /T3: FB1024 img p8 Liar subclass \(5 real words of 17\) loadFrom: did not throw \(want RangeError\)/, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { ownLength: true }); } },
    'fb1024-img-notag': { tiers: ['T3'], cheap: true, expect: /T3: FB1024 img Q-10 saveInto\(Int8Array re-prototyped\): did not throw \(want TypeError\)/, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { noTag: true }); } },
    'fb1024-copy-early-n': { tiers: ['T3'], cheap: true, expect: /T3: FB1024 img cap \d+ copy from a 1024-set with bit \d+: receiver changed by a rejected call/, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { copyEarlyN: true }); } },
    'fb1024-hasany-instanceof': { tiers: ['T3'], cheap: true, expect: /T3: FB1024 img Q-8 hasAny\(forgery\): did not throw \(want TypeError\)/, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { hasAnyInstanceof: true }); } },
    'fb1024-equals-instanceof': { tiers: ['T3'], cheap: true, expect: /T3: FB1024 img Q-8 equals\(forgery\): did not throw \(want TypeError\)/, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { equalsInstanceof: true }); } },
    'fb1024-deser-nocap': { tiers: ['T0'], cheap: true, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { noCap: true }); } },
    // G2 (1.6.0) prevSetBit / counts
    'fb1024-prev-strict': { tiers: ['T0'], cheap: true, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { prevStrict: true }); } },
    'fb1024-inter-other-only': { tiers: ['T0'], cheap: true, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { interOtherOnly: true }); } },
    // L3 (1.6.0) addRange / removeRange
    'fb1024-range-inclusive': { tiers: ['T5'], cheap: true, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { rangeInclusive: true }); } },
    'fb1024-remove-keeps-active': { tiers: ['T5'], cheap: true, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { removeKeepsActive: true }); } },
    'fb1024-img-nomask': { tiers: ['T3'], cheap: false, expect: /FB1024 SAB: \d+ invariant \/ capacity break\(s\) under a concurrent writer, first: loadFrom cap \d+: I4 bit \d+ >= cap \d+/, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { noMask: true }); } },
    'fb1024-deser-norange': { tiers: ['T3'], cheap: false, expect: /FB1024 SAB: \d+ invariant \/ capacity break\(s\) under a concurrent writer, first: deserialize: _cap (?:0|2047) outside 1\.\.1024/, apply(ctx) { ctx.FB1024 = fb1024Img(ctx.FB1024, { noCapRange: true }); } },
    // DESER-FIX: the SAB row's window-coverage floors. Each reads a private copy
    // of the shared source, so the writer can never land inside the race window;
    // answers stay valid, so ONLY that coverage floor can fail T3.
    'fb1024-deser-snapshot': { tiers: ['T3'], cheap: false, expect: /^(?![\s\S]*FB1024 SAB: \d+ invariant)[\s\S]*FB1024 SAB coverage: deserialize hit the header re-read window 0 times in 64 chunk\(s\) \(need >= 64\) -- fail closed/, apply(ctx) { ctx.FB1024 = fb1024SabCopy(ctx.FB1024, 'deser'); } },
    'fb1024-load-snapshot': { tiers: ['T3'], cheap: false, expect: /^(?![\s\S]*FB1024 SAB: \d+ invariant)[\s\S]*FB1024 SAB coverage: loadFrom cap 500 hit the tail-word window 0 times in 64 chunk\(s\) \(need >= 8\) -- fail closed/, apply(ctx) { ctx.FB1024 = fb1024SabCopy(ctx.FB1024, 'load'); } },
    // T9's `expect` branch: isfull-unsigned is checked against fb1024-img-notail's
    // expect, so it still fails T3 but for the wrong reason -> T9 must go red.
    't9-expect-swap': { tiers: ['T9'], cheap: false, expect: /T9: control "isfull-unsigned" failed T3 but for another reason: no fail matched \/T3: FB1024 img cap/, apply(ctx) { ctx.control.t9ExpectSwap = ['isfull-unsigned', 'fb1024-img-notail']; } },
    'foreach-closure': { tiers: ['T6'], cheap: false, apply(ctx) { ctx.control.foreachClosure = true; } },
    'budget-major': { tiers: ['T6'], cheap: false, apply(ctx) { ctx.control.budgetMajor = true; } },
    'bop-box': { tiers: ['T6'], cheap: false, apply(ctx) { ctx.control.bopBox = true; } },
    // T6-FIX: %NeverOptimizeFunction on every measured op. measureBop must refuse
    // the lane ("op not optimized") rather than measure it -- such an op reads
    // 0 B/op here (Sparkplug op, TurboFan callees), so only the check can fail it.
    'bop-unoptimized': { tiers: ['T6'], cheap: false, expect: /T6 B\/op: unsigned lane 0xFFFFFFFF = NaN B\/op, valid=0 \(expected < 0\.1, >= 3 valid\) -- not verified-optimized: op not optimized \(status 0x[0-9a-f]+ (?![^)]*turbofan)/, apply(ctx) { ctx.control.bopUnoptimized = true; } },
    'bop-unoptimized-callee': { tiers: ['T6'], cheap: false, expect: /T6 B\/op: unsigned lane 0xFFFFFFFF = NaN B\/op, valid=0 \(expected < 0\.1, >= 3 valid\) -- not verified-optimized: callee [^(]+ not optimized and not inlined \(status 0x[0-9a-f]+ (?![^)]*turbofan)/, apply(ctx) { ctx.control.bopUnoptimizedCallee = true; } },
    't6-highest-old': { tiers: ['T6'], cheap: false, expect: /^(?=[\s\S]*T6 B\/op: unsigned lane 0xFFFFFFFF = (?:15\.9\d\d|16\.\d{3}) B\/op, valid=[3-7] \(expected < 0\.1, >= 3 valid\)(?! --))(?=[\s\S]*T6 B\/op: unsigned lane 2\*\*31 = (?:15\.9\d\d|16\.\d{3}) B\/op, valid=[3-7] \(expected < 0\.1, >= 3 valid\)(?! --))(?![\s\S]*T6 B\/op: SIGNED lane)/, apply(ctx) { highestOld(ctx.FB); } },
    'soak-stash': { tiers: ['T7'], cheap: false, apply(ctx) { ctx.control.soakStash = true; } },
    'soak-retain': { tiers: ['T7'], cheap: false, apply(ctx) { ctx.control.soakRetain = true; } },
    // B-S7: pins every FastBit64 row result; must fail T7 on THAT row (the soak
    // segments and the FastBit1024 image row stay clean; the final
    // `T7: tracker.size() = 20000` line also fires). live=4000 pins cycle 0 to
    // the full 1000 x 4 tracked results.
    'fb64-soak-retain': { tiers: ['T7'], cheap: false, expect: /^(?![\s\S]*T7: segment \d+ did not drain)(?![\s\S]*T7: FastBit1024 image cycle)[\s\S]*T7: FastBit64 retention cycle 0 did not drain to 0 \(live=4000; clone \/ serialize \/ deserialize \/ toArray results retained\)/, apply(ctx) { ctx.control.fb64Retain = true; } },
    // B-S5: the FB64 poison rows without 'highest' -> the census check names it.
    'fb64-poison-row-drop': { tiers: ['T6'], cheap: false, expect: /T6 FB64 poison census: [^\n]*missing rows \[highest\], rows not in the census \[\]/, apply(ctx) { ctx.control.fb64PoisonRowDrop = 'highest'; } },
    // B-S5, re-pinned by A16: ctx.FB64 = the u32 variant (`| 0` storage -> `>>> 0`,
    // torture.mjs applyFb64Variant before T6). Its fields are Double, so the store
    // is in place and the box is on the READ: the "shipped" word-E witness takes
    // 2^31 out of the private field through the poisoned clz32 slot, one HeapNumber
    // per read, on verified code. The fixture, lowest/highest and scavenge-mix rows
    // co-occur; this row names the mutant's read box.
    'fb64-u32-storage': { tiers: ['T6'], cheap: false, expect: /T6 FB64 witness: shipped E \(bit 63 only\) highest\^lowest = (?:15\.9\d\d|(?:1[6-9]|[2-9]\d|\d{3,})\.\d{3}) B\/op, valid=[3-7] \(expected < 0\.1, >= 3 valid: an int32 word passes a poisoned slot as a Smi\)(?! -- )/, apply(ctx) { ctx.control.fb64Variant = 'u32'; } },
    // B-S3: one HeapNumber per op on every FastBit64 inlined lane.
    'fb64-bop-box': { tiers: ['T6'], cheap: false, expect: FB64_BOP_BOX_EXPECT, apply(ctx) { ctx.control.fb64BopBox = true; } },
    // A4: every FastBit64 poisoning pass runs WITHOUT FB64_POISON_OPTS (t6-alloc
    // fb64Poison, the one call site): the public-mirror read witness must read
    // < 15.9 B/op on verified code and name the pass.
    'fb64-poison-opts-drop': { tiers: ['T6'], cheap: false, expect: /T6 FB64 witness: pub E \(bit 63 only\) highest\^lowest = -?\d+\.\d{3} B\/op, valid=[3-7] \(expected >= 15\.9, >= 3 valid: a public uint32 word read through a poisoned clz32 slot is one HeapNumber per read\) -- the FB64 poisoning pass did not take(?! -- )/, apply(ctx) { ctx.control.fb64PoisonOptsDrop = true; } },
    // B-S4: the --no-turbo-inlining child spawned WITHOUT the flag (t6-alloc
    // fb64NoinlineLane): the u32 control lane inlines and reads < 15.9 B/op on
    // verified code. Only that row is expected (the execArgv row co-occurs);
    // no non-control noinline lane may fail.
    'fb64-noinline-flag-drop': { tiers: ['T6'], cheap: false, expect: /^(?![\s\S]*T6 FB64 noinline: lane )[\s\S]*T6 FB64 noinline: control lane CONTROL u32\(lo\) return = -?\d+\.\d{3} B\/op, valid=[3-7] \(expected >= 15\.9, >= 3 valid: a uint32 returned through a call that is not inlined is one HeapNumber per op\) -- the run cannot see boxing(?! -- )/, apply(ctx) { ctx.control.fb64NoinlineFlagDrop = true; } },
    // B-S1 (T3 FB64 SAB row). Both cheap: false -- fb64-sab-reread needs torture.mjs
    // applyFb64Variant (T9's sub-ctx never applies a variant), and fb64-sab-blind runs
    // the row to its 1024-chunk cap. fb64-sab-reread: ctx.FB64 = the reread variant,
    // so the SHIPPED call site stores a second read of the high word -> the shipped
    // fail-open line. fb64-sab-blind: the in-run control is the faithful copy (no
    // window), so the control never fails open -> INCONCLUSIVE at the cap, and no
    // shipped fail-open line may appear.
    'fb64-sab-reread': { tiers: ['T3'], cheap: false, expect: /T3: FB64 SAB: \d+ fail-open\(s\) by the shipped class/, apply(ctx) { ctx.control.fb64Variant = 'reread'; } },
    'fb64-sab-blind': { tiers: ['T3'], cheap: false, expect: /^(?![\s\S]*FB64 SAB: \d+ fail-open)[\s\S]*T3: FB64 SAB coverage: INCONCLUSIVE -- the faithful control failed open 0 times in 1024 chunk\(s\) of 20000 calls \(need >= 20; \d+ accepted\): the race was not shown hit -- fail closed/, apply(ctx) { ctx.control.fb64SabControl = 'faithful'; } },
    // A17: fb64-sab-flip = the old (B.B1b) back-to-back writer (ctx.control.fb64SabHold = 0: `a[2] = -1;
    // a[2] = 0xFF;` with no hold). The invalid high word is visible for about one store commit, so the dwell
    // witness sees far below 10% of its sampled reads at -1 and the row must FAIL the dwell gate on EVERY
    // host (whatever the control rate does; A18: on the 10% floor, any mixed count); no shipped fail-open
    // line may appear.
    'fb64-sab-flip': { tiers: ['T3'], cheap: false, expect: /^(?![\s\S]*FB64 SAB: \d+ fail-open)[\s\S]*T3: FB64 SAB coverage: writer dwell -- \d+ of 200000 sampled reads saw the invalid high word, \d+ of 20 bursts saw both values \(need >= 20000 and >= 10\) -- fail closed/, apply(ctx) { ctx.control.fb64SabHold = 0; } }
};

export const CONTROL_NAMES = Object.keys(CONTROLS);

// did-you-mean for an unknown control name (Levenshtein, cold path).
export function suggest(name) {
    let best = null;
    let bestD = Infinity;
    for (const c of CONTROL_NAMES) {
        const d = lev(name, c);
        if (d < bestD) { bestD = d; best = c; }
    }
    return bestD <= 4 ? best : null;
}

function lev(a, b) {
    const m = a.length;
    const n = b.length;
    const row = new Array(n + 1);
    for (let j = 0; j <= n; j++) row[j] = j;
    for (let i = 1; i <= m; i++) {
        let prev = row[0];
        row[0] = i;
        for (let j = 1; j <= n; j++) {
            const tmp = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return row[n];
}
