// test/torture/controls.mjs -- the control registry. Each control is a
// deliberately broken variant that MUST make its target tier(s) fail; if a
// control passes, the gate it targets is decorative (ROADMAP section 5, T9).
// `apply(ctx)` mutates the ctx in place. `cheap` controls run in-process inside
// T9; the rest are exercised as child processes by controls-runner.mjs.

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

function flipOracle(oracle) {
    // one corrupted function: popcount off by one -> every T5 count check diverges
    return { ...oracle, oCount: (v) => oracle.oCount(v) + 1 };
}

export const CONTROLS = {
    'hasall-old': { tiers: ['T0', 'T1', 'T2', 'T3', 'T5', 'T8'], cheap: true, apply(ctx) { ctx.FB = oldHasAll(ctx.FB); } },
    'lowest-noguard': { tiers: ['T0', 'T1'], cheap: true, apply(ctx) { ctx.FB = lowestNoGuard(ctx.FB); } },
    'nextset-nowrap': { tiers: ['T0', 'T5'], cheap: true, apply(ctx) { ctx.FB = nextSetNoWrap(ctx.FB); } },
    'isfull-unsigned': { tiers: ['T3'], cheap: true, apply(ctx) { ctx.FB = isFullUnsigned(ctx.FB); } },
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
    'foreach-closure': { tiers: ['T6'], cheap: false, apply(ctx) { ctx.control.foreachClosure = true; } },
    'budget-major': { tiers: ['T6'], cheap: false, apply(ctx) { ctx.control.budgetMajor = true; } },
    'bop-box': { tiers: ['T6'], cheap: false, apply(ctx) { ctx.control.bopBox = true; } },
    'soak-stash': { tiers: ['T7'], cheap: false, apply(ctx) { ctx.control.soakStash = true; } },
    'soak-retain': { tiers: ['T7'], cheap: false, apply(ctx) { ctx.control.soakRetain = true; } }
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
