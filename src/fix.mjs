import { readFileSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';

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

/** Rewrites an `@path` import, where the path runs from the `@` to the first space or punctuation mark. */
function replaceImport(line, cited, actual) {
  const re = new RegExp('(^|[\\s(])@' + escape(cited) + '(?=$|[\\s`()<>\\[\\]{}"\',;.:!?、。，；：（）])', 'g');
  if (line.search(re) < 0) return null;
  return line.replace(re, (m, before) => `${before}@${actual}`);
}

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/**
 * The rewrites a run's history allows: a missing path, a markdown link or an `@` import whose file git
 * recorded as renamed, with the new name written the way the citation was, from the root, from beside
 * the note, with a `/` or an `mdc:` in front, or with its spaces as `%20`; an import always from beside
 * the note, since that is where Claude Code resolves it. A deletion is never touched,
 * since there is nothing to write in its place.
 */
export function renameFixes(result) {
  const paths = (result.missingPaths || []).filter(renamed).map((o) => {
    const actual = o.history.from === o.cited.replace(/^\.\//, '') ? o.history.to : beside(o.file, o.history.to);
    return { file: o.file, line: o.line, cited: o.cited, actual, why: 'rename', commit: o.history.commit };
  });
  const links = (result.brokenLinks || []).filter((o) => renamed(o) && (o.kind === 'link' || o.kind === 'import')).map((o) => {
    const actual = LINK_RENAMES.find((r) => r.when(o)).write(o, o.history);
    return { file: o.file, line: o.line, kind: o.kind, cited: o.cited, actual: o.cited.includes('%20') ? actual.split(' ').join('%20') : actual, why: 'rename', commit: o.history.commit };
  });
  return [...paths, ...links];
}

/** True when git recorded the cited file as renamed, and to a name that exists. */
const renamed = (o) => Boolean(o.history && o.history.event === 'renamed' && o.history.to);

/** A path written from beside the note, or as it is when the note sits at the root. */
const beside = (file, to) => (posix.dirname(file) === '.' ? to : posix.relative(posix.dirname(file), to));

const LINK_RENAMES = [
  { when: (o) => /^mdc:/i.test(o.cited), write: (o, h) => `mdc:${h.to}` },
  { when: (o) => o.cited.startsWith('/'), write: (o, h) => `/${h.to}` },
  { when: () => true, write: (o, h) => (o.cited.startsWith('./') ? './' : '') + (h.from === decode(o.cited).replace(/^\.\//, '') ? h.to : beside(o.file, h.to)) },
];

/**
 * Rewrites each cited path to its correct value, the spelling the git index holds or the name git
 * renamed it to. Neither is a guess, so a link suggested from a name, a missing path with no history
 * and a deleted file are never touched. Findings on one line are applied longest path first, so
 * `src/foo/bar.js` is corrected before `src/foo` can touch it. `applyCaseFixes` is the name it had
 * before it learned renames, kept for whoever imported it.
 * @returns {{files:number, paths:number, changes:[], skipped:[]}}
 */
export function applyFixes(findings, targets) {
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
      const replace = item.kind === 'link' ? replaceLink : item.kind === 'import' ? replaceImport : replaceToken;
      const next = replace(lines[i], item.cited, item.actual);
      if (next === null) { skipped.push({ ...item, why: 'line changed since the scan' }); continue; }
      lines[i] = next;
      changes.push(item);
      touched = true;
    }

    if (touched) { writeFileSync(path, lines.join('\n')); files++; }
  }

  return { files, paths: changes.length, changes, skipped };
}

export const applyCaseFixes = applyFixes;
