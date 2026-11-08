// B.B2 r2 review nit 1: mathOutsideFunctions(src) must list EVERY top-level
// Math-reaching declaration outside the fb64 kernel markers (function, and
// const / let / var arrow or function-expression helpers), never a class name.
// Synthetic sources only. OUTSIDE_FNS_HARNESS=<abs path> points the test at a
// scratch harness copy for the revert check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const H = process.env.OUTSIDE_FNS_HARNESS
    ? await import(pathToFileURL(process.env.OUTSIDE_FNS_HARNESS).href)
    : await import('./torture/harness.mjs');
const { mathOutsideFunctions, mathKernels, mathFieldCensus, KERNEL_BEGIN, KERNEL_END } = H;

const SRC = [
    'const K = 5;',
    'let plain = (x) => x + 1;',
    'const h1 = (x) => Math.clz32(x) | 0;',
    'let h2 = function (x) { return kpop(x); };',
    'const h5 = x => h1(x);',
    'const h3 = (x) => h1(x) + 1;',
    'var h4 = (x) => Math.abs(x);',
    'export const h6 = (x) => kclz(x);',
    'class Box {',
    '    get n() { return Math.abs(this.v); }',
    '    m(x) { return Math.max(x, 1); }',
    '}',
    'function oldForm(x) { return Math.floor(x); }',
    'function noMath(x) { return x; }',
    KERNEL_BEGIN,
    'function kclz(x) { return Math.clz32(x); }',
    'function kpop(x) { return 31 - kclz(x); }',
    KERNEL_END,
    'export { h1 };',
    '',
].join('\n');

const OUT = mathOutsideFunctions(SRC);

test('fixture: kernels between the markers are kclz, kpop', () => {
    assert.deepEqual(mathKernels(SRC), ['kclz', 'kpop']);
});

test('row 1: const arrow helper calling Math.clz32 outside the markers is listed', () => {
    assert.ok(OUT.includes('h1'), 'outside=' + JSON.stringify(OUT));
});

test('row 2: let function-expression helper calling a marker kernel is listed', () => {
    assert.ok(OUT.includes('h2'), 'outside=' + JSON.stringify(OUT));
});

test('row 3: const helper calling row 1 is listed (fixpoint)', () => {
    assert.ok(OUT.includes('h3'), 'outside=' + JSON.stringify(OUT));
});

test('row 4: a class whose methods use Math.* is not listed', () => {
    assert.ok(!OUT.includes('Box'), 'outside=' + JSON.stringify(OUT));
});

test('row 5: plain non-Math const / let are not listed', () => {
    assert.ok(!OUT.includes('K'), 'outside=' + JSON.stringify(OUT));
    assert.ok(!OUT.includes('plain'), 'outside=' + JSON.stringify(OUT));
    assert.ok(!OUT.includes('noMath'), 'outside=' + JSON.stringify(OUT));
});

test('row 6: the old top-level function form is still listed', () => {
    assert.ok(OUT.includes('oldForm'), 'outside=' + JSON.stringify(OUT));
});

test('row 7: whole list, source order, no marker kernel in it', () => {
    assert.deepEqual(OUT, ['h1', 'h2', 'h5', 'h3', 'h4', 'h6', 'oldForm']);
});

test('row 9: a paren-less param const arrow calling row 1 is listed (fixpoint, B1)', () => {
    assert.ok(OUT.includes('h5'), 'outside=' + JSON.stringify(OUT));
});

test('row 10: var and export const helpers are listed (B3)', () => {
    assert.ok(OUT.includes('h4'), 'outside=' + JSON.stringify(OUT));
    assert.ok(OUT.includes('h6'), 'outside=' + JSON.stringify(OUT));
});

test('row 11: a const between the kernel markers fails mathKernels closed (B2)', () => {
    const bad = [
        KERNEL_BEGIN,
        'function kclz(x) { return Math.clz32(x); }',
        'const kabs = (x) => Math.abs(x);',
        KERNEL_END,
        '',
    ].join('\n');
    assert.throws(() => mathKernels(bad), /only top-level `function name\(` declarations may sit between the kernel markers/);
    assert.throws(() => mathOutsideFunctions(bad), /only top-level `function name\(`/);
});

test('row 8: census fails closed on a field-reading method calling a const helper', () => {
    class Fake {
        #lo = 0;
        bad() { return h1(this.#lo); }
    }
    const h1 = (x) => x;
    assert.throws(
        () => mathFieldCensus(Fake, { field: /\.#lo\b/, kernels: mathKernels(SRC), outside: mathOutsideFunctions(SRC) }),
        /bad reads the field and calls h1\(\)/,
    );
});
