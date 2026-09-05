/**
 * prumo — the drift report: which sections of a context file describe code that changed after the
 * section was last written. Nothing here is a finding. A section that names five files changed forty
 * times since it was written may still be right, and one whose files never changed may be wrong. The
 * report orders the sections by how much the code beneath them moved, so a reader knows where to
 * look first, and it says so with dates git recorded rather than with a judgement.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { analyze, classifyLines, readTextFile, ageOf, SCHEMA_VERSION, VERSION } from './check.mjs';

/** What git blame writes for a line that is not committed yet. */
const NOBODY = '0000000000000000000000000000000000000000';
/** How many cited paths one git log is asked about; a command line has a length limit on Windows. */
const CHUNK = 100;

/** A pathspec that git reads literally, since a cited path may hold a character git would read as a pattern. */
const literal = (p) => (/[*?[\]]/.test(p) || p.startsWith(':') ? `:(literal)${p}` : p);

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
    // A heading written as a link keeps its text; the address is not part of the title.
    current = { title: h[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim(), line: i + 1, start: i, end: -1 };
  }
  current.end = lines.length - 1;
  if (current.title || speaks(current.start, lines.length)) out.push(current);
  return out;
}

/** The commit and committer time of every line of a tracked file, in line order, or null when git cannot blame it. */
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

/** Every commit since a date that touched one of the paths, with the touched paths, each commit once. */
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
 * touched what it cites after that. Sections come back ordered, the most moved first.
 * @param {object} opts
 * @param {string} opts.repo      the repository
 * @param {object[]} opts.targets what resolveTargets() returned
 * @param {object} [opts.config]  the configuration, or null to read .prumorc.json
 * @param {number} [opts.now]     the present, in seconds, for the ages
 */
export function drift({ repo, targets, config = null, now = Math.floor(Date.now() / 1000) }) {
  const result = analyze({ repo, targets, config, collect: true });
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  const cites = new Map();
  for (const c of result.citations) {
    let list = cites.get(c.file);
    if (!list) { list = []; cites.set(c.file, list); }
    list.push(c);
  }

  const sections = [];
  const allPaths = new Set();
  let counted = 0, quiet = 0, uncommitted = 0;
  for (const { file, path } of result.files) {
    const body = readTextFile(path);
    if (body === null) continue;
    const lines = body.split('\n');
    // The newline that ends the file is not a line git blames; keeping it would read the last section as uncommitted.
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const parts = sectionsOf(lines);
    counted += parts.length;
    const here = cites.get(file) || [];
    if (!here.length) { quiet += parts.length; continue; }
    const blame = blameOf(git, file);
    if (!blame || blame.some((t) => t.sha === NOBODY)) uncommitted++;
    // A section is as old as the newest commit among its lines, and as fresh as now when one of them is not committed.
    const dateOf = (s) => {
      let at = 0;
      for (let i = s.start; i <= s.end; i++) {
        const t = blame && blame[i];
        if (!t || t.sha === NOBODY) return { at: now, committed: false };
        if (t.at > at) at = t.at;
      }
      return at ? { at, committed: true } : { at: now, committed: false };
    };
    const rows = [];
    let oldest = now;
    for (const s of parts) {
      const paths = new Set(here.filter((c) => c.line - 1 >= s.start && c.line - 1 <= s.end).map((c) => c.path));
      if (!paths.size) { quiet++; continue; }
      const when = dateOf(s);
      if (when.at < oldest) oldest = when.at;
      rows.push({ s, paths, when });
      for (const p of paths) allPaths.add(p);
    }
    const commits = commitsSince(git, oldest, [...new Set(rows.flatMap((r) => [...r.paths]))]);
    for (const { s, paths, when } of rows) {
      const touched = new Set();
      let n = 0;
      for (const c of commits) {
        if (c.at <= when.at) continue;
        let hit = false;
        for (const f of c.files) for (const p of paths) if (f === p || f.startsWith(`${p}/`)) { touched.add(p); hit = true; }
        if (hit) n++;
      }
      sections.push({
        file,
        line: s.line,
        section: s.title,
        since: new Date(when.at * 1000).toISOString(),
        age: when.committed ? ageOf(when.at, now) : 'not committed',
        cited: paths.size,
        changed: touched.size,
        commits: n,
      });
    }
  }
  sections.sort((a, b) => b.commits - a.commits || b.changed - a.changed || a.since.localeCompare(b.since) || a.file.localeCompare(b.file) || a.line - b.line);

  return {
    schemaVersion: SCHEMA_VERSION,
    prumoVersion: VERSION,
    repo: resolve(repo),
    checkedAt: new Date().toISOString(),
    command: 'drift',
    sections,
    stats: { targets: result.files.length, sections: counted, cited: allPaths.size, quiet, uncommitted },
  };
}
