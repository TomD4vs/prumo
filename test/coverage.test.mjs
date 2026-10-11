import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTargets } from '../src/check.mjs';
import { coverage, ACTIVE_DAYS } from '../src/coverage.mjs';
import { renderCoverage } from '../src/report.mjs';
import { committedRepo, write, git, cli, talk } from './support.mjs';

const FILES = {
  'CLAUDE.md': '# app\n\nThe server starts in `src/server.ts`; the web package is `packages/web`.\n',
  'src/server.ts': '',
  'scripts/deploy.sh': '',
  'infra/main.tf': '',
  'infra/vars.tf': '',
  'packages/web/package.json': '{}',
  'packages/web/index.ts': '',
  'packages/api/package.json': '{}',
  'packages/api/index.ts': '',
  'packages/admin/package.json': '{}',
  'packages/admin/CLAUDE.md': '# admin\n',
  '.github/workflows/ci.yml': '',
  'dist/bundle.js': '',
  'README.md': '# app\n',
};

const report = (repo) => coverage({ repo, targets: resolveTargets(repo, []) });

test('coverage lists the folders no context file cites, package by package in a workspace, the most active first', () => {
  const repo = committedRepo(FILES);
  write(repo, { 'scripts/deploy.sh': 'one' }); git(repo, 'commit -qam deploy');
  write(repo, { 'scripts/deploy.sh': 'two' }); git(repo, 'commit -qam deploy');
  const r = report(repo);
  assert.equal(r.command, 'coverage');
  assert.deepEqual(r.folders.map((f) => `${f.folder} ${f.files} ${f.commits}`), [
    'scripts 1 3',
    'infra 2 1',
    'packages/api 2 1',
  ]);
  assert.deepEqual(r.stats, { targets: 2, folders: 6, cited: 3, days: ACTIVE_DAYS });
  assert.match(r.folders[0].age, /^today$/);
});

test('a folder cited by a path in it, by its own name, or holding a context file of its own counts as cited', () => {
  const r = report(committedRepo(FILES));
  const left = r.folders.map((f) => f.folder);
  for (const cited of ['src', 'packages/web', 'packages/admin']) assert.ok(!left.includes(cited), cited);
  for (const never of ['.github', 'dist', 'README.md', 'packages']) assert.ok(!left.includes(never), never);
});

test('the text report lists each folder with its files, its commits and its last commit, or says every folder is cited', () => {
  const r = report(committedRepo(FILES));
  const text = renderCoverage(r);
  assert.match(text, /^prumo — coverage, 2 context files, 6 folders of code, 3 cited\n\nUNCITED  \(3\)   folders no context file mentions, most commits in 90 days first\n/);
  assert.match(text, /^  infra          2 files   1 commit    last today$/m);
  assert.match(text, /^  packages\/api   2 files   1 commit    last today$/m);
  assert.match(text, /^  scripts        1 file    1 commit    last today$/m, 'one file is written without the s, and the column stays aligned');
  const clean = renderCoverage(report(committedRepo({ 'CLAUDE.md': 'See `src/a.ts`.\n', 'src/a.ts': '' })));
  assert.equal(clean, 'prumo — coverage, 1 context file, 1 folder of code, 1 cited\n\nevery folder of code is cited by a context file.');
});

test('the CLI runs the report, exits 0, takes --format json, and refuses the options of the check', () => {
  const repo = committedRepo(FILES);
  const plain = cli(['coverage', repo]);
  assert.equal(plain.status, 0);
  assert.match(plain.out, /^UNCITED  \(3\)/m);
  const json = JSON.parse(cli(['coverage', repo, '--format', 'json']).out);
  assert.equal(json.command, 'coverage');
  assert.equal(json.folders.length, 3);
  const fix = cli(['coverage', repo, '--fix']);
  assert.equal(fix.status, 2);
  assert.match(fix.err, /--fix is not an option of "prumo coverage"/);
  assert.equal(cli(['coverage', repo, '--since', 'HEAD']).status, 2);
});

test('prumo_coverage returns the report as text and as structured content', () => {
  const repo = committedRepo(FILES);
  const [r] = talk([{ jsonrpc: '2.0', id: 40, method: 'tools/call', params: { name: 'prumo_coverage', arguments: { repo } } }]);
  assert.equal(r.result.isError, false);
  assert.equal(r.result.structuredContent.command, 'coverage');
  assert.match(r.result.content[0].text, /^UNCITED  \(3\)/m);
});
