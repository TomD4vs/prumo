#!/usr/bin/env node
/**
 * prumo — is your documentation still true?
 * CLI entry point: argument parsing, the report, and the fix pass.
 */

import { writeFileSync } from 'node:fs';
import { analyze, resolveTargets, loadConfig } from '../src/check.mjs';
import { applyCaseFixes } from '../src/fix.mjs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const VERSION = createRequire(import.meta.url)('../package.json').version;

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
  --format F    text (default), github, or json
  --all         list every finding instead of the first 25
  --json F      also write the findings to F as JSON
  --quiet       print nothing; use the exit code
  --no-config   ignore .prumorc.json
  -h, --help
  -v, --version

CONFIG (.prumorc.json, optional)
  { "ignore": ["docs/legacy/**"], "exclude": ["CHANGELOG.md"],
    "targets": ["CLAUDE.md"], "transient": ["public/dist"] }

SUPPRESSING ONE LINE
  <!-- prumo-ignore -->            same line
  <!-- prumo-ignore-next-line -->  the line below
  <!-- prumo-ignore-file -->       the whole file

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
const formatArg = valueAt('--format');

if (argv.includes('--json') && !jsonArg.value) { console.error('prumo: --json needs a file path'); process.exit(2); }

const FORMAT = formatArg.value || 'text';
if (!['text', 'github', 'json'].includes(FORMAT)) {
  console.error(`prumo: unknown format "${FORMAT}". Use text, github or json.`);
  process.exit(2);
}

const KNOWN = new Set(['--all', '--json', '--quiet', '--fix', '--format', '--no-config', '--help', '--version', '-h', '-v']);
const valueIndexes = new Set([jsonArg.index, formatArg.index].filter((i) => i > 0));
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
    console.error('prumo: no context files found. Pass one explicitly, or create a CLAUDE.md / AGENTS.md.');
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

const { caseMismatch, brokenLinks, missingPaths, orphans, stats } = result;
const total = caseMismatch.length + brokenLinks.length + missingPaths.length + orphans.length;

if (jsonArg.value) writeFileSync(jsonArg.value, JSON.stringify(result, null, 2));

if (!QUIET && FORMAT === 'json') {
  console.log(JSON.stringify(result, null, 2));
} else if (!QUIET && FORMAT === 'github') {
  const say = (level, o, msg) => console.log(`::${level} file=${o.file},line=${o.line}::${msg}`);
  for (const o of caseMismatch) say('error', o, `Case mismatch: ${o.cited} should be ${o.actual}`);
  for (const o of brokenLinks) say('warning', o, `Broken link: ${o.cited}${o.suggestion ? ` — did you mean ${o.suggestion}?` : ''}`);
  for (const o of missingPaths) say('warning', o, `Missing path: ${o.cited}`);
  for (const o of orphans) console.log(`::notice::Not in index: ${o}`);
} else if (!QUIET) {
  const out = [];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const cap = (list) => (ALL ? list : list.slice(0, 25));
  const more = (list) => (!ALL && list.length > 25 ? `  … ${list.length - 25} more (use --all)\n` : '');

  out.push(`prumo — ${plural(stats.targets, 'context file', 'context files')}, ${plural(stats.tracked, 'file', 'files')} in the git index`);
  if (stats.historical) out.push(`        ${plural(stats.historical, 'historical entry', 'historical entries')} exempt from path checks`);
  if (stats.suppressed) out.push(`        ${plural(stats.suppressed, 'line or file', 'lines or files')} suppressed by a prumo-ignore marker`);
  out.push('');

  if (fixed) {
    out.push(`FIXED  ${plural(fixed.paths, 'path', 'paths')} in ${plural(fixed.files, 'file', 'files')}`);
    for (const c of fixed.changes) out.push(`  ${c.file}:${c.line}   ${c.cited}  ->  ${c.actual}`);
    for (const s of fixed.skipped) out.push(`  skipped ${s.file}:${s.line} (${s.why})`);
    out.push('');
  }

  if (caseMismatch.length) {
    out.push(`CASE MISMATCH  (${caseMismatch.length})   resolves on Windows and macOS, breaks on Linux and CI`);
    for (const o of cap(caseMismatch)) out.push(`  ${o.file}:${o.line}`, `      ${o.cited}`, `      ->  ${o.actual}`);
    out.push(more(caseMismatch) + '');
  }

  if (brokenLinks.length) {
    const withHint = brokenLinks.filter((l) => l.suggestion).length;
    out.push(`BROKEN LINK  (${brokenLinks.length})${withHint ? `   ${withHint} with a likely destination` : ''}`);
    for (const o of cap(brokenLinks)) {
      const shown = o.kind === 'wikilink' ? `[[${o.cited}]]` : o.cited;
      out.push(`  ${o.file}:${o.line}  ${shown}${o.suggestion ? `   ->  ${o.suggestion}` : ''}`);
    }
    out.push(more(brokenLinks) + '');
  }

  if (orphans.length) {
    out.push(`NOT IN INDEX  (${orphans.length})   file the index never references`);
    for (const o of cap(orphans)) out.push(`  ${o}`);
    out.push(more(orphans) + '');
  }

  if (missingPaths.length) {
    out.push(`MISSING PATH  (${missingPaths.length})   paths cited to say they are gone were filtered out`);
    for (const o of cap(missingPaths)) out.push(`  ${o.file}:${o.line}  ${o.cited}`, `      ${o.excerpt}`);
    out.push(more(missingPaths) + '');
  }

  out.push(total ? `${total} to review` : 'nothing to review.');
  if (jsonArg.value) out.push(`json: ${jsonArg.value}`);
  console.log(out.join('\n'));
}

process.exit(total ? 1 : 0);
