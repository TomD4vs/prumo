import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderText, renderGithub, renderSarif } from '../src/report.mjs';

/** A result the way analyze() returns it, with whatever the test overrides. */
const result = (over = {}) => ({
  caseMismatch: [],
  brokenLinks: [],
  missingPaths: [],
  orphans: [],
  stats: { tracked: 12, targets: 1, historical: 0, suppressed: 0, gitignored: 0, untracked: 0 },
  ...over,
});

test('a clean result renders the header and nothing to review', () => {
  assert.equal(renderText(result()), 'prumo — 1 context file, 12 files in the git index\n\nnothing to review.');
});

test('the header counts what was skipped on purpose, one line per kind', () => {
  const out = renderText(result({ stats: { tracked: 2, targets: 3, historical: 1, suppressed: 2, gitignored: 3, untracked: 1 } }));
  assert.deepEqual(out.split('\n').slice(0, 5), [
    'prumo — 3 context files, 2 files in the git index',
    '        1 historical entry exempt from path checks',
    '        2 lines or files suppressed by a prumo-ignore marker',
    '        3 paths under .gitignore exempt from path checks',
    '        1 context file not tracked by git',
  ]);
});

test('each section renders the way the README shows it, and the total adds them up', () => {
  const out = renderText(result({
    caseMismatch: [{ file: 'CLAUDE.md', line: 18, cited: 'layouts/AppLayout.vue', actual: 'resources/js/Layouts/AppLayout.vue' }],
    brokenLinks: [
      { file: 'CLAUDE.md', line: 21, kind: 'wikilink', cited: 'deploy-checklist', suggestion: 'deploy_checklist' },
      { file: 'CLAUDE.md', line: 30, kind: 'link', cited: 'docs/old.md', suggestion: null },
    ],
    missingPaths: [{ file: 'docs/setup.md', line: 44, cited: 'config/database.php', excerpt: 'Copy the template into `config/database.php`.' }],
    orphans: ['loose.md'],
  }));
  assert.match(out, /^CASE MISMATCH  \(1\)   resolves on Windows and macOS, breaks on Linux and CI$/m);
  assert.match(out, /^  CLAUDE\.md:18\n      layouts\/AppLayout\.vue\n      ->  resources\/js\/Layouts\/AppLayout\.vue$/m);
  assert.match(out, /^BROKEN LINK  \(2\)   1 with a likely destination$/m);
  assert.match(out, /^  CLAUDE\.md:21  \[\[deploy-checklist\]\]   ->  deploy_checklist$/m);
  assert.match(out, /^  CLAUDE\.md:30  docs\/old\.md$/m);
  assert.match(out, /^NOT IN INDEX  \(1\)/m);
  assert.match(out, /^  loose\.md$/m);
  assert.match(out, /^MISSING PATH  \(1\)/m);
  assert.match(out, /^  docs\/setup\.md:44  config\/database\.php\n      Copy the template into `config\/database\.php`\.$/m);
  assert.match(out, /\n5 to review$/);
});

test('an unknown command and a heading anchor render like the other findings, and count in the total', () => {
  const out = renderText(result({
    brokenLinks: [{ file: 'CLAUDE.md', line: 8, kind: 'anchor', cited: 'docs/setup.md#databse', suggestion: 'docs/setup.md#database' }],
    unknownCommands: [
      { file: 'AGENTS.md', line: 12, cited: 'npm run test:unit', name: 'test:unit', source: 'package.json', suggestion: 'npm run test:units', excerpt: 'Run `npm run test:unit`.' },
      { file: 'AGENTS.md', line: 40, cited: 'make deploy', name: 'deploy', source: 'Makefile', suggestion: null, excerpt: 'make deploy' },
    ],
  }));
  assert.match(out, /^  CLAUDE\.md:8  docs\/setup\.md#databse   ->  docs\/setup\.md#database$/m);
  assert.match(out, /^UNKNOWN COMMAND  \(2\)   no package\.json, Makefile or composer\.json defines it$/m);
  assert.match(out, /^  AGENTS\.md:12  npm run test:unit   ->  npm run test:units$/m);
  assert.match(out, /^  AGENTS\.md:40  make deploy$/m);
  assert.match(out, /\n3 to review$/);
  const gh = renderGithub(result({ unknownCommands: [{ file: 'AGENTS.md', line: 12, cited: 'npm run test:unit', suggestion: 'npm run test:units' }] }));
  assert.equal(gh, '::warning file=AGENTS.md,line=12::Unknown command: npm run test:unit — did you mean npm run test:units?');
});

test('a file held back as documenting another project is listed without counting', () => {
  const out = renderText(result({ elsewhere: [{ file: '.claude/skills/deploy/SKILL.md', cited: 14, absent: 12 }] }));
  assert.match(out, /^ANOTHER PROJECT  \(1\)   its paths start in folders this repository does not have, so its findings are held back$/m);
  assert.match(out, /^  \.claude\/skills\/deploy\/SKILL\.md   12 of 14 cited paths; name the file to check it in full$/m);
  assert.match(out, /\nnothing to review\.$/);
  assert.equal(renderGithub(result({ elsewhere: [{ file: 'x.md', cited: 5, absent: 4 }] })), '::notice file=x.md::Documents another project: 4 of 5 cited paths start in folders this repository does not have; findings held back');
});

test('SARIF carries one result per finding, with the rule, the level, the file and the line', () => {
  const sarif = JSON.parse(renderSarif(result({
    prumoVersion: '9.9.9',
    caseMismatch: [{ file: 'CLAUDE.md', line: 18, cited: 'layouts/App.vue', actual: 'resources/js/Layouts/App.vue' }],
    brokenLinks: [{ file: 'CLAUDE.md', line: 21, kind: 'wikilink', cited: 'deploy-checklist', suggestion: 'deploy_checklist' }],
    missingPaths: [{ file: 'docs/setup.md', line: 44, cited: 'config/database.php', excerpt: 'x' }],
    unknownCommands: [{ file: 'AGENTS.md', line: 12, cited: 'npm run test:unit', suggestion: null }],
    orphans: ['loose.md'],
    elsewhere: [{ file: '.claude/skills/x/SKILL.md', cited: 5, absent: 4 }],
  })));
  assert.equal(sarif.version, '2.1.0');
  const run = sarif.runs[0];
  assert.equal(run.tool.driver.name, 'prumo');
  assert.equal(run.tool.driver.version, '9.9.9');
  assert.equal(run.tool.driver.rules.length, 6);
  assert.deepEqual(run.results.map((r) => [r.ruleId, r.level, r.locations[0].physicalLocation.artifactLocation.uri, r.locations[0].physicalLocation.region?.startLine]), [
    ['case-mismatch', 'error', 'CLAUDE.md', 18],
    ['broken-link', 'warning', 'CLAUDE.md', 21],
    ['missing-path', 'warning', 'docs/setup.md', 44],
    ['unknown-command', 'warning', 'AGENTS.md', 12],
    ['not-in-index', 'note', 'loose.md', undefined],
    ['another-project', 'note', '.claude/skills/x/SKILL.md', undefined],
  ]);
  assert.equal(run.results[1].message.text, '[[deploy-checklist]] (did you mean deploy_checklist?)');
});

test('the list stops at 25 unless --all, and says how many more there are', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ file: 'CLAUDE.md', line: i + 1, cited: `config/f${i}.php`, excerpt: 'x' }));
  const short = renderText(result({ missingPaths: many }));
  assert.equal((short.match(/^  CLAUDE\.md:/gm) || []).length, 25);
  assert.match(short, /… 5 more \(use --all\)/);
  const full = renderText(result({ missingPaths: many }), { all: true });
  assert.equal((full.match(/^  CLAUDE\.md:/gm) || []).length, 30);
  assert.doesNotMatch(full, /use --all/);
});

test('a fix pass is reported before the findings, changes and skips alike', () => {
  const fixed = {
    files: 1,
    paths: 1,
    changes: [{ file: 'CLAUDE.md', line: 3, cited: 'layouts/App.vue', actual: 'resources/js/Layouts/App.vue' }],
    skipped: [{ file: 'CLAUDE.md', line: 9, cited: 'x/y.vue', actual: 'x/Y.vue', why: 'line changed since the scan' }],
  };
  const out = renderText(result(), { fixed, jsonPath: 'out.json' });
  assert.match(out, /^FIXED  1 path in 1 file\n  CLAUDE\.md:3   layouts\/App\.vue  ->  resources\/js\/Layouts\/App\.vue\n  skipped CLAUDE\.md:9 \(line changed since the scan\)$/m);
  assert.match(out, /\njson: out\.json$/);
});

test('with colour, the titles become badges, the correction is painted apart, and the total is counted by kind', () => {
  const findings = {
    caseMismatch: [{ file: 'CLAUDE.md', line: 18, cited: 'layouts/AppLayout.vue', actual: 'resources/js/Layouts/AppLayout.vue' }],
    brokenLinks: [
      { file: 'CLAUDE.md', line: 21, kind: 'wikilink', cited: 'deploy-checklist', suggestion: 'deploy_checklist' },
      { file: 'CLAUDE.md', line: 30, kind: 'link', cited: 'docs/old.md', suggestion: null },
    ],
    missingPaths: [{ file: 'docs/setup.md', line: 44, cited: 'config/database.php', excerpt: 'Copy the template into `config/database.php`.' }],
    orphans: ['loose.md'],
  };
  const painted = renderText(result(findings), { color: true });
  assert.match(painted, /\x1b\[7;38;5;203m CASE MISMATCH \x1b\[0m \x1b\[1m1\x1b\[0m   \x1b\[38;5;245mresolves on Windows/);
  assert.match(painted, /\x1b\[38;5;173mlayouts\/AppLayout\.vue\x1b\[0m/);
  assert.match(painted, /\x1b\[38;5;79m->\x1b\[0m  \x1b\[38;5;79mresources\/js\/Layouts\/AppLayout\.vue\x1b\[0m/);
  assert.match(painted, /\x1b\[7;38;5;221m BROKEN LINK \x1b\[0m \x1b\[1m2\x1b\[0m   \x1b\[38;5;245m1 with a likely destination/);
  assert.match(painted, /\x1b\[1m5 to review\x1b\[0m\x1b\[38;5;245m   ·   1 case mismatch   ·   2 broken links   ·   1 note not in the index   ·   1 missing path\x1b\[0m$/);
  assert.match(renderText(result(), { color: true }), /\x1b\[38;5;79mnothing to review\.\x1b\[0m$/);

  const plain = renderText(result(findings));
  assert.doesNotMatch(plain, /\x1b/, 'without colour there is no escape code at all');
  assert.equal(painted.replace(/\x1b\[[0-9;]*m/g, '').split('\n').length, plain.split('\n').length, 'colour adds no line');
});

test('the GitHub format is one annotation per finding, on the file and line', () => {
  const out = renderGithub(result({
    caseMismatch: [{ file: 'CLAUDE.md', line: 3, cited: 'a/B.js', actual: 'a/b.js' }],
    brokenLinks: [
      { file: 'CLAUDE.md', line: 4, kind: 'wikilink', cited: 'gone', suggestion: 'gone_note' },
      { file: 'CLAUDE.md', line: 5, kind: 'link', cited: 'x.md', suggestion: null },
    ],
    missingPaths: [{ file: 'docs/a.md', line: 6, cited: 'src/gone.ts', excerpt: 'x' }],
    orphans: ['loose.md'],
  }));
  assert.deepEqual(out.split('\n'), [
    '::error file=CLAUDE.md,line=3::Case mismatch: a/B.js should be a/b.js',
    '::warning file=CLAUDE.md,line=4::Broken link: gone — did you mean gone_note?',
    '::warning file=CLAUDE.md,line=5::Broken link: x.md',
    '::warning file=docs/a.md,line=6::Missing path: src/gone.ts',
    '::notice::Not in index: loose.md',
  ]);
  assert.equal(renderGithub(result()), '');
});
