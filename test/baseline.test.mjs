import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyze, resolveTargets, loadBaseline, baselineOf, changedFiles, BASELINE_FILE } from '../src/check.mjs';
import { renderText, renderGithub } from '../src/report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', 'bin', 'prumo.mjs');
const SERVER = join(HERE, '..', 'bin', 'prumo-mcp.mjs');
const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'prumo-base-'));
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
const git = (repo, cmd) => execSync(`git -c user.email=t@t -c user.name=t ${cmd}`, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
const write = (repo, path, content) => { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), content); };
// The shell running the suite may carry FORCE_COLOR; every CLI run here reads the plain report.
const cli = (repo, args = []) => {
  const r = spawnSync(process.execPath, [BIN, repo, ...args], { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '', NO_COLOR: '1', PRUMO_BANNER: '0' } });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const check = (repo, extra = {}) => analyze({ repo, targets: resolveTargets(repo, []), ...extra });
const total = (r) => r.caseMismatch.length + r.brokenLinks.length + r.missingPaths.length + r.unknownCommands.length + r.configIssues.length + r.orphans.length;

const LEGACY = {
  'CLAUDE.md': '# app\n\nSee `config/App.php`, `config/old.php` and [[old-note]].\n',
  'config/app.php': '',
};

test('a baseline records the findings of a run by kind, file and cited path, and a later run holds them back, counted in the header', () => {
  const repo = repoWith(LEGACY);
  const first = check(repo);
  assert.equal(total(first), 3);
  const b = baselineOf(first);
  assert.deepEqual(b.findings, [
    { kind: 'broken-link', file: 'CLAUDE.md', cited: 'old-note', count: 1 },
    { kind: 'case-mismatch', file: 'CLAUDE.md', cited: 'config/App.php', count: 1 },
    { kind: 'missing-path', file: 'CLAUDE.md', cited: 'config/old.php', count: 1 },
  ]);
  assert.equal(b.prumoVersion, first.prumoVersion);
  assert.ok(!Number.isNaN(Date.parse(b.recordedAt)));
  write(repo, BASELINE_FILE, JSON.stringify(b, null, 2));

  const held = check(repo, { baseline: loadBaseline(repo) });
  assert.equal(total(held), 0);
  assert.equal(held.stats.baselined, 3);
  assert.equal(held.stats.baselineStale, 0);
  assert.equal(held.schemaVersion, 6);
  assert.equal(total(check(repo)), 3, 'without the baseline everything is reported');

  write(repo, 'CLAUDE.md', readFileSync(join(repo, 'CLAUDE.md'), 'utf8') + 'And `docs/new.md`.\n');
  const grown = check(repo, { baseline: loadBaseline(repo) });
  assert.deepEqual(grown.missingPaths.map((o) => o.cited), ['docs/new.md']);
  assert.equal(total(grown), 1);
  assert.equal(grown.stats.baselined, 3);

  write(repo, 'config/old.php', '');
  execSync('git add -A', { cwd: repo, stdio: 'ignore' });
  const resolved = check(repo, { baseline: loadBaseline(repo) });
  assert.equal(resolved.stats.baselined, 2);
  assert.equal(resolved.stats.baselineStale, 1, 'the entry for config/old.php matches nothing now');
  assert.equal(total(resolved), 1);
});

test('a baseline entry holds back as many lines as it counts, and a note the index never mentions is held by its file', () => {
  const repo = repoWith({
    'CLAUDE.md': '# app\n\nRead `config/old.php`.\nAgain `config/old.php`.\n',
    'docs/notes/MEMORY.md': '# index\n\n- [[kept]]\n',
    'docs/notes/kept.md': '# kept\n',
    'docs/notes/loose.md': '# loose\n',
  });
  const targets = resolveTargets(repo, ['CLAUDE.md', 'docs/notes']);
  const first = analyze({ repo, targets });
  assert.equal(first.missingPaths.length, 2);
  assert.deepEqual(first.orphans, ['loose.md'], 'a note in an explicit folder is named as the report names it');
  const b = baselineOf(first);
  assert.deepEqual(b.findings.map((e) => `${e.kind} ${e.file} ${e.cited} ${e.count}`), [
    'missing-path CLAUDE.md config/old.php 2',
    'not-in-index loose.md  1',
  ]);
  const one = { ...b, findings: [{ kind: 'missing-path', file: 'CLAUDE.md', cited: 'config/old.php', count: 1 }, { kind: 'not-in-index', file: 'loose.md', cited: '' }] };
  const held = analyze({ repo, targets, baseline: one });
  assert.deepEqual(held.missingPaths.map((o) => o.line), [4], 'the first line is held, the second is new');
  assert.deepEqual(held.orphans, []);
  assert.equal(held.stats.baselined, 2);
});

test('--baseline writes the file and exits 0, the next run exits 0 with the count, --no-baseline reports everything, and a broken baseline is an error', () => {
  const repo = repoWith(LEGACY);
  git(repo, 'commit -qm x');
  const wrote = cli(repo, ['--baseline']);
  assert.equal(wrote.status, 0);
  assert.match(wrote.out, /^3 to review$/m);
  assert.match(wrote.out, /^baseline: \.prumo-baseline\.json, 3 findings recorded$/m);
  assert.ok(existsSync(join(repo, BASELINE_FILE)));
  assert.equal(JSON.parse(readFileSync(join(repo, BASELINE_FILE), 'utf8')).findings.length, 3);

  const next = cli(repo);
  assert.equal(next.status, 0);
  assert.match(next.out, /^        3 findings held in \.prumo-baseline\.json$/m);
  assert.match(next.out, /^nothing to review\.$/m);

  const all = cli(repo, ['--no-baseline']);
  assert.equal(all.status, 1);
  assert.match(all.out, /^3 to review$/m);

  const annotated = cli(repo, ['--format', 'github']);
  assert.equal(annotated.out.trim(), '::notice::Baseline: 3 findings held in .prumo-baseline.json');

  write(repo, BASELINE_FILE, '{ not json');
  const broken = cli(repo);
  assert.equal(broken.status, 2);
  assert.match(broken.err, /\.prumo-baseline\.json is not valid JSON/);
});

test('--staged checks the staged context files alone, --since REF the ones changed since it, and both leave the JSON configs alone unless they changed too', () => {
  const repo = repoWith({
    'CLAUDE.md': '# app\n\nSee `src/gone.ts`.\n',
    'AGENTS.md': '# agents\n\nSee `lib/gone.ts`.\n',
    '.mcp.json': '{"mcpServers":{"x":{"command":"node","args":["scripts/server.mjs"]}}}\n',
  });
  git(repo, 'commit -qm first');
  const first = git(repo, 'rev-parse HEAD');

  const none = cli(repo, ['--staged']);
  assert.equal(none.status, 0);
  assert.match(none.out, /^prumo — 0 context files, 3 files in the git index\n        only the context files staged for commit\n\nnothing to review\.$/m);

  write(repo, 'AGENTS.md', '# agents\n\nSee `lib/gone.ts` and `lib/also.ts`.\n');
  git(repo, 'add AGENTS.md');
  assert.deepEqual([...changedFiles(repo, { staged: true })], ['AGENTS.md']);
  const staged = cli(repo, ['--staged']);
  assert.equal(staged.status, 1);
  assert.match(staged.out, /^prumo — 1 context file, 3 files in the git index\n        only the context files staged for commit$/m);
  assert.match(staged.out, /lib\/also\.ts/);
  assert.doesNotMatch(staged.out, /src\/gone\.ts/, 'CLAUDE.md is not staged');
  assert.doesNotMatch(staged.out, /AGENT CONFIG/, '.mcp.json is not staged');
  const asJson = JSON.parse(cli(repo, ['--staged', '--format', 'json']).out);
  assert.equal(asJson.stats.only, 'staged');
  assert.equal(asJson.stats.targets, 1);
  assert.equal(asJson.stats.configs, 0);

  write(repo, '.mcp.json', '{"mcpServers":{"x":{"command":"node","args":["scripts/server.mjs"],"env":{}}}}\n');
  git(repo, 'add .mcp.json');
  assert.match(cli(repo, ['--staged']).out, /^AGENT CONFIG  \(1\)/m, 'a staged config is read');

  git(repo, 'commit -qm second');
  const since = cli(repo, ['--since', first]);
  assert.equal(since.status, 1);
  assert.match(since.out, new RegExp(`^        only the context files changed since ${first}$`, 'm'));
  assert.match(since.out, /^prumo — 1 context file, /m);
  assert.doesNotMatch(since.out, /src\/gone\.ts/);
  assert.equal(JSON.parse(cli(repo, ['--since', first, '--format', 'json']).out).stats.only, `since ${first}`);
  assert.equal(cli(repo, ['--since', 'HEAD']).status, 0, 'nothing changed since HEAD');

  const unknown = cli(repo, ['--since', 'nope']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.err, /--since: git does not know "nope"/);
  assert.equal(cli(repo, ['--since']).status, 2);
  assert.equal(cli(repo, ['--staged', '--since', 'HEAD']).status, 2);
  assert.equal(cli(repo).status, 1, 'without a limit the whole repository is checked');
});

test('the header says what limited the run and what the baseline holds, --baseline says what it recorded, and the GitHub format carries a notice', () => {
  const base = { caseMismatch: [], brokenLinks: [], missingPaths: [], unknownCommands: [], configIssues: [], orphans: [], elsewhere: [] };
  const stats = { tracked: 9, targets: 1, historical: 0, suppressed: 0, gitignored: 0, untracked: 0, configs: 0 };
  const limited = renderText({ ...base, stats: { ...stats, only: 'staged', baselined: 2, baselineStale: 1 } });
  assert.deepEqual(limited.split('\n').slice(0, 3), [
    'prumo — 1 context file, 9 files in the git index',
    '        only the context files staged for commit',
    '        2 findings held in .prumo-baseline.json; 1 entry there matches nothing now',
  ]);
  assert.match(renderText({ ...base, stats: { ...stats, only: 'since origin/main', baselined: 1, baselineStale: 2 } }), /^        only the context files changed since origin\/main\n        1 finding held in \.prumo-baseline\.json; 2 entries there match nothing now$/m);
  assert.doesNotMatch(renderText({ ...base, stats: { ...stats, baselined: 0, baselineStale: 0 } }), /baseline/);
  assert.match(renderText({ ...base, stats }, { baselineWritten: 3 }), /\nbaseline: \.prumo-baseline\.json, 3 findings recorded$/);
  assert.equal(renderGithub({ ...base, stats: { ...stats, baselined: 4 } }), '::notice::Baseline: 4 findings held in .prumo-baseline.json');
});

test('the MCP server applies the baseline it finds at the root, and never writes one', () => {
  const repo = repoWith(LEGACY);
  write(repo, BASELINE_FILE, JSON.stringify(baselineOf(check(repo))));
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'prumo_check', arguments: { repo } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/list' },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n';
  const { stdout, status } = spawnSync(process.execPath, [SERVER], { input, encoding: 'utf8' });
  assert.equal(status, 0);
  const replies = stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const s = replies.find((r) => r.id === 2).result.structuredContent;
  assert.equal(s.stats.baselined, 3);
  assert.equal(s.missingPaths.length + s.caseMismatch.length + s.brokenLinks.length, 0);
  const text = replies.find((r) => r.id === 2).result.content[0].text;
  assert.match(text, /3 findings held in \.prumo-baseline\.json/);
  const tools = replies.find((r) => r.id === 3).result.tools;
  assert.ok(tools.every((t) => !/baseline/i.test(t.name)), 'no tool records a baseline: that is a decision for a person');
  assert.match(tools.find((t) => t.name === 'prumo_check').description, /\.prumo-baseline\.json/);
});

test('the pre-commit hook checks only the staged context files, and the action takes since and counts config issues in its total', () => {
  const hook = readFileSync(join(HERE, '..', '.pre-commit-hooks.yaml'), 'utf8');
  assert.match(hook, /^  args: \['--staged'\]$/m);
  assert.match(hook, /^  pass_filenames: false$/m);
  const action = readFileSync(join(HERE, '..', 'action.yml'), 'utf8');
  assert.match(action, /^  since:/m);
  assert.match(action, /args\+=\(--since "\$PRUMO_SINCE"\)/);
  assert.match(action, /configIssues/);
});
