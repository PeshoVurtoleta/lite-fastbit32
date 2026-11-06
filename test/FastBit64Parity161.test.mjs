// test/FastBit64Parity161.test.mjs -- FastBit64 rung 1 parity suite (PLAN-fastbit64-A A-S1 / A1, R-7).
// The tree is compared with the published 1.6.1 body, `git show <BASE>:FastBit32.js`,
// pinned by the full commit sha of the v1.6.1 release (so the check survives the
// 1.7.0 release commit). Fails closed if git cannot produce the base: a missing
// BASE FAILS, it never skips. Under GIT_DIR=<real .git> this also runs in a
// scratch copy of the tree (the must-fail control run).
//   (a) the bytes before the `// -- FastBit64 --` marker equal the BASE file in full
//       (VERSION line normalized); the marker is present exactly once, at a line start;
//   (b) Function#toString is equal for every BASE export and every member of
//       FastBit32 / BitMapper / FastBit1024 (prototype and statics);
//   (c) EXACT member lists for those three classes: own keys of the prototype and of
//       the class, each with the same kind, arity and enumerability, and the same
//       constructor arity;
//   (d) exports = BASE exports + 'FastBit64', exactly, each base export the same type;
//   (e) the section's top level holds declarations only (function / class / const
//       with a pure initializer): no expression statement such as
//       `FastBit32.prototype.x = 1;`, no class heritage or static initializer code.
// Node 18 APIs only.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as NEW from '../FastBit32.js';

const ROOT = new URL('../', import.meta.url);
const BASE = 'fddf34e173eba7219e0013d58a143919a7477b2e'; // v1.6.1
const MARK = '// -- FastBit64 --';
let baseSrc = null, OLD = null, baseErr = null;
try {
    baseSrc = execFileSync('git', ['show', BASE + ':FastBit32.js'], { cwd: fileURLToPath(ROOT), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (!baseSrc.includes("export const VERSION = '1.6.1';")) throw new Error('base is not the 1.6.1 body');
    if (!baseSrc.includes('return 31 - Math.clz32(this.value | 0);')) throw new Error('base lacks the 1.6.1 highest() body');
    OLD = await import('data:text/javascript;base64,' + Buffer.from(baseSrc).toString('base64'));
} catch (e) { baseErr = e; }
const headSrc = readFileSync(new URL('../FastBit32.js', import.meta.url), 'utf8');

const norm = (s) => s.replace(/export const VERSION = '[^']*';/, 'export const VERSION = X;');
const CLASSES = ['FastBit32', 'BitMapper', 'FastBit1024'];

function kind(d) {
    if (!d) return 'absent';
    if ('value' in d) return typeof d.value === 'function' ? 'method' : 'data:' + typeof d.value;
    return 'accessor:' + (d.get ? 'get' : '') + (d.set ? 'set' : '');
}
// own members of a class: prototype + statics, every key (constructor, length, name, prototype included)
function members(M, cname) {
    const C = M[cname], out = new Map();
    for (const [holder, tag] of [[C.prototype, 'p'], [C, 's']]) {
        for (const n of Reflect.ownKeys(holder)) out.set(tag + ':' + String(n), Object.getOwnPropertyDescriptor(holder, n));
    }
    return out;
}
function fnTexts(d) {
    if (!d) return [];
    if ('value' in d) return [typeof d.value === 'function' ? d.value.toString() : typeof d.value];
    return [d.get && d.get.toString(), d.set && d.set.toString()];
}
function arities(d) {
    if (!d) return [];
    return 'value' in d ? [typeof d.value === 'function' ? d.value.length : -1] : [d.get && d.get.length, d.set && d.set.length];
}

// ---- (e) a small top-level scanner for the section ---------------------------
// Returns the list of violations (empty = declarations only). Fails closed: a
// template literal, a possible regex literal or unbalanced brackets is itself
// a violation (extend the scanner rather than loosen it).
const PURE_INIT = /^[\w$\s|&^~<>+\-*]*$/; // identifiers, numbers and operators only: no '=', '.', ',', call or bracket
function scanTopLevel(text) {
    const bad = [];
    const stack = [];
    let i = 0, stmt = null, prev = '';
    // stmt: { start, kind: 'fn' | 'class' | 'const', head, bodyDepth, classBody }
    const isIdent = (c) => /[\w$]/.test(c);
    while (i < text.length) {
        const c = text[i], d = stack.length;
        if (c === '/' && text[i + 1] === '/') { const j = text.indexOf('\n', i); i = j < 0 ? text.length : j + 1; continue; }
        if (c === '/' && text[i + 1] === '*') { const j = text.indexOf('*/', i + 2); if (j < 0) { bad.push('unterminated comment'); break; } i = j + 2; continue; }
        if (/\s/.test(c)) { i++; continue; }
        if (c === '`') { bad.push('template literal at ' + i + ' (scanner does not support it)'); break; }
        if (c === '/' && !(isIdent(prev) || prev === ')' || prev === ']')) { bad.push('possible regex literal at ' + i); break; }
        if (c === '\'' || c === '"') {
            let j = i + 1;
            while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; if (text[j] === '\n') break; j++; }
            if (text[j] !== c) { bad.push('unterminated string at ' + i); break; }
            i = j + 1; prev = c; continue;
        }
        if (d === 0 && stmt === null) {
            const rest = text.slice(i);
            let m;
            if ((m = /^(export\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.exec(rest))) stmt = { kind: 'fn' };
            else if ((m = /^(export\s+)?class\s+[A-Za-z_$][\w$]*\s*\{/.exec(rest))) stmt = { kind: 'class' };
            else if ((m = /^const\s+[A-Za-z_$][\w$]*\s*=/.exec(rest))) { stmt = { kind: 'const', initFrom: i + m[0].length }; i += m[0].length; prev = '='; continue; }
            else if (c === ';') { i++; prev = c; continue; }
            else { bad.push('not a declaration: ' + JSON.stringify(rest.split('\n')[0].slice(0, 60))); stmt = { kind: 'junk' }; }
        }
        // class body: forbid computed keys and static initializer code at the body level
        if (stmt && stmt.kind === 'class' && d === 1) {
            if (c === '[') bad.push('computed class key at ' + i);
            if (text.startsWith('static', i) && !isIdent(prev) && !isIdent(text[i + 6] || '')) {
                const after = text.slice(i + 6).match(/^\s*(\{|#?[A-Za-z_$][\w$]*\s*(=|;))/);
                if (after) bad.push('static initializer code at ' + i + ': ' + JSON.stringify(text.slice(i, i + 40)));
            }
        }
        if (c === '(' || c === '[' || c === '{') { stack.push(c); i++; prev = c; continue; }
        if (c === ')' || c === ']' || c === '}') {
            const open = stack.pop();
            if (open !== { ')': '(', ']': '[', '}': '{' }[c]) { bad.push('unbalanced ' + c + ' at ' + i); break; }
            i++; prev = c;
            if (stack.length === 0 && stmt && c === '}' && (stmt.kind === 'fn' || stmt.kind === 'class')) stmt = null;
            continue;
        }
        if (c === ';' && d === 0 && stmt) {
            if (stmt.kind === 'const' && !PURE_INIT.test(text.slice(stmt.initFrom, i))) bad.push('const initializer is not pure: ' + JSON.stringify(text.slice(stmt.initFrom, i).trim().slice(0, 60)));
            if (stmt.kind === 'fn' || stmt.kind === 'class') bad.push('stray ; inside a declaration at ' + i);
            stmt = null; i++; prev = c; continue;
        }
        i++; prev = c;
    }
    if (stack.length !== 0) bad.push('unbalanced brackets at end: ' + stack.join(''));
    if (stmt && stmt.kind === 'const') bad.push('unterminated const');
    return bad;
}

describe('FastBit64 rung 1: 1.6.1 -> tree parity (base ' + BASE.slice(0, 7) + ')', () => {
    it('the base is available (a missing base FAILS)', () => { assert.strictEqual(baseErr, null, String(baseErr)); });

    it('(a) bytes before the FastBit64 marker equal the base file (VERSION line normalized); marker once, at a line start', () => {
        const hi = headSrc.indexOf(MARK);
        assert.ok(hi > 0, 'marker missing');
        assert.strictEqual(headSrc.indexOf(MARK, hi + 1), -1, 'marker twice');
        assert.strictEqual(headSrc[hi - 1], '\n', 'marker not at a line start');
        assert.strictEqual(baseSrc.indexOf(MARK), -1, 'base already has the marker');
        assert.strictEqual(norm(headSrc.slice(0, hi)), norm(baseSrc));
    });

    it('(b) Function#toString equal for every base export and every FastBit32 / BitMapper / FastBit1024 member', () => {
        let checked = 0;
        for (const [name, v] of Object.entries(OLD)) {
            if (typeof v !== 'function') continue;
            assert.strictEqual(typeof NEW[name], 'function', name);
            assert.strictEqual(NEW[name].toString(), v.toString(), name);
            checked++;
        }
        for (const cname of CLASSES) {
            const nm = members(NEW, cname);
            for (const [key, d] of members(OLD, cname)) {
                assert.deepStrictEqual(fnTexts(nm.get(key)), fnTexts(d), cname + ' ' + key);
                checked++;
            }
        }
        assert.ok(checked > 80, 'checked ' + checked); // 99 at the 1.6.1 base
    });

    it('(c) exact member lists for FastBit32 / BitMapper / FastBit1024: same keys, kind, arity, enumerability', () => {
        let n = 0;
        for (const cname of CLASSES) {
            const nm = members(NEW, cname), om = members(OLD, cname);
            assert.deepStrictEqual([...nm.keys()].sort(), [...om.keys()].sort(), cname + ' member list');
            for (const [key, d] of om) {
                const nd = nm.get(key);
                assert.strictEqual(kind(nd), kind(d), cname + ' ' + key);
                assert.deepStrictEqual(arities(nd), arities(d), cname + ' ' + key);
                assert.strictEqual(nd.enumerable, d.enumerable, cname + ' ' + key);
                assert.strictEqual(nd.writable, d.writable, cname + ' ' + key);
                assert.strictEqual(nd.configurable, d.configurable, cname + ' ' + key);
                n++;
            }
            assert.strictEqual(NEW[cname].length, OLD[cname].length, cname + ' ctor arity');
            assert.strictEqual(Object.getPrototypeOf(NEW[cname].prototype), Object.prototype, cname + ' prototype chain');
        }
        assert.ok(n > 80, 'compared ' + n); // 89 at the 1.6.1 base
    });

    it("(d) exports = base exports + 'FastBit64', exactly; each base export the same type", () => {
        assert.deepStrictEqual(Object.keys(NEW).sort(), [...Object.keys(OLD), 'FastBit64'].sort());
        for (const [name, v] of Object.entries(OLD)) assert.strictEqual(typeof NEW[name], typeof v, name);
        assert.strictEqual(typeof NEW.FastBit64, 'function');
        assert.ok(NEW.FastBit64.toString().startsWith('class FastBit64 {'));
    });

    it('(e0) the scanner has teeth: each known-bad snippet is flagged, a clean one passes', () => {
        const BAD = [
            'FastBit32.prototype.x = 1;',
            'function f() {}\nFastBit32.prototype.x = 1;\n',
            'const y = f();',
            'const z = FastBit32.prototype;',
            'let q = 1;',
            'class Z extends Object {}',
            'class W { static { globalThis.x = 1; } }',
            'class V { static p = 1; }',
            'class U { [Symbol.iterator]() {} }',
            'f();',
            'if (x) {}',
            '(() => {})();',
        ];
        for (const s of BAD) assert.ok(scanTopLevel(s).length > 0, 'not flagged: ' + s);
        const GOOD = "// c\nfunction f(a = 1) { return a > 0 ? 'x;' : \"}\"; }\nconst K = FB1024_IMG_TAG | 64;\nexport class C {\n    #a; #b;\n    static get n() { return 3; }\n    m() { const o = { a: 1 }; return o; }\n}\n";
        assert.deepStrictEqual(scanTopLevel(GOOD), []);
    });

    it('(e) the FastBit64 section top level is declarations only (no expression statements)', () => {
        const hi = headSrc.indexOf(MARK);
        assert.ok(hi > 0, 'marker missing');
        const section = headSrc.slice(hi);
        assert.deepStrictEqual(scanTopLevel(section), []);
        // the section declares the class it exports, and nothing else is exported from it
        assert.deepStrictEqual(section.match(/^export\s+\S+\s+\S+/gm), ['export class FastBit64']);
    });
});
