import { execFileSync } from 'node:child_process';
import { resolve, relative, sep, posix } from 'node:path';
import { analyze, loadConfig, makeMatcher, ageOf, SCHEMA_VERSION, VERSION } from './check.mjs';
import { TRANSIENT } from './check/paths.mjs';

export const ACTIVE_DAYS = 90;
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

/** How many commits touched each unit in the last `days`, read from one walk of the log. */
function activityOf(git, units, days) {
  const commits = new Map();
  let out = '';
  try { out = git(['-c', 'core.quotepath=false', 'log', `--since=${days} days ago`, '--format=%x01', '--name-only']); } catch { out = ''; }
  for (const block of out.split('\x01')) {
    const touched = new Set();
    for (const line of block.split('\n')) {
      const unit = line && unitOf(units, line.trim());
      if (unit) touched.add(unit);
    }
    for (const u of touched) commits.set(u, (commits.get(u) || 0) + 1);
  }
  return commits;
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

  const commits = activityOf(git, units, ACTIVE_DAYS);
  const folders = [];
  for (const [folder, files] of units) {
    if (cited.has(folder)) continue;
    let at = 0;
    try { at = Number(git(['log', '-1', '--format=%ct', '--', folder]).trim()) || 0; } catch { at = 0; }
    folders.push({ folder, files, commits: commits.get(folder) || 0, last: at ? new Date(at * 1000).toISOString() : null, age: at ? ageOf(at, now) : 'not committed' });
  }
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
