/**
 * @zakkster/lite-fastbit32 -- ambient type tests (tsc -p test/types/tsconfig.json).
 * Imports every export, exercises each signature, and pins two misuse errors
 * with @ts-expect-error. ASCII-only.
 */

import {
    VERSION,
    FastBit32,
    BitMapper,
    forEachArray,
    forEachObject,
    forEachMapped,
    forEachMappedObject,
    forEachMaskPair,
    forEachMaskDiff,
    forEachMaskUnion
} from '../../FastBit32.js';

// VERSION is a string.
const v: string = VERSION;
void v;

// @ts-expect-error -- VERSION is not a number.
const vn: number = VERSION;
void vn;

// --- FastBit32 -------------------------------------------------------------
const fb = new FastBit32();
const fbInit = new FastBit32(0xff);
void fbInit;

const chainable: FastBit32 = fb.add(1).remove(2).toggle(3).clear().union(4).difference(8).intersect(12);
void chainable;

const hasBit: boolean = fb.has(4);
const all: boolean = fb.hasAll(5);
const any: boolean = fb.hasAny(5);
const none: boolean = fb.hasNone(5);
const n1: number = fb.count();
const n2: number = fb.countMasked(5);
const n3: number = fb.countRange(0, 31);
const lo: number = fb.lowest();
const hi: number = fb.highest();
const ncb: number = fb.nextClearBit();
const hcb: number = fb.highestClearBit();
const empty: boolean = fb.isEmpty();
const full: boolean = fb.isFull();
const copy: FastBit32 = fb.clone();
const raw: number = fb.serialize();
const bin: string = fb.toBinaryString();
const bin2: string = fb.toBinaryString(false);
const arr: number[] = fb.toArray();
const fromArr: FastBit32 = fb.fromArray([0, 1, 2]);
const each: FastBit32 = fb.forEach((bit: number) => { void bit; });
const restored: FastBit32 = FastBit32.deserialize(5);
const rawValue: number = fb.value;

void hasBit; void all; void any; void none; void n1; void n2; void n3;
void lo; void hi; void ncb; void hcb; void empty; void full; void copy;
void raw; void bin; void bin2; void arr; void fromArr; void each; void restored; void rawValue;

// @ts-expect-error -- add() expects a number, not a string.
fb.add('nope');

// --- BitMapper -------------------------------------------------------------
const mapper = new BitMapper(['Position', 'Velocity']);
const bit: number = mapper.get('Position');
const mask: number = mapper.getMask(['Position', 'Velocity']);
const active: string[] = mapper.getActiveNames(fb);
const name: string | undefined = mapper.getName(0);
void bit; void mask; void active; void name;

// --- Free iteration helpers ------------------------------------------------
forEachArray(fb, ['a', 'b', 'c'], (element: string, b: number) => { void element; void b; });
forEachObject(fb, ['hp', 'mp'], { hp: 1, mp: 2 }, (value: number, key: string, b: number) => {
    void value; void key; void b;
});
forEachMapped(fb, mapper, (nm: string, b: number) => { void nm; void b; });
forEachMappedObject(fb, mapper, { Position: 1, Velocity: 2 }, (value: number, key: string, b: number) => {
    void value; void key; void b;
});
forEachMaskPair(fb, fb.clone(), (b: number) => { void b; });
forEachMaskDiff(fb, fb.clone(), (b: number) => { void b; });
forEachMaskUnion(fb, fb.clone(), (b: number) => { void b; });
