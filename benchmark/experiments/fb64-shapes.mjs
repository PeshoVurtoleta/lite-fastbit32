// benchmark/experiments/fb64-shapes.mjs -- research only (SC-4, RESEARCH 12 q3).
// Run: node benchmark/experiments/fb64-shapes.mjs  (spawns one process per subject).
// FastBit64 shapes: flat two-field object vs two FastBit32 + orchestrator vs FastBit1024(64).
// One subject per process (monomorphic site); hasAll(signature) over N entities = the ECS hot loop.
import { FastBit32, FastBit1024 } from '../../FastBit32.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const SELF = fileURLToPath(import.meta.url);

class Flat64 { constructor() { this.lo = 0; this.hi = 0; }
  add(b) { if (b < 32) this.lo |= 1 << b; else this.hi |= 1 << (b & 31); return this; }
  hasAll(o) { return ((~this.lo & o.lo) | (~this.hi & o.hi)) === 0; }
  lowest() { const l = this.lo; if (l !== 0) return 31 - Math.clz32(l & -l); const h = this.hi; return h === 0 ? -1 : 63 - Math.clz32(h & -h); } }
class Comp64 { constructor() { this.a = new FastBit32(); this.b = new FastBit32(); }
  add(b) { if (b < 32) this.a.add(b); else this.b.add(b & 31); return this; }
  hasAll(o) { return this.a.hasAll(o.a.value) && this.b.hasAll(o.b.value); }
  lowest() { const l = this.a.lowest(); if (l !== -1) return l; const h = this.b.lowest(); return h === -1 ? -1 : 32 + h; } }
const MK = { flat: () => new Flat64(), comp: () => new Comp64(), fb1024: () => new FastBit1024(64) };

if (process.argv[2] === '--run') {
  const kind = process.argv[3], N = 10000;
  let x = 0x9e3779b9 | 0; const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; };
  global.gc(); const m0 = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers;
  const ents = new Array(N);
  for (let i = 0; i < N; i++) { const e = MK[kind](); for (let k = 0; k < 12; k++) e.add(rnd() % 64); ents[i] = e; }
  global.gc(); const bytes = (process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers - m0) / N;
  const sig = MK[kind](); sig.add(3).add(40).add(63);
  const sink = new Int32Array(1); let best = Infinity;
  for (let r = 0; r < 15; r++) {
    const t0 = process.hrtime.bigint(); let c = 0;
    for (let rep = 0; rep < 200; rep++) for (let i = 0; i < N; i++) c += ents[i].hasAll(sig) ? 1 : 0;
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / (200 * N)); sink[0] = c;
  }
  let bestL = Infinity;
  for (let r = 0; r < 15; r++) {
    const t0 = process.hrtime.bigint(); let c = 0;
    for (let rep = 0; rep < 200; rep++) for (let i = 0; i < N; i++) c = (c + ents[i].lowest()) | 0;
    bestL = Math.min(bestL, Number(process.hrtime.bigint() - t0) / (200 * N)); sink[0] = c;
  }
  console.log(JSON.stringify({ kind, bytesPerEntity: Math.round(bytes), hasAllNs: +best.toFixed(2), lowestNs: +bestL.toFixed(2) }));
  process.exit(0);
}
for (const k of ['flat', 'comp', 'fb1024']) for (let i = 0; i < 2; i++)
  console.log(execFileSync(process.execPath, ['--expose-gc', SELF, '--run', k], { encoding: 'utf8' }).trim());
