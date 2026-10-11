import { existsSync } from 'node:fs';
import { join, relative, resolve, sep, dirname, posix } from 'node:path';
import { VERSION, SCHEMA_VERSION } from './version.mjs';
import { loadConfig, makeMatcher } from './config.mjs';
import { holdBack, retain } from './baseline.mjs';
import { readTextFile, gitIgnored, originRepo } from './repository.mjs';
import { buildIndex, makeResolver } from './git-index.mjs';
import { makeHistorian } from './history.mjs';
import { classifyLines, headingsAbove, IGNORE_LINE, IGNORE_NEXT, IGNORE_FILE } from './lines.mjs';
import { checkPaths } from './paths.mjs';
import { checkCommands, dropAlternatives, makeCommandSources } from './commands.mjs';
import { checkWikilinks, checkLinks, makeLinkTargets, makeAnchors, proseOf } from './links.mjs';
import { checkImports } from './imports.mjs';
import { CONFIG_FILES, frontmatterIssues, configFileIssues, ruleGlobs } from './agent-config.mjs';

const HISTORICAL_NAME = /((phase|fase)[_\- ]?\d*[_\- ]?(done|complete|conclu)|[_-](superseded|superad|historic|revertid|reverted))/i;
const HISTORICAL_DESC = /^description:.*(historical|superseded|reverted|hist[óo]ric|SUPERAD|REVERTID)/im;
const SKILL_BUNDLE = /^(references|scripts|assets|templates)$/i;

/** True when git tracks the context file, in any letter case. */
function inIndex(run, target) {
  const rel = relative(run.repo, target.path).split(sep).join('/');
  return run.index.known.has(rel) || run.index.lower.has(rel.toLowerCase());
}

/**
 * One context file as the line checks see it: its lines and how each is read, the folder it sits
 * in, the paths a sentence has excused, and the paths it cites, with the ones whose first folder is
 * absent, which is what the gates on another project count. In a `SKILL.md`, a folder the skill
 * carries beside it, `references`, `scripts`, `assets` or `templates`, never counts as absent: missing,
 * it is the skill's own gap, which is a finding, and never a sign that it documents another project.
 */
function scanOf(run, target, body, lines, marked) {
  const isSkill = /(^|\/)SKILL\.md$/i.test(target.label);
  const cited = new Set(), absent = new Set();
  const rel = relPathOf(run, target);
  return {
    target, body, lines, marked, cited, absent, rel,
    folder: posix.dirname(rel),
    headings: headingsAbove(lines, marked),
    excused: new Set(),
    cite(p, missing, head = p.split('/')[0]) {
      cited.add(p);
      if (missing && !run.index.known.has(head) && !(isSkill && SKILL_BUNDLE.test(head.slice(head.lastIndexOf('/') + 1)))) absent.add(p);
    },
    record(i, what, path) {
      if (run.citations && path !== target.label) run.citations.push({ file: target.label, line: i + 1, cited: what, path });
    },
    context(i, anchor, before, after) {
      return (anchor === i
        ? lines.slice(Math.max(0, i - before), i + after + 1)
        : lines.slice(Math.max(0, anchor - before), anchor).concat(lines.slice(Math.max(anchor + 1, i - before), i + 1))
      ).join(' ');
    },
  };
}

/** A context file as a path from the root of the repository, whatever label the run gave it. */
const relPathOf = (run, target) => relative(run.repo, target.path).split(sep).join('/');

/**
 * Where `--explain` keeps what happened on the one line it asks about: each candidate the checks
 * read there, with what they decided, and why the line was not read at all when it was not. On any
 * other run both are no-ops, so the checks call them without asking whether anyone listens.
 */
function makeTrace(trace) {
  if (!trace) return { note: () => {}, skipLine: () => {} };
  return {
    note: (file, i, event) => { if (file.rel === trace.file && i + 1 === trace.line) trace.events.push(event); },
    skipLine: (rel, i, why) => { if (rel === trace.file && (i === null || i + 1 === trace.line)) trace.skipped = why; },
  };
}

/** Where each list of findings stood before a file was read, so what the file added can be taken back. */
const marksOf = (findings) => ({ caseMismatch: findings.caseMismatch.length, brokenLinks: findings.brokenLinks.length, missingPaths: findings.missingPaths.length, unknownCommands: findings.unknownCommands.length });

/**
 * Whether what a file, a folder of rules or a repository cites is mostly absent: at least `floor`
 * absent, and six in ten of all it cites, which is how the gates tell another project's notes.
 */
const mostlyAbsent = (absent, cited, floor) => absent >= floor && absent >= cited * 0.6;

const UNREAD_LINES = [
  { when: (file, i) => IGNORE_LINE.test(file.lines[i]) || (i > 0 && IGNORE_NEXT.test(file.lines[i - 1])), why: () => 'silenced by a prumo-ignore marker', suppressed: true },
  { when: (file, i, m) => m.kind === 'skip', why: (m) => m.why },
];

const LINE_CHECKS = [
  { when: (file) => !file.historical, check: checkPaths },
  { when: (file) => !file.historical, check: checkCommands },
  { when: (file) => file.historical, check: (run, file, i) => run.note(file, i, { kind: 'file', cited: file.target.label, outcome: 'excused', reason: 'a historical entry, whose paths and commands are not checked; its links are' }) },
  { when: (file, m) => m.kind === 'prose', check: (run, file, i, m) => checkWikilinks(run, file, i, m.prose) },
  { when: (file, m) => m.kind === 'prose', check: (run, file, i, m) => checkLinks(run, file, i, m.prose) },
  { when: (file, m) => m.kind === 'prose', check: checkImports },
];

/** Reads one line through the checks `LINE_CHECKS` names for it, unless `UNREAD_LINES` says it is not read, and why. */
function checkLine(run, file, i, m) {
  const unread = UNREAD_LINES.find((u) => u.when(file, i, m));
  if (unread) {
    run.counts.suppressed += unread.suppressed ? 1 : 0;
    run.skipLine(file.rel, i, unread.why(m));
    return;
  }
  const line = m.kind === 'prose' ? { ...m, prose: proseOf(m.text) } : m;
  for (const step of LINE_CHECKS) if (step.when(file, line)) step.check(run, file, i, line);
}

/**
 * What one file leaves for the gates: its citations pooled with the repository's, its findings taken
 * back behind one line when what it cites is mostly absent, and the rules of its folder counted.
 * A file named on the command line is always checked in full, so none of this applies to it.
 */
function settleFile(run, file, opened) {
  const { findings } = run;
  const { target } = file;
  for (const p of file.cited) run.citedAll.add(p);
  for (const p of file.absent) run.absentAll.add(p);
  const held = mostlyAbsent(file.absent.size, file.cited.size, 4);
  if (held) findings.elsewhere.push({ file: target.label, cited: file.cited.size, absent: file.absent.size });
  if (held) for (const list of Object.keys(opened)) findings[list].splice(opened[list]);
  const rules = rulesFolder(run, posix.dirname(target.label));
  rules.absent += file.issues.filter((issue) => issue.kind === 'glob').length;
  rules.cited += (ruleGlobs(target.label, file.lines)?.globs.length ?? 0) > 0 ? 1 : 0;
}

/**
 * Reads one context file through every check. A file whose cited paths start, for the most part,
 * in folders this repository does not have documents another project, and what it found is taken
 * back behind one line; a file named on the command line is always checked in full.
 */
function checkFile(run, target) {
  const { findings, counts } = run;
  const body = readTextFile(target.path);
  if (body === null) return;
  counts.untracked += inIndex(run, target) ? 0 : 1;
  if (IGNORE_FILE.test(body.slice(0, 400))) { counts.suppressed++; run.skipLine(relPathOf(run, target), null, 'the whole file is silenced by a prumo-ignore-file marker'); return; }
  const lines = body.split(/\r?\n/);
  const marked = classifyLines(lines);
  const file = scanOf(run, target, body, lines, marked);
  file.historical = HISTORICAL_NAME.test(target.label) || HISTORICAL_DESC.test(body.slice(0, 600));
  counts.historical += file.historical ? 1 : 0;
  const opened = marksOf(findings);

  marked.forEach((m, i) => checkLine(run, file, i, m));
  dropAlternatives(findings.unknownCommands, opened.unknownCommands);
  file.issues = frontmatterIssues(target.label, lines, run.index);
  if (!target.explicit) settleFile(run, file, opened);
  findings.configIssues.push(...file.issues);
}

/** The count of rules a folder holds and of the ones that match nothing, kept per folder. */
function rulesFolder(run, folder) {
  let c = run.rulesFolders.get(folder);
  if (!c) { c = { cited: 0, absent: 0 }; run.rulesFolders.set(folder, c); }
  return c;
}

/**
 * A repository whose context files, taken together, cite mostly absent folders documents another
 * project as a whole: a plugin shipped for another codebase, or notes that link a wiki kept
 * elsewhere, file by file too thin for the gate on one file.
 */
function holdBackRepository(run, checked) {
  const { findings, citedAll, absentAll } = run;
  if (!mostlyAbsent(absentAll.size, citedAll.size, 12)) return;
  const held = new Set(checked.filter((t) => !t.explicit).map((t) => t.label));
  for (const list of [findings.caseMismatch, findings.brokenLinks, findings.missingPaths, findings.unknownCommands]) retain(list, (o) => !held.has(o.file));
  findings.elsewhere.length = 0;
  findings.elsewhere.push({ file: '.', cited: citedAll.size, absent: absentAll.size });
}

/** A rules folder where most rules match nothing here is a catalogue written for the projects it gets copied into. */
function holdBackRuleFolders(run) {
  const { findings } = run;
  for (const [folder, count] of run.rulesFolders) {
    if (!mostlyAbsent(count.absent, count.cited, 4)) continue;
    retain(findings.configIssues, (c) => !(c.kind === 'glob' && posix.dirname(c.file) === folder));
    findings.elsewhere.push({ file: folder, cited: count.cited, absent: count.absent, unit: 'rules' });
  }
}

/** The JSON configuration files of the agents, read once per run that detected its targets on its own. */
function checkConfigFiles(run, excluded, only) {
  const { repo, index, findings } = run;
  for (const rel of CONFIG_FILES) {
    if (!index.known.has(rel) || excluded(rel) || (only && !only.paths.has(rel))) continue;
    const text = readTextFile(join(repo, rel));
    if (text === null) continue;
    run.counts.configs++;
    findings.configIssues.push(...configFileIssues(rel, text, repo, run.ignored, run.resolve));
  }
}

/** Drops each missing path and broken link `.gitignore` covers, and returns how many it dropped. */
function dropGitIgnored(run) {
  const { findings, relOf } = run;
  for (const m of findings.missingPaths) relOf.set(m, m.cited);
  const ignoredByGit = gitIgnored(run.repo, [...new Set(relOf.values())]);
  let gitignored = 0;
  const keep = (f) => {
    const rel = relOf.get(f);
    if (rel && ignoredByGit.has(rel)) { gitignored++; return false; }
    return true;
  };
  retain(findings.missingPaths, keep);
  retain(findings.brokenLinks, keep);
  return gitignored;
}

/** A link whose text is the same path in backticks is one citation, and the link is the one that resolves it. */
function dropLinkedTwice(run) {
  const { findings, relOf } = run;
  const linkedOn = new Map();
  for (const l of findings.brokenLinks) {
    if (l.kind !== 'link' || !relOf.has(l)) continue;
    const key = `${l.file}\0${l.line}`;
    if (!linkedOn.has(key)) linkedOn.set(key, new Set());
    linkedOn.get(key).add(relOf.get(l));
  }
  if (!linkedOn.size) return;
  retain(findings.missingPaths, (o) => {
    const set = linkedOn.get(`${o.file}\0${o.line}`);
    if (!set) return true;
    const bare = o.cited.replace(/^\.\//, '');
    return !set.has(bare) && !set.has(posix.normalize(posix.join(posix.dirname(o.file), bare)));
  });
}

/** The notes in the folder of a `MEMORY.md` that the index never mentions. */
function orphansOf(checked, ignored) {
  const indexFile = checked.find((t) => t.fromDir && /^MEMORY\.md$/i.test(t.label));
  if (!indexFile) return [];
  const folder = dirname(indexFile.path);
  const body = readTextFile(indexFile.path) || '';
  return checked
    .filter((t) => t !== indexFile && t.fromDir && dirname(t.path) === folder && !ignored(t.label))
    .filter((t) => !body.includes(t.label) && !body.includes(t.label.replace(/\.md$/i, '')))
    .map((t) => t.label);
}

/** What git recorded about each missing path and each broken markdown link that reaches inside the repository. */
function attachHistory(run) {
  const { findings, relOf } = run;
  const historian = makeHistorian(run.repo, run.index);
  for (const o of findings.missingPaths) {
    const h = historian.of(o.cited, o.file);
    if (h) o.history = h;
  }
  for (const o of findings.brokenLinks) {
    if (!(o.kind === 'link' || o.kind === 'import') || !relOf.has(o)) continue;
    const h = historian.of(relOf.get(o), o.file, true);
    if (h) o.history = h;
  }
}

/**
 * Runs the five checks. A wikilink may point at any markdown file git tracks,
 * not only at the notes being checked, so the link targets are built from the whole index.
 * A path is reported on every line that cites it, and a path that a sentence excuses stays
 * excused on the lines of that file that follow, since they speak of the same file.
 * `only` limits the targets and the configuration files to the paths it holds, for a run over what
 * a commit or a branch touched. `baseline` holds back the findings it records, counted in `stats.baselined`.
 * With `collect`, every citation that reaches a file or a folder the index holds is kept, with the
 * path git knows it by, which is what the drift report reads. With `trace`, `{ file, line, events }`,
 * every decision the checks take on that one line lands in `events`, which is what `--explain` reads.
 * @returns {{schemaVersion:number, prumoVersion:string, repo:string, checkedAt:string, caseMismatch:[], brokenLinks:[], missingPaths:[], orphans:[], stats:{}}}
 */
export function analyze({ repo, targets, config = null, baseline = null, only = null, collect = false, trace = null }) {
  const index = buildIndex(repo);
  if (!index) throw new Error(`not a git repository: ${repo}`);
  if (!index.tracked.length) throw new Error('the git index is empty, so nothing can be checked against it. Commit or "git add" the files first.');

  const own = originRepo(repo);
  index.name = (own.split('/')[1] || resolve(repo).split(sep).pop() || '').toLowerCase();
  const settings = config ?? loadConfig(repo);
  const excluded = makeMatcher(settings.exclude);
  const checked = targets.filter((t) => !excluded(t.label) && (!only || only.paths.has(t.label)));
  const autoRun = !checked.some((t) => t.explicit);

  const run = {
    repo,
    index,
    own,
    ignored: makeMatcher(settings.ignore),
    transient: makeMatcher(settings.transient),
    resolve: makeResolver(index),
    sources: makeCommandSources(repo, index),
    links: makeLinkTargets(index, checked),
    anchors: makeAnchors(),
    findings: { caseMismatch: [], brokenLinks: [], missingPaths: [], unknownCommands: [], configIssues: [], orphans: [], elsewhere: [] },
    counts: { historical: 0, suppressed: 0, untracked: 0, configs: 0 },
    citedAll: new Set(),
    absentAll: new Set(),
    rulesFolders: new Map(),
    relOf: new Map(),
    citations: collect ? [] : null,
    ...makeTrace(trace),
  };

  for (const target of checked) checkFile(run, target);
  if (autoRun) holdBackRepository(run, checked);
  holdBackRuleFolders(run);
  if (autoRun) checkConfigFiles(run, excluded, only);
  const gitignored = dropGitIgnored(run);
  dropLinkedTwice(run);

  const { findings, counts } = run;
  findings.orphans.push(...orphansOf(checked, run.ignored));
  const { baselined, baselineStale } = baseline ? holdBack(findings, baseline) : { baselined: 0, baselineStale: 0 };
  attachHistory(run);

  return {
    schemaVersion: SCHEMA_VERSION,
    prumoVersion: VERSION,
    repo: resolve(repo),
    checkedAt: new Date().toISOString(),
    command: 'check',
    caseMismatch: findings.caseMismatch,
    brokenLinks: findings.brokenLinks,
    missingPaths: findings.missingPaths,
    unknownCommands: findings.unknownCommands,
    configIssues: findings.configIssues,
    orphans: findings.orphans,
    elsewhere: findings.elsewhere,
    ...(run.citations ? { citations: run.citations, files: checked.map((t) => ({ file: t.label, path: t.path })) } : {}),
    stats: { tracked: index.tracked.length, targets: checked.length, historical: counts.historical, suppressed: counts.suppressed, gitignored, untracked: counts.untracked, configs: counts.configs, baselined, baselineStale, cited: run.citedAll.size, absent: run.absentAll.size, ...(only ? { only: only.label } : {}) },
  };
}
