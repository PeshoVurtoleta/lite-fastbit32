// test/torture/t3-adversarial.mjs -- pool fill/drain, ECS sizes, toggle storms,
// fromArray edges. isFull() on a signed all-ones word is the teeth for the
// isfull-unsigned control (=== 0xFFFFFFFF reads false on -1).

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
    return { fails, green: 0 };
}

// ---- S4b FastBit1024: the bad-input matrix (fail closed, byte-identical) ----
// Every index-taking method, release and the ctor reject every row of the
// matrix; the instance snapshot (_cap, _active, _full, _n, all 32 _data words) must not
// move. Symbol, BigInt and a null-proto object must throw TypeError (from `&`
// itself); every other row must be a RangeError. release() of a free slot
// throws too. hasAll/hasAny throw TypeError on anything but a FastBit1024.
function fb1024BadInput(ctx, F) {
    const C = ctx.FB1024;
    const o = ctx.oracle;
    const typeErr = { Symbol: 1, BigInt: 1, 'null-proto': 1 };
    for (const cap of [1, 100, 1024]) {
        const s = new C(cap);
        s.add(0).add(cap - 1).add(cap >> 1);
        const snap = o.fb1024Snapshot(s);
        for (const [tag, v] of o.fb1024BadInputs(cap)) {
            for (const op of ['add', 'remove', 'toggle', 'has', 'release', 'nextSetBit']) {
                if (op === 'nextSetBit' && (tag === 'cap' || (tag === '1024' && cap === 1024))) continue; // from = cap is in domain
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
            for (const op of ['hasAll', 'hasAny']) {
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
