/**
 * prumo — what git recorded about a path that is not here: where it was renamed to, or when it was deleted.
 */

import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';

/** How long ago a commit was, in the words a person uses. */
export function ageOf(seconds, now = Date.now() / 1000) {
  const days = Math.floor((now - seconds) / 86400);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.round(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

/** At most this many paths are asked of the history in one run; a repository citing more is a catalogue. */
const HISTORY_BUDGET = 200;

/**
 * The files a commit renamed and deleted. `-l` raises git's rename limit, which a commit touching
 * thousands of files would otherwise hit in silence, reading every move as a deletion. An
 * unreadable commit reads as one that changed nothing.
 */
function changesIn(git, sha) {
  const c = { renamed: new Map(), deleted: new Set() };
  let parts = [];
  try { parts = git(['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '-l10000', '-m', '-z', sha]).split('\0'); } catch { return c; }
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i];
    if (!status) continue;
    if (/^[RC]/.test(status)) { if (!c.renamed.has(parts[i + 1])) c.renamed.set(parts[i + 1], parts[i + 2]); i += 2; }
    else { if (status === 'D') c.deleted.add(parts[i + 1]); i += 1; }
  }
  return c;
}

/**
 * What git recorded about a path that is not here: the commit that renamed it, followed to where
 * the file is now, or the commit that deleted it. A rename is git's own detection, by similarity,
 * so what is reported is a fact of the history rather than a guess from a name. Nothing comes back
 * when the history never held the path, which is what a placeholder or another project's path
 * looks like, or when the last commit that touched it is not the one that took it away.
 */
export function makeHistorian(repo, index) {
  const commits = new Map();
  const seen = new Map();
  let budget = HISTORY_BUDGET;
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  const changesOf = (sha) => {
    if (!commits.has(sha)) commits.set(sha, changesIn(git, sha));
    return commits.get(sha);
  };
  const lastTouch = (path) => {
    let out = '';
    try { out = git(['log', '-1', '--format=%H%x09%ct', '--', path]).trim(); } catch { return null; }
    if (!out) return null;
    const [sha, at] = out.split('\t');
    return { sha, at: Number(at) };
  };
  const follow = (path, depth) => {
    if (depth > 5 || budget-- <= 0) return null;
    const touch = lastTouch(path);
    if (!touch) return null;
    const changes = changesOf(touch.sha);
    const hop = { commit: touch.sha.slice(0, 7), date: new Date(touch.at * 1000).toISOString(), when: ageOf(touch.at) };
    const to = changes.renamed.get(path);
    if (to !== undefined) {
      if (index.known.has(to)) return { event: 'renamed', to, ...hop };
      return follow(to, depth + 1);
    }
    if (changes.deleted.has(path)) return { event: 'deleted', ...hop };
    return null;
  };
  return {
    /** The history of a cited path, tried as written from the root and then from beside the note. */
    of(cited, file, exact = false) {
      const bare = cited.replace(/^\.\//, '');
      if (!bare || /[*?<>{}]/.test(bare) || bare.endsWith('/') || bare.startsWith('/') || bare.startsWith('../')) return null;
      const candidates = [bare];
      if (!exact && file.includes('/')) {
        const beside = posix.normalize(posix.join(posix.dirname(file), bare));
        if (!beside.startsWith('../') && beside !== bare) candidates.push(beside);
      }
      for (const path of candidates) {
        if (!seen.has(path)) seen.set(path, follow(path, 0));
        const h = seen.get(path);
        if (h) return { ...h, from: path };
      }
      return null;
    },
  };
}
