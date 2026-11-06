// BundleShake -- DETERMINISTIC tree-shaking gate (bundle CONTENT, never size).
// A bundle that imports only a non-FastBit1024 export must drop the FastBit1024
// module-init captures of the %TypedArray%.prototype `length` / @@toStringTag
// getters (C-4 as amended by A13: captured at init inside /* @__PURE__ */ IIFEs).
// Control: the FastBit1024-only bundle still carries both captures, so the
// negative rows cannot pass by esbuild failing or emitting nothing.
// FastBit64 (R-8) reuses the FastBit1024 captures and Int32Array, so it carries
// them by design: it is excluded from row (c) and gets its own rows -- its bundle
// keeps the captures but drops the FastBit1024 class (FB1024_CLASS_MARKERS), and a
// FastBit32-only bundle drops FastBit64.
//
// FB_SHAKE_SRC=<abs path> points the gate at another build (e.g. the frozen
// before); a missing path fails loudly.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';

const DEFAULT_SRC = fileURLToPath(new URL('../FastBit32.js', import.meta.url));
const ENV_SRC = process.env.FB_SHAKE_SRC;
if (ENV_SRC !== undefined && !isAbsolute(ENV_SRC)) {
  throw new Error('FB_SHAKE_SRC must be an absolute path, got: ' + ENV_SRC);
}
const SRC = ENV_SRC === undefined ? DEFAULT_SRC : resolve(ENV_SRC);
if (!existsSync(SRC)) {
  throw new Error('BundleShake: file under test does not exist: ' + SRC);
}

const CAPTURE_MARKERS = ['getOwnPropertyDescriptor', 'toStringTag'];
const FB1024_MARKERS = ['getOwnPropertyDescriptor', 'toStringTag', 'FastBit1024', 'Int32Array'];
// 'intersectionSize' is a FastBit1024 method name: only the class body has it
// (minify keeps member names; the one other mention is a comment). 'FastBit1024'
// is also in the FastBit1024 throw helpers, which shake out with the class.
const FB1024_CLASS_MARKERS = ['intersectionSize', 'FastBit1024'];

let dir = '';
let seq = 0;

function bundle(name) {
  const entry = join(dir, 'entry-' + (seq++) + '.mjs');
  writeFileSync(entry, 'export { ' + name + ' } from ' + JSON.stringify(SRC) + ';\n');
  const r = buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    minify: true,
    write: false,
    logLevel: 'silent',
  });
  assert.equal(r.errors.length, 0, 'esbuild errors for ' + name);
  assert.equal(r.outputFiles.length, 1, 'one output file for ' + name);
  const text = r.outputFiles[0].text;
  assert.ok(text.length > 0, 'bundle for ' + name + ' is non-empty');
  assert.ok(text.includes(name), 'bundle for ' + name + ' carries its export marker');
  return text;
}

const mod = await import(pathToFileURL(SRC).href);
const EXPORTS = Object.keys(mod).sort();

describe('BundleShake: FastBit1024 captures drop out of bundles that never use it (' + SRC + ')', () => {
  before(() => { dir = mkdtempSync(join(tmpdir(), 'fb-shake-')); });
  after(() => { if (dir !== '') rmSync(dir, { recursive: true, force: true }); });

  it('the module exports FastBit32, BitMapper, FastBit1024 and the free functions', () => {
    for (const n of ['FastBit32', 'BitMapper', 'FastBit1024', 'FastBit64', 'VERSION', 'forEachArray']) {
      assert.ok(EXPORTS.includes(n), 'export ' + n + ' present');
    }
    assert.ok(EXPORTS.length >= 6, 'export list non-trivial: ' + EXPORTS.join(','));
  });

  it('(a) export { FastBit32 } bundle has no FastBit1024 capture or class', () => {
    const text = bundle('FastBit32');
    assert.ok(text.length > 500, 'FastBit32 bundle has real code (' + text.length + ' B)');
    assert.ok(text.includes('nextCombination'), 'FastBit32 body present');
    for (const m of FB1024_MARKERS) {
      assert.equal(text.includes(m), false, 'FastBit32-only bundle contains ' + JSON.stringify(m));
    }
  });

  it('(a2) export { FastBit32 } bundle has no FastBit64', () => {
    const text = bundle('FastBit32');
    assert.equal(text.includes('FastBit64'), false, 'FastBit32-only bundle contains "FastBit64"');
  });

  it('(b) control: export { FastBit1024 } bundle keeps both captures', () => {
    const text = bundle('FastBit1024');
    for (const m of CAPTURE_MARKERS) {
      assert.ok(text.includes(m), 'FastBit1024 bundle lacks ' + JSON.stringify(m));
    }
    assert.ok(text.includes('Int32Array'), 'FastBit1024 bundle names Int32Array');
  });

  it('(b2) export { FastBit64 } bundle keeps both captures and Int32Array, but not the FastBit1024 class', () => {
    const text = bundle('FastBit64');
    for (const m of CAPTURE_MARKERS) {
      assert.ok(text.includes(m), 'FastBit64 bundle lacks ' + JSON.stringify(m));
    }
    assert.ok(text.includes('Int32Array'), 'FastBit64 bundle names Int32Array');
    for (const m of FB1024_CLASS_MARKERS) {
      assert.equal(text.includes(m), false, 'FastBit64-only bundle contains ' + JSON.stringify(m));
    }
  });

  it('(b3) control: the FastBit1024 class markers are in the FastBit1024 bundle', () => {
    const text = bundle('FastBit1024');
    for (const m of FB1024_CLASS_MARKERS) {
      assert.ok(text.includes(m), 'FastBit1024 bundle lacks ' + JSON.stringify(m));
    }
  });

  it('(c) every other export bundles without the captures', () => {
    const rest = EXPORTS.filter((n) => n !== 'FastBit1024' && n !== 'FastBit32' && n !== 'FastBit64');
    assert.ok(rest.includes('BitMapper'), 'BitMapper covered');
    for (const n of rest) {
      const text = bundle(n);
      for (const m of FB1024_MARKERS) {
        assert.equal(text.includes(m), false, n + '-only bundle contains ' + JSON.stringify(m));
      }
    }
  });
});
