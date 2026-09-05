/**
 * prumo — the budget report: what each context file costs the agent that reads it at every
 * session, how much that grew since an earlier commit, and which paragraphs are written twice.
 * It measures and counts; nothing here is a finding, and no line can be a false alarm.
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadConfig, makeMatcher, readTextFile, classifyLines, SCHEMA_VERSION, VERSION } from './check.mjs';

/** The estimate the model vendors quote for English prose; the report says it is an estimate. */
export const CHARS_PER_TOKEN = 4;
/** A paragraph shorter than this is a line anyone would write twice, such as a list item or a heading. */
const REPEAT_WORDS = 12;

const unix = (text) => text.replace(/\r\n/g, '\n');
const tokensOf = (text) => Math.round(text.length / CHARS_PER_TOKEN);
const wordsOf = (text) => text.split(/\s+/).filter(Boolean).length;

/** The paragraphs of a note with the line each starts on: blocks separated by blank lines, a fenced block kept whole. */
export function paragraphsOf(lines) {
  const marked = classifyLines(lines);
  const out = [];
  let start = -1, buf = [];
  const flush = () => { if (buf.length) out.push({ line: start + 1, text: buf.join('\n') }); buf = []; start = -1; };
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim() && marked[i].kind === 'prose') { flush(); continue; }
    if (start < 0) start = i;
    buf.push(lines[i]);
  }
  flush();
  return out;
}

/** The paragraphs that appear in more than one place, each with every place it is written, the most words repeated first. */
function repeatsAmong(notes) {
  const byKey = new Map();
  for (const { file, lines } of notes) {
    for (const p of paragraphsOf(lines)) {
      if (p.line === 1 && /^---\s*$/.test(p.text.split('\n')[0])) continue;
      if (!p.text.includes('\n') && /^#{1,6}\s/.test(p.text)) continue;
      const key = p.text.toLowerCase().replace(/\s+/g, ' ').trim();
      const words = wordsOf(key);
      if (words < REPEAT_WORDS) continue;
      let entry = byKey.get(key);
      if (!entry) { entry = { words, at: [] }; byKey.set(key, entry); }
      entry.at.push({ file, line: p.line });
    }
  }
  return [...byKey.values()]
    .filter((e) => e.at.length > 1)
    .sort((x, y) => y.words * (y.at.length - 1) - x.words * (x.at.length - 1) || x.at[0].file.localeCompare(y.at[0].file) || x.at[0].line - y.at[0].line);
}

/**
 * The budget report of the context files: size, estimated tokens, growth since a commit, and the
 * paragraphs written twice.
 * @param {object} opts
 * @param {string} opts.repo      the repository
 * @param {object[]} opts.targets what resolveTargets() returned
 * @param {object} [opts.config]  the configuration, or null to read .prumorc.json
 * @param {string} [opts.since]   the commit or branch to compare with; empty for the commit thirty days ago, or the first one
 */
export function budget({ repo, targets, config = null, since = '' }) {
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  const settings = config ?? loadConfig(repo);
  const excluded = makeMatcher(settings.exclude);
  let tracked;
  try { tracked = new Set(git(['ls-files', '-z']).split('\0').filter(Boolean)); } catch { tracked = new Set(); }

  let ref = since, date = null;
  if (!ref) {
    try { ref = git(['rev-list', '-1', '--before=30 days ago', 'HEAD']).trim(); } catch { ref = ''; }
    if (!ref) { try { ref = git(['rev-list', '--max-parents=0', 'HEAD']).trim().split('\n').filter(Boolean).pop() || ''; } catch { ref = ''; } }
  }
  if (ref) {
    let at = '';
    try { at = git(['show', '-s', '--format=%ct', ref, '--']).trim().split('\n')[0]; } catch { at = ''; }
    if (!at) {
      if (since) throw new Error(`git does not know "${since}"`);
      ref = '';
    } else date = new Date(Number(at) * 1000).toISOString().slice(0, 10);
  }

  const files = [], notes = [];
  for (const t of targets) {
    if (excluded(t.label)) continue;
    const raw = readTextFile(t.path);
    if (raw === null) continue;
    const text = unix(raw);
    const row = {
      file: t.label,
      bytes: Buffer.byteLength(raw),
      lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0),
      words: wordsOf(text),
      tokens: tokensOf(text),
      before: null,
      delta: null,
      state: tracked.has(t.label) ? 'unchanged' : 'untracked',
    };
    if (ref && row.state !== 'untracked') {
      let old = null;
      try { old = git(['show', `${ref}:${t.label}`]); } catch { old = null; }
      if (old === null) row.state = 'new';
      else {
        row.before = tokensOf(unix(old.replace(/^\uFEFF/, '')));
        row.delta = row.tokens - row.before;
        row.state = row.delta ? 'changed' : 'unchanged';
      }
    }
    files.push(row);
    notes.push({ file: t.label, lines: text.split('\n') });
  }
  files.sort((a, b) => b.tokens - a.tokens || a.file.localeCompare(b.file));
  const repeated = repeatsAmong(notes);
  const tokens = files.reduce((n, f) => n + f.tokens, 0);
  const before = files.reduce((n, f) => n + (f.before ?? 0), 0);

  return {
    schemaVersion: SCHEMA_VERSION,
    prumoVersion: VERSION,
    repo: resolve(repo),
    checkedAt: new Date().toISOString(),
    command: 'budget',
    files,
    repeated,
    stats: {
      targets: files.length,
      tokens,
      before: ref ? before : null,
      since: ref ? { ref: since || ref.slice(0, 7), date } : null,
      // `copies` is the occurrences beyond the first, and `words` what removing them would save.
      repeated: { paragraphs: repeated.length, copies: repeated.reduce((n, r) => n + r.at.length - 1, 0), words: repeated.reduce((n, r) => n + r.words * (r.at.length - 1), 0) },
    },
  };
}
