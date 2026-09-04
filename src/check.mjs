/**
 * prumo — the analysis. Three checks, chosen by measured precision:
 * case mismatch against the git index, broken links, and missing paths.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, extname, relative, sep, isAbsolute, dirname, posix } from 'node:path';

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

export const DEFAULT_DIRS = ['.cursor/rules', '.windsurf/rules', '.roo/rules', '.github/instructions'];

export const NESTED = new Set(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'AGENT.md', 'GEMINI.md', 'COPILOT.md', 'SKILL.md']);

const ROOTS = /^(app|apps|src|lib|resources|routes|database|config|tests?|public|scripts|bootstrap|packages|components|pages|layouts|server|api|cmd|internal|docs|dist|build|backend|frontend|services|client|\.github|\.claude)\//i;
const CODE_EXT = /\.(php|vue|js|mjs|cjs|ts|tsx|jsx|css|scss|json|ya?ml|blade\.php|py|go|rb|rs|java|kt|sql|sh|html|toml|md)$/i;
const OUTSIDE_REPO = /^(~|\/|[A-Za-z]:[\\/]|\.\.\/|https?:)/;
const WILDCARD = /[<>{}*[\]]|\.\.\.|…/;
/** `path/to/thing.js` is how a command example spells its argument, not a file in this repository. */
const PLACEHOLDER_PATH = /(^|[/])path[/]to[/]/i;
/** `@scope/package/file.css` is an npm import specifier. An `@/` alias keeps its slash right after the `@`, so it is not one. */
const SCOPED_PACKAGE = /^@[^/]+\//;
/** `report-YYYY-MM-DD.md` and `product/vX.Y.Z/` name a file to be created, not one that is here. */
const TEMPLATE_TOKEN = /\bYYYY[-_]MM[-_]DD\b|\bv?X\.Y\.Z\b/i;
/** `src/common/constants.hpp/.cpp` is two files written as one token, never a path. */
const COMPOUND_EXT = /\.[a-z0-9]{1,5}\/\.[a-z0-9]{1,5}$/i;
/** What a markdown link may point at besides code and markdown: the images and documents a note embeds. */
const LINK_EXT = /\.(mdx|png|jpe?g|gif|svg|webp|avif|pdf|ico|txt|csv)$/i;

const NEGATION = new RegExp(
  [
    '(does|do|did|is|are|was|were|has|have|will) ?n.?t ',
    'no longer', 'never', 'used to', 'formerly', 'replaced by', 'deprecated',
    'was removed', 'were removed', 'has been removed', 'deleted', 'renamed',
    'historical', 'reverted', 'superseded', 'not published', 'not exist',
    'n[ãa]o (existe|publica|h[áa]|tem)', 'n[ãa]o [ée] ', 'removid', 'apagad', 'deletad',
    'exclu[ií]d', 'sumi', 'deixou de', 'foi renomead', 'virou', 'passou a ser',
    'hist[óo]ric', 'obsolet', 'superad', 'revertid', 'substitu[íi]d',
    'antes (era|fazia|chamava)', 'errad', 'min[úu]scul', 'mai[úu]scul', 'caixa',
    'citad', 'exemplo', 'placeholder', 'example',
  ].join('|'),
  'i'
);

const HISTORICAL_NAME = /((phase|fase)[_\- ]?\d*[_\- ]?(done|complete|conclu)|[_-](superseded|superad|historic|revertid|reverted))/i;
const HISTORICAL_DESC = /^description:.*(historical|superseded|reverted|hist[óo]ric|SUPERAD|REVERTID)/im;

const TRANSIENT = /^(public\/(hot|build|storage)|bootstrap\/cache|\.vite|scratchpad|storage|dist|coverage|\.next|\.nuxt|node_modules|vendor|target|__pycache__)(\/|$)/i;

const IGNORE_LINE = /<!--\s*prumo-ignore\s*-->/;
const IGNORE_NEXT = /<!--\s*prumo-ignore-next-line\s*-->/;
const IGNORE_FILE = /<!--\s*prumo-ignore-file\s*-->/;

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

/**
 * Every path git tracks, spelled the way git holds it. `core.quotepath` is on by default and
 * returns a non-ASCII name quoted and octal-escaped, which would leave every accented path out
 * of the index; `-z` keeps a name that contains a newline in one piece.
 */
function trackedFiles(repo) {
  return execSync('git -c core.quotepath=false ls-files -z', { cwd: repo, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().split('\0').filter(Boolean);
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

/** The git index — the only source that knows a path's true letter case. */
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

  const suffix = new Map();
  const suffixLower = new Map();
  for (const p of known) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      const suf = parts.slice(i).join('/');
      if (!suffix.has(suf)) suffix.set(suf, p);
      const low = suf.toLowerCase();
      if (!suffixLower.has(low)) suffixLower.set(low, p);
    }
  }
  const lower = new Map();
  for (const p of known) lower.set(p.toLowerCase(), p);

  return { tracked, known, suffix, suffixLower, lower, aliasRoot: ALIAS_ROOTS.some((r) => known.has(r)) };
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
 * Auto-detects the context files of every agent we know, including nested ones.
 * A target that was asked for explicitly must exist: falling back to auto-detection
 * would answer about a different file than the one named.
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

  return targets;
}

/** A command that moves or deletes names its old path on purpose. */
const MOVES_OR_DELETES = /^(git\s+)?(mv|rm|del|rename)\b/i;

/**
 * Paths cited in backticks. A backtick span with spaces is read as a command,
 * and each of its arguments is tried as a path: `python scripts/seed.py`.
 */
function extractPaths(line) {
  const found = [];
  for (const m of line.matchAll(/`([^`\n]{3,120})`/g)) {
    const t = m[1].trim();
    if (OUTSIDE_REPO.test(t)) continue;
    let tokens = [t];
    if (/\s/.test(t)) {
      const first = t.split(/\s+/)[0];
      if (MOVES_OR_DELETES.test(t) || (first.includes('/') && !first.startsWith('./'))) continue;
      tokens = t.split(/\s+/).map((tok) => tok.replace(/^--?[\w-]+=/, '').replace(/^["']|["'.,;]+$/g, ''));
    }
    for (const raw of tokens) {
      const tok = raw.includes('\\') ? raw.split('\\').join('/') : raw;
      if (WILDCARD.test(tok) || OUTSIDE_REPO.test(tok) || PLACEHOLDER_PATH.test(tok) || SCOPED_PACKAGE.test(tok)) continue;
      if (TEMPLATE_TOKEN.test(tok) || COMPOUND_EXT.test(tok)) continue;
      if (!(ROOTS.test(tok) || (tok.includes('/') && CODE_EXT.test(tok)))) continue;
      found.push(tok.replace(/^\.\//, '').replace(/[:#]\d+$/, '').replace(/\/$/, ''));
    }
  }
  return found;
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
    if (index.known.has(t) || index.suffix.has(t)) return { state: 'ok' };
  }
  for (const t of tries) {
    const low = t.toLowerCase();
    const real = index.lower.get(low) || index.suffixLower.get(low);
    if (real) return { state: 'case', real };
  }
  return { state: 'missing' };
}

/**
 * Runs the three checks. A wikilink may point at any markdown file git tracks,
 * not only at the notes being checked, so `linkable` is built from the whole index.
 * @returns {{caseMismatch:[], brokenLinks:[], missingPaths:[], orphans:[], stats:{}}}
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
  let historical = 0, suppressed = 0;
  const relOf = new Map();

  for (const target of checked) {
    const body = readTextFile(target.path);
    if (body === null) continue;
    if (IGNORE_FILE.test(body.slice(0, 400))) { suppressed++; continue; }
    const lines = body.split('\n');
    const isHistorical = HISTORICAL_NAME.test(target.label) || HISTORICAL_DESC.test(body.slice(0, 600));
    if (isHistorical) historical++;
    const seen = new Set();

    lines.forEach((line, i) => {
      if (IGNORE_LINE.test(line) || (i > 0 && IGNORE_NEXT.test(lines[i - 1]))) { suppressed++; return; }
      if (!isHistorical) {
        for (const p of extractPaths(line)) {
          if (seen.has(p) || TRANSIENT.test(p) || extraTransient(p) || ignored(p)) continue;
          seen.add(p);
          if (!CODE_EXT.test(p) && !index.known.has(p.split('/')[0])) continue;
          if (p.startsWith('@/') && !index.aliasRoot) continue;

          const r = resolvePath(index, p);
          if (r.state === 'ok') continue;
          const paragraph = lines.slice(Math.max(0, i - 2), i + 3).join(' ');
          if (NEGATION.test(paragraph)) continue;
          if (namesAnotherRepo(lines.slice(Math.max(0, i - 6), i + 2).join(' '), own)) continue;

          if (r.state === 'case') {
            caseMismatch.push({ file: target.label, line: i + 1, cited: p, actual: r.real });
          } else if (!existsSync(join(repo, p))) {
            missingPaths.push({ file: target.label, line: i + 1, cited: p, excerpt: line.trim().slice(0, 160) });
          }
        }
      }

      const prose = line.replace(/`[^`\n]*`/g, ' ').replace(/^\[([^\]]+)\]:\s*(\S+)\s*$/, '[$1]($2)');

      for (const m of prose.matchAll(/\[\[([A-Za-z0-9][\w .\/-]{1,80})\]\]/g)) {
        const to = m[1].trim();
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

      for (const m of prose.matchAll(/\]\((?:<([^<>]+)>|([^)\s#]+)(?:#[^)]*)?)\)/gi)) {
        const to = m[1] || m[2];
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

  const store = checked.find((t) => t.fromDir);
  const indexFile = checked.find((t) => /^MEMORY\.md$/i.test(t.label));
  if (store && indexFile) {
    const body = readTextFile(indexFile.path) || '';
    for (const t of checked) {
      if (t === indexFile || ignored(t.label)) continue;
      if (!body.includes(t.label) && !body.includes(t.label.replace(/\.md$/i, ''))) orphans.push(t.label);
    }
  }

  return {
    caseMismatch,
    brokenLinks,
    missingPaths,
    orphans,
    stats: { tracked: index.tracked.length, targets: checked.length, historical, suppressed, gitignored },
  };
}
