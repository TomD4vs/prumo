import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { literal } from './git-index.mjs';

/** A count of a unit of time, ago: `1 month ago`, `3 years ago`. */
const counted = (n, unit) => `${n} ${n === 1 ? unit : `${unit}s`} ago`;

const AGES = [
  { when: (days) => days < 1, say: () => 'today' },
  { when: (days) => days === 1, say: () => 'yesterday' },
  { when: (days) => days < 30, say: (days) => `${days} days ago` },
  { when: (days) => Math.round(days / 30) < 12, say: (days) => counted(Math.round(days / 30), 'month') },
  { when: () => true, say: (days) => counted(Math.round(days / 365), 'year') },
];

/** How long ago a commit was, in the words a person uses: the first of `AGES` that fits the number of days. */
export function ageOf(seconds, now = Date.now() / 1000) {
  const days = Math.floor((now - seconds) / 86400);
  return AGES.find((age) => age.when(days)).say(days);
}

const HISTORY_BUDGET = 200;
const CHUNK = 100;

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

/** The paths a cited path is looked up under in the history: as written from the root, then from beside the note. */
function candidatesOf(cited, file, exact) {
  const bare = cited.replace(/^\.\//, '');
  if (!bare || /[*?<>{}]/.test(bare) || bare.endsWith('/') || bare.startsWith('/') || bare.startsWith('../')) return [];
  const candidates = [bare];
  if (!exact && file.includes('/')) {
    const beside = posix.normalize(posix.join(posix.dirname(file), bare));
    if (!beside.startsWith('../') && beside !== bare) candidates.push(beside);
  }
  return candidates;
}

/**
 * The paths some commit touched, on any branch, read a hundred paths to a walk of the log, since one
 * git process per path cost a second for every seven paths on Windows. `--full-history` keeps every
 * branch the walk would prune for one path alone, and `--cc` names what a merge changed against every
 * parent, so a file the walk never names was never touched, and `git log -1` would find nothing
 * either. A folder is never named, which costs nothing, since git records a rename or a deletion
 * file by file.
 */
function touchedAmong(git, paths) {
  const asked = new Set(paths);
  const found = new Set();
  for (let i = 0; i < paths.length; i += CHUNK) {
    let out = '';
    try { out = git(['-c', 'core.quotepath=false', 'log', '--full-history', '--cc', '--format=', '--name-only', '--', ...paths.slice(i, i + CHUNK).map(literal)]); } catch { return new Set(paths); }
    for (const name of out.split('\n')) if (asked.has(name)) found.add(name);
  }
  return found;
}

/**
 * What git recorded about a path that is not here: the commit that renamed it, followed to where
 * the file is now, or the commit that deleted it. A rename is git's own detection, by similarity,
 * so what is reported is a fact of the history rather than a guess from a name. Nothing comes back
 * when the history never held the path, which is what a placeholder or another project's path
 * looks like, or when the last commit that touched it is not the one that took it away. At most two
 * hundred paths are asked of the history in one run, since a repository citing more is a catalogue.
 */
export function makeHistorian(repo, index) {
  const commits = new Map();
  const seen = new Map();
  let budget = HISTORY_BUDGET;
  let asked = new Set();
  let touched = new Set();
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  const changesOf = (sha) => {
    if (!commits.has(sha)) commits.set(sha, changesIn(git, sha));
    return commits.get(sha);
  };
  const lastTouch = (path) => {
    if (asked.has(path) && !touched.has(path)) return null;
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
    /** Learns in a few walks of the log which of the paths the citations could be were ever touched, so `of` asks git only about those. */
    prepare(citations) {
      asked = new Set([...new Set(citations.flatMap(([cited, file, exact]) => candidatesOf(cited, file, exact)))].slice(0, HISTORY_BUDGET));
      touched = touchedAmong(git, [...asked]);
    },
    /** The history of a cited path, tried as written from the root and then from beside the note. */
    of(cited, file, exact = false) {
      for (const path of candidatesOf(cited, file, exact)) {
        if (!seen.has(path)) seen.set(path, follow(path, 0));
        const h = seen.get(path);
        if (h) return { ...h, from: path };
      }
      return null;
    },
  };
}
