// test/torture/sab-writer.mjs -- the T3 concurrent writer (worker thread).
// Tears a FastBit1024 image in a SharedArrayBuffer-backed Int32Array at
// offset OFF while the main thread runs loadFrom / deserialize on it (C-14).
// Each round writes, in order: a valid header for a random capacity over zero
// data; the 1024 header over all-ones data; the cap-2047 header over random
// words; the cap-0 header while zeroing downwards; then a valid header with
// its tail word flipped between clean and dirty. The cap-0 / cap-2047 headers
// are what a deserialize without the 1..1024 re-check would take as _cap.
// Control: ctl[0] 0 = pause (Atomics.wait), 1 = run, 2 = exit; ctl[1] = 1
// once started; ctl[2] counts finished rounds. No timing: the main thread
// bounds its own work by call counts.
import { workerData } from 'node:worker_threads';

const a = new Int32Array(workerData.data);
const ctl = new Int32Array(workerData.ctl);
const OFF = workerData.off;
const H = 0x46420800;
const CAPS = new Int32Array([1, 31, 32, 33, 64, 500, 1023, 1024]);
const X = new Int32Array(1);
X[0] = workerData.seed | 0 || 0x2545f491;

function nx() {
    let x = X[0];
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    X[0] = x;
    return x;
}

Atomics.store(ctl, 1, 1);
Atomics.notify(ctl, 1);
for (;;) {
    const cmd = Atomics.load(ctl, 0);
    if (cmd === 2) break;
    if (cmd !== 1) { Atomics.wait(ctl, 0, cmd); continue; }
    const k = CAPS[(nx() >>> 0) & 7];
    a[OFF] = H | k;
    for (let w = 1; w <= 33; w++) a[OFF + w] = 0;
    a[OFF] = H | 1024;
    for (let w = 1; w <= 33; w++) a[OFF + w] = -1;
    a[OFF] = H | 2047;
    for (let w = 1; w <= 33; w++) a[OFF + w] = nx();
    a[OFF] = H | 1024;
    for (let w = 1; w <= 33; w++) a[OFF + w] = nx();
    a[OFF] = H;
    for (let w = 33; w >= 1; w--) a[OFF + w] = 0;
    const k2 = CAPS[(nx() >>> 0) & 7], L = (k2 + 31) >>> 5;
    a[OFF] = H | k2;
    for (let t = 0; t < 16; t++) { a[OFF + L] = -1; a[OFF + L] = 1; a[OFF + L] = 0; }
    a[OFF] = H | 2047;
    a[OFF] = H | 1024;
    Atomics.add(ctl, 2, 1);
}
