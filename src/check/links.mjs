/**
 * prumo — the link check: a wikilink, a markdown link or a heading anchor that points at nothing,
 * and a markdown link spelled with another letter case than the file it reaches.
 */

import { existsSync } from 'node:fs';
import { join, relative, resolve, sep, isAbsolute, dirname, posix } from 'node:path';
import { readTextFile } from './repository.mjs';
import { classifyLines, LIST_ITEM, TABLE_ROW } from './lines.mjs';
import { CODE_EXT, WILDCARD, HOSTNAME, PLACEHOLDER_PATH, EXAMPLE_NAME, TEMPLATE_TOKEN, SCOPED_PACKAGE, LOCAL_FILE, installedElsewhere } from './paths.mjs';

/** A link fragment in the line form of GitHub, `L12`, `L12-L20` or `L12C3-L14C7`, points at a line, which moves with every edit, so only the page is checked. */
const LINE_ANCHOR = /^L\d+(C\d+)?(-L?\d+(C\d+)?)?$/i;
/** What a markdown link may point at besides code and markdown: the images and documents a note embeds. */
const LINK_EXT = /\.(mdx|png|jpe?g|gif|svg|webp|avif|pdf|ico|txt|csv)$/i;
const WIKILINK = /\[\[([A-Za-z0-9][\w .\/-]{1,80})\]\]/g;
const MARKDOWN_LINK = /\]\((?:<([^<>#]+)(?:#([^>]*))?>|([^)\s#]+)(?:#([^)\s]*))?|#([^)\s]+))\)/gi;

/**
 * A markdown link writes a space as `%20`, so the target has to be decoded before it is resolved and
 * re-encoded before it is written back, or a fix would turn a working link into a broken one.
 */
function decodeLink(to) {
  try { return decodeURIComponent(to); } catch { return to; }
}

/** A heading as GitHub turns it into an anchor: the text without markup, lower case, punctuation dropped, spaces to hyphens. */
function slugOf(text) {
  return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/\{#[^}]+\}\s*$/, '').trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
}

/**
 * Every anchor a markdown file answers to: each heading as its GitHub slug, a repeated one
 * numbered, plus the `id` and `name` attributes of its HTML and a `{#custom}` id on a heading.
 * A heading inside a fenced block or a comment is not one.
 */
function anchorsIn(body) {
  const lines = body.split(/\r?\n/);
  const marked = classifyLines(lines);
  const anchors = new Set();
  const seen = new Map();
  const add = (text) => {
    const custom = text.match(/\{#([^}\s]+)\}\s*$/);
    if (custom) anchors.add(custom[1].toLowerCase());
    const base = slugOf(text);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    anchors.add(n ? `${base}-${n}` : base);
  };
  const underline = (t) => /^ {0,3}(=+|-+)[ \t]*$/.test(t);
  for (let i = 0; i < lines.length; i++) {
    if (marked[i].kind !== 'prose') continue;
    const t = marked[i].text;
    const atx = t.match(/^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/);
    if (atx) { add(atx[1]); continue; }
    if (t.trim() && !underline(t) && !LIST_ITEM.test(t) && !TABLE_ROW.test(t) && i + 1 < lines.length && marked[i + 1].kind === 'prose' && underline(lines[i + 1])) add(t);
    for (const m of t.matchAll(/<\w+\b[^>]*\s(?:id|name)="([^"]+)"/gi)) anchors.add(m[1].toLowerCase());
  }
  return anchors;
}

/**
 * What a link may reach: every markdown file git tracks, by its path without the extension and by
 * its bare name, beside the notes being checked, so a wikilink may point at any of them. `loose`
 * finds the likely destination of a broken one, with `-` and `_` dropped.
 */
export function makeLinkTargets(index, checked) {
  const linkable = new Set(checked.map((t) => t.label.replace(/\.(md|mdc)$/i, '')));
  const linkPath = new Map();
  for (const p of index.tracked) {
    if (!/.(md|mdc)$/i.test(p)) continue;
    const bare = p.replace(/.(md|mdc)$/i, '');
    const short = bare.slice(bare.lastIndexOf('/') + 1);
    linkable.add(bare);
    linkable.add(short);
    if (!linkPath.has(bare)) linkPath.set(bare, p);
    if (!linkPath.has(short)) linkPath.set(short, p);
  }
  const loose = new Map();
  for (const n of linkable) loose.set(n.toLowerCase().replace(/[_-]/g, ''), n);
  return { linkable, linkPath, loose };
}

/** The anchors of each file, read once a run, and the anchor a broken one most likely meant. */
export function makeAnchors() {
  const cache = new Map();
  const looseAnchor = (s) => s.replace(/[-_]/g, '');
  return {
    of(abs, text) {
      const key = resolve(abs);
      let set = cache.get(key);
      if (!set) { set = anchorsIn(text ?? (readTextFile(abs) || '')); cache.set(key, set); }
      return set;
    },
    near(set, anchor) {
      const want = looseAnchor(anchor);
      for (const a of set) if (looseAnchor(a) === want) return a;
      for (const a of set) { const l = looseAnchor(a); if (want && l.endsWith(want) && l.length - want.length <= 3) return a; }
      return null;
    },
  };
}

/** A line as the link checks read it: code spans blanked, and a reference definition, `[x]: path`, read as the link it defines. */
export function proseOf(text) {
  return text.replace(/`[^`\n]*`/g, ' ').replace(/^\[([^\]]+)\]:\s*(\S+)\s*$/, '[$1]($2)');
}

/** The wikilinks on one line, `[[name]]`, each of which has to name a markdown file git tracks. */
export function checkWikilinks(run, file, i, prose) {
  const { linkable, linkPath, loose } = run.links;
  for (const l of prose.matchAll(WIKILINK)) {
    const to = l[1].trim();
    if (linkable.has(to) || run.ignored(to)) { if (to.includes('/')) file.cite(to, false); if (linkPath.has(to)) file.record(i, to, linkPath.get(to)); continue; }
    if (to.startsWith('@/') && !run.index.aliasRoot) continue;
    if (to !== l[1] || to.includes('.') || /[\w$]/.test(prose[l.index - 1] || '')) continue;
    if (to.includes('/')) file.cite(to, true);
    run.findings.brokenLinks.push({
      file: file.target.label,
      line: i + 1,
      kind: 'wikilink',
      cited: to,
      suggestion: loose.get(to.toLowerCase().replace(/[_-]/g, '')) || null,
    });
  }
}

/** A link to a heading of the note itself, `#section`, which has to be one of its anchors. */
function checkOwnAnchor(run, file, i, fragment, anchor) {
  const own = run.anchors.of(file.target.path, file.body);
  if (!anchor || LINE_ANCHOR.test(fragment) || own.has(anchor)) return;
  const near = run.anchors.near(own, anchor);
  run.findings.brokenLinks.push({ file: file.target.label, line: i + 1, kind: 'anchor', cited: `#${fragment}`, suggestion: near ? `#${near}` : null });
}

/**
 * The first folder a link reaches, as the gate on another project counts it: from the root for a
 * link written from there, otherwise from the note's own folder once `../` is walked back, and the
 * note's own folder for a bare name beside it.
 */
function linkHead(repo, file, href, rel, fromRoot) {
  if (fromRoot) return rel.split('/')[0];
  const parts = href.replace(/^\.\//, '').split('/');
  let base = posix.dirname(relative(repo, file.target.path).split(sep).join('/'));
  if (base === '.') base = '';
  while (parts.length > 1 && parts[0] === '..') { parts.shift(); base = base.includes('/') ? base.slice(0, base.lastIndexOf('/')) : ''; }
  if (parts.length === 1) return rel.split('/')[0];
  return base ? `${base}/${parts[0]}` : parts[0];
}

/**
 * The markdown links on one line. A link resolves from beside the note, from the root when it
 * starts with `/` or `mdc:`, and from the root as well when only the root holds what it names, as
 * an agent reads it. A link to a file with another letter case is a case mismatch, written relative
 * to the note as the link is; a link to a page that is there may still name a heading it lacks.
 */
export function checkLinks(run, file, i, prose) {
  const { repo, index, findings } = run;
  for (const l of prose.matchAll(MARKDOWN_LINK)) {
    const to = l[1] || l[3] || '';
    const fragment = l[2] || l[4] || l[5] || '';
    const anchor = decodeLink(fragment).toLowerCase();
    if (!to) { checkOwnAnchor(run, file, i, fragment, anchor); continue; }
    if (!CODE_EXT.test(to) && !LINK_EXT.test(to)) continue;
    if (WILDCARD.test(to) || HOSTNAME.test(to) || PLACEHOLDER_PATH.test(to) || EXAMPLE_NAME.test(to) || TEMPLATE_TOKEN.test(to) || SCOPED_PACKAGE.test(to)) continue;
    if (/^(https?:|file:|\/\/)/i.test(to) || run.ignored(to)) continue;
    const mdc = /^mdc:/i.test(to);
    const href = mdc ? '/' + decodeLink(to.slice(4)).replace(/^\.?\//, '') : decodeLink(to);
    let abs = href.startsWith('/') ? join(repo, href.slice(1)) : join(dirname(file.target.path), href);
    let rel = relative(repo, abs).split(sep).join('/');
    const fromRoot = href.replace(/^\.\//, '');
    const atRoot = !/^(\/|\.\.\/)/.test(href) && !index.known.has(rel) && !index.lower.has(rel.toLowerCase())
      && (index.known.has(fromRoot) || index.lower.has(fromRoot.toLowerCase()));
    if (atRoot) { abs = join(repo, fromRoot); rel = fromRoot; }
    const inside = rel && !rel.startsWith('../') && !isAbsolute(rel);
    if (inside && index.known.has(rel)) {
      file.cite(rel, false);
      file.record(i, to, rel);
      if (anchor && !LINE_ANCHOR.test(fragment) && /\.(md|mdx)$/i.test(rel)) {
        const theirs = run.anchors.of(abs);
        if (!theirs.has(anchor)) {
          const near = run.anchors.near(theirs, anchor);
          findings.brokenLinks.push({ file: file.target.label, line: i + 1, kind: 'anchor', cited: `${to}#${fragment}`, suggestion: near ? `${to}#${near}` : null });
        }
      }
      continue;
    }
    if (inside) {
      const real = index.lower.get(rel.toLowerCase());
      if (real) {
        const fileDir = posix.dirname(relative(repo, file.target.path).split(sep).join('/'));
        const fixed = mdc ? `mdc:${real}` : atRoot ? real : posix.relative(fileDir, real);
        file.cite(rel, false);
        file.record(i, to, real);
        findings.caseMismatch.push({ file: file.target.label, line: i + 1, kind: 'link', cited: to, actual: href === to ? fixed : fixed.split(' ').join('%20') });
        continue;
      }
    }
    if (existsSync(abs)) { if (inside) file.cite(rel, false); continue; }
    if (LOCAL_FILE.test(to)) continue;
    if (inside && installedElsewhere(index, rel)) { file.cite(rel, false); continue; }
    const bare = href.slice(href.lastIndexOf('/') + 1).replace(/\.mdx?$/i, '');
    const finding = {
      file: file.target.label,
      line: i + 1,
      kind: 'link',
      cited: to,
      suggestion: run.links.loose.get(bare.toLowerCase().replace(/[_-]/g, '')) || null,
    };
    if (inside) { file.cite(rel, true, linkHead(repo, file, href, rel, mdc || href.startsWith('/') || atRoot)); run.relOf.set(finding, rel); }
    findings.brokenLinks.push(finding);
  }
}
