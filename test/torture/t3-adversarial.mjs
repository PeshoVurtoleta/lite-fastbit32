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
    return { fails, green: 0 };
}
