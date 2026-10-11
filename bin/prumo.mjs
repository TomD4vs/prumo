#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, resolveTargets, loadConfig, loadBaseline, baselineOf, changedFiles, hasRootSkill, BASELINE_FILE } from '../src/check.mjs';
import { applyFixes, renameFixes } from '../src/fix.mjs';
import { renderText, renderGithub, renderSarif, renderDrift, renderBudget, renderCoverage, renderExplain } from '../src/report.mjs';
import { drift } from '../src/drift.mjs';
import { budget } from '../src/budget.mjs';
import { coverage } from '../src/coverage.mjs';
import { explain } from '../src/explain.mjs';
import { banner, wantsBanner, wantsColor } from '../src/banner.mjs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const PKG = createRequire(import.meta.url)('../package.json');
const VERSION = PKG.version;
const GITHUB = (String((PKG.repository && PKG.repository.url) || PKG.homepage || '').match(/github\.com[/:]([\w.-]+)/) || [])[1] || '';

const HELP = `
prumo ${VERSION} — is your documentation still true?

  Checks the context files your coding agent reads against the code beside them.

USAGE
  prumo [repo] [target...] [options]
  prumo drift  [repo] [target...]   which sections describe code that changed since they were written
  prumo budget [repo] [target...]   what each context file costs the agent, and what is written twice
  prumo coverage [repo] [target...] which folders of the code no context file mentions, most active first

ARGUMENTS
  repo          path to a git repository (default: current directory)
  target        a markdown file, or a folder of them. Omit to auto-detect
                CLAUDE.md, AGENTS.md, .cursor/rules and friends.

OPTIONS
  --fix         correct case mismatches and the renames git recorded, in place; nothing else is touched
  --format F    text (default), github, json, or sarif; a report takes text or json
  --all         list every finding instead of the first 25
  --json F      also write the findings to F as JSON
  --sarif F     also write the findings to F as SARIF, for code scanning
  --quiet       print nothing; use the exit code
  --no-config   ignore .prumorc.json
  --baseline    record the current findings in .prumo-baseline.json; later runs fail only on what is new
  --no-baseline ignore .prumo-baseline.json for this run
  --staged      check only the context files staged for commit
  --since REF   check only the context files changed since REF, a commit or a branch;
                with budget, compare sizes with REF (default: the commit thirty days ago)
  --explain F:L why line L of the context file F was or was not reported, citation by citation
  -h, --help
  -v, --version

CONFIG (.prumorc.json, optional)
  { "ignore": ["docs/legacy/**"], "exclude": ["CHANGELOG.md"],
    "targets": ["CLAUDE.md"], "transient": ["public/dist"] }

SUPPRESSING ONE LINE
  <!-- prumo-ignore -->            same line
  <!-- prumo-ignore-next-line -->  the line below, or the whole fenced block below
  <!-- prumo-ignore-file -->       the whole file

ENVIRONMENT
  PRUMO_BANNER=0   no name and version above the report; =1 shows them even in a pipe
  NO_COLOR=1       plain text in a terminal

EXIT CODE
  0  nothing to review, or a report        1  findings          2  bad usage

EXAMPLES
  prumo
  prumo . docs/notes
  prumo --fix
  prumo --format github
  prumo --since origin/main
  prumo --explain CLAUDE.md:12
  prumo drift
  prumo budget --since v1.0.0
  prumo coverage
`;

const argv = process.argv.slice(2);

const ASKED = [
  [['-h', '--help'], () => process.stdout.write(HELP)],
  [['-v', '--version'], () => console.log(VERSION)],
];
const asked = ASKED.find(([flags]) => flags.some((f) => argv.includes(f)));
if (asked) { asked[1](); process.exit(0); }

const REPORTS = new Map([
  ['drift', { run: ({ repo, targets, config }) => drift({ repo, targets, config }), render: renderDrift, options: [] }],
  ['budget', { run: ({ repo, targets, config, since }) => budget({ repo, targets, config, since }), render: renderBudget, options: ['--since'] }],
  ['coverage', { run: ({ repo, targets, config }) => coverage({ repo, targets, config }), render: renderCoverage, options: [] }],
]);
const COMMAND = REPORTS.has(argv[0]) ? argv.shift() : null;
const REPORT = REPORTS.get(COMMAND);

/** The value after a flag, and where it sits, so it is not read as a target. */
const valueAt = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? { index: i + 1, value: argv[i + 1] } : { index: -1, value: null };
};

const jsonArg = valueAt('--json');
const sarifArg = valueAt('--sarif');
const formatArg = valueAt('--format');
const sinceArg = valueAt('--since');
const explainArg = valueAt('--explain');
const FORMAT = formatArg.value || 'text';
const FORMATS = COMMAND || argv.includes('--explain') ? ['text', 'json'] : ['text', 'github', 'json', 'sarif'];
const CHECK_ONLY = new Set(['--sarif', '--quiet', '--fix', '--baseline', '--no-baseline', '--staged', '--since', '--explain']);
const NOT_WITH_EXPLAIN = ['--fix', '--baseline', '--staged', '--since', '--sarif', '--quiet'];
const KNOWN = new Set(['--all', '--json', '--sarif', '--quiet', '--fix', '--format', '--no-config', '--baseline', '--no-baseline', '--staged', '--since', '--explain', '--help', '--version', '-h', '-v']);
const valueIndexes = new Set([jsonArg.index, sarifArg.index, formatArg.index, sinceArg.index, explainArg.index].filter((i) => i > 0));
const flags = argv.filter((a, i) => a.startsWith('-') && !valueIndexes.has(i));
const has = (flag) => argv.includes(flag);

const USAGE_ERRORS = [
  { when: () => has('--json') && !jsonArg.value, message: '--json needs a file path' },
  { when: () => has('--sarif') && !sarifArg.value, message: '--sarif needs a file path' },
  { when: () => has('--since') && !sinceArg.value, message: '--since needs a commit or a branch' },
  { when: () => has('--since') && has('--staged'), message: 'use --staged or --since, one at a time' },
  { when: () => has('--explain') && !explainArg.value, message: '--explain needs FILE:LINE, as in CLAUDE.md:12' },
  { when: () => !COMMAND && has('--explain') && NOT_WITH_EXPLAIN.some(has), message: () => `${NOT_WITH_EXPLAIN.find(has)} does not go with --explain, which only reads one line` },
  { when: () => !FORMATS.includes(FORMAT), message: () => `unknown format "${FORMAT}". Use ${FORMATS.length === 2 ? 'text or json' : 'text, github, json or sarif'}.` },
  { when: () => flags.some((a) => !KNOWN.has(a)), message: () => `unknown option "${flags.find((a) => !KNOWN.has(a))}". Run "prumo --help" to see the options.` },
  { when: () => REPORT && flags.some((a) => CHECK_ONLY.has(a) && !REPORT.options.includes(a)), message: () => `${flags.find((a) => CHECK_ONLY.has(a) && !REPORT.options.includes(a))} is not an option of "prumo ${COMMAND}". Run "prumo --help" to see the options.` },
];
const usage = USAGE_ERRORS.find((u) => u.when());
if (usage) { console.error(`prumo: ${typeof usage.message === 'function' ? usage.message() : usage.message}`); process.exit(2); }

const ALL = has('--all');
const positional = argv.filter((a, i) => !a.startsWith('-') && !valueIndexes.has(i));
const repo = positional[0] || '.';

/** Stops the run with exit 2, which a usage error and a repository that cannot be read share. */
const stop = (message) => { console.error(`prumo: ${message}`); process.exit(2); };

/** The context files of the run: the ones named, the ones `.prumorc.json` lists, or the ones found; none is an error that says why. */
function targetsOf(config) {
  const explicit = positional.slice(1).length ? positional.slice(1) : (config.targets || []);
  try { execSync('git rev-parse --is-inside-work-tree', { cwd: repo, stdio: 'ignore' }); } catch { stop(`not a git repository: ${repo}`); }
  const targets = resolveTargets(repo, explicit);
  if (targets.length) return targets;
  return stop(hasRootSkill(repo)
    ? 'no context files found. This repository has a SKILL.md at the root, which is not detected automatically because at the root that name is usually a template. Check it with "prumo . SKILL.md".'
    : 'no context files found. Pass one explicitly, or create a CLAUDE.md / AGENTS.md.');
}

/** The check: limited to what a commit or a branch changed when asked, with the baseline at the root unless it is being written or set aside. */
function check({ targets, config }) {
  const only = has('--staged') || sinceArg.value ? { paths: changedFiles(repo, { staged: has('--staged'), since: sinceArg.value || '' }), label: has('--staged') ? 'staged' : `since ${sinceArg.value}` } : null;
  const baseline = has('--baseline') || has('--no-baseline') ? null : loadBaseline(repo);
  return { result: analyze({ repo, targets, config, baseline, only }), rerun: () => analyze({ repo, targets, config, baseline, only }) };
}

/** The name and version above a report, for a person at a terminal. */
const head = (color) => (wantsBanner() ? banner(VERSION, { color, github: GITHUB }) + '\n\n' : '');

const EXPLAIN = { run: ({ repo, targets, config }) => explain({ repo, targets, config, at: explainArg.value, baseline: has('--no-baseline') ? null : loadBaseline(repo) }), render: renderExplain };
const SHOWN = REPORT || (explainArg.value ? EXPLAIN : null);

let run;
try {
  const config = has('--no-config') ? {} : loadConfig(repo);
  const targets = targetsOf(config);
  run = { config, targets, ...(SHOWN ? { result: SHOWN.run({ repo, targets, config, since: sinceArg.value || '' }) } : check({ targets, config })) };
} catch (err) {
  stop(err.message);
}

if (SHOWN) {
  if (jsonArg.value) writeFileSync(jsonArg.value, JSON.stringify(run.result, null, 2));
  const color = wantsColor();
  console.log(FORMAT === 'json' ? JSON.stringify(run.result, null, 2) : head(color) + SHOWN.render(run.result, { all: ALL, color, jsonPath: jsonArg.value }));
  process.exit(0);
}

const changes = has('--fix') ? [...run.result.caseMismatch, ...renameFixes(run.result)] : [];
const fixed = changes.length ? applyFixes(changes, run.targets) : null;
const result = fixed ? run.rerun() : run.result;
const total = ['caseMismatch', 'brokenLinks', 'missingPaths', 'unknownCommands', 'configIssues', 'orphans'].reduce((n, k) => n + result[k].length, 0);

const baselineEntries = has('--baseline') ? baselineOf(result) : null;
if (baselineEntries) writeFileSync(join(repo, BASELINE_FILE), JSON.stringify(baselineEntries, null, 2) + '\n');
const recorded = baselineEntries ? baselineEntries.findings.reduce((n, e) => n + e.count, 0) : null;

if (jsonArg.value) writeFileSync(jsonArg.value, JSON.stringify(result, null, 2));
if (sarifArg.value) writeFileSync(sarifArg.value, renderSarif(result));

const OUTPUTS = {
  json: () => JSON.stringify(result, null, 2),
  sarif: () => renderSarif(result),
  github: () => renderGithub(result) || null,
  text: () => { const color = wantsColor(); return head(color) + renderText(result, { all: ALL, fixed, jsonPath: jsonArg.value, color, baselineWritten: recorded }); },
};
const printed = has('--quiet') ? null : OUTPUTS[FORMAT]();
if (printed !== null) console.log(printed);

process.exit(has('--baseline') || !total ? 0 : 1);
