import { BASELINE_FILE } from './check.mjs';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** What a note wrote, the way it wrote it: `[[name]]` for a wikilink, `@path` for an import, the path alone otherwise. */
const shown = (o, value = o.cited) => (o.kind === 'wikilink' ? `[[${value}]]` : o.kind === 'import' ? `@${value}` : value);

const ONE_LINE = 100;
const SHOWN = 25;

const ESC = '\x1b[';
const PAINT = { bold: '1', dim: '38;5;245', teal: '38;5;79', orange: '38;5;173', red: '38;5;203', yellow: '38;5;221', blue: '38;5;75' };

/**
 * The painters, each one a no-op without colour, so the plain text is built by the same lines: the
 * teal of the social card for what is right, orange for what the note says, red and yellow for the
 * badges. `title` writes the head of a section, a badge with the count at a terminal and the label
 * with the count in brackets in plain text.
 */
function palette(color) {
  const paint = (code) => (color ? (s) => `${ESC}${code}m${s}${ESC}0m` : (s) => s);
  const p = { bold: paint(PAINT.bold), dim: paint(PAINT.dim), teal: paint(PAINT.teal), orange: paint(PAINT.orange), color };
  p.badge = (code, s) => `${ESC}7;${code}m ${s} ${ESC}0m`;
  p.title = (label, code, n, caption) => (color
    ? `${p.badge(code, label)} ${p.bold(String(n))}${caption ? `   ${p.dim(caption)}` : ''}`
    : `${label}  (${n})${caption ? `   ${caption}` : ''}`);
  return p;
}

/** The lines of a list, the first twenty-five unless `all`, with how many more there are, and a blank line after. */
function listed(list, all, p, lineOf) {
  const lines = (all ? list : list.slice(0, SHOWN)).flatMap((o) => lineOf(o, p));
  const more = !all && list.length > SHOWN ? [p.dim(`  … ${list.length - SHOWN} more (use --all)`)] : [];
  return [...lines, ...more, ''];
}

/** A section of a report: its title and its lines when the list has anything, nothing otherwise. */
function section(p, all, { label, code, caption, list, line }) {
  return list.length ? [p.title(label, code, list.length, caption(list)), ...listed(list, all, p, line)] : [];
}

const HISTORY_LINES = {
  renamed: (h, p) => [`      ${p.teal('->')}  ${p.teal(h.to)}   ${p.dim(`renamed in ${h.commit}, ${h.when}`)}`],
  deleted: (h, p) => [`      ${p.dim(`deleted in ${h.commit}, ${h.when}`)}`],
};

/** What git recorded about a missing path or a link, as the lines under it, or nothing. */
const historyLines = (o, p) => (o.history ? HISTORY_LINES[o.history.event](o.history, p) : []);

/** A case mismatch on one line while it fits in a hundred characters, and the correction on lines of its own past that. */
function caseLines(o, p) {
  const at = p.bold(`${o.file}:${o.line}`);
  const fits = `  ${o.file}:${o.line}  ${shown(o)}   ->  ${shown(o, o.actual)}`.length <= ONE_LINE;
  return fits
    ? [`  ${at}  ${p.orange(shown(o))}   ${p.teal('->')}  ${p.teal(shown(o, o.actual))}`]
    : [`  ${at}`, `      ${p.orange(shown(o))}`, `      ${p.teal('->')}  ${p.teal(shown(o, o.actual))}`];
}

/** The suggestion after a finding, `->  name`, when there is one and git does not say better. */
const arrowTo = (o, p) => (o.suggestion && !o.history ? `   ${p.teal('->')}  ${p.teal(o.suggestion)}` : '');

const FINDING_SECTIONS = [
  { key: 'caseMismatch', label: 'CASE MISMATCH', code: PAINT.red, caption: () => 'wrong letter case: works on Windows and macOS, fails on Linux and CI', line: caseLines },
  {
    key: 'brokenLinks', label: 'BROKEN LINK', code: PAINT.yellow,
    caption: (list) => { const hints = list.filter((l) => l.suggestion).length; return `points at a page or heading that is not there${hints ? `; ${hints} with a likely destination` : ''}`; },
    line: (o, p) => [`  ${p.bold(`${o.file}:${o.line}`)}  ${p.orange(shown(o))}${arrowTo(o, p)}`, ...historyLines(o, p)],
  },
  { key: 'orphans', label: 'NOT IN INDEX', code: PAINT.blue, caption: () => 'in the folder, but MEMORY.md never mentions it', line: (o, p) => [`  ${p.orange(o)}`] },
  {
    key: 'missingPaths', label: 'MISSING PATH', code: PAINT.yellow, caption: () => 'the note cites it, but git tracks no such file or folder',
    line: (o, p) => [`  ${p.bold(`${o.file}:${o.line}`)}  ${p.orange(o.cited)}`, `      ${p.dim(o.excerpt)}`, ...historyLines(o, p)],
  },
  { key: 'unknownCommands', label: 'UNKNOWN COMMAND', code: PAINT.yellow, caption: () => 'no package.json, Makefile or composer.json defines it', line: (o, p) => [`  ${p.bold(`${o.file}:${o.line}`)}  ${p.orange(o.cited)}${arrowTo(o, p)}`] },
  { key: 'configIssues', label: 'AGENT CONFIG', code: PAINT.yellow, caption: () => 'a setting that points at nothing fails in silence', line: (o, p) => [`  ${p.bold(`${o.file}:${o.line}`)}  ${p.orange(o.cited)}   ${p.dim(o.message)}`] },
  {
    key: 'elsewhere', label: 'ANOTHER PROJECT', code: PAINT.blue, caption: () => 'its paths start in folders this repository does not have, so its findings are held back',
    line: (o, p) => [`  ${p.bold(o.file === '.' ? 'the repository' : o.file)}   ${p.dim(`${o.absent} of ${o.cited} ${o.unit || 'cited paths'}; name ${o.unit ? 'a rule' : o.file === '.' ? 'a file' : 'the file'} to check it in full`)}`],
  },
];

const HEADER_NOTES = [
  (s) => s.historical && `${plural(s.historical, 'historical entry', 'historical entries')} exempt from path checks`,
  (s) => s.suppressed && `${plural(s.suppressed, 'line or file', 'lines or files')} suppressed by a prumo-ignore marker`,
  (s) => s.gitignored && `${plural(s.gitignored, 'path', 'paths')} under .gitignore exempt from path checks`,
  (s) => s.untracked && `${plural(s.untracked, 'context file', 'context files')} not tracked by git`,
  (s) => s.only && `only the context files ${s.only === 'staged' ? 'staged for commit' : `changed ${s.only}`}`,
  (s) => s.baselined && `${plural(s.baselined, 'finding', 'findings')} held in ${BASELINE_FILE}${s.baselineStale ? `; ${plural(s.baselineStale, 'entry there matches', 'entries there match')} nothing now` : ''}`,
];

const NEXT_STEPS = [
  (fixable, others, p) => fixable && p.bold('prumo --fix') + p.dim(`   corrects ${fixable} in place: letter case, and the renames git recorded`),
  (fixable, others, p) => others && p.dim(`edit the ${fixable ? 'other ' : ''}${others}, or mark a line <!-- prumo-ignore --> when the note is right`),
];

/**
 * The last lines of the check: nothing to review, or the count with what `--fix` corrects, which at a
 * terminal is followed by the next steps unless a fix just ran.
 */
function closing(total, fixable, fixed, p) {
  if (!total) return [p.teal('nothing to review.')];
  if (!p.color) return [`${total} to review${fixable ? `, --fix corrects ${fixable}` : ''}`];
  const head = p.bold(`${total} to review`) + (fixable ? p.dim(`   ·   --fix corrects ${fixable}`) : '');
  if (fixed) return [head];
  const rows = NEXT_STEPS.map((step) => step(fixable, total - fixable, p)).filter(Boolean);
  return [head, p.dim('  next  ') + rows[0], ...rows.slice(1).map((r) => '        ' + r)];
}

/** What a fix pass did, before the findings: each path rewritten, with the commit of a rename, and each line skipped. */
function fixedLines(fixed, p) {
  const count = `${plural(fixed.paths, 'path', 'paths')} in ${plural(fixed.files, 'file', 'files')}`;
  return [
    p.color ? `${p.badge(PAINT.teal, 'FIXED')} ${p.bold(count)}` : `FIXED  ${count}`,
    ...fixed.changes.map((c) => `  ${p.bold(`${c.file}:${c.line}`)}   ${p.orange(shown(c))}  ${p.teal('->')}  ${p.teal(shown(c, c.actual))}${c.why === 'rename' ? `   ${p.dim(`renamed in ${c.commit}`)}` : ''}`),
    ...fixed.skipped.map((s) => p.dim(`  skipped ${s.file}:${s.line} (${s.why})`)),
    '',
  ];
}

/** The last dim lines of any report: what `--baseline` recorded and where `--json` wrote, each when it happened. */
const footer = (p, notes) => notes.filter(([on]) => on !== null && on !== undefined && on !== '').map(([, text]) => p.dim(text()));

/**
 * Renders a result the way the README shows it. Without colour it is the plain text every pipe
 * receives. A case mismatch takes one line while it fits in a hundred characters, and puts the
 * correction on lines of its own past that.
 * @param {object} result   what analyze() returned
 * @param {object} [opts]
 * @param {boolean} [opts.all]     list every finding instead of the first 25
 * @param {object}  [opts.fixed]   what applyFixes() returned, when --fix ran
 * @param {string}  [opts.jsonPath] file the findings were also written to
 * @param {boolean} [opts.color]   paint it for a terminal
 * @param {number}  [opts.baselineWritten] how many findings --baseline just recorded
 */
export function renderText(result, { all = false, fixed = null, jsonPath = null, color = false, baselineWritten = null } = {}) {
  const { stats } = result;
  const p = palette(color);
  const lists = Object.fromEntries(FINDING_SECTIONS.map((s) => [s.key, result[s.key] || []]));
  const total = ['caseMismatch', 'brokenLinks', 'missingPaths', 'unknownCommands', 'configIssues', 'orphans'].reduce((n, k) => n + lists[k].length, 0);
  const renamed = (o) => o.history && o.history.event === 'renamed';
  const fixable = fixed ? 0 : lists.caseMismatch.length + lists.brokenLinks.filter(renamed).length + lists.missingPaths.filter(renamed).length;
  return [
    p.bold('prumo') + p.dim(` — ${plural(stats.targets, 'context file', 'context files')}, ${plural(stats.tracked, 'file', 'files')} tracked by git`),
    ...HEADER_NOTES.map((note) => note(stats)).filter(Boolean).map((text) => p.dim(`        ${text}`)),
    '',
    ...(fixed ? fixedLines(fixed, p) : []),
    ...FINDING_SECTIONS.flatMap((s) => section(p, all, { ...s, list: lists[s.key] })),
    ...closing(total, fixable, fixed, p),
    ...footer(p, [[baselineWritten, () => `baseline: ${BASELINE_FILE}, ${plural(baselineWritten, 'finding', 'findings')} recorded`], [jsonPath, () => `json: ${jsonPath}`]]),
  ].join('\n');
}

const count = (n) => n.toLocaleString('en-US');
const cell = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
const right = (s, w) => ' '.repeat(Math.max(0, w - s.length)) + s;
const widest = (list, of) => list.reduce((w, o) => Math.max(w, of(o).length), 0);

/** The first twenty-five of a list unless `all`, which is what the columns of a report are measured on. */
const visible = (list, all) => (all ? list : list.slice(0, SHOWN));

const OUTCOME_PAINT = { reported: 'orange', held: 'dim', excused: 'dim', resolved: 'teal' };

/** What `--explain` says when no event came out of the line: why it was not read, or that nothing on it reads as a citation. */
const quietLine = (result, p) => (result.skipped
  ? p.dim(`this line is not read: ${result.skipped}`)
  : p.teal('nothing on this line reads as a path, a link, an import or a command.'));

/**
 * Renders what `--explain` found on one line: the line itself, then each citation with what the
 * checks decided, reported, resolved, excused or held back, and why, with the file a resolved one reached.
 * @param {object} result   what explain() returned
 * @param {object} [opts]   `color` and `jsonPath`, as for renderText()
 */
export function renderExplain(result, { color = false, jsonPath = null } = {}) {
  const p = palette(color);
  const w1 = widest(result.events, (e) => e.cited);
  const w2 = widest(result.events, (e) => e.outcome);
  const row = (e) => `  ${p.bold(cell(e.cited, w1))}   ${p[OUTCOME_PAINT[e.outcome]](cell(e.outcome, w2))}   ${e.reason}${e.to && e.to !== e.cited ? `   ${p.teal('->')}  ${p.teal(e.to)}` : ''}`;
  return [
    p.bold('prumo') + p.dim(` — explain ${result.file}:${result.line}`),
    p.dim(`  ${result.text.trim() || '(a blank line)'}`),
    '',
    ...(result.events.length ? result.events.map(row) : [quietLine(result, p)]),
    ...footer(p, [[jsonPath, () => `json: ${jsonPath}`]]),
  ].join('\n');
}

/**
 * Renders the drift report: the sections that cite a file the repository has, ordered by the
 * commits that touched what they cite since the section itself last changed.
 * @param {object} result   what drift() returned
 * @param {object} [opts]   `all`, `color` and `jsonPath`, as for renderText()
 */
export function renderDrift(result, { all = false, color = false, jsonPath = null } = {}) {
  const { sections, stats } = result;
  const p = palette(color);
  const name = (o) => o.section || '(top)';
  const shownRows = visible(sections, all);
  const w1 = Math.min(50, widest(shownRows, (o) => `${o.file}:${o.line}`));
  const w2 = Math.min(40, widest(shownRows, name));
  const w3 = widest(shownRows, (o) => o.age);
  const row = (o) => {
    const moved = `${o.changed} of ${plural(o.cited, 'cited file', 'cited files')} changed${o.commits ? `, ${plural(o.commits, 'commit', 'commits')} since` : ''}`;
    return [`  ${p.bold(cell(`${o.file}:${o.line}`, w1))}  ${cell(name(o).slice(0, 40), w2)}   ${p.dim(cell(o.age, w3))}   ${o.commits ? p.teal(moved) : p.dim(moved)}`];
  };
  return [
    p.bold('prumo') + p.dim(` — drift, ${plural(stats.targets, 'context file', 'context files')}, ${plural(stats.sections, 'section', 'sections')}, ${plural(stats.cited, 'cited file', 'cited files')}`),
    ...(stats.uncommitted ? [p.dim(`        ${plural(stats.uncommitted, 'context file', 'context files')} with lines not committed yet`)] : []),
    '',
    ...(sections.length
      ? section(p, all, { label: 'DRIFT', code: PAINT.blue, caption: () => 'commits to the files a section cites since the section last changed, most first', list: sections, line: row })
      : [p.teal('no section cites a file the repository has.'), '']),
    ...footer(p, [[stats.quiet || null, () => `${plural(stats.quiet, 'section cites', 'sections cite')} nothing the repository has`], [jsonPath, () => `json: ${jsonPath}`]]),
  ].join('\n').trimEnd();
}

/**
 * Renders the coverage report: the folders no context file cites, the most commits first, and how
 * many folders are cited.
 * @param {object} result   what coverage() returned
 * @param {object} [opts]   `all`, `color` and `jsonPath`, as for renderText()
 */
export function renderCoverage(result, { all = false, color = false, jsonPath = null } = {}) {
  const { folders, stats } = result;
  const p = palette(color);
  const shownRows = visible(folders, all);
  const w1 = widest(shownRows, (o) => o.folder);
  const w2 = widest(shownRows, (o) => count(o.files));
  const w3 = widest(shownRows, (o) => count(o.commits));
  const row = (o) => {
    const active = `${right(count(o.commits), w3)} ${o.commits === 1 ? 'commit ' : 'commits'}`;
    return [`  ${p.bold(cell(o.folder, w1))}   ${right(count(o.files), w2)} ${o.files === 1 ? 'file ' : 'files'}   ${o.commits ? p.teal(active) : p.dim(active)}   ${p.dim(o.age === 'not committed' ? o.age : `last ${o.age}`)}`];
  };
  return [
    p.bold('prumo') + p.dim(` — coverage, ${plural(stats.targets, 'context file', 'context files')}, ${plural(stats.folders, 'folder', 'folders')} of code, ${stats.cited} cited`),
    '',
    ...(folders.length
      ? section(p, all, { label: 'UNCITED', code: PAINT.blue, caption: () => `folders no context file mentions, most commits in ${stats.days} days first`, list: folders, line: row })
      : [p.teal('every folder of code is cited by a context file.'), '']),
    ...footer(p, [[jsonPath, () => `json: ${jsonPath}`]]),
  ].join('\n').trimEnd();
}

const GROWTH = {
  changed: (o, date) => `${o.delta > 0 ? '+' : ''}${count(o.delta)} since ${date}`,
  new: (o, date) => `new since ${date}`,
  untracked: () => 'not in git',
  unchanged: () => 'unchanged',
};

const WHEN_READ = {
  session: () => 'every session',
  listed: (o) => `when used, ${count(o.own)} listed`,
  use: () => 'when used',
};

/** When the agents read a file, and what its imports add, in the words of the budget report. */
const whenRead = (o) => WHEN_READ[o.load](o) + (o.imported ? `, +${count(o.imported)} imported` : '');

/**
 * Renders the budget report: what the context files cost at every session and what they add when
 * used, then each file with its estimated tokens and when it is read, the cost at every session
 * first, the growth since an earlier commit, and the paragraphs written twice.
 * @param {object} result   what budget() returned
 * @param {object} [opts]   `all`, `color` and `jsonPath`, as for renderText()
 */
export function renderBudget(result, { all = false, color = false, jsonPath = null } = {}) {
  const { files, repeated, stats } = result;
  const p = palette(color);
  const shownRows = visible(files, all);
  const w1 = widest(shownRows, (o) => o.file);
  const w2 = widest(shownRows, (o) => count(o.tokens));
  const w3 = widest(shownRows, (o) => count(o.lines));
  const w4 = widest(shownRows, whenRead);
  const row = (o) => {
    const g = stats.since ? (GROWTH[o.state] || GROWTH.unchanged)(o, stats.since.date) : '';
    return [`  ${p.bold(cell(o.file, w1))}   ${right(count(o.tokens), w2)} tokens   ${right(count(o.lines), w3)} lines   ${g ? cell(whenRead(o), w4) : whenRead(o)}${g ? `   ${o.state === 'changed' && o.delta > 0 ? p.orange(g) : p.dim(g)}` : ''}`];
  };
  const where = (at) => `${at.file}:${at.line}`;
  const grown = stats.since ? stats.tokens - stats.before : 0;
  return [
    p.bold('prumo') + p.dim(` — budget, ${plural(stats.targets, 'context file', 'context files')}, ${count(stats.session)} tokens at every session${stats.whenUsed ? ` and ${count(stats.whenUsed)} more when used` : ''}, at four characters each`),
    p.dim(stats.since ? `        since ${stats.since.ref}, ${stats.since.date}: ${grown > 0 ? '+' : ''}${count(grown)} tokens` : '        no earlier commit to compare with'),
    '',
    ...section(p, all, { label: 'BUDGET', code: PAINT.blue, caption: () => 'what every session reads first, then the largest', list: files, line: row }),
    ...(repeated.length
      ? section(p, all, { label: 'REPEATED', code: PAINT.yellow, caption: () => 'a paragraph of twelve words or more written in more than one place', list: repeated, line: (r) => [`  ${p.bold(where(r.at[0]))}   ${p.dim('also at')} ${r.at.slice(1).map(where).join(', ')}   ${p.teal(`${count(r.words)} words`)}`] })
      : [p.teal('nothing written twice.'), '']),
    ...footer(p, [[jsonPath, () => `json: ${jsonPath}`]]),
  ].join('\n').trimEnd();
}

/** What git recorded about the path, as a parenthesis for the one-line formats. */
const historyNote = (o) => (o.history ? ` (${o.history.event === 'renamed' ? `renamed to ${o.history.to}` : 'deleted'} in ${o.history.commit}, ${o.history.when})` : '');

/** What git recorded, or else the likely destination, written after a finding in one line, `lead` and `end` around the suggestion. */
const hintOf = (o, lead, end) => (o.history ? historyNote(o) : o.suggestion ? `${lead}${o.suggestion}${end}` : '');

/** What another project's file holds back, in the words of the one-line formats. */
const heldBack = (o) => `${o.absent} of ${o.cited} ${o.unit || 'cited paths'} ${o.unit ? 'reach no file here' : 'start in folders this repository does not have'}; findings held back`;

const SARIF_RULES = [
  { id: 'case-mismatch', level: 'error', text: 'A path spelled with different letter case than the git index holds. It resolves on Windows and macOS and breaks on Linux and CI.', list: (r) => r.caseMismatch, message: (o) => `${shown(o)} should be ${shown(o, o.actual)}` },
  { id: 'broken-link', level: 'warning', text: 'A wikilink, a markdown link or a heading anchor that points at nothing.', list: (r) => r.brokenLinks, message: (o) => `${shown(o)}${hintOf(o, ' (did you mean ', '?)')}` },
  { id: 'missing-path', level: 'warning', text: 'A path the note cites that no longer exists in the repository.', list: (r) => r.missingPaths, message: (o) => `${o.cited}${historyNote(o)}` },
  { id: 'unknown-command', level: 'warning', text: 'A command naming a script or target that no package.json, Makefile or composer.json defines.', list: (r) => r.unknownCommands || [], message: (o) => `${o.cited}${o.suggestion ? ` (did you mean ${o.suggestion}?)` : ''}` },
  { id: 'agent-config', level: 'warning', text: 'A setting in the agent configuration that points at nothing: a rule whose globs match no file, a skill without a description, an MCP server or a hook naming a script that is not here.', list: (r) => r.configIssues || [], message: (o) => `${o.cited}: ${o.message}` },
  { id: 'not-in-index', level: 'note', text: 'A note in a folder whose index never mentions it.', list: (r) => r.orphans.map((file) => ({ file })), message: (o) => `${o.file} is not referenced by the index beside it` },
  { id: 'another-project', level: 'note', text: 'A context file whose cited paths start in folders this repository does not have. Its findings are held back.', list: (r) => r.elsewhere || [], message: heldBack },
];

/**
 * SARIF 2.1.0, one result per finding, for GitHub code scanning and any tool that reads that format,
 * each rule with the level it has there and the sentence that describes it.
 */
export function renderSarif(result) {
  const results = SARIF_RULES.flatMap((rule) => rule.list(result).map((o) => ({
    ruleId: rule.id,
    level: rule.level,
    message: { text: rule.message(o) },
    locations: [{ physicalLocation: { artifactLocation: { uri: o.file, uriBaseId: '%SRCROOT%' }, ...(o.line ? { region: { startLine: o.line } } : {}) } }],
  })));
  return JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'prumo',
          version: result.prumoVersion,
          informationUri: 'https://github.com/TomD4vs/prumo',
          rules: SARIF_RULES.map(({ id, level, text }) => ({ id, shortDescription: { text }, defaultConfiguration: { level } })),
        },
      },
      results,
    }],
  }, null, 2);
}

/** An annotation on a file and a line. */
const annotate = (level, o, message) => `::${level} file=${o.file},line=${o.line}::${message}`;

const GITHUB_LINES = [
  (r) => (r.stats && r.stats.baselined ? [`::notice::Baseline: ${plural(r.stats.baselined, 'finding', 'findings')} held in ${BASELINE_FILE}`] : []),
  (r) => (r.elsewhere || []).map((o) => `::notice file=${o.file}::Documents another project: ${heldBack(o)}`),
  (r) => (r.configIssues || []).map((o) => annotate('warning', o, `Agent config: ${o.cited} ${o.message}`)),
  (r) => r.caseMismatch.map((o) => annotate('error', o, `Case mismatch: ${shown(o)} should be ${shown(o, o.actual)}`)),
  (r) => r.brokenLinks.map((o) => annotate('warning', o, `Broken link: ${o.kind === 'wikilink' ? o.cited : shown(o)}${hintOf(o, ' — did you mean ', '?')}`)),
  (r) => r.missingPaths.map((o) => annotate('warning', o, `Missing path: ${o.cited}${historyNote(o)}`)),
  (r) => (r.unknownCommands || []).map((o) => annotate('warning', o, `Unknown command: ${o.cited}${o.suggestion ? ` — did you mean ${o.suggestion}?` : ''}`)),
  (r) => r.orphans.map((o) => `::notice::Not in index: ${o}`),
];

/** GitHub Actions annotations, one per finding. */
export function renderGithub(result) {
  return GITHUB_LINES.flatMap((lines) => lines(result)).join('\n');
}
