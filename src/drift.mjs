import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { analyze, classifyLines, readTextFile, ageOf, SCHEMA_VERSION, VERSION } from './check.mjs';
import { literal } from './check/git-index.mjs';

const NOBODY = '0000000000000000000000000000000000000000';
const CHUNK = 100;

/** A heading's title. A heading written as a link keeps its text, since the address is not part of the title. */
const titleOf = (heading) => heading.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();

/** The lines of a note as git blames them: the newline that ends the file is not a line, and keeping it would read the last section as uncommitted. */
function blamedLines(body) {
  const lines = body.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** When a section was written: as old as the newest commit among its lines, and as fresh as now when one of them is not committed. */
function dateOf(blame, s, now) {
  let at = 0;
  for (let i = s.start; i <= s.end; i++) {
    const t = blame && blame[i];
    if (!t || t.sha === NOBODY) return { at: now, committed: false };
    if (t.at > at) at = t.at;
  }
  return at ? { at, committed: true } : { at: now, committed: false };
}

/**
 * The sections of a note: the text above the first heading, when it says anything beyond its
 * front matter, and one section per heading. A `#` inside a fenced block is code, not a heading.
 */
export function sectionsOf(lines, marked = classifyLines(lines)) {
  const out = [];
  const speaks = (from, to) => {
    let i = from;
    if (i < to && /^---\s*$/.test(lines[i])) { i++; while (i < to && !/^---\s*$/.test(lines[i])) i++; i++; }
    for (; i < to; i++) if (lines[i].trim()) return true;
    return false;
  };
  let current = { title: '', line: 1, start: 0, end: -1 };
  for (let i = 0; i < lines.length; i++) {
    const h = marked[i].kind === 'prose' && lines[i].match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!h) continue;
    current.end = i - 1;
    if (current.title || speaks(current.start, i)) out.push(current);
    current = { title: titleOf(h[1]), line: i + 1, start: i, end: -1 };
  }
  current.end = lines.length - 1;
  if (current.title || speaks(current.start, lines.length)) out.push(current);
  return out;
}

/**
 * The commit and committer time of every line of a tracked file, in line order, or null when git
 * cannot blame it. A line not committed yet comes back with a commit of forty zeros.
 */
function blameOf(git, file) {
  let out;
  try { out = git(['blame', '--line-porcelain', '--', file]); } catch { return null; }
  const lines = [];
  let last = null;
  for (const line of out.split('\n')) {
    const head = line.match(/^([0-9a-f]{40}) \d+ \d+/);
    if (head) { last = { sha: head[1], at: 0 }; lines.push(last); }
    else if (last && line.startsWith('committer-time ')) last.at = Number(line.slice('committer-time '.length));
  }
  return lines;
}

/**
 * Every commit since a date that touched one of the paths, with the touched paths, each commit once.
 * The paths are asked a hundred at a time, since a command line has a length limit on Windows.
 */
function commitsSince(git, since, paths) {
  const commits = new Map();
  const from = new Date((since - 86400) * 1000).toISOString();
  for (let i = 0; i < paths.length; i += CHUNK) {
    let out = '';
    try { out = git(['log', '--format=%x01%H %ct', '--name-only', `--since=${from}`, '--', ...paths.slice(i, i + CHUNK).map(literal)]); } catch { continue; }
    for (const block of out.split('\x01').slice(1)) {
      const [head, ...rest] = block.split('\n');
      const [sha, at] = head.split(' ');
      let c = commits.get(sha);
      if (!c) { c = { sha, at: Number(at), files: new Set() }; commits.set(sha, c); }
      for (const f of rest) if (f.trim()) c.files.add(f.trim());
    }
  }
  return [...commits.values()];
}

/**
 * The drift report of the context files: for every section that cites a file or a folder the
 * repository has, when the section last changed according to git blame, and how many commits
 * touched what it cites after that. Sections come back ordered, the most moved first. Nothing here
 * is a finding: a section whose files changed forty times may still be right, and one whose files
 * never changed may be wrong, so the order says where to look and the dates are the ones git recorded.
 * @param {object} opts
 * @param {string} opts.repo      the repository
 * @param {object[]} opts.targets what resolveTargets() returned
 * @param {object} [opts.config]  the configuration, or null to read .prumorc.json
 * @param {number} [opts.now]     the present, in seconds, for the ages
 */
export function drift({ repo, targets, config = null, now = Math.floor(Date.now() / 1000) }) {
  const result = analyze({ repo, targets, config, collect: true });
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  const cites = groupBy(result.citations, (c) => c.file);
  const files = result.files
    .map(({ file, path }) => ({ file, body: readTextFile(path) }))
    .filter(({ body }) => body !== null)
    .map(({ file, body }) => driftOfFile(git, file, sectionsOf(blamedLines(body)), cites.get(file) || [], now));
  const sections = files.flatMap((f) => f.sections)
    .sort((a, b) => b.commits - a.commits || b.changed - a.changed || a.since.localeCompare(b.since) || a.file.localeCompare(b.file) || a.line - b.line);
  const sum = (key) => files.reduce((n, f) => n + f[key], 0);

  return {
    schemaVersion: SCHEMA_VERSION,
    prumoVersion: VERSION,
    repo: resolve(repo),
    checkedAt: new Date().toISOString(),
    command: 'drift',
    sections,
    stats: { targets: result.files.length, sections: sum('counted'), cited: new Set(files.flatMap((f) => f.paths)).size, quiet: sum('quiet'), uncommitted: sum('uncommitted') },
  };
}

/** A list in groups by a key, in the order the items come; `Map.groupBy` does this from Node 21 on. */
function groupBy(list, keyOf) {
  const groups = new Map();
  for (const item of list) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

/**
 * The drift of one file: each section that cites something, with its date and what moved under it
 * since; the sections that cite nothing are counted as quiet, and a file with lines git cannot blame
 * as uncommitted. Its citations reach git in one log, from the oldest section on.
 */
function driftOfFile(git, file, parts, here, now) {
  if (!here.length) return { sections: [], paths: [], counted: parts.length, quiet: parts.length, uncommitted: 0 };
  const blame = blameOf(git, file);
  const rows = parts
    .map((s) => ({ s, paths: new Set(here.filter((c) => c.line - 1 >= s.start && c.line - 1 <= s.end).map((c) => c.path)) }))
    .filter((row) => row.paths.size)
    .map((row) => ({ ...row, when: dateOf(blame, row.s, now) }));
  const oldest = rows.reduce((at, row) => Math.min(at, row.when.at), now);
  const paths = [...new Set(rows.flatMap((r) => [...r.paths]))];
  const commits = commitsSince(git, oldest, paths);
  return {
    sections: rows.map((row) => sectionOf(file, row, commits, now)),
    paths,
    counted: parts.length,
    quiet: parts.length - rows.length,
    uncommitted: !blame || blame.some((t) => t.sha === NOBODY) ? 1 : 0,
  };
}

/** One section of the report: how many of the files it cites changed after it was written, and in how many commits. */
function sectionOf(file, { s, paths, when }, commits, now) {
  const hits = commits
    .filter((c) => c.at > when.at)
    .map((c) => [...paths].filter((p) => [...c.files].some((f) => f === p || f.startsWith(`${p}/`))));
  return {
    file,
    line: s.line,
    section: s.title,
    since: new Date(when.at * 1000).toISOString(),
    age: when.committed ? ageOf(when.at, now) : 'not committed',
    cited: paths.size,
    changed: new Set(hits.flat()).size,
    commits: hits.filter((h) => h.length).length,
  };
}
