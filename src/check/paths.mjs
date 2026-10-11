import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { NEGATION, namesAnotherRepo, conditionalExistence, verdictOn, PRODUCES } from './sentence.mjs';
import { decide } from './rules.mjs';

const ROOTS = /^(app|apps|src|lib|resources|routes|database|config|tests?|public|scripts|bootstrap|packages|components|pages|layouts|server|api|cmd|internal|docs|dist|build|backend|frontend|services|client|\.github|\.claude)\//i;
export const CODE_EXT = /\.(php|vue|js|mjs|cjs|ts|tsx|jsx|css|scss|json|ya?ml|blade\.php|py|go|rb|rs|java|kt|sql|sh|html|toml|md)$/i;
export const OUTSIDE_REPO = /^(~|\/|[A-Za-z]:[\\/]|\.\.\/|https?:|file:|\$)/;
export const HOSTNAME = /^[\w-]+(\.[\w-]+)*\.(com|org|net|io|dev|ai|app|co|edu|gov|de|br|uk|fr|es|it|nl|ch|at|eu|me|info|xyz)\//i;
const INSIDE_FILE = /([:#]L?\d+(-L?\d+)?|::?[A-Za-z_$][\w.$]*(\(\))?)$/;
export const WILDCARD = /[<>{}*[\]]|\.\.\.|…/;
export const PLACEHOLDER_PATH = /(^|[/])(path[/]|(foo|bar|baz)([/.]|$))/i;
export const LOCAL_FILE = /(^|\/)[^/]*\.local(\.[A-Za-z0-9]+)?$/i;
const SKILL_INSTALL = /^\.(?:claude|agents|cursor|codex|windsurf|gemini)\/skills\/(.+)$/;
export const EXAMPLE_NAME = /(^|[/])(my|your)-?(app|plugin|topic|command|provider|project|skill|module|component|service|feature|package|file|folder|dir|script|tool|agent|repo|lib|api|test|example|org|name|site)s?([/.]|$)/i;
export const SCOPED_PACKAGE = /^@[^/]+\//;
export const TEMPLATE_TOKEN = /\bYYYY(?:[-_]?MM(?:[-_]?DD)?)?\b|\bv?X\.Y\.Z\b|(^|[_\-/])N{2,}([_\-.]|$)/;
const COMPOUND_EXT = /\.[a-z0-9]{1,5}\/\.[a-z0-9]{1,5}$/i;

export const TRANSIENT = /^(public\/(hot|build|storage)|bootstrap\/cache|scratchpad|storage|vendor|managed_components|target)(\/|$)|(^|\/)(\.vite|dist|coverage|\.next|\.nuxt|node_modules|__pycache__)(\/|$)/i;

const REDIRECT = /^(>|>>|-o|--out|--output|--outfile|--out-file|--output-file|--out-dir|--output-dir|--dest|--destination|-O)$/;
const OUTPUT_FLAG = /^--?(o|out|output|outfile|out-file|output-file|out-dir|output-dir|dest|destination|O)=/;
const CREATES = /^(mkdir|touch|tee)$/;
const MOVES_OR_DELETES = /^(git\s+)?(mv|rm|del|rename)\b/i;

export const PROMPT = /^[$>]\s+/;
const CODE_COMMENT = /^(#|\/\/)/;

const PROSE_STRIP = /^["']|["'.,;]+$/g;
const CODE_STRIP = /^["'([{<]+|["'.,;:)\]}>]+$/g;
const CALL_PREFIX = /^[\w$.]+[(=]+["'(]*/;
const TREE_GLYPH = /^[│├└─┼┬┴┤|`+\\-]+$/;

/**
 * Splits a command into its arguments, marking the one a redirect, an output flag or a creating
 * command points at, since that argument is the file the command writes. Each argument loses a flag's
 * name, quotes and trailing punctuation; on a line of code, brackets and a colon as well.
 */
function tokensOf(span, strip) {
  const raw = span.split(/\s+/);
  const creates = CREATES.test(raw[0]);
  return raw.map((r, i) => ({
    tok: r.replace(/^>+/, '').replace(/^--?[\w-]+=/, '').replace(/\.[_*]+$/, '').replace(strip, '').replace(CALL_PREFIX, ''),
    out: creates || r.startsWith('>') || OUTPUT_FLAG.test(r) || (i > 0 && REDIRECT.test(raw[i - 1])),
  }));
}

const NOT_A_PATH = [
  [WILDCARD, 'a glob or a template, not one file'],
  [OUTSIDE_REPO, 'outside the repository: a home folder, an absolute path, an address or a variable'],
  [HOSTNAME, 'a web address written without its scheme'],
  [PLACEHOLDER_PATH, 'a placeholder, as path/to/, foo or bar'],
  [EXAMPLE_NAME, 'an example name, as my-app or your-project'],
  [SCOPED_PACKAGE, 'an npm package specifier'],
  [TEMPLATE_TOKEN, 'a file to be created, named by a date or version stencil'],
  [COMPOUND_EXT, 'two files written as one token'],
];

export const NOT_A_LINK = NOT_A_PATH.filter(([re]) => re !== OUTSIDE_REPO && re !== COMPOUND_EXT);

/**
 * The tokens that read as paths of this repository, in the spelling the note uses, each with whether
 * the command writes it. A token with a folder that a filter turned down comes back too, with `why`,
 * and so does a bare file name, which is never checked as a path, so `--explain` can say both.
 * What a note appends to point inside the file, a line number, a GitHub `#L10` anchor, a `::symbol`
 * or a `:symbol`, is dropped, and so is a `./` in front.
 */
function pathsAmong(tokens) {
  const found = [];
  for (const { tok: raw, out } of tokens) {
    const tok = raw.includes('\\') ? raw.split('\\').join('/') : raw;
    const filter = NOT_A_PATH.find(([re]) => re.test(tok));
    if (filter) { if (tok.includes('/')) found.push({ p: tok, why: filter[1] }); continue; }
    const shaped = ROOTS.test(tok) || (tok.includes('/') && CODE_EXT.test(tok));
    if (!shaped && CODE_EXT.test(tok)) found.push({ p: tok, why: 'a bare file name, with no folder, is not checked as a path' });
    if (!shaped) continue;
    found.push({ p: tok.replace(/^\.\//, '').replace(INSIDE_FILE, '').replace(/\/$/, ''), out });
  }
  return found;
}

/**
 * Paths cited in backticks, each with where its span starts on the line. A backtick span with
 * spaces is read as a command, and each of its arguments is tried as a path: `python scripts/seed.py`.
 * A command that moves or deletes names its old path on purpose, so it is not read at all.
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
 * One path cited on a line, with what the rules ask of it computed only when a rule asks: how it
 * resolves against the index, the paragraph around it, the verdict of its sentence, its folder.
 */
function pathCitation(run, file, i, m, c) {
  let resolved = null;
  return {
    ...c, run, file, i, m, kind: 'path', cited: c.p, code: m.kind === 'code',
    get r() { return resolved ??= run.resolve(c.p, file.folder); },
    get paragraph() { return file.context(i, m.anchor, 2, 2); },
    get verdict() { return c.out ? 'produces' : c.command ? '' : verdictOn(file.lines, file.marked, file.headings, i, m, c.at, c.len); },
    get parent() { return c.p.includes('/') ? c.p.slice(0, c.p.lastIndexOf('/')) : ''; },
  };
}

/** A path a sentence excuses stays excused on the lines of the file that follow, since they speak of the same file. */
const excuseInFile = (x) => x.file.excused.add(x.p);

const PATH_RULES = [
  { when: (x) => x.why, outcome: 'excused', reason: (x) => x.why },
  { when: (x) => x.file.excused.has(x.p), outcome: 'excused', reason: 'a sentence above, in this file, already excused this path' },
  { when: (x) => TRANSIENT.test(x.p), outcome: 'excused', reason: 'a folder a build or a tool writes, outside git by design' },
  { when: (x) => x.run.transient(x.p), outcome: 'excused', reason: 'listed under transient in .prumorc.json' },
  { when: (x) => x.run.ignored(x.p), outcome: 'excused', reason: 'listed under ignore in .prumorc.json' },
  { when: (x) => !CODE_EXT.test(x.p) && !x.run.index.known.has(x.p.split('/')[0]), outcome: 'excused', reason: 'no file extension, and its first folder is not in the repository, so it reads as a name' },
  { when: (x) => x.p.startsWith('@/') && !x.run.index.aliasRoot, outcome: 'excused', reason: 'an @/ alias, in a repository with none of the folders an alias resolves against' },
  { when: (x) => x.r.state === 'ok', outcome: 'resolved', reason: 'git tracks it', to: (x) => x.r.real, act: (x) => { x.file.cite(x.p, false); x.file.record(x.i, x.p, x.r.real); } },
  { when: (x) => x.r.state !== 'case' && LOCAL_FILE.test(x.p), outcome: 'excused', reason: 'a file each machine writes for itself, never committed' },
  { when: (x) => x.r.state === 'missing' && installedElsewhere(x.run.index, x.p), outcome: 'resolved', reason: 'a skill cited by its install folder; the file is beside a SKILL.md elsewhere', act: (x) => x.file.cite(x.p, false) },
  { when: (x) => NEGATION.test(x.paragraph), outcome: 'excused', reason: 'the paragraph says the file is gone, moved, or only an example', act: excuseInFile },
  { when: (x) => namesAnotherRepo(x.file.context(x.i, x.m.anchor, 6, 1), x.run.own), outcome: 'excused', reason: 'a repository named a few lines above owns it', act: excuseInFile },
  { when: (x) => !x.code && conditionalExistence(x.m.text, x.at, x.len), outcome: 'excused', reason: 'the sentence makes its existence a condition', act: excuseInFile },
  { when: (x) => x.r.state !== 'case' && x.verdict === 'produces', outcome: 'excused', reason: 'the sentence, the block it is in or its heading says the file gets written', act: excuseInFile },
  { when: (x) => x.r.state !== 'case' && x.parent && !x.run.index.known.has(x.parent) && PRODUCES.test(x.paragraph), outcome: 'excused', reason: 'its folder is absent, and the paragraph speaks of writing files', act: excuseInFile },
  {
    when: (x) => x.r.state === 'case', outcome: 'reported', reason: 'CASE MISMATCH', to: (x) => x.r.real,
    act: (x) => { x.file.cite(x.p, false); x.file.record(x.i, x.p, x.r.real); x.run.findings.caseMismatch.push({ file: x.file.target.label, line: x.i + 1, cited: x.p, actual: x.r.real }); },
  },
  {
    when: (x) => !existsSync(join(x.run.repo, x.p)) && !existsSync(join(dirname(x.file.target.path), x.p)), outcome: 'reported', reason: 'MISSING PATH',
    act: (x) => { x.file.cite(x.p, true); x.run.findings.missingPaths.push({ file: x.file.target.label, line: x.i + 1, cited: x.p, excerpt: x.file.lines[x.i].trim().slice(0, 160) }); },
  },
  { when: () => true, outcome: 'resolved', reason: 'not tracked by git, but present on this disk', act: (x) => x.file.cite(x.p, false) },
];

/**
 * The path check on one line: each cited path that resolves with another letter case is a case
 * mismatch, and each that resolves nowhere is a missing path, unless the paragraph says it is
 * gone, another repository's, a condition, or a file that gets written. `PATH_RULES` is the order
 * the questions are asked in; the first that holds decides.
 */
export function checkPaths(run, file, i, m) {
  const seen = new Set();
  for (const c of m.kind === 'code' ? pathsInCode(m.text) : pathsInProse(m.text)) {
    const key = c.why ? `${c.why}\0${c.p}` : c.p;
    if (seen.has(key)) continue;
    seen.add(key);
    decide(PATH_RULES, pathCitation(run, file, i, m, c));
  }
}
