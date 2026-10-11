/**
 * prumo — the git index, the only source that knows a path's true letter case, and the order in
 * which a cited path is resolved against it. docs/design.md explains why that order is fixed.
 */

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

/** The first indexed path that ends in `/tail`, or null. With `exact` off, `tail` is lower case and so is the comparison. */
function endingIn(index, tail, exact) {
  const list = (exact ? index.byName : index.byNameLower).get(tail.slice(tail.lastIndexOf('/') + 1));
  if (!list) return null;
  const want = '/' + tail;
  for (const p of list) if ((exact ? p : p.toLowerCase()).endsWith(want)) return p;
  return null;
}

/**
 * Tries the literal path, then `@/` aliases, then the path without a first segment that names
 * no folder here, which is how a note spells the project name in front of a real path, then the
 * TypeScript source behind an emitted `.js`, then omitted extensions. The prefix step demands an
 * exact nested match, so a wrongly cased first segment stays a case mismatch.
 */
export function resolvePath(index, p) {
  const tries = [p];
  if (p.startsWith('@/')) {
    tries.push(p.slice(2));
    for (const r of ALIAS_ROOTS) tries.push(r + '/' + p.slice(2));
  }
  const head = p.includes('/') ? p.slice(0, p.indexOf('/')) : '';
  const rest = head ? p.slice(head.length + 1) : '';
  if (head && (rest.includes('/') || head.toLowerCase() === index.name) && !index.known.has(head) && index.known.has(rest)) tries.push(rest);
  const js = p.match(/\.(js|jsx|mjs|cjs)$/i);
  if (js) for (const base of [...tries]) for (const e of TS_FOR[js[1].toLowerCase()]) tries.push(base.slice(0, -js[0].length) + e);
  if (!/\.[a-z0-9]{2,5}$/i.test(p)) {
    for (const base of [...tries]) for (const e of TRY_EXT) tries.push(base + e);
  }
  for (const t of tries) {
    if (index.known.has(t)) return { state: 'ok', real: t };
    const nested = endingIn(index, t, true);
    if (nested) return { state: 'ok', real: nested };
  }
  for (const t of tries) {
    const low = t.toLowerCase();
    const real = index.lower.get(low) || endingIn(index, low, false);
    if (real) return { state: 'case', real };
  }
  return { state: 'missing' };
}

/** `resolvePath` with each answer kept, since a path cited on many lines is resolved once. */
export function makeResolver(index) {
  const resolved = new Map();
  return (p) => {
    let r = resolved.get(p);
    if (!r) { r = resolvePath(index, p); resolved.set(p, r); }
    return r;
  };
}
