import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveTargets } from '../src/check.mjs';
import { budget, paragraphsOf, CHARS_PER_TOKEN } from '../src/budget.mjs';
import { renderBudget } from '../src/report.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'prumo.mjs');
const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const GIT = 'git -c user.email=t@t -c user.name=t -c core.safecrlf=false';
const git = (dir, cmd) => execSync(`${GIT} ${cmd}`, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
function write(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content ?? '');
  }
}
function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'prumo-budget-'));
  made.push(dir);
  write(dir, files);
  execSync('git init -q', { cwd: dir, stdio: 'ignore' });
  git(dir, 'add -A');
  git(dir, 'commit -qm first');
  return dir;
}
const report = (repo, since = '') => budget({ repo, targets: resolveTargets(repo, []), since });

const SHARED = 'Every handler validates its input with the schema beside it before touching the database, and returns the error shape the client expects.';
const LONG = `# app\n\n## Conventions\n\n${SHARED}\n\nA short line.\n\n## Again\n\n${SHARED}\n\n\`\`\`bash\nnpm test\n\nnpm run build\n\`\`\`\n`;

test('each file is measured, largest first, tokens are estimated at four characters each, and a paragraph written twice is reported by pair of files', () => {
  const repo = repoWith({ 'CLAUDE.md': LONG, 'AGENTS.md': `# agents\n\n${SHARED}\n`, 'docs/notes.md': 'not a target' });
  const r = report(repo);
  assert.equal(r.command, 'budget');
  assert.deepEqual(r.files.map((f) => f.file), ['CLAUDE.md', 'AGENTS.md']);
  const claude = r.files[0];
  assert.equal(claude.tokens, Math.round(LONG.length / CHARS_PER_TOKEN));
  assert.equal(claude.lines, LONG.split('\n').length - 1);
  assert.equal(claude.words, LONG.split(/\s+/).filter(Boolean).length);
  assert.equal(claude.bytes, Buffer.byteLength(LONG));
  assert.equal(r.stats.tokens, r.files[0].tokens + r.files[1].tokens);

  assert.deepEqual(r.repeated, [{ words: 22, at: [{ file: 'CLAUDE.md', line: 5 }, { file: 'CLAUDE.md', line: 11 }, { file: 'AGENTS.md', line: 3 }] }]);
  assert.deepEqual(r.stats.repeated, { paragraphs: 1, copies: 2, words: 44 });

  const text = renderBudget(r);
  assert.match(text, /^prumo — budget, 2 context files, \d+ tokens at four characters each\n        since [0-9a-f]{7}, \d{4}-\d{2}-\d{2}: 0 tokens\n\nBUDGET  \(2\)   largest first\n  CLAUDE\.md +\d+ tokens +17 lines +unchanged\n  AGENTS\.md +\d+ tokens +3 lines +unchanged\n\nREPEATED  \(1\)   a paragraph of twelve words or more written in more than one place\n  CLAUDE\.md:5   also at CLAUDE\.md:11, AGENTS\.md:3   22 words$/);
});

test('a fenced block is one paragraph, a heading alone and a short line are not repeats', () => {
  const lines = ['# T', '', 'one two', '', '```', 'a', '', 'b', '```', '', 'last'];
  assert.deepEqual(paragraphsOf(lines).map((p) => [p.line, p.text]), [[1, '# T'], [3, 'one two'], [5, '```\na\n\nb\n```'], [11, 'last']]);
  const repo = repoWith({ 'CLAUDE.md': '# Same heading\n\nA short line.\n', 'AGENTS.md': '# Same heading\n\nA short line.\n' });
  assert.deepEqual(report(repo).repeated, []);
});

test('growth is measured against a commit: the one thirty days ago, the first one of a young repository, or the REF given', () => {
  const repo = repoWith({ 'CLAUDE.md': '# app\n\nShort.\n' });
  const first = git(repo, 'rev-parse HEAD');
  write(repo, { 'CLAUDE.md': '# app\n\nShort, then a paragraph that makes the note longer than it was at the first commit.\n', 'AGENTS.md': '# new\n\nAdded after the first commit.\n' });
  git(repo, 'add -A');
  git(repo, 'commit -qm second');
  write(repo, { 'GEMINI.md': '# not in git yet\n' });

  const young = report(repo);
  assert.equal(young.stats.since.ref, first.slice(0, 7), 'younger than thirty days: the first commit');
  assert.equal(young.stats.since.date, new Date().toISOString().slice(0, 10));
  const by = Object.fromEntries(young.files.map((f) => [f.file, f]));
  assert.equal(by['CLAUDE.md'].state, 'changed');
  assert.equal(by['CLAUDE.md'].before, Math.round('# app\n\nShort.\n'.length / CHARS_PER_TOKEN));
  assert.equal(by['CLAUDE.md'].delta, by['CLAUDE.md'].tokens - by['CLAUDE.md'].before);
  assert.equal(by['AGENTS.md'].state, 'new');
  assert.equal(by['GEMINI.md'].state, 'untracked');
  assert.equal(young.stats.before, by['CLAUDE.md'].before);

  const named = report(repo, 'HEAD');
  assert.equal(named.stats.since.ref, 'HEAD');
  assert.equal(Object.fromEntries(named.files.map((f) => [f.file, f.state]))['CLAUDE.md'], 'unchanged');
  assert.match(renderBudget(young), /\n  CLAUDE\.md +\d+ tokens +3 lines +\+\d+ since \d{4}-\d{2}-\d{2}\n  AGENTS\.md +\d+ tokens +3 lines +new since \d{4}-\d{2}-\d{2}\n  GEMINI\.md +\d+ tokens +1 lines +not in git\n/);
  assert.throws(() => report(repo, 'nope'), /git does not know "nope"/);
});

test('the CLI runs the report, exits 0, takes --since and --format json, and refuses the options of the check', () => {
  const repo = repoWith({ 'CLAUDE.md': '# app\n\nShort.\n' });
  const run = (...args) => spawnSync(process.execPath, [CLI, 'budget', repo, ...args], { encoding: 'utf8' });
  const plain = run();
  assert.equal(plain.status, 0);
  assert.match(plain.stdout, /^prumo — budget, 1 context file, \d+ tokens at four characters each\n/);
  assert.match(plain.stdout.trimEnd(), /nothing written twice\.$/);
  const json = run('--since', 'HEAD', '--format', 'json');
  assert.equal(json.status, 0);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.command, 'budget');
  assert.equal(parsed.stats.since.ref, 'HEAD');
  const unknownRef = run('--since', 'nope');
  assert.equal(unknownRef.status, 2);
  assert.match(unknownRef.stderr, /git does not know "nope"/);
  const staged = run('--staged');
  assert.equal(staged.status, 2);
  assert.match(staged.stderr, /--staged is not an option of "prumo budget"/);
});
