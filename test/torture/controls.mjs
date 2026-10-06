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
    return class extends FB {
        lowest() { return Math.clz32(this.value & -this.value) ^ 31; } // no zero guard -> 63 on empty
    };
}

function isFullUnsigned(FB) {
    return class extends FB {
        isFull() { return this.value === 0xFFFFFFFF; } // wrong on signed -1
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
    'isfull-unsigned': { tiers: ['T3'], cheap: true, apply(ctx) { ctx.FB = isFullUnsigned(ctx.FB); } },
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
