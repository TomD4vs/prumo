import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkFiles } from './support.mjs';

/** One line of 20 thousand characters built from a unit that some pattern of the analysis could backtrack on. */
const line = (unit, head = '', tail = '') => head + unit.repeat(Math.ceil(20000 / unit.length)).slice(0, 20000) + tail;

const SHAPES = {
  'slashes': line('a/'),
  'code spans': line('`a/b '),
  'an unclosed code span': line('src/x ', '`'),
  'wikilink openers': line('[['),
  'an unclosed wikilink': line('a ', '[['),
  'link openers': line(']('),
  'an unclosed link': line('a', ']('),
  'an unclosed angle link': line('a#', '](<'),
  'conditions': line('if `src/a.ts` '),
  'a long condition': line('a ', 'if ', ' `src/x.ts` exists'),
  'negations': line("doesn't "),
  'producing verbs': line('write '),
  'sentences': line('. '),
  'a host': line('a.', '', 'com/x.md'),
  'a symbol suffix': line(':a', 'src/a.ts'),
  'a call prefix': line('a.', '', '(src/x.ts'),
  'date stencils': line('YYYY-'),
  'commands': line('npm run a && '),
  'quotes': line('"a '),
  'comment openers': line('<!--'),
  'a heading of links': line('[a](', '# '),
  'a heading of images': line('![', '# '),
  'table cells': line('| '),
  'list markers': line('- '),
  'repository links': line('github.com/a/'),
};

for (const [name, text] of Object.entries(SHAPES)) {
  test(`a note made of ${name} is read to the end, in seconds`, () => {
    const started = Date.now();
    const r = checkFiles({ 'CLAUDE.md': `${text}\n`, 'src/a.ts': '' });
    assert.ok(r.stats.targets === 1);
    assert.ok(Date.now() - started < 10000, `took ${Date.now() - started} ms`);
  });
}
