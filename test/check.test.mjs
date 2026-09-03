import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyze, resolveTargets, loadConfig } from '../src/check.mjs';
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
  // An installed skill links its supporting files by relative path; one was renamed later.
  const skill = [
    '---', 'name: deploy', 'description: test', '---',
    '- [Setup](steps/setup.md)',
    '- [Rollout](steps/rollout.md)',
    '',
  ].join('\n');
  const repo = repoWith({
    'AGENTS.md': '# root\n',
    // A root SKILL.md is not an installed skill; its paths are examples, not references.
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
