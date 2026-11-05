// test/torture/t3-adversarial.mjs -- pool fill/drain, ECS sizes, toggle storms,
// fromArray edges. isFull() on a signed all-ones word is the teeth for the
// isfull-unsigned control (=== 0xFFFFFFFF reads false on -1).

import { Worker } from 'node:worker_threads';
import { oNextClearBit, oToArray, oUnion, oToArray as _t, ubit } from './oracle.mjs';

export function run(ctx) {
    const FB = ctx.FB;
    const fails = [];
    const F = (m) => fails.push('T3: ' + m);

    // ---- pool: fill 32 slots via nextClearBit --------------------------------
    const occ = new FB();
    const model = new Uint8Array(32);
    for (let n = 0; n < 32; n++) {
        const slot = occ.nextClearBit();
        const want = oNextClearBit(occ.value);
        if (slot !== want) F('pool nextClearBit at n=' + n + ' got ' + slot + ' want ' + want);
        if (slot < 0) { F('pool exhausted early at n=' + n); break; }
        occ.add(slot);
        model[slot] = 1;
    }
    if (occ.isFull() !== true) F('pool not full after 32 adds (isFull teeth)');
    if (occ.count() !== 32) F('pool count != 32');
    if (occ.nextClearBit() !== -1) F('full pool nextClearBit != -1');

    // free ascending, descending, and a fixed scramble; refill; check occupancy
    const orders = [
        [...Array(32).keys()],
        [...Array(32).keys()].reverse(),
        [0, 31, 15, 7, 23, 3, 19, 11, 27, 1, 30, 14, 6, 22, 2, 18, 10, 26, 5, 29, 13, 21, 9, 25, 4, 28, 12, 20, 8, 24, 16, 17]
    ];
    for (const order of orders) {
        for (const slot of order) { occ.remove(slot); model[slot] = 0; }
        if (!occ.isEmpty()) F('pool not empty after full drain');
        // refill
        for (let n = 0; n < 32; n++) { const s = occ.nextClearBit(); occ.add(s); model[s] = 1; }
        for (let i = 0; i < 32; i++) if (((occ.value >>> i) & 1) !== model[i]) F('pool occupancy mismatch at bit ' + i);
    }

    // ---- isFull flips exactly at 32 ------------------------------------------
    const build = new FB();
    for (let i = 0; i < 32; i++) {
        if (build.isFull() !== false) F('isFull true before bit ' + i);
        build.add(i);
    }
    if (build.isFull() !== true) F('isFull false after all 32 adds (isFull teeth)');

    // ---- ECS: signatures of size 1, 2, 32 incl. index 31 --------------------
    for (let idx = 0; idx < 32; idx++) {
        const sig = (1 << idx) >>> 0;
        const e = new FB().add(idx);
        // entity has exactly the one component it needs; hasAll must be true for
        // every signature incl. the unsigned bit-31 mask (FB-01 fixed in 1.2.1).
        if (e.hasAll(sig) !== true) F('ECS size-1 idx ' + idx);
    }
    // size 32: all bits set, assert via isFull/count (signedness-safe)
    const all = new FB();
    for (let i = 0; i < 32; i++) all.add(i);
    if (!all.isFull()) F('ECS size-32 isFull');

    // ---- toggle storms on bit 31, and bits 30+31 ----------------------------
    const st = new FB();
    let mdl = 0;
    for (let n = 0; n < 200; n++) {
        st.toggle(31); mdl ^= (1 << 31);
        if (((st.value ^ mdl) >>> 0) !== 0) { F('toggle storm bit 31 at ' + n); break; }
    }
    const st2 = new FB();
    let mdl2 = 0;
    for (let n = 0; n < 200; n++) {
        st2.toggle(30); mdl2 ^= (1 << 30);
        st2.toggle(31); mdl2 ^= (1 << 31);
        if (((st2.value ^ mdl2) >>> 0) !== 0) { F('toggle storm bits 30+31 at ' + n); break; }
    }

    // ---- fromArray: reverse, dups, all --------------------------------------
    const rev = new FB().fromArray([...Array(32).keys()].reverse());
    if (((rev.value ^ 0xFFFFFFFF) >>> 0) !== 0) F('fromArray reverse-all != full');
    const dups = new FB().fromArray([5, 5, 5, 7, 7]);
    if (((dups.value ^ ((1 << 5) | (1 << 7))) >>> 0) !== 0) F('fromArray dups');
    const allArr = new FB().fromArray([...Array(32).keys()]);
    if (!allArr.isFull()) F('fromArray all not full');

    void oToArray; void oUnion; void _t; void ubit;
    // a broken variant (T9 control) may throw mid-sequence: that is a FAIL row, never a crash
    try { fb1024BadInput(ctx, F); } catch (e) { F('FastBit1024 rows threw ' + e.constructor.name + ': ' + e.message); }
    try { fb1024ImageBadInput(ctx, F); } catch (e) { F('FastBit1024 image rows threw ' + e.constructor.name + ': ' + e.message); }
    try { fb1024SabRow(ctx, F); } catch (e) { F('FastBit1024 SAB row threw ' + e.constructor.name + ': ' + e.message); }
    return { fails, green: 0 };
}

// ---- S4b FastBit1024: the bad-input matrix (fail closed, byte-identical) ----
// Every index-taking method, release and the ctor reject every row of the
// matrix; the instance snapshot (_cap, _active, _full, _n, all 32 _data words) must not
// move. Symbol, BigInt and a null-proto object must throw TypeError (from `&`
// itself); every other row must be a RangeError. release() of a free slot
// throws too. hasAll/hasAny and the three G2 counts throw TypeError on anything
// but a FastBit1024. G2 prevSetBit takes the index rows except '-1' (its domain
// is -1..cap-1, so '-1' is valid there and 'cap' is not).
function fb1024BadInput(ctx, F) {
    const C = ctx.FB1024;
    const o = ctx.oracle;
    const typeErr = { Symbol: 1, BigInt: 1, 'null-proto': 1 };
    for (const cap of [1, 100, 1024]) {
        const s = new C(cap);
        s.add(0).add(cap - 1).add(cap >> 1);
        const snap = o.fb1024Snapshot(s);
        for (const [tag, v] of o.fb1024BadInputs(cap)) {
            for (const op of ['add', 'remove', 'toggle', 'has', 'release', 'nextSetBit', 'prevSetBit']) {
                if (op === 'nextSetBit' && (tag === 'cap' || (tag === '1024' && cap === 1024))) continue; // from = cap is in domain
                if (op === 'prevSetBit' && tag === '-1') continue; // from = -1 is in domain
                let err = null;
                try { s[op](v); } catch (e) { err = e; }
                if (err === null) F('FB1024 ' + op + '(' + tag + ') did not throw (cap ' + cap + ')');
                else if (!(err instanceof (typeErr[tag] ? TypeError : RangeError))) F('FB1024 ' + op + '(' + tag + ') threw ' + err.constructor.name + ', want ' + (typeErr[tag] ? 'TypeError' : 'RangeError'));
                if (o.fb1024Snapshot(s) !== snap) { F('FB1024 ' + op + '(' + tag + ') moved the state (cap ' + cap + ')'); return; }
            }
        }
        // hasAll/hasAny take a FastBit1024 only: anything else is a TypeError, state unchanged
        for (const [tag, v] of [['undefined', undefined], ['null', null], ['{}', {}], ['{active:0}', { active: 0 }],
            ['{_active:0}', { _active: 0, _data: new Int32Array(32) }], ['FastBit32', new ctx.FB(2)], ['number', 5]]) {
            for (const op of ['hasAll', 'hasAny', 'intersectionSize', 'unionSize', 'differenceSize']) {
                let err = null;
                try { s[op](v); } catch (e) { err = e; }
                if (!(err instanceof TypeError)) F('FB1024 ' + op + '(' + tag + ') ' + (err === null ? 'returned' : 'threw ' + err.constructor.name) + ', want TypeError');
                if (o.fb1024Snapshot(s) !== snap) { F('FB1024 ' + op + '(' + tag + ') moved the state'); return; }
            }
        }
        if (s.nextSetBit(cap) !== -1) F('FB1024 nextSetBit(cap) != -1 (cap ' + cap + ')');
        let threw = false;
        try { s.nextSetBit(cap + 1); } catch (e) { threw = e instanceof RangeError; }
        if (!threw) F('FB1024 nextSetBit(cap + 1) did not throw RangeError (cap ' + cap + ')');
        if (cap > 2) {
            threw = false;
            try { s.release(1); } catch (e) { threw = e instanceof RangeError; }
            if (!threw) F('FB1024 double release did not throw RangeError (cap ' + cap + ')');
            if (o.fb1024Snapshot(s) !== snap) F('FB1024 double release moved the state (cap ' + cap + ')');
        }
    }
    for (const [tag, v] of [['0', 0], ['-1', -1], ['1025', 1025], ['1.5', 1.5], ["'64'", '64'], ['null', null], ['NaN', NaN],
        ['true', true], ['2^32', 2 ** 32], ['Infinity', Infinity], ['-0', -0], ['Symbol', Symbol('c')], ['BigInt', 64n],
        ['{}', {}], ['null-proto', Object.create(null)]]) {
        let err = null;
        try { new C(v); } catch (e) { err = e; }
        if (!(err instanceof RangeError)) F('FB1024 ctor(' + tag + ') ' + (err === null ? 'accepted' : 'threw ' + err.constructor.name) + ', want RangeError');
    }
    if (new C().capacity !== 1024 || new C(undefined).capacity !== 1024) F('FB1024 default capacity != 1024');
    // -0 is slot 0 (the one-check form accepts it by design)
    const z = new C(4).add(-0);
    if (!z.has(0) || z.size !== 1) F('FB1024 add(-0) is not slot 0');
}

// ---- G1 (1.6.0) FastBit1024 save / restore / brand: must-throw rows ---------
// Each row names the error class AND the exact library message (or its
// 'FastBit1024: ...' prefix where the value printed varies), and checks the
// receiver snapshot (and the watched buffer bytes) unchanged. Images are built
// by a naive local builder (header + LSB-first words), never by saveInto /
// serialize, so every row runs on its own: on the 1.5.0 build each row fails
// by itself (no such method -> a TypeError with a foreign message).
// Rows: p2's G1 subset at caps 1 / 33 / 500 / 1024; the Q-8 brand x copy /
// equals / hasAll / hasAny (forgery, Proxy, lying-_active Proxy); p7 x3; p8 x5
// (row 5, a subclass whose length getter detaches, is an EXACT load with 0
// getter calls: the M13 control's teeth); one Liar-subclass `out`; the
// %TypedArray% getters patched after import (0 calls); Q-10: one row per view
// type re-prototyped to Int32Array.prototype for saveInto AND loadFrom (and
// deserialize); detached src / out; a subclass that must pass.
const IMG_TAG = 0x46420800;
const MSG_OUT = 'FastBit1024: out must be an Int32Array';
const MSG_SRC = 'FastBit1024: src must be an Int32Array';
const MSG_OBJ = 'FastBit1024: expected a FastBit1024, got object';
const MSG_OFF = 'FastBit1024: offset must be a non-negative integer that fits the image, got ';
const MSG_IMG = 'FastBit1024: bad image: ';
const MSG_FIT = 'FastBit1024: a set bit is at or above capacity ';

function naiveImage(cap, bits, len) {
    const a = new Int32Array(len === undefined ? 1 + ((cap + 31) >>> 5) : len);
    a[0] = IMG_TAG | cap;
    for (let i = 0; i < bits.length; i++) a[1 + (bits[i] >>> 5)] |= 1 << (bits[i] & 31);
    return a;
}
function bufBytes(buf) { try { return Array.prototype.join.call(new Uint8Array(buf), ','); } catch (e) { return 'detached'; } }

function fb1024ImageBadInput(ctx, F) {
    const C = ctx.FB1024;
    const o = ctx.oracle;
    const cnt = { rows: 0, bad: 0, accepted: 0 };
    const KEY = new Int32Array(1);
    KEY[0] = (ctx.seed ^ 0x6a09e667) | 0 || 0x2545f491;
    const rnd = (n) => { let x = KEY[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; KEY[0] = x; return (x >>> 0) % n; };
    const mk = (cap, bits) => { const s = new C(cap); for (let i = 0; i < bits.length; i++) s.add(bits[i]); return s; };
    const bad = (label, why) => { cnt.bad++; F('FB1024 img ' + label + ': ' + why); };
    // one must-throw row; msg is the exact message, or { p: prefix }
    const row = (label, Cls, msg, recv, buf, fn) => {
        cnt.rows++;
        const s0 = recv ? o.fb1024Snapshot(recv) : '', b0 = buf ? bufBytes(buf) : '';
        let err = null;
        try { fn(); } catch (e) { err = e; }
        let why = null;
        if (err === null) why = 'did not throw (want ' + Cls.name + ')';
        else if (!(err instanceof Cls)) why = 'threw ' + (err && err.constructor ? err.constructor.name : typeof err) + ' "' + (err && err.message) + '", want ' + Cls.name;
        else if (typeof msg === 'string' ? err.message !== msg : !String(err.message).startsWith(msg.p)) why = 'message "' + err.message + '"';
        if (why === null && recv && o.fb1024Snapshot(recv) !== s0) why = 'receiver changed by a rejected call';
        if (why === null && buf && bufBytes(buf) !== b0) why = 'buffer written by a rejected call';
        if (why !== null) bad(label, why);
    };
    // one accepted row: fn returns null or a reason
    const ok = (label, fn) => {
        cnt.rows++; cnt.accepted++;
        let why;
        try { why = fn(); } catch (e) { why = 'threw ' + (e && e.constructor ? e.constructor.name : typeof e) + ' "' + (e && e.message) + '"'; }
        if (why !== null) bad(label, why);
    };
    // the loaded bits, read raw, against the expected list
    const sameBits = (s, cap, bits) => {
        const want = new Uint8Array(1024);
        for (let i = 0; i < bits.length; i++) want[bits[i]] = 1;
        for (let b = 0; b < 1024; b++) if (((s._data[b >>> 5] >>> (b & 31)) & 1) !== want[b]) return 'bit ' + b + ' is ' + (want[b] ^ 1);
        if (s._cap !== cap) return '_cap ' + s._cap + ' want ' + cap;
        return o.fb1024Invariants(s);
    };

    // ---- p2's G1 subset at caps 1 / 33 / 500 / 1024 ----
    for (const cap of [1, 33, 500, 1024]) {
        const bits = [];
        for (let b = 0; b < cap; b++) if (rnd(1000) < 300) bits.push(b);
        if (bits.length === 0) bits.push(cap - 1);
        const s = mk(cap, bits);
        const L = (cap + 31) >>> 5;
        const good = naiveImage(cap, bits);
        const P = 'cap ' + cap + ' ';
        if ((cap & 31) !== 0) {
            const b1 = good.slice(); b1[L] |= 1 << (cap & 31);
            row(P + 'bit == capacity', RangeError, MSG_IMG + 'bit >= image capacity', s, b1.buffer, () => s.loadFrom(b1));
            const b2 = good.slice(); b2[L] |= 1 << 31;
            row(P + 'bit 31 of the last word', RangeError, MSG_IMG + 'bit >= image capacity', s, b2.buffer, () => s.loadFrom(b2));
        }
        for (const hd of [0, -1, IMG_TAG, IMG_TAG | 1025, IMG_TAG | 2047, (IMG_TAG ^ (1 << 11)) | cap, 0x46410800 | cap, cap]) {
            const b = good.slice(); b[0] = hd;
            row(P + 'header 0x' + (hd >>> 0).toString(16), RangeError, { p: MSG_IMG }, s, b.buffer, () => s.loadFrom(b));
        }
        row(P + 'truncated', RangeError, MSG_IMG + 'length', s, null, () => s.loadFrom(good.subarray(0, L)));
        for (const [off, shown] of [[-1, '-1'], [1.5, '1.5'], [NaN, 'NaN'], ['0', 'string'], [null, 'object'], [2 ** 31, '2147483648'], [good.length, String(good.length)]]) {
            row(P + 'offset ' + String(off), RangeError, MSG_OFF + shown, s, null, () => s.loadFrom(good, off));
        }
        row(P + 'offset 1 (a data word as header)', RangeError, { p: 'FastBit1024: ' }, s, null, () => s.loadFrom(good, 1));
        for (const [lbl, src] of [['null', null], ['{}', {}], ["'abc'", 'abc'], ['42', 42], ['Uint32Array', new Uint32Array(good.buffer.slice(0))],
            ['Float64Array', new Float64Array(good.length)], ['Uint8Array', new Uint8Array(4)]]) {
            row(P + 'src ' + lbl, TypeError, MSG_SRC, s, null, () => s.loadFrom(src));
        }
        row(P + 'Array image', TypeError, MSG_SRC, s, null, () => s.loadFrom(Array.from(good)));
        {
            const t = good.slice();
            const px = new Proxy(t, { get(tt, k) { const v = Reflect.get(tt, k); return typeof v === 'function' ? v.bind(tt) : v; } });
            row(P + 'Proxy(Int32Array) image', TypeError, MSG_SRC, s, t.buffer, () => s.loadFrom(px));
        }
        row(P + 'deserialize(Array)', TypeError, MSG_SRC, null, null, () => C.deserialize(Array.from(good)));
        if (cap < 1024) {
            const big = naiveImage(1024, [0, cap]);
            row(P + 'load a 1024-image with bit ' + cap, RangeError, MSG_FIT + cap, s, big.buffer, () => s.loadFrom(big));
            const bigSet = mk(1024, [0, cap]);
            row(P + 'copy from a 1024-set with bit ' + cap, RangeError, MSG_FIT + cap, s, null, () => s.copy(bigSet));
            const big2 = naiveImage(1024, [1023]);
            row(P + 'load a 1024-image with bit 1023', RangeError, MSG_FIT + cap, s, big2.buffer, () => s.loadFrom(big2));
        }
        for (const [lbl, x] of [['null', null], ['object', {}], ['number', 42], ['object', s._data]]) {
            row(P + 'copy(' + lbl + ')', TypeError, 'FastBit1024: expected a FastBit1024, got ' + lbl, s, null, () => s.copy(x));
            row(P + 'equals(' + lbl + ')', TypeError, 'FastBit1024: expected a FastBit1024, got ' + lbl, s, null, () => s.equals(x));
        }
        {
            const out = new Int32Array(L + 1).fill(7);
            const sh = new Int32Array(L).fill(7);
            row(P + 'saveInto short out', RangeError, MSG_OFF + '0', s, sh.buffer, () => s.saveInto(sh));
            row(P + 'saveInto offset 1 overflow', RangeError, MSG_OFF + '1', s, out.buffer, () => s.saveInto(out, 1));
            row(P + 'saveInto offset -1', RangeError, MSG_OFF + '-1', s, out.buffer, () => s.saveInto(out, -1));
            row(P + 'saveInto offset 0.5', RangeError, MSG_OFF + '0.5', s, out.buffer, () => s.saveInto(out, 0.5));
            row(P + 'saveInto Array out', TypeError, MSG_OUT, s, null, () => s.saveInto([], 0));
            const u = new Uint32Array(L + 1);
            row(P + 'saveInto Uint32Array out', TypeError, MSG_OUT, s, u.buffer, () => s.saveInto(u, 0));
        }
    }

    // ---- Q-8: forgery / Proxy / lying-_active x copy / equals / hasAll / hasAny (+ G2 counts) ----
    for (const op of ['copy', 'equals', 'hasAll', 'hasAny', 'intersectionSize', 'unionSize', 'differenceSize']) {
        const forgery = Object.create(C.prototype);
        forgery._cap = 1024; forgery._active = 1; forgery._full = 0; forgery._n = 1; forgery._data = new Int32Array(32); forgery._data[0] = 8;
        const real = mk(1024, [3, 900]);
        const px = new Proxy(real, {});
        let n = 0;
        const liar = new Proxy(mk(1024, [3, 900]), { get(t, k) { return k === '_active' && n++ === 0 ? 1 : Reflect.get(t, k); } });
        for (const [lbl, x] of [['forgery', forgery], ['Proxy', px], ['lying-_active Proxy', liar]]) {
            const r = mk(100, [5]);
            row('Q-8 ' + op + '(' + lbl + ')', TypeError, MSG_OBJ, r, null, () => r[op](x));
        }
    }

    // ---- p7 x3: a source that changes between reads is not an Int32Array ----
    {
        const img = naiveImage(500, [3]);
        const L = img.length;
        const arr = Array.from(img); let n = 0;
        Object.defineProperty(arr, L - 1, { get() { return n++ === 0 ? 0 : -1; } });
        const r1 = mk(500, [9]);
        row('p7 Array, accessor last word', TypeError, MSG_SRC, r1, null, () => r1.loadFrom(arr));
        const t2 = img.slice(); let n2 = 0;
        const p2 = new Proxy(t2, { get(t, k) { if (k === String(L - 1)) return n2++ === 0 ? 0 : -1; const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v; } });
        const r2 = mk(500, [9]);
        row('p7 Proxy(Int32Array), last word flips', TypeError, MSG_SRC, r2, t2.buffer, () => r2.loadFrom(p2));
        const t3 = img.slice();
        const p3 = new Proxy(t3, { get(t, k) { if (k === '1') return 1.5; const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v; } });
        const r3 = mk(500, [9]);
        row('p7 Proxy(Int32Array), word 1 = 1.5', TypeError, MSG_SRC, r3, t3.buffer, () => r3.loadFrom(p3));
    }

    // ---- p8 x5 ----
    {
        const r1 = mk(1024, [7]);
        const f = Object.create(C.prototype);
        f._cap = 1024; f._active = 1; f._full = 0; f._n = 5000; f._data = new Int32Array(32); f._data[0] = 1;
        row('p8 copy(Object.create forgery, _n 5000)', TypeError, MSG_OBJ, r1, null, () => r1.copy(f));
        const r2 = mk(1024, [7]);
        const p = new Proxy(mk(1024, [3]), { get(t, k) { return k === '_n' ? 999 : Reflect.get(t, k); } });
        row('p8 copy(Proxy, _n 999)', TypeError, MSG_OBJ, r2, null, () => r2.copy(p));
        const r3 = mk(100, [7]);
        let n = 0;
        const pl = new Proxy(mk(1024, [3, 900]), { get(t, k) { if (k === '_active') return n++ === 0 ? 1 : Reflect.get(t, k); return Reflect.get(t, k); } });
        row('p8 copy(Proxy, _active lies to the fit check) cap 100', TypeError, MSG_OBJ, r3, null, () => r3.copy(pl));
        const bits = []; for (let b = 0; b < 500; b += 7) bits.push(b);
        const img = naiveImage(500, bits);
        class Liar extends Int32Array { get length() { return super.length + 64; } }
        const ta = new Liar(5); ta.set(img.subarray(0, 5));
        const r4 = mk(500, [1]);
        row('p8 Liar subclass (5 real words of 17) loadFrom', RangeError, MSG_IMG + 'length', r4, ta.buffer, () => r4.loadFrom(ta));
        let calls = 0;
        class Det extends Int32Array { get length() { if (++calls === 2) this.buffer.transfer(); return 17; } }
        const td = new Det(17); td.set(img);
        const r5 = mk(500, [1]);
        ok('p8 subclass detaching on its 2nd length read: exact load, 0 getter calls', () => {
            const ret = r5.loadFrom(td);
            if (calls !== 0) return 'subclass length getter called ' + calls + ' time(s)';
            if (ret !== 17) return 'returned ' + ret + ' want 17';
            return sameBits(r5, 500, bits);
        });
    }

    // ---- one Liar-subclass `out`: the lying length is never read ----
    {
        class LiarOut extends Int32Array { get length() { return super.length + 64; } }
        const out = new LiarOut(5).fill(7);
        const s = mk(500, [3, 499]);
        row('Liar subclass out (5 real words, needs 17)', RangeError, MSG_OFF + '0', s, out.buffer, () => s.saveInto(out));
    }

    // ---- %TypedArray%.prototype getters patched AFTER import: never called ----
    {
        const TA = Object.getPrototypeOf(Int32Array.prototype);
        const dL = Object.getOwnPropertyDescriptor(TA, 'length');
        const dT = Object.getOwnPropertyDescriptor(TA, Symbol.toStringTag);
        let calls = 0;
        const bits = [3, 250, 499];
        const out = new Int32Array(17);
        const s = mk(500, bits);
        const r = new C(500);
        let why = null;
        let tErr = null;
        try {
            Object.defineProperty(TA, 'length', { get() { calls++; return 999; }, configurable: true });
            Object.defineProperty(TA, Symbol.toStringTag, { get() { calls++; return 'Int32Array'; }, configurable: true });
            s.saveInto(out);
            r.loadFrom(out);
            const d = C.deserialize(out);
            why = sameBits(r, 500, bits) || sameBits(d, 500, bits);
            const u8 = new Uint8Array(68);
            Object.setPrototypeOf(u8, Int32Array.prototype);
            try { s.saveInto(u8); } catch (e) { tErr = e; }
        } catch (e) {
            why = 'threw ' + e.constructor.name + ' "' + e.message + '"';
        } finally {
            Object.defineProperty(TA, 'length', dL);
            Object.defineProperty(TA, Symbol.toStringTag, dT);
        }
        ok('%TypedArray% length / @@toStringTag patched after import', () => {
            if (calls !== 0) return 'patched getter called ' + calls + ' time(s)';
            if (why !== null) return why;
            if (!(tErr instanceof TypeError) || tErr.message !== MSG_OUT) return 're-prototyped Uint8Array under patched getters: ' + (tErr ? tErr.message : 'accepted');
            return null;
        });
    }

    // ---- Q-10: every other view type re-prototyped to Int32Array.prototype ----
    const types = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array];
    if (typeof globalThis.Float16Array === 'function') types.push(globalThis.Float16Array);
    let q10 = 0;
    {
        const good = naiveImage(500, [3, 499]);
        for (const T of types) {
            const v = new T(68);
            const vb = v.buffer;
            Object.setPrototypeOf(v, Int32Array.prototype);
            const r1 = mk(500, [1, 2]);
            row('Q-10 saveInto(' + T.name + ' re-prototyped)', TypeError, MSG_OUT, r1, vb, () => r1.saveInto(v, 0));
            const v2 = new T(68);
            if (!T.name.startsWith('Big')) for (let i = 0; i < good.length; i++) v2[i] = good[i] & 0x7F;
            const v2b = v2.buffer;
            Object.setPrototypeOf(v2, Int32Array.prototype);
            const r2 = mk(500, [7]);
            row('Q-10 loadFrom(' + T.name + ' re-prototyped)', TypeError, MSG_SRC, r2, v2b, () => r2.loadFrom(v2, 0));
            row('Q-10 deserialize(' + T.name + ' re-prototyped)', TypeError, MSG_SRC, null, v2b, () => C.deserialize(v2, 0));
            q10 += 2;
        }
    }
    // the positive control: an Int32Array subclass passes the tag check
    ok('Q-10 an Int32Array subclass passes (saveInto + loadFrom)', () => {
        class Sub extends Int32Array {}
        const out = new Sub(20);
        const s = mk(500, [0, 31, 32, 499]);
        if (s.saveInto(out, 2) !== 19) return 'saveInto returned a wrong offset';
        const r = mk(500, [5]);
        if (r.loadFrom(out, 2) !== 19) return 'loadFrom returned a wrong offset';
        return sameBits(r, 500, [0, 31, 32, 499]);
    });

    // ---- detached src / out ----
    {
        const out = new Int32Array(64);
        structuredClone(out.buffer, { transfer: [out.buffer] });
        const s = mk(500, [9]);
        row('saveInto detached out', RangeError, MSG_OFF + '0', s, null, () => s.saveInto(out));
        const src = naiveImage(500, [3], 64);
        structuredClone(src.buffer, { transfer: [src.buffer] });
        const r = mk(500, [9]);
        row('loadFrom detached src', RangeError, MSG_OFF + '0', r, null, () => r.loadFrom(src));
        row('deserialize detached src', RangeError, MSG_OFF + '0', null, null, () => C.deserialize(src));
    }

    ctx.measures.fb1024ImgT3 = { rows: cnt.rows, accepted: cnt.accepted, q10, failed: cnt.bad };
}

// ---- C-14: a concurrent writer on a SharedArrayBuffer (G1 SAB row) ---------
// A worker (sab-writer.mjs) tears the header and every data word of an image
// at offset 5 while this thread runs loadFrom into receivers of capacity 1 /
// 32 / 33 / 500 / 1024 (the fit path icap > cap included) and deserialize.
// After EVERY accepted call: I1-I4 (fb1024Invariants) AND 1 <= _cap <= 1024
// as an integer (the cap-0 / cap-2047 headers the writer stores are what a
// deserialize without its range re-check would keep). Count-based: SAB_N
// calls per receiver and per deserialize, no clock. Every call is checked; a
// break is never retried and never excused. Fail closed: 0 breaks required;
// a scenario with fewer than SAB_FLOOR accepted torn results (any set bit),
// or a writer that finished fewer than SAB_ROUNDS rounds during the row,
// FAILS (no vacuous pass). The worker is started once per process, unref'd,
// and parked (Atomics.wait) between rows.
//
// Window coverage (DESER-FIX). A torn result proves the writer ran, not that
// a call landed in the window a mutant differs at, and at load1 ~60 the
// writer can miss every call of a chunk. Two scenarios therefore also count
// HITS of their race window and need a floor of them:
// - deserialize: the header re-read window (C-14 re-check). The writer only
//   ever stores the H tag, so loadFrom's first check never says 'header'; a
//   'FastBit1024: bad image: header' RangeError from deserialize here is a
//   re-check rejection, i.e. the re-read header differed from the validated
//   one. A '_cap outside 1..1024' break is the same hit seen on a mutant
//   without the range re-check, so it counts too. Floor SAB_HITS = 64.
// - loadFrom cap 500: the tail-word window (C-14 mask). An accepted result
//   whose word 15 is exactly 0x000FFFFF (the cap-500 mask lm) means the write
//   pass read a word with all 20 low bits set; the check / fit pass saw no bit
//   >= 500 there, and the writer stores only 0, 1, -1 and random words, so
//   that read was a -1 (or random) the mask cut: a hit. Breaks in this
//   scenario count too. Floor SAB_TAIL = 8. Caps 1 and 33 have no sound
//   witness (their mask is 1, the writer's legal tail value) and caps 32 /
//   1024 cannot break without the mask, so only cap 500 is floored.
// A scenario below ANY of its floors (torn, hits) runs another SAB_N-call
// chunk after a 2 ms yield (the writer may have had no CPU), up to
// SAB_CHUNKS chunks in all; still below a floor -> FAIL closed with its own
// coverage reason. Counts on the real code (FastBit32.js d88876e, 2026-11-05),
// logged (inproc-table.log, 5 in-process runs, load1 5-7): deserialize hits
// 1255..1426, cap-500 tail hits 23..107 per first chunk; at load1 ~60 a chunk
// may read 0 (inferred from the NEXT.md GREEN, not measured).
// Miss probability on the mutants once a floor is met: every counted cap-500
// hit is a certain break without the mask (P(miss) ~ 0; the residue is a
// random word equal to exactly 0x000FFFFF, 2^-32 per write, counted as a hit
// it is not). A deserialize hit is a break without the range re-check only
// when the re-read header is 2047 (or 0 over no bits); measured share 0.48
// (10259 / 21274, 12 fb1024-deser-norange runs, inproc-table.log). If hits were
// independent, P(64 hits, 0 breaks) ~ 0.52^64 ~ 7e-19, nominal; they are not strictly
// independent (they come in writer-phase bursts), so that figure is nominal.
// Either way such a miss reads as a GREEN row only if the floor is met with
// 0 breaks; a coverage FAIL is never green.
const SAB_OFF = 5;
const SAB_N = 8000;
const SAB_FLOOR = 20;
const SAB_HITS = 64;
const SAB_TAIL = 8;
const SAB_ROUNDS = 10;
const SAB_CHUNKS = 64;
const SAB_MSG_HDR = 'FastBit1024: bad image: header';
const SAB_LM500 = 0x000FFFFF;
let SAB = null;

function sabWriter(seed) {
    if (SAB !== null) return SAB;
    const data = new SharedArrayBuffer(4 * 64);
    const ctlBuf = new SharedArrayBuffer(16);
    const w = new Worker(new URL('./sab-writer.mjs', import.meta.url), { workerData: { data, ctl: ctlBuf, off: SAB_OFF, seed: seed | 0 } });
    w.unref();
    SAB = { src: new Int32Array(data), ctl: new Int32Array(ctlBuf), w };
    return SAB;
}

function fb1024SabRow(ctx, F) {
    const C = ctx.FB1024;
    const inv = ctx.oracle.fb1024Invariants;
    const { src, ctl } = sabWriter(ctx.seed);
    Atomics.store(ctl, 0, 1);
    Atomics.notify(ctl, 0);
    if (Atomics.load(ctl, 1) === 0) Atomics.wait(ctl, 1, 0, 10000);
    if (Atomics.load(ctl, 1) !== 1) { Atomics.store(ctl, 0, 0); F('FB1024 SAB: the writer worker did not start (fail closed)'); return; }
    const r0 = Atomics.load(ctl, 2);
    for (let k = 0; k < 10000 && Atomics.load(ctl, 2) < r0 + 2; k++) Atomics.wait(ctl, 3, 0, 1);
    const rStart = Atomics.load(ctl, 2);
    const check = (s) => {
        const v = inv(s);
        if (v !== null) return v;
        const c = s._cap;
        if (typeof c !== 'number' || (c | 0) !== c || c < 1 || c > 1024) return '_cap ' + c + ' outside 1..1024';
        return null;
    };
    const per = [];
    let broke = 0;
    let first = '';
    let rounds = 0;
    try {
    for (const cap of [1, 32, 33, 500, 1024, 0]) {
        const r = cap === 0 ? null : new C(cap);
        // hit floor: deserialize -> SAB_HITS, cap 500 -> SAB_TAIL, others none (-1)
        const need = cap === 0 ? SAB_HITS : cap === 500 ? SAB_TAIL : -1;
        let acc = 0, threw = 0, torn = 0, br = 0, hits = 0, chunks = 0;
        for (let chunk = 0; chunk < SAB_CHUNKS && (chunk === 0 || !(torn >= SAB_FLOOR) || (need > 0 && !(hits >= need))); chunk++) {
        if (chunk > 0) Atomics.wait(ctl, 3, 0, 2);
        chunks++;
        for (let k = 0; k < SAB_N; k++) {
            let s = r;
            try {
                if (r === null) s = C.deserialize(src, SAB_OFF); else r.loadFrom(src, SAB_OFF);
            } catch (e) {
                if (!(e instanceof RangeError)) { br++; if (!first) first = (r === null ? 'deserialize' : 'cap ' + cap) + ' threw ' + e.constructor.name; }
                else if (r === null && e.message === SAB_MSG_HDR) hits++;
                threw++;
                continue;
            }
            acc++;
            if (s._n > 0) torn++;
            const v = check(s);
            if (v !== null) {
                br++;
                if (!first) first = (r === null ? 'deserialize' : 'loadFrom cap ' + cap) + ': ' + v;
                if (r === null ? v.startsWith('_cap ') : cap === 500) hits++;
            } else if (cap === 500 && s._data[15] === SAB_LM500) hits++;
        }
        }
        broke += br;
        per.push({ who: cap === 0 ? 'deserialize' : 'cap' + cap, acc, threw, torn, br, hits: need > 0 ? hits : null, chunks });
    }
    rounds = Atomics.load(ctl, 2) - rStart;
    } finally {
        Atomics.store(ctl, 0, 0);
    }
    ctx.measures.fb1024Sab = { per, rounds };
    if (broke !== 0) F('FB1024 SAB: ' + broke + ' invariant / capacity break(s) under a concurrent writer, first: ' + first);
    for (const p of per) {
        if (!(p.torn >= SAB_FLOOR)) F('FB1024 SAB coverage: ' + p.who + ' accepted ' + p.torn + ' torn results (need >= ' + SAB_FLOOR + '; ' + p.acc + ' accepted, ' + p.threw + ' threw) -- fail closed');
        if (p.who === 'deserialize' && !(p.hits >= SAB_HITS)) F('FB1024 SAB coverage: deserialize hit the header re-read window ' + p.hits + ' times in ' + p.chunks + ' chunk(s) (need >= ' + SAB_HITS + ') -- fail closed');
        if (p.who === 'cap500' && !(p.hits >= SAB_TAIL)) F('FB1024 SAB coverage: loadFrom cap 500 hit the tail-word window ' + p.hits + ' times in ' + p.chunks + ' chunk(s) (need >= ' + SAB_TAIL + ') -- fail closed');
    }
    if (!(rounds >= SAB_ROUNDS)) F('FB1024 SAB coverage: the writer finished ' + rounds + ' rounds during the row (need >= ' + SAB_ROUNDS + ') -- fail closed');
}
