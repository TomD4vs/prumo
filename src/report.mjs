/**
 * prumo — the text report, shared by the CLI and the MCP server. Without colour it is the plain
 * text the README shows and every pipe receives; colour is for a terminal only.
 */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const ESC = '\x1b[';
/** The card's teal for what is right, orange for what the note says, red and yellow for the badges. */
const PAINT = { bold: '1', dim: '38;5;245', teal: '38;5;79', orange: '38;5;173', red: '38;5;203', yellow: '38;5;221', blue: '38;5;75' };

/** The painters, each one a no-op without colour, so the plain text is built by the same lines. */
function palette(color) {
  const paint = (code) => (color ? (s) => `${ESC}${code}m${s}${ESC}0m` : (s) => s);
  return {
    bold: paint(PAINT.bold),
    dim: paint(PAINT.dim),
    teal: paint(PAINT.teal),
    orange: paint(PAINT.orange),
    badge: (code, s) => `${ESC}7;${code}m ${s} ${ESC}0m`,
  };
}

/**
 * Renders a result the way the README shows it.
 * @param {object} result   what analyze() returned
 * @param {object} [opts]
 * @param {boolean} [opts.all]     list every finding instead of the first 25
 * @param {object}  [opts.fixed]   what applyCaseFixes() returned, when --fix ran
 * @param {string}  [opts.jsonPath] file the findings were also written to
 * @param {boolean} [opts.color]   paint it for a terminal
 */
export function renderText(result, { all = false, fixed = null, jsonPath = null, color = false } = {}) {
  const { caseMismatch, brokenLinks, missingPaths, unknownCommands = [], configIssues = [], orphans, elsewhere = [], stats } = result;
  const total = caseMismatch.length + brokenLinks.length + missingPaths.length + unknownCommands.length + configIssues.length + orphans.length;
  const { bold, dim, teal, orange, badge } = palette(color);
  const out = [];
  const cap = (list) => (all ? list : list.slice(0, 25));
  const rest = (list) => (!all && list.length > 25 ? [dim(`  … ${list.length - 25} more (use --all)`), ''] : ['']);
  const title = (label, code, n, caption) => (color
    ? `${badge(code, label)} ${bold(String(n))}${caption ? `   ${dim(caption)}` : ''}`
    : `${label}  (${n})${caption ? `   ${caption}` : ''}`);
  const at = (o) => bold(`${o.file}:${o.line}`);

  out.push(bold('prumo') + dim(` — ${plural(stats.targets, 'context file', 'context files')}, ${plural(stats.tracked, 'file', 'files')} in the git index`));
  if (stats.historical) out.push(dim(`        ${plural(stats.historical, 'historical entry', 'historical entries')} exempt from path checks`));
  if (stats.suppressed) out.push(dim(`        ${plural(stats.suppressed, 'line or file', 'lines or files')} suppressed by a prumo-ignore marker`));
  if (stats.gitignored) out.push(dim(`        ${plural(stats.gitignored, 'path', 'paths')} under .gitignore exempt from path checks`));
  if (stats.untracked) out.push(dim(`        ${plural(stats.untracked, 'context file', 'context files')} not tracked by git`));
  out.push('');

  if (fixed) {
    const count = `${plural(fixed.paths, 'path', 'paths')} in ${plural(fixed.files, 'file', 'files')}`;
    out.push(color ? `${badge(PAINT.teal, 'FIXED')} ${bold(count)}` : `FIXED  ${count}`);
    for (const c of fixed.changes) out.push(`  ${at(c)}   ${orange(c.cited)}  ${teal('->')}  ${teal(c.actual)}`);
    for (const s of fixed.skipped) out.push(dim(`  skipped ${s.file}:${s.line} (${s.why})`));
    out.push('');
  }

  if (caseMismatch.length) {
    out.push(title('CASE MISMATCH', PAINT.red, caseMismatch.length, 'resolves on Windows and macOS, breaks on Linux and CI'));
    for (const o of cap(caseMismatch)) out.push(`  ${at(o)}`, `      ${orange(o.cited)}`, `      ${teal('->')}  ${teal(o.actual)}`);
    out.push(...rest(caseMismatch));
  }

  if (brokenLinks.length) {
    const withHint = brokenLinks.filter((l) => l.suggestion).length;
    out.push(title('BROKEN LINK', PAINT.yellow, brokenLinks.length, withHint ? `${withHint} with a likely destination` : ''));
    for (const o of cap(brokenLinks)) {
      const shown = o.kind === 'wikilink' ? `[[${o.cited}]]` : o.cited;
      out.push(`  ${at(o)}  ${orange(shown)}${o.suggestion ? `   ${teal('->')}  ${teal(o.suggestion)}` : ''}`);
    }
    out.push(...rest(brokenLinks));
  }

  if (orphans.length) {
    out.push(title('NOT IN INDEX', PAINT.blue, orphans.length, 'file the index never references'));
    for (const o of cap(orphans)) out.push(`  ${orange(o)}`);
    out.push(...rest(orphans));
  }

  if (missingPaths.length) {
    out.push(title('MISSING PATH', PAINT.yellow, missingPaths.length, 'paths cited to say they are gone were filtered out'));
    for (const o of cap(missingPaths)) out.push(`  ${at(o)}  ${orange(o.cited)}`, `      ${dim(o.excerpt)}`);
    out.push(...rest(missingPaths));
  }

  if (unknownCommands.length) {
    out.push(title('UNKNOWN COMMAND', PAINT.yellow, unknownCommands.length, 'no package.json, Makefile or composer.json defines it'));
    for (const o of cap(unknownCommands)) out.push(`  ${at(o)}  ${orange(o.cited)}${o.suggestion ? `   ${teal('->')}  ${teal(o.suggestion)}` : ''}`);
    out.push(...rest(unknownCommands));
  }

  if (configIssues.length) {
    out.push(title('AGENT CONFIG', PAINT.yellow, configIssues.length, 'a setting that points at nothing fails in silence'));
    for (const o of cap(configIssues)) out.push(`  ${at(o)}  ${orange(o.cited)}   ${dim(o.message)}`);
    out.push(...rest(configIssues));
  }

  if (elsewhere.length) {
    out.push(title('ANOTHER PROJECT', PAINT.blue, elsewhere.length, 'its paths start in folders this repository does not have, so its findings are held back'));
    for (const o of cap(elsewhere)) out.push(`  ${bold(o.file)}   ${dim(`${o.absent} of ${o.cited} ${o.unit || 'cited paths'}; name ${o.unit ? 'a rule' : 'the file'} to check it in full`)}`);
    out.push(...rest(elsewhere));
  }

  if (!total) out.push(teal('nothing to review.'));
  else if (!color) out.push(`${total} to review`);
  else {
    const kinds = [
      caseMismatch.length && plural(caseMismatch.length, 'case mismatch', 'case mismatches'),
      brokenLinks.length && plural(brokenLinks.length, 'broken link', 'broken links'),
      orphans.length && plural(orphans.length, 'note not in the index', 'notes not in the index'),
      missingPaths.length && plural(missingPaths.length, 'missing path', 'missing paths'),
      unknownCommands.length && plural(unknownCommands.length, 'unknown command', 'unknown commands'),
      configIssues.length && plural(configIssues.length, 'config issue', 'config issues'),
    ].filter(Boolean);
    out.push(bold(`${total} to review`) + dim(`   ·   ${kinds.join('   ·   ')}`));
  }
  if (jsonPath) out.push(dim(`json: ${jsonPath}`));
  return out.join('\n');
}

/** What each finding is called in SARIF, how serious it is there, and the sentence that describes the rule. */
const SARIF_RULES = {
  'case-mismatch': ['error', 'A path spelled with different letter case than the git index holds. It resolves on Windows and macOS and breaks on Linux and CI.'],
  'broken-link': ['warning', 'A wikilink, a markdown link or a heading anchor that points at nothing.'],
  'missing-path': ['warning', 'A path the note cites that no longer exists in the repository.'],
  'unknown-command': ['warning', 'A command naming a script or target that no package.json, Makefile or composer.json defines.'],
  'agent-config': ['warning', 'A setting in the agent configuration that points at nothing: a rule whose globs match no file, a skill without a description, an MCP server or a hook naming a script that is not here.'],
  'not-in-index': ['note', 'A note in a folder whose index never mentions it.'],
  'another-project': ['note', 'A context file whose cited paths start in folders this repository does not have. Its findings are held back.'],
};

/** SARIF 2.1.0, one result per finding, for GitHub code scanning and any tool that reads that format. */
export function renderSarif(result) {
  const results = [];
  const at = (rule, o, text) => results.push({
    ruleId: rule,
    level: SARIF_RULES[rule][0],
    message: { text },
    locations: [{ physicalLocation: { artifactLocation: { uri: o.file, uriBaseId: '%SRCROOT%' }, ...(o.line ? { region: { startLine: o.line } } : {}) } }],
  });
  for (const o of result.caseMismatch) at('case-mismatch', o, `${o.cited} should be ${o.actual}`);
  for (const o of result.brokenLinks) at('broken-link', o, `${o.kind === 'wikilink' ? `[[${o.cited}]]` : o.cited}${o.suggestion ? ` (did you mean ${o.suggestion}?)` : ''}`);
  for (const o of result.missingPaths) at('missing-path', o, o.cited);
  for (const o of result.unknownCommands || []) at('unknown-command', o, `${o.cited}${o.suggestion ? ` (did you mean ${o.suggestion}?)` : ''}`);
  for (const o of result.configIssues || []) at('agent-config', o, `${o.cited}: ${o.message}`);
  for (const file of result.orphans) at('not-in-index', { file }, `${file} is not referenced by the index beside it`);
  for (const o of result.elsewhere || []) at('another-project', o, `${o.absent} of ${o.cited} ${o.unit || 'cited paths'} ${o.unit ? 'reach no file here' : 'start in folders this repository does not have'}; findings held back`);
  return JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'prumo',
          version: result.prumoVersion,
          informationUri: 'https://github.com/TomD4vs/prumo',
          rules: Object.entries(SARIF_RULES).map(([id, [level, text]]) => ({ id, shortDescription: { text }, defaultConfiguration: { level } })),
        },
      },
      results,
    }],
  }, null, 2);
}

/** GitHub Actions annotations, one per finding. */
export function renderGithub(result) {
  const { caseMismatch, brokenLinks, missingPaths, unknownCommands = [], configIssues = [], orphans, elsewhere = [] } = result;
  const lines = [];
  const say = (level, o, msg) => lines.push(`::${level} file=${o.file},line=${o.line}::${msg}`);
  for (const o of elsewhere) lines.push(`::notice file=${o.file}::Documents another project: ${o.absent} of ${o.cited} ${o.unit || 'cited paths'} ${o.unit ? 'reach no file here' : 'start in folders this repository does not have'}; findings held back`);
  for (const o of configIssues) say('warning', o, `Agent config: ${o.cited} ${o.message}`);
  for (const o of caseMismatch) say('error', o, `Case mismatch: ${o.cited} should be ${o.actual}`);
  for (const o of brokenLinks) say('warning', o, `Broken link: ${o.cited}${o.suggestion ? ` — did you mean ${o.suggestion}?` : ''}`);
  for (const o of missingPaths) say('warning', o, `Missing path: ${o.cited}`);
  for (const o of unknownCommands) say('warning', o, `Unknown command: ${o.cited}${o.suggestion ? ` — did you mean ${o.suggestion}?` : ''}`);
  for (const o of orphans) lines.push(`::notice::Not in index: ${o}`);
  return lines.join('\n');
}
