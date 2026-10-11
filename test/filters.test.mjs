import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

import { analyze, resolveTargets } from '../src/check.mjs';
import { tempDir, repoWith, checkFiles } from './support.mjs';

test('does not flag a path cited to say it is gone', () => {
  const r = checkFiles({
    'CLAUDE.md': 'The project does not publish `config/dompdf.php`.\n',
    'src/a.js': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('exempts a historical entry from path checks', () => {
  const dir = tempDir('prumo-notes-');
  writeFileSync(join(dir, 'phase-2-complete.md'), 'Shipped `app/Gone.php` and `app/Other.php`.\n');

  const repo = repoWith({ 'CLAUDE.md': '# x\n' });
  const r = analyze({ repo, targets: resolveTargets(repo, [dir]) });

  assert.equal(r.missingPaths.length, 0);
  assert.equal(r.stats.historical, 1);
});

test('ignores build artifacts that live outside git', () => {
  const r = checkFiles({ 'CLAUDE.md': 'Assets go to `public/build/manifest.json` via `.vite/x.json`.\n' });
  assert.equal(r.missingPaths.length, 0);
});

test('a path that .gitignore covers is exempt and counted, not reported', () => {
  const r = checkFiles({
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

test('path/to/ is how an example spells its argument, not a file', () => {
  const r = checkFiles({
    'AGENTS.md': 'Run one test with `npm test -- path/to/test.js`.\n\nThe real one is `tests/unit/date.test.js`.\n',
    'tests/unit/date.test.js': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), []);
});

test('an extensionless name whose first segment is no folder here is an identifier, not a path', () => {
  const r = checkFiles({
    'AGENTS.md': 'Support `server/discover` and `tools/list`.\n\nThe helper lives in `src/discover`.\n\nThe old one was in `src/legacy`.\n',
    'src/discover.ts': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['src/legacy']);
});

test('a square bracket marks a placeholder, in a name or a dynamic route', () => {
  const r = checkFiles({
    'AGENTS.md': 'Create `.agents/commands/[name].md` and a page under `src/app/[lang]/page.tsx`.\n',
    'src/app/index.tsx': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('a date or version stencil in a name is a file to be created, not one that is here', () => {
  const r = checkFiles({
    'AGENTS.md': 'Save it as `reports/review-YYYY-MM-DD.md`, and link `product/vX.Y.Z/_index.md`.\n',
    'reports/README.md': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('two files written as one token are not a path, and a dotfile still is', () => {
  const r = checkFiles({
    'AGENTS.md': 'Add it to `src/common/constants.hpp/.cpp`. Secrets live in `config/.env`.\n',
    'src/common/constants.hpp': '',
    'config/app.json': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, 'config/.env');
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
  const r = checkFiles({
    'CLAUDE.md': 'Use the card in `@/components/ui/card.tsx`.\n',
    '.claude/agents/reviewer.md': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('the same alias is still checked where an alias root exists', () => {
  const r = checkFiles({
    'CLAUDE.md': 'Use the card in `@/components/ui/card.tsx`.\n',
    'src/index.ts': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, '@/components/ui/card.tsx');
});

test('a path a sentence tells the agent to write is an output, not a dead path', () => {
  const r = checkFiles({
    'AGENTS.md': 'Output: `docs/reports/summary.md`, one per run.\n',
    'docs/README.md': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('a path simply gone is still reported when nothing says it gets written', () => {
  const r = checkFiles({
    'AGENTS.md': 'The parser is `lib/parsing/reader.js`.\n',
    'src/index.js': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, 'lib/parsing/reader.js');
});

test('a verb that edits a file, like update, presumes it is here', () => {
  const r = checkFiles({
    'AGENTS.md': 'Update `docs/testing-overview.md` after a coverage change.\n',
    'docs/testing-guide.md': '',
  });
  assert.equal(r.missingPaths.length, 1);
  assert.equal(r.missingPaths[0].cited, 'docs/testing-overview.md');
});

test('a path a sentence says gets written is an output even when its folder is here', () => {
  const r = checkFiles({
    'AGENTS.md': 'Output: `docs/report.md`\n\nSave the plan to `docs/plan.md` and the log is written to `docs/run.log`.\n',
    'docs/README.md': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('the verb nearest the path governs it', () => {
  const r = checkFiles({
    'AGENTS.md': 'Read `docs/guide.md` and write the summary to `docs/summary.md`.\n',
    'docs/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['docs/guide.md']);
});

test('a path after "generated by" is the tool, and a numbered or emoji heading is suggested for its bare anchor', () => {
  const r = checkFiles({
    'AGENTS.md': 'IDs are generated by `scripts/claim_id.py`. See [perf](#query-performance) and [personas](#agent-personas).\n\n## 1. Query Performance\n\n## 🎭 Agent Personas\n',
    'scripts/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['scripts/claim_id.py']);
  assert.deepEqual(r.brokenLinks.map((l) => [l.cited, l.suggestion]), [['#query-performance', '#1-query-performance'], ['#agent-personas', '#-agent-personas']]);
});

test('a producing verb after the path counts only in the passive', () => {
  const r = checkFiles({
    'AGENTS.md': '`docs/report.md` is generated by the build.\n`app/Factories/UserFactory.php` creates users.\n',
    'docs/README.md': '',
    'app/Factories/PostFactory.php': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['app/Factories/UserFactory.php']);
});

test('the sentence that introduces a list or a table governs its items', () => {
  const r = checkFiles({
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
  const r = checkFiles({
    'AGENTS.md': '## Output\n\n- `docs/plan.md`\n\n## Files\n\n- `docs/rules.md`\n',
    'docs/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['docs/rules.md']);
});

test('a redirect, an output flag or a creating command marks the file a command writes', () => {
  const r = checkFiles({
    'AGENTS.md': '```\nnode scripts/gen.js > docs/out.md\nmkdir -p docs/new\ncurl -o docs/data.json https://example.test\n```\n',
    'docs/README.md': '',
    'scripts/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['scripts/gen.js']);
});

test('a produced path with the wrong case is still a case mismatch', () => {
  const r = checkFiles({
    'AGENTS.md': 'Output: `docs/Report.md`\n',
    'docs/report.md': '',
  });
  assert.equal(r.caseMismatch.length, 1);
  assert.equal(r.caseMismatch[0].cited, 'docs/Report.md');
});

test('em português, o verbo que produz cala o caminho e o que consome não', () => {
  const r = checkFiles({
    'AGENTS.md': 'Salve o resultado em `docs/resultado.md`. Veja `docs/guia.md` antes de começar.\n',
    'docs/LEIAME.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['docs/guia.md']);
});

test('a file whose cited paths start in folders the repository does not have documents another project, and its findings are held back', () => {
  const files = {
    'CLAUDE.md': 'Models in `app/Models/User.php`, routes in `routes/web.php`, views in `resources/views/home.blade.php`, tests in `tests/Feature/HomeTest.php`, and read `docs/README.md`.\n',
    'docs/README.md': '',
  };
  const r = checkFiles(files);
  assert.equal(r.missingPaths.length, 0);
  assert.deepEqual(r.elsewhere, [{ file: 'CLAUDE.md', cited: 5, absent: 4 }]);
  const named = checkFiles(files, ['CLAUDE.md']);
  assert.equal(named.missingPaths.length, 4);
  assert.equal(named.elsewhere.length, 0);
});

test('a stale note that still cites the folders the repository has is checked in full, and so is a short or a mostly present one', () => {
  const stale = checkFiles({
    'CLAUDE.md': 'See `docs/a.md`, `docs/b.md`, `docs/c.md`, `docs/d.md` and `docs/e.md`.\n',
    'docs/README.md': '',
  });
  assert.equal(stale.missingPaths.length, 5);
  assert.equal(stale.elsewhere.length, 0);
  const few = checkFiles({
    'CLAUDE.md': 'See `app/a.php`, `routes/b.php` and `lib/c.php`.\n',
    'src/index.js': '',
  });
  assert.equal(few.missingPaths.length, 3);
  assert.equal(few.elsewhere.length, 0);
  const mostlyHere = checkFiles({
    'CLAUDE.md': 'See `src/a.js`, `src/b.js`, `src/c.js`, `src/d.js`, `src/e.js`, `src/f.js`, `app/x.php`, `routes/y.php`, `lib/z.php` and `config/w.php`.\n',
    'src/a.js': '', 'src/b.js': '', 'src/c.js': '', 'src/d.js': '', 'src/e.js': '', 'src/f.js': '',
  });
  assert.equal(mostlyHere.missingPaths.length, 4);
  assert.equal(mostlyHere.elsewhere.length, 0);
});

test('a sentence that makes the existence of the file a condition excuses it', () => {
  const r = checkFiles({
    'AGENTS.md': 'If `docs/context.md` exists, read it first. Check whether `docs/notes.md` is present. Se `docs/regras.md` existir, siga. Then read `docs/guide.md`.\n',
    'docs/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((f) => f.cited), ['docs/guide.md']);
});

test('a skill missing its own references is a finding, never a skill for another project', () => {
  const r = checkFiles({
    '.claude/skills/x/SKILL.md': 'See `references/a.md`, `references/b.md`, `scripts/run.py`, `assets/logo.md` and `templates/t.md`.\n',
    'docs/README.md': '',
  });
  assert.equal(r.missingPaths.length, 5);
  assert.equal(r.elsewhere.length, 0);
});

test('a host written without its scheme, a file:// address, a path:symbol, a NN stencil and a quoted argument with spaces', () => {
  const r = checkFiles({
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
  const symbol = checkFiles({ 'AGENTS.md': 'See `src/gone.ts:run`.\n', 'src/index.ts': '' });
  assert.deepEqual(symbol.missingPaths.map((f) => f.cited), ['src/gone.ts']);
});

test('the condition may follow the path, a vendored component is not a target, and three more stencils', () => {
  const r = checkFiles({
    'AGENTS.md': 'Read `.omo/boulder.json` if it exists, and `architecture/profile.yaml` when present. Config loads in `cmd/root.go:initConfig()`. Scan `src/foo.py` and `Memory/YYYYMMDD-update/index.md`.\n',
    'cmd/root.go': '',
    'src/index.py': '',
    'managed_components/vendor__lib/CLAUDE.md': 'See `tools/build.py`.\n',
  });
  assert.equal(r.missingPaths.length, 0);
  assert.equal(r.stats.targets, 1);
});

test('a negation word inside a longer word does not silence the line', () => {
  const r = checkFiles({
    'AGENTS.md': 'Read `lib/parsing/reader.js` whenever the grammar changes.\nO time solicitado revisa `lib/parsing/writer.js`.\n',
    'src/index.js': '',
  });
  assert.deepEqual(r.missingPaths.map((x) => x.cited).sort(), ['lib/parsing/reader.js', 'lib/parsing/writer.js']);
});

test('the same words on their own still silence it', () => {
  const r = checkFiles({
    'AGENTS.md': 'We never shipped `lib/parsing/reader.js`.\nO `lib/parsing/writer.js` sumiu na limpeza.\n',
    'src/index.js': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('a path that starts with a shell variable belongs to wherever the variable points', () => {
  const r = checkFiles({
    'CLAUDE.md': 'Read `$PROJECT_ROOT/docs/gone.md` and `$ENGINE/AGENTS.md`, then `docs/really-gone.md`.\n',
    'docs/README.md': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['docs/really-gone.md']);
});

test('a path a sentence excuses stays excused on the lines of the file that follow', () => {
  const r = checkFiles({
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
  const r = checkFiles({
    'CLAUDE.md': 'Cite a file with line numbers, e.g. `src/api/client.ts:40-55`.\n',
    'src/index.ts': '',
  });
  assert.equal(r.missingPaths.length, 0);
});

test('a folder named path is a placeholder wherever it sits, and a quoted path in prose code is left alone', () => {
  const r = checkFiles({
    'CLAUDE.md': 'Run `pytest tests/path/test.py::test_name -v`, load with `audio.play("sounds/sfx.json")`, and read `src/gone.ts`.\n',
    'src/index.ts': '',
  });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), ['src/gone.ts']);
});

test('a file each machine writes for itself, and a skill cited by its install path, are not missing paths', () => {
  const r = checkFiles({
    'CLAUDE.md': '# app\n\nConfig lives in \x60.claude/content-os.local.md\x60 and [here](.claude/settings.local.json); see \x60config/app.local.php\x60 and \x60config/gone.php\x60.\n\n## Layout\n\nThe real script is \x60scripts/real.sh\x60.\n',
    'plugins/flow/skills/connect/SKILL.md': '---\nname: connect\ndescription: c\n---\nRead \x60.claude/skills/component/SKILL.md\x60 first, run \x60python .claude/skills/connect/scripts/sync.py\x60, then \x60.claude/skills/other/SKILL.md\x60.\n',
    'plugins/flow/skills/component/SKILL.md': '---\nname: component\ndescription: d\n---\nSteps.\n',
    'plugins/flow/skills/connect/scripts/sync.py': '',
    'package.json': '{"name":"x","scripts":{"build":"tsc"}}\n',
    'config/app.php': '',
  });
  assert.deepEqual(r.missingPaths.map((o) => `${o.file}:${o.line} ${o.cited}`), [
    'CLAUDE.md:3 config/gone.php',
    'CLAUDE.md:7 scripts/real.sh',
    'plugins/flow/skills/connect/SKILL.md:5 .claude/skills/other/SKILL.md',
  ], 'the .local files and the two install paths that exist beside the skill are quiet; the rest is reported');
  assert.deepEqual(r.brokenLinks.map((l) => l.cited), [], 'the .local link is quiet');
});

test('a repository whose context files cite mostly absent paths documents another project as a whole, and its findings are held back together', () => {
  const skill = (name, tail) => `---\nname: ${name}\ndescription: d\n---\nSee [a](python/packages/${tail}.py), [b](unittest/scripts/${tail}.js), [c](../../../PORT.md) and [d](../../../CMakeLists.txt).\n`;
  const files = { 'CLAUDE.md': '# app\n\nRead [[concepts/budget]] and [[entities/host]]; see \x60src/app.ts\x60.\n', 'src/app.ts': '' };
  for (const host of ['claude', 'codex', 'opencode']) {
    files[`${host}/plugin/skills/create/SKILL.md`] = skill('create', 'registrar');
    files[`${host}/plugin/skills/review/SKILL.md`] = skill('review', 'review');
  }
  const r = checkFiles(files);
  assert.equal(r.brokenLinks.length + r.missingPaths.length, 0, 'every finding is held back');
  assert.deepEqual(r.elsewhere.map((e) => e.file), ['.']);
  assert.ok(r.elsewhere[0].absent >= 12 && r.elsewhere[0].absent >= r.elsewhere[0].cited * 0.6, JSON.stringify(r.elsewhere));
  assert.equal(r.stats.absent, r.elsewhere[0].absent);
  const named = checkFiles(files, ['CLAUDE.md']);
  assert.deepEqual(named.brokenLinks.map((l) => l.cited), ['concepts/budget', 'entities/host'], 'a named file is checked in full, and a wikilink written with a folder is a path for the gate');

  const stale = checkFiles({
    'CLAUDE.md': '# app\n\nSee \x60src/a.ts\x60, \x60src/b.ts\x60 and [c](src/c.ts).\n',
    'packages/api/AGENTS.md': '# api\n\nSee [x](lib/x.ts), [y](lib/y.ts) and \x60src/z.ts\x60.\n',
    'src/kept.ts': '', 'packages/api/lib/kept.ts': '',
  });
  assert.equal(stale.brokenLinks.length + stale.missingPaths.length, 6, 'notes that cite the folders the repository has are stale, and stay reported');
  assert.deepEqual(stale.elsewhere, []);
});

test('a shell comment ends a command line, the repository name is a prefix before a root file, and "if the repo has" is a condition', () => {
  const repo = repoWith({
    'AGENTS.md': '# app\n\n\x60\x60\x60bash\nmake docs-serve        # serve Documentation-GENERATED-temp at http://localhost:8000\nmake gone              # a target nothing defines\n\x60\x60\x60\n\nParent: \x60prumo-test/AGENTS.md\x60; lane: \x60prumo-test/docs/lane.md\x60. If the repo has a \x60docs/product/\x60 folder, update it there; read \x60docs/gone.md\x60.\n',
    'Makefile': 'docs-serve:\n\ttrue\n',
    'docs/lane.md': '',
  });
  execSync('git remote add origin https://github.com/someone/prumo-test.git', { cwd: repo, stdio: 'ignore' });
  const r = analyze({ repo, targets: resolveTargets(repo, []) });
  assert.deepEqual(r.unknownCommands.map((c) => c.cited), ['make gone'], 'the words after # are a comment, and only the target nothing defines is reported');
  assert.deepEqual(r.missingPaths.map((o) => o.cited), ['docs/gone.md'], 'the repository name before a root file resolves, and a folder the sentence makes conditional is quiet');
});

test('a path the config calls transient, one in an absent folder of a paragraph that writes files, and one on disk git does not track are not reported', () => {
  const repo = repoWith({
    'CLAUDE.md': [
      '# app',
      '',
      'The API schema is `generated/schema.json`, rebuilt on every run.',
      '',
      'Read `out/summary.md` after the build.',
      'The build creates it.',
      '',
      'Notes live in `docs/draft.md` for now.',
    ].join('\n') + '\n',
    'generated/README.md': '',
    'docs/a.md': '',
    '.prumorc.json': JSON.stringify({ transient: ['generated'] }),
  });
  writeFileSync(join(repo, 'docs/draft.md'), '# not committed\n');
  const r = analyze({ repo, targets: resolveTargets(repo, []) });
  assert.deepEqual(r.missingPaths.map((m) => m.cited), []);
});
