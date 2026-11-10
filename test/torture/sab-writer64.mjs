// test/torture/sab-writer64.mjs -- the T3 FastBit64 concurrent writer (worker
// thread; B-S1 as amended by SPEC-fastbit64 A17). The main thread holds a
// capacity-40 image [TAG|40, 0x1234, hi] at offset 0 of a SharedArrayBuffer-
// backed Int32Array; this worker flips only the high word between 0x000000FF
// (bits 32..39: valid for capacity 40) and -1 (bits 40..63: invalid), so a
// loadFrom that validates one read of the high word and stores another can store
// a bit >= 40 (a fail-open). Header and low word never change.
// The hold (A17): workerData.hold = H, an integer 0..4096; any other value
// (missing, fractional, out of range, not a number) runs with the default H = 64
// -- the writer still runs, the main thread's dwell witness gates what it saw.
// - H = 0: the old (B.B1b) back-to-back pair `a[2] = -1; a[2] = 0xFF;`. The
//   invalid word is visible for about one store commit, so the reader's hit rate
//   is a property of the host's cache timing (hosted ubuntu: 5e-8..2e-3 per
//   control call). Kept only for the fb64-sab-flip control, which must FAIL the
//   dwell gate.
// - H > 0: each value is HELD for H spin iterations of local arithmetic (no
//   shared-memory traffic) after its store, so either value is visible for a
//   comparable share of the time on any host.
// ROUND = 4096 pairs when H = 0, 64 when H > 0 (a held pair is ~2H spins longer,
// so the main thread still sees rounds >= 10 when the row stops in chunk 1).
// Control: ctl[0] 0 = pause (Atomics.wait), 1 = run, 2 = exit; ctl[1] = 1 once
// started; ctl[2] counts finished rounds; ctl[3] is the main thread's sleep slot
// (never written here); ctl[4] receives the spin sink after every round and at
// exit, so the spin is observable and never dead code. One Atomics.load of
// ctl[0] per pair. No timing: the main thread bounds its own work by call counts.
import { workerData } from 'node:worker_threads';

const a = new Int32Array(workerData.data);
const ctl = new Int32Array(workerData.ctl);
const hold = workerData.hold;
const H = Number.isInteger(hold) && hold >= 0 && hold <= 4096 ? hold : 64;
const ROUND = H === 0 ? 4096 : 64;

Atomics.store(ctl, 1, 1);
Atomics.notify(ctl, 1);
let n = 0, sink = 0;
for (;;) {
    const cmd = Atomics.load(ctl, 0);
    if (cmd === 2) break;
    if (cmd !== 1) { Atomics.wait(ctl, 0, cmd); continue; }
    if (H === 0) { a[2] = -1; a[2] = 0xFF; }
    else {
        a[2] = -1; for (let i = 0; i < H; i++) sink = (sink * 31 + i) | 0;
        a[2] = 0xFF; for (let i = 0; i < H; i++) sink = (sink * 31 + i) | 0;
    }
    if (++n === ROUND) { n = 0; ctl[4] = sink; Atomics.add(ctl, 2, 1); }
}
ctl[4] = sink;
