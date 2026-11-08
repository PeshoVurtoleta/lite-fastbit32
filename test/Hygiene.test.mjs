// test/Hygiene.test.mjs -- packaging + ASCII hygiene (FB-10).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VERSION } from '../FastBit32.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

function nonAscii(s) {
    let n = 0;
    for (const ch of s) if (ch.codePointAt(0) > 0x7f) n++;
    return n;
}

describe('Hygiene (FB-10)', () => {
    it('ships zero non-ASCII bytes in the shipped text files', () => {
        for (const f of ['FastBit32.js', 'FastBit32.d.ts', 'llms.txt', 'CHANGELOG.md']) {
            assert.strictEqual(nonAscii(read(f)), 0, `${f} has non-ASCII bytes`);
        }
    });

    it('syncs VERSION across the export, package.json and the llms.txt stamp', () => {
        const pkg = JSON.parse(read('package.json'));
        const stamp = read('llms.txt').split('\n')[0].match(/v(\d+\.\d+\.\d+)/)[1];
        assert.strictEqual(VERSION, pkg.version);
        assert.strictEqual(VERSION, stamp);
    });

    it('declares an exact files[] manifest', () => {
        const pkg = JSON.parse(read('package.json'));
        assert.deepStrictEqual(pkg.files, [
            'FastBit32.js',
            'FastBit32.d.ts',
            'llms.txt',
            'README.md',
            'CHANGELOG.md',
            'LICENSE'
        ]);
    });

    it('no longer references vitest in package.json', () => {
        assert.ok(!read('package.json').includes('vitest'));
    });
});

// ---- A12 source pin: no bare class fields (PLAN-fb64pc-A T1-T2) ----------------
// With 31-bit Smis a bare `#x;` field is Tagged and boxes each out-of-Smi store; a
// Smi-first field (`#x = 0`) is Double and stored in place. bareFields() lists every
// class field declared with no initializer. A char scanner (no AST is available);
// it throws on anything it cannot classify (template with a backtick inside ${},
// regex-position '/' (a '/' after a keyword such as return counts as regex; a '/'
// after ')' is read as division, a char scanner cannot tell that case), ASI-ambiguous
// initializer, unknown member shape).
// BEGIN bareFields
function bareFields(text) {
    const out = [], st = [], n = text.length;
    let i = 0, prev = ';', sawNl = false;
    const RX_KW = ['return', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'new', 'throw', 'case', 'do', 'else', 'yield', 'await'];
    const fail = (m, at) => { throw new Error('bareFields: ' + m + ' at ' + at); };
    const isId = (c) => c !== undefined && /[\w$]/.test(c);
    const isIdStart = (c) => c !== undefined && /[A-Za-z_$]/.test(c);
    // whitespace and comments; sets sawNl when a line terminator was crossed
    const trivia = (p) => {
        sawNl = false;
        for (;;) {
            const c = text[p];
            if (c === '\n' || c === '\r') { sawNl = true; p++; }
            else if (c === ' ' || c === '\t' || c === '\f' || c === '\v') p++;
            else if (c === '/' && text[p + 1] === '/') { const j = text.indexOf('\n', p); p = j < 0 ? n : j; }
            else if (c === '/' && text[p + 1] === '*') {
                const j = text.indexOf('*/', p + 2);
                if (j < 0) fail('unterminated comment', p);
                if (text.slice(p, j).includes('\n')) sawNl = true;
                p = j + 2;
            } else return p;
        }
    };
    const str = (p) => {
        const q = text[p];
        let j = p + 1;
        while (j < n && text[j] !== q) {
            if (text[j] === '\\') j++;
            else if (text[j] === '\n') fail('newline in string', p);
            j++;
        }
        if (j >= n) fail('unterminated string', p);
        return j + 1;
    };
    // a template: ${ ... } is scanned for strings, comments and braces; a backtick inside throws
    const tpl = (p) => {
        let j = p + 1;
        while (j < n) {
            const c = text[j];
            if (c === '\\') { j += 2; continue; }
            if (c === '`') return j + 1;
            if (c === '$' && text[j + 1] === '{') {
                let d = 1;
                j += 2;
                while (d > 0) {
                    if (j >= n) fail('unterminated template', p);
                    const e = text[j];
                    if (e === '`') fail('backtick inside ${}', j);
                    if (e === '\'' || e === '"') { j = str(j); continue; }
                    if (e === '/' && (text[j + 1] === '/' || text[j + 1] === '*')) { j = trivia(j); continue; }
                    if (e === '{') d++;
                    else if (e === '}') d--;
                    j++;
                }
                continue;
            }
            j++;
        }
        return fail('unterminated template', p);
    };
    const word = (p) => { let j = p; while (isId(text[j])) j++; return j; };
    // mode 'group': p is at ( or [ ; returns the index after the match.
    // mode 'init': p is just after '='; returns the index of the ';' at depth 0.
    const skipExpr = (p, mode) => {
        let d = 0, pv = mode === 'init' ? '=' : '(';
        for (;;) {
            if (p >= n) fail('unterminated expression', p);
            const c = text[p];
            if (c === '/' && (text[p + 1] === '/' || text[p + 1] === '*')) {
                const q = trivia(p);
                if (mode === 'init' && d === 0 && sawNl) fail('newline before ; (ASI)', p);
                p = q; continue;
            }
            if (c === '\n' || c === '\r') {
                if (mode === 'init' && d === 0) fail('newline before ; (ASI)', p);
                p++; continue;
            }
            if (c === ' ' || c === '\t' || c === '\f' || c === '\v') { p++; continue; }
            if (c === '\'' || c === '"') { p = str(p); pv = 'a'; continue; }
            if (c === '`') { p = tpl(p); pv = 'a'; continue; }
            if (c === '/') {
                if (!(isId(pv) || pv === ')' || pv === ']')) fail('regex position', p);
                p++; pv = '/'; continue;
            }
            if (isId(c)) {
                const e = word(p);
                if (text.slice(p, e) === 'class' && text[p - 1] !== '.' && text[p - 1] !== '#') fail('class inside an expression', p);
                pv = RX_KW.includes(text.slice(p, e)) ? '=' : 'a'; p = e; continue;
            }
            if (c === '(' || c === '[' || c === '{') { d++; p++; pv = c; continue; }
            if (c === ')' || c === ']' || c === '}') {
                if (d === 0) fail('unbalanced ' + c + ' in an initializer', p);
                d--; p++; pv = c;
                if (d === 0 && mode === 'group') return p;
                continue;
            }
            if (c === ';' && d === 0 && mode === 'init') return p;
            p++; pv = c;
        }
    };
    const MODS = ['static', 'async', 'get', 'set'];
    const keyStart = (c) => c !== undefined && (isId(c) || c === '#' || c === '\'' || c === '"' || c === '[' || c === '*');
    while (i < n) {
        const top = st.length ? st[st.length - 1] : null;
        if (top !== null && top.cls) {
            // ---- one class member at a time ----
            i = trivia(i);
            if (i >= n) break;
            if (text[i] === ';') { i++; continue; }
            if (text[i] === '}') { st.pop(); i++; prev = '}'; continue; }
            let isStatic = false, key = null, opened = false;
            for (;;) {
                const c = text[i];
                if (c === '*') {
                    i = trivia(i + 1);
                    if (!keyStart(text[i])) fail('generator star with no key', i);
                    continue;
                }
                if (c === '#' || isIdStart(c)) {
                    const e = word(c === '#' ? i + 1 : i);
                    const w = text.slice(i, e);
                    if (MODS.includes(w)) {
                        const j = trivia(e);
                        if (w === 'static' && text[j] === '{') { st.push({ cls: false }); i = j + 1; prev = '{'; opened = true; break; }
                        if (keyStart(text[j])) { if (w === 'static') isStatic = true; i = j; continue; }
                    }
                    key = w; i = e; break;
                }
                if (c === '\'' || c === '"') { const e = str(i); key = text.slice(i, e); i = e; break; }
                if (c !== undefined && /[0-9]/.test(c)) { const e = word(i); key = text.slice(i, e); i = e; break; }
                if (c === '[') { i = skipExpr(i, 'group'); key = '[computed]'; break; }
                fail('unknown member shape', i);
            }
            if (opened) continue;
            const j = trivia(i), nl = sawNl, c = text[j];
            if (c === '(') {
                let k = skipExpr(j, 'group');
                k = trivia(k);
                if (text[k] !== '{') fail('method with no body', k);
                st.push({ cls: false }); // MUT-BODY
                i = k + 1; prev = '{';
            } else if (c === '=') {
                i = skipExpr(j + 1, 'init') + 1;
            } else if (c === ';' || c === '}' || (nl && j < n)) { // MUT-ASI
                out.push(top.name + '.' + (isStatic ? 'static ' : '') + key);
                i = c === ';' ? j + 1 : j;
            } else fail('unexpected token after a member key', j);
            continue;
        }
        // ---- top level and plain frames ----
        i = trivia(i);
        if (i >= n) break;
        const c = text[i];
        if (c === '\'' || c === '"') { i = str(i); prev = 'a'; continue; }
        if (c === '`') { i = tpl(i); prev = 'a'; continue; }
        if (c === '/') {
            if (!(isId(prev) || prev === ')' || prev === ']')) fail('regex position', i);
            i++; prev = '/'; continue;
        }
        if (isId(c)) {
            const e = word(i), w = text.slice(i, e);
            if (w === 'class' && text[i - 1] !== '.' && text[i - 1] !== '#') {
                let name = null, j = e;
                for (;;) {
                    j = trivia(j);
                    if (j >= n) fail('class with no body', i);
                    if (text[j] === '{') break;
                    if (text[j] === '(' || text[j] === '[') { j = skipExpr(j, 'group'); continue; }
                    if (isId(text[j])) { const k = word(j), v = text.slice(j, k); if (v === 'class' && text[j - 1] !== '.' && text[j - 1] !== '#') fail('class in a class heritage', j); if (name === null && v !== 'extends') name = v; j = k; continue; }
                    j++;
                }
                st.push({ cls: true, name: name === null ? '(anon)' : name });
                i = j + 1; prev = '{'; continue;
            }
            i = e; prev = RX_KW.includes(w) ? '=' : 'a'; continue;
        }
        if (c === '(' || c === '[' || c === '{') { st.push({ cls: false }); i++; prev = c; continue; }
        if (c === ')' || c === ']' || c === '}') {
            if (!st.length) fail('unbalanced ' + c, i);
            st.pop(); i++; prev = c; continue;
        }
        i++; prev = c;
    }
    if (st.length) fail('unbalanced brackets at end', n);
    return out;
}
// END bareFields

describe('A12: no bare class fields (a bare field is Tagged and boxes on pointer-compressed V8)', () => {
    it('live FastBit32.js has exactly one bare field: the FastBit1024 brand', () => {
        assert.deepStrictEqual(bareFields(read('FastBit32.js')), ['FastBit1024.#brand']);
    });

    // Corpus, expected values per PLAN-fb64pc-A T2 (hand-derived from the JS grammar).
    const wrap = (body) => 'class C { ' + body + ' }';
    const CORPUS = [
        ['#lo; #hi;', wrap('#lo; #hi;'), ['C.#lo', 'C.#hi']],
        ['#lo = 0; #hi; (initialized then bare, one line)', wrap('#lo = 0; #hi;'), ['C.#hi']],
        ['#a <newline> #b = 0; (ASI: #a is bare)', wrap('#a\n#b = 0;'), ['C.#a']],
        ['static #s; static t; static u = 0;', wrap('static #s; static t; static u = 0;'), ['C.static #s', 'C.static t']],
        ['method and getter bodies hold no fields', wrap('m() { x; } get g() { return 1; }'), []],
        ['comments and a string holding ;#s; hide nothing', wrap('// #q;\n/* #r; */ #a = \';#s;\';'), []],
        ['commas inside initializer brackets', wrap('#a = (0, 1); #b = [1, 2];'), []],
        ['nested class in a method body is still found', wrap('m() { class Y { #q; } }'), ['Y.#q']],
        ['fields named get and static', wrap('get; static;'), ['C.get', 'C.static']]
    ];
    for (const [name, src, want] of CORPUS) {
        it('corpus: ' + name, () => { assert.deepStrictEqual(bareFields(src), want); });
    }
    it('corpus: #a = 1 <newline> #b; throws (initializer ends by ASI, unsupported)', () => {
        assert.throws(() => bareFields(wrap('#a = 1\n#b;')), /bareFields/);
    });
    it('throws on a backtick inside ${} and on a regex-position slash', () => {
        assert.throws(() => bareFields('const s = `a${`b`}`;'), /bareFields/);
        assert.throws(() => bareFields('const r = /x/;'), /bareFields/);
    });
    it('throws on a regex after a keyword (return /x/); an identifier named returned still divides', () => {
        assert.throws(() => bareFields('function f(s) { return /x/.test(s); }'), /bareFields/);
        assert.deepStrictEqual(bareFields('function g(returned) { return returned / 2; }'), []);
    });
    it('throws on a class expression in a class heritage', () => {
        assert.throws(() => bareFields('class A extends class {} { #y; }'), /bareFields/);
    });
});
