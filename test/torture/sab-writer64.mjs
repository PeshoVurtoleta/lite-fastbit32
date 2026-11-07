// test/torture/sab-writer64.mjs -- the T3 FastBit64 concurrent writer (worker
// thread; B-S1). The p7 writer shape (.handoff/research/fastbit64/p7-sab.mjs):
// the main thread holds a capacity-40 image [TAG|40, 0x1234, hi] at offset 0 of
// a SharedArrayBuffer-backed Int32Array; this worker flips only the high word
// between 0x000000FF (bits 32..39: valid for capacity 40) and -1 (bits 40..63:
// invalid), so a loadFrom that validates one read of the high word and stores
// another can store a bit >= 40 (a fail-open). Header and low word never change.
// Control: ctl[0] 0 = pause (Atomics.wait), 1 = run, 2 = exit; ctl[1] = 1 once
// started; ctl[2] counts finished rounds (one round = ROUND flip pairs). The
// flip loop keeps the probe's shape (one Atomics.load of ctl[0] per pair). No
// timing: the main thread bounds its own work by call counts.
import { workerData } from 'node:worker_threads';

const a = new Int32Array(workerData.data);
const ctl = new Int32Array(workerData.ctl);
const ROUND = 4096;

Atomics.store(ctl, 1, 1);
Atomics.notify(ctl, 1);
let n = 0;
for (;;) {
    const cmd = Atomics.load(ctl, 0);
    if (cmd === 2) break;
    if (cmd !== 1) { Atomics.wait(ctl, 0, cmd); continue; }
    a[2] = -1; a[2] = 0xFF;
    if (++n === ROUND) { n = 0; Atomics.add(ctl, 2, 1); }
}
