// test/OptStatusLayout.test.mjs -- %GetOptimizationStatus layout detection
// (CI-4). V8 11.3-13.6 still has kAlwaysOptimize at bit 2, so every status bit
// above 0x2 sits one position higher than on V8 14.x; the torture harness
// detects the layout once and normalizes every word into the V8 14 layout.
//
// Recorded words (sources):
//   [S] .handoff/research/ci4/status-bits.out, `new Function` probes:
//       V8 12.4.254.21 (Node 22.23.4) / 13.6.233.17 (Node 24.22.2):
//         forced TurboFan 0x51, interpreted 0x81, marked-for-opt 0x181,
//         after deopt 0x81, Maglev (13.6 only) 0x31
//       V8 14.6.202.34 (Node 26.8.2):
//         forced TurboFan 0x29, interpreted 0x41, marked-for-opt 0xc1,
//         after deopt 0x41, Maglev 0x19
//   [C] CI run 42066992411: forced TurboFan 0x51 on V8 11.3 (Node 20.20.2).
// No row depends on wall time or host load.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { decodeStatusLayout, normalizeStatus } from './torture/harness.mjs';

describe('decodeStatusLayout (pure)', () => {
    it('V8 11.3-13.6 pair -> 1 ([S] 0x51 / 0x81, [C] 0x51)', () => {
        assert.strictEqual(decodeStatusLayout(0x51, 0x81), 1);
    });
    it('V8 14.6 pair -> 0 ([S] 0x29 / 0x41)', () => {
        assert.strictEqual(decodeStatusLayout(0x29, 0x41), 0);
    });
    const incoherent = [
        [0x31, 0x41, 'old Maglev word [S] 0x31 as tf, new interpreted'],
        [0x51, 0x41, 'old tf [S], new interpreted [S]'],
        [0x29, 0x81, 'new tf [S], old interpreted [S]'],
        [0, 0, 'all zero'],
        [0x79, 0xc1, 'both-layout-ish (0x29|0x51, 0x41|0x81)'],
        [0x29 | 0x40, 0x41, 'new tf with the interpreted bit set'],
        [0x31, 0x81, 'old Maglev tf [S], old interpreted'],
        [0x29, 0x69, 'interp probe optimized'],
        [0xd1, 0x81, 'old tf with old interpreted bit']
    ];
    for (const [tf, interp, why] of incoherent) {
        it('incoherent (0x' + tf.toString(16) + ', 0x' + interp.toString(16) + ') -> null: ' + why, () => {
            assert.strictEqual(decodeStatusLayout(tf, interp), null);
        });
    }
});

describe('normalizeStatus (pure)', () => {
    const rows = [
        [0x51, 1, 0x29, 'forced TurboFan [S][C]'],
        [0x181, 1, 0xc1, 'marked-for-opt [S]'],
        [0x81, 1, 0x41, 'interpreted / after deopt [S]'],
        [0x31, 1, 0x19, 'Maglev, V8 13.6 [S]'],
        [0x29, 0, 0x29, 'V8 14 word unchanged [S]'],
        [0x55, 1, 0x29, 'old bit 2 (kAlwaysOptimize) dropped: 0x51 | 0x4'],
        [0x2083, 1, 0x1043, 'jitless never+lite: V8 12.4/13.6 raw 0x2083, V8 14.6 reads 0x1043']
    ];
    for (const [raw, shift, want, why] of rows) {
        it('normalizeStatus(0x' + raw.toString(16) + ', ' + shift + ') === 0x' + want.toString(16) + ': ' + why, () => {
            assert.strictEqual(normalizeStatus(raw, shift), want);
        });
    }
});

// Live: a child with --allow-natives-syntax imports the harness and must find
// TurboFan available on THIS V8. Node 18 (V8 10.x) cannot run torture (the
// entry refuses it) and the harness need not load there, so the row skips.
const V8_MAJOR = Number(process.versions.v8.split('.')[0]);
const HARNESS_URL = new URL('./torture/harness.mjs', import.meta.url).href;
const CHILD = `
import * as h from ${JSON.stringify(HARNESS_URL)};
const why = h.optimizationUnavailable();
const layout = h.statusLayout();
const p = new Function('x', 'return (x + 7) | 0; // OptStatusLayout child probe');
%PrepareFunctionForOptimization(p);
p(1); p(2);
%OptimizeFunctionOnNextCall(p);
p(3);
const raw = %GetOptimizationStatus(p);
const norm = layout === null || layout.shift === null ? -1 : h.normalizeStatus(raw, layout.shift);
const probeOk = norm !== -1 && (norm & h.OPT_TURBOFAN) !== 0 && (norm & h.OPT_INTERPRETED) === 0;
process.stdout.write(JSON.stringify({ why, layout, raw, norm, probeOk }) + '\\n');
if (why !== null || !probeOk) process.exitCode = 1;
`;

describe('live layout detection (child, --allow-natives-syntax)', () => {
    it('optimizationUnavailable() === null and a forced probe normalizes to TurboFan',
        { skip: V8_MAJOR < 11 ? 'V8 ' + process.versions.v8 + ' < 11 (Node 18 leg): torture refuses this V8, harness not imported' : false },
        () => {
            const r = spawnSync(process.execPath, ['--allow-natives-syntax', '--input-type=module', '-e', CHILD], {
                encoding: 'utf8',
                timeout: 60000
            });
            assert.strictEqual(r.error, undefined, 'spawn failed: ' + (r.error && r.error.message));
            const line = r.stdout.trim().split('\n').pop();
            let out;
            try { out = JSON.parse(line); } catch (e) {
                assert.fail('child printed no JSON (status ' + r.status + '); stderr: ' + r.stderr.slice(0, 600));
            }
            const ctx = ' child: ' + line;
            assert.strictEqual(out.why, null, 'optimizationUnavailable() must be null on V8 ' + process.versions.v8 + ctx);
            assert.notStrictEqual(out.layout, null, 'natives unavailable' + ctx);
            assert.ok(out.layout.shift === 0 || out.layout.shift === 1, 'layout must be 0 or 1' + ctx);
            assert.strictEqual(out.probeOk, true, 'forced probe must normalize to TurboFan, not interpreted' + ctx);
            assert.strictEqual(r.status, 0, 'child exit' + ctx + ' stderr: ' + r.stderr.slice(0, 600));
        });
});

// ---- fail-closed + T2 child rows (CI-4 review r1) -------------------------
// Same skip rule as the live row. Each child prints ONE JSON line last.
const LIVE_SKIP = V8_MAJOR < 11 ? 'V8 ' + process.versions.v8 + ' < 11 (Node 18 leg): torture refuses this V8, harness not imported' : false;
const PINS = ['--expose-gc', '--min-semi-space-size=4', '--max-semi-space-size=4'];

function runChild(flags, code) {
    const r = spawnSync(process.execPath, [...flags, '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 60000 });
    assert.strictEqual(r.error, undefined, 'spawn failed: ' + (r.error && r.error.message));
    const line = r.stdout.trim().split('\n').pop();
    let out;
    try { out = JSON.parse(line); } catch (e) {
        assert.fail('child printed no JSON (status ' + r.status + '); stderr: ' + r.stderr.slice(0, 600));
    }
    return { r, out, ctx: ' child: ' + line };
}

// --no-opt: the forced probe fits neither layout -> unknown -> both consumers refuse.
const CHILD_NOOPT = `
import * as h from ${JSON.stringify(HARNESS_URL)};
const why = h.optimizationUnavailable();
const layout = h.statusLayout();
const m = await h.measureBop((i) => { h.SINK[0] = i; }, (i) => { h.SINK[1] = i; });
process.stdout.write(JSON.stringify({ why, layout, bop: { perOp: String(m.perOp), valid: m.valid, status: m.status } }) + '\\n');
`;

// T2 fail-closed: every GC entry is stripped to { detail: undefined } BEFORE the
// harness loads; the watcher must count them unknown and measureScavenges must
// return NaN (never 0 = fail-open, never a minor count).
const CHILD_NODETAIL = `
import { PerformanceObserverEntryList } from 'node:perf_hooks';
const orig = PerformanceObserverEntryList.prototype.getEntries;
PerformanceObserverEntryList.prototype.getEntries = function () { return orig.call(this).map(() => ({ detail: undefined })); };
const h = await import(${JSON.stringify(HARNESS_URL)});
h.startScavengeWatch();
const HOLD = [null, null, null, null];
const scav = await h.measureScavenges((i) => { HOLD[i & 3] = { i }; }, 400000, 1000);
h.stopScavengeWatch();
const unknown = typeof h.unknownGcCount === 'function' ? h.unknownGcCount() : -1;
process.stdout.write(JSON.stringify({ scav: String(scav), unknown, minor: h.minorCount() }) + '\\n');
`;

// T2 DEP0152: minor + major GC entries through the watcher; the deprecated
// top-level entry.kind accessor must never be read.
const CHILD_DEP = `
import * as h from ${JSON.stringify(HARNESS_URL)};
h.startScavengeWatch();
const pos = h.churnPositive(300000);
globalThis.gc();
await h.settle(30);
h.stopScavengeWatch();
process.stdout.write(JSON.stringify({ minor: h.minorCount(), keep: pos.acc === -7 }) + '\\n');
`;

describe('fail closed (child rows)', () => {
    it('--no-opt: layout unknown -> optimizationUnavailable and measureBop refuse', { skip: LIVE_SKIP }, () => {
        const { out, ctx } = runChild(['--allow-natives-syntax', '--no-opt'], CHILD_NOOPT);
        assert.ok(typeof out.why === 'string' && /layout is unknown/.test(out.why), 'optimizationUnavailable must name the unknown layout' + ctx);
        assert.notStrictEqual(out.layout, null, 'natives unavailable' + ctx);
        assert.strictEqual(out.layout.shift, null, 'statusLayout().shift must be null' + ctx);
        assert.ok(/layout is unknown/.test(out.bop.status), 'measureBop status must name the unknown layout' + ctx);
        assert.ok(Number.isNaN(Number(out.bop.perOp)), 'measureBop perOp must be NaN' + ctx);
    });
    it('T2: GC entries without detail count as unknown; measureScavenges returns NaN', { skip: LIVE_SKIP }, () => {
        const { out, ctx } = runChild(PINS, CHILD_NODETAIL);
        assert.strictEqual(out.scav, 'NaN', 'measureScavenges must be NaN, never 0 or a minor count' + ctx);
        assert.ok(out.unknown > 0, 'unknownGcCount() must be > 0' + ctx);
    });
    it('T2: no DEP0152 (entry.kind never read) through minor + major GC entries', { skip: LIVE_SKIP }, () => {
        const { r, out, ctx } = runChild(PINS, CHILD_DEP);
        assert.ok(out.minor > 0, 'watcher saw no scavenge: the DEP0152 check would be vacuous' + ctx);
        assert.ok(!/DEP0152/.test(r.stderr), 'stderr carries DEP0152: ' + r.stderr.slice(0, 400));
        assert.strictEqual(r.status, 0, 'child exit' + ctx);
    });
});
