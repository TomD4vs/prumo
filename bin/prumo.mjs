#!/usr/bin/env node
/**
 * prumo — is your documentation still true?
 * CLI entry point: argument parsing, the report, and the fix pass.
 */

import { writeFileSync } from 'node:fs';
import { analyze, resolveTargets, loadConfig, hasRootSkill } from '../src/check.mjs';
import { applyCaseFixes } from '../src/fix.mjs';
import { renderText, renderGithub, renderSarif } from '../src/report.mjs';
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

ARGUMENTS
  repo          path to a git repository (default: current directory)
  target        a markdown file, or a folder of them. Omit to auto-detect
                CLAUDE.md, AGENTS.md, .cursor/rules and friends.

OPTIONS
  --fix         correct case mismatches in place; nothing else is touched
  --format F    text (default), github, json, or sarif
  --all         list every finding instead of the first 25
  --json F      also write the findings to F as JSON
  --sarif F     also write the findings to F as SARIF, for code scanning
  --quiet       print nothing; use the exit code
  --no-config   ignore .prumorc.json
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
  0  nothing to review        1  findings          2  bad usage

EXAMPLES
  prumo
  prumo . docs/notes
  prumo --fix
  prumo --format github
`;

const argv = process.argv.slice(2);

if (argv.includes('-h') || argv.includes('--help')) { process.stdout.write(HELP); process.exit(0); }
if (argv.includes('-v') || argv.includes('--version')) { console.log(VERSION); process.exit(0); }

const valueAt = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? { index: i + 1, value: argv[i + 1] } : { index: -1, value: null };
};

const jsonArg = valueAt('--json');
const sarifArg = valueAt('--sarif');
const formatArg = valueAt('--format');

if (argv.includes('--json') && !jsonArg.value) { console.error('prumo: --json needs a file path'); process.exit(2); }
if (argv.includes('--sarif') && !sarifArg.value) { console.error('prumo: --sarif needs a file path'); process.exit(2); }

const FORMAT = formatArg.value || 'text';
if (!['text', 'github', 'json', 'sarif'].includes(FORMAT)) {
  console.error(`prumo: unknown format "${FORMAT}". Use text, github, json or sarif.`);
  process.exit(2);
}

const KNOWN = new Set(['--all', '--json', '--sarif', '--quiet', '--fix', '--format', '--no-config', '--help', '--version', '-h', '-v']);
const valueIndexes = new Set([jsonArg.index, sarifArg.index, formatArg.index].filter((i) => i > 0));
const unknown = argv.find((a, i) => a.startsWith('-') && !valueIndexes.has(i) && !KNOWN.has(a));
if (unknown) {
  console.error(`prumo: unknown option "${unknown}". Run "prumo --help" to see the options.`);
  process.exit(2);
}

const ALL = argv.includes('--all');
const QUIET = argv.includes('--quiet');
const FIX = argv.includes('--fix');
const positional = argv.filter((a, i) => !a.startsWith('-') && !valueIndexes.has(i));
const repo = positional[0] || '.';

let result, targets, config;
try {
  config = argv.includes('--no-config') ? {} : loadConfig(repo);
  const explicit = positional.slice(1).length ? positional.slice(1) : (config.targets || []);
  try { execSync('git rev-parse --is-inside-work-tree', { cwd: repo, stdio: 'ignore' }); }
  catch { console.error(`prumo: not a git repository: ${repo}`); process.exit(2); }
  targets = resolveTargets(repo, explicit);
  if (!targets.length) {
    console.error(hasRootSkill(repo)
      ? 'prumo: no context files found. This repository has a SKILL.md at the root, which is not detected automatically because at the root that name is usually a template. Check it with "prumo . SKILL.md".'
      : 'prumo: no context files found. Pass one explicitly, or create a CLAUDE.md / AGENTS.md.');
    process.exit(2);
  }
  result = analyze({ repo, targets, config });
} catch (err) {
  console.error(`prumo: ${err.message}`);
  process.exit(2);
}

let fixed = null;
if (FIX && result.caseMismatch.length) {
  fixed = applyCaseFixes(result.caseMismatch, targets);
  result = analyze({ repo, targets, config });
}

const { caseMismatch, brokenLinks, missingPaths, unknownCommands, orphans, stats } = result;
const total = caseMismatch.length + brokenLinks.length + missingPaths.length + unknownCommands.length + orphans.length;

if (jsonArg.value) writeFileSync(jsonArg.value, JSON.stringify(result, null, 2));
if (sarifArg.value) writeFileSync(sarifArg.value, renderSarif(result));

if (!QUIET && FORMAT === 'json') {
  console.log(JSON.stringify(result, null, 2));
} else if (!QUIET && FORMAT === 'sarif') {
  console.log(renderSarif(result));
} else if (!QUIET && FORMAT === 'github') {
  const lines = renderGithub(result);
  if (lines) console.log(lines);
} else if (!QUIET) {
  const color = wantsColor();
  const head = wantsBanner() ? banner(VERSION, { color, github: GITHUB }) + '\n\n' : '';
  console.log(head + renderText(result, { all: ALL, fixed, jsonPath: jsonArg.value, color }));
}

process.exit(total ? 1 : 0);
