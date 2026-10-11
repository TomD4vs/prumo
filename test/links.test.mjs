import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { analyze, resolveTargets } from '../src/check.mjs';
import { tempDir, repoWith, checkFiles } from './support.mjs';

test('suggests the destination when a naming convention drifted', () => {
  const dir = tempDir('prumo-notes-');
  writeFileSync(join(dir, 'MEMORY.md'), 'index\n');
  writeFileSync(join(dir, 'deploy_checklist.md'), 'body\n');
  writeFileSync(join(dir, 'a.md'), 'See [[deploy-checklist]].\n');

  const repo = repoWith({ 'CLAUDE.md': '# x\n' });
  const r = analyze({ repo, targets: resolveTargets(repo, [dir]) });

  const link = r.brokenLinks.find((l) => l.cited === 'deploy-checklist');
  assert.ok(link, 'the broken link should be reported');
  assert.equal(link.suggestion, 'deploy_checklist');
});

test('reports a broken link with no candidate and offers no suggestion', () => {
  const dir = tempDir('prumo-notes-');
  writeFileSync(join(dir, 'a.md'), 'See [[nothing-like-this]].\n');

  const repo = repoWith({ 'CLAUDE.md': '# x\n' });
  const r = analyze({ repo, targets: resolveTargets(repo, [dir]) });

  assert.equal(r.brokenLinks.length, 1);
  assert.equal(r.brokenLinks[0].suggestion, null);
});

test('checks markdown links, and accepts the ones that resolve', () => {
  const dir = tempDir('prumo-notes-');
  writeFileSync(join(dir, 'there.md'), 'body\n');
  writeFileSync(join(dir, 'a.md'), 'Good [x](there.md), bad [y](gone.md).\n');

  const repo = repoWith({ 'CLAUDE.md': '# x\n' });
  const r = analyze({ repo, targets: resolveTargets(repo, [dir]) });

  assert.equal(r.brokenLinks.length, 1);
  assert.equal(r.brokenLinks[0].cited, 'gone.md');
});

test('a link inside backticks is a quotation, not a reference', () => {
  const dir = tempDir('prumo-notes-');
  writeFileSync(join(dir, 'a.md'), [
    'Write it as `[[some-example]]` when you mean to quote it.',
    'A real one: [[also-missing]].',
    'And `[quoted](nowhere.md)` versus [live](nowhere.md).',
  ].join('\n'));

  const repo = repoWith({ 'CLAUDE.md': '# x\n' });
  const r = analyze({ repo, targets: resolveTargets(repo, [dir]) });

  assert.deepEqual(r.brokenLinks.map((l) => l.cited).sort(), ['also-missing', 'nowhere.md']);
});

test('a wikilink resolves against any markdown file git tracks, and suggests from it', () => {
  const r = checkFiles({
    'CLAUDE.md': 'See [[deploy_checklist]], [[deploy-checklist]] and [[old-architecture]].\n',
    'deploy_checklist.md': 'body\n',
  });
  assert.deepEqual(r.brokenLinks.map((l) => l.cited).sort(), ['deploy-checklist', 'old-architecture']);
  assert.equal(r.brokenLinks.find((l) => l.cited === 'deploy-checklist').suggestion, 'deploy_checklist');
  assert.equal(r.brokenLinks.find((l) => l.cited === 'old-architecture').suggestion, null);
});

test('a wikilink and a markdown link are told apart', () => {
  const r = checkFiles({ 'CLAUDE.md': 'See [[missing-note]] and [guide](docs/missing.md).\n' });
  assert.deepEqual(r.brokenLinks.map((l) => [l.kind, l.cited]), [['wikilink', 'missing-note'], ['link', 'docs/missing.md']]);
});

test('a markdown link that starts with a slash resolves from the repository root', () => {
  const r = checkFiles({
    'AGENTS.md': '# root\n',
    '.agents/skills/write/SKILL.md': '---\nname: w\ndescription: d\n---\nFollow [the rules](/AGENTS.md) and [old](/docs/gone.md).\n',
  });
  assert.deepEqual(r.brokenLinks.map((l) => l.cited), ['/docs/gone.md']);
});

test('a markdown link holding a template placeholder is not a broken link', () => {
  const r = checkFiles({
    'CLAUDE.md': '- [One](chapters/ch01-<slug>.md)\n- [Two](chapters/ch02-real.md)\n',
    'chapters/ch01-intro.md': '',
  });
  assert.deepEqual(r.brokenLinks.map((l) => l.cited), ['chapters/ch02-real.md']);
});

test('a markdown link writes a space as %20, and that link resolves', () => {
  const r = checkFiles({
    'CLAUDE.md': 'Certo: [a](docs/Nota%20Longa.md).\n\nCaixa: [b](docs/nota%20longa.md).\n\nSumiu: [c](docs/Outra%20Nota.md).\n',
    'docs/Nota Longa.md': '',
  });
  assert.deepEqual(r.brokenLinks.map((l) => l.cited), ['docs/Outra%20Nota.md']);
  assert.equal(r.caseMismatch.length, 1);
  assert.equal(r.caseMismatch[0].cited, 'docs/nota%20longa.md');
  assert.equal(r.caseMismatch[0].actual, 'docs/Nota%20Longa.md');
});

test('path/to/ is a placeholder inside a markdown link as well as in prose', () => {
  const r = checkFiles({
    'AGENTS.md': 'List them as [Page Title](path/to/page.md) in the wiki.\n',
    'docs/real.md': '',
  });
  assert.equal(r.brokenLinks.length, 0);
});

test('a link wrapped in angle brackets is checked, spaces and all', () => {
  const r = checkFiles({
    'AGENTS.md': 'Read [the note](<docs/Nota Que Sumiu.md>) first.\n',
    'docs/outra.md': '',
  });
  assert.equal(r.brokenLinks.length, 1);
  assert.equal(r.brokenLinks[0].cited, 'docs/Nota Que Sumiu.md');
});

test('a link to an image or to code is checked, not only one to markdown', () => {
  const r = checkFiles({
    'AGENTS.md': 'See [the diagram](docs/arquitetura.png) and [the parser](src/parser.ts).\n',
    'docs/real.png': '',
    'src/index.ts': '',
  });
  assert.equal(r.brokenLinks.length, 2);
});

test('a reference definition is a link, and is reported on its own line', () => {
  const r = checkFiles({
    'AGENTS.md': 'Look at [the sketch][ESQ].\n\n[ESQ]: assets/esquema-antigo.svg\n',
    'assets/esquema.svg': '',
  });
  assert.equal(r.brokenLinks.length, 1);
  assert.equal(r.brokenLinks[0].cited, 'assets/esquema-antigo.svg');
  assert.equal(r.brokenLinks[0].line, 3);
});

test('a link to a heading the page does not have is a broken link, with the closest heading as the suggestion', () => {
  const r = checkFiles({
    'AGENTS.md': [
      '# Guide',
      '',
      '## Getting started',
      '',
      '## Getting started',
      '',
      '## Config & secrets: the `.env` file',
      '',
      '<a name="legacy-anchor"></a>',
      '',
      '### Deploy {#custom-id}',
      '',
      '```',
      '# not a heading',
      '```',
      '',
      'See [start](#getting-started), [again](#getting-started-1), [env](#config--secrets-the-env-file), [old](#legacy-anchor), [custom](#custom-id),',
      '[wrong](#getting_started), [gone](#nowhere), [fenced](#not-a-heading) and [there](docs/setup.md#database).',
      '',
    ].join('\n'),
    'docs/setup.md': '# Setup\n\n## Database\n\nSetext heading\n--------------\n',
  });
  assert.deepEqual(r.brokenLinks.map((l) => [l.kind, l.cited, l.suggestion]), [
    ['anchor', '#getting_started', '#getting-started'],
    ['anchor', '#nowhere', null],
    ['anchor', '#not-a-heading', null],
  ]);
  const ok = checkFiles({
    'AGENTS.md': 'See [db](docs/setup.md#database) and [sx](docs/setup.md#setext-heading) and [code](src/a.js#L10).\n',
    'docs/setup.md': '# Setup\n\n## Database\n\nSetext heading\n--------------\n',
    'src/a.js': '',
  });
  assert.equal(ok.brokenLinks.length, 0);
});

test('a page with Windows line endings answers to the same anchors, and a script named with a glob is not a command', () => {
  const r = checkFiles({
    'AGENTS.md': 'See [json](README.md#consuming-the-json) and [top](#setup).\r\n\r\n## Setup\r\n\r\nRun `pnpm maid:*` scripts.\r\n',
    'README.md': '# Tool\r\n\r\n## Consuming the JSON\r\n\r\nText.\r\n',
    'package.json': JSON.stringify({ scripts: { 'maid:up': 'x' } }),
  });
  assert.equal(r.brokenLinks.length, 0);
  assert.equal(r.unknownCommands.length, 0);
});

test('a link from a nested note that resolves from the repository root is read from the root, as an agent reads it', () => {
  const r = checkFiles({
    '.claude/skills/api/SKILL.md': 'See [the app](src/app.ts), [the wrong case](src/App.ts) and [gone](src/gone.ts).\n',
    'src/app.ts': '',
  });
  assert.deepEqual(r.brokenLinks.map((l) => l.cited), ['src/gone.ts']);
  assert.deepEqual(r.caseMismatch.map((c) => [c.cited, c.actual]), [['src/App.ts', 'src/app.ts']]);
});

test('a link to a heading in another page is checked against that page', () => {
  const r = checkFiles({
    'AGENTS.md': 'Read [the schema](docs/setup.md#schema) and [the flow](<docs/setup.md#data-flow>).\n',
    'docs/setup.md': '# Setup\n\n## Data flow\n',
  });
  assert.deepEqual(r.brokenLinks.map((l) => [l.kind, l.cited]), [['anchor', 'docs/setup.md#schema']]);
});

test('template syntax and code in double brackets are not wikilinks, and a span that opens with a number is not a command', () => {
  const r = checkFiles({
    'AGENTS.md': 'Set $[[ inputs.stage ]], filter with df[[col]], and see [[semgrep.ruleset]]. Real: [[deploy-checklist]]. Open `000 Inbox/Inbox.md` daily.\n',
    'docs/README.md': '',
  });
  assert.deepEqual(r.brokenLinks.map((l) => l.cited), ['deploy-checklist']);
  assert.equal(r.missingPaths.length, 0);
});

test('an mdc: link in a Cursor rule resolves from the repository root, and keeps its prefix when the case is fixed', () => {
  const r = checkFiles({
    '.cursor/rules/astro.mdc': '---\nglobs: src/**\n---\nSee [config](mdc:astro.config.mjs), [styles](mdc:src/Styles/global.css) and [gone](mdc:src/gone.ts).\n',
    'astro.config.mjs': '',
    'src/styles/global.css': '',
  });
  assert.deepEqual(r.caseMismatch.map((c) => `${c.cited} -> ${c.actual}`), ['mdc:src/Styles/global.css -> mdc:src/styles/global.css']);
  assert.deepEqual(r.brokenLinks.map((l) => l.cited), ['mdc:src/gone.ts']);
  assert.equal(r.missingPaths.length, 0);
});

test('a link whose text is the same path in backticks is one citation, reported once as the link', () => {
  const r = checkFiles({
    'CLAUDE.md': '# app\n\nSee [\x60docs/gone.md\x60](docs/gone.md) and [\x60src/lost.ts\x60](./src/lost.ts).\nAlso \x60docs/other.md\x60 beside [x](docs/gone.md).\n',
    'packages/api/AGENTS.md': '# api\n\nRead [\x60src/old.ts\x60](src/old.ts) here.\n',
    'src/kept.ts': '',
  });
  assert.deepEqual(r.brokenLinks.map((l) => `${l.file}:${l.line} ${l.cited}`), [
    'CLAUDE.md:3 docs/gone.md',
    'CLAUDE.md:3 ./src/lost.ts',
    'CLAUDE.md:4 docs/gone.md',
    'packages/api/AGENTS.md:3 src/old.ts',
  ]);
  assert.deepEqual(r.missingPaths.map((o) => `${o.file}:${o.line} ${o.cited}`), ['CLAUDE.md:4 docs/other.md'], 'the backticked twin of a link is not a second finding; a different path beside a link still is');
});

test('a file: link is an address, like a file:// path in prose, and is not a broken link', () => {
  const r = checkFiles({
    'CLAUDE.md': '# app\n\nSee [the rules](file:///C:/Users/me/project/.agents/skills/rules/SKILL.md) and [gone](docs/gone.md).\n',
  });
  assert.deepEqual(r.brokenLinks.map((l) => l.cited), ['docs/gone.md']);
});

test('a link fragment in the line form of GitHub points at a line, not a heading, so only the page is checked', () => {
  const r = checkFiles({
    'CLAUDE.md': [
      'See [a](docs/short.md#L1), [b](docs/short.md#L1-L2), [c](docs/short.md#L3C1-L4C2), [d](docs/short.md#L9) and [e](#L5).',
      'Still checked: [f](docs/short.md#nowhere), [g](docs/Short.md#L1) and [h](docs/gone.md#L1).',
      '',
    ].join('\n'),
    'docs/short.md': '# Intro\nline two\n',
  });
  assert.deepEqual(r.brokenLinks.map((l) => [l.kind, l.cited]), [['anchor', 'docs/short.md#nowhere'], ['link', 'docs/gone.md']]);
  assert.deepEqual(r.caseMismatch.map((c) => [c.cited, c.actual]), [['docs/Short.md', 'docs/short.md']]);
});
