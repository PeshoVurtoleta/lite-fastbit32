// test/AF2QA.test.mjs -- AF-2 qa seam rows (audit 1.7 U-1): the TYPE side of the 19 op families that
// test/AF2Pins.test.mjs pins at RUNTIME. test/types/af2.test-d.ts proves with tsc (strict) that a set
// object / undefined is rejected for 8 representative calls (hasAll / union / intersect / hasAny with
// `mask: number`; equals / copy / forEachArray with `FastBit32`; fromArray with `number[]`). The other
// 11 families (hasNone, difference, countMasked, isSubsetOf, nextSubset; forEachObject, forEachMapped,
// forEachMappedObject, forEachMaskPair / Diff / Union) had no type row: a d.ts edit widening one of
// their params to `any` passed every gate. These rows bind each family to the SAME parameter type
// text a tsc row proves, and pin the anchors (the tsc rows + strict + the include) so the inference
// cannot lose its proof. Text census of FastBit32.d.ts, no tsc, no child process: runs in `npm test`.
// Each checker is shown to go red on a count-checked mutant of a COPY of the text (E4 rows, bottom).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const DTS = read('FastBit32.d.ts');
const TESTD = read('test/types/af2.test-d.ts');
const TSCONFIG = read('test/types/tsconfig.json');

// The FastBit32 class body of the d.ts; fails closed when the block is not found exactly once.
function fb32Block(dts) {
    const head = '\nexport class FastBit32 {\n';
    const a = dts.indexOf(head);
    assert.ok(a >= 0 && dts.indexOf(head, a + 1) < 0, 'exactly one `export class FastBit32 {` block');
    const b = dts.indexOf('\n}\n', a);
    assert.ok(b > a, 'FastBit32 block closes');
    return dts.slice(a + head.length, b);
}
const code = (block) => block.split('\n').filter((l) => !/^\s*(\/\*\*|\*|\/\/)/.test(l));

// Every FastBit32 member with a parameter named `mask`, as 'name(mask: <type>)'. A non-comment line that
// mentions `mask:` but does not parse as a one-line signature fails closed.
function checkMaskOps(dts) {
    const lines = code(fb32Block(dts)).filter((l) => /\bmask\??\s*:/.test(l));
    const got = lines.map((l) => {
        const m = /^\s+(?:static\s+)?([A-Za-z]\w*)\(([^()]*)\)\s*:\s*[^;]+;\s*$/.exec(l);
        assert.ok(m, 'unparsed mask signature: ' + l.trim());
        const p = m[2].split(',').map((s) => s.trim()).find((s) => /^mask\??\s*:/.test(s));
        return m[1] + '(' + p + ')';
    }).sort();
    assert.deepStrictEqual(got, [
        'countMasked(mask: number)', 'difference(mask: number)', 'hasAll(mask: number)',
        'hasAny(mask: number)', 'hasNone(mask: number)', 'intersect(mask: number)',
        'isSubsetOf(mask: number)', 'nextSubset(mask: number)', 'union(mask: number)'
    ]);
    // An ADDED overload / property form of any of the 9 (e.g. `hasNone(m: any)`) widens the type: one member each.
    const all = code(fb32Block(dts));
    for (const n of ['hasAll', 'hasAny', 'hasNone', 'union', 'difference', 'intersect', 'countMasked', 'isSubsetOf', 'nextSubset']) {
        assert.strictEqual(all.filter((l) => new RegExp('^\\s+(?:static\\s+)?(?:readonly\\s+)?' + n + '\\s*[?(<:]').test(l)).length, 1, 'one ' + n + ' overload');
    }
    assert.ok(!/^\s*(?:export\s+)?(?:declare\s+)?(?:interface|namespace)\s+FastBit32\b/m.test(dts), 'no FastBit32 declaration merge');
    assert.ok(code(fb32Block(dts)).some((l) => /^\s+static nextSubset\(sub: number, mask: number\): number;$/.test(l)),
        'nextSubset(sub: number, mask: number)');
}

// equals / copy take a FastBit32; fromArray takes number[] (exact one-line signatures in the class block).
function checkSetParams(dts) {
    const c = code(fb32Block(dts));
    for (const re of [/^\s+equals\(other: FastBit32\): boolean;$/, /^\s+copy\(other: FastBit32\): this;$/,
        /^\s+fromArray\(bits: number\[\]\): this;$/]) {
        assert.strictEqual(c.filter((l) => re.test(l)).length, 1, 'signature ' + re);
    }
    for (const n of ['equals', 'copy', 'fromArray']) {
        assert.strictEqual(c.filter((l) => new RegExp('^\\s+' + n + '\\(').test(l)).length, 1, 'one ' + n + ' overload');
    }
}

// The seven free iterators: the set of exported forEach* functions, and every mask slot typed FastBit32.
const ITER = {
    forEachArray: ['mask'], forEachObject: ['mask'], forEachMapped: ['mask'], forEachMappedObject: ['mask'],
    forEachMaskPair: ['maskA', 'maskB'], forEachMaskDiff: ['maskA', 'maskB'], forEachMaskUnion: ['maskA', 'maskB']
};
function checkIterators(dts) {
    const names = [...dts.matchAll(/^export (?:declare\s+)?function (forEach\w*)/gm)].map((m) => m[1]).sort();
    assert.deepStrictEqual(names, Object.keys(ITER).sort(), 'exported free iterators');
    for (const [fn, slots] of Object.entries(ITER)) {
        const m = new RegExp('^export function ' + fn + '(?:<T>)?\\(\\n([\\s\\S]*?)\\n\\): void;$', 'm').exec(dts);
        assert.ok(m, fn + ' signature parses');
        const params = m[1].split('\n').map((l) => /^\s+(\w+)\??\s*:\s*(.+?),?$/.exec(l)).map((x) => x && [x[1], x[2]]);
        assert.ok(params.every(Boolean), fn + ' one param per line');
        assert.deepStrictEqual(params.slice(0, slots.length), slots.map((s) => [s, 'FastBit32']), fn + ' mask slots');
    }
}

// The anchors: af2.test-d.ts keeps a @ts-expect-error directly above each representative call, and the
// tsconfig compiles it under strict (undefined -> number is an error only under strictNullChecks).
const ANCHORS = [/^f32\.hasAll\(new FastBit32\(1\)\);$/, /^f32\.union\(f64\);$/, /^f32\.intersect\(u\);$/,
    /^f32\.hasAny\(u\);$/, /^f32\.equals\(u\);$/, /^f32\.equals\(f64\);$/, /^f32\.copy\(u\);$/,
    /^f32\.copy\(f64\);$/, /^forEachArray\(f64, /, /^f32\.fromArray\(new Set\(/];
function checkAnchors(testd, tsconfig) {
    const ls = testd.split('\n');
    for (const re of ANCHORS) {
        const i = ls.findIndex((l) => re.test(l));
        assert.ok(i > 0 && /^\/\/ @ts-expect-error\b/.test(ls[i - 1]), 'tsc row ' + re);
    }
    const cfg = JSON.parse(tsconfig);
    assert.strictEqual(cfg.compilerOptions.strict, true, 'strict');
    assert.ok(!('strictNullChecks' in cfg.compilerOptions), 'strictNullChecks not overridden');
    assert.ok(cfg.include.includes('af2.test-d.ts'), 'af2.test-d.ts compiled');
}

describe('AF-2 qa seam: every runtime-pinned U-1 op family has a type that rejects a set object / undefined', () => {
    it('FastBit32 mask params: exactly the 9 AF2Pins mask ops, each `mask: number`', () => checkMaskOps(DTS));
    it('FastBit32 equals / copy take `FastBit32`, fromArray takes `number[]` (one overload each)', () => checkSetParams(DTS));
    it('the 7 free iterators: every mask slot is `FastBit32` (same text as the tsc forEachArray row)', () => checkIterators(DTS));
    it('anchors: af2.test-d.ts tsc rows for each type text, compiled strict', () => checkAnchors(TESTD, TSCONFIG));
});

// ---- E4: each checker passes on an unmutated copy and fails on a count-checked mutant of a copy ----------
const mutate = (text, from, to) => {
    const n = text.split(from).length - 1;
    assert.strictEqual(n, 1, 'mutant anchor must match once: ' + JSON.stringify(from));
    return text.replace(from, to);
};
// Every dts anchor is a FULL line ('\n' + indent + signature + '\n'), so a JSDoc prose line quoting a
// signature (` *     hasNone(mask: number): boolean;`) can never double-count it (last E4 row).
const L = (s) => '\n' + s + '\n';
const ITERS_D = '\nexport function forEachMaskDiff(\n    maskA: FastBit32,\n    maskB: FastBit32,\n';
const MUTANTS = [
    ['hasNone mask -> any', 'dts', L('    hasNone(mask: number): boolean;'), L('    hasNone(mask: any): boolean;'), checkMaskOps],
    ['isSubsetOf mask -> number | object', 'dts', L('    isSubsetOf(mask: number): boolean;'), L('    isSubsetOf(mask: number | object): boolean;'), checkMaskOps],
    ['nextSubset mask -> unknown', 'dts', L('    static nextSubset(sub: number, mask: number): number;'), L('    static nextSubset(sub: number, mask: unknown): number;'), checkMaskOps],
    ['countMasked dropped', 'dts', L('    countMasked(mask: number): number;'), '\n', checkMaskOps],
    ['difference param renamed m: any', 'dts', L('    difference(mask: number): this;'), L('    difference(m: any): this;'), checkMaskOps],
    ['hasNone gains an any overload', 'dts', L('    hasNone(mask: number): boolean;'), L('    hasNone(mask: number): boolean;\n    hasNone(m: any): boolean;'), checkMaskOps],
    ['interface FastBit32 merge widens hasNone', 'dts', L('export class FastBit32 {'), L('export interface FastBit32 { hasNone(m: any): boolean; }\nexport class FastBit32 {'), checkMaskOps],
    ['equals other -> object', 'dts', L('    equals(other: FastBit32): boolean;'), L('    equals(other: object): boolean;'), checkSetParams],
    ['copy gains an any overload', 'dts', L('    copy(other: FastBit32): this;'), L('    copy(other: FastBit32): this;\n    copy(other: any): this;'), checkSetParams],
    ['fromArray bits -> Iterable', 'dts', L('    fromArray(bits: number[]): this;'), L('    fromArray(bits: Iterable<number>): this;'), checkSetParams],
    ['forEachMaskDiff maskB -> any', 'dts', ITERS_D, ITERS_D.replace(/maskB: FastBit32,\n$/, 'maskB: any,\n'), checkIterators],
    ['forEachMapped mask -> unknown', 'dts', L('export function forEachMapped(\n    mask: FastBit32,'), L('export function forEachMapped(\n    mask: unknown,'), checkIterators],
    ['forEachObject mask optional any', 'dts', L('export function forEachObject<T>(\n    mask: FastBit32,'), L('export function forEachObject<T>(\n    mask?: any,'), checkIterators],
    ['export declare forEachMaskDiff(any, any) prepended', 'dts', L('export function forEachMaskDiff('),
        L('export declare function forEachMaskDiff(maskA: any, maskB: any, callback: (bit: number) => void): void;\nexport function forEachMaskDiff('), checkIterators],
    ['forEachArray tsc row directive dropped', 'testd', '// @ts-expect-error -- a FastBit64 is not a FastBit32 mask source.\n', '', checkAnchors],
    ['hasAny undefined tsc row directive dropped', 'testd', '// @ts-expect-error -- undefined is not a mask.\nf32.hasAny(u);', 'f32.hasAny(u);', checkAnchors],
    ['tsconfig strict off', 'tsconfig', '"strict": true', '"strict": false', checkAnchors],
    ['tsconfig drops af2.test-d.ts', 'tsconfig', ', "af2.test-d.ts"', '', checkAnchors]
];
const run = (fn, t) => (fn === checkAnchors ? fn(t.testd, t.tsconfig) : fn(t.dts));
const CHECKERS = [checkMaskOps, checkSetParams, checkIterators, checkAnchors];
const copies = () => ({ dts: DTS.slice(), testd: TESTD.slice(), tsconfig: TSCONFIG.slice() });

describe('AF-2 qa E4: each seam checker goes red on its mutant, green on the unmutated copy', () => {
    it('unmutated copies pass all four checkers', () => {
        const t = copies();
        for (const fn of CHECKERS) run(fn, t);
    });
    for (const [name, key, from, to, fn] of MUTANTS) {
        it('mutant ' + name + ' -> ' + fn.name + ' red', () => {
            const t = copies();
            t[key] = mutate(t[key], from, to);
            assert.throws(() => run(fn, t), (e) => e instanceof assert.AssertionError);
        });
    }
    it('control: JSDoc prose quoting every anchored signature stays green, and every mutant still applies once and reds', () => {
        const quoted = MUTANTS.filter((m) => m[1] === 'dts')
            .flatMap((m) => m[2].split('\n').filter(Boolean)).map((s) => '     * ' + s);
        const prose = '    /**\n     * AF-3 style prose quoting the signatures:\n' + quoted.join('\n') + '\n     */\n';
        const base = copies();
        base.dts = mutate(base.dts, L('export class FastBit32 {'), L('export class FastBit32 {') + prose);
        for (const fn of CHECKERS) run(fn, base);
        for (const [name, key, from, to, fn] of MUTANTS) {
            const t = { ...base };
            t[key] = mutate(t[key], from, to);
            assert.throws(() => run(fn, t), (e) => e instanceof assert.AssertionError, 'with prose: ' + name);
        }
    });
});
