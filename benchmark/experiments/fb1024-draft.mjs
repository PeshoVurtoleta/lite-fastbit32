// FastBit1024 -- DRAFT for RESEARCH (not a lib edit). 32 x 32 = 1024 bits, two-level, fixed geometry.
//
// Invariants (every mutator keeps all four, so readers never repair anything):
//   I1  active bit w set  iff  data[w] !== 0          (lowest/highest/forEach/nextSetBit route through it)
//   I2  full   bit w set  iff  data[w] === -1         (nextClearBit/acquire route through it)
//   I3  n === popcount of every data word              (size/isFull are O(1), no 32-word popcount)
//   I4  no bit >= capacity is ever set                 (mutators reject it; padding is never stored)
// Storage is Int32Array so every word read is a signed int32, the same family as every bitwise result
// (compare-to-zero law, ROADMAP law 8): no read ever meets an unsigned double.

const badIndex = (i) => { throw new RangeError('FastBit1024: bad bit index ' + String(i)); };

export class FastBit1024 {
    constructor(capacity = 1024) {
        // cold door, fail closed: an integer 1..1024, nothing else (no coercion)
        if (typeof capacity !== 'number' || (capacity & 2047) !== capacity || capacity < 1 || capacity > 1024) {
            throw new RangeError('FastBit1024: capacity must be an integer 1..1024, got ' + String(capacity));
        }
        this.cap = capacity;
        this.active = 0;
        this.full = 0;
        this.n = 0;
        this.data = new Int32Array(32);
    }

    // ---- single-bit mutators: fail closed (RESEARCH 11.3 b -- a bad index under a summary corrupts OTHER answers)
    // (i & 1023) !== i rejects undefined, null, NaN, 1.5, '3', true, -1, 1024, 2^32 in ONE and + compare;
    // a Symbol/BigInt throws TypeError on `&` itself (still closed).
    add(bit) {
        if ((bit & 1023) !== bit || bit >= this.cap) badIndex(bit);
        const w = bit >>> 5, b = bit & 31, old = this.data[w], d = old | (1 << b);
        this.data[w] = d;
        this.n += ((old >>> b) & 1) ^ 1;          // +1 only if the bit was clear
        this.active |= 1 << w;
        this.full |= (((d + 1) | -(d + 1)) >>> 31 ^ 1) << w; // 1 iff d === -1 (d + 1 === 0), no branch
        return this;
    }
    remove(bit) {
        if ((bit & 1023) !== bit || bit >= this.cap) badIndex(bit);
        const w = bit >>> 5, b = bit & 31, old = this.data[w], d = old & ~(1 << b);
        this.data[w] = d;
        this.n -= (old >>> b) & 1;                // -1 only if the bit was set
        this.full &= ~(1 << w);                   // a word with a clear bit is never full
        this.active &= ~((((d | -d) >>> 31) ^ 1) << w); // clear iff d === 0
        return this;
    }
    toggle(bit) {
        if ((bit & 1023) !== bit || bit >= this.cap) badIndex(bit);
        return ((this.data[bit >>> 5] >>> (bit & 31)) & 1) === 0 ? this.add(bit) : this.remove(bit);
    }
    has(bit) {
        if ((bit & 1023) !== bit || bit >= this.cap) badIndex(bit);
        return (this.data[bit >>> 5] & (1 << (bit & 31))) !== 0;
    }

    // ---- pool: the reason the structure exists
    /** Take the LOWEST free slot (dense, deterministic reuse). -1 when full. O(1): two clz32, no loop. */
    acquire() {
        const s = this.nextClearBit();
        if (s === -1) return -1;
        const w = s >>> 5, d = this.data[w] | (1 << (s & 31));
        this.data[w] = d;
        this.n++;
        this.active |= 1 << w;
        this.full |= (((d + 1) | -(d + 1)) >>> 31 ^ 1) << w;
        return s;
    }
    /** Give a slot back. Throws on a bad index AND on a slot that is not held (double release fails closed). */
    release(slot) {
        if ((slot & 1023) !== slot || slot >= this.cap) badIndex(slot);
        const w = slot >>> 5, m = 1 << (slot & 31), old = this.data[w];
        if ((old & m) === 0) throw new Error('FastBit1024: release of a free slot ' + String(slot));
        const d = old & ~m;
        this.data[w] = d;
        this.n--;
        this.full &= ~(1 << w);
        this.active &= ~((((d | -d) >>> 31) ^ 1) << w);
        return this;
    }

    // ---- O(1) queries
    get size() { return this.n; }
    get capacity() { return this.cap; }
    isEmpty() { return this.active === 0; }
    isFull() { return this.n === this.cap; }

    lowest() {
        const a = this.active;
        if (a === 0) return -1;                   // guard: data[-1] would be an out-of-bounds read
        const w = 31 - Math.clz32(a & -a), d = this.data[w];
        return (w << 5) + (31 - Math.clz32(d & -d));
    }
    highest() {
        const a = this.active;
        if (a === 0) return -1;
        const w = 31 - Math.clz32(a), d = this.data[w];
        return (w << 5) + (31 - Math.clz32(d));
    }
    /** Lowest clear bit below capacity, or -1. Padding is never stored (I4), so "lowest clear >= cap" means none. */
    nextClearBit() {
        const f = ~this.full;
        if (f === 0) return -1;
        const w = 31 - Math.clz32(f & -f), c = ~this.data[w];
        const s = (w << 5) + (31 - Math.clz32(c & -c));
        return s < this.cap ? s : -1;
    }
    /** Lowest set bit >= from, or -1. from in 0..capacity. Closure-free cursor:
     *  for (let b = s.nextSetBit(0); b !== -1; b = s.nextSetBit(b + 1)) */
    nextSetBit(from) {
        if ((from & 2047) !== from || from > this.cap) badIndex(from);
        const w = from >>> 5;                     // 32 only when from === 1024
        const d = w < 32 ? this.data[w] & (-1 << (from & 31)) : 0;
        if (d !== 0) return (w << 5) + (31 - Math.clz32(d & -d));
        const a = this.active & (-2 << w) & ((w - 32) >> 31); // words strictly above w; -2 << 31 === 0, w = 32 -> 0
        if (a === 0) return -1;
        const w2 = 31 - Math.clz32(a & -a), d2 = this.data[w2];
        return (w2 << 5) + (31 - Math.clz32(d2 & -d2));
    }

    // ---- set relations with another FastBit1024 (O(non-empty words of `other`), compare-to-zero law)
    /** true iff every bit of `other` is set here (ECS: entity has every component of the signature). */
    hasAll(other) {
        if ((other.active & ~this.active) !== 0) return false; // a non-empty word of other is empty here
        const od = other.data, td = this.data;
        for (let a = other.active; a !== 0; a &= a - 1) {
            const w = 31 - Math.clz32(a & -a);
            if ((od[w] & ~td[w]) !== 0) return false;
        }
        return true;
    }
    hasAny(other) {
        const od = other.data, td = this.data;
        for (let a = other.active & this.active; a !== 0; a &= a - 1) {
            const w = 31 - Math.clz32(a & -a);
            if ((od[w] & td[w]) !== 0) return true;
        }
        return false;
    }

    // ---- iteration: O(k + non-empty words); hoist the callback (a capturing closure allocates)
    forEach(cb) {
        const data = this.data;
        for (let a = this.active; a !== 0; a &= a - 1) {
            const w = 31 - Math.clz32(a & -a), base = w << 5;
            for (let d = data[w]; d !== 0; d &= d - 1) cb(base + (31 - Math.clz32(d & -d)));
        }
        return this;
    }

    clear() {                                     // O(non-empty words), not a 32-word fill
        const data = this.data;
        for (let a = this.active; a !== 0; a &= a - 1) data[31 - Math.clz32(a & -a)] = 0;
        this.active = 0; this.full = 0; this.n = 0;
        return this;
    }
}
