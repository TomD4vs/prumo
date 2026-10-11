import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { analyze, resolveTargets } from '../src/check.mjs';
import { applyCaseFixes } from '../src/fix.mjs';
import { repoWith } from './support.mjs';

test('--fix rewrites the case and leaves everything else alone', () => {
  const repo = repoWith({
    'CLAUDE.md': 'Logo in `layouts/App.vue`, and a dead `config/gone.php`.\n',
    'resources/js/Layouts/App.vue': '',
  });
  const targets = resolveTargets(repo, []);
  const before = analyze({ repo, targets });
  assert.equal(before.caseMismatch.length, 1);
  assert.equal(before.missingPaths.length, 1);

  const fixed = applyCaseFixes(before.caseMismatch, targets);
  assert.equal(fixed.paths, 1);
  assert.equal(fixed.files, 1);

  const body = readFileSync(join(repo, 'CLAUDE.md'), 'utf8');
  assert.match(body, /`resources\/js\/Layouts\/App\.vue`/);
  assert.doesNotMatch(body, /`layouts\/App\.vue`/);
  assert.match(body, /`config\/gone\.php`/, 'the missing path must be left untouched');

  const after = analyze({ repo, targets });
  assert.equal(after.caseMismatch.length, 0);
  assert.equal(after.missingPaths.length, 1);
});

test('--fix skips a line that changed since the scan', () => {
  const repo = repoWith({ 'CLAUDE.md': 'See `layouts/App.vue`.\n', 'resources/js/Layouts/App.vue': '' });
  const targets = resolveTargets(repo, []);
  const stale = [{ file: 'CLAUDE.md', line: 1, cited: 'layouts/NotThere.vue', actual: 'x/y.vue' }];
  const fixed = applyCaseFixes(stale, targets);
  assert.equal(fixed.paths, 0);
  assert.equal(fixed.skipped[0].why, 'line changed since the scan');
});

test('a markdown link with the wrong case is a case mismatch, and --fix rewrites it relative to its file', () => {
  const repo = repoWith({
    'CLAUDE.md': '# x\n',
    '.claude/skills/deploy/SKILL.md': '---\nname: d\ndescription: t\n---\n- [Setup](Steps/setup.md#top)\n- [Gone](steps/gone.md)\n',
    '.claude/skills/deploy/steps/setup.md': '# setup\n',
  });
  const targets = resolveTargets(repo, []);
  const before = analyze({ repo, targets });
  assert.deepEqual(before.caseMismatch, [
    { file: '.claude/skills/deploy/SKILL.md', line: 5, kind: 'link', cited: 'Steps/setup.md', actual: 'steps/setup.md' },
  ]);
  assert.equal(before.brokenLinks.length, 1);
  assert.equal(before.brokenLinks[0].kind, 'link');
  assert.equal(before.brokenLinks[0].cited, 'steps/gone.md');

  const fixed = applyCaseFixes(before.caseMismatch, targets);
  assert.equal(fixed.paths, 1);
  const body = readFileSync(join(repo, '.claude/skills/deploy/SKILL.md'), 'utf8');
  assert.match(body, /\[Setup\]\(steps\/setup\.md#top\)/, 'the link keeps its anchor and stays relative');
  assert.equal(analyze({ repo, targets }).caseMismatch.length, 0);
});

test('--fix keeps a link encoded, so a corrected link still works', () => {
  const repo = repoWith({
    'CLAUDE.md': 'Veja [b](docs/nota%20longa.md).\n',
    'docs/Nota Longa.md': '',
  });
  const targets = resolveTargets(repo, []);
  const before = analyze({ repo, targets });
  applyCaseFixes(before.caseMismatch, targets);

  const line = readFileSync(join(repo, 'CLAUDE.md'), 'utf8').split('\n')[0];
  assert.match(line, /\(docs\/Nota%20Longa\.md\)/);
  const href = line.match(/\]\(([^)]+)\)/)[1];
  assert.equal(existsSync(join(repo, decodeURIComponent(href))), true);
  assert.equal(analyze({ repo, targets: resolveTargets(repo, []) }).caseMismatch.length, 0);
});

test('a path cited on several lines is reported on each, and one fix pass corrects them all', () => {
  const repo = repoWith({
    'CLAUDE.md': 'Logo in `layouts/App.vue`.\n\nAlso `layouts/App.vue` and again `layouts/App.vue` here.\n',
    'resources/js/Layouts/App.vue': '',
  });
  const targets = resolveTargets(repo, []);
  const before = analyze({ repo, targets });
  assert.deepEqual(before.caseMismatch.map((c) => c.line), [1, 3]);

  const fixed = applyCaseFixes(before.caseMismatch, targets);
  assert.equal(fixed.paths, 2);
  assert.equal(fixed.skipped.length, 0);
  assert.doesNotMatch(readFileSync(join(repo, 'CLAUDE.md'), 'utf8'), /layouts\/App\.vue/);
  assert.equal(analyze({ repo, targets }).caseMismatch.length, 0);
});

test('--fix rewrites every form a path is cited in: a command, a backslash, a line number, a trailing slash, a fenced block, and each link syntax', () => {
  const repo = repoWith({
    'CLAUDE.md': [
      'Run `node scripts/Build.js --watch`, see `src/layouts/App.vue:42`, models in `app/models/`.',
      'The layout is `src\\layouts\\App.vue`, deployed by `./scripts/Build.js`.',
      '```',
      'cp app/models/User.php src/layouts/',
      '```',
      'Read [the note](<docs/nota longa.md>) and [the other][r].',
      '',
      '[r]: docs/real.md',
      '',
    ].join('\n'),
    'scripts/build.js': '',
    'src/Layouts/App.vue': '',
    'app/Models/User.php': '',
    'docs/Nota Longa.md': '',
    'docs/Real.md': '',
  });
  const targets = resolveTargets(repo, []);
  const before = analyze({ repo, targets });
  assert.equal(before.caseMismatch.length, 9);

  const fixed = applyCaseFixes(before.caseMismatch, targets);
  assert.deepEqual(fixed.skipped, []);
  assert.equal(fixed.paths, 9);
  assert.equal(readFileSync(join(repo, 'CLAUDE.md'), 'utf8'), [
    'Run `node scripts/build.js --watch`, see `src/Layouts/App.vue:42`, models in `app/Models/`.',
    'The layout is `src\\Layouts\\App.vue`, deployed by `./scripts/build.js`.',
    '```',
    'cp app/Models/User.php src/Layouts/',
    '```',
    'Read [the note](<docs/Nota Longa.md>) and [the other][r].',
    '',
    '[r]: docs/Real.md',
    '',
  ].join('\n'));
  assert.equal(analyze({ repo, targets }).caseMismatch.length, 0);
});
