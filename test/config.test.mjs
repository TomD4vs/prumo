import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/check.mjs';
import { repoWith, checkFiles } from './support.mjs';

test('config: ignore silences a matching path', () => {
  const r = checkFiles({
    'CLAUDE.md': 'See `config/database.php` and `config/other.php`.\n',
    '.prumorc.json': JSON.stringify({ ignore: ['config/database.php'] }),
    'src/a.js': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, 'config/other.php');
});

test('config: a glob in ignore silences a whole folder', () => {
  const r = checkFiles({
    'CLAUDE.md': 'Old `docs/legacy/a.php`, `docs/legacy/deep/b.php`, new `docs/live.php`.\n',
    '.prumorc.json': JSON.stringify({ ignore: ['docs/legacy/**'] }),
    'src/a.js': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['docs/live.php']);
});

test('config: exclude drops a context file from the run', () => {
  const r = checkFiles({
    'CLAUDE.md': 'See `config/gone.php`.\n',
    'AGENTS.md': 'Also `config/gone-too.php`.\n',
    '.prumorc.json': JSON.stringify({ exclude: ['AGENTS.md'] }),
    'src/a.js': '',
  });
  assert.equal(r.stats.targets, 1, 'the header must count only what was actually checked');
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['config/gone.php']);
});

test('config: invalid JSON fails loudly instead of being ignored', () => {
  const repo = repoWith({ 'CLAUDE.md': '# x\n', '.prumorc.json': '{ not json' });
  assert.throws(() => loadConfig(repo), /not valid JSON/);
});

test('inline marker suppresses its own line and the next one', () => {
  const r = checkFiles({
    'CLAUDE.md': [
      'A `config/one.php` <!-- prumo-ignore -->',
      '<!-- prumo-ignore-next-line -->',
      'B `config/two.php`',
      'C `config/three.php`',
    ].join('\n'),
    'src/a.js': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['config/three.php']);
  assert.equal(r.stats.suppressed, 2);
});

test('a file marker suppresses the whole file', () => {
  const r = checkFiles({
    'CLAUDE.md': '<!-- prumo-ignore-file -->\nSee `config/gone.php`.\n',
    'src/a.js': '',
  });
  assert.equal(r.missingPaths.length, 0);
  assert.equal(r.stats.suppressed, 1);
});

test('config: a folder named without wildcards covers everything under it', () => {
  const r = checkFiles({
    'CLAUDE.md': 'Build in `public/dist/app.js` and `coverage-html/index.html`, keep `public/index.php`.\n',
    '.prumorc.json': JSON.stringify({ transient: ['public/dist'], ignore: ['coverage-html'] }),
    'src/a.js': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['public/index.php']);
});

test('a prumo-ignore-next-line marker before a fenced block silences the whole block, counted once', () => {
  const r = checkFiles({
    'CLAUDE.md': [
      '<!-- prumo-ignore-next-line -->',
      '```',
      'src/gone-a.ts',
      'src/gone-b.ts',
      '```',
      '- step:',
      '',
      '    ~~~sh',
      '    cat src/gone-c.ts',
      '    ~~~',
      '',
    ].join('\n'),
    'src/index.ts': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['src/gone-c.ts']);
  assert.equal(r.stats.suppressed, 1);
});

test('config: a pattern too long to become a regular expression is left out, and the others still apply', () => {
  const r = checkFiles({
    'CLAUDE.md': 'See `config/database.php` and `config/other.php`.\n',
    '.prumorc.json': JSON.stringify({ ignore: ['{a,'.repeat(20000), 'config/database.php'] }),
    'src/a.js': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['config/other.php']);
});
