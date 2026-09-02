/**
 * prumo — the only automatic fix: case mismatches, whose correct value is read
 * from the git index rather than guessed. Links and missing paths are never touched.
 */

import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Rewrites each cited path to the spelling the git index holds.
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

    for (const item of items) {
      const i = item.line - 1;
      if (i < 0 || i >= lines.length) { skipped.push({ ...item, why: 'line out of range' }); continue; }
      const needle = '`' + item.cited + '`';
      if (!lines[i].includes(needle)) { skipped.push({ ...item, why: 'line changed since the scan' }); continue; }
      lines[i] = lines[i].split(needle).join('`' + item.actual + '`');
      changes.push(item);
      touched = true;
    }

    if (touched) { writeFileSync(path, lines.join('\n')); files++; }
  }

  return { files, paths: changes.length, changes, skipped };
}
