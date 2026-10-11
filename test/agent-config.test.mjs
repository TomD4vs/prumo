import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkFiles } from './support.mjs';

test('a rule glob matching no file, a skill without a description, and a config naming a missing script are config issues', () => {
  const files = {
    'CLAUDE.md': '# app\n',
    '.cursor/rules/backend.mdc': '---\ndescription: backend\nglobs: backend/**, "*.py"\n---\nRules.\n',
    '.cursor/rules/gone.mdc': '---\nglobs: legacy/**/*.rb\n---\nRules.\n',
    '.cursor/rules/always.mdc': '---\nglobs: nowhere/**\nalwaysApply: true\n---\nRules.\n',
    '.github/instructions/py.instructions.md': '---\napplyTo: "**/*.cs"\n---\nRules.\n',
    '.claude/skills/deploy/SKILL.md': '---\nname: deployer\n---\nSteps.\n',
    '.claude/skills/release/SKILL.md': '---\nname: release\ndescription: cuts a release\n---\nSteps.\n',
    '.claude/skills/bare/SKILL.md': '# no front matter\n',
    '.mcp.json': JSON.stringify({ mcpServers: { local: { command: 'node', args: ['scripts/server.mjs'] }, npmOne: { command: 'npx', args: ['-y', 'some-package'] }, here: { command: 'node', args: ['scripts/live.mjs'] } } }, null, 2),
    '.claude/settings.json': JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'bash $CLAUDE_PROJECT_DIR/scripts/hook.sh' }] }] } }, null, 2),
    'backend/app.py': '',
    'scripts/live.mjs': '',
  };
  const r = checkFiles(files);
  const seen = r.configIssues.map((c) => `${c.file} ${c.kind} ${c.cited}`).sort();
  assert.deepEqual(seen, [
    '.claude/settings.json config-path scripts/hook.sh',
    '.claude/skills/bare/SKILL.md skill-description front matter',
    '.claude/skills/deploy/SKILL.md skill-description description',
    '.cursor/rules/gone.mdc glob legacy/**/*.rb',
    '.github/instructions/py.instructions.md glob **/*.cs',
    '.mcp.json config-path scripts/server.mjs',
  ]);
  assert.equal(r.stats.configs, 2);
  const braces = checkFiles({
    'CLAUDE.md': '# app\n',
    '.cursor/rules/ts.mdc': '---\nglobs:\n  - "src/**/*.{ts,tsx}"\n  - "**/*chart*.{py,r}"\n---\nRules.\n',
    '.claude/skills/long/SKILL.md': '---\nname: long\ndescription:\n  Spread over two lines,\n  as YAML allows.\n---\nSteps.\n',
    'src/app.tsx': '',
  });
  assert.deepEqual(braces.configIssues, []);
  const dead = checkFiles({
    'CLAUDE.md': '# app\n',
    '.cursor/rules/charts.mdc': '---\nglobs: "**/*chart*.{py,r}"\n---\nRules.\n',
    '.cursor/rules/many.mdc': '---\nglobs: a/**, b/**, c/**, d/**\n---\nRules.\n',
    '.cursor/rules/live.mdc': '---\nglobs: src/**\n---\nRules.\n',
    '.cursor/rules/ext.mdc': '---\nglobs: .tsx\n---\nRules.\n',
    '.cursor/rules/rb.mdc': '---\nglobs: .rb\n---\nRules.\n',
    'src/app.tsx': '',
  });
  assert.deepEqual(dead.configIssues.map((c) => `${c.cited}: ${c.message}`), [
    '**/*chart*.{py,r}: matches no file in the repository, so the rule never applies',
    'a/**, b/**, c/** and 1 more: match no file in the repository, so the rule never applies',
    '.rb: matches no file in the repository, so the rule never applies',
  ]);
  const catalogue = checkFiles({
    'CLAUDE.md': '# rules\n',
    '.cursor/rules/a.mdc': '---\nglobs: src/**/*.ts\n---\nA.\n',
    '.cursor/rules/b.mdc': '---\nglobs: app/**/*.py\n---\nB.\n',
    '.cursor/rules/c.mdc': '---\nglobs: lib/**/*.go, cmd/**/*.go\n---\nC.\n',
    '.cursor/rules/d.mdc': '---\nglobs:\n  - "**/*.rs"\n---\nD.\n',
    '.cursor/rules/always.mdc': '---\nglobs: nowhere/**\nalwaysApply: true\n---\nE.\n',
  });
  assert.equal(catalogue.configIssues.length, 0);
  assert.deepEqual(catalogue.elsewhere, [{ file: '.cursor/rules', cited: 4, absent: 4, unit: 'rules' }]);
  const named = checkFiles(files, ['CLAUDE.md']);
  assert.equal(named.configIssues.length, 0);
  assert.equal(named.stats.configs, 0);
  const windows = checkFiles({
    'CLAUDE.md': '# app\r\n',
    '.claude/skills/release/SKILL.md': '---\r\nname: release\r\ndescription: cuts a release\r\n---\r\nSteps.\r\n',
    '.cursor/rules/backend.mdc': '---\r\nglobs: backend/**\r\n---\r\nRules.\r\n',
    'backend/app.py': '',
  });
  assert.equal(windows.configIssues.length, 0);
  const bom = checkFiles({
    'CLAUDE.md': '# app\n',
    '.claude/skills/release/SKILL.md': '\uFEFF---\nname: release\ndescription: cuts a release\n---\nSteps.\n',
    '.cursor/rules/backend.mdc': '\uFEFF---\nglobs: backend/**\n---\nRules.\n',
    '.mcp.json': '\uFEFF{"mcpServers":{"gone":{"command":"node","args":["scripts/server.mjs"]}}}\n',
    'backend/app.py': '',
  });
  assert.deepEqual(bom.configIssues.map((c) => `${c.kind} ${c.cited}`), ['config-path scripts/server.mjs']);
  const schema = checkFiles({
    'CLAUDE.md': '# app\n',
    'tools/skills/custom/SKILL.md': '---\nmetadata:\n  name: custom\n  class: toolbox\n---\nSteps.\n',
    'tools/skills/std/SKILL.md': '---\nname: std\n---\nSteps.\n',
    '.agents/skills/host/SKILL.md': '---\ntitle: host\n---\nSteps.\n',
  });
  assert.deepEqual(schema.configIssues.map((c) => c.file).sort(), ['.agents/skills/host/SKILL.md', 'tools/skills/std/SKILL.md']);
});

test('a rule glob too long to become a regular expression matches nothing, and the run goes on', () => {
  const r = checkFiles({
    'CLAUDE.md': 'See `src/gone.ts`.\n',
    '.cursor/rules/huge.mdc': `---\nglobs: ${'{a,'.repeat(20000)}\n---\nBody.\n`,
    'src/a.ts': '',
  });
  assert.deepEqual(r.configIssues.map((c) => `${c.file} ${c.kind}`), ['.cursor/rules/huge.mdc glob']);
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['src/gone.ts'], 'the other files are still checked');
});
