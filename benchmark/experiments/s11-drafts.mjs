// benchmark/experiments/s11-drafts.mjs -- RESEARCH section 11 probe (research only, not a gate).
//
// Loads the three section-11 drafts VERBATIM from RESEARCH.md Appendix A, then:
//   1. targeted repros of every defect section 11.2 lists (got vs want),
//   2. a differential fuzz of the drafts against a Uint8Array oracle that shares no trick with them,
//   3. the section 11.5 reference sketch (Occupancy1024) fuzzed against the same oracle,
//   4. lowest-clear timing, draft vs sketch, each (candidate, shape) in its OWN process so the call
//      site stays monomorphic (section 2: one shared bench site measures dispatch, not the op).
//
// Run: node benchmark/experiments/s11-drafts.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const HERE = fileURLToPath(import.meta.url);
const md = readFileSync(join(dirname(HERE), '..', '..', 'RESEARCH.md'), 'utf8');
const app = md.slice(md.indexOf('## Appendix A'));
const code = app.slice(app.indexOf('```js') + 5, app.indexOf('\n```', app.indexOf('```js') + 5));
// The subject lives in a Markdown file that editors reflow. Pin the extracted bytes so a reflow (or any edit) of
// Appendix A fails loudly instead of silently changing what this probe tests. Pinned 2026-10-10, verbatim vs 37dc47d.
const DRAFTS_SHA256 = '596c1fcecadb38795fe0a1d2183956412e359e538b3cc86305c1f0e30e4ae55c';
const gotSha = createHash('sha256').update(code).digest('hex');
if (gotSha !== DRAFTS_SHA256) {
    console.error(`RESEARCH.md Appendix A changed: sha256 ${gotSha}, pinned ${DRAFTS_SHA256}. ` +
        'Restore the verbatim drafts (git show 37dc47d:RESEARCH.md) or re-pin deliberately.');
    process.exit(1);
}
const { FastBitArray, MultiBit32, SparseBit1024 } =
    await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

// ---- section 11.5 reference sketch: two-level index with an ACTIVE and a FULL summary ----------
const nz = (x) => (x | -x) >>> 31; // 1 iff x !== 0, for every int32 x including -2^31

class Occupancy1024 {
    constructor() {
        this.active = 0;                // bit j set iff data[j] has >= 1 set bit
        this.full = 0;                  // bit j set iff data[j] has all 32 bits set
        this.data = new Int32Array(32);
    }
    add(bit) {                          // caller guarantees 0 <= bit < 1024 (FastBit32's contract)
        const w = bit >>> 5;
        const d = this.data[w] | (1 << (bit & 31));
        this.data[w] = d;
        this.active |= 1 << w;
        this.full |= (nz(~d) ^ 1) << w;
        return this;
    }
    remove(bit) {
        const w = bit >>> 5;
        const d = this.data[w] & ~(1 << (bit & 31));
        this.data[w] = d;
        this.full &= ~(1 << w);
        this.active &= ~((nz(d) ^ 1) << w);
        return this;
    }
    has(bit) { return (this.data[bit >>> 5] & (1 << (bit & 31))) !== 0; }
    lowest() {
        const a = this.active;
        if (a === 0) return -1;
        const w = 31 - Math.clz32(a & -a);
        const d = this.data[w];
        return (w << 5) + (31 - Math.clz32(d & -d));
    }
    nextClearBit() {
        const f = ~this.full;
        if (f === 0) return -1;
        const w = 31 - Math.clz32(f & -f);
        const c = ~this.data[w];
        return (w << 5) + (31 - Math.clz32(c & -c));
    }
}

// ---- 4. timing child --------------------------------------------------------------------------
const SHAPES = {
    w0: (s) => { for (let i = 1; i < 1024; i++) s.add(i); },  // lowest free slot 0
    w31: (s) => { for (let i = 0; i < 1023; i++) s.add(i); }, // lowest free slot 1023, 31 full words first
};
if (process.argv[2] === '--time') {
    const [which, shape] = process.argv.slice(3);
    const s = which === 'draft' ? new SparseBit1024() : new Occupancy1024();
    SHAPES[shape](s);
    const sink = new Int32Array(1);
    const reps = 2e7;
    let best = Infinity, floor = Infinity;
    for (let r = 0; r < 9; r++) {
        let t0 = process.hrtime.bigint(), acc = 0;
        for (let i = 0; i < reps; i++) acc = (acc + s.nextClearBit()) | 0;
        sink[0] = acc;
        best = Math.min(best, Number(process.hrtime.bigint() - t0) / reps);
        t0 = process.hrtime.bigint(); acc = 0;
        for (let i = 0; i < reps; i++) acc = (acc + i) | 0;
        sink[0] ^= acc;
        floor = Math.min(floor, Number(process.hrtime.bigint() - t0) / reps);
    }
    const name = which === 'draft' ? 'SparseBit1024 (draft)' : 'Occupancy1024 (11.5)';
    console.log(`  ${name.padEnd(22)} ${shape.padEnd(4)} net ${(best - floor).toFixed(2)} ns/op ` +
        `(raw ${best.toFixed(2)}, floor ${floor.toFixed(2)}, answer ${s.nextClearBit()})`);
    process.exit(0);
}

// ---- 1. targeted repros -----------------------------------------------------------------------
let bugs = 0;
const row = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) bugs++;
    console.log(`  ${ok ? 'ok ' : 'BUG'} ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const bits = (s) => { const out = []; s.forEach((b) => out.push(b)); return out; };

console.log(`node ${process.version}, V8 ${process.versions.v8}, ${process.arch}`);
console.log('A. contains() with bit 31 of a word set (the FB-01 class)');
for (const C of [FastBitArray, MultiBit32]) {
    const a = new C(64), b = new C(64);
    a.add(31); b.add(31);
    row(`${C.name}(64) {31}.contains({31})`, a.contains(b), true);
    const c = new C(64), d = new C(64);
    c.add(5).add(63); d.add(63);
    row(`${C.name}(64) {5,63}.contains({63})`, c.contains(d), true);
}
console.log('B. MultiBit32.isFull() and the lastMask compare');
for (const n of [0, 1, 31, 32, 33, 63, 64]) {
    const s = new MultiBit32(n);
    for (let i = 0; i < n; i++) s.add(i);
    row(`MultiBit32(${n}) with every bit set: isFull()`, s.isFull(), true);
}
console.log('C. MultiBit32 #check is a range check, not a type check');
for (const [label, bad] of [['undefined', undefined], ['null', null], ['NaN', NaN], ['1.5', 1.5], ["'3'", '3'], ['true', true]]) {
    let out;
    try { const s = new MultiBit32(10); s.add(bad); out = `no throw, bits ${JSON.stringify(bits(s))}`; } catch { out = 'throws'; }
    row(`MultiBit32(10).add(${label})`, out, 'throws');
}
console.log('D. FastBitArray has no bounds: padding bits and dropped writes');
{
    const s = new FastBitArray(10); s.add(12);
    row('FastBitArray(10).add(12): count()', s.count(), 0);
    row('FastBitArray(10).add(12): forEach', bits(s), []);
    const t = new FastBitArray(10); t.add(undefined);
    row('FastBitArray(10).add(undefined): has(0)', t.has(0), false);
    let out;
    try { const u = new FastBitArray(10); u.add(-1); out = `no throw, count ${u.count()}`; } catch { out = 'throws'; }
    row('FastBitArray(10).add(-1)', out, 'throws');
}
console.log('E. SparseBit1024.nextClearBit() returns the first EMPTY bucket, not the lowest clear bit');
{
    const s = new SparseBit1024(); s.add(0);
    row('SparseBit1024 {0}: nextClearBit()', s.nextClearBit(), 1);
    const t = new SparseBit1024(); for (let i = 0; i < 40; i++) t.add(i);
    row('SparseBit1024 {0..39}: nextClearBit()', t.nextClearBit(), 40);
}
console.log('F. SparseBit1024: an out-of-range index corrupts the routing word');
{
    const s = new SparseBit1024(); s.add(1024);
    row('SparseBit1024 {}.add(1024): lowest()', s.lowest(), -1);
    const t = new SparseBit1024(); t.add(5); t.remove(1029);
    row('SparseBit1024 {5}.remove(1029): lowest()', t.lowest(), 5);
    row('SparseBit1024 {5}.remove(1029): has(5)', t.has(5), true);
}

// ---- 2 + 3. differential fuzz -----------------------------------------------------------------
let seed = 0x9E3779B9 | 0;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
const firstWhere = (o, want) => { for (let i = 0; i < o.length; i++) if (o[i] === want) return i; return -1; };
const lastSet = (o) => { for (let i = o.length - 1; i >= 0; i--) if (o[i]) return i; return -1; };
const tally = {};
const miss = (k) => { tally[k] = (tally[k] || 0) + 1; };
const TRIALS = 4000;
for (let trial = 0; trial < TRIALS; trial++) {
    const cap = trial % 3 === 2 ? 1024 : 1 + (rnd() % 200);
    const o = new Uint8Array(cap);
    const subjects = [new FastBitArray(cap), new MultiBit32(cap)];
    if (cap === 1024) subjects.push(new SparseBit1024(), new Occupancy1024());
    const dense = trial % 4 === 0; // near-full phases: the object-pool shape
    const steps = rnd() % (cap * 2);
    for (let k = 0; k < steps; k++) {
        const b = rnd() % cap;
        const add = dense ? rnd() % 10 < 9 : (rnd() & 1) === 0;
        o[b] = add ? 1 : 0;
        for (const s of subjects) add ? s.add(b) : s.remove(b);
    }
    const pop = o.reduce((a, x) => a + x, 0);
    const want = []; for (let i = 0; i < cap; i++) if (o[i]) want.push(i);
    for (const s of subjects) {
        const n = s.constructor.name;
        if (s.count && s.count() !== pop) miss(`${n}.count`);
        if (s.lowest() !== firstWhere(o, 1)) miss(`${n}.lowest`);
        if (s.highest && s.highest() !== lastSet(o)) miss(`${n}.highest`);
        if (s.nextClearBit() !== firstWhere(o, 0)) miss(`${n}.nextClearBit`);
        if (s.isFull && s.isFull() !== (pop === cap)) miss(`${n}.isFull`);
        if (s.forEach && JSON.stringify(bits(s)) !== JSON.stringify(want)) miss(`${n}.forEach`);
    }
}
// pinned extremes for the 11.5 sketch: all set, then free 1023, then free 31, then all clear
{
    const s = new Occupancy1024();
    for (let i = 0; i < 1024; i++) s.add(i);
    if (s.nextClearBit() !== -1 || s.lowest() !== 0) miss('Occupancy1024.extremes');
    s.remove(1023); if (s.nextClearBit() !== 1023) miss('Occupancy1024.extremes');
    s.remove(31); if (s.nextClearBit() !== 31) miss('Occupancy1024.extremes');
    for (let i = 0; i < 1024; i++) s.remove(i);
    if (s.lowest() !== -1 || s.nextClearBit() !== 0) miss('Occupancy1024.extremes');
}
console.log(`G. differential fuzz, ${TRIALS} trials (in-range indices only; 1/3 at capacity 1024):`);
console.log(`  mismatching trials per op: ${JSON.stringify(tally)} (absent = 0)`);
console.log(`\n${bugs} targeted BUG rows`);

// ---- 4. timing driver -------------------------------------------------------------------------
console.log('H. lowest-clear timing (net of an empty-loop floor, best of 9 x 2e7):');
for (const shape of Object.keys(SHAPES)) for (const which of ['draft', 'sketch'])
    process.stdout.write(execFileSync(process.execPath, [HERE, '--time', which, shape]));
