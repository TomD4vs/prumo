import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { analyze, resolveTargets } from '../src/check.mjs';
import { tempDir, repoWith, checkFiles } from './support.mjs';

test('finds context files nested in subfolders', () => {
  const repo = repoWith({
    'AGENTS.md': '# root\n',
    'packages/api/CLAUDE.md': '# api\n',
    'packages/web/AGENTS.md': '# web\n',
  });
  const labels = resolveTargets(repo, []).map((t) => t.label).sort();
  assert.deepEqual(labels, ['AGENTS.md', 'packages/api/CLAUDE.md', 'packages/web/AGENTS.md']);
});

test('lists a note the index never references', () => {
  const dir = tempDir('prumo-notes-');
  writeFileSync(join(dir, 'MEMORY.md'), '- [Linked](linked.md)\n');
  writeFileSync(join(dir, 'linked.md'), 'body\n');
  writeFileSync(join(dir, 'forgotten.md'), 'body\n');

  const repo = repoWith({ 'CLAUDE.md': '# x\n' });
  const r = analyze({ repo, targets: resolveTargets(repo, [dir]) });

  assert.deepEqual(r.orphans, ['forgotten.md']);
});

test('finds an installed SKILL.md, ignores one at the root, and reports a renamed supporting file', () => {
  const skill = [
    '---', 'name: deploy', 'description: test', '---',
    '- [Setup](steps/setup.md)',
    '- [Rollout](steps/rollout.md)',
    '',
  ].join('\n');
  const repo = repoWith({
    'AGENTS.md': '# root\n',
    'SKILL.md': 'Each step lives in `steps/<name>.md`.\n',
    '.claude/skills/deploy/SKILL.md': skill,
    '.claude/skills/deploy/steps/setup.md': '# setup\n',
    '.claude/skills/deploy/steps/rollout-canary.md': '# rollout\n',
  });

  const labels = resolveTargets(repo, []).map((t) => t.label).sort();
  assert.deepEqual(labels, ['.claude/skills/deploy/SKILL.md', 'AGENTS.md']);

  const r = analyze({ repo, targets: resolveTargets(repo, []) });
  assert.equal(r.brokenLinks.length, 1);
  assert.equal(r.brokenLinks[0].file, '.claude/skills/deploy/SKILL.md');
  assert.ok(r.brokenLinks[0].cited.endsWith('steps/rollout.md'));
});

test('a context file vendored with a dependency is not a target', () => {
  const repo = repoWith({
    'AGENTS.md': '# root\n',
    'vendor/some/lib/AGENTS.md': 'Read `.github/copilot-instructions.md` first.\n',
    'node_modules/pkg/CLAUDE.md': 'See `src/gone.js`.\n',
    'packages/api/AGENTS.md': '# api\n',
  });
  assert.deepEqual(resolveTargets(repo, []).map((t) => t.label).sort(), ['AGENTS.md', 'packages/api/AGENTS.md']);
});

test('a target that does not exist is an error, never a silent fall back to auto-detection', () => {
  const repo = repoWith({
    'AGENTS.md': 'See `src/gone.py`.\n',
    'src/a.py': '',
  });
  assert.throws(() => resolveTargets(repo, ['no-such-file.md']), /target not found: no-such-file\.md/);
  assert.throws(() => resolveTargets(repo, ['AGENTS.md', 'no-such-file.md']), /target not found: no-such-file\.md/);
  assert.deepEqual(resolveTargets(repo, []).map((t) => t.label), ['AGENTS.md']);
});

test('a context file under a folder whose name has an accent is auto-detected', () => {
  const repo = repoWith({
    'AGENTS.md': '# raiz\n',
    'serviços/AGENTS.md': 'O upload passa por `src/app.php`.\n',
    'src/App.php': '',
  });
  const targets = resolveTargets(repo, []);
  assert.deepEqual(targets.map((t) => t.label).sort(), ['AGENTS.md', 'serviços/AGENTS.md']);
  const r = analyze({ repo, targets });
  assert.equal(r.caseMismatch.length, 1);
  assert.equal(r.caseMismatch[0].actual, 'src/App.php');
});

test('a skill installed under .claude/skills is read even when git does not track it', () => {
  const repo = repoWith({
    '.gitignore': '.claude/skills/\n',
    'CLAUDE.md': '# app\n',
    'src/Component.vue': '',
  });
  mkdirSync(join(repo, '.claude/skills/deploy/steps'), { recursive: true });
  writeFileSync(join(repo, '.claude/skills/deploy/SKILL.md'), '---\nname: deploy\ndescription: d\n---\nEdit `src/component.vue`, follow [setup](steps/setup.md), run `steps/run.sh`.\n');
  writeFileSync(join(repo, '.claude/skills/deploy/steps/setup.md'), '');
  writeFileSync(join(repo, '.claude/skills/deploy/steps/run.sh'), '');

  const targets = resolveTargets(repo, []);
  assert.deepEqual(targets.map((t) => t.label), ['CLAUDE.md', '.claude/skills/deploy/SKILL.md']);
  const r = analyze({ repo, targets });
  assert.equal(r.stats.untracked, 1);
  assert.deepEqual(r.caseMismatch.map((c) => [c.file, c.cited]), [['.claude/skills/deploy/SKILL.md', 'src/component.vue']]);
  assert.equal(r.missingPaths.length, 0, 'the files beside the skill are on disk');
  assert.equal(r.brokenLinks.length, 0);
});

test('a slash command under .claude/commands is a context file; an agent definition is not read unless named', () => {
  const r = checkFiles({
    'CLAUDE.md': '# app\n',
    '.claude/commands/deploy.md': 'Run `scripts/deploy.sh`, then read `docs/release-notes.md`.\n',
    '.claude/agents/reviewer.md': '---\nname: reviewer\n---\nCite a file with line numbers, as in `src/api/client.ts:40-55`.\n',
    'scripts/deploy.sh': '',
  });
  assert.equal(r.stats.targets, 2);
  assert.deepEqual(r.missingPaths.map((m) => [m.file, m.cited]), [['.claude/commands/deploy.md', 'docs/release-notes.md']]);
});

test('NOT IN INDEX belongs to a folder passed explicitly, not to auto-detected folders beside a root MEMORY.md', () => {
  const r = checkFiles({
    'MEMORY.md': '# index\n',
    'CLAUDE.md': '# app\n',
    '.claude/commands/deploy.md': 'Deploy.\n',
  });
  assert.deepEqual(r.orphans, []);
});
