/**
 * @zakkster/lite-fastbit32 -- AF-2 type rows (tsc -p test/types/tsconfig.json, skipLibCheck false).
 * U-16 (surface), U-1 (a set object / undefined is not a mask), U-6 (private names
 * reserve the runtime fields; a shadowing subclass must not compile). ASCII-only.
 */

import {
    FastBit32,
    BitMapper,
    FastBit1024,
    FastBit64,
    forEachArray
} from '../../FastBit32.js';

const f32 = new FastBit32(1);
const f64 = new FastBit64(5, 7);
const p = new FastBit1024(64);
const m = new BitMapper(['a']);
declare const u: undefined;

// --- U-16: d.ts surface rows ---
// @ts-expect-error -- FastBit1024.size is readonly.
p.size = 3;
// @ts-expect-error -- getName returns string | undefined.
export const nm: string = m.getName(0);
// @ts-expect-error -- select needs k.
f64.select();
// @ts-expect-error -- count() is a number.
export const cn: string = f64.count();

// --- U-1: mask params are numbers ---
// @ts-expect-error -- a set object is not a mask.
f32.hasAll(new FastBit32(1));
// @ts-expect-error -- a FastBit64 is not a mask.
f32.union(f64);
// @ts-expect-error -- undefined is not a mask.
f32.intersect(u);
// @ts-expect-error -- undefined is not a mask.
f32.hasAny(u);
// @ts-expect-error -- undefined is not a FastBit32.
f32.equals(u);
// @ts-expect-error -- a FastBit64 is not a FastBit32.
f32.equals(f64);
// @ts-expect-error -- undefined is not a FastBit32.
f32.copy(u);
// @ts-expect-error -- a FastBit64 is not a FastBit32.
f32.copy(f64);
// @ts-expect-error -- a FastBit64 is not a FastBit32 mask source.
forEachArray(f64, ['a'], () => {});
// @ts-expect-error -- fromArray takes number[], not a Set.
f32.fromArray(new Set([1, 2]));

// --- U-6: private names reserve the runtime fields ---
// @ts-expect-error -- U-6 _cap
export class S1 extends FastBit1024 { _cap = 1; }
// @ts-expect-error -- U-6 _n
export class S2 extends FastBit1024 { _n = 1; }
// @ts-expect-error -- U-6 _active
export class S3 extends FastBit1024 { _active = 1; }
// @ts-expect-error -- U-6 _full
export class S4 extends FastBit1024 { _full = 1; }
// @ts-expect-error -- U-6 _data
export class S5 extends FastBit1024 { _data = new Int32Array(1); }
// @ts-expect-error -- U-6 _map
export class S6 extends BitMapper { _map = new Map<string, number>(); }
// @ts-expect-error -- U-6 _reverse
export class S7 extends BitMapper { _reverse: (string | undefined)[] = []; }
// Control: a free-name subclass compiles.
export class Free extends FastBit1024 { free = 0; }
export class FreeM extends BitMapper { free = 0; }
