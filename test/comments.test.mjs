import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT } from './support.mjs';

const FUNCTION = /^\s*(export\s+)?(async\s+)?function\b|^\s*(export\s+)?const\s+[\w$]+\s*=\s*(async\s*)?(\([^)]*\)|[\w$]+)\s*=>|^\s*[\w$]+\s*\([^)]*\)\s*\{/;

/**
 * Every comment of a file that is not the docblock of the function right below it, as `file:line`:
 * a line comment, one after code on the same line, and a block above anything but a function.
 */
function strayComments(file) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/);
  const stray = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('//') || /[;{},)\]]\s*\/\/(\s|$)/.test(t)) { stray.push(`${file}:${i + 1}`); continue; }
    if (!t.startsWith('/*')) continue;
    let end = i;
    while (end < lines.length && !lines[end].includes('*/')) end++;
    if (!FUNCTION.test(lines[end + 1] || '')) stray.push(`${file}:${i + 1}`);
    i = end;
  }
  return stray;
}

test('every comment in the JavaScript of the project is the docblock of a function', () => {
  const files = ['src', 'src/check', 'bin', 'test'].flatMap((dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.mjs')).map((f) => `${dir}/${f}`));
  assert.ok(files.length > 30, 'the files were found');
  assert.deepEqual(files.flatMap(strayComments), []);
});

test('no source file holds an invisible byte order mark, which an escape writes visibly', () => {
  const files = ['src', 'src/check', 'bin', 'test'].flatMap((dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.mjs')).map((f) => `${dir}/${f}`));
  const marked = files.filter((f) => readFileSync(join(ROOT, f), 'utf8').includes(String.fromCharCode(0xfeff)));
  assert.deepEqual(marked, []);
});
