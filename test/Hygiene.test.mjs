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
