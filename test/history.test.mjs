import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { analyze, resolveTargets } from '../src/check.mjs';
import { renderText, renderGithub, renderSarif } from '../src/report.mjs';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const GIT = 'git -c user.email=t@t -c user.name=t -c core.safecrlf=false';
function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'prumo-hist-'));
  made.push(dir);
  write(dir, files);
  execSync('git init -q', { cwd: dir, stdio: 'ignore' });
  git(dir, 'add -A');
  git(dir, 'commit -qm first');
  return dir;
}
function write(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content ?? '');
  }
}
const git = (dir, cmd, env = {}) => execSync(`${GIT} ${cmd}`, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...env } }).toString().trim();
const check = (repo) => analyze({ repo, targets: resolveTargets(repo, []) });
const SHA = /^[0-9a-f]{7}$/;

test('a missing path says where git moved it, or when git deleted it, and a path git never held says nothing', () => {
  const repo = repoWith({
    'CLAUDE.md': '# app\n\nCopy `config/database.php`. Run `scripts/seed.py`. See `path/to/file.php` and `src/other.ts`.\n',
    'config/database.php': 'x',
    'scripts/seed.py': 'y',
  });
  git(repo, 'mv config/database.php config/db.php');
  git(repo, 'rm -q scripts/seed.py');
  git(repo, 'commit -qm second');
  const r = check(repo);
  const by = Object.fromEntries(r.missingPaths.map((o) => [o.cited, o.history || null]));
  assert.equal(by['config/database.php'].event, 'renamed');
  assert.equal(by['config/database.php'].to, 'config/db.php');
  assert.match(by['config/database.php'].commit, SHA);
  assert.equal(by['config/database.php'].when, 'today');
  assert.ok(!Number.isNaN(Date.parse(by['config/database.php'].date)));
  assert.equal(by['scripts/seed.py'].event, 'deleted');
  assert.equal(by['scripts/seed.py'].to, undefined);
  assert.equal(by['src/other.ts'], null, 'never in the history: no history line');
  assert.equal('path/to/file.php' in by, false, 'a placeholder is not a finding at all');
  assert.equal(r.schemaVersion, 6);

  const text = renderText(r);
  assert.match(text, new RegExp(`^  CLAUDE\\.md:3  config/database\\.php\\n      Copy .*\\n      ->  config/db\\.php   renamed in ${by['config/database.php'].commit}, today$`, 'm'));
  assert.match(text, new RegExp(`^  CLAUDE\\.md:3  scripts/seed\\.py\\n      Copy .*\\n      deleted in ${by['scripts/seed.py'].commit}, today$`, 'm'));
  assert.match(renderGithub(r), new RegExp(`::warning file=CLAUDE\\.md,line=3::Missing path: config/database\\.php \\(renamed to config/db\\.php in ${by['config/database.php'].commit}, today\\)`));
  assert.match(renderGithub(r), /Missing path: scripts\/seed\.py \(deleted in [0-9a-f]{7}, today\)/);
  assert.match(renderGithub(r), /Missing path: src\/other\.ts$/m);
  const sarif = JSON.parse(renderSarif(r));
  assert.ok(sarif.runs[0].results.some((x) => x.message.text === `config/database.php (renamed to config/db.php in ${by['config/database.php'].commit}, today)`));
});

test('a markdown link to a moved file says where it went, and that replaces the guess from the name', () => {
  const repo = repoWith({
    'CLAUDE.md': '# app\n\nRead [setup](docs/setup.md) and [[setup]].\n',
    'docs/setup.md': '# setup\n',
    'docs/setup-old.md': '# old\n',
  });
  git(repo, 'mv docs/setup.md docs/install.md');
  git(repo, 'commit -qm second');
  const r = check(repo);
  const link = r.brokenLinks.find((l) => l.kind === 'link');
  assert.equal(link.history.event, 'renamed');
  assert.equal(link.history.to, 'docs/install.md');
  const wiki = r.brokenLinks.find((l) => l.kind === 'wikilink');
  assert.equal(wiki.history, undefined, 'a wikilink is a name, and the history knows paths');
  const text = renderText(r);
  assert.match(text, new RegExp(`^  CLAUDE\\.md:3  docs/setup\\.md\\n      ->  docs/install\\.md   renamed in ${link.history.commit}, today$`, 'm'));
  assert.doesNotMatch(text, /docs\/setup\.md   ->/, 'the name guess gives way to the history');
  assert.match(renderGithub(r), /Broken link: docs\/setup\.md \(renamed to docs\/install\.md in [0-9a-f]{7}, today\)/);
});

test('a rename is followed to where the file is now, a rename that ends in a deletion is a deletion, and a merge is read through', () => {
  const repo = repoWith({
    'CLAUDE.md': '# app\n\nSee `src/a.ts` and `src/x.ts`.\n',
    'src/a.ts': 'const a = 1;\n',
    'src/x.ts': 'const x = 1;\n',
  });
  git(repo, 'mv src/a.ts src/b.ts');
  git(repo, 'mv src/x.ts src/y.ts');
  git(repo, 'commit -qm second');
  git(repo, 'mv src/b.ts src/c.ts');
  git(repo, 'rm -q src/y.ts');
  git(repo, 'commit -qm third');
  const r = check(repo);
  const by = Object.fromEntries(r.missingPaths.map((o) => [o.cited, o.history || null]));
  assert.equal(by['src/a.ts'].event, 'renamed');
  assert.equal(by['src/a.ts'].to, 'src/c.ts', 'followed through src/b.ts to the name that exists');
  assert.equal(by['src/x.ts'].event, 'deleted');

  const merged = repoWith({ 'CLAUDE.md': '# app\n\nSee `lib/old.ts`.\n', 'lib/old.ts': 'export const v = 1;\n' });
  git(merged, 'checkout -q -b rename');
  git(merged, 'mv lib/old.ts lib/new.ts');
  git(merged, 'commit -qm renamed');
  git(merged, 'checkout -q -');
  git(merged, 'merge -q --no-ff -m merged rename');
  const m = check(merged).missingPaths[0];
  assert.equal(m.history.event, 'renamed');
  assert.equal(m.history.to, 'lib/new.ts');
});

test('a path cited from beside a nested note is looked up there too, a folder is not asked, and the age reads in months and years', () => {
  const repo = repoWith({
    'packages/api/AGENTS.md': '# api\n\nSee `src/old.ts` and `src/utils/`.\n',
    'packages/api/src/old.ts': 'x',
    'packages/api/src/utils/a.ts': 'x',
  });
  git(repo, 'mv packages/api/src/old.ts packages/api/src/new.ts');
  git(repo, 'rm -q -r packages/api/src/utils');
  git(repo, 'commit -qm second', { GIT_COMMITTER_DATE: '2026-04-01T12:00:00Z', GIT_AUTHOR_DATE: '2026-04-01T12:00:00Z' });
  const r = check(repo);
  const by = Object.fromEntries(r.missingPaths.map((o) => [o.cited, o.history || null]));
  assert.equal(by['src/old.ts'].to, 'packages/api/src/new.ts');
  assert.match(by['src/old.ts'].when, /^\d+ months ago$/);
  assert.ok(!by['src/utils/'], 'a folder has no rename of its own');

  const old = repoWith({ 'CLAUDE.md': '# app\n\nSee [a](a.md).\n', 'a.md': '# a\n' });
  git(old, 'rm -q a.md');
  git(old, 'commit -qm gone', { GIT_COMMITTER_DATE: '2024-06-01T12:00:00Z', GIT_AUTHOR_DATE: '2024-06-01T12:00:00Z' });
  const a = check(old).brokenLinks.concat(check(old).missingPaths).find((o) => o.cited === 'a.md');
  assert.ok(a && a.history, 'a bare name in a link or a path is looked up too');
  assert.match(a.history.when, /^\d+ years? ago$/);
});
