import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyze, resolveTargets, loadConfig, DEFAULT_TARGETS, DEFAULT_DIRS, NESTED, SCHEMA_VERSION } from '../src/check.mjs';
import { applyCaseFixes } from '../src/fix.mjs';

const made = [];

/** Builds a throwaway git repository whose index holds exactly the given files. */
function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'prumo-test-'));
  made.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content ?? '');
  }
  execSync('git init -q', { cwd: dir, stdio: 'ignore' });
  execSync('git add -A', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function run(files, explicit = []) {
  const repo = repoWith(files);
  return analyze({ repo, targets: resolveTargets(repo, explicit) });
}

process.on('exit', () => {
  for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
});

test('flags a path whose case disagrees with the git index', () => {
  const r = run({
    'CLAUDE.md': 'The layout lives in `resources/js/Layouts/App.vue`.\nAlso `layouts/App.vue`.\n',
    'resources/js/Layouts/App.vue': '',
  });
  assert.equal(r.caseMismatch.length, 1);
  assert.equal(r.caseMismatch[0].cited, 'layouts/App.vue');
  assert.equal(r.caseMismatch[0].actual, 'resources/js/Layouts/App.vue');
});

test('stays quiet when the case is right', () => {
  const r = run({
    'CLAUDE.md': 'The layout lives in `resources/js/Layouts/App.vue`.\n',
    'resources/js/Layouts/App.vue': '',
  });
  assert.equal(r.caseMismatch.length, 0);
  assert.equal(r.missingPaths.length, 0);
});

test('finds context files nested in subfolders', () => {
  const repo = repoWith({
    'AGENTS.md': '# root\n',
    'packages/api/CLAUDE.md': '# api\n',
    'packages/web/AGENTS.md': '# web\n',
  });
  const labels = resolveTargets(repo, []).map((t) => t.label).sort();
  assert.deepEqual(labels, ['AGENTS.md', 'packages/api/CLAUDE.md', 'packages/web/AGENTS.md']);
});

test('suggests the destination when a naming convention drifted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prumo-notes-'));
  made.push(dir);
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
  const dir = mkdtempSync(join(tmpdir(), 'prumo-notes-'));
  made.push(dir);
  writeFileSync(join(dir, 'a.md'), 'See [[nothing-like-this]].\n');

  const repo = repoWith({ 'CLAUDE.md': '# x\n' });
  const r = analyze({ repo, targets: resolveTargets(repo, [dir]) });

  assert.equal(r.brokenLinks.length, 1);
  assert.equal(r.brokenLinks[0].suggestion, null);
});

test('checks markdown links, and accepts the ones that resolve', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prumo-notes-'));
  made.push(dir);
  writeFileSync(join(dir, 'there.md'), 'body\n');
  writeFileSync(join(dir, 'a.md'), 'Good [x](there.md), bad [y](gone.md).\n');

  const repo = repoWith({ 'CLAUDE.md': '# x\n' });
  const r = analyze({ repo, targets: resolveTargets(repo, [dir]) });

  assert.equal(r.brokenLinks.length, 1);
  assert.equal(r.brokenLinks[0].cited, 'gone.md');
});

test('does not flag a path cited to say it is gone', () => {
  const r = run({
    'CLAUDE.md': 'The project does not publish `config/dompdf.php`.\n',
    'src/a.js': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('exempts a historical entry from path checks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prumo-notes-'));
  made.push(dir);
  writeFileSync(join(dir, 'phase-2-complete.md'), 'Shipped `app/Gone.php` and `app/Other.php`.\n');

  const repo = repoWith({ 'CLAUDE.md': '# x\n' });
  const r = analyze({ repo, targets: resolveTargets(repo, [dir]) });

  assert.equal(r.missingPaths.length, 0);
  assert.equal(r.stats.historical, 1);
});

test('ignores build artifacts that live outside git', () => {
  const r = run({ 'CLAUDE.md': 'Assets go to `public/build/manifest.json` via `.vite/x.json`.\n' });
  assert.equal(r.missingPaths.length, 0);
});

test('resolves an @/ alias and an omitted extension', () => {
  const r = run({
    'CLAUDE.md': 'Uses `@/utils/foco.js` and the trait `tests/Concerns/ReadsPdf`.\n',
    'resources/js/utils/foco.js': '',
    'tests/Concerns/ReadsPdf.php': '',
  });
  assert.equal(r.missingPaths.length, 0);
  assert.equal(r.caseMismatch.length, 0);
});

test('reports a path that is simply gone', () => {
  const r = run({
    'CLAUDE.md': 'Configure it in `config/database.php` before running.\n',
    'src/a.js': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, 'config/database.php');
  assert.equal(r.missingPaths[0].line, 1);
});

test('lists a note the index never references', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prumo-notes-'));
  made.push(dir);
  writeFileSync(join(dir, 'MEMORY.md'), '- [Linked](linked.md)\n');
  writeFileSync(join(dir, 'linked.md'), 'body\n');
  writeFileSync(join(dir, 'forgotten.md'), 'body\n');

  const repo = repoWith({ 'CLAUDE.md': '# x\n' });
  const r = analyze({ repo, targets: resolveTargets(repo, [dir]) });

  assert.deepEqual(r.orphans, ['forgotten.md']);
});

test('throws a clear error outside a git repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prumo-nogit-'));
  made.push(dir);
  writeFileSync(join(dir, 'CLAUDE.md'), '# x\n');
  assert.throws(
    () => analyze({ repo: dir, targets: resolveTargets(dir, []) }),
    /not a git repository/
  );
});

test('reports the file and line of every finding', () => {
  const r = run({
    'CLAUDE.md': '# Title\n\nSee `config/missing.php` here.\n',
    'src/a.js': '',
  });
  assert.equal(r.missingPaths[0].file, 'CLAUDE.md');
  assert.equal(r.missingPaths[0].line, 3);
  assert.match(r.missingPaths[0].excerpt, /config\/missing\.php/);
});

test('config: ignore silences a matching path', () => {
  const r = run({
    'CLAUDE.md': 'See `config/database.php` and `config/other.php`.\n',
    '.prumorc.json': JSON.stringify({ ignore: ['config/database.php'] }),
    'src/a.js': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, 'config/other.php');
});

test('config: a glob in ignore silences a whole folder', () => {
  const r = run({
    'CLAUDE.md': 'Old `docs/legacy/a.php`, `docs/legacy/deep/b.php`, new `docs/live.php`.\n',
    '.prumorc.json': JSON.stringify({ ignore: ['docs/legacy/**'] }),
    'src/a.js': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['docs/live.php']);
});

test('config: exclude drops a context file from the run', () => {
  const r = run({
    'CLAUDE.md': 'See `config/gone.php`.\n',
    'AGENTS.md': 'Also `config/gone-too.php`.\n',
    '.prumorc.json': JSON.stringify({ exclude: ['AGENTS.md'] }),
    'src/a.js': '',
  });
  assert.equal(r.stats.targets, 1, 'the header must count only what was actually checked');
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['config/gone.php']);
});

test('config: invalid JSON fails loudly instead of being ignored', () => {
  const repo = repoWith({ 'CLAUDE.md': '# x\n', '.prumorc.json': '{ not json' });
  assert.throws(() => loadConfig(repo), /not valid JSON/);
});

test('inline marker suppresses its own line and the next one', () => {
  const r = run({
    'CLAUDE.md': [
      'A `config/one.php` <!-- prumo-ignore -->',
      '<!-- prumo-ignore-next-line -->',
      'B `config/two.php`',
      'C `config/three.php`',
    ].join('\n'),
    'src/a.js': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['config/three.php']);
  assert.equal(r.stats.suppressed, 2);
});

test('a file marker suppresses the whole file', () => {
  const r = run({
    'CLAUDE.md': '<!-- prumo-ignore-file -->\nSee `config/gone.php`.\n',
    'src/a.js': '',
  });
  assert.equal(r.missingPaths.length, 0);
  assert.equal(r.stats.suppressed, 1);
});

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

test('a link inside backticks is a quotation, not a reference', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prumo-notes-'));
  made.push(dir);
  writeFileSync(join(dir, 'a.md'), [
    'Write it as `[[some-example]]` when you mean to quote it.',
    'A real one: [[also-missing]].',
    'And `[quoted](nowhere.md)` versus [live](nowhere.md).',
  ].join('\n'));

  const repo = repoWith({ 'CLAUDE.md': '# x\n' });
  const r = analyze({ repo, targets: resolveTargets(repo, [dir]) });

  assert.deepEqual(r.brokenLinks.map((l) => l.cited).sort(), ['also-missing', 'nowhere.md']);
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

test('a wikilink resolves against any markdown file git tracks, and suggests from it', () => {
  const r = run({
    'CLAUDE.md': 'See [[deploy_checklist]], [[deploy-checklist]] and [[old-architecture]].\n',
    'deploy_checklist.md': 'body\n',
  });
  assert.deepEqual(r.brokenLinks.map((l) => l.cited).sort(), ['deploy-checklist', 'old-architecture']);
  assert.equal(r.brokenLinks.find((l) => l.cited === 'deploy-checklist').suggestion, 'deploy_checklist');
  assert.equal(r.brokenLinks.find((l) => l.cited === 'old-architecture').suggestion, null);
});

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'prumo.mjs');

test('--version reports the version in package.json', () => {
  const expected = JSON.parse(readFileSync(join(dirname(BIN), '..', 'package.json'), 'utf8')).version;
  const out = execSync('node ' + JSON.stringify(BIN) + ' --version').toString().trim();
  assert.equal(out, expected);
});

test('outside a git repository the CLI says so and exits 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prumo-nogit-'));
  made.push(dir);
  let status = 0;
  let stderr = '';
  try {
    execSync('node ' + JSON.stringify(BIN) + ' .', { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    status = e.status;
    stderr = e.stderr.toString();
  }
  assert.equal(status, 2);
  assert.match(stderr, /not a git repository/);
});

test('config: a folder named without wildcards covers everything under it', () => {
  const r = run({
    'CLAUDE.md': 'Build in `public/dist/app.js` and `coverage-html/index.html`, keep `public/index.php`.\n',
    '.prumorc.json': JSON.stringify({ transient: ['public/dist'], ignore: ['coverage-html'] }),
    'src/a.js': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['public/index.php']);
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

test('a wikilink and a markdown link are told apart', () => {
  const r = run({ 'CLAUDE.md': 'See [[missing-note]] and [guide](docs/missing.md).\n' });
  assert.deepEqual(r.brokenLinks.map((l) => [l.kind, l.cited]), [['wikilink', 'missing-note'], ['link', 'docs/missing.md']]);
});

test('a path inside a command is checked; a move or delete command is not', () => {
  const r = run({
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
  const r = run({
    'CLAUDE.md': 'Models in `backend/app/Models/`, views in `frontend/src/Components/`.\n',
    'backend/app/models/ticket.py': '',
    'frontend/src/components/List.tsx': '',
  });
  assert.deepEqual(r.caseMismatch.map((c) => [c.cited, c.actual]), [
    ['backend/app/Models', 'backend/app/models'],
    ['frontend/src/Components', 'frontend/src/components'],
  ]);
});

test('the text report names the file and line of a broken link', () => {
  const repo = repoWith({ 'CLAUDE.md': '# x\n\nSee [[gone-note]] and [g](docs/gone.md).\n' });
  execSync('git -c user.email=t@t -c user.name=t commit -qm x', { cwd: repo, stdio: 'ignore' });
  let out = '';
  try { execSync('node ' + JSON.stringify(BIN) + ' ' + JSON.stringify(repo), { stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { out = e.stdout.toString(); assert.equal(e.status, 1); }
  assert.match(out, /^  CLAUDE\.md:3  \[\[gone-note\]\]$/m);
  assert.match(out, /^  CLAUDE\.md:3  docs\/gone\.md$/m);
  assert.match(out, /, 1 file in the git index$/m);
});

test('a path that .gitignore covers is exempt and counted, not reported', () => {
  const r = run({
    '.gitignore': '/.claude\ndocs/guide.md\nsecurity/\n',
    'CLAUDE.md': [
      'Run `node .claude/skills/run/driver.mjs smoke`.',
      'Read [the guide](docs/guide.md) and `security/findings.json`.',
      'Still cited: `config/gone.php`.',
      '',
    ].join('\n'),
    'docs/index.md': '# docs\n',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['config/gone.php']);
  assert.equal(r.brokenLinks.length, 0);
  assert.equal(r.stats.gitignored, 3);
});

test('a markdown link that starts with a slash resolves from the repository root', () => {
  const r = run({
    'AGENTS.md': '# root\n',
    '.agents/skills/write/SKILL.md': '---\nname: w\ndescription: d\n---\nFollow [the rules](/AGENTS.md) and [old](/docs/gone.md).\n',
  });
  assert.deepEqual(r.brokenLinks.map((l) => l.cited), ['/docs/gone.md']);
});

test('an empty git index is an error, not a wall of missing paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prumo-empty-'));
  made.push(dir);
  writeFileSync(join(dir, 'CLAUDE.md'), 'See `src/app.js`.\n');
  execSync('git init -q', { cwd: dir, stdio: 'ignore' });
  assert.throws(() => analyze({ repo: dir, targets: resolveTargets(dir, []) }), /git index is empty/);
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

test('a target named in .prumorc.json that does not exist stops the CLI with exit 2', () => {
  const repo = repoWith({
    'AGENTS.md': '# root\n',
    '.prumorc.json': JSON.stringify({ targets: ['docs/no-such-file.md'] }),
  });
  let status = 0;
  let stderr = '';
  try {
    execSync('node ' + JSON.stringify(BIN) + ' ' + JSON.stringify(repo), { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    status = e.status;
    stderr = e.stderr.toString();
  }
  assert.equal(status, 2);
  assert.match(stderr, /^prumo: target not found: docs\/no-such-file\.md/m);
});

test('a path whose name has an accent is checked against the index like any other', () => {
  const r = run({
    'CLAUDE.md': 'O fluxo esta em `docs/ação.md`.\n\nA rotina esta em [fluxo](docs/AÇÃO.md).\n',
    'docs/Ação.md': 'a\n',
  });
  assert.deepEqual(r.caseMismatch.map((c) => c.cited), ['docs/ação.md', 'docs/AÇÃO.md']);
  assert.deepEqual([...new Set(r.caseMismatch.map((c) => c.actual))], ['docs/Ação.md']);
  assert.equal(r.missingPaths.length, 0);
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

test('path/to/ is how an example spells its argument, not a file', () => {
  const r = run({
    'AGENTS.md': 'Run one test with `npm test -- path/to/test.js`.\n\nThe real one is `tests/unit/date.test.js`.\n',
    'tests/unit/date.test.js': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), []);
});

test('an extensionless name whose first segment is no folder here is an identifier, not a path', () => {
  const r = run({
    'AGENTS.md': 'Support `server/discover` and `tools/list`.\n\nThe helper lives in `src/discover`.\n\nThe old one was in `src/legacy`.\n',
    'src/discover.ts': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['src/legacy']);
});

test('a markdown link holding a template placeholder is not a broken link', () => {
  const r = run({
    'CLAUDE.md': '- [One](chapters/ch01-<slug>.md)\n- [Two](chapters/ch02-real.md)\n',
    'chapters/ch01-intro.md': '',
  });
  assert.deepEqual(r.brokenLinks.map((l) => l.cited), ['chapters/ch02-real.md']);
});

test('inside a published skill, the no-context message names the root SKILL.md', () => {
  const withSkill = repoWith({
    'SKILL.md': '---\nname: s\ndescription: d\n---\n- [One](chapters/ch01.md)\n',
    'chapters/ch01.md': '',
  });
  const without = repoWith({ 'src/a.js': '' });
  const runCli = (repo) => {
    try {
      execSync('node ' + JSON.stringify(BIN) + ' ' + JSON.stringify(repo), { stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: 0, stderr: '' };
    } catch (e) {
      return { status: e.status, stderr: e.stderr.toString() };
    }
  };

  const a = runCli(withSkill);
  assert.equal(a.status, 2);
  assert.match(a.stderr, /SKILL.md at the root/);
  assert.match(a.stderr, /prumo . SKILL.md/);

  const b = runCli(without);
  assert.equal(b.status, 2);
  assert.match(b.stderr, /Pass one explicitly/);
  assert.equal(/SKILL.md at the root/.test(b.stderr), false);
});

test('a markdown link writes a space as %20, and that link resolves', () => {
  const r = run({
    'CLAUDE.md': 'Certo: [a](docs/Nota%20Longa.md).\n\nCaixa: [b](docs/nota%20longa.md).\n\nSumiu: [c](docs/Outra%20Nota.md).\n',
    'docs/Nota Longa.md': '',
  });
  assert.deepEqual(r.brokenLinks.map((l) => l.cited), ['docs/Outra%20Nota.md']);
  assert.equal(r.caseMismatch.length, 1);
  assert.equal(r.caseMismatch[0].cited, 'docs/nota%20longa.md');
  assert.equal(r.caseMismatch[0].actual, 'docs/Nota%20Longa.md');
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

/** Pulls the two PostToolUse hooks out of an integration page, bash first. */
function hooksFrom(page) {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', page), 'utf8');
  return [...src.matchAll(/```json\n([\s\S]*?)```/g)]
    .map((m) => JSON.parse(m[1]))
    .filter((j) => j.hooks?.PostToolUse)
    .map((j) => j.hooks.PostToolUse[0].hooks[0]);
}

test('the hook in docs/agents.md fires for every file prumo auto-detects', () => {
  const hooks = hooksFrom('agents.md');
  assert.equal(hooks.length, 2);
  const bash = hooks.find((h) => !h.shell).command.match(/process\.exit\(\/(.+)\/i\.test\(p\)/)[1];
  const ps = hooks.find((h) => h.shell === 'powershell').command.match(/-match\s+'(.+?)'\)/)[1];

  const covered = [
    ...DEFAULT_TARGETS,
    ...DEFAULT_DIRS.map((d) => `${d}/rule.md`),
    ...[...NESTED].filter((n) => n !== 'SKILL.md').map((n) => `packages/api/${n}`),
    '.claude/skills/release/SKILL.md',
  ];
  const preCommit = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.pre-commit-hooks.yaml'), 'utf8').match(/^\s*files:\s*'(.+)'\s*$/m)[1];
  for (const re of [new RegExp(bash, 'i'), new RegExp(ps, 'i'), new RegExp(preCommit)]) {
    for (const path of covered) assert.ok(re.test(path), `the hook ignores ${path}`);
    assert.ok(!re.test('src/main.py'), 'the hook fires on a code file');
    assert.ok(!re.test('SKILL.md'), 'the hook fires on a root SKILL.md, which prumo does not auto-detect');
  }
});

test('the GitHub Action runs the checked-out prumo itself, with every input the README names', () => {
  const action = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'action.yml'), 'utf8');
  assert.match(action, /^runs:\n  using: composite/m);
  assert.match(action, /\$GITHUB_ACTION_PATH\/bin\/prumo\.mjs/);
  for (const input of ['path', 'targets', 'format', 'sarif-file', 'fail-on-findings']) assert.match(action, new RegExp(`^  ${input}:`, 'm'));
  assert.match(action, /^  total:/m);
  assert.match(action, /^branding:/m);
});

test('an @/ alias resolves against the repository root, not only against src and app', () => {
  const r = run({
    'CLAUDE.md': 'The toast types live in `@/app/types/toast.ts`.\n',
    'app/types/toast.ts': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('a scoped package specifier is an import, not a path in this repository', () => {
  const r = run({
    'CLAUDE.md': 'It exports its CSS separately (`@acme/viewer/style.css`).\n',
    'src/index.ts': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('a TypeScript project cites the .js the bundler emits, and git holds the .ts', () => {
  const r = run({
    'AGENTS.md': 'Use the logger from `./logger.js`, and the model from `src/model/style.js`.\n',
    'logger.ts': '',
    'src/model/style.ts': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('a .js that no .ts stands behind is still reported', () => {
  const r = run({
    'AGENTS.md': 'Use the helper in `src/gone.js`.\n',
    'src/index.ts': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, 'src/gone.js');
});

test('a note that spells the project name in front of a real path still resolves', () => {
  const r = run({
    'AGENTS.md': 'The proxy lives in `myapp/app/api/proxy/route.ts`.\n',
    'app/api/proxy/route.ts': '',
  });
  assert.equal(r.missingPaths.length, 0);
  assert.equal(r.caseMismatch.length, 0);
});

test('a prefix that would leave a bare root filename is still reported', () => {
  const r = run({
    'AGENTS.md': 'See `evals/README.md` for the evaluation framework.\n',
    'README.md': '',
    'src/index.ts': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, 'evals/README.md');
});

test('a square bracket marks a placeholder, in a name or a dynamic route', () => {
  const r = run({
    'AGENTS.md': 'Create `.agents/commands/[name].md` and a page under `src/app/[lang]/page.tsx`.\n',
    'src/app/index.tsx': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('a date or version stencil in a name is a file to be created, not one that is here', () => {
  const r = run({
    'AGENTS.md': 'Save it as `reports/review-YYYY-MM-DD.md`, and link `product/vX.Y.Z/_index.md`.\n',
    'reports/README.md': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('path/to/ is a placeholder inside a markdown link as well as in prose', () => {
  const r = run({
    'AGENTS.md': 'List them as [Page Title](path/to/page.md) in the wiki.\n',
    'docs/real.md': '',
  });
  assert.equal(r.brokenLinks.length, 0);
});

test('two files written as one token are not a path, and a dotfile still is', () => {
  const r = run({
    'AGENTS.md': 'Add it to `src/common/constants.hpp/.cpp`. Secrets live in `config/.env`.\n',
    'src/common/constants.hpp': '',
    'config/app.json': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, 'config/.env');
});

test('a prose path written with backslashes is checked like any other', () => {
  const r = run({
    'AGENTS.md': 'The layout is `src\\layouts\\App.vue`.\n',
    'src/Layouts/App.vue': '',
  });
  assert.equal(r.caseMismatch.length, 1);
  assert.equal(r.caseMismatch[0].actual, 'src/Layouts/App.vue');
});

test('a link wrapped in angle brackets is checked, spaces and all', () => {
  const r = run({
    'AGENTS.md': 'Read [the note](<docs/Nota Que Sumiu.md>) first.\n',
    'docs/outra.md': '',
  });
  assert.equal(r.brokenLinks.length, 1);
  assert.equal(r.brokenLinks[0].cited, 'docs/Nota Que Sumiu.md');
});

test('a link to an image or to code is checked, not only one to markdown', () => {
  const r = run({
    'AGENTS.md': 'See [the diagram](docs/arquitetura.png) and [the parser](src/parser.ts).\n',
    'docs/real.png': '',
    'src/index.ts': '',
  });
  assert.equal(r.brokenLinks.length, 2);
});

test('a reference definition is a link, and is reported on its own line', () => {
  const r = run({
    'AGENTS.md': 'Look at [the sketch][ESQ].\n\n[ESQ]: assets/esquema-antigo.svg\n',
    'assets/esquema.svg': '',
  });
  assert.equal(r.brokenLinks.length, 1);
  assert.equal(r.brokenLinks[0].cited, 'assets/esquema-antigo.svg');
  assert.equal(r.brokenLinks[0].line, 3);
});

test('a path beside a link to another repository belongs to that repository', () => {
  const repo = repoWith({
    'AGENTS.md': 'Reference code lives in https://github.com/other/toolkit\n\nCopy the shape of `api/lambda/index.js` from there.\n\n\n\n\n\n\n\nOur own entry is `src/main.ts`.\n',
    'src/index.ts': '',
  });
  execSync('git remote add origin https://github.com/mine/project.git', { cwd: repo, stdio: 'ignore' });
  const r = analyze({ repo, targets: resolveTargets(repo, []) });
  assert.deepEqual(r.missingPaths.map((x) => x.cited), ['src/main.ts']);
});

test('a link to this same repository does not excuse the path beside it', () => {
  const repo = repoWith({
    'AGENTS.md': 'The project lives at https://github.com/mine/project\n\nThe entry is `src/main.ts`.\n',
    'src/index.ts': '',
  });
  execSync('git remote add origin https://github.com/mine/project.git', { cwd: repo, stdio: 'ignore' });
  const r = analyze({ repo, targets: resolveTargets(repo, []) });
  assert.deepEqual(r.missingPaths.map((x) => x.cited), ['src/main.ts']);
});

test('an alias in a repository holding no alias root belongs to another project', () => {
  const r = run({
    'CLAUDE.md': 'Use the card in `@/components/ui/card.tsx`.\n',
    '.claude/agents/reviewer.md': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('the same alias is still checked where an alias root exists', () => {
  const r = run({
    'CLAUDE.md': 'Use the card in `@/components/ui/card.tsx`.\n',
    'src/index.ts': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, '@/components/ui/card.tsx');
});

test('a path a sentence tells the agent to write is an output, not a dead path', () => {
  const r = run({
    'AGENTS.md': 'Output: `docs/reports/summary.md`, one per run.\n',
    'docs/README.md': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('a path simply gone is still reported when nothing says it gets written', () => {
  const r = run({
    'AGENTS.md': 'The parser is `lib/parsing/reader.js`.\n',
    'src/index.js': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, 'lib/parsing/reader.js');
});

test('a verb that edits a file, like update, presumes it is here', () => {
  const r = run({
    'AGENTS.md': 'Update `docs/testing-overview.md` after a coverage change.\n',
    'docs/testing-guide.md': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, 'docs/testing-overview.md');
});

test('a path a sentence says gets written is an output even when its folder is here', () => {
  const r = run({
    'AGENTS.md': 'Output: `docs/report.md`\n\nSave the plan to `docs/plan.md` and the log is written to `docs/run.log`.\n',
    'docs/README.md': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('the verb nearest the path governs it', () => {
  const r = run({
    'AGENTS.md': 'Read `docs/guide.md` and write the summary to `docs/summary.md`.\n',
    'docs/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['docs/guide.md']);
});

test('a path after "generated by" is the tool, and a numbered or emoji heading is suggested for its bare anchor', () => {
  const r = run({
    'AGENTS.md': 'IDs are generated by `scripts/claim_id.py`. See [perf](#query-performance) and [personas](#agent-personas).\n\n## 1. Query Performance\n\n## 🎭 Agent Personas\n',
    'scripts/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['scripts/claim_id.py']);
  assert.deepEqual(r.brokenLinks.map((l) => [l.cited, l.suggestion]), [['#query-performance', '#1-query-performance'], ['#agent-personas', '#-agent-personas']]);
});

test('a producing verb after the path counts only in the passive', () => {
  const r = run({
    'AGENTS.md': '`docs/report.md` is generated by the build.\n`app/Factories/UserFactory.php` creates users.\n',
    'docs/README.md': '',
    'app/Factories/PostFactory.php': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['app/Factories/UserFactory.php']);
});

test('the sentence that introduces a list or a table governs its items', () => {
  const r = run({
    'AGENTS.md': [
      'This skill generates:',
      '',
      '- `docs/a.md`',
      '- `docs/b.md`',
      '',
      'See also:',
      '- `docs/c.md`',
      '',
      '| Mode | Output |',
      '| --- | --- |',
      '| plan | `docs/plan.md` |',
      '',
      '| File | Purpose |',
      '| --- | --- |',
      '| `docs/d.md` | the rules |',
      '',
    ].join('\n'),
    'docs/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['docs/c.md', 'docs/d.md']);
});

test('the section heading governs what no sentence does', () => {
  const r = run({
    'AGENTS.md': '## Output\n\n- `docs/plan.md`\n\n## Files\n\n- `docs/rules.md`\n',
    'docs/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['docs/rules.md']);
});

test('a redirect, an output flag or a creating command marks the file a command writes', () => {
  const r = run({
    'AGENTS.md': '```\nnode scripts/gen.js > docs/out.md\nmkdir -p docs/new\ncurl -o docs/data.json https://example.test\n```\n',
    'docs/README.md': '',
    'scripts/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['scripts/gen.js']);
});

test('the sentence above a fenced block governs a file tree inside it, not a command', () => {
  const r = run({
    'AGENTS.md': 'The skill creates this layout:\n```\ndocs/plan.md\n```\n\nThe skill creates the report with:\n```\nnode scripts/gen.js\n```\n',
    'docs/README.md': '',
    'scripts/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['scripts/gen.js']);
});

test('a produced path with the wrong case is still a case mismatch', () => {
  const r = run({
    'AGENTS.md': 'Output: `docs/Report.md`\n',
    'docs/report.md': '',
  });
  assert.equal(r.caseMismatch.length, 1);
  assert.equal(r.caseMismatch[0].cited, 'docs/Report.md');
});

test('em português, o verbo que produz cala o caminho e o que consome não', () => {
  const r = run({
    'AGENTS.md': 'Salve o resultado em `docs/resultado.md`. Veja `docs/guia.md` antes de começar.\n',
    'docs/LEIAME.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['docs/guia.md']);
});

test('a call prefix in a fenced block is stripped, so the path is checked and cited clean', () => {
  const r = run({
    'AGENTS.md': '```\nrequire(\'lib/gone.js\')\nconst y = load("lib/gone2.js")\nrequire(\'src/components/button.tsx\')\n```\n',
    'src/components/Button.tsx': '',
    'lib/index.js': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['lib/gone.js', 'lib/gone2.js']);
  assert.equal(r.caseMismatch.length, 1);
  assert.equal(r.caseMismatch[0].cited, 'src/components/button.tsx');
});

test('a link to a heading the page does not have is a broken link, with the closest heading as the suggestion', () => {
  const r = run({
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
  const ok = run({
    'AGENTS.md': 'See [db](docs/setup.md#database) and [sx](docs/setup.md#setext-heading) and [code](src/a.js#L10).\n',
    'docs/setup.md': '# Setup\n\n## Database\n\nSetext heading\n--------------\n',
    'src/a.js': '',
  });
  assert.equal(ok.brokenLinks.length, 0);
});

test('a page with Windows line endings answers to the same anchors, and a script named with a glob is not a command', () => {
  const r = run({
    'AGENTS.md': 'See [json](README.md#consuming-the-json) and [top](#setup).\r\n\r\n## Setup\r\n\r\nRun `pnpm maid:*` scripts.\r\n',
    'README.md': '# Tool\r\n\r\n## Consuming the JSON\r\n\r\nText.\r\n',
    'package.json': JSON.stringify({ scripts: { 'maid:up': 'x' } }),
  });
  assert.equal(r.brokenLinks.length, 0);
  assert.equal(r.unknownCommands.length, 0);
});

test('a link from a nested note that resolves from the repository root is read from the root, as an agent reads it', () => {
  const r = run({
    '.claude/skills/api/SKILL.md': 'See [the app](src/app.ts), [the wrong case](src/App.ts) and [gone](src/gone.ts).\n',
    'src/app.ts': '',
  });
  assert.deepEqual(r.brokenLinks.map((l) => l.cited), ['src/gone.ts']);
  assert.deepEqual(r.caseMismatch.map((c) => [c.cited, c.actual]), [['src/App.ts', 'src/app.ts']]);
});

test('a link to a heading in another page is checked against that page', () => {
  const r = run({
    'AGENTS.md': 'Read [the schema](docs/setup.md#schema) and [the flow](<docs/setup.md#data-flow>).\n',
    'docs/setup.md': '# Setup\n\n## Data flow\n',
  });
  assert.deepEqual(r.brokenLinks.map((l) => [l.kind, l.cited]), [['anchor', 'docs/setup.md#schema']]);
});

test('a command naming a script or target nothing defines is reported, with the closest name', () => {
  const r = run({
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
  const none = run({
    'AGENTS.md': 'Run `npm run build` and `make all` and `composer test`.\n',
    'src/index.py': '',
  });
  assert.equal(none.unknownCommands.length, 0);
  const elsewhere = run({
    'AGENTS.md': 'Run `npm run build -w packages/api`, `make -C tools all`, `pnpm --dir cli test`, `yarn workspace api build` and `npm run start`.\n',
    'package.json': JSON.stringify({ scripts: { start: 'x' } }),
    'Makefile': 'TARGETS := a b\n$(TARGETS):\n\techo $@\n',
  });
  assert.equal(elsewhere.unknownCommands.length, 0);
});

test('a file whose cited paths start in folders the repository does not have documents another project, and its findings are held back', () => {
  const files = {
    'CLAUDE.md': 'Models in `app/Models/User.php`, routes in `routes/web.php`, views in `resources/views/home.blade.php`, tests in `tests/Feature/HomeTest.php`, and read `docs/README.md`.\n',
    'docs/README.md': '',
  };
  const r = run(files);
  assert.equal(r.missingPaths.length, 0);
  assert.deepEqual(r.elsewhere, [{ file: 'CLAUDE.md', cited: 5, absent: 4 }]);
  const named = run(files, ['CLAUDE.md']);
  assert.equal(named.missingPaths.length, 4);
  assert.equal(named.elsewhere.length, 0);
});

test('a stale note that still cites the folders the repository has is checked in full, and so is a short or a mostly present one', () => {
  const stale = run({
    'CLAUDE.md': 'See `docs/a.md`, `docs/b.md`, `docs/c.md`, `docs/d.md` and `docs/e.md`.\n',
    'docs/README.md': '',
  });
  assert.equal(stale.missingPaths.length, 5);
  assert.equal(stale.elsewhere.length, 0);
  const few = run({
    'CLAUDE.md': 'See `app/a.php`, `routes/b.php` and `lib/c.php`.\n',
    'src/index.js': '',
  });
  assert.equal(few.missingPaths.length, 3);
  assert.equal(few.elsewhere.length, 0);
  const mostlyHere = run({
    'CLAUDE.md': 'See `src/a.js`, `src/b.js`, `src/c.js`, `src/d.js`, `src/e.js`, `src/f.js`, `app/x.php`, `routes/y.php`, `lib/z.php` and `config/w.php`.\n',
    'src/a.js': '', 'src/b.js': '', 'src/c.js': '', 'src/d.js': '', 'src/e.js': '', 'src/f.js': '',
  });
  assert.equal(mostlyHere.missingPaths.length, 4);
  assert.equal(mostlyHere.elsewhere.length, 0);
});

test('a sentence that makes the existence of the file a condition excuses it', () => {
  const r = run({
    'AGENTS.md': 'If `docs/context.md` exists, read it first. Check whether `docs/notes.md` is present. Se `docs/regras.md` existir, siga. Then read `docs/guide.md`.\n',
    'docs/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['docs/guide.md']);
});

test('template syntax and code in double brackets are not wikilinks, and a span that opens with a number is not a command', () => {
  const r = run({
    'AGENTS.md': 'Set $[[ inputs.stage ]], filter with df[[col]], and see [[semgrep.ruleset]]. Real: [[deploy-checklist]]. Open `000 Inbox/Inbox.md` daily.\n',
    'docs/README.md': '',
  });
  assert.deepEqual(r.brokenLinks.map((l) => l.cited), ['deploy-checklist']);
  assert.equal(r.missingPaths.length, 0);
});

test('a skill missing its own references is a finding, never a skill for another project', () => {
  const r = run({
    '.claude/skills/x/SKILL.md': 'See `references/a.md`, `references/b.md`, `scripts/run.py`, `assets/logo.md` and `templates/t.md`.\n',
    'docs/README.md': '',
  });
  assert.equal(r.missingPaths.length, 5);
  assert.equal(r.elsewhere.length, 0);
});

test('a host written without its scheme, a file:// address, a path:symbol, a NN stencil and a quoted argument with spaces', () => {
  const r = run({
    'AGENTS.md': [
      'See `docs.example.com/guide.md`, `gesetze-im-internet.de/estg/__3a.html` and `file://provider.py`.',
      'The checks live in `src/doctor.ts:runSharedChecks`; each shot is `shots/shot_NN.md` and each migration `db/NNNN_name.sql`.',
      'The index was migrated from `docs/old-index.md`; the body moved to `docs/new.md`.',
      'Run `make explore FILES="a b" MSG=\'main contradiction\'`.',
      '',
    ].join('\n'),
    'src/doctor.ts': '',
    'docs/README.md': '',
    'Makefile': 'explore:\n\techo x\n',
  });
  assert.equal(r.missingPaths.length, 0);
  assert.equal(r.unknownCommands.length, 0);
  const symbol = run({ 'AGENTS.md': 'See `src/gone.ts:run`.\n', 'src/index.ts': '' });
  assert.deepEqual(symbol.missingPaths.map((f) => f.cited), ['src/gone.ts']);
});

test('the same script shown under several package managers is a list of alternatives, and an example name is not a path', () => {
  const r = run({
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

test('the condition may follow the path, a vendored component is not a target, and three more stencils', () => {
  const r = run({
    'AGENTS.md': 'Read `.omo/boulder.json` if it exists, and `architecture/profile.yaml` when present. Config loads in `cmd/root.go:initConfig()`. Scan `src/foo.py` and `Memory/YYYYMMDD-update/index.md`.\n',
    'cmd/root.go': '',
    'src/index.py': '',
    'managed_components/vendor__lib/CLAUDE.md': 'See `tools/build.py`.\n',
  });
  assert.equal(r.missingPaths.length, 0);
  assert.equal(r.stats.targets, 1);
});

test('a fenced block in a programming language is not read', () => {
  const r = run({
    'AGENTS.md': '```js\nconst x = require(\'lib/gone.js\');\n```\n\n```python\nopen("lib/gone.py")\n```\n\n```bash\nnode lib/gone.js\n```\n',
    'lib/index.js': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['lib/gone.js']);
  assert.equal(r.missingPaths[0].line, 10);
});

test('a negation word inside a longer word does not silence the line', () => {
  const r = run({
    'AGENTS.md': 'Read `lib/parsing/reader.js` whenever the grammar changes.\nO time solicitado revisa `lib/parsing/writer.js`.\n',
    'src/index.js': '',
  });
  assert.deepEqual(r.missingPaths.map((x) => x.cited).sort(), ['lib/parsing/reader.js', 'lib/parsing/writer.js']);
});

test('the same words on their own still silence it', () => {
  const r = run({
    'AGENTS.md': 'We never shipped `lib/parsing/reader.js`.\nO `lib/parsing/writer.js` sumiu na limpeza.\n',
    'src/index.js': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('a path inside a fenced block is checked, and a link there is a quotation', () => {
  const r = run({
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
  const r = run({
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

test('a line number, a GitHub anchor or a ::symbol after a path points inside the file, not at another one', () => {
  const r = run({
    'CLAUDE.md': 'See `src/index.ts:42`, `src/index.ts#L10-L20`, `src/index.ts::main` and `src/gone.ts::helper`.\n',
    'src/index.ts': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['src/gone.ts']);
});

test('a path that starts with a shell variable belongs to wherever the variable points', () => {
  const r = run({
    'CLAUDE.md': 'Read `$PROJECT_ROOT/docs/gone.md` and `$ENGINE/AGENTS.md`, then `docs/really-gone.md`.\n',
    'docs/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['docs/really-gone.md']);
});

test('what sits inside an HTML comment is not read, and the rest of its line is', () => {
  const r = run({
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

test('a prumo-ignore-next-line marker before a fenced block silences the whole block, counted once', () => {
  const r = run({
    'CLAUDE.md': [
      '<!-- prumo-ignore-next-line -->',
      '```',
      'src/gone-a.ts',
      'src/gone-b.ts',
      '```',
      '- step:',
      '',
      '    ~~~sh',
      '    cat src/gone-c.ts',
      '    ~~~',
      '',
    ].join('\n'),
    'src/index.ts': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['src/gone-c.ts']);
  assert.equal(r.stats.suppressed, 1);
});

test('a path a sentence excuses stays excused on the lines of the file that follow', () => {
  const r = run({
    'CLAUDE.md': [
      'The build generates `dist-notes/summary.md` on every run.',
      '', '', '', '', '', '', '',
      'Open `dist-notes/summary.md` when it is done, and read `src/gone.ts` first.',
      '',
    ].join('\n'),
    'src/index.ts': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => [m.line, m.cited]), [[9, 'src/gone.ts']]);
});

test('e.g. marks an example the way the word itself does', () => {
  const r = run({
    'CLAUDE.md': 'Cite a file with line numbers, e.g. `src/api/client.ts:40-55`.\n',
    'src/index.ts': '',
  });
  assert.equal(r.missingPaths.length, 0);
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
  const r = run({
    'CLAUDE.md': '# app\n',
    '.claude/commands/deploy.md': 'Run `scripts/deploy.sh`, then read `docs/release-notes.md`.\n',
    '.claude/agents/reviewer.md': '---\nname: reviewer\n---\nCite a file with line numbers, as in `src/api/client.ts:40-55`.\n',
    'scripts/deploy.sh': '',
  });
  assert.equal(r.stats.targets, 2);
  assert.deepEqual(r.missingPaths.map((m) => [m.file, m.cited]), [['.claude/commands/deploy.md', 'docs/release-notes.md']]);
});

test('a folder named path is a placeholder wherever it sits, and a quoted path in prose code is left alone', () => {
  const r = run({
    'CLAUDE.md': 'Run `pytest tests/path/test.py::test_name -v`, load with `audio.play("sounds/sfx.json")`, and read `src/gone.ts`.\n',
    'src/index.ts': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['src/gone.ts']);
});

test('NOT IN INDEX belongs to a folder passed explicitly, not to auto-detected folders beside a root MEMORY.md', () => {
  const r = run({
    'MEMORY.md': '# index\n',
    'CLAUDE.md': '# app\n',
    '.claude/commands/deploy.md': 'Deploy.\n',
  });
  assert.deepEqual(r.orphans, []);
});

test('the result identifies the run: schema, version, repository and time', () => {
  const repo = repoWith({ 'CLAUDE.md': '# x\n' });
  const r = analyze({ repo, targets: resolveTargets(repo, []) });
  const version = JSON.parse(readFileSync(join(dirname(BIN), '..', 'package.json'), 'utf8')).version;
  assert.deepEqual(Object.keys(r).slice(0, 4), ['schemaVersion', 'prumoVersion', 'repo', 'checkedAt']);
  assert.equal(r.schemaVersion, SCHEMA_VERSION);
  assert.equal(r.prumoVersion, version);
  assert.equal(r.repo, resolve(repo));
  assert.ok(!Number.isNaN(Date.parse(r.checkedAt)), 'checkedAt is an ISO date');
});
