import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const TRY_EXT = ['.php', '.vue', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rb', '.blade.php'];
export const ALIAS_ROOTS = ['resources/js', 'src', 'app', 'lib'];
const TS_FOR = { js: ['.ts', '.tsx'], jsx: ['.tsx'], mjs: ['.mts'], cjs: ['.cts'] };

const trackedCache = new Map();

/**
 * Every path git tracks, spelled the way git holds it. `core.quotepath` is on by default and
 * returns a non-ASCII name quoted and octal-escaped, which would leave every accented path out
 * of the index; `-z` keeps a name that contains a newline in one piece. The list lives until the
 * current synchronous run ends, so a CLI run or one MCP request reads the index once and a
 * server that stays up never answers from a stale one.
 */
export function trackedFiles(repo) {
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
 * The git index, with every file and folder listed under its last name, so a path cited in short
 * form is matched by how it ends without storing every ending of every path, which grew with the
 * depth of the tree.
 */
export function buildIndex(repo) {
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

/**
 * The first indexed path that ends in `/tail`, or null. With `exact` off, `tail` is lower case and so
 * is the comparison. With `within`, only a path whose folder before `tail` it accepts.
 */
function endingIn(index, tail, exact, within = null) {
  const list = (exact ? index.byName : index.byNameLower).get(tail.slice(tail.lastIndexOf('/') + 1));
  if (!list) return null;
  const want = '/' + tail;
  for (const p of list) {
    const seen = exact ? p : p.toLowerCase();
    if (seen.endsWith(want) && (!within || within(seen.slice(0, -want.length), exact))) return p;
  }
  return null;
}

/** Accepts a folder that holds `folder` or is `folder` itself, compared without letter case when `exact` is off. */
const ancestorOf = (folder) => (base, exact) => {
  const own = exact ? folder : folder.toLowerCase();
  return own === base || own.startsWith(base + '/');
};

/**
 * Tries the literal path, then `@/` aliases, then the path without a first segment that names
 * no folder here, which is how a note spells the project name in front of a real path, then the
 * TypeScript source behind an emitted `.js`, then omitted extensions. The prefix step demands an
 * exact nested match, so a wrongly cased first segment stays a case mismatch. Each spelling is
 * tried from the root, then from `folder`, the folder of the note, and only then by how it ends,
 * so `src/index.ts` cited in `agents/db/AGENTS.md` is the file beside that note and not the first
 * `src/index.ts` of another folder. With `bundled`, a skill citing a folder it carries, the ending only
 * counts inside the skill or a folder above it, since the same `scripts/auth.py` in another skill is
 * not the file this one runs.
 */
export function resolvePath(index, p, folder = '', bundled = false) {
  const tries = SPELLINGS.reduce((spelled, step) => [...spelled, ...step(p, index, spelled)], [p]);
  const beside = folder && folder !== '.' ? `${folder}/` : '';
  const within = bundled ? ancestorOf(folder) : null;
  const exact = firstOf(tries, (t) => firstOf(EXACT_LOOKUPS, (look) => look(index, t, beside, within)));
  const real = exact ? null : firstOf(tries, (t) => index.lower.get(t.toLowerCase()) || endingIn(index, t.toLowerCase(), false, within));
  return exact ? { state: 'ok', real: exact } : real ? { state: 'case', real } : { state: 'missing' };
}

/** The first answer `look` gives for the items of a list, in their order, or null. */
function firstOf(list, look) {
  for (const item of list) {
    const found = look(item);
    if (found) return found;
  }
  return null;
}

/** The project name a note spells in front of a real path, `myapp/src/x.ts`: a first segment that names no folder here, before a path that is here. */
function withoutProjectName(p, index) {
  const head = p.includes('/') ? p.slice(0, p.indexOf('/')) : '';
  const rest = head ? p.slice(head.length + 1) : '';
  return head && (rest.includes('/') || head.toLowerCase() === index.name) && !index.known.has(head) && index.known.has(rest) ? [rest] : [];
}

/** The TypeScript sources behind an emitted `.js`, for every spelling tried so far. */
function typescriptSources(p, index, tries) {
  const js = p.match(/\.(js|jsx|mjs|cjs)$/i);
  return js ? tries.flatMap((base) => TS_FOR[js[1].toLowerCase()].map((e) => base.slice(0, -js[0].length) + e)) : [];
}

const SPELLINGS = [
  (p) => (p.startsWith('@/') ? [p.slice(2), ...ALIAS_ROOTS.map((r) => `${r}/${p.slice(2)}`)] : []),
  withoutProjectName,
  typescriptSources,
  (p, index, tries) => (/\.[a-z0-9]{2,5}$/i.test(p) ? [] : tries.flatMap((base) => TRY_EXT.map((e) => base + e))),
];

const EXACT_LOOKUPS = [
  (index, t) => (index.known.has(t) ? t : null),
  (index, t, beside) => (beside && index.known.has(beside + t) ? beside + t : null),
  (index, t, beside, within) => endingIn(index, t, true, within),
];

/** `resolvePath` with each answer kept, since a path cited on many lines is resolved once per folder. */
export function makeResolver(index) {
  const resolved = new Map();
  return (p, folder = '', bundled = false) => {
    const key = `${folder}\0${p}\0${bundled}`;
    let r = resolved.get(key);
    if (!r) { r = resolvePath(index, p, folder, bundled); resolved.set(key, r); }
    return r;
  };
}
