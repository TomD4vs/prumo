import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveTargets, analyze } from '../src/check.mjs';
import { drift, sectionsOf } from '../src/drift.mjs';
import { renderDrift } from '../src/report.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'prumo.mjs');
const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const GIT = 'git -c user.email=t@t -c user.name=t -c core.safecrlf=false';
const git = (dir, cmd, date = '') => execSync(`${GIT} ${cmd}`, {
  cwd: dir,
  stdio: ['ignore', 'pipe', 'ignore'],
  env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
}).toString().trim();
function write(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content ?? '');
  }
}
function repoWith(files, date) {
  const dir = mkdtempSync(join(tmpdir(), 'prumo-drift-'));
  made.push(dir);
  write(dir, files);
  execSync('git init -q', { cwd: dir, stdio: 'ignore' });
  git(dir, 'add -A');
  git(dir, 'commit -qm first', date);
  return dir;
}
const commit = (dir, files, date) => { write(dir, files); git(dir, 'add -A'); git(dir, `commit -qm change`, date); };
const at = (iso) => Math.floor(Date.parse(iso) / 1000);
const report = (repo, now) => drift({ repo, targets: resolveTargets(repo, []), now });

const NOTE = [
  '# app',
  '',
  'The entry point is `src/app.js`.',
  '',
  '## Backend',
  '',
  'Models in `src/models/user.js` and `src/models/post.js`. See [the schema](docs/schema.md).',
  '',
  '```bash',
  '# a heading inside a fence is code',
  '```',
  '',
  '## Testing',
  '',
  'Run the suite under `tests/`.',
  '',
].join('\n');

test('sections are ordered by the commits to what they cite since the section last changed, and their age comes from git blame', () => {
  const repo = repoWith({
    'CLAUDE.md': NOTE,
    'src/app.js': 'a',
    'src/models/user.js': 'u',
    'src/models/post.js': 'p',
    'docs/schema.md': '# schema\n',
    'tests/a.test.js': 't',
  }, '2025-01-01T12:00:00Z');
  commit(repo, { 'src/models/user.js': 'u2' }, '2025-03-01T12:00:00Z');
  commit(repo, { 'src/models/user.js': 'u3', 'docs/schema.md': '# schema v2\n' }, '2025-04-01T12:00:00Z');
  commit(repo, { 'tests/a.test.js': 't2' }, '2025-05-01T12:00:00Z');
  commit(repo, { 'CLAUDE.md': NOTE.replace('Run the suite', 'Run the whole suite') }, '2025-06-01T12:00:00Z');
  commit(repo, { 'tests/a.test.js': 't3' }, '2025-07-01T12:00:00Z');

  const r = report(repo, at('2025-09-01T12:00:00Z'));
  assert.equal(r.command, 'drift');
  assert.deepEqual(Object.keys(r).slice(0, 5), ['schemaVersion', 'prumoVersion', 'repo', 'checkedAt', 'command']);
  assert.deepEqual(r.sections.map((s) => [s.section, s.line, s.cited, s.changed, s.commits, s.age]), [
    ['Backend', 5, 3, 2, 2, '8 months ago'],
    ['Testing', 13, 1, 1, 1, '3 months ago'],
    ['app', 1, 1, 0, 0, '8 months ago'],
  ]);
  assert.equal(r.sections[0].since, '2025-01-01T12:00:00.000Z', 'the Backend section was last written in the first commit');
  assert.equal(r.sections[1].since, '2025-06-01T12:00:00.000Z', 'editing one line of a section moves that section, and only it');
  assert.deepEqual(r.stats, { targets: 1, sections: 3, cited: 5, quiet: 0, uncommitted: 0 });

  const text = renderDrift(r);
  assert.match(text, /^prumo — drift, 1 context file, 3 sections, 5 cited files\n\nDRIFT  \(3\)   commits to the files a section cites/);
  assert.match(text, /\n  CLAUDE\.md:5 +Backend +8 months ago +2 of 3 cited files changed, 2 commits since\n/);
  assert.match(text, /\n  CLAUDE\.md:13 +Testing +3 months ago +1 of 1 cited file changed, 1 commit since\n/);
  assert.match(text, /\n  CLAUDE\.md:1 +app +8 months ago +0 of 1 cited file changed$/);
});

test('a section with an uncommitted line is as fresh as now, a section citing nothing is counted, and a note citing itself does not count itself', () => {
  const repo = repoWith({
    'CLAUDE.md': '# app\n\nRead `CLAUDE.md` first, then `src/app.js` and [[guide]].\n\n## Empty\n\nNothing cited here.\n',
    'src/app.js': 'a',
    'docs/notes/guide.md': '# guide\n',
  }, '2025-01-01T12:00:00Z');
  write(repo, { 'CLAUDE.md': '# app\n\nRead `CLAUDE.md` first, then `src/app.js` and [[guide]], every time.\n\n## Empty\n\nNothing cited here.\n' });
  const r = report(repo, at('2025-09-01T12:00:00Z'));
  assert.deepEqual(r.sections.map((s) => [s.section, s.cited, s.commits, s.age]), [['app', 2, 0, 'not committed']]);
  assert.deepEqual(r.stats, { targets: 1, sections: 2, cited: 2, quiet: 1, uncommitted: 1 }, 'the file is committed, one of its lines is not');
  const text = renderDrift(r);
  assert.match(text, /\n        1 context file with lines not committed yet\n/);
  assert.match(text, /not committed +0 of 2 cited files changed\n\n1 section cites nothing the repository has$/);

  const fresh = repoWith({ 'src/app.js': 'a' }, '2025-01-01T12:00:00Z');
  write(fresh, { 'AGENTS.md': '# app\n\nSee `src/app.js`.\n' });
  git(fresh, 'add -A');
  const f = report(fresh, at('2025-09-01T12:00:00Z'));
  assert.equal(f.stats.uncommitted, 1, 'a note never committed is counted too');
  assert.equal(f.sections[0].age, 'not committed');
});

test('a citation resolved through an alias, a case mismatch or a folder still names the file git knows, and a folder counts the commits under it', () => {
  const repo = repoWith({
    'CLAUDE.md': '# app\n\n## Layout\n\nSee `@/lib/db.ts`, `SRC/App.ts` and `internal/`.\n',
    'src/lib/db.ts': 'd',
    'src/App.ts': 'a',
    'internal/one.go': '1',
  }, '2025-01-01T12:00:00Z');
  commit(repo, { 'internal/two.go': '2' }, '2025-02-01T12:00:00Z');
  commit(repo, { 'src/lib/db.ts': 'd2' }, '2025-03-01T12:00:00Z');
  const collected = analyze({ repo, targets: resolveTargets(repo, []), collect: true });
  assert.deepEqual(collected.citations.map((c) => c.path).sort(), ['internal', 'src/App.ts', 'src/lib/db.ts']);
  const r = report(repo, at('2025-09-01T12:00:00Z'));
  assert.deepEqual(r.sections.map((s) => [s.section, s.cited, s.changed, s.commits]), [['Layout', 3, 2, 2]]);
});

test('sections are split by headings outside fences, and a front matter alone is not a section', () => {
  const lines = ['---', 'name: x', '---', '', '# Title', 'a', '```', '# not a heading', '```', '## Second ##', 'b'];
  assert.deepEqual(sectionsOf(lines).map((s) => [s.title, s.line, s.start, s.end]), [['Title', 5, 4, 8], ['Second', 10, 9, 10]]);
  assert.deepEqual(sectionsOf(['intro', '', '# One']).map((s) => [s.title, s.line]), [['', 1], ['One', 3]]);
  assert.deepEqual(sectionsOf(['', '']), [], 'a blank file has no section');
});

test('the CLI runs the report, exits 0, takes --format json and --json FILE, and refuses the options of the check', () => {
  const repo = repoWith({ 'CLAUDE.md': '# app\n\nSee `src/app.js`.\n', 'src/app.js': 'a' }, '2025-01-01T12:00:00Z');
  // The shell running the suite may carry FORCE_COLOR; every CLI run here reads the plain report.
  const run = (...args) => spawnSync(process.execPath, [CLI, 'drift', repo, ...args], { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '', NO_COLOR: '1', PRUMO_BANNER: '' } });
  const plain = run();
  assert.equal(plain.status, 0);
  assert.match(plain.stdout, /^prumo — drift, 1 context file, 1 section, 1 cited file\n/);
  assert.match(plain.stdout, /0 of 1 cited file changed/);

  const out = join(repo, 'drift.json');
  const json = run('--format', 'json', '--json', out);
  assert.equal(json.status, 0);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.command, 'drift');
  assert.equal(parsed.sections.length, 1);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).command, 'drift', '--json FILE writes the same result');

  const fix = run('--fix');
  assert.equal(fix.status, 2);
  assert.match(fix.stderr, /--fix is not an option of "prumo drift"/);
  const since = run('--since', 'HEAD');
  assert.equal(since.status, 2);
  assert.match(since.stderr, /--since is not an option of "prumo drift"/);
  const github = run('--format', 'github');
  assert.equal(github.status, 2);
  assert.match(github.stderr, /Use text or json/);
});
