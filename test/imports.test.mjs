import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { analyze, resolveTargets } from '../src/check.mjs';
import { applyFixes, renameFixes } from '../src/fix.mjs';
import { renderText, renderGithub } from '../src/report.mjs';
import { checkFiles, committedRepo, git } from './support.mjs';

const imports = (r) => r.brokenLinks.filter((l) => l.kind === 'import').map((l) => `${l.file}:${l.line} @${l.cited}`);

test('an @ import in a CLAUDE.md that reaches no file is a broken link, and one that resolves is quiet', () => {
  const r = checkFiles({
    'CLAUDE.md': '# app\n\n@AGENTS.md\n\nSee @docs/guide.md for the layout.\n\n@docs/USAGE.md\n',
    'AGENTS.md': '# agents\n',
    'docs/guide.md': '# guide\n',
    'USAGE.md': '# usage\n',
  });
  assert.deepEqual(imports(r), ['CLAUDE.md:7 @docs/USAGE.md']);
  assert.equal(r.brokenLinks[0].suggestion, 'USAGE.md', 'the file the import most likely meant, written from the note');
  assert.equal(r.schemaVersion, 10);
});

test('an import resolves from the folder of the note that holds it, as Claude Code reads it', () => {
  const r = checkFiles({
    'CLAUDE.md': '# root\n',
    'packages/api/CLAUDE.md': '# api\n\n@docs/api.md\n\n@docs/root-only.md\n\nAn absolute path is no import of this repository: @/docs/elsewhere.md.\n',
    'packages/api/docs/api.md': '# api docs\n',
    'docs/root-only.md': '# root docs\n',
  });
  assert.deepEqual(imports(r), ['packages/api/CLAUDE.md:5 @docs/root-only.md']);
});

test('an import with the wrong letter case is a case mismatch, and --fix rewrites it with its @', () => {
  const repo = committedRepo({ 'CLAUDE.md': '# app\n\n@docs/Guide.md and @docs/Guide.md, again.\n', 'docs/guide.md': '# guide\n' });
  const targets = resolveTargets(repo, []);
  const r = analyze({ repo, targets });
  assert.deepEqual(r.caseMismatch.map((c) => `${c.kind} ${c.cited} ${c.actual}`), ['import docs/Guide.md docs/guide.md']);
  assert.match(renderText(r), /^  CLAUDE\.md:3  @docs\/Guide\.md   ->  @docs\/guide\.md$/m);
  assert.equal(renderGithub(r), '::error file=CLAUDE.md,line=3::Case mismatch: @docs/Guide.md should be @docs/guide.md');
  const fixed = applyFixes(r.caseMismatch, targets);
  assert.equal(fixed.paths, 1);
  assert.equal(readFileSync(join(repo, 'CLAUDE.md'), 'utf8'), '# app\n\n@docs/guide.md and @docs/guide.md, again.\n');
});

test('an import of a file git renamed says where it went, and --fix follows the rename from beside the note', () => {
  const repo = committedRepo({ 'CLAUDE.md': '# root\n', 'packages/api/CLAUDE.md': '# api\n\n@docs/old.md\n', 'packages/api/docs/old.md': '# the api, with enough text for git to see a rename\n' });
  git(repo, 'mv packages/api/docs/old.md packages/api/docs/new.md');
  git(repo, 'commit -qm moved');
  const targets = resolveTargets(repo, []);
  const r = analyze({ repo, targets });
  const [link] = r.brokenLinks;
  assert.equal(link.kind, 'import');
  assert.equal(link.history.event, 'renamed');
  assert.equal(link.history.to, 'packages/api/docs/new.md');
  const changes = renameFixes(r);
  assert.deepEqual(changes.map((c) => `${c.kind} ${c.cited} ${c.actual}`), ['import docs/old.md docs/new.md']);
  applyFixes(changes, targets);
  assert.equal(readFileSync(join(repo, 'packages/api/CLAUDE.md'), 'utf8'), '# api\n\n@docs/new.md\n');
});

test('what only looks like an import is left alone', () => {
  const r = checkFiles({
    'CLAUDE.md': [
      '# app',
      '',
      'Icons come from @phosphor-icons/react, prompts from @clack/prompts.',
      'Mail admin@example.com or ping @maintainer, or see example.com.',
      'Ask @support.com about it.',
      'Inline `@docs/missing.md` is quoted, and so is `run it with @docs/missing.md` and this block:',
      '',
      '```',
      '@docs/also-missing.md',
      '```',
      '',
      'Your own notes: @~/.claude/notes.md and @/etc/notes.md and @/docs/missing.md and @../outside.md.',
      'Per machine: @CLAUDE.local.md and @.claude/settings.local.json.',
      'Every rule: @.claude/rules/*.md.',
      'Ignored: @docs/private.md.',
      'Japanese comma: @docs/guide.md、仕様 → docs.',
    ].join('\n') + '\n',
    'AGENTS.md': 'In an AGENTS.md, @docs/missing.md is plain text.\n',
    '.gitignore': 'docs/private.md\n',
    'docs/guide.md': '# guide\n',
    '.claude/rules/a.md': '# a\n',
  });
  assert.deepEqual(imports(r), []);
  assert.deepEqual(r.caseMismatch, []);
  assert.deepEqual(r.elsewhere, [], 'quiet because nothing was read as an import, not because the file was held back');
});

test('an import that climbs out of the repository from a nested note is not checked, and .gitignore still applies to the rest', () => {
  const r = checkFiles({
    'CLAUDE.md': '# root\n\nSee `docs/private.md` for the keys.\n',
    'packages/api/CLAUDE.md': '# api\n\n@../../../outside.md\n',
    '.gitignore': 'docs/private.md\n',
    'docs/a.md': '',
  });
  assert.deepEqual(imports(r), []);
  assert.deepEqual(r.missingPaths, []);
  assert.equal(r.stats.gitignored, 1);
});

test('the text and GitHub reports show an import as the note wrote it, with its @', () => {
  const r = checkFiles({ 'CLAUDE.md': '# app\n\n@docs/missing.md\n', 'docs/a.md': '# a\n' });
  assert.match(renderText(r), /^BROKEN LINK  \(1\)/m);
  assert.match(renderText(r), /^  CLAUDE\.md:3  @docs\/missing\.md$/m);
  assert.equal(renderGithub(r), '::warning file=CLAUDE.md,line=3::Broken link: @docs/missing.md');
});
