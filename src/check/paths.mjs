/**
 * prumo — the paths a note cites, in backticks or on a line of a fenced block, the filters that
 * tell a path of this repository from an example, a placeholder or another project's, and the
 * check that reports a path with the wrong letter case or one git does not track.
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { NEGATION, namesAnotherRepo, conditionalExistence, verdictOn, PRODUCES } from './sentence.mjs';

const ROOTS = /^(app|apps|src|lib|resources|routes|database|config|tests?|public|scripts|bootstrap|packages|components|pages|layouts|server|api|cmd|internal|docs|dist|build|backend|frontend|services|client|\.github|\.claude)\//i;
export const CODE_EXT = /\.(php|vue|js|mjs|cjs|ts|tsx|jsx|css|scss|json|ya?ml|blade\.php|py|go|rb|rs|java|kt|sql|sh|html|toml|md)$/i;
/** A shell variable in front points wherever the variable does, like a home folder or a URL. */
export const OUTSIDE_REPO = /^(~|\/|[A-Za-z]:[\\/]|\.\.\/|https?:|file:|\$)/;
/** `docs.example.com/page.md` and `gesetze-im-internet.de/x.html` start with a host, which is a web address written without its scheme. */
export const HOSTNAME = /^[\w-]+(\.[\w-]+)*\.(com|org|net|io|dev|ai|app|co|edu|gov|de|br|uk|fr|es|it|nl|ch|at|eu|me|info|xyz)\//i;
/** What a note appends to a path to point inside the file: a line number, a GitHub `#L10` anchor, a `::symbol` or a `:symbol`. */
const INSIDE_FILE = /([:#]L?\d+(-L?\d+)?|::?[A-Za-z_$][\w.$]*(\(\))?)$/;
export const WILDCARD = /[<>{}*[\]]|\.\.\.|…/;
/** `path/to/thing.js`, `tests/path/test.py` and `src/foo/bar.test.ts` are how an example spells its argument, not files in this repository. */
export const PLACEHOLDER_PATH = /(^|[/])(path[/]|(foo|bar|baz)([/.]|$))/i;
/** A file each machine writes for itself and never commits: `CLAUDE.local.md`, `settings.local.json`, `.env.local`. */
export const LOCAL_FILE = /(^|\/)[^/]*\.local(\.[A-Za-z0-9]+)?$/i;
/** A skill's path under the folder a host installs it in, cited from wherever the skill actually lives. */
const SKILL_INSTALL = /^\.(?:claude|agents|cursor|codex|windsurf|gemini)\/skills\/(.+)$/;
/** `myplugin.md`, `src/mytopic/mycommand.ts` and `your-app/` are how an example names the thing the reader will create. */
export const EXAMPLE_NAME = /(^|[/])(my|your)-?(app|plugin|topic|command|provider|project|skill|module|component|service|feature|package|file|folder|dir|script|tool|agent|repo|lib|api|test|example|org|name|site)s?([/.]|$)/i;
/** `@scope/package/file.css` is an npm import specifier. An `@/` alias keeps its slash right after the `@`, so it is not one. */
export const SCOPED_PACKAGE = /^@[^/]+\//;
/** `report-YYYY-MM-DD.md`, `product/vX.Y.Z/` and `shots/shot_NN.md` name a file to be created, not one that is here. */
export const TEMPLATE_TOKEN = /\bYYYY(?:[-_]?MM(?:[-_]?DD)?)?\b|\bv?X\.Y\.Z\b|(^|[_\-/])N{2,}([_\-.]|$)/;
/** `src/common/constants.hpp/.cpp` is two files written as one token, never a path. */
const COMPOUND_EXT = /\.[a-z0-9]{1,5}\/\.[a-z0-9]{1,5}$/i;

export const TRANSIENT = /^(public\/(hot|build|storage)|bootstrap\/cache|scratchpad|storage|vendor|managed_components|target)(\/|$)|(^|\/)(\.vite|dist|coverage|\.next|\.nuxt|node_modules|__pycache__)(\/|$)/i;

/** In a command, what marks the next token as the file the command writes. */
const REDIRECT = /^(>|>>|-o|--out|--output|--outfile|--out-file|--output-file|--out-dir|--output-dir|--dest|--destination|-O)$/;
const OUTPUT_FLAG = /^--?(o|out|output|outfile|out-file|output-file|out-dir|output-dir|dest|destination|O)=/;
/** Commands whose arguments are the files or folders they bring into being. */
const CREATES = /^(mkdir|touch|tee)$/;
/** A command that moves or deletes names its old path on purpose. */
const MOVES_OR_DELETES = /^(git\s+)?(mv|rm|del|rename)\b/i;

export const PROMPT = /^[$>]\s+/;
const CODE_COMMENT = /^(#|\/\/)/;

/** What is stripped from a command's argument: a flag's name, quotes and punctuation. A code line also loses brackets and a colon. */
const PROSE_STRIP = /^["']|["'.,;]+$/g;
const CODE_STRIP = /^["'([{<]+|["'.,;:)\]}>]+$/g;
const CALL_PREFIX = /^[\w$.]+[(=]+["'(]*/;
const TREE_GLYPH = /^[│├└─┼┬┴┤|`+\\-]+$/;

/**
 * Splits a command into its arguments, marking the one a redirect, an output flag or a creating
 * command points at, since that argument is the file the command writes.
 */
function tokensOf(span, strip) {
  const raw = span.split(/\s+/);
  const creates = CREATES.test(raw[0]);
  return raw.map((r, i) => ({
    tok: r.replace(/^>+/, '').replace(/^--?[\w-]+=/, '').replace(/\.[_*]+$/, '').replace(strip, '').replace(CALL_PREFIX, ''),
    out: creates || r.startsWith('>') || OUTPUT_FLAG.test(r) || (i > 0 && REDIRECT.test(raw[i - 1])),
  }));
}

/** The tokens that read as paths of this repository, in the spelling the note uses, each with whether the command writes it. */
function pathsAmong(tokens) {
  const found = [];
  for (const { tok: raw, out } of tokens) {
    const tok = raw.includes('\\') ? raw.split('\\').join('/') : raw;
    if (WILDCARD.test(tok) || OUTSIDE_REPO.test(tok) || HOSTNAME.test(tok) || PLACEHOLDER_PATH.test(tok) || EXAMPLE_NAME.test(tok) || SCOPED_PACKAGE.test(tok)) continue;
    if (TEMPLATE_TOKEN.test(tok) || COMPOUND_EXT.test(tok)) continue;
    if (!(ROOTS.test(tok) || (tok.includes('/') && CODE_EXT.test(tok)))) continue;
    found.push({ p: tok.replace(/^\.\//, '').replace(INSIDE_FILE, '').replace(/\/$/, ''), out });
  }
  return found;
}

/**
 * Paths cited in backticks, each with where its span starts on the line. A backtick span with
 * spaces is read as a command, and each of its arguments is tried as a path: `python scripts/seed.py`.
 */
function pathsInProse(line) {
  const found = [];
  for (const m of line.matchAll(/`([^`\n]{3,120})`/g)) {
    const t = m[1].trim();
    if (OUTSIDE_REPO.test(t)) continue;
    let tokens = [{ tok: t, out: false }];
    if (/\s/.test(t)) {
      const first = t.split(/\s+/)[0];
      if (MOVES_OR_DELETES.test(t) || /^\d/.test(first) || (first.includes('/') && !first.startsWith('./'))) continue;
      tokens = tokensOf(t, PROSE_STRIP);
    }
    for (const f of pathsAmong(tokens)) found.push({ ...f, at: m.index, len: m[0].length, command: false });
  }
  return found;
}

/**
 * Paths on a line of a fenced block, read as a command or as a file tree, so every token is tried.
 * A comment line is what a command prints, a line too long to be a command is data, and `./name`
 * with no folder is an argument the reader supplies, like a bare file name in prose. A line with
 * more than one argument is a command, whose program has to be here whatever the block is about.
 */
export function pathsInCode(line) {
  const t = line.trim().replace(PROMPT, '');
  if (!t || t.length > 300 || CODE_COMMENT.test(t) || MOVES_OR_DELETES.test(t)) return [];
  const tokens = tokensOf(t, CODE_STRIP).filter(({ tok }) => tok && !TREE_GLYPH.test(tok) && !(tok.startsWith('./') && !tok.slice(2).includes('/')));
  return pathsAmong(tokens).map((f) => ({ ...f, at: 0, len: line.length, command: tokens.length > 1 }));
}

/** True when a path cited under a host's skills folder exists beside a `SKILL.md` somewhere else in the repository. */
export function installedElsewhere(index, p) {
  const m = p.match(SKILL_INSTALL);
  if (!m) return false;
  const tail = `skills/${m[1]}`;
  return index.known.has(tail) || index.tracked.some((t) => t.endsWith(`/${tail}`));
}

/**
 * The path check on one line: each cited path that resolves with another letter case is a case
 * mismatch, and each that resolves nowhere is a missing path, unless the paragraph says it is
 * gone, another repository's, a condition, or a file that gets written. A path a sentence excuses
 * stays excused on the lines of the file that follow, since they speak of the same file.
 */
export function checkPaths(run, file, i, m) {
  const { index, findings } = run;
  const code = m.kind === 'code';
  const seen = new Set();
  for (const { p, at, len, out, command } of code ? pathsInCode(m.text) : pathsInProse(m.text)) {
    if (seen.has(p) || file.excused.has(p) || TRANSIENT.test(p) || run.transient(p) || run.ignored(p)) continue;
    seen.add(p);
    if (!CODE_EXT.test(p) && !index.known.has(p.split('/')[0])) continue;
    if (p.startsWith('@/') && !index.aliasRoot) continue;

    const r = run.resolve(p, file.folder);
    if (r.state === 'ok') { file.cite(p, false); file.record(i, p, r.real); continue; }
    if (r.state !== 'case' && LOCAL_FILE.test(p)) continue;
    if (r.state === 'missing' && installedElsewhere(index, p)) { file.cite(p, false); continue; }
    const paragraph = file.context(i, m.anchor, 2, 2);
    if (NEGATION.test(paragraph) || namesAnotherRepo(file.context(i, m.anchor, 6, 1), run.own) || (!code && conditionalExistence(m.text, at, len))) { file.excused.add(p); continue; }
    if (r.state !== 'case') {
      const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
      const v = out ? 'produces' : command ? '' : verdictOn(file.lines, file.marked, file.headings, i, m, at, len);
      if (v === 'produces' || (parent && !index.known.has(parent) && PRODUCES.test(paragraph))) { file.excused.add(p); continue; }
    }

    if (r.state === 'case') {
      file.cite(p, false);
      file.record(i, p, r.real);
      findings.caseMismatch.push({ file: file.target.label, line: i + 1, cited: p, actual: r.real });
    } else if (!existsSync(join(run.repo, p)) && !existsSync(join(dirname(file.target.path), p))) {
      file.cite(p, true);
      findings.missingPaths.push({ file: file.target.label, line: i + 1, cited: p, excerpt: file.lines[i].trim().slice(0, 160) });
    } else file.cite(p, false);
  }
}
