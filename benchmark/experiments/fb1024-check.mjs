// benchmark/experiments/fb1024-check.mjs -- RESEARCH only, not a gate. Oracle fuzz + invariants + fail-closed rows + shape timing for fb1024-draft.mjs.
import { FastBit1024 } from './fb1024-draft.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
if (process.argv[2] === '--time') {
    const [op, shape] = process.argv.slice(3);
    const s = new FastBit1024();
    if (shape === 'w31') for (let i = 0; i < 1023; i++) s.add(i);
    else for (let i = 1; i < 1024; i++) s.add(i);
    const sink = new Int32Array(1), reps = 2e7;
    let best = Infinity, floor = Infinity;
    for (let r = 0; r < 9; r++) {
        let t0 = process.hrtime.bigint(), acc = 0;
        if (op === 'acq') for (let i = 0; i < reps; i++) { const x = s.acquire(); s.release(x); acc = (acc + x) | 0; }
        else for (let i = 0; i < reps; i++) acc = (acc + s.nextClearBit()) | 0;
        best = Math.min(best, Number(process.hrtime.bigint() - t0) / reps);
        t0 = process.hrtime.bigint();
        for (let i = 0; i < reps; i++) acc = (acc + i) | 0;
        floor = Math.min(floor, Number(process.hrtime.bigint() - t0) / reps);
        sink[0] = acc;
    }
    console.log(JSON.stringify({ net: +(best - floor).toFixed(2) }));
    process.exit(0);
}

let fails = 0;
const bad = (m) => { if (fails++ < 15) console.log('FAIL', m); };

class Oracle {
    constructor(cap) { this.cap = cap; this.b = new Uint8Array(cap); }
    lowest() { for (let i = 0; i < this.cap; i++) if (this.b[i]) return i; return -1; }
    highest() { for (let i = this.cap - 1; i >= 0; i--) if (this.b[i]) return i; return -1; }
    clearLow() { for (let i = 0; i < this.cap; i++) if (!this.b[i]) return i; return -1; }
    next(f) { for (let i = f; i < this.cap; i++) if (this.b[i]) return i; return -1; }
    count() { let c = 0; for (let i = 0; i < this.cap; i++) c += this.b[i]; return c; }
}
function invariants(s, tag) {
    let n = 0;
    for (let w = 0; w < 32; w++) {
        const d = s.data[w];
        if ((((s.active >>> w) & 1) === 1) !== (d !== 0)) bad(tag + ' I1 word ' + w);
        if ((((s.full >>> w) & 1) === 1) !== (d === -1)) bad(tag + ' I2 word ' + w);
        for (let b = 0; b < 32; b++) { if ((d >>> b) & 1) { n++; if ((w << 5) + b >= s.cap) bad(tag + ' I4'); } }
    }
    if (n !== s.n) bad(tag + ' I3 n=' + s.n + ' want ' + n);
}

let x = 0x9e3779b9 | 0;
const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
const CAPS = [1, 2, 31, 32, 33, 63, 64, 65, 500, 991, 992, 993, 1023, 1024];
let checks = 0;
for (let trial = 0; trial < 3000; trial++) {
    const cap = trial < 2000 ? CAPS[trial % CAPS.length] : 1 + (rnd() % 1024);
    const s = new FastBit1024(cap), o = new Oracle(cap);
    const fillBias = (trial % 4) / 4 + 0.2;               // some trials run near-full
    const steps = 50 + (rnd() % 3000);
    for (let k = 0; k < steps; k++) {
        const r = rnd() % 100, i = rnd() % cap;
        if (r < 40 * fillBias + 10) { s.add(i); o.b[i] = 1; }
        else if (r < 60) { s.remove(i); o.b[i] = 0; }
        else if (r < 70) { s.toggle(i); o.b[i] ^= 1; }
        else if (r < 85) {
            const got = s.acquire(), want = o.clearLow();
            if (got !== want) bad(`acquire cap ${cap} got ${got} want ${want}`);
            if (want !== -1) o.b[want] = 1;
        } else if (r < 92) {
            const h = o.next(i);
            if (h !== -1) { s.release(h); o.b[h] = 0; }
            else { let threw = false; try { s.release(i); } catch { threw = true; } if (o.b[i] === 0 && !threw) bad('release of free slot did not throw'); }
        } else if (r < 94) { s.clear(); o.b.fill(0); }
        if ((k & 15) === 0 || k === steps - 1) {
            checks++;
            const f = rnd() % (cap + 1);
            const pairs = [['lowest', s.lowest(), o.lowest()], ['highest', s.highest(), o.highest()],
                ['nextClearBit', s.nextClearBit(), o.clearLow()], ['size', s.size, o.count()],
                ['isEmpty', s.isEmpty(), o.count() === 0], ['isFull', s.isFull(), o.count() === cap],
                ['has', s.has(i), o.b[i] === 1], ['nextSetBit(' + f + ')', s.nextSetBit(f), o.next(f)]];
            for (const [n, g, wnt] of pairs) if (g !== wnt) bad(`${n} cap ${cap} got ${g} want ${wnt}`);
            const it = []; s.forEach((b) => it.push(b));
            const cur = []; for (let b = s.nextSetBit(0); b !== -1; b = s.nextSetBit(b + 1)) cur.push(b);
            const ow = []; for (let b = 0; b < cap; b++) if (o.b[b]) ow.push(b);
            if (it.join() !== ow.join()) bad('forEach cap ' + cap);
            if (cur.join() !== ow.join()) bad('cursor cap ' + cap);
            invariants(s, 'cap ' + cap);
        }
    }
    // relations: random other set, same cap
    const t = new FastBit1024(cap), ot = new Uint8Array(cap);
    const m = rnd() % 4;
    for (let k = 0; k < 20; k++) { const i = rnd() % cap; if (m === 0 ? o.b[i] : true) { t.add(i); ot[i] = 1; } }
    let all = true, any = false;
    for (let b = 0; b < cap; b++) { if (ot[b] && !o.b[b]) all = false; if (ot[b] && o.b[b]) any = true; }
    if (s.hasAll(t) !== all) bad('hasAll cap ' + cap);
    if (s.hasAny(t) !== any) bad('hasAny cap ' + cap);
}
// pinned extremes: fill 1024, every word full incl. bit 31 words; free 1023, 31, 0; drain
{
    const s = new FastBit1024();
    for (let i = 0; i < 1024; i++) if (s.acquire() !== i) bad('fill order ' + i);
    if (s.acquire() !== -1 || !s.isFull() || s.full !== -1) bad('full state');
    for (const f of [1023, 31, 0]) { s.release(f); if (s.nextClearBit() !== Math.min(...[1023, 31, 0].slice(0, [1023, 31, 0].indexOf(f) + 1))) bad('free ' + f); }
    invariants(s, 'extremes');
}
// fail closed
const s = new FastBit1024(100);
for (const v of [undefined, null, NaN, 1.5, '3', true, -1, 100, 1024, 2 ** 32, Symbol('x'), 3n, {}]) {
    for (const op of ['add', 'remove', 'toggle', 'has', 'release']) {
        let threw = false; try { s[op](v); } catch { threw = true; }
        if (!threw) bad(`${op}(${typeof v === 'symbol' ? 'Symbol' : String(v)}) did not throw`);
    }
}
for (const c of [0, -1, 1025, 1.5, '64', null, NaN]) { // undefined = the default 1024, by design
    let threw = false; try { new FastBit1024(c); } catch { threw = true; }
    if (!threw) bad('capacity ' + String(c) + ' accepted');
}
if (s.size !== 0 || s.active !== 0) bad('a rejected call mutated state');
// teeth: the draft SparseBit1024 policy (first EMPTY word) must disagree with this oracle
console.log(`fuzz: 3000 trials, ${checks} checkpoints x 10 ops + invariants I1-I4, fail-closed rows: ${fails === 0 ? 'ALL PASS' : fails + ' FAIL'}`);

for (const op of ['ncb', 'acq']) for (const shape of ['w0', 'w31']) {
    const nets = [0, 1, 2].map(() => JSON.parse(execFileSync(process.execPath, [SELF, '--time', op, shape], { encoding: 'utf8' })).net);
    console.log(`  ${op === 'ncb' ? 'nextClearBit   ' : 'acquire+release'} ${shape}: net ${nets.join(' / ')} ns/op`);
}
process.exit(fails === 0 ? 0 : 1);
