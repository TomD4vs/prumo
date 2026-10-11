/**
 * prumo — the command check: a script or a target a note runs, `npm run x`, `make x`, that no
 * package.json, Makefile or composer.json in the repository defines.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTextFile } from './repository.mjs';
import { PROMPT } from './paths.mjs';
import { NEGATION } from './sentence.mjs';

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

/**
 * The scripts and targets this repository defines, read from every package.json, composer.json
 * and Makefile git tracks, so a note anywhere in a monorepo may name any of them. A kind the
 * repository has no file of is null, since then the command belongs to another project. Besides
 * its scripts, `yarn x` and `pnpm x` run a dependency's binary, so those names are accepted too.
 */
function commandSources(repo, tracked) {
  const scripts = new Set(), accepted = new Set(KNOWN_BIN), composer = new Set(), make = new Set();
  let sawNpm = false, sawComposer = false, sawMake = false, dynamic = false;
  const manifest = (p) => { try { return JSON.parse(readFileSync(join(repo, p), 'utf8')) || {}; } catch { return {}; } };
  for (const p of tracked) {
    const name = p.slice(p.lastIndexOf('/') + 1);
    if (name === 'package.json') {
      sawNpm = true;
      const j = manifest(p);
      for (const s of Object.keys(j.scripts || {})) { scripts.add(s); accepted.add(s); }
      for (const d of Object.keys(j.dependencies || {}).concat(Object.keys(j.devDependencies || {}))) accepted.add(d.replace(/^@[^/]+\//, ''));
    } else if (name === 'composer.json') {
      sawComposer = true;
      for (const s of Object.keys(manifest(p).scripts || {})) composer.add(s);
    } else if (/^(GNUmakefile|[Mm]akefile)$/.test(name) || name.endsWith('.mk')) {
      sawMake = true;
      const r = makeTargets(readTextFile(join(repo, p)) || '');
      for (const t of r.targets) make.add(t);
      if (r.dynamic) dynamic = true;
    }
  }
  return {
    scripts: sawNpm ? scripts : null,
    accepted: sawNpm ? accepted : null,
    'composer.json': sawComposer ? composer : null,
    Makefile: sawMake && !dynamic ? make : null,
  };
}

/** `commandSources`, read the first time a note names a command and never again in the run. */
export function makeCommandSources(repo, index) {
  let sources = null;
  return () => sources || (sources = commandSources(repo, index.tracked));
}

/**
 * The scripts and targets a line of commands names: `npm run x`, `yarn x`, `pnpm x`, `bun run x`,
 * `make x` and `composer x`. A chain is split on `&&`, `||`, `;` and `|`; a variable in front,
 * `sudo` and `time` are skipped; a flag that points at another folder or package skips the command.
 * `strict` says the name has to be a script, as `npm run` accepts nothing else.
 */
function commandsIn(text) {
  const found = [];
  const add = (cited, name, source, strict) => { if (!/[./\\*{}$<>[\]]/.test(name)) found.push({ cited, name, source, strict }); };
  for (const seg of text.replace(PROMPT, '').replace(/(^|\s)#.*$/, '').split(/\s*(?:&&|\|\||;|\|)\s*/)) {
    const tok = seg.replace(/(["'])(?:(?!\1).)*\1/g, (q) => (q.includes(' ') ? '' : q)).trim().split(/\s+/).map((t) => t.replace(/^["'`]+|["'`]+$/g, '')).filter(Boolean);
    while (tok.length && (ENV_ASSIGNMENT.test(tok[0]) || tok[0] === 'sudo' || tok[0] === 'time')) tok.shift();
    const [cmd, ...rest] = tok;
    if (!cmd || rest.some((t) => ELSEWHERE_FLAG.test(t))) continue;
    const args = rest.filter((t) => !t.startsWith('-') && !t.includes('='));
    const [first, second] = args;
    if (!first) continue;
    if (cmd === 'npm') {
      if (/^run(-script)?$/.test(first)) { if (second) add(`npm ${first} ${second}`, second, 'package.json', true); }
      else if (/^(test|stop|restart)$/.test(first)) add(`npm ${first}`, first, 'package.json', true);
    } else if (cmd === 'yarn' || cmd === 'pnpm') {
      if (first === 'run') { if (second) add(`${cmd} run ${second}`, second, 'package.json', true); }
      else if (!(cmd === 'yarn' ? YARN_BUILTIN : PNPM_BUILTIN).has(first)) add(`${cmd} ${first}`, first, 'package.json', false);
    } else if (cmd === 'bun') {
      if (first === 'run' && second) add(`bun run ${second}`, second, 'package.json', true);
    } else if (cmd === 'make') {
      for (const t of args) add(`make ${t}`, t, 'Makefile', true);
    } else if (cmd === 'composer') {
      if (/^run(-script)?$/.test(first)) { if (second) add(`composer ${first} ${second}`, second, 'composer.json', true); }
      else if (!COMPOSER_BUILTIN.has(first)) add(`composer ${first}`, first, 'composer.json', true);
    }
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

/**
 * The command check on one line: the commands of a shell block, or of a backtick span with spaces
 * in prose, each reported once per line when nothing in the repository defines what it names.
 */
export function checkCommands(run, file, i, m) {
  const code = m.kind === 'code';
  if (code && !SHELL_LANGUAGE.test(m.lang)) return;
  const spans = code ? [m.text] : [...m.text.matchAll(/`([^`\n]{3,200})`/g)].map((s) => s[1]).filter((s) => /\s/.test(s));
  const seenCommand = new Set();
  for (const span of spans) {
    for (const c of commandsIn(span)) {
      const src = run.sources();
      const defined = c.source === 'package.json' ? (c.strict ? src.scripts : src.accepted) : src[c.source];
      if (!defined || defined.has(c.name) || seenCommand.has(c.cited)) continue;
      seenCommand.add(c.cited);
      if (NEGATION.test(file.context(i, m.anchor, 2, 2))) continue;
      const near = closestName(c.source === 'package.json' ? src.scripts : defined, c.name);
      run.findings.unknownCommands.push({
        file: file.target.label,
        line: i + 1,
        cited: c.cited,
        name: c.name,
        source: c.source,
        suggestion: near ? c.cited.slice(0, -c.name.length) + near : null,
        excerpt: file.lines[i].trim().slice(0, 160),
      });
    }
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
