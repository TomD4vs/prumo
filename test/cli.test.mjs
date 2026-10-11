import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { analyze, resolveTargets, DEFAULT_TARGETS, DEFAULT_DIRS, NESTED, SCHEMA_VERSION } from '../src/check.mjs';
import { ROOT, BIN, tempDir, repoWith, git, cli } from './support.mjs';

test('throws a clear error outside a git repository', () => {
  const dir = tempDir('prumo-nogit-');
  writeFileSync(join(dir, 'CLAUDE.md'), '# x\n');
  assert.throws(
    () => analyze({ repo: dir, targets: resolveTargets(dir, []) }),
    /not a git repository/
  );
});

test('--version reports the version in package.json', () => {
  const expected = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const out = execSync('node ' + JSON.stringify(BIN) + ' --version').toString().trim();
  assert.equal(out, expected);
});

test('outside a git repository the CLI says so and exits 2', () => {
  const dir = tempDir('prumo-nogit-');
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

test('the text report names the file and line of a broken link', () => {
  const repo = repoWith({ 'CLAUDE.md': '# x\n\nSee [[gone-note]] and [g](docs/gone.md).\n' });
  execSync('git -c user.email=t@t -c user.name=t commit -qm x', { cwd: repo, stdio: 'ignore' });
  let out = '';
  try { execSync('node ' + JSON.stringify(BIN) + ' ' + JSON.stringify(repo), { env: { ...process.env, FORCE_COLOR: '' }, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { out = e.stdout.toString(); assert.equal(e.status, 1); }
  assert.match(out, /^  CLAUDE\.md:3  \[\[gone-note\]\]$/m);
  assert.match(out, /^  CLAUDE\.md:3  docs\/gone\.md$/m);
  assert.match(out, /, 1 file tracked by git$/m);
});

test('an empty git index is an error, not a wall of missing paths', () => {
  const dir = tempDir('prumo-empty-');
  writeFileSync(join(dir, 'CLAUDE.md'), 'See `src/app.js`.\n');
  execSync('git init -q', { cwd: dir, stdio: 'ignore' });
  assert.throws(() => analyze({ repo: dir, targets: resolveTargets(dir, []) }), /git index is empty/);
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

/** Pulls the two PostToolUse hooks out of an integration page, bash first. */
function hooksFrom(page) {
  const src = readFileSync(join(ROOT, 'docs', page), 'utf8');
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
  const preCommit = readFileSync(join(ROOT, '.pre-commit-hooks.yaml'), 'utf8').match(/^\s*files:\s*'(.+)'\s*$/m)[1];
  for (const re of [new RegExp(bash, 'i'), new RegExp(ps, 'i'), new RegExp(preCommit)]) {
    for (const path of covered) assert.ok(re.test(path), `the hook ignores ${path}`);
    assert.ok(!re.test('src/main.py'), 'the hook fires on a code file');
    assert.ok(!re.test('SKILL.md'), 'the hook fires on a root SKILL.md, which prumo does not auto-detect');
  }
});

test('the GitHub Action runs the checked-out prumo itself, with every input the README names', () => {
  const action = readFileSync(join(ROOT, 'action.yml'), 'utf8');
  assert.match(action, /^runs:\n  using: composite/m);
  assert.match(action, /\$GITHUB_ACTION_PATH\/bin\/prumo\.mjs/);
  for (const input of ['path', 'targets', 'format', 'sarif-file', 'fail-on-findings']) assert.match(action, new RegExp(`^  ${input}:`, 'm'));
  assert.match(action, /^  total:/m);
  assert.match(action, /^branding:/m);
});

test('the result identifies the run: schema, version, repository and time', () => {
  const repo = repoWith({ 'CLAUDE.md': '# x\n' });
  const r = analyze({ repo, targets: resolveTargets(repo, []) });
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  assert.deepEqual(Object.keys(r).slice(0, 4), ['schemaVersion', 'prumoVersion', 'repo', 'checkedAt']);
  assert.equal(r.schemaVersion, SCHEMA_VERSION);
  assert.equal(r.prumoVersion, version);
  assert.equal(r.repo, resolve(repo));
  assert.ok(!Number.isNaN(Date.parse(r.checkedAt)), 'checkedAt is an ISO date');
});

test('the package has no dependency of any kind, which is why CI audits none', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies']) {
    assert.deepEqual(Object.keys(pkg[field] || {}), [], `${field} must stay empty`);
  }
});

test('each usage error stops the CLI with exit 2 and says what is wrong, and --help exits 0', () => {
  const repo = repoWith({ 'CLAUDE.md': '# app\n', 'src/a.ts': '' });
  const errors = [
    [['--json'], '--json needs a file path'],
    [['--sarif'], '--sarif needs a file path'],
    [['--since'], '--since needs a commit or a branch'],
    [['--since', 'HEAD', '--staged'], 'use --staged or --since, one at a time'],
    [['--explain'], '--explain needs FILE:LINE, as in CLAUDE.md:12'],
    [['--explain', 'CLAUDE.md:1', '--quiet'], '--quiet does not go with --explain, which only reads one line'],
    [['--format', 'xml'], 'unknown format "xml". Use text, github, json or sarif.'],
    [['--explain', 'CLAUDE.md:1', '--format', 'sarif'], 'unknown format "sarif". Use text or json.'],
    [['--nope'], 'unknown option "--nope". Run "prumo --help" to see the options.'],
  ];
  for (const [args, message] of errors) {
    const r = cli([repo, ...args]);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.err.trim(), `prumo: ${message}`);
  }
  assert.match(cli(['budget', repo, '--fix']).err, /^prumo: --fix is not an option of "prumo budget"\./);
  const help = cli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.out, /^  --explain F:L why line L of the context file F was or was not reported/m);
});
