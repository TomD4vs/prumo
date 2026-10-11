import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveTargets, loadBaseline, baselineOf, analyze } from '../src/check.mjs';
import { explain } from '../src/explain.mjs';
import { renderExplain } from '../src/report.mjs';
import { repoWith, cli } from './support.mjs';

const at = (repo, where) => explain({ repo, targets: resolveTargets(repo, []), at: where });
const said = (r) => r.events.map((e) => `${e.cited} ${e.outcome} ${e.reason}${e.to ? ` -> ${e.to}` : ''}`);

const NOTE = [
  '# app',
  '',
  'See `src/gone.ts`, `path/to/x.js`, `src/a.ts`, `README.md` and [guide](docs/guide.md#setup), run `npm run nope`.',
  '',
  '```markdown',
  'See `src/quoted.ts`.',
  '```',
  '',
  '<!-- prumo-ignore-next-line -->',
  'Silenced `src/silenced.ts`.',
  '',
  'Drafts live in `docs/draft.md` for now.',
].join('\n') + '\n';

const FILES = { 'CLAUDE.md': NOTE, 'src/a.ts': '', 'docs/guide.md': '# Guide\n', 'package.json': '{"scripts":{}}' };

test('--explain lists each citation on the line with what the checks decided and why', () => {
  const r = at(repoWith(FILES), 'CLAUDE.md:3');
  assert.equal(r.command, 'explain');
  assert.equal(r.text, NOTE.split('\n')[2]);
  assert.deepEqual(said(r), [
    'src/gone.ts reported MISSING PATH',
    'path/to/x.js excused a placeholder, as path/to/, foo or bar',
    'src/a.ts resolved git tracks it -> src/a.ts',
    'README.md excused a bare file name, with no folder, is not checked as a path',
    'npm run nope reported UNKNOWN COMMAND',
    'docs/guide.md resolved git tracks it -> docs/guide.md',
    'docs/guide.md#setup reported BROKEN LINK',
  ]);
});

test('--explain says why a line is not read: a block that quotes markdown, a marker, or a file a marker silences', () => {
  const repo = repoWith({ ...FILES, 'AGENTS.md': '<!-- prumo-ignore-file -->\n# agents\n\nSee `src/x.ts`.\n' });
  assert.equal(at(repo, 'CLAUDE.md:6').skipped, 'inside a fenced block that quotes markdown');
  assert.equal(at(repo, 'CLAUDE.md:5').skipped, 'the line that opens a fenced block');
  assert.equal(at(repo, 'CLAUDE.md:10').skipped, 'silenced by a prumo-ignore marker');
  assert.equal(at(repo, 'AGENTS.md:4').skipped, 'the whole file is silenced by a prumo-ignore-file marker');
  assert.match(renderExplain(at(repo, 'CLAUDE.md:6')), /\nthis line is not read: inside a fenced block that quotes markdown$/);
  assert.match(renderExplain(at(repo, 'CLAUDE.md:2')), /\n  \(a blank line\)\n\nnothing on this line reads as a path, a link, an import or a command\.$/);
});

test('--explain says when a file on disk resolves although git does not track it', () => {
  const repo = repoWith(FILES);
  writeFileSync(join(repo, 'docs/draft.md'), '# draft\n');
  assert.deepEqual(said(at(repo, 'CLAUDE.md:12')), ['docs/draft.md resolved not tracked by git, but present on this disk']);
});

test('a finding the checks reported and the run took back is held, with the reason', () => {
  const another = repoWith({ 'CLAUDE.md': '# app\n\nSee `vendor-x/a.ts`, `vendor-y/b.ts`, `vendor-z/c.ts` and `vendor-w/d.ts`.\n', 'src/a.ts': '' });
  assert.deepEqual(at(another, 'CLAUDE.md:3').events.map((e) => e.outcome), ['held', 'held', 'held', 'held']);
  assert.match(at(another, 'CLAUDE.md:3').events[0].reason, /^held back: most of what this file cites/);

  const ignored = repoWith({ 'CLAUDE.md': '# app\n\nSee `src/private.ts`.\n', 'src/a.ts': '', '.gitignore': 'src/private.ts\n' });
  assert.deepEqual(said(at(ignored, 'CLAUDE.md:3')), ['src/private.ts held .gitignore covers it']);

  const held = repoWith({ 'CLAUDE.md': '# app\n\nSee `src/old.ts`.\n', 'src/a.ts': '' });
  writeFileSync(join(held, '.prumo-baseline.json'), JSON.stringify(baselineOf(analyze({ repo: held, targets: resolveTargets(held, []) }))));
  const r = explain({ repo: held, targets: resolveTargets(held, []), at: 'CLAUDE.md:3', baseline: loadBaseline(held) });
  assert.deepEqual(said(r), ['src/old.ts held held in .prumo-baseline.json']);
});

test('--explain says a historical entry checks no path on its lines', () => {
  const repo = repoWith({ 'notes/phase-1-done/CLAUDE.md': '# done\n\nRemoved `src/legacy.ts`.\n', 'src/a.ts': '' });
  assert.deepEqual(at(repo, 'notes/phase-1-done/CLAUDE.md:3').events.map((e) => e.reason), ['a historical entry, whose paths and commands are not checked; its links are']);
});

test('--explain refuses a file that is not a context file, a line past the end, and anything but FILE:LINE', () => {
  const repo = repoWith(FILES);
  assert.throws(() => at(repo, 'docs/guide.md:1'), /docs\/guide\.md is not a context file of this run; name it to check it/);
  assert.throws(() => at(repo, 'CLAUDE.md:99'), /CLAUDE\.md has 13 lines, so there is no line 99/);
  assert.throws(() => at(repo, 'CLAUDE.md'), /--explain takes FILE:LINE/);
});

test('the CLI explains a line, exits 0, takes --format json, and refuses the options that write or limit the run', () => {
  const repo = repoWith(FILES);
  const plain = cli([repo, '--explain', 'CLAUDE.md:3']);
  assert.equal(plain.status, 0);
  assert.match(plain.out, /^prumo — explain CLAUDE\.md:3\n/);
  assert.match(plain.out, /^  src\/gone\.ts +reported +MISSING PATH$/m);
  assert.equal(JSON.parse(cli([repo, '--explain', 'CLAUDE.md:3', '--format', 'json']).out).command, 'explain');
  assert.match(cli([repo, '--explain', 'CLAUDE.md:3', '--fix']).err, /--fix does not go with --explain/);
  assert.equal(cli([repo, '--explain', 'CLAUDE.md:3', '--format', 'github']).status, 2);
  assert.match(cli([repo, '--explain']).err, /--explain needs FILE:LINE/);
  assert.match(cli(['drift', repo, '--explain', 'CLAUDE.md:3']).err, /--explain is not an option of "prumo drift"/);
});

test('a finding held back by the repository gate, or reported once as the link beside it, says so', () => {
  const files = Object.fromEntries(Array.from({ length: 14 }, (_, n) => [`notes/n${n}/CLAUDE.md`, `# n${n}\n\nSee \`gone${n}/a.ts\`.\n`]));
  const repo = repoWith({ ...files, 'src/a.ts': '' });
  assert.match(at(repo, 'notes/n0/CLAUDE.md:3').events[0].reason, /^held back: the context files, taken together, document another project$/);

  const twice = repoWith({ 'CLAUDE.md': '# app\n\nSee [`docs/gone.md`](docs/gone.md).\n', 'docs/a.md': '' });
  assert.deepEqual(said(at(twice, 'CLAUDE.md:3')), ['docs/gone.md held reported once, as the link on this line', 'docs/gone.md reported BROKEN LINK']);
});

test('a command held back as one of several package managers says so', () => {
  const repo = repoWith({
    'CLAUDE.md': '# app\n\n| npm | `npm run lint` |\n| pnpm | `pnpm lint` |\n',
    'package.json': JSON.stringify({ scripts: { build: 'x' } }),
  });
  assert.deepEqual(said(at(repo, 'CLAUDE.md:3')), ['npm run lint held the same script appears in this file under more than one package manager, so the commands are a list of alternatives']);
});
