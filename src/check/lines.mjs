export const IGNORE_LINE = /<!--\s*prumo-ignore\s*-->/;
export const IGNORE_NEXT = /<!--\s*prumo-ignore-next-line\s*-->/;
export const IGNORE_FILE = /<!--\s*prumo-ignore-file\s*-->/;

export const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
export const TABLE_ROW = /^\s*\|/;

const QUOTES_MARKDOWN = /^(md|markdown|mdx)\b/i;
const SOURCE_LANGUAGE = /^(js|javascript|jsx|ts|typescript|tsx|mjs|cjs|py|python|php|go|golang|rb|ruby|java|kt|kotlin|rs|rust|c|cpp|c\+\+|h|hpp|cs|csharp|swift|scala|dart|lua|perl|r|sql|vue|svelte|html|xml|css|scss|less)(\s|$)/i;

/**
 * Marks each line as prose, code inside a fenced block, or skipped: a fence line, a block that
 * quotes markdown, a block under a `prumo-ignore-next-line` marker, and anything inside an HTML
 * comment. A code line keeps the index of its opening fence, so the sentence that introduces the
 * block counts as its context. A line that kept its `\r` still opens a fence, so a caller that
 * split on `\n` alone reads a CRLF file the way it reads an LF one. A skipped line says why.
 */
export function classifyLines(lines) {
  const out = [];
  let fence = null;
  let comment = false;
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i];
    if (fence) {
      const close = text.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) { fence = null; out.push({ kind: 'skip', why: 'the line that closes a fenced block' }); }
      else out.push(fence.read ? { kind: 'code', text, anchor: fence.at, lang: fence.lang } : { kind: 'skip', why: fence.why });
      continue;
    }
    if (comment) {
      const end = text.indexOf('-->');
      if (end < 0) { out.push({ kind: 'skip', why: 'inside an HTML comment' }); continue; }
      text = text.slice(end + 3);
      comment = false;
    }
    let open;
    while ((open = text.indexOf('<!--')) >= 0) {
      const end = text.indexOf('-->', open + 4);
      if (end < 0) { text = text.slice(0, open); comment = true; break; }
      text = text.slice(0, open) + ' ' + text.slice(end + 3);
    }
    const opener = text.match(/^\s*(`{3,}|~{3,})(.*)\r?$/);
    if (opener && !(opener[1][0] === '`' && opener[2].includes('`'))) {
      const info = opener[2].trim();
      const lang = info.split(/\s+/)[0].toLowerCase();
      const why = QUOTES_MARKDOWN.test(info) ? 'inside a fenced block that quotes markdown'
        : SOURCE_LANGUAGE.test(info) ? `inside a fenced block of ${lang} source`
          : i > 0 && IGNORE_NEXT.test(lines[i - 1]) ? 'inside a fenced block under a prumo-ignore-next-line marker' : '';
      fence = { char: opener[1][0], len: opener[1].length, at: i, read: !why, why, lang };
      out.push({ kind: 'skip', why: 'the line that opens a fenced block' });
      continue;
    }
    out.push({ kind: 'prose', text, anchor: i });
  }
  return out;
}

/** For each line, the index of the nearest heading above it, or -1. */
export function headingsAbove(lines, marked) {
  const out = [];
  for (let j = 0, last = -1; j < lines.length; j++) {
    if (marked[j].kind === 'prose' && /^#{1,6}\s/.test(lines[j])) last = j;
    out.push(last);
  }
  return out;
}
