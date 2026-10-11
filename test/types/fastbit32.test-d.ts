/**
 * @zakkster/lite-fastbit32 -- ambient type tests (tsc -p test/types/tsconfig.json).
 * Imports every export, exercises each signature, and pins two misuse errors
 * with @ts-expect-error. ASCII-only.
 */

import {
    VERSION,
    FastBit32,
    BitMapper,
    FastBit1024,
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

// --- S4 Tier-1 (1.3.0) -----------------------------------------------------
const nsb: number = fb.nextSetBit(0);
const psb: number = fb.prevSetBit(31);
const rk: number = fb.rank(5);
const eq: boolean = fb.equals(fb);
const eqv: boolean = fb.equalsValue(0x80000000);
const setChain: FastBit32 = fb.set(3).copy(fb);
const sub: boolean = fb.isSubsetOf(0xFF);
const rm: number = FastBit32.rangeMask(0, 31);
for (let b = fb.nextSetBit(0); b !== -1; b = fb.nextSetBit(b + 1)) void b;
void nsb; void psb; void rk; void eq; void eqv; void setChain; void sub; void rm;

// @ts-expect-error -- equals() takes a FastBit32, not a raw word.
fb.equals(5);

// --- S5 (1.5.0) ------------------------------------------------------------
const sel: number = fb.select(0);
const nsub: number = FastBit32.nextSubset(0xFF, 0xFF);
const ncomb: number = FastBit32.nextCombination(FastBit32.rangeMask(0, 2));
void sel; void nsub; void ncomb;

// @ts-expect-error -- nextSubset() takes (sub, mask); one argument is an arity error.
FastBit32.nextSubset(5);

// --- BitMapper -------------------------------------------------------------
const mapper = new BitMapper(['Position', 'Velocity']);
const bit: number = mapper.get('Position');
const mask: number = mapper.getMask(['Position', 'Velocity']);
const active: string[] = mapper.getActiveNames(fb);
const name: string | undefined = mapper.getName(0);
const oneBit: number = mapper.bit('Velocity');
const mapperSize: number = mapper.size;
void bit; void mask; void active; void name; void oneBit; void mapperSize;

// @ts-expect-error -- size is a read-only getter.
mapper.size = 3;

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

// --- FastBit1024 (1.4.0) -----------------------------------------------------
const pool = new FastBit1024(500);
const poolDefault = new FastBit1024();
const slot: number = pool.acquire();
const pc: FastBit1024 = pool.release(slot).add(1).remove(1).toggle(2).clear();
const held: boolean = pool.has(3);
const psize: number = pool.size;
const pcap: number = pool.capacity;
const pe: boolean = pool.isEmpty();
const pf: boolean = pool.isFull();
const plo: number = pool.lowest();
const phi: number = pool.highest();
const pncb: number = pool.nextClearBit();
const pnsb: number = pool.nextSetBit(0);
const pall: boolean = pool.hasAll(poolDefault);
const pany: boolean = pool.hasAny(poolDefault);
const peach: FastBit1024 = pool.forEach((b: number) => { void b; });
void pc; void held; void psize; void pcap; void pe; void pf; void plo; void phi;
void pncb; void pnsb; void pall; void pany; void peach;

// @ts-expect-error -- hasAll takes another FastBit1024, not a raw mask.
pool.hasAll(5);

// @ts-expect-error -- capacity is a read-only getter.
pool.capacity = 64;
