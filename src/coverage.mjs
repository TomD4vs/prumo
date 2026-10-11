import { execFileSync } from 'node:child_process';
import { resolve, relative, sep, posix } from 'node:path';
import { analyze, loadConfig, makeMatcher, ageOf, SCHEMA_VERSION, VERSION } from './check.mjs';
import { TRANSIENT } from './check/paths.mjs';
import { literal } from './drift.mjs';

export const ACTIVE_DAYS = 90;
const CHUNK = 100;
const MANIFEST = /^(package\.json|Cargo\.toml|go\.mod|pyproject\.toml|composer\.json|pom\.xml|build\.gradle(\.kts)?|Gemfile|mix\.exs)$/;

/**
 * The folders a reader of the code would document one by one: every top-level folder, except the
 * hidden ones and the ones a build writes, and inside a top-level folder that holds packages, each
 * package instead. Each comes with the number of files git tracks in it.
 */
function unitsOf(tracked, skip) {
  const top = new Map();
  for (const p of tracked) {
    const parts = p.split('/');
    if (parts.length < 2 || parts[0].startsWith('.') || TRANSIENT.test(p) || skip(parts[0])) continue;
    if (!top.has(parts[0])) top.set(parts[0], []);
    top.get(parts[0]).push(parts);
  }
  const units = new Map();
  for (const [name, files] of top) {
    const packages = new Set(files.filter((f) => f.length === 3 && MANIFEST.test(f[2])).map((f) => f[1]));
    if (packages.size < 2) { units.set(name, files.length); continue; }
    for (const f of files) {
      const unit = f.length > 2 && packages.has(f[1]) ? `${name}/${f[1]}` : name;
      units.set(unit, (units.get(unit) || 0) + 1);
    }
  }
  return units;
}

/** The unit a path belongs to: the longest unit it sits in, or null. */
function unitOf(units, path) {
  const parts = path.split('/');
  if (parts.length > 1 && units.has(`${parts[0]}/${parts[1]}`)) return `${parts[0]}/${parts[1]}`;
  return units.has(parts[0]) ? parts[0] : null;
}

/**
 * Reads a walk of the log into each unit's number of commits and the time of its newest one, the
 * first the walk meets. A block is a commit: its time, then the files it touched.
 */
function tally(out, units, commits, last) {
  for (const block of out.split('\x01').slice(1)) {
    const [at, ...names] = block.split('\n');
    const touched = new Set(names.map((name) => name && unitOf(units, name.trim())).filter(Boolean));
    for (const u of touched) {
      commits.set(u, (commits.get(u) || 0) + 1);
      if (!last.has(u)) last.set(u, Number(at) || 0);
    }
  }
}

/** A walk of the log with the time of each commit and the files it touched, or nothing when git cannot give one. */
function logOf(git, args) {
  try { return git(['-c', 'core.quotepath=false', 'log', '--format=%x01%ct', '--name-only', ...args]); } catch { return ''; }
}

/**
 * How many commits touched each unit in the last `days`, and when each unit was last committed. One
 * walk of the recent log answers both for the active units; the quiet ones are asked about together,
 * a hundred to a call, since one git process per folder cost a second for every seven folders on Windows.
 */
function activityOf(git, units, days, uncited) {
  const commits = new Map(), last = new Map();
  tally(logOf(git, [`--since=${days} days ago`]), units, commits, last);
  const quiet = uncited.filter((u) => !last.has(u));
  for (let i = 0; i < quiet.length; i += CHUNK) tally(logOf(git, ['--', ...quiet.slice(i, i + CHUNK).map(literal)]), units, new Map(), last);
  return { commits, last };
}

/**
 * The coverage report of the context files: each folder of the code that none of them cites, with
 * its files, its commits in the last ninety days and its last commit, most active first. A folder
 * counts as cited when a context file names a path in it, or when it holds a context file of its own.
 * It is the reverse of a missing path, what the agent is never told about, and never a finding: a
 * folder may be left out of the notes on purpose.
 * @param {object} opts
 * @param {string} opts.repo      the repository
 * @param {object[]} opts.targets what resolveTargets() returned
 * @param {object} [opts.config]  the configuration, or null to read .prumorc.json
 * @param {number} [opts.now]     the present, in seconds, for the ages
 */
export function coverage({ repo, targets, config = null, now = Math.floor(Date.now() / 1000) }) {
  const settings = config ?? loadConfig(repo);
  const result = analyze({ repo, targets, config: settings, collect: true });
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  const tracked = git(['-c', 'core.quotepath=false', 'ls-files', '-z']).split('\0').filter(Boolean);
  const units = unitsOf(tracked, makeMatcher(settings.ignore));

  const cited = new Set();
  for (const c of result.citations) { const u = unitOf(units, c.path); if (u) cited.add(u); }
  for (const f of result.files) { const u = unitOf(units, relative(repo, f.path).split(sep).join(posix.sep)); if (u) cited.add(u); }

  const uncited = [...units.keys()].filter((u) => !cited.has(u));
  const { commits, last } = activityOf(git, units, ACTIVE_DAYS, uncited);
  const folders = uncited.map((folder) => {
    const at = last.get(folder) || 0;
    return { folder, files: units.get(folder), commits: commits.get(folder) || 0, last: at ? new Date(at * 1000).toISOString() : null, age: at ? ageOf(at, now) : 'not committed' };
  });
  folders.sort((a, b) => b.commits - a.commits || b.files - a.files || a.folder.localeCompare(b.folder));

  return {
    schemaVersion: SCHEMA_VERSION,
    prumoVersion: VERSION,
    repo: resolve(repo),
    checkedAt: new Date().toISOString(),
    command: 'coverage',
    folders,
    stats: { targets: result.files.length, folders: units.size, cited: units.size - folders.length, days: ACTIVE_DAYS },
  };
}
