import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkFiles } from './support.mjs';

test('a command naming a script or target nothing defines is reported, with the closest name', () => {
  const r = checkFiles({
    'AGENTS.md': [
      'Run `npm run test:unit` before pushing, then `npm run lint -- --fix` and `make deploy`.',
      'Frontend: `cd web && pnpm dev`, or `yarn build`, or `yarn eslint .`.',
      '',
      '```bash',
      'NODE_ENV=test npm run test:units && make build',
      'composer test',
      '```',
      '',
      '```json',
      '{ "scripts": { "x": "npm run nothing-here" } }',
      '```',
      '',
      'We no longer use `npm run coverage`.',
      '',
    ].join('\n'),
    'package.json': JSON.stringify({ scripts: { 'test:units': 'x', lint: 'x', build: 'x', dev: 'x' }, devDependencies: { eslint: '1' } }),
    'Makefile': 'build:\n\tnode build.js\n\ntest: build\n\tnode test.js\n',
    'composer.json': JSON.stringify({ scripts: { test: 'phpunit' } }),
  });
  assert.deepEqual(r.unknownCommands.map((c) => [c.line, c.cited, c.source, c.suggestion]), [
    [1, 'npm run test:unit', 'package.json', 'npm run test:units'],
    [1, 'make deploy', 'Makefile', null],
  ]);
});

test('a command is left alone where the repository has no file of that kind, or points elsewhere, or the Makefile builds its targets', () => {
  const none = checkFiles({
    'AGENTS.md': 'Run `npm run build` and `make all` and `composer test`.\n',
    'src/index.py': '',
  });
  assert.equal(none.unknownCommands.length, 0);
  const elsewhere = checkFiles({
    'AGENTS.md': 'Run `npm run build -w packages/api`, `make -C tools all`, `pnpm --dir cli test`, `yarn workspace api build` and `npm run start`.\n',
    'package.json': JSON.stringify({ scripts: { start: 'x' } }),
    'Makefile': 'TARGETS := a b\n$(TARGETS):\n\techo $@\n',
  });
  assert.equal(elsewhere.unknownCommands.length, 0);
});

test('the same script shown under several package managers is a list of alternatives, and an example name is not a path', () => {
  const r = checkFiles({
    'AGENTS.md': [
      'No project skills found. Add skills to any of `.claude/skills/` or `.agents/skills/`.',
      '',
      '',
      '',
      '| npm | `npm run test:coverage` | `npm run lint` |',
      '| pnpm | `pnpm test:coverage` | `pnpm lint` |',
      '| yarn | `yarn test:coverage` | `yarn lint` |',
      '',
      'Then run `npm run deploy:prod`. Add your plugin at `src/plugins/myplugin.ts` and a page at `my-app/pages/index.tsx`.',
      '',
    ].join('\n'),
    'package.json': JSON.stringify({ scripts: { build: 'x' } }),
    'src/index.ts': '',
  });
  assert.deepEqual(r.unknownCommands.map((c) => c.cited), ['npm run deploy:prod']);
  assert.equal(r.missingPaths.length, 0);
});

test('pnpm version is a builtin, a Chinese sentence that says the file was deleted is a negation, and emphasis glued after a path is not part of it', () => {
  const r = checkFiles({
    'CLAUDE.md': '# app\n\n- 已清理模块:\x60packages/tauri\x60（原疑似废弃，现已删除）\n- \x60ws/lsp.ts\x60 文件已移除。\n\nBoth files carry an \x60_Auto-synced via scripts/sync-spec-docs.mjs._\x60 line.\n',
    'AGENTS.md': '# agents\n\nBump with \x60pnpm version patch\x60 before \x60pnpm run release\x60. See \x60src/gone.ts\x60.\n',
    'package.json': '{"name":"x","scripts":{"build":"tsc"}}\n',
    'scripts/sync-spec-docs.mjs': '',
  });
  assert.deepEqual(r.unknownCommands.map((c) => c.cited), ['pnpm run release'], 'pnpm version is pnpm itself, and only the script nothing defines is reported');
  assert.deepEqual(r.missingPaths.map((o) => o.cited), ['src/gone.ts'], 'the lines that say deleted or removed in Chinese are quiet, and the path with markup glued on resolves');
});

test('composer scripts are read from composer.json, so a script it does not define is an unknown command', () => {
  const r = checkFiles({
    'CLAUDE.md': '# app\n\nRun `composer run lint` and `composer run deploy`.\n',
    'composer.json': JSON.stringify({ scripts: { lint: 'phpcs' } }),
  });
  assert.deepEqual(r.unknownCommands.map((c) => c.cited), ['composer run deploy']);
});

test('yarn and bun scripts are checked like npm ones, and a yarn binary nothing installs is reported', () => {
  const r = checkFiles({
    'AGENTS.md': 'Run `yarn biuld`, `yarn run tset`, `yarn install`, `bun run lnt` and `bun install`.\n',
    'package.json': JSON.stringify({ scripts: { build: 'x', test: 'x', lint: 'x' } }),
  });
  assert.deepEqual(r.unknownCommands.map((c) => [c.cited, c.suggestion]), [
    ['yarn biuld', 'yarn build'],
    ['yarn run tset', 'yarn run test'],
    ['bun run lnt', 'bun run lint'],
  ]);
});
