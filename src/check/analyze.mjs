/**
 * prumo — the run: each context file read line by line through the checks, then the gates that
 * hold back a file or a repository documenting another project, what `.gitignore` covers, the
 * baseline, and what git recorded about each path that is missing.
 */

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
/** The folders a skill carries beside its `SKILL.md`. Missing, they are the skill's own gap, which is a finding, and never a sign that it documents another project. */
const SKILL_BUNDLE = /^(references|scripts|assets|templates)$/i;

/** True when git tracks the context file, in any letter case. */
function inIndex(run, target) {
  const rel = relative(run.repo, target.path).split(sep).join('/');
  return run.index.known.has(rel) || run.index.lower.has(rel.toLowerCase());
}

/**
 * One context file as the line checks see it: its lines and how each is read, the folder it sits
 * in, the paths a sentence has excused, and the paths it cites, with the ones whose first folder is
 * absent, which is what the gates on another project count.
 */
function scanOf(run, target, body, lines, marked) {
  const isSkill = /(^|\/)SKILL\.md$/i.test(target.label);
  const cited = new Set(), absent = new Set();
  return {
    target, body, lines, marked, cited, absent,
    folder: posix.dirname(relative(run.repo, target.path).split(sep).join('/')),
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

/** Where each list of findings stood before a file was read, so what the file added can be taken back. */
const marksOf = (findings) => ({ caseMismatch: findings.caseMismatch.length, brokenLinks: findings.brokenLinks.length, missingPaths: findings.missingPaths.length, unknownCommands: findings.unknownCommands.length });

/**
 * Reads one context file through every check. A file whose cited paths start, for the most part,
 * in folders this repository does not have documents another project, and what it found is taken
 * back behind one line; a file named on the command line is always checked in full.
 */
function checkFile(run, target) {
  const { findings, counts } = run;
  const body = readTextFile(target.path);
  if (body === null) return;
  if (!inIndex(run, target)) counts.untracked++;
  if (IGNORE_FILE.test(body.slice(0, 400))) { counts.suppressed++; return; }
  const lines = body.split(/\r?\n/);
  const isHistorical = HISTORICAL_NAME.test(target.label) || HISTORICAL_DESC.test(body.slice(0, 600));
  if (isHistorical) counts.historical++;
  const marked = classifyLines(lines);
  const file = scanOf(run, target, body, lines, marked);
  const opened = marksOf(findings);

  marked.forEach((m, i) => {
    if (IGNORE_LINE.test(lines[i]) || (i > 0 && IGNORE_NEXT.test(lines[i - 1]))) { counts.suppressed++; return; }
    if (m.kind === 'skip') return;
    if (!isHistorical) {
      checkPaths(run, file, i, m);
      checkCommands(run, file, i, m);
    }
    if (m.kind === 'code') return;
    const prose = proseOf(m.text);
    checkWikilinks(run, file, i, prose);
    checkLinks(run, file, i, prose);
    checkImports(run, file, i, m);
  });
  dropAlternatives(findings.unknownCommands, opened.unknownCommands);

  if (!target.explicit) {
    for (const p of file.cited) run.citedAll.add(p);
    for (const p of file.absent) run.absentAll.add(p);
  }
  if (!target.explicit && file.absent.size >= 4 && file.absent.size >= file.cited.size * 0.6) {
    findings.elsewhere.push({ file: target.label, cited: file.cited.size, absent: file.absent.size });
    for (const list of Object.keys(opened)) findings[list].splice(opened[list]);
  }
  for (const issue of frontmatterIssues(target.label, lines, run.index)) {
    findings.configIssues.push(issue);
    if (issue.kind === 'glob' && !target.explicit) rulesFolder(run, posix.dirname(target.label)).absent++;
  }
  if (!target.explicit) { const rule = ruleGlobs(target.label, lines); if (rule && rule.globs.length) rulesFolder(run, posix.dirname(target.label)).cited++; }
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
  if (absentAll.size < 12 || absentAll.size < citedAll.size * 0.6) return;
  const held = new Set(checked.filter((t) => !t.explicit).map((t) => t.label));
  for (const list of [findings.caseMismatch, findings.brokenLinks, findings.missingPaths, findings.unknownCommands]) retain(list, (o) => !held.has(o.file));
  findings.elsewhere.length = 0;
  findings.elsewhere.push({ file: '.', cited: citedAll.size, absent: absentAll.size });
}

/** A rules folder where most rules match nothing here is a catalogue written for the projects it gets copied into. */
function holdBackRuleFolders(run) {
  const { findings } = run;
  for (const [folder, count] of run.rulesFolders) {
    if (count.absent < 4 || count.absent < count.cited * 0.6) continue;
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
 * path git knows it by, which is what the drift report reads.
 * @returns {{schemaVersion:number, prumoVersion:string, repo:string, checkedAt:string, caseMismatch:[], brokenLinks:[], missingPaths:[], orphans:[], stats:{}}}
 */
export function analyze({ repo, targets, config = null, baseline = null, only = null, collect = false }) {
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
