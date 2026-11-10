// test/torture/d8-loadfrom.mjs -- the T6 pointer-compressed lane (d8 only).
// d8 has no heap-usage API: T6 runs this with --trace-gc and 1 MB semi-spaces
// and COUNTS `Scavenge` lines between the MARK print()s. On a
// pointer-compressed engine a Smi is 31 bits, so an int32 word >= 2^30 or
// < -2^30 passed to a NON-inlined fb1024Pop would box (12 B) per call. The
// image holds such words (bit 30, bit 31, 0x7FFFFFFF, 0x55555555 patterns)
// and -1. Window "loadFrom": 1e6 loads after a 2e5-load warm-up (TurboFan).
// Window "box": the positive control, one HeapNumber per op into a tagged
// slot -- it MUST scavenge, or the counter is blind.
import { FastBit1024 } from '../../FastBit32.js';

const WORDS = [-1, 0x40000000, -0x80000000, 0x7FFFFFFF, 0x55555555, -0x55555556, 0x40000001, 0];
const img = new Int32Array(40);
img[3] = 0x46420800 | 1024;
for (let w = 0; w < 32; w++) img[4 + w] = WORDS[w & 7];
const r = new FastBit1024(1024);
const SINK = new Int32Array(1);
function loads(n) { for (let i = 0; i < n; i++) SINK[0] = (SINK[0] + r.loadFrom(img, 3)) | 0; }
const BOX = [{}];
function boxes(n) { for (let i = 0; i < n; i++) { BOX[0] = i + 0.5; SINK[0] = (SINK[0] + (BOX[0] | 0)) | 0; } }

// gc() stays here and before the box window: A11 changes only the window's size and
// unit; R5 read 0 per 1e5 (first window after gc()) and 0 per 1e6, 3 runs; R7f's
// post-gc() transient was observed on readMix only.
loads(200000);
gc();
print('MARK begin loadFrom');
loads(1000000);
print('MARK end');
boxes(2000);
gc();
print('MARK begin box');
boxes(500000);
print('MARK end');
let n = 0;
for (let w = 0; w < 32; w++) { let v = WORDS[w & 7]; for (let b = 0; b < 32; b++) n += (v >>> b) & 1; }
print('RESULT size=' + r.size + ' want=' + n + ' sink=' + SINK[0]);
