/**
 * prumo — the import check: `@path` in a CLAUDE.md, which Claude Code reads as an import of that
 * file, resolved from the folder of the note, and which fails in silence when the file is not there.
 */

import { existsSync } from 'node:fs';
import { join, relative, sep, posix } from 'node:path';
import { CODE_EXT, WILDCARD, LOCAL_FILE, TRANSIENT } from './paths.mjs';

/** The notes Claude Code reads imports from. */
const IMPORTING_NOTE = /(^|\/)CLAUDE(\.local)?\.md$/i;
/** `@` after a space, a bracket or the start of the line, then the path up to a space or a punctuation mark, CJK ones included. */
const IMPORT = /(^|[\s(])@([^\s`()<>[\]{}"',;、。，；：（）]+)/g;
/** What a bare name has to end in to be read as a file rather than a handle or a host: `@package.json`, `@common.mk`. */
const FILE_EXT = /\.(mk|txt|ini|cfg|conf|env|xml|jsonc|lock|mdc|mdx)$/i;

/**
 * The imports on one line of prose. A path with a folder counts only when that folder exists beside
 * the note, since `@scope/package` is how a note names an npm package, and `@~/x.md` and `@../x.md`
 * from the root start at a folder the repository cannot hold. `@/etc/x` is an absolute path, from any
 * note, and a path that climbs out of the repository from a nested note is never checked, since git
 * cannot answer for it and would fail the `.gitignore` lookup of every other path. A bare name counts only with
 * the extension of a file. A wrong letter case is a case mismatch, written from the note as the
 * import is; a file that is not there is a broken link, unless git ignores it or it is written per machine.
 */
export function checkImports(run, file, i, m) {
  const { repo, index, findings } = run;
  const note = relative(repo, file.target.path).split(sep).join('/');
  if (!IMPORTING_NOTE.test(note)) return;
  const folder = posix.dirname(note);
  const plain = m.text.replace(/`[^`\n]*`/g, (s) => ' '.repeat(s.length));
  const seen = new Set();
  for (const c of plain.matchAll(IMPORT)) {
    const written = c[2].replace(/[.:!?]+$/, '');
    if (seen.has(written)) continue;
    seen.add(written);
    if (written.startsWith('/') || WILDCARD.test(written) || LOCAL_FILE.test(written)) continue;
    const rel = posix.normalize(posix.join(folder, written));
    if (rel.startsWith('../') || TRANSIENT.test(rel) || run.ignored(rel) || run.transient(rel)) continue;
    const head = posix.normalize(posix.join(folder, written.split('/')[0]));
    if (written.includes('/') ? !index.known.has(head) : !(CODE_EXT.test(written) || FILE_EXT.test(written))) continue;

    if (index.known.has(rel)) { file.cite(rel, false); file.record(i, written, rel); continue; }
    const real = index.lower.get(rel.toLowerCase());
    if (real) {
      file.cite(rel, false);
      file.record(i, written, real);
      findings.caseMismatch.push({ file: file.target.label, line: i + 1, kind: 'import', cited: written, actual: posix.relative(folder, real) });
      continue;
    }
    if (existsSync(join(repo, rel))) { file.cite(rel, false); continue; }
    const bare = written.slice(written.lastIndexOf('/') + 1).replace(/\.mdx?$/i, '');
    const near = run.links.loose.get(bare.toLowerCase().replace(/[_-]/g, ''));
    const finding = { file: file.target.label, line: i + 1, kind: 'import', cited: written, suggestion: near && run.links.linkPath.has(near) ? posix.relative(folder, run.links.linkPath.get(near)) : null };
    file.cite(rel, true, head);
    run.relOf.set(finding, rel);
    findings.brokenLinks.push(finding);
  }
}
