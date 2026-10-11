import { existsSync } from 'node:fs';
import { join, relative, resolve, sep, isAbsolute, dirname, posix } from 'node:path';
import { readTextFile } from './repository.mjs';
import { classifyLines, LIST_ITEM, TABLE_ROW } from './lines.mjs';
import { CODE_EXT, LOCAL_FILE, NOT_A_LINK, installedElsewhere } from './paths.mjs';
import { decide } from './rules.mjs';

const LINE_ANCHOR = /^L\d+(C\d+)?(-L?\d+(C\d+)?)?$/i;
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

/** One wikilink on a line, `[[name]]`, with the text right before it, which tells code from a link. */
function wikilinkCitation(run, file, i, prose, l) {
  const to = l[1].trim();
  return { run, file, i, kind: 'wikilink', cited: `[[${to}]]`, to, written: l[1], before: prose[l.index - 1] || '' };
}

/** A wikilink that names a markdown file is cited by it, with a folder, and recorded for drift with the file it reaches. */
const citeWikilink = (x) => {
  if (x.to.includes('/')) x.file.cite(x.to, false);
  if (x.run.links.linkPath.has(x.to)) x.file.record(x.i, x.to, x.run.links.linkPath.get(x.to));
};

const WIKILINK_RULES = [
  { when: (x) => x.run.links.linkable.has(x.to), outcome: 'resolved', reason: 'a markdown file git tracks, or a note of this run', to: (x) => x.run.links.linkPath.get(x.to), act: citeWikilink },
  { when: (x) => x.run.ignored(x.to), outcome: 'excused', reason: 'listed under ignore in .prumorc.json', act: citeWikilink },
  { when: (x) => x.to !== x.written || x.to.includes('.') || /[\w$]/.test(x.before), outcome: 'excused', reason: 'template or code syntax: spaces inside, a dot, or glued to a word' },
  {
    when: () => true, outcome: 'reported', reason: 'BROKEN LINK',
    act: (x) => {
      if (x.to.includes('/')) x.file.cite(x.to, true);
      x.run.findings.brokenLinks.push({ file: x.file.target.label, line: x.i + 1, kind: 'wikilink', cited: x.to, suggestion: x.run.links.loose.get(x.to.toLowerCase().replace(/[_-]/g, '')) || null });
    },
  },
];

/** The wikilinks on one line, `[[name]]`, each of which has to name a markdown file git tracks. */
export function checkWikilinks(run, file, i, prose) {
  for (const l of prose.matchAll(WIKILINK)) decide(WIKILINK_RULES, wikilinkCitation(run, file, i, prose, l));
}

const ANCHOR_RULES = [
  { when: (x) => LINE_ANCHOR.test(x.fragment), outcome: 'resolved', reason: 'a line of the page, which moves with every edit, so it is not checked' },
  { when: (x) => x.anchors().has(x.anchor), outcome: 'resolved', reason: 'a heading of the page' },
  {
    when: () => true, outcome: 'reported', reason: 'BROKEN LINK',
    act: (x) => {
      const near = x.run.anchors.near(x.anchors(), x.anchor);
      x.run.findings.brokenLinks.push({ file: x.file.target.label, line: x.i + 1, kind: 'anchor', cited: `${x.page}#${x.fragment}`, suggestion: near ? `${x.page}#${near}` : null });
    },
  },
];

/**
 * A link to a heading, `#section` on the note itself or `page.md#section` on a page git tracks, which
 * has to be one of its anchors. `anchors` reads them, and only a link with a fragment calls it.
 */
function checkAnchor(run, file, i, page, fragment, anchors) {
  const anchor = decodeLink(fragment).toLowerCase();
  if (!anchor) return;
  decide(ANCHOR_RULES, { run, file, i, kind: 'anchor', cited: `${page}#${fragment}`, page, fragment, anchor, anchors });
}

/**
 * Where a markdown link leads: decoded, from the root when it starts with `/` or `mdc:`, from beside
 * the note otherwise, and from the root as well when only the root holds what it names. `inside` says
 * it stays in the repository.
 */
function linkTarget(run, file, to) {
  const { repo, index } = run;
  const mdc = /^mdc:/i.test(to);
  const href = mdc ? '/' + decodeLink(to.slice(4)).replace(/^\.?\//, '') : decodeLink(to);
  let abs = href.startsWith('/') ? join(repo, href.slice(1)) : join(dirname(file.target.path), href);
  let rel = relative(repo, abs).split(sep).join('/');
  const fromRoot = href.replace(/^\.\//, '');
  const atRoot = !/^(\/|\.\.\/)/.test(href) && !index.known.has(rel) && !index.lower.has(rel.toLowerCase())
    && (index.known.has(fromRoot) || index.lower.has(fromRoot.toLowerCase()));
  if (atRoot) { abs = join(repo, fromRoot); rel = fromRoot; }
  return { mdc, href, abs, rel, atRoot, inside: Boolean(rel) && !rel.startsWith('../') && !isAbsolute(rel) };
}

/** One markdown link on a line, with where it leads worked out only when a rule asks. */
function linkCitation(run, file, i, to, fragment) {
  let target = null;
  return { run, file, i, kind: 'link', cited: to, to, fragment, get t() { return target ??= linkTarget(run, file, to); } };
}

/** The spelling git holds for a link with the wrong letter case, written the way the link is: with `mdc:`, from the root, or from beside the note. */
function caseOf(x, real) {
  const { mdc, atRoot, href } = x.t;
  const fixed = mdc ? `mdc:${real}` : atRoot ? real : posix.relative(x.file.folder, real);
  return href === x.to ? fixed : fixed.split(' ').join('%20');
}

const LINK_RULES = [
  { when: (x) => /^(https?:|\/\/)/i.test(x.to), outcome: 'excused', reason: 'a web address, which prumo never fetches' },
  { when: (x) => !CODE_EXT.test(x.to) && !LINK_EXT.test(x.to), outcome: 'excused', reason: 'not a file of a kind the check reads: code, markdown, an image or a document' },
  { when: (x) => NOT_A_LINK.some(([re]) => re.test(x.to)), outcome: 'excused', reason: (x) => NOT_A_LINK.find(([re]) => re.test(x.to))[1] },
  { when: (x) => /^file:/i.test(x.to), outcome: 'excused', reason: 'a file: address, outside the repository' },
  { when: (x) => x.run.ignored(x.to), outcome: 'excused', reason: 'listed under ignore in .prumorc.json' },
  {
    when: (x) => x.t.inside && x.run.index.known.has(x.t.rel), outcome: 'resolved', reason: 'git tracks it', to: (x) => x.t.rel,
    act: (x) => {
      x.file.cite(x.t.rel, false);
      x.file.record(x.i, x.to, x.t.rel);
      if (/\.(md|mdx)$/i.test(x.t.rel)) checkAnchor(x.run, x.file, x.i, x.to, x.fragment, () => x.run.anchors.of(x.t.abs));
    },
  },
  {
    when: (x) => x.t.inside && x.run.index.lower.has(x.t.rel.toLowerCase()), outcome: 'reported', reason: 'CASE MISMATCH', to: (x) => caseOf(x, x.run.index.lower.get(x.t.rel.toLowerCase())),
    act: (x) => {
      const real = x.run.index.lower.get(x.t.rel.toLowerCase());
      x.file.cite(x.t.rel, false);
      x.file.record(x.i, x.to, real);
      x.run.findings.caseMismatch.push({ file: x.file.target.label, line: x.i + 1, kind: 'link', cited: x.to, actual: caseOf(x, real) });
    },
  },
  { when: (x) => existsSync(x.t.abs), outcome: 'resolved', reason: 'not tracked by git, but present on this disk', act: (x) => { if (x.t.inside) x.file.cite(x.t.rel, false); } },
  { when: (x) => LOCAL_FILE.test(x.to), outcome: 'excused', reason: 'a file each machine writes for itself, never committed' },
  { when: (x) => x.t.inside && installedElsewhere(x.run.index, x.t.rel), outcome: 'resolved', reason: 'a skill cited by its install folder; the file is beside a SKILL.md elsewhere', act: (x) => x.file.cite(x.t.rel, false) },
  {
    when: () => true, outcome: 'reported', reason: 'BROKEN LINK',
    act: (x) => {
      const { href, rel, inside, mdc, atRoot } = x.t;
      const bare = href.slice(href.lastIndexOf('/') + 1).replace(/\.mdx?$/i, '');
      const finding = { file: x.file.target.label, line: x.i + 1, kind: 'link', cited: x.to, suggestion: x.run.links.loose.get(bare.toLowerCase().replace(/[_-]/g, '')) || null };
      if (inside) { x.file.cite(rel, true, linkHead(x.run.repo, x.file, href, rel, mdc || href.startsWith('/') || atRoot)); x.run.relOf.set(finding, rel); }
      x.run.findings.brokenLinks.push(finding);
    },
  },
];

/**
 * The markdown links on one line. A link resolves from beside the note, from the root when it
 * starts with `/` or `mdc:`, and from the root as well when only the root holds what it names, as
 * an agent reads it. The target may be code, markdown, or an image or a document a note embeds. A
 * link to a file with another letter case is a case mismatch, written relative to the note as the
 * link is; a link to a page that is there may still name a heading it lacks. A fragment in the line
 * form of GitHub, `L12`, `L12-L20` or `L12C3-L14C7`, points at a line, which moves with every edit,
 * so only the page is checked. `LINK_RULES` is the order the questions are asked in.
 */
export function checkLinks(run, file, i, prose) {
  for (const l of prose.matchAll(MARKDOWN_LINK)) {
    const to = l[1] || l[3] || '';
    const fragment = l[2] || l[4] || l[5] || '';
    if (to) decide(LINK_RULES, linkCitation(run, file, i, to, fragment));
    else checkAnchor(run, file, i, '', fragment, () => run.anchors.of(file.target.path, file.body));
  }
}
