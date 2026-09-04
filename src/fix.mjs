/**
 * prumo — the only automatic fix: case mismatches, whose correct value is read
 * from the git index rather than guessed. Links and missing paths are never touched.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rewrites the cited path as a whole token, with either kind of slash and an optional `./` in
 * front, leaving whatever follows it alone, so `src/x.js:42` and `app/models/` are corrected
 * where they stand. Null when the token is not on the line.
 */
function replaceToken(line, cited, actual) {
  const body = cited.split('/').map(escape).join('[\\\\/]');
  const re = new RegExp('(?<![\\w.\\\\/@-])(\\.?[\\\\/])?' + body + '(?![\\w.-])', 'g');
  if (line.search(re) < 0) return null;
  return line.replace(re, (m, prefix = '') => prefix + (m.includes('\\') ? actual.split('/').join('\\') : actual));
}

/** Rewrites a link target in any of its three spellings: `](x)`, `](<x>)` and a `[ref]: x` definition. */
function replaceLink(line, cited, actual) {
  for (const [open, close] of [['](<', '>'], ['](', '']]) {
    const needle = open + cited + close;
    if (line.includes(needle)) return line.split(needle).join(open + actual + close);
  }
  const m = line.match(/^(\s*\[[^\]]+\]:\s*<?)(\S+?)(>?\s*)$/);
  return m && m[2] === cited ? m[1] + actual + m[3] : null;
}

/**
 * Rewrites each cited path to the spelling the git index holds. Findings on one line are applied
 * longest path first, so `src/foo/bar.js` is corrected before `src/foo` can touch it.
 * @returns {{files:number, paths:number, changes:[], skipped:[]}}
 */
export function applyCaseFixes(findings, targets) {
  const pathOf = new Map(targets.map((t) => [t.label, t.path]));
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const changes = [], skipped = [];
  let files = 0;

  for (const [label, items] of byFile) {
    const path = pathOf.get(label);
    if (!path) { skipped.push({ ...items[0], why: 'file not found' }); continue; }

    const lines = readFileSync(path, 'utf8').split('\n');
    let touched = false;

    for (const item of [...items].sort((a, b) => a.line - b.line || b.cited.length - a.cited.length)) {
      const i = item.line - 1;
      if (i < 0 || i >= lines.length) { skipped.push({ ...item, why: 'line out of range' }); continue; }
      const next = item.kind === 'link' ? replaceLink(lines[i], item.cited, item.actual) : replaceToken(lines[i], item.cited, item.actual);
      if (next === null) { skipped.push({ ...item, why: 'line changed since the scan' }); continue; }
      lines[i] = next;
      changes.push(item);
      touched = true;
    }

    if (touched) { writeFileSync(path, lines.join('\n')); files++; }
  }

  return { files, paths: changes.length, changes, skipped };
}
