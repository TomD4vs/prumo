import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTextFile } from './repository.mjs';
import { PROMPT } from './paths.mjs';
import { NEGATION } from './sentence.mjs';
import { decide } from './rules.mjs';

const SHELL_LANGUAGE = /^(bash|sh|shell|zsh|fish|console|terminal|cmd|bat|powershell|ps1?|pwsh|text|txt|plaintext|plain|makefile|make|dockerfile)?$/;
const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=/;
const ELSEWHERE_FLAG = /^(-w|--workspaces?|-C|--directory|--dir|-f|--file|--filter|-r|--recursive|--cwd|--prefix)(=.*)?$/;
const YARN_BUILTIN = new Set('access add audit autoclean bin cache check config constraints create dedupe dlx exec explain generate-lock-entry global help import info init install licenses link list login logout node outdated owner pack patch patch-commit plugin policies publish rebuild remove run search set stage tag team unlink unplug up upgrade upgrade-interactive version versions why workspace workspaces'.split(' '));
const PNPM_BUILTIN = new Set('add install i update up upgrade remove rm uninstall un link unlink import rebuild rb prune fetch dedupe patch patch-commit patch-remove audit licenses outdated list ls why run exec dlx create publish pack recursive server store env setup init deploy doctor config cat-file cat-index find-hash approve-builds ignored-builds self-update root bin help version'.split(' '));
const COMPOSER_BUILTIN = new Set('about archive audit browse bump check-platform-reqs clear-cache clearcache cc completion config create-project depends diagnose dump-autoload dumpautoload exec fund global help home init install i licenses list outdated prohibits reinstall remove require run run-script search self-update selfupdate show status suggests update u upgrade validate why why-not'.split(' '));
const KNOWN_BIN = new Set(['tsc', 'tsserver', 'playwright', 'commitlint', 'changeset', 'svelte-kit', 'ng', 'sb', 'nest', 'remix', 'eas', 'firebase', 'netlify', 'biome']);

/** The targets a Makefile defines. A target built from a variable or a pattern cannot be listed, so the file is marked dynamic and the check stands down. */
function makeTargets(body) {
  const targets = new Set();
  let dynamic = false;
  for (const raw of body.split(/\r?\n/)) {
    if (raw.startsWith('\t')) continue;
    const m = raw.replace(/#.*$/, '').match(/^([^\s:=#][^:=]*?)\s*::?(?!=)/);
    if (!m) continue;
    for (const name of m[1].trim().split(/\s+/)) {
      if (/[%$]/.test(name)) dynamic = true;
      else if (/^[\w./-]+$/.test(name)) targets.add(name);
    }
  }
  return { targets, dynamic };
}

const MANIFESTS = [
  {
    kind: 'npm', match: (name) => name === 'package.json',
    read: (acc, json) => {
      const j = json();
      for (const s of Object.keys(j.scripts || {})) { acc.scripts.add(s); acc.accepted.add(s); }
      for (const d of Object.keys(j.dependencies || {}).concat(Object.keys(j.devDependencies || {}))) acc.accepted.add(d.replace(/^@[^/]+\//, ''));
    },
  },
  { kind: 'composer', match: (name) => name === 'composer.json', read: (acc, json) => { for (const s of Object.keys(json().scripts || {})) acc.composer.add(s); } },
  {
    kind: 'make', match: (name) => /^(GNUmakefile|[Mm]akefile)$/.test(name) || name.endsWith('.mk'),
    read: (acc, json, text) => {
      const r = makeTargets(text() || '');
      for (const t of r.targets) acc.make.add(t);
      acc.dynamic ||= r.dynamic;
    },
  },
];

/**
 * The scripts and targets this repository defines, read from every package.json, composer.json
 * and Makefile git tracks, so a note anywhere in a monorepo may name any of them. A kind the
 * repository has no file of is null, since then the command belongs to another project. Besides
 * its scripts, `yarn x` and `pnpm x` run a dependency's binary, so those names are accepted too.
 */
function commandSources(repo, tracked) {
  const acc = { scripts: new Set(), accepted: new Set(KNOWN_BIN), composer: new Set(), make: new Set(), dynamic: false, saw: new Set() };
  for (const p of tracked) {
    const manifest = MANIFESTS.find((m) => m.match(p.slice(p.lastIndexOf('/') + 1)));
    if (!manifest) continue;
    acc.saw.add(manifest.kind);
    manifest.read(acc, () => { try { return JSON.parse(readFileSync(join(repo, p), 'utf8')) || {}; } catch { return {}; } }, () => readTextFile(join(repo, p)));
  }
  const ifSeen = (kind, set) => (acc.saw.has(kind) ? set : null);
  return {
    scripts: ifSeen('npm', acc.scripts),
    accepted: ifSeen('npm', acc.accepted),
    'composer.json': ifSeen('composer', acc.composer),
    Makefile: acc.dynamic ? null : ifSeen('make', acc.make),
  };
}

/** `commandSources`, read the first time a note names a command and never again in the run. */
export function makeCommandSources(repo, index) {
  let sources = null;
  return () => sources || (sources = commandSources(repo, index.tracked));
}

/** A command a note runs: as written, the name it asks for, the file that should define it, and whether only a script will do. */
const command = (cited, name, source, strict) => ({ cited, name, source, strict });
/** `x run name`, which names a script whatever the runner, and names nothing without the name. */
const runScript = (cmd, first, second, source) => (second ? [command(`${cmd} ${first} ${second}`, second, source, true)] : []);
/** `yarn x` and `pnpm x` run a script or a dependency's binary, unless `x` is a command of their own. */
const runOrBinary = (cmd, builtins) => ({ first, second }) => (first === 'run' ? runScript(cmd, first, second, 'package.json') : builtins.has(first) ? [] : [command(`${cmd} ${first}`, first, 'package.json', false)]);

const RUNNERS = new Map([
  ['npm', ({ first, second }) => (/^run(-script)?$/.test(first) ? runScript('npm', first, second, 'package.json') : /^(test|stop|restart)$/.test(first) ? [command(`npm ${first}`, first, 'package.json', true)] : [])],
  ['yarn', runOrBinary('yarn', YARN_BUILTIN)],
  ['pnpm', runOrBinary('pnpm', PNPM_BUILTIN)],
  ['bun', ({ first, second }) => (first === 'run' ? runScript('bun', first, second, 'package.json') : [])],
  ['make', ({ args }) => args.map((t) => command(`make ${t}`, t, 'Makefile', true))],
  ['composer', ({ first, second }) => (/^run(-script)?$/.test(first) ? runScript('composer', first, second, 'composer.json') : COMPOSER_BUILTIN.has(first) ? [] : [command(`composer ${first}`, first, 'composer.json', true)])],
]);

/**
 * The scripts and targets a line of commands names: `npm run x`, `yarn x`, `pnpm x`, `bun run x`,
 * `make x` and `composer x`. A chain is split on `&&`, `||`, `;` and `|`; a variable in front,
 * `sudo` and `time` are skipped; a flag that points at another folder or package skips the command.
 * `strict` says the name has to be a script, as `npm run` accepts nothing else. A name that holds a
 * dot, a slash, a glob or a variable is a path or a template, not a script.
 */
function commandsIn(text) {
  const found = [];
  for (const seg of text.replace(PROMPT, '').replace(/(^|\s)#.*$/, '').split(/\s*(?:&&|\|\||;|\|)\s*/)) {
    const tok = seg.replace(/(["'])(?:(?!\1).)*\1/g, (q) => (q.includes(' ') ? '' : q)).trim().split(/\s+/).map((t) => t.replace(/^["'`]+|["'`]+$/g, '')).filter(Boolean);
    while (tok.length && (ENV_ASSIGNMENT.test(tok[0]) || tok[0] === 'sudo' || tok[0] === 'time')) tok.shift();
    const [cmd, ...rest] = tok;
    const runner = RUNNERS.get(cmd);
    const args = rest.filter((t) => !t.startsWith('-') && !t.includes('='));
    if (!runner || !args.length || rest.some((t) => ELSEWHERE_FLAG.test(t))) continue;
    found.push(...runner({ first: args[0], second: args[1], args }).filter((c) => !/[./\\*{}$<>[\]]/.test(c.name)));
  }
  return found;
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** The defined name a typo most likely meant: the same letters once `-`, `_` and `:` are dropped, or at most two edits away. */
function closestName(names, name) {
  const loose = (s) => s.toLowerCase().replace(/[-_:]/g, '');
  const want = loose(name);
  let best = null, bestDistance = 3;
  for (const n of names) {
    if (loose(n) === want) return n;
    const d = editDistance(n.toLowerCase(), name.toLowerCase());
    if (d < bestDistance) { bestDistance = d; best = n; }
  }
  return best;
}

/** One command on a line, with the names the repository defines for its kind, or null when it has no file of that kind. */
function commandCitation(run, file, i, m, c) {
  const src = run.sources();
  return { run, file, i, m, kind: 'command', ...c, src, defined: c.source === 'package.json' ? (c.strict ? src.scripts : src.accepted) : src[c.source] };
}

const COMMAND_RULES = [
  { when: (x) => !x.defined, outcome: 'excused', reason: (x) => `the repository has no ${x.source}, so the command belongs to another project, or the Makefile builds its targets` },
  { when: (x) => x.defined.has(x.name), outcome: 'resolved', reason: (x) => `defined in a ${x.source} of the repository` },
  { when: (x) => NEGATION.test(x.file.context(x.i, x.m.anchor, 2, 2)), outcome: 'excused', reason: 'the paragraph says the command is gone, renamed, or only an example' },
  {
    when: () => true, outcome: 'reported', reason: 'UNKNOWN COMMAND',
    act: (x) => {
      const near = closestName(x.source === 'package.json' ? x.src.scripts : x.defined, x.name);
      x.run.findings.unknownCommands.push({
        file: x.file.target.label,
        line: x.i + 1,
        cited: x.cited,
        name: x.name,
        source: x.source,
        suggestion: near ? x.cited.slice(0, -x.name.length) + near : null,
        excerpt: x.file.lines[x.i].trim().slice(0, 160),
      });
    },
  },
];

/**
 * The command check on one line: the commands of a shell block, or of a backtick span with spaces
 * in prose, each decided once per line by `COMMAND_RULES`, and reported when nothing in the
 * repository defines what it names.
 */
export function checkCommands(run, file, i, m) {
  const code = m.kind === 'code';
  if (code && !SHELL_LANGUAGE.test(m.lang)) return;
  const spans = code ? [m.text] : [...m.text.matchAll(/`([^`\n]{3,200})`/g)].map((s) => s[1]).filter((s) => /\s/.test(s));
  const seen = new Set();
  for (const c of spans.flatMap(commandsIn)) {
    if (seen.has(c.cited)) continue;
    seen.add(c.cited);
    decide(COMMAND_RULES, commandCitation(run, file, i, m, c));
  }
}

/**
 * Drops, from the commands one file reported, every name the file runs through more than one
 * runner, `npm run x` and `make x`: a note that offers both is describing alternatives, and only
 * one of them has to exist. `from` is where the file's findings start in the list.
 */
export function dropAlternatives(unknownCommands, from) {
  const runners = new Map();
  for (const c of unknownCommands.slice(from)) {
    const set = runners.get(c.name) || new Set();
    set.add(c.cited.split(' ')[0]);
    runners.set(c.name, set);
  }
  if ([...runners.values()].some((set) => set.size > 1)) {
    const kept = unknownCommands.slice(from).filter((c) => runners.get(c.name).size < 2);
    unknownCommands.splice(from, unknownCommands.length, ...kept);
  }
}
