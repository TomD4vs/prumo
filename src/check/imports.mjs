import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { CODE_EXT, WILDCARD, LOCAL_FILE, TRANSIENT } from './paths.mjs';
import { decide } from './rules.mjs';

const IMPORTING_NOTE = /(^|\/)CLAUDE(\.local)?\.md$/i;
const IMPORT = /(^|[\s(])@([^\s`()<>[\]{}"',;、。，；：（）]+)/g;
const FILE_EXT = /\.(mk|txt|ini|cfg|conf|env|xml|jsonc|lock|mdc|mdx)$/i;

/**
 * The imports on one line of prose, in a `CLAUDE.md` or a `CLAUDE.local.md`, the notes Claude Code
 * reads imports from. An import is an `@` after a space, a bracket or the start of the line, and the
 * path runs up to a space or a punctuation mark, CJK ones included.
 *
 * A path with a folder counts only when that folder exists beside the note, since `@scope/package`
 * is how a note names an npm package, and `@~/x.md` and `@../x.md` from the root start at a folder
 * the repository cannot hold. `@/etc/x` is an absolute path, from any note, and a path that climbs
 * out of the repository from a nested note is never checked, since git cannot answer for it and
 * would fail the `.gitignore` lookup of every other path. A bare name counts only with the extension
 * of a file, `@package.json` or `@common.mk`, so a handle or a host is not read as one.
 *
 * A wrong letter case is a case mismatch, written from the note as the import is; a file that is not
 * there is a broken link, unless git ignores it or it is written per machine.
 */
export function checkImports(run, file, i, m) {
  if (!IMPORTING_NOTE.test(file.rel)) return;
  const plain = m.text.replace(/`[^`\n]*`/g, (s) => ' '.repeat(s.length));
  const seen = new Set();
  for (const c of plain.matchAll(IMPORT)) {
    const written = c[2].replace(/[.:!?]+$/, '');
    if (seen.has(written)) continue;
    seen.add(written);
    decide(IMPORT_RULES, importCitation(run, file, i, written));
  }
}

/** One `@path` on a line, read from the folder of the note, with the folder it starts at. */
function importCitation(run, file, i, written) {
  const rel = posix.normalize(posix.join(file.folder, written));
  const head = posix.normalize(posix.join(file.folder, written.split('/')[0]));
  return { run, file, i, kind: 'import', cited: `@${written}`, written, rel, head, get real() { return run.index.lower.get(rel.toLowerCase()); } };
}

/** The file an import most likely meant, written from the note, when a markdown file of a near name exists. */
function suggestionFor(x) {
  const bare = x.written.slice(x.written.lastIndexOf('/') + 1).replace(/\.mdx?$/i, '');
  const near = x.run.links.loose.get(bare.toLowerCase().replace(/[_-]/g, ''));
  return near && x.run.links.linkPath.has(near) ? posix.relative(x.file.folder, x.run.links.linkPath.get(near)) : null;
}

const IMPORT_RULES = [
  { when: (x) => x.written.startsWith('/'), outcome: 'excused', reason: 'an absolute path, outside the repository' },
  { when: (x) => WILDCARD.test(x.written), outcome: 'excused', reason: 'a glob or a template, not one file' },
  { when: (x) => LOCAL_FILE.test(x.written), outcome: 'excused', reason: 'a file each machine writes for itself, never committed' },
  { when: (x) => x.rel.startsWith('../'), outcome: 'excused', reason: 'it climbs out of the repository' },
  { when: (x) => TRANSIENT.test(x.rel), outcome: 'excused', reason: 'a folder a build or a tool writes, outside git by design' },
  { when: (x) => x.run.ignored(x.rel), outcome: 'excused', reason: 'listed under ignore in .prumorc.json' },
  { when: (x) => x.run.transient(x.rel), outcome: 'excused', reason: 'listed under transient in .prumorc.json' },
  { when: (x) => x.written.includes('/') && !x.run.index.known.has(x.head), outcome: 'excused', reason: 'its first folder is not beside the note: an npm package, a home folder or another place' },
  { when: (x) => !x.written.includes('/') && !(CODE_EXT.test(x.written) || FILE_EXT.test(x.written)), outcome: 'excused', reason: 'a bare name without the extension of a file: a handle or a host' },
  { when: (x) => x.run.index.known.has(x.rel), outcome: 'resolved', reason: 'git tracks it', to: (x) => x.rel, act: (x) => { x.file.cite(x.rel, false); x.file.record(x.i, x.written, x.rel); } },
  {
    when: (x) => x.real, outcome: 'reported', reason: 'CASE MISMATCH', to: (x) => posix.relative(x.file.folder, x.real),
    act: (x) => {
      x.file.cite(x.rel, false);
      x.file.record(x.i, x.written, x.real);
      x.run.findings.caseMismatch.push({ file: x.file.target.label, line: x.i + 1, kind: 'import', cited: x.written, actual: posix.relative(x.file.folder, x.real) });
    },
  },
  { when: (x) => existsSync(join(x.run.repo, x.rel)), outcome: 'resolved', reason: 'not tracked by git, but present on this disk', act: (x) => x.file.cite(x.rel, false) },
  {
    when: () => true, outcome: 'reported', reason: 'BROKEN LINK',
    act: (x) => {
      const finding = { file: x.file.target.label, line: x.i + 1, kind: 'import', cited: x.written, suggestion: suggestionFor(x) };
      x.file.cite(x.rel, true, x.head);
      x.run.relOf.set(finding, x.rel);
      x.run.findings.brokenLinks.push(finding);
    },
  },
];
