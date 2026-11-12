// test/AF1Receiver.test.mjs -- AF-1 ASSERTION 2 (U-5) and the retention half of ASSERTION 4.
// FastBit1024#saveInto on a non-FastBit1024 receiver must throw
// TypeError('FastBit1024: expected a FastBit1024, got object') before any write.
// The base build de9a5d9 (git show, temp dir, file URL; fails closed) is the control:
// every forgery row there either returns or changes `out` (the defect).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as LIVE from '../FastBit32.js';
import { createLeakTracker } from '@zakkster/lite-leak';

const BASE = 'de9a5d9';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let baseSrc = '';
try {
    baseSrc = execFileSync('git', ['show', BASE + ':FastBit32.js'], { cwd: ROOT, encoding: 'utf8' });
} catch (e) {
    assert.fail('git show ' + BASE + ':FastBit32.js failed: ' + e.message);
}
assert.ok(baseSrc.length > 1000 && /class FastBit1024/.test(baseSrc), 'base text must be the FastBit32.js body');
const TMP = mkdtempSync(join(tmpdir(), 'af1-recv-'));
let OLD;
before(async () => {
    writeFileSync(join(TMP, 'base.mjs'), baseSrc);
    OLD = await import(pathToFileURL(join(TMP, 'base.mjs')).href);
});
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const SENT = 0x7EADBEEF;
const MSG = 'FastBit1024: expected a FastBit1024, got object';
const fresh = () => new Int32Array(40).fill(SENT);
const untouched = (out) => { for (let i = 0; i < 40; i++) if (out[i] !== SENT) return false; return true; };

function rows(M) {
    const real = new M.FastBit1024(64); real.add(3).add(40);
    return [
        ['{}', {}],
        ['{ _cap: 64 }', { _cap: 64 }],
        ['Object.create(FastBit1024.prototype)', Object.create(M.FastBit1024.prototype)],
        ['Proxy of a real FastBit1024', new Proxy(real, {})],
        ['FastBit64', new M.FastBit64(1, 2)],
        ['FastBit32', new M.FastBit32(5)]
    ];
}

describe('AF-1 U-5: FastBit1024#saveInto receiver check', () => {
    for (const off of [0, 5]) {
        test('live: every forgery throws TypeError before any write (offset ' + off + ')', () => {
            const rs = rows(LIVE);
            assert.equal(rs.length, 6);
            for (const [name, r] of rs) {
                const out = fresh();
                assert.throws(() => LIVE.FastBit1024.prototype.saveInto.call(r, out, off),
                    (e) => e instanceof TypeError && e.message === MSG, name);
                assert.ok(untouched(out), name + ': out must stay the sentinel');
            }
        });
        test('control on base: each forgery row returns or changes out (offset ' + off + ')', () => {
            for (const [name, r] of rows(OLD)) {
                const out = fresh();
                let returned = false;
                try { OLD.FastBit1024.prototype.saveInto.call(r, out, off); returned = true; } catch (e) { /* may throw */ }
                assert.ok(returned || !untouched(out), name + ': base must show the defect');
            }
        });
    }

    test('primitive receiver throws a TypeError and writes nothing', () => {
        for (const p of [undefined, null, 1, 'x']) {
            const out = fresh();
            assert.throws(() => LIVE.FastBit1024.prototype.saveInto.call(p, out), TypeError);
            assert.ok(untouched(out));
        }
    });

    test('subclass saves the same words as the base class instance with the same bits', () => {
        class S extends LIVE.FastBit1024 {}
        for (const off of [0, 5]) {
            const s = new S(64); s.add(0).add(33).add(63);
            const b = new OLD.FastBit1024(64); b.add(0).add(33).add(63);
            const o1 = fresh(), o2 = fresh();
            const r1 = s.saveInto(o1, off), r2 = b.saveInto(o2, off);
            assert.equal(r1, off + 3);
            assert.equal(r2, off + 3);
            assert.deepEqual(Array.from(o1), Array.from(o2));
            assert.ok(o1[off + 1] !== 0 || o1[off + 2] !== 0);
        }
    });

    test('pin (both builds): FastBit64.prototype.saveInto.call({}, out) throws TypeError, out untouched', () => {
        for (const [tag, M] of [['live', LIVE], ['base', OLD]]) {
            for (const off of [0, 5]) {
                const out = fresh();
                assert.throws(() => M.FastBit64.prototype.saveInto.call({}, out, off), TypeError, tag);
                assert.ok(untouched(out), tag);
            }
        }
    });
});

describe('AF-1 retention (ASSERTION 4): rejected forgery saves leak nothing', () => {
    function moduleNoop() { /* must not close over the tracked target */ }
    // Plain sync functions: no suspended frame holds a target across the drain.
    function cycle(tracker, tag0) {
        const out = new Int32Array(40);
        let tag = tag0;
        for (let i = 0; i < 10000; i++) {
            const forged = i & 1 ? { _cap: 64 } : {};
            let err = null;
            try { LIVE.FastBit1024.prototype.saveInto.call(forged, out, 0); } catch (e) { err = e; }
            if (err === null) throw new Error('forgery was accepted');
            if (i % 100 === 0) {
                tracker.track(forged, moduleNoop, tag++, { audit: true });
                tracker.track(err, moduleNoop, tag++, { audit: true });
            }
        }
        const real = new LIVE.FastBit1024(64);
        for (let i = 0; i < 10000; i++) {
            real.add(i & 63);
            real.saveInto(out, i & 5);
        }
        tracker.track(real, moduleNoop, tag++, { audit: true });
        tracker.track(out, moduleNoop, tag++, { audit: true });
    }
    test('3 cycles x (10,000 rejected + 10,000 real saves) -> tracker.size() === 0 after gc', async () => {
        v8.setFlagsFromString('--expose-gc');
        const gc = vm.runInNewContext('gc');
        assert.equal(typeof gc, 'function', 'gc unavailable: fail closed');
        const tracker = createLeakTracker({ name: 'af1-receiver', onWarning: () => {} });
        for (let c = 0; c < 3; c++) cycle(tracker, c * 1000);
        assert.equal(tracker.size(), 606, 'coverage: 3 x (100 forged + 100 errors + real + out) tracked before the drain');
        let live = tracker.size();
        for (let r = 0; r < 20 && live > 0; r++) {
            gc();
            await new Promise((res) => setTimeout(res, 25));
            live = tracker.size();
        }
        assert.equal(live, 0);
    });
});
