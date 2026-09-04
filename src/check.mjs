/**
 * prumo — the analysis. Three checks, chosen by measured precision:
 * case mismatch against the git index, broken links, and missing paths.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep, isAbsolute, dirname, posix } from 'node:path';

const VERSION = createRequire(import.meta.url)('../package.json').version;
/** Bumped when the shape of what analyze() returns changes in a way a consumer has to know about. */
export const SCHEMA_VERSION = 1;

export const DEFAULT_TARGETS = [
  'CLAUDE.md',
  'CLAUDE.local.md',
  'AGENTS.md',
  'AGENT.md',
  'GEMINI.md',
  'COPILOT.md',
  'JULES.md',
  'CONVENTIONS.md',
  '.cursorrules',
  '.clinerules',
  '.windsurfrules',
  '.github/copilot-instructions.md',
  '.claude/MEMORY.md',
  'MEMORY.md',
];

export const DEFAULT_DIRS = ['.cursor/rules', '.windsurf/rules', '.roo/rules', '.github/instructions', '.claude/commands'];

/** Where a host installs skills. A skill found here is read even when git does not track it. */
const SKILL_DIRS = ['.claude/skills', '.agents/skills'];

export const NESTED = new Set(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'AGENT.md', 'GEMINI.md', 'COPILOT.md', 'SKILL.md']);

const ROOTS = /^(app|apps|src|lib|resources|routes|database|config|tests?|public|scripts|bootstrap|packages|components|pages|layouts|server|api|cmd|internal|docs|dist|build|backend|frontend|services|client|\.github|\.claude)\//i;
const CODE_EXT = /\.(php|vue|js|mjs|cjs|ts|tsx|jsx|css|scss|json|ya?ml|blade\.php|py|go|rb|rs|java|kt|sql|sh|html|toml|md)$/i;
/** A shell variable in front points wherever the variable does, like a home folder or a URL. */
const OUTSIDE_REPO = /^(~|\/|[A-Za-z]:[\\/]|\.\.\/|https?:|\$)/;
/** What a note appends to a path to point inside the file: a line number, a GitHub `#L10` anchor, or a `::symbol`. */
const INSIDE_FILE = /([:#]L?\d+(-L?\d+)?|::[\w.$]+)$/;
const WILDCARD = /[<>{}*[\]]|\.\.\.|…/;
/** `path/to/thing.js` and `tests/path/test.py` are how an example spells its argument, not files in this repository. */
const PLACEHOLDER_PATH = /(^|[/])path[/]/i;
/** `@scope/package/file.css` is an npm import specifier. An `@/` alias keeps its slash right after the `@`, so it is not one. */
const SCOPED_PACKAGE = /^@[^/]+\//;
/** A sentence that tells the agent to write the file: its path is an output, not a claim that it is here. */
const WRITES_IT = /\b(outputs?|writes?|writing|written|saves?|saved|saving|creates?|creating|created|generates?|generating|generated|emits?|emitting|maintains?|maintaining|add to|put it in|location)\b/i;
/** `report-YYYY-MM-DD.md` and `product/vX.Y.Z/` name a file to be created, not one that is here. */
const TEMPLATE_TOKEN = /\bYYYY[-_]MM[-_]DD\b|\bv?X\.Y\.Z\b/i;
/** `src/common/constants.hpp/.cpp` is two files written as one token, never a path. */
const COMPOUND_EXT = /\.[a-z0-9]{1,5}\/\.[a-z0-9]{1,5}$/i;
/** What a markdown link may point at besides code and markdown: the images and documents a note embeds. */
const LINK_EXT = /\.(mdx|png|jpe?g|gif|svg|webp|avif|pdf|ico|txt|csv)$/i;

const NEGATION = new RegExp(
  [
    '(does|do|did|is|are|was|were|has|have|will) ?n.?t ',
    'no longer', '\\bnever', 'used to', 'formerly', 'replaced by', 'deprecated',
    'was removed', 'were removed', 'has been removed', 'deleted', 'renamed',
    'historical', 'reverted', 'superseded', 'not published', 'not exist',
    'n[ãa]o (existe|publica|h[áa]|tem)', 'n[ãa]o [ée] ', 'removid', 'apagad', 'deletad',
    'exclu[ií]d', '\\bsumi', 'deixou de', 'foi renomead', 'virou', 'passou a ser',
    'hist[óo]ric', 'obsolet', 'superad', 'revertid', 'substitu[íi]d',
    'antes (era|fazia|chamava)', '\\berrad', 'min[úu]scul', 'mai[úu]scul', 'caixa',
    '\\bcitad', 'exemplo', 'placeholder', 'example', '\\be\\.g\\.',
  ].join('|'),
  'i'
);

const HISTORICAL_NAME = /((phase|fase)[_\- ]?\d*[_\- ]?(done|complete|conclu)|[_-](superseded|superad|historic|revertid|reverted))/i;
const HISTORICAL_DESC = /^description:.*(historical|superseded|reverted|hist[óo]ric|SUPERAD|REVERTID)/im;

const TRANSIENT = /^(public\/(hot|build|storage)|bootstrap\/cache|\.vite|scratchpad|storage|dist|coverage|\.next|\.nuxt|node_modules|vendor|target|__pycache__)(\/|$)/i;

const IGNORE_LINE = /<!--\s*prumo-ignore\s*-->/;
const IGNORE_NEXT = /<!--\s*prumo-ignore-next-line\s*-->/;
const IGNORE_FILE = /<!--\s*prumo-ignore-file\s*-->/;

/** A fenced block that quotes markdown is an example of syntax, so nothing inside it is a claim. */
const QUOTES_MARKDOWN = /^(md|markdown|mdx)\b/i;
/** The prompt a note writes in front of a command inside a fenced block. */
const PROMPT = /^[$>]\s+/;
/** A comment inside a fenced block is where a note writes what a command prints, not what the repository holds. */
const CODE_COMMENT = /^(#|\/\/)/;

const TRY_EXT = ['.php', '.vue', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rb', '.blade.php'];
const ALIAS_ROOTS = ['resources/js', 'src', 'app', 'lib'];
/** A TypeScript project imports `./x.js` and tracks `x.ts`; the text carries the extension the bundler emits. */
const TS_FOR = { js: ['.ts', '.tsx'], jsx: ['.tsx'], mjs: ['.mts'], cjs: ['.cts'] };

/** Turns a glob (`*`, `**`, `?`) into an anchored regular expression. */
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { out += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

/** Builds the test for one config list. A pattern with no wildcard that names a folder
 *  covers everything under it, so `public/dist` reaches `public/dist/app.js`. */
function makeMatcher(patterns = []) {
  const res = patterns.map(globToRegExp);
  const folders = patterns.filter((p) => !/[*?]/.test(p)).map((p) => p.replace(/\/+$/, '').toLowerCase() + '/');
  return (value) => res.some((re) => re.test(value)) || folders.some((f) => value.toLowerCase().startsWith(f));
}

/** Reads `.prumorc.json` from the repository root. Absent or invalid means no config. */
export function loadConfig(repo) {
  const path = join(repo, '.prumorc.json');
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return {
      ignore: Array.isArray(raw.ignore) ? raw.ignore : [],
      exclude: Array.isArray(raw.exclude) ? raw.exclude : [],
      targets: Array.isArray(raw.targets) ? raw.targets : [],
      transient: Array.isArray(raw.transient) ? raw.transient : [],
    };
  } catch {
    throw new Error('.prumorc.json is not valid JSON');
  }
}

function readTextFile(path) {
  try {
    if (statSync(path).size > 2_000_000) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

const trackedCache = new Map();

/**
 * Every path git tracks, spelled the way git holds it. `core.quotepath` is on by default and
 * returns a non-ASCII name quoted and octal-escaped, which would leave every accented path out
 * of the index; `-z` keeps a name that contains a newline in one piece. The list lives until the
 * current synchronous run ends, so a CLI run or one MCP request reads the index once and a
 * server that stays up never answers from a stale one.
 */
function trackedFiles(repo) {
  const key = resolve(repo);
  const kept = trackedCache.get(key);
  if (kept) return kept;
  const list = execSync('git -c core.quotepath=false ls-files -z', { cwd: repo, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().split('\0').filter(Boolean);
  if (!trackedCache.size) queueMicrotask(() => trackedCache.clear());
  trackedCache.set(key, list);
  return list;
}

/**
 * True when the repository is itself a skill. Auto-detection leaves a root `SKILL.md` out, so a run
 * inside a published skill finds nothing, which reads like a broken tool unless the message says why.
 */
export function hasRootSkill(repo) {
  let tracked = [];
  try { tracked = trackedFiles(repo); } catch { tracked = []; }
  return tracked.includes('SKILL.md');
}

/**
 * The git index — the only source that knows a path's true letter case. Every file and folder is
 * listed under its last name, so a path cited in short form is matched by how it ends without
 * storing every ending of every path, which grew with the depth of the tree.
 */
function buildIndex(repo) {
  let tracked;
  try {
    tracked = trackedFiles(repo);
  } catch {
    return null;
  }

  const known = new Set(tracked);
  for (const p of tracked) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) known.add(parts.slice(0, i).join('/'));
  }

  const byName = new Map();
  const byNameLower = new Map();
  const lower = new Map();
  const file = (map, key, p) => { const list = map.get(key); if (list) list.push(p); else map.set(key, [p]); };
  for (const p of known) {
    const name = p.slice(p.lastIndexOf('/') + 1);
    file(byName, name, p);
    file(byNameLower, name.toLowerCase(), p);
    lower.set(p.toLowerCase(), p);
  }

  return { tracked, known, byName, byNameLower, lower, aliasRoot: ALIAS_ROOTS.some((r) => known.has(r)) };
}

/** The first indexed path that ends in `/tail`, or null. With `exact` off, `tail` is lower case and so is the comparison. */
function endingIn(index, tail, exact) {
  const list = (exact ? index.byName : index.byNameLower).get(tail.slice(tail.lastIndexOf('/') + 1));
  if (!list) return null;
  const want = '/' + tail;
  for (const p of list) if ((exact ? p : p.toLowerCase()).endsWith(want)) return p;
  return null;
}

function expandTarget(repo, target) {
  const abs = isAbsolute(target) ? target : join(repo, target);
  let st;
  try { st = statSync(abs); } catch { return []; }
  if (st.isDirectory()) {
    return readdirSync(abs)
      .filter((f) => /\.(md|mdc)$/i.test(f))
      .map((f) => ({ label: f, path: join(abs, f), fromDir: true }));
  }
  return [{ label: relative(repo, abs).split(sep).join('/') || target, path: abs, fromDir: false }];
}

/**
 * Auto-detects the context files of every agent we know, including nested ones. Nested files come
 * from the git index; a skill installed under a host's folder is also looked for on disk, since an
 * installed skill is often left out of git on purpose. A target that was asked for explicitly must
 * exist: falling back to auto-detection would answer about a different file than the one named.
 */
export function resolveTargets(repo, explicit = []) {
  if (explicit.length) {
    const missing = explicit.filter((t) => !existsSync(isAbsolute(t) ? t : join(repo, t)));
    if (missing.length) throw new Error(`target not found: ${missing.join(', ')}`);
    return explicit.flatMap((t) => expandTarget(repo, t));
  }

  const targets = [];
  const seen = new Set();
  const add = (label, path, fromDir = false) => {
    if (seen.has(label)) return;
    seen.add(label);
    targets.push({ label, path, fromDir });
  };

  for (const p of DEFAULT_TARGETS) {
    if (existsSync(join(repo, p))) add(p, join(repo, p));
  }
  for (const d of DEFAULT_DIRS) {
    if (existsSync(join(repo, d))) for (const t of expandTarget(repo, d)) add(`${d}/${t.label}`, t.path, true);
  }

  let tracked = [];
  try {
    tracked = trackedFiles(repo);
  } catch {
    tracked = [];
  }
  for (const p of tracked) {
    if (p.includes('/') && NESTED.has(p.slice(p.lastIndexOf('/') + 1)) && !TRANSIENT.test(p)) add(p, join(repo, p));
  }
  for (const d of SKILL_DIRS) {
    let names = [];
    try { names = readdirSync(join(repo, d)); } catch { continue; }
    for (const n of names) {
      const label = `${d}/${n}/SKILL.md`;
      if (existsSync(join(repo, label))) add(label, join(repo, label));
    }
  }

  return targets;
}

/** A command that moves or deletes names its old path on purpose. */
const MOVES_OR_DELETES = /^(git\s+)?(mv|rm|del|rename)\b/i;

/**
 * Marks each line as prose, code inside a fenced block, or skipped: a fence line, a block that
 * quotes markdown, a block under a `prumo-ignore-next-line` marker, and anything inside an HTML
 * comment. A code line keeps the index of its opening fence, so the sentence that introduces the
 * block counts as its context.
 */
function classifyLines(lines) {
  const out = [];
  let fence = null;
  let comment = false;
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i];
    if (fence) {
      const close = text.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) { fence = null; out.push({ kind: 'skip' }); }
      else out.push(fence.read ? { kind: 'code', text, anchor: fence.at } : { kind: 'skip' });
      continue;
    }
    if (comment) {
      const end = text.indexOf('-->');
      if (end < 0) { out.push({ kind: 'skip' }); continue; }
      text = text.slice(end + 3);
      comment = false;
    }
    let open;
    while ((open = text.indexOf('<!--')) >= 0) {
      const end = text.indexOf('-->', open + 4);
      if (end < 0) { text = text.slice(0, open); comment = true; break; }
      text = text.slice(0, open) + ' ' + text.slice(end + 3);
    }
    const opener = text.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (opener && !(opener[1][0] === '`' && opener[2].includes('`'))) {
      const read = !QUOTES_MARKDOWN.test(opener[2].trim()) && !(i > 0 && IGNORE_NEXT.test(lines[i - 1]));
      fence = { char: opener[1][0], len: opener[1].length, at: i, read };
      out.push({ kind: 'skip' });
      continue;
    }
    out.push({ kind: 'prose', text, anchor: i });
  }
  return out;
}

/** What is stripped from a command's argument: a flag's name, quotes and punctuation. A code line also loses brackets and a colon. */
const PROSE_STRIP = /^["']|["'.,;]+$/g;
const CODE_STRIP = /^["'([{<]+|["'.,;:)\]}>]+$/g;

function tokensOf(span, strip) {
  return span.split(/\s+/).map((tok) => tok.replace(/^--?[\w-]+=/, '').replace(strip, ''));
}

/** The tokens that read as paths of this repository, in the spelling the note uses. */
function pathsAmong(tokens) {
  const found = [];
  for (const raw of tokens) {
    const tok = raw.includes('\\') ? raw.split('\\').join('/') : raw;
    if (WILDCARD.test(tok) || OUTSIDE_REPO.test(tok) || PLACEHOLDER_PATH.test(tok) || SCOPED_PACKAGE.test(tok)) continue;
    if (TEMPLATE_TOKEN.test(tok) || COMPOUND_EXT.test(tok)) continue;
    if (!(ROOTS.test(tok) || (tok.includes('/') && CODE_EXT.test(tok)))) continue;
    found.push(tok.replace(/^\.\//, '').replace(INSIDE_FILE, '').replace(/\/$/, ''));
  }
  return found;
}

/**
 * Paths cited in backticks. A backtick span with spaces is read as a command,
 * and each of its arguments is tried as a path: `python scripts/seed.py`.
 */
function pathsInProse(line) {
  const found = [];
  for (const m of line.matchAll(/`([^`\n]{3,120})`/g)) {
    const t = m[1].trim();
    if (OUTSIDE_REPO.test(t)) continue;
    let tokens = [t];
    if (/\s/.test(t)) {
      const first = t.split(/\s+/)[0];
      if (MOVES_OR_DELETES.test(t) || (first.includes('/') && !first.startsWith('./'))) continue;
      tokens = tokensOf(t, PROSE_STRIP);
    }
    found.push(...pathsAmong(tokens));
  }
  return found;
}

/**
 * Paths on a line of a fenced block, read as a command or as a file tree, so every token is tried.
 * A comment line is what a command prints, a line too long to be a command is data, and `./name`
 * with no folder is an argument the reader supplies, like a bare file name in prose.
 */
function pathsInCode(line) {
  const t = line.trim().replace(PROMPT, '');
  if (!t || t.length > 300 || CODE_COMMENT.test(t) || MOVES_OR_DELETES.test(t)) return [];
  return pathsAmong(tokensOf(t, CODE_STRIP).filter((tok) => !(tok.startsWith('./') && !tok.slice(2).includes('/'))));
}

/**
 * Asks git which of these paths .gitignore covers. A path ignored on purpose is
 * expected to be absent from the index and often from this machine, so its
 * absence says nothing about the note. Returns the subset that is ignored.
 */
function gitIgnored(repo, paths) {
  if (!paths.length) return new Set();
  const parse = (buf) => new Set(String(buf || '').split('\0').map((s) => s.trim()).filter(Boolean));
  try {
    return parse(execSync('git check-ignore --stdin -z', { cwd: repo, input: paths.join('\0') + '\0', stdio: ['pipe', 'pipe', 'ignore'] }));
  } catch (err) {
    return parse(err.stdout);
  }
}

/**
 * A markdown link writes a space as `%20`, so the target has to be decoded before it is resolved and
 * re-encoded before it is written back, or a fix would turn a working link into a broken one.
 */
function decodeLink(to) {
  try { return decodeURIComponent(to); } catch { return to; }
}

/** The `owner/name` this repository pushes to, so a link naming a different one can be told apart. */
function originRepo(repo) {
  try {
    const url = execSync('git remote get-url origin', { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const m = url.match(/(?:github|gitlab)\.com[:/]([\w.-]+\/[\w.-]+)/i);
    return m ? m[1].replace(/\.git$/, '').toLowerCase() : '';
  } catch { return ''; }
}

/** True when the lines around a citation name another repository, which is whose path it is. */
function namesAnotherRepo(window, own) {
  if (!own) return false;
  for (const m of window.matchAll(/(?:github|gitlab)\.com[:/]([\w.-]+\/[\w.-]+)/gi)) {
    if (m[1].replace(/\.git$/, '').toLowerCase() !== own) return true;
  }
  return false;
}

/**
 * Tries the literal path, then `@/` aliases, then the path without a first segment that names
 * no folder here, which is how a note spells the project name in front of a real path, then the
 * TypeScript source behind an emitted `.js`, then omitted extensions. The prefix step demands an
 * exact nested match, so a wrongly cased first segment stays a case mismatch.
 */
function resolvePath(index, p) {
  const tries = [p];
  if (p.startsWith('@/')) {
    tries.push(p.slice(2));
    for (const r of ALIAS_ROOTS) tries.push(r + '/' + p.slice(2));
  }
  const head = p.includes('/') ? p.slice(0, p.indexOf('/')) : '';
  const rest = head ? p.slice(head.length + 1) : '';
  if (head && rest.includes('/') && !index.known.has(head) && index.known.has(rest)) tries.push(rest);
  const js = p.match(/\.(js|jsx|mjs|cjs)$/i);
  if (js) for (const base of [...tries]) for (const e of TS_FOR[js[1].toLowerCase()]) tries.push(base.slice(0, -js[0].length) + e);
  if (!/\.[a-z0-9]{2,5}$/i.test(p)) {
    for (const base of [...tries]) for (const e of TRY_EXT) tries.push(base + e);
  }
  for (const t of tries) {
    if (index.known.has(t) || endingIn(index, t, true)) return { state: 'ok' };
  }
  for (const t of tries) {
    const low = t.toLowerCase();
    const real = index.lower.get(low) || endingIn(index, low, false);
    if (real) return { state: 'case', real };
  }
  return { state: 'missing' };
}

/**
 * Runs the three checks. A wikilink may point at any markdown file git tracks,
 * not only at the notes being checked, so `linkable` is built from the whole index.
 * A path is reported on every line that cites it, and a path that a sentence excuses stays
 * excused on the lines of that file that follow, since they speak of the same file.
 * @returns {{schemaVersion:number, prumoVersion:string, repo:string, checkedAt:string, caseMismatch:[], brokenLinks:[], missingPaths:[], orphans:[], stats:{}}}
 */
export function analyze({ repo, targets, config = null }) {
  const index = buildIndex(repo);
  if (!index) throw new Error(`not a git repository: ${repo}`);
  if (!index.tracked.length) throw new Error('the git index is empty, so nothing can be checked against it. Commit or "git add" the files first.');

  const own = originRepo(repo);
  const settings = config ?? loadConfig(repo);
  const ignored = makeMatcher(settings.ignore);
  const excluded = makeMatcher(settings.exclude);
  const extraTransient = makeMatcher(settings.transient);
  const checked = targets.filter((t) => !excluded(t.label));
  const inIndex = (t) => {
    const rel = relative(repo, t.path).split(sep).join('/');
    return index.known.has(rel) || index.lower.has(rel.toLowerCase());
  };

  const names = new Set(checked.map((t) => t.label.replace(/\.(md|mdc)$/i, '')));
  const linkable = new Set(names);
  for (const p of index.tracked) {
    if (!/.(md|mdc)$/i.test(p)) continue;
    const bare = p.replace(/.(md|mdc)$/i, '');
    linkable.add(bare);
    linkable.add(bare.slice(bare.lastIndexOf('/') + 1));
  }
  const loose = new Map();
  for (const n of linkable) loose.set(n.toLowerCase().replace(/[_-]/g, ''), n);

  const caseMismatch = [], missingPaths = [], brokenLinks = [], orphans = [];
  let historical = 0, suppressed = 0, untracked = 0;
  const relOf = new Map();
  const resolved = new Map();
  const resolveOnce = (p) => {
    let r = resolved.get(p);
    if (!r) { r = resolvePath(index, p); resolved.set(p, r); }
    return r;
  };

  for (const target of checked) {
    const body = readTextFile(target.path);
    if (body === null) continue;
    if (!inIndex(target)) untracked++;
    if (IGNORE_FILE.test(body.slice(0, 400))) { suppressed++; continue; }
    const lines = body.split('\n');
    const isHistorical = HISTORICAL_NAME.test(target.label) || HISTORICAL_DESC.test(body.slice(0, 600));
    if (isHistorical) historical++;
    const marked = classifyLines(lines);
    const excused = new Set();
    const context = (i, anchor, before, after) => (anchor === i
      ? lines.slice(Math.max(0, i - before), i + after + 1)
      : lines.slice(Math.max(0, anchor - before), anchor).concat(lines.slice(Math.max(anchor + 1, i - before), i + 1))
    ).join(' ');

    marked.forEach((m, i) => {
      const line = lines[i];
      if (IGNORE_LINE.test(line) || (i > 0 && IGNORE_NEXT.test(lines[i - 1]))) { suppressed++; return; }
      if (m.kind === 'skip') return;
      const code = m.kind === 'code';

      if (!isHistorical) {
        const seen = new Set();
        for (const p of code ? pathsInCode(m.text) : pathsInProse(m.text)) {
          if (seen.has(p) || excused.has(p) || TRANSIENT.test(p) || extraTransient(p) || ignored(p)) continue;
          seen.add(p);
          if (!CODE_EXT.test(p) && !index.known.has(p.split('/')[0])) continue;
          if (p.startsWith('@/') && !index.aliasRoot) continue;

          const r = resolveOnce(p);
          if (r.state === 'ok') continue;
          const paragraph = context(i, m.anchor, 2, 2);
          const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
          if (NEGATION.test(paragraph)
            || (r.state !== 'case' && parent && !index.known.has(parent) && WRITES_IT.test(paragraph))
            || namesAnotherRepo(context(i, m.anchor, 6, 1), own)) { excused.add(p); continue; }

          if (r.state === 'case') {
            caseMismatch.push({ file: target.label, line: i + 1, cited: p, actual: r.real });
          } else if (!existsSync(join(repo, p)) && !existsSync(join(dirname(target.path), p))) {
            missingPaths.push({ file: target.label, line: i + 1, cited: p, excerpt: line.trim().slice(0, 160) });
          }
        }
      }
      if (code) return;

      const prose = m.text.replace(/`[^`\n]*`/g, ' ').replace(/^\[([^\]]+)\]:\s*(\S+)\s*$/, '[$1]($2)');

      for (const l of prose.matchAll(/\[\[([A-Za-z0-9][\w .\/-]{1,80})\]\]/g)) {
        const to = l[1].trim();
        if (linkable.has(to) || ignored(to)) continue;
        if (to.startsWith('@/') && !index.aliasRoot) continue;
        brokenLinks.push({
          file: target.label,
          line: i + 1,
          kind: 'wikilink',
          cited: to,
          suggestion: loose.get(to.toLowerCase().replace(/[_-]/g, '')) || null,
        });
      }

      for (const l of prose.matchAll(/\]\((?:<([^<>]+)>|([^)\s#]+)(?:#[^)]*)?)\)/gi)) {
        const to = l[1] || l[2];
        if (!CODE_EXT.test(to) && !LINK_EXT.test(to)) continue;
        if (WILDCARD.test(to) || PLACEHOLDER_PATH.test(to) || TEMPLATE_TOKEN.test(to) || SCOPED_PACKAGE.test(to)) continue;
        if (/^(https?:|\/\/)/i.test(to) || ignored(to)) continue;
        const href = decodeLink(to);
        const abs = href.startsWith('/') ? join(repo, href.slice(1)) : join(dirname(target.path), href);
        const rel = relative(repo, abs).split(sep).join('/');
        const inside = rel && !rel.startsWith('../') && !isAbsolute(rel);
        if (inside && index.known.has(rel)) continue;
        if (inside) {
          const real = index.lower.get(rel.toLowerCase());
          if (real) {
            const fileDir = posix.dirname(relative(repo, target.path).split(sep).join('/'));
            const fixed = posix.relative(fileDir, real);
            caseMismatch.push({ file: target.label, line: i + 1, kind: 'link', cited: to, actual: href === to ? fixed : fixed.split(' ').join('%20') });
            continue;
          }
        }
        if (existsSync(abs)) continue;
        const bare = href.slice(href.lastIndexOf('/') + 1).replace(/\.mdx?$/i, '');
        const finding = {
          file: target.label,
          line: i + 1,
          kind: 'link',
          cited: to,
          suggestion: loose.get(bare.toLowerCase().replace(/[_-]/g, '')) || null,
        };
        if (inside) relOf.set(finding, rel);
        brokenLinks.push(finding);
      }
    });
  }

  for (const m of missingPaths) relOf.set(m, m.cited);
  const candidates = [...new Set(relOf.values())];
  const ignoredByGit = gitIgnored(repo, candidates);
  let gitignored = 0;
  const keep = (list) => list.filter((f) => {
    const rel = relOf.get(f);
    if (rel && ignoredByGit.has(rel)) { gitignored++; return false; }
    return true;
  });
  const missingKept = keep(missingPaths), linksKept = keep(brokenLinks);
  missingPaths.length = 0; missingPaths.push(...missingKept);
  brokenLinks.length = 0; brokenLinks.push(...linksKept);

  const indexFile = checked.find((t) => t.fromDir && /^MEMORY\.md$/i.test(t.label));
  if (indexFile) {
    const folder = dirname(indexFile.path);
    const body = readTextFile(indexFile.path) || '';
    for (const t of checked) {
      if (t === indexFile || !t.fromDir || dirname(t.path) !== folder || ignored(t.label)) continue;
      if (!body.includes(t.label) && !body.includes(t.label.replace(/\.md$/i, ''))) orphans.push(t.label);
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    prumoVersion: VERSION,
    repo: resolve(repo),
    checkedAt: new Date().toISOString(),
    caseMismatch,
    brokenLinks,
    missingPaths,
    orphans,
    stats: { tracked: index.tracked.length, targets: checked.length, historical, suppressed, gitignored, untracked },
  };
}
