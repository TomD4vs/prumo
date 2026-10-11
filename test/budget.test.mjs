import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTargets } from '../src/check.mjs';
import { budget, paragraphsOf, CHARS_PER_TOKEN } from '../src/budget.mjs';
import { renderBudget } from '../src/report.mjs';
import { committedRepo, write, git, cli } from './support.mjs';

const report = (repo, since = '') => budget({ repo, targets: resolveTargets(repo, []), since });

const SHARED = 'Every handler validates its input with the schema beside it before touching the database, and returns the error shape the client expects.';
const LONG = `# app\n\n## Conventions\n\n${SHARED}\n\nA short line.\n\n## Again\n\n${SHARED}\n\n\`\`\`bash\nnpm test\n\nnpm run build\n\`\`\`\n`;

test('each file is measured, largest first, tokens are estimated at four characters each, and a paragraph written twice is reported by pair of files', () => {
  const repo = committedRepo({ 'CLAUDE.md': LONG, 'AGENTS.md': `# agents\n\n${SHARED}\n`, 'docs/notes.md': 'not a target' });
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
  assert.match(text, /^prumo — budget, 2 context files, \d+ tokens at every session, at four characters each\n        since [0-9a-f]{7}, \d{4}-\d{2}-\d{2}: 0 tokens\n\nBUDGET  \(2\)   what every session reads first, then the largest\n  CLAUDE\.md +\d+ tokens +17 lines +every session +unchanged\n  AGENTS\.md +\d+ tokens +3 lines +every session +unchanged\n\nREPEATED  \(1\)   a paragraph of twelve words or more written in more than one place\n  CLAUDE\.md:5   also at CLAUDE\.md:11, AGENTS\.md:3   22 words$/);
});

test('a fenced block is one paragraph, a heading alone and a short line are not repeats', () => {
  const lines = ['# T', '', 'one two', '', '```', 'a', '', 'b', '```', '', 'last'];
  assert.deepEqual(paragraphsOf(lines).map((p) => [p.line, p.text]), [[1, '# T'], [3, 'one two'], [5, '```\na\n\nb\n```'], [11, 'last']]);
  const repo = committedRepo({ 'CLAUDE.md': '# Same heading\n\nA short line.\n', 'AGENTS.md': '# Same heading\n\nA short line.\n' });
  assert.deepEqual(report(repo).repeated, []);
});

test('growth is measured against a commit: the one thirty days ago, the first one of a young repository, or the REF given', () => {
  const repo = committedRepo({ 'CLAUDE.md': '# app\n\nShort.\n' });
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
  assert.match(renderBudget(young), /\n  CLAUDE\.md +\d+ tokens +3 lines +every session +\+\d+ since \d{4}-\d{2}-\d{2}\n  AGENTS\.md +\d+ tokens +3 lines +every session +new since \d{4}-\d{2}-\d{2}\n  GEMINI\.md +\d+ tokens +1 lines +every session +not in git\n/);
  assert.throws(() => report(repo, 'nope'), /git does not know "nope"/);
});

test('the CLI runs the report, exits 0, takes --since and --format json, and refuses the options of the check', () => {
  const repo = committedRepo({ 'CLAUDE.md': '# app\n\nShort.\n' });
  const run = (...args) => cli(['budget', repo, ...args]);
  const plain = run();
  assert.equal(plain.status, 0);
  assert.match(plain.out, /^prumo — budget, 1 context file, \d+ tokens at every session, at four characters each\n/);
  assert.match(plain.out.trimEnd(), /nothing written twice\.$/);
  const json = run('--since', 'HEAD', '--format', 'json');
  assert.equal(json.status, 0);
  const parsed = JSON.parse(json.out);
  assert.equal(parsed.command, 'budget');
  assert.equal(parsed.stats.since.ref, 'HEAD');
  const unknownRef = run('--since', 'nope');
  assert.equal(unknownRef.status, 2);
  assert.match(unknownRef.err, /git does not know "nope"/);
  const staged = run('--staged');
  assert.equal(staged.status, 2);
  assert.match(staged.err, /--staged is not an option of "prumo budget"/);
});

test('each file is counted as the agents read it: at every session, by its description, or only when used, with the files a note imports', () => {
  const r = report(committedRepo({
    'CLAUDE.md': '# app\n\nRead @docs/rules.md, @AGENTS.md and `@docs/quoted.md`; run `claude with @docs/quoted.md`; not @/README.md.\n\n```\n@docs/fenced.md\n```\n',
    'README.md': 'e'.repeat(4000),
    'docs/rules.md': '# rules\n\n@more.md\n' + 'r'.repeat(400),
    'docs/more.md': '@../CLAUDE.md\n' + 'm'.repeat(200),
    'docs/quoted.md': 'q'.repeat(4000),
    'docs/fenced.md': 'f'.repeat(4000),
    'AGENTS.md': 'a'.repeat(80),
    '.claude/CLAUDE.md': 'c'.repeat(40),
    'api/CLAUDE.md': '# api\n\n@notes.md and @../AGENTS.md\n',
    'api/notes.md': 'n'.repeat(400),
    'packages/x/GEMINI.md': '@extra.md\n' + 'g'.repeat(40),
    'packages/x/extra.md': 'g'.repeat(200),
    '.claude/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: deploys the app\n---\n' + 'b'.repeat(2000),
    '.claude/commands/ship.md': '---\ndescription: ships it\n---\n' + 's'.repeat(800),
    '.cursor/rules/always.mdc': '---\nalwaysApply: true\n---\n' + 'x'.repeat(80),
    '.cursor/rules/ts.mdc': '---\nglobs: src/**/*.ts\n---\n' + 'x'.repeat(80),
    '.cursor/rules/picked.mdc': '---\ndescription: when the api changes\n---\n' + 'x'.repeat(400),
    '.cursor/rules/manual.mdc': 'x'.repeat(80),
    '.windsurf/rules/model.md': '---\ntrigger: model_decision\ndescription: when deploying\n---\n' + 'w'.repeat(400),
    '.windsurf/rules/glob.md': '---\ntrigger: glob\nglobs: "*.py"\n---\n' + 'w'.repeat(80),
    '.windsurf/rules/on.md': '---\ntrigger: always_on\n---\n' + 'w'.repeat(80),
    '.github/instructions/all.instructions.md': '---\napplyTo: "**"\n---\n' + 'i'.repeat(80),
    '.github/instructions/py.instructions.md': '---\napplyTo: "**/*.py"\n---\n' + 'i'.repeat(80),
    '.clinerules': '---\npaths:\n  - "src/**"\n---\n' + 'k'.repeat(80),
  }));
  const by = Object.fromEntries(r.files.map((f) => [f.file, f]));
  assert.deepEqual(Object.fromEntries(r.files.map((f) => [f.file, f.load])), {
    'CLAUDE.md': 'session', 'AGENTS.md': 'session', '.claude/CLAUDE.md': 'session', 'packages/x/GEMINI.md': 'session',
    '.cursor/rules/always.mdc': 'session', '.windsurf/rules/on.md': 'session', '.github/instructions/all.instructions.md': 'session',
    '.claude/skills/deploy/SKILL.md': 'listed', '.claude/commands/ship.md': 'listed', '.cursor/rules/picked.mdc': 'listed', '.windsurf/rules/model.md': 'listed',
    'api/CLAUDE.md': 'use', '.cursor/rules/ts.mdc': 'use', '.cursor/rules/manual.mdc': 'use', '.windsurf/rules/glob.md': 'use',
    '.github/instructions/py.instructions.md': 'use', '.clinerules': 'use',
  });
  assert.deepEqual(by['CLAUDE.md'].imports.map((i) => i.file), ['docs/rules.md', 'docs/more.md', 'AGENTS.md'], 'read from the folder of the file that imports, never from a code span or a fenced block, and a cycle stops');
  assert.equal(by['CLAUDE.md'].session, by['CLAUDE.md'].own + by['CLAUDE.md'].imported);
  assert.equal(by['.claude/skills/deploy/SKILL.md'].own, Math.round('deploys the app'.length / CHARS_PER_TOKEN));
  assert.deepEqual(by['api/CLAUDE.md'].imports, [{ file: 'api/notes.md', tokens: 100 }, { file: 'AGENTS.md', tokens: 20 }]);
  assert.equal(by['api/CLAUDE.md'].session, 0);
  assert.deepEqual(by['packages/x/GEMINI.md'].imports, [{ file: 'packages/x/extra.md', tokens: 50 }], 'a GEMINI.md imports too');

  const sessionSum = r.files.reduce((n, f) => n + f.session, 0);
  assert.equal(r.stats.session, sessionSum - by['AGENTS.md'].own, 'an AGENTS.md that a CLAUDE.md imports is paid once');
  assert.equal(r.stats.whenUsed, r.files.reduce((n, f) => n + f.tokens - f.own, 0) + 100);
  assert.equal(r.files[0].file, 'CLAUDE.md', 'the cost at every session first');

  const text = renderBudget(r);
  assert.ok(text.includes(`${r.stats.session.toLocaleString('en-US')} tokens at every session and ${r.stats.whenUsed.toLocaleString('en-US')} more when used, at four characters each`));
  assert.ok(text.includes(`every session, +${by['CLAUDE.md'].imported.toLocaleString('en-US')} imported`));
  assert.ok(text.includes(`when used, ${by['.claude/skills/deploy/SKILL.md'].own} listed`));
});

test('an import is followed four hops deep, where Claude Code stops', () => {
  const r = report(committedRepo({ 'CLAUDE.md': '@h1.md\n', 'h1.md': '@h2.md\n', 'h2.md': '@h3.md\n', 'h3.md': '@h4.md\n', 'h4.md': '@h5.md\n', 'h5.md': 'deep\n' }));
  assert.deepEqual(r.files[0].imports.map((i) => i.file), ['h1.md', 'h2.md', 'h3.md', 'h4.md']);
});
