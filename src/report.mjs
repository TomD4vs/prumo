/**
 * prumo — the text report, shared by the CLI and the MCP server.
 */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Renders a result the way the README shows it.
 * @param {object} result   what analyze() returned
 * @param {object} [opts]
 * @param {boolean} [opts.all]     list every finding instead of the first 25
 * @param {object}  [opts.fixed]   what applyCaseFixes() returned, when --fix ran
 * @param {string}  [opts.jsonPath] file the findings were also written to
 */
export function renderText(result, { all = false, fixed = null, jsonPath = null } = {}) {
  const { caseMismatch, brokenLinks, missingPaths, orphans, stats } = result;
  const total = caseMismatch.length + brokenLinks.length + missingPaths.length + orphans.length;
  const out = [];
  const cap = (list) => (all ? list : list.slice(0, 25));
  const more = (list) => (!all && list.length > 25 ? `  … ${list.length - 25} more (use --all)\n` : '');

  out.push(`prumo — ${plural(stats.targets, 'context file', 'context files')}, ${plural(stats.tracked, 'file', 'files')} in the git index`);
  if (stats.historical) out.push(`        ${plural(stats.historical, 'historical entry', 'historical entries')} exempt from path checks`);
  if (stats.suppressed) out.push(`        ${plural(stats.suppressed, 'line or file', 'lines or files')} suppressed by a prumo-ignore marker`);
  if (stats.gitignored) out.push(`        ${plural(stats.gitignored, 'path', 'paths')} under .gitignore exempt from path checks`);
  out.push('');

  if (fixed) {
    out.push(`FIXED  ${plural(fixed.paths, 'path', 'paths')} in ${plural(fixed.files, 'file', 'files')}`);
    for (const c of fixed.changes) out.push(`  ${c.file}:${c.line}   ${c.cited}  ->  ${c.actual}`);
    for (const s of fixed.skipped) out.push(`  skipped ${s.file}:${s.line} (${s.why})`);
    out.push('');
  }

  if (caseMismatch.length) {
    out.push(`CASE MISMATCH  (${caseMismatch.length})   resolves on Windows and macOS, breaks on Linux and CI`);
    for (const o of cap(caseMismatch)) out.push(`  ${o.file}:${o.line}`, `      ${o.cited}`, `      ->  ${o.actual}`);
    out.push(more(caseMismatch) + '');
  }

  if (brokenLinks.length) {
    const withHint = brokenLinks.filter((l) => l.suggestion).length;
    out.push(`BROKEN LINK  (${brokenLinks.length})${withHint ? `   ${withHint} with a likely destination` : ''}`);
    for (const o of cap(brokenLinks)) {
      const shown = o.kind === 'wikilink' ? `[[${o.cited}]]` : o.cited;
      out.push(`  ${o.file}:${o.line}  ${shown}${o.suggestion ? `   ->  ${o.suggestion}` : ''}`);
    }
    out.push(more(brokenLinks) + '');
  }

  if (orphans.length) {
    out.push(`NOT IN INDEX  (${orphans.length})   file the index never references`);
    for (const o of cap(orphans)) out.push(`  ${o}`);
    out.push(more(orphans) + '');
  }

  if (missingPaths.length) {
    out.push(`MISSING PATH  (${missingPaths.length})   paths cited to say they are gone were filtered out`);
    for (const o of cap(missingPaths)) out.push(`  ${o.file}:${o.line}  ${o.cited}`, `      ${o.excerpt}`);
    out.push(more(missingPaths) + '');
  }

  out.push(total ? `${total} to review` : 'nothing to review.');
  if (jsonPath) out.push(`json: ${jsonPath}`);
  return out.join('\n');
}

/** GitHub Actions annotations, one per finding. */
export function renderGithub(result) {
  const { caseMismatch, brokenLinks, missingPaths, orphans } = result;
  const lines = [];
  const say = (level, o, msg) => lines.push(`::${level} file=${o.file},line=${o.line}::${msg}`);
  for (const o of caseMismatch) say('error', o, `Case mismatch: ${o.cited} should be ${o.actual}`);
  for (const o of brokenLinks) say('warning', o, `Broken link: ${o.cited}${o.suggestion ? ` — did you mean ${o.suggestion}?` : ''}`);
  for (const o of missingPaths) say('warning', o, `Missing path: ${o.cited}`);
  for (const o of orphans) lines.push(`::notice::Not in index: ${o}`);
  return lines.join('\n');
}
