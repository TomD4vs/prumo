import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyze, resolveTargets } from '../src/check.mjs';
import { checkFiles, repoWith } from './support.mjs';

test('flags a path whose case disagrees with the git index', () => {
  const r = checkFiles({
    'CLAUDE.md': 'The layout lives in `resources/js/Layouts/App.vue`.\nAlso `layouts/App.vue`.\n',
    'resources/js/Layouts/App.vue': '',
  });
  assert.equal(r.caseMismatch.length, 1);
  assert.equal(r.caseMismatch[0].cited, 'layouts/App.vue');
  assert.equal(r.caseMismatch[0].actual, 'resources/js/Layouts/App.vue');
});

test('stays quiet when the case is right', () => {
  const r = checkFiles({
    'CLAUDE.md': 'The layout lives in `resources/js/Layouts/App.vue`.\n',
    'resources/js/Layouts/App.vue': '',
  });
  assert.equal(r.caseMismatch.length, 0);
  assert.equal(r.missingPaths.length, 0);
});

test('resolves an @/ alias and an omitted extension', () => {
  const r = checkFiles({
    'CLAUDE.md': 'Uses `@/utils/foco.js` and the trait `tests/Concerns/ReadsPdf`.\n',
    'resources/js/utils/foco.js': '',
    'tests/Concerns/ReadsPdf.php': '',
  });
  assert.equal(r.missingPaths.length, 0);
  assert.equal(r.caseMismatch.length, 0);
});

test('reports a path that is simply gone', () => {
  const r = checkFiles({
    'CLAUDE.md': 'Configure it in `config/database.php` before running.\n',
    'src/a.js': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, 'config/database.php');
  assert.equal(r.missingPaths[0].line, 1);
});

test('reports the file and line of every finding', () => {
  const r = checkFiles({
    'CLAUDE.md': '# Title\n\nSee `config/missing.php` here.\n',
    'src/a.js': '',
  });
  assert.equal(r.missingPaths[0].file, 'CLAUDE.md');
  assert.equal(r.missingPaths[0].line, 3);
  assert.match(r.missingPaths[0].excerpt, /config\/missing\.php/);
});

test('a path inside a command is checked; a move or delete command is not', () => {
  const r = checkFiles({
    'CLAUDE.md': [
      'Seed with `python scripts/seed_db.py --force`.',
      'Then `node scripts/build.js --out=dist/app.js`.',
      'Old: `git mv src/old.py src/new.py` and `rm config/legacy.php`.',
      'Deploy: `./scripts/deploy.sh --env prod`.',
      'Logo: `public/img/LOGO WIDE.png` (a name with spaces is not a command).',
      '',
    ].join('\n'),
    'scripts/build.js': '',
    'scripts/deploy.sh': '',
    'src/new.py': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['scripts/seed_db.py']);
  assert.equal(r.caseMismatch.length, 0);
});

test('monorepo roots such as backend/ and frontend/ take part in the case check', () => {
  const r = checkFiles({
    'CLAUDE.md': 'Models in `backend/app/Models/`, views in `frontend/src/Components/`.\n',
    'backend/app/models/ticket.py': '',
    'frontend/src/components/List.tsx': '',
  });
  assert.deepEqual(r.caseMismatch.map((c) => [c.cited, c.actual]), [
    ['backend/app/Models', 'backend/app/models'],
    ['frontend/src/Components', 'frontend/src/components'],
  ]);
});

test('a path whose name has an accent is checked against the index like any other', () => {
  const r = checkFiles({
    'CLAUDE.md': 'O fluxo esta em `docs/ação.md`.\n\nA rotina esta em [fluxo](docs/AÇÃO.md).\n',
    'docs/Ação.md': 'a\n',
  });
  assert.deepEqual(r.caseMismatch.map((c) => c.cited), ['docs/ação.md', 'docs/AÇÃO.md']);
  assert.deepEqual([...new Set(r.caseMismatch.map((c) => c.actual))], ['docs/Ação.md']);
  assert.equal(r.missingPaths.length, 0);
});

test('an @/ alias resolves against the repository root, not only against src and app', () => {
  const r = checkFiles({
    'CLAUDE.md': 'The toast types live in `@/app/types/toast.ts`.\n',
    'app/types/toast.ts': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('a scoped package specifier is an import, not a path in this repository', () => {
  const r = checkFiles({
    'CLAUDE.md': 'It exports its CSS separately (`@acme/viewer/style.css`).\n',
    'src/index.ts': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('a TypeScript project cites the .js the bundler emits, and git holds the .ts', () => {
  const r = checkFiles({
    'AGENTS.md': 'Use the logger from `./logger.js`, and the model from `src/model/style.js`.\n',
    'logger.ts': '',
    'src/model/style.ts': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('a .js that no .ts stands behind is still reported', () => {
  const r = checkFiles({
    'AGENTS.md': 'Use the helper in `src/gone.js`.\n',
    'src/index.ts': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, 'src/gone.js');
});

test('a note that spells the project name in front of a real path still resolves', () => {
  const r = checkFiles({
    'AGENTS.md': 'The proxy lives in `myapp/app/api/proxy/route.ts`.\n',
    'app/api/proxy/route.ts': '',
  });
  assert.equal(r.missingPaths.length, 0);
  assert.equal(r.caseMismatch.length, 0);
});

test('a prefix that would leave a bare root filename is still reported', () => {
  const r = checkFiles({
    'AGENTS.md': 'See `evals/README.md` for the evaluation framework.\n',
    'README.md': '',
    'src/index.ts': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, 'evals/README.md');
});

test('a prose path written with backslashes is checked like any other', () => {
  const r = checkFiles({
    'AGENTS.md': 'The layout is `src\\layouts\\App.vue`.\n',
    'src/Layouts/App.vue': '',
  });
  assert.equal(r.caseMismatch.length, 1);
  assert.equal(r.caseMismatch[0].actual, 'src/Layouts/App.vue');
});

test('a line number, a GitHub anchor or a ::symbol after a path points inside the file, not at another one', () => {
  const r = checkFiles({
    'CLAUDE.md': 'See `src/index.ts:42`, `src/index.ts#L10-L20`, `src/index.ts::main` and `src/gone.ts::helper`.\n',
    'src/index.ts': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['src/gone.ts']);
});

test('a path cited in a nested note is the file beside that note before any other with the same ending', () => {
  const repo = repoWith({
    'agents/auth/AGENTS.md': '# auth\n\nEntry point: `src/index.ts`.\n',
    'agents/auth/src/index.ts': '',
    'agents/db/AGENTS.md': '# db\n\nEntry point: `src/index.ts`.\n',
    'agents/db/src/index.ts': '',
    'agents/web/AGENTS.md': '# web\n\nEntry point: `src/index.ts`.\n',
  });
  const r = analyze({ repo, targets: resolveTargets(repo, []), collect: true });
  assert.deepEqual(r.citations.map((c) => `${c.file} ${c.path}`).sort(), [
    'agents/auth/AGENTS.md agents/auth/src/index.ts',
    'agents/db/AGENTS.md agents/db/src/index.ts',
    'agents/web/AGENTS.md agents/auth/src/index.ts',
  ]);
  assert.equal(r.missingPaths.length, 0, 'a note with no file beside it still resolves by how the path ends, as before');
});

test('a bare name on a line never hides the same file cited with ./ on that line', () => {
  const r = checkFiles({ 'CLAUDE.md': '# app\n\nRead `README.md`, that is `./README.md`, and `./docs/GONE.md`.\n', 'README.md': '# readme\n', 'docs/a.md': '' });
  assert.equal(r.stats.cited, 2, 'README.md and docs/GONE.md are both cited');
  const missing = checkFiles({ 'CLAUDE.md': '# app\n\nRead `gone.md`, that is `./gone.md` beside this note.\n', 'docs/a.md': '' });
  assert.deepEqual(missing.missingPaths.map((m) => m.cited), ['gone.md'], 'and a missing one is still reported');
});
