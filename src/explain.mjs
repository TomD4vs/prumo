import { relative, sep, posix } from 'node:path';
import { analyze, readTextFile, SCHEMA_VERSION, VERSION, BASELINE_FILE } from './check.mjs';
import { gitIgnored } from './check/repository.mjs';

const LISTS = { 'CASE MISMATCH': 'caseMismatch', 'BROKEN LINK': 'brokenLinks', 'MISSING PATH': 'missingPaths', 'UNKNOWN COMMAND': 'unknownCommands' };
const BASELINE_KINDS = { caseMismatch: 'case-mismatch', brokenLinks: 'broken-link', missingPaths: 'missing-path', unknownCommands: 'unknown-command' };

/** What a finding holds as `cited` for an event: a wikilink without its brackets, an import without its `@`. */
const citedOf = (event) => (event.kind === 'wikilink' ? event.cited.slice(2, -2) : event.kind === 'import' ? event.cited.slice(1) : event.cited);

/** A context file as a path from the root, whatever label the run gave it. */
const relPathOf = (repo, target) => relative(repo, target.path).split(sep).join('/');

const HELD = [
  { when: (x) => x.result.elsewhere.some((e) => e.file === x.target.label), why: 'held back: most of what this file cites starts in folders this repository does not have' },
  { when: (x) => x.result.elsewhere.some((e) => e.file === '.'), why: 'held back: the context files, taken together, document another project' },
  { when: (x) => x.baseline && x.baseline.findings.some((e) => e.kind === BASELINE_KINDS[x.list] && e.file === x.target.label && e.cited === x.cited), why: `held in ${BASELINE_FILE}` },
  { when: (x) => gitIgnored(x.repo, [x.cited, posix.join(posix.dirname(relPathOf(x.repo, x.target)), x.cited)]).size > 0, why: '.gitignore covers it' },
  { when: (x) => x.list === 'missingPaths' && x.result.brokenLinks.some((l) => l.file === x.target.label && l.line === x.line), why: 'reported once, as the link on this line' },
  { when: (x) => x.list === 'unknownCommands', why: 'the same script appears in this file under more than one package manager, so the commands are a list of alternatives' },
  { when: () => true, why: 'held back after the run' },
];

/**
 * Settles each event the checks noted on the line against the result of the whole run: a finding the
 * checks reported can still be taken back by a gate, the baseline or `.gitignore`, and then it says by which.
 */
function settled(events, x) {
  return events.map((event) => {
    const list = LISTS[event.reason];
    if (event.outcome !== 'reported' || !list) return event;
    const cited = citedOf(event);
    const kept = x.result[list].some((o) => o.file === x.target.label && o.line === x.line && o.cited === cited);
    return kept ? event : { ...event, outcome: 'held', reason: HELD.find((h) => h.when({ ...x, list, cited })).why };
  });
}

/**
 * Why one line of a context file was or was not reported: every path, link, wikilink, anchor, import
 * and command the checks read on it, each with what they decided and why, the file it reached when
 * it resolved, and, when the line was not read at all, the reason.
 * @param {object} opts
 * @param {string} opts.repo      the repository
 * @param {object[]} opts.targets what resolveTargets() returned
 * @param {string} opts.at        `FILE:LINE`, the file as a path from the root of the repository
 * @param {object} [opts.config]  the configuration, or null to read .prumorc.json
 * @param {object} [opts.baseline] the baseline, when the run holds one
 */
export function explain({ repo, targets, at, config = null, baseline = null }) {
  const parts = String(at || '').match(/^(.+):(\d+)$/);
  if (!parts) throw new Error('--explain takes FILE:LINE, as in CLAUDE.md:12');
  const file = parts[1].split('\\').join('/').replace(/^\.\//, '');
  const line = Number(parts[2]);
  const target = targets.find((t) => relPathOf(repo, t) === file || t.label === file);
  if (!target) throw new Error(`${file} is not a context file of this run; name it to check it, as in prumo . ${file}`);
  const lines = (readTextFile(target.path) || '').split(/\r?\n/);
  if (line < 1 || line > lines.length) throw new Error(`${file} has ${lines.length} lines, so there is no line ${line}`);

  const trace = { file: relPathOf(repo, target), line, events: [], skipped: '' };
  const result = analyze({ repo, targets, config, baseline, trace });
  return {
    schemaVersion: SCHEMA_VERSION,
    prumoVersion: VERSION,
    repo: result.repo,
    checkedAt: result.checkedAt,
    command: 'explain',
    file: target.label,
    line,
    text: lines[line - 1],
    skipped: trace.skipped,
    events: settled(trace.events, { repo, result, target, line, baseline }),
  };
}
