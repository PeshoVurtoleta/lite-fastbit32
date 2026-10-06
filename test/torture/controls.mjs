// test/torture/controls.mjs -- the control registry. Each control is a
// deliberately broken variant that MUST make its target tier(s) fail; if a
// control passes, the gate it targets is decorative (ROADMAP section 5, T9).
// `apply(ctx)` mutates the ctx in place. `cheap` controls run in-process inside
// T9; the rest are exercised as child processes by controls-runner.mjs.

function fixedHasAll(FB) {
    // FB-01 fixed. S1 edits the real prototype method in place, which also
    // reaches clone()/deserialize() results (base instances using the patched
    // prototype). A subclass override alone does NOT -- clone() and
    // deserialize() hard-code `new FastBit32(...)` (FastBit32.js:120,136), so
    // they return base instances with the buggy hasAll. Override both to
    // construct the subclass, otherwise the control would leave 36 of the 90
    // isC5 rows red (the clone/deserialize build forms) and misreport a second
    // defect that does not exist: the in-place fix greens all 90.
    return class extends FB {
        hasAll(mask) { return (~this.value & mask) === 0; }
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
    'hasall-fixed': { tiers: ['T1', 'T2', 'T3', 'T5', 'T8'], cheap: true, apply(ctx) { ctx.FB = fixedHasAll(ctx.FB); } },
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
