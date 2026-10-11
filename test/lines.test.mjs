import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { analyze, resolveTargets } from '../src/check.mjs';
import { applyCaseFixes } from '../src/fix.mjs';
import { repoWith, checkFiles } from './support.mjs';

test('the sentence above a fenced block governs a file tree inside it, not a command', () => {
  const r = checkFiles({
    'AGENTS.md': 'The skill creates this layout:\n```\ndocs/plan.md\n```\n\nThe skill creates the report with:\n```\nnode scripts/gen.js\n```\n',
    'docs/README.md': '',
    'scripts/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['scripts/gen.js']);
});

test('a call prefix in a fenced block is stripped, so the path is checked and cited clean', () => {
  const r = checkFiles({
    'AGENTS.md': '```\nrequire(\'lib/gone.js\')\nconst y = load("lib/gone2.js")\nrequire(\'src/components/button.tsx\')\n```\n',
    'src/components/Button.tsx': '',
    'lib/index.js': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['lib/gone.js', 'lib/gone2.js']);
  assert.equal(r.caseMismatch.length, 1);
  assert.equal(r.caseMismatch[0].cited, 'src/components/button.tsx');
});

test('a fenced block in a programming language is not read', () => {
  const r = checkFiles({
    'AGENTS.md': '```js\nconst x = require(\'lib/gone.js\');\n```\n\n```python\nopen("lib/gone.py")\n```\n\n```bash\nnode lib/gone.js\n```\n',
    'lib/index.js': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['lib/gone.js']);
  assert.equal(r.missingPaths[0].line, 10);
});

test('a path inside a fenced block is checked, and a link there is a quotation', () => {
  const r = checkFiles({
    'CLAUDE.md': [
      '# app', '',
      '```', 'src/component.vue', 'docs/missing-file.md', '```', '',
      '```bash', 'node scripts/seed.js --force', '```', '',
      '```markdown', 'See `src/gone-quoted.ts` and [a link](docs/gone.md).', '```', '',
      '<!-- [commented](docs/also-gone.md) -->',
      'A real one: [live](docs/really-gone.md).', '',
    ].join('\n'),
    'src/Component.vue': '',
    'docs/README.md': '',
  });
  assert.deepEqual(r.caseMismatch.map((c) => [c.line, c.cited, c.actual]), [[4, 'src/component.vue', 'src/Component.vue']]);
  assert.deepEqual(r.missingPaths.map((m) => [m.line, m.cited]), [[5, 'docs/missing-file.md'], [9, 'scripts/seed.js']]);
  assert.deepEqual(r.brokenLinks.map((l) => [l.line, l.cited]), [[17, 'docs/really-gone.md']]);
});

test('inside a fenced block, a comment line and a bare ./name argument are not read', () => {
  const r = checkFiles({
    'CLAUDE.md': [
      '```bash',
      '# -> results_abc/runs.json',
      '// see src/gone-in-comment.ts',
      'tool export --messages ./messages.json --out ./out.json',
      'tool import ./data/input.json',
      'src/api/    # REST handlers',
      '```',
      '',
    ].join('\n'),
    'src/index.ts': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['data/input.json', 'src/api']);
});

test('what sits inside an HTML comment is not read, and the rest of its line is', () => {
  const r = checkFiles({
    'CLAUDE.md': [
      'Keep `src/index.ts` <!-- was `src/old.ts` --> as the entry.',
      '<!--',
      'Old notes: `config/gone.php` and [x](docs/gone.md).',
      '-->',
      'Still `config/really-gone.php`.',
      '',
    ].join('\n'),
    'src/index.ts': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => [m.line, m.cited]), [[5, 'config/really-gone.php']]);
  assert.equal(r.brokenLinks.length, 0);
});

test('a note with CRLF line endings reads the same as one with LF, and a fix keeps the endings it found', () => {
  const note = [
    '# app', '',
    '```', 'src/component.vue', 'docs/missing-file.md', '```', '',
    '```bash', 'node scripts/seed.js --force', '```', '',
    '```markdown', 'See `src/gone-quoted.ts` and [a link](docs/gone.md).', '```', '',
    '```js', "const x = require('lib/gone.js');", '```', '',
    '<!-- prumo-ignore-next-line -->',
    '```', 'docs/silenced.md', '```', '',
    '<!-- [commented](docs/also-gone.md) -->',
    'A real one: [live](docs/really-gone.md).', '',
  ];
  const files = { 'src/Component.vue': '', 'docs/README.md': '' };
  const seen = (r) => [
    r.caseMismatch.map((c) => [c.line, c.cited, c.actual]),
    r.missingPaths.map((m) => [m.line, m.cited]),
    r.brokenLinks.map((l) => [l.line, l.cited]),
    r.stats.suppressed,
  ];
  const lf = checkFiles({ 'CLAUDE.md': note.join('\n'), ...files });
  assert.deepEqual(seen(lf), [[[4, 'src/component.vue', 'src/Component.vue']], [[5, 'docs/missing-file.md'], [9, 'scripts/seed.js']], [[26, 'docs/really-gone.md']], 1]);

  const repo = repoWith({ 'CLAUDE.md': note.join('\r\n'), ...files });
  const targets = resolveTargets(repo, []);
  const crlf = analyze({ repo, targets });
  assert.deepEqual(seen(crlf), seen(lf), 'the fences open, the quotation and the comment stay quiet, and the marker still counts');

  applyCaseFixes(crlf.caseMismatch, targets);
  const fixed = readFileSync(join(repo, 'CLAUDE.md'), 'utf8');
  assert.ok(fixed.includes('src/Component.vue\r\n'), 'the case is corrected on its line');
  assert.equal(fixed.split('\r\n').length, note.length, 'every line still ends in CRLF');
  assert.ok(!/[^\r]\n/.test(fixed), 'no line ending was rewritten');
});
