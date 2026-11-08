// test/torture/d8-fb64.mjs -- B-S6 (PLAN-fastbit64-B task 7): the T6 FastBit64
// pointer-compressed lane (d8 only). d8 has no heap-usage API: T6 runs this
// with --trace-gc and 1 MB semi-spaces (d8Lane in t6-alloc.mjs) and COUNTS
// `Scavenge` lines between the MARK print()s. On a pointer-compressed engine a
// Smi is 31 bits, so the words lo = 0x40000000 (2^30) and hi = -0x40000001
// (0xBFFFFFFF) are NOT Smis: returned from (or passed to) a non-inlined
// FastBit64 method each one is a 12 B HeapNumber, and storing one into a
// FastBit64 field allocates a fresh HeapNumber even inlined (the B.B3 finding,
// SPEC-fastbit64 A7). T6 runs this twice: as is (inlined) and under
// --no-turbo-inlining.
// Window "read" (SPEC-fastbit64 A7 + A8, GATED <= 2 per 1e6 in the inlined run): 1e6
// ops after a 2e5-op warm-up (TurboFan) that read and return the words (lo / hi
// getters), ask count / highest / lowest, save an image (saveInto, a store into
// an Int32Array, never into a FastBit64) and compare the words (equalsWords);
// NO store into a FastBit64. Window "store" (REPORTED in both runs, PENDING
// FB64-PC): 1e6 ops after a 2e5-op warm-up of setWords(lo, hi) with the words
// read from memory (an Int32Array: constant words fold and would read 0) plus
// loadFrom of the image. Every answer goes into an Int32Array sink. Window "box":
// the positive control of d8-loadfrom.mjs, one HeapNumber per op into a tagged
// slot -- it MUST scavenge, or the counter is blind. RESULT checks the final
// words and every answer against literals.
// Read gate resolution (measured): <= 2 per 1e6 catches a 12 B box on every 2nd read op (5 scavenges), not on every 4th (2):
// floor ~3 B/op (B.B3 review r2 probes, d8 15.7.37, evidence fb64-B3/review-r2/d8-probes.log).
import { FastBit64 } from '../../FastBit32.js';

const LO = 0x40000000, HI = -0x40000001;
// the true answers on those words: popcount(0x40000000) + popcount(0xBFFFFFFF)
// = 1 + 31; lowest set bit 30 (lo); highest set bit 63 (hi bit 31); saveInto /
// loadFrom of a 3-word image at offset 0 both return 3
const WANT_COUNT = 32, WANT_LOWEST = 30, WANT_HIGHEST = 63, WANT_END = 3;
const SRC = new Int32Array([LO, HI]);        // the store window's words, from memory
const a = new FastBit64(LO, HI);
const w = new FastBit64(LO, HI);
const IMG = new Int32Array(3);
const SINK = new Int32Array(6);
let reads = 0, stores = 0;
function readMix(n) {
    for (let i = 0; i < n; i++) {
        const lo = a.lo, hi = a.hi;
        SINK[0] = (SINK[0] + a.count() + a.highest() + a.lowest()) | 0;
        SINK[1] = (SINK[1] + a.saveInto(IMG, 0)) | 0;
        SINK[2] = (SINK[2] + (a.equalsWords(lo, hi) ? 1 : 0)) | 0;
        SINK[3] = (SINK[3] + (lo === LO && hi === HI ? 1 : 0)) | 0;
    }
    reads += n;
}
function storeMix(n) {
    for (let i = 0; i < n; i++) {
        w.setWords(SRC[0], SRC[1]);
        SINK[4] = (SINK[4] + w.loadFrom(IMG, 0)) | 0;
        SINK[5] = (SINK[5] + (w.lo === LO && w.hi === HI ? 1 : 0)) | 0;
    }
    stores += n;
}
const BOX = [{}];
function boxes(n) { for (let i = 0; i < n; i++) { BOX[0] = i + 0.5; SINK[0] = (SINK[0] + (BOX[0] | 0)) | 0; } }

readMix(200000);
gc();
print('MARK begin read');
readMix(1000000);
print('MARK end');
storeMix(200000);
gc();
print('MARK begin store');
storeMix(1000000);
print('MARK end');
const s0 = SINK[0], s1 = SINK[1], s2 = SINK[2], s3 = SINK[3], s4 = SINK[4], s5 = SINK[5];
boxes(2000);
gc();
print('MARK begin box');
boxes(500000);
print('MARK end');
const ok = w.lo === LO && w.hi === HI && a.lo === LO && a.hi === HI &&
    IMG[1] === LO && IMG[2] === HI &&
    s0 === ((WANT_COUNT + WANT_HIGHEST + WANT_LOWEST) * reads) && s1 === WANT_END * reads && s2 === reads &&
    s3 === reads &&
    s4 === WANT_END * stores && s5 === stores;
print('RESULT ok=' + ok + ' lo=' + w.lo + ' hi=' + w.hi + ' reads=' + reads + ' stores=' + stores + ' sink=' + s0 + ',' + s1 + ',' + s2 + ',' + s3 + ',' + s4 + ',' + s5);
