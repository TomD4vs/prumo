/**
 * prumo — the analysis. Three checks, chosen by measured precision:
 * case mismatch against the git index, broken links, and missing paths.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, extname, relative, sep, isAbsolute, dirname } from 'node:path';

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

const NESTED = new Set(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'AGENT.md', 'GEMINI.md', 'COPILOT.md']);

const ROOTS = /^(app|src|lib|resources|routes|database|config|tests?|public|scripts|bootstrap|packages|components|pages|layouts|server|api|cmd|internal|docs|dist|build|\.github|\.claude)\//i;
const CODE_EXT = /\.(php|vue|js|mjs|cjs|ts|tsx|jsx|css|scss|json|ya?ml|blade\.php|py|go|rb|rs|java|kt|sql|sh|html|toml|md)$/i;
const OUTSIDE_REPO = /^(~|\/|[A-Za-z]:[\\/]|\.\.\/|https?:)/;
const WILDCARD = /[<>{}*]|\.\.\.|…/;

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

function makeMatcher(patterns = []) {
  const res = patterns.map(globToRegExp);
  return (value) => res.some((re) => re.test(value));
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

/** The git index — the only source that knows a path's true letter case. */
function buildIndex(repo) {
  let tracked;
  try {
    tracked = execSync('git ls-files', { cwd: repo, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().split('\n').map((s) => s.trim()).filter(Boolean);
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

  return { tracked, known, suffix, suffixLower, lower };
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

/** Auto-detects the context files of every agent we know, including nested ones. */
export function resolveTargets(repo, explicit = []) {
  const explicitTargets = explicit.flatMap((t) => expandTarget(repo, t));
  if (explicitTargets.length) return explicitTargets;

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
    tracked = execSync('git ls-files', { cwd: repo, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    tracked = [];
  }
  for (const p of tracked) {
    if (p.includes('/') && NESTED.has(p.slice(p.lastIndexOf('/') + 1))) add(p, join(repo, p));
  }

  return targets;
}

function extractPaths(line) {
  const found = [];
  for (const m of line.matchAll(/`([^`\n]{3,120})`/g)) {
    const t = m[1].trim();
    if (WILDCARD.test(t) || /\s/.test(t) || OUTSIDE_REPO.test(t)) continue;
    if (!(ROOTS.test(t) || (t.includes('/') && CODE_EXT.test(t)))) continue;
    found.push(t.replace(/^\.\//, '').replace(/[:#]\d+$/, '').replace(/\/$/, ''));
  }
  return found;
}

/** Tries the literal path, then `@/` aliases, then omitted extensions. */
function resolvePath(index, p) {
  const tries = [p];
  if (p.startsWith('@/')) for (const r of ALIAS_ROOTS) tries.push(r + '/' + p.slice(2));
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
 * Runs the three checks.
 * @returns {{caseMismatch:[], brokenLinks:[], missingPaths:[], orphans:[], stats:{}}}
 */
export function analyze({ repo, targets, config = null }) {
  const index = buildIndex(repo);
  if (!index) throw new Error(`not a git repository: ${repo}`);

  const settings = config ?? loadConfig(repo);
  const ignored = makeMatcher(settings.ignore);
  const excluded = makeMatcher(settings.exclude);
  const extraTransient = makeMatcher(settings.transient);
  const checked = targets.filter((t) => !excluded(t.label));

  const names = new Set(checked.map((t) => t.label.replace(/\.(md|mdc)$/i, '')));
  const loose = new Map();
  for (const n of names) loose.set(n.toLowerCase().replace(/[_-]/g, ''), n);

  const caseMismatch = [], missingPaths = [], brokenLinks = [], orphans = [];
  let historical = 0, suppressed = 0;

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

          const r = resolvePath(index, p);
          if (r.state === 'ok') continue;
          const paragraph = lines.slice(Math.max(0, i - 2), i + 3).join(' ');
          if (NEGATION.test(paragraph)) continue;

          if (r.state === 'case') {
            caseMismatch.push({ file: target.label, line: i + 1, cited: p, actual: r.real });
          } else if (!existsSync(join(repo, p))) {
            missingPaths.push({ file: target.label, line: i + 1, cited: p, excerpt: line.trim().slice(0, 160) });
          }
        }
      }

      const prose = line.replace(/`[^`\n]*`/g, ' ');

      for (const m of prose.matchAll(/\[\[([A-Za-z0-9][\w .\/-]{1,80})\]\]/g)) {
        const to = m[1].trim();
        if (names.has(to) || ignored(to)) continue;
        brokenLinks.push({
          file: target.label,
          line: i + 1,
          cited: to,
          suggestion: loose.get(to.toLowerCase().replace(/[_-]/g, '')) || null,
        });
      }

      for (const m of prose.matchAll(/\]\(([^)\s#]+\.mdx?)(?:#[^)]*)?\)/gi)) {
        const to = m[1];
        if (/^(https?:|\/\/)/i.test(to) || ignored(to)) continue;
        if (existsSync(join(dirname(target.path), to))) continue;
        const bare = to.slice(to.lastIndexOf('/') + 1).replace(/\.mdx?$/i, '');
        brokenLinks.push({
          file: target.label,
          line: i + 1,
          cited: to,
          suggestion: loose.get(bare.toLowerCase().replace(/[_-]/g, '')) || null,
        });
      }
    });
  }

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
    stats: { tracked: index.tracked.length, targets: checked.length, historical, suppressed },
  };
}
