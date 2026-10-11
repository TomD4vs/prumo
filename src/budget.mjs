import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve, relative, join, sep, posix } from 'node:path';
import { loadConfig, makeMatcher, readTextFile, classifyLines, SCHEMA_VERSION, VERSION } from './check.mjs';
import { frontmatterOf } from './check/agent-config.mjs';
import { IMPORT } from './check/imports.mjs';

export const CHARS_PER_TOKEN = 4;
const REPEAT_WORDS = 12;
const IMPORT_HOPS = 4;
const LISTED_CHARS = 1536;
const IMPORTING_NOTE = /(^|\/)(CLAUDE(\.local)?|GEMINI)\.md$/i;
const SKILL_OR_COMMAND = /(^|\/)SKILL\.md$|^\.claude\/commands\//i;
const CURSOR_RULE = /^\.cursor\/rules\//i;
const WINDSURF_RULE = /^\.windsurf\/rules\//i;
const COPILOT_SCOPED = /^\.github\/instructions\//i;
const CLINE_RULES = /^\.clinerules(\/|$)/i;
const FOLDER_NOTE = /^(?!\.claude\/[^/]+$)(?!\.github\/[^/]+$).+\/(CLAUDE(\.local)?|AGENTS?|COPILOT)\.md$/i;

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

/**
 * The paragraphs that appear in more than one place, each with every place it is written, the most
 * words repeated first. A paragraph under twelve words, a list item or a heading, is what anyone
 * writes twice, so it is left out.
 */
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

/** The paragraphs written twice: `copies` is the occurrences beyond the first, and `words` what removing them would save. */
function repeatTotals(repeated) {
  return { paragraphs: repeated.length, copies: repeated.reduce((n, r) => n + r.at.length - 1, 0), words: repeated.reduce((n, r) => n + r.words * (r.at.length - 1), 0) };
}

/** A front matter field as written, without the quotes YAML allows around it, or `''`. */
const fieldOf = (fm, key) => (fm.get(key)?.value || '').replace(/^["']|["']$/g, '').trim();

/** True when the front matter sets the field to something, a value or a list. */
const hasField = (fm, key) => Boolean(fieldOf(fm, key) || fm.get(key)?.items.length);

const LOAD_RULES = [
  { when: (n) => SKILL_OR_COMMAND.test(n.rel), load: 'listed' },
  { when: (n) => CURSOR_RULE.test(n.rel) && n.field('alwaysApply') === 'true', load: 'session' },
  { when: (n) => CURSOR_RULE.test(n.rel) && n.has('description') && !n.has('globs'), load: 'listed' },
  { when: (n) => CURSOR_RULE.test(n.rel), load: 'use' },
  { when: (n) => WINDSURF_RULE.test(n.rel) && n.field('trigger') === 'model_decision', load: 'listed' },
  { when: (n) => WINDSURF_RULE.test(n.rel) && /^(glob|manual)$/.test(n.field('trigger')), load: 'use' },
  { when: (n) => COPILOT_SCOPED.test(n.rel) && /^\*\*(\/\*)?$/.test(n.field('applyTo')), load: 'session' },
  { when: (n) => COPILOT_SCOPED.test(n.rel), load: 'use' },
  { when: (n) => CLINE_RULES.test(n.rel) && n.has('paths'), load: 'use' },
  { when: (n) => FOLDER_NOTE.test(n.rel), load: 'use' },
  { when: () => true, load: 'session' },
];

/**
 * When the agents read a context file, the first of `LOAD_RULES` that fits, as their documentation
 * states it: `session`, the whole file at every session; `listed`, only the description at every
 * session and the body when the agent picks it, which is how a skill, a command, a Cursor rule that
 * only describes itself and a Windsurf rule left to the model are read; `use`, only when the agent
 * works on the files the note or the rule is scoped to, as a folder's `CLAUDE.md` or `AGENTS.md`, a
 * rule with globs, `applyTo` or `paths`, or one called by name. A folder's `GEMINI.md` is `session`,
 * since the Gemini CLI reads every one below the working directory when it starts.
 */
function loadOf(rel, fm) {
  return LOAD_RULES.find((r) => r.when({ rel, field: (k) => fieldOf(fm, k), has: (k) => hasField(fm, k) })).load;
}

/** The text an agent lists for a skill or a rule it reads on demand: the description, cut where Claude Code cuts it. */
const listedOf = (fm) => [fieldOf(fm, 'description'), fieldOf(fm, 'when_to_use')].filter(Boolean).join(' ').slice(0, LISTED_CHARS);

/** A file of the repository as text with Unix line ends, or null when it is not a file. */
function fileText(repo, rel) {
  try { if (!statSync(join(repo, rel)).isFile()) return null; } catch { return null; }
  const raw = readTextFile(join(repo, rel));
  return raw === null ? null : unix(raw);
}

/**
 * The files a `CLAUDE.md`, a `CLAUDE.local.md` or a `GEMINI.md` pulls in with `@path`, each once,
 * followed through the files they import up to four hops, which is where Claude Code stops. An
 * import is read from the folder of the file that holds it, in prose only, since an `@` inside a code
 * span or a fenced block is left as text; one outside the repository is not counted.
 */
function importsOf(repo, note, text) {
  const found = [];
  const seen = new Set([note]);
  const walk = (file, body, hop) => {
    if (hop > IMPORT_HOPS) return;
    const lines = body.split('\n');
    const marked = classifyLines(lines);
    lines.forEach((line, i) => {
      if (marked[i].kind !== 'prose') return;
      for (const m of line.replace(/`[^`\n]*`/g, (s) => ' '.repeat(s.length)).matchAll(IMPORT)) {
        const written = m[2].replace(/[.:!?]+$/, '');
        const rel = posix.normalize(posix.join(posix.dirname(file), written));
        if (/^[~/]/.test(written) || rel.startsWith('../') || seen.has(rel)) continue;
        const imported = fileText(repo, rel);
        if (imported === null) continue;
        seen.add(rel);
        found.push({ file: rel, tokens: tokensOf(imported) });
        walk(rel, imported, hop + 1);
      }
    });
  };
  walk(note, text, 1);
  return found;
}

/**
 * The tokens the context files cost at every session and the tokens they add when used, each file
 * counted once: an imported file joins the cost of the note that imports it, at every session when
 * that note is read at every session, and a file both imported and a context file of its own is not
 * counted twice.
 */
function loadTotals(files) {
  const atSession = new Map(), whenUsed = new Map();
  for (const f of files) {
    atSession.set(f.file, f.own);
    if (f.tokens > f.own) whenUsed.set(f.file, f.tokens - f.own);
  }
  for (const f of files.filter((x) => x.load === 'session')) {
    for (const i of f.imports) { atSession.set(i.file, i.tokens); whenUsed.delete(i.file); }
  }
  for (const f of files.filter((x) => x.load !== 'session')) {
    for (const i of f.imports) if (!atSession.get(i.file)) whenUsed.set(i.file, i.tokens);
  }
  const sum = (m) => [...m.values()].reduce((n, v) => n + v, 0);
  return { session: sum(atSession), whenUsed: sum(whenUsed) };
}

/** What a git command printed, or `fallback` when it failed, since a missing commit or file is an answer here and not an error. */
const quietly = (run, fallback = '') => { try { return run(); } catch { return fallback; } };

const EARLIER_COMMITS = [
  (git, since) => since,
  (git, since) => (since ? '' : quietly(() => git(['rev-list', '-1', '--before=30 days ago', 'HEAD']).trim())),
  (git, since) => (since ? '' : quietly(() => git(['rev-list', '--max-parents=0', 'HEAD']).trim().split('\n').filter(Boolean).pop() || '')),
];

/**
 * The commit sizes are compared with, and its date: the one `since` names, or else the commit thirty
 * days ago, or else the first commit of a younger repository. A commit named that git does not know
 * is an error; one found on its own that has no date means there is nothing to compare with.
 */
function comparedWith(git, since) {
  const ref = EARLIER_COMMITS.reduce((found, pick) => found || pick(git, since), '');
  const at = ref ? quietly(() => git(['show', '-s', '--format=%ct', ref, '--']).trim().split('\n')[0]) : '';
  if (ref && !at && since) throw new Error(`git does not know "${since}"`);
  return at ? { ref, date: new Date(Number(at) * 1000).toISOString().slice(0, 10) } : { ref: '', date: null };
}

/** A file's row set against the same file at the commit compared with: `new` when it was not there, else its growth. */
function againstThen(row, old) {
  if (old === null) return { ...row, state: 'new' };
  const before = tokensOf(unix(old.replace(/^\uFEFF/, '')));
  return { ...row, before, delta: row.tokens - before, state: row.tokens - before ? 'changed' : 'unchanged' };
}

/**
 * The budget report of the context files: size, estimated tokens, when the agents read each file and
 * what that costs at every session with the files it imports, growth since a commit, and the
 * paragraphs written twice. Tokens are estimated at four characters each, the figure the model
 * vendors quote for English prose. It measures and counts; nothing here is a finding.
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

  const { ref, date } = comparedWith(git, since);

  const files = [], notes = [];
  for (const t of targets.filter((target) => !excluded(target.label))) {
    const raw = readTextFile(t.path);
    if (raw === null) continue;
    const text = unix(raw);
    const rel = relative(repo, t.path).split(sep).join('/');
    const fm = frontmatterOf(text.split('\n'));
    const load = loadOf(rel, fm);
    const tokens = tokensOf(text);
    const own = load === 'session' ? tokens : load === 'listed' ? Math.min(tokens, tokensOf(listedOf(fm))) : 0;
    const imports = IMPORTING_NOTE.test(rel) ? importsOf(repo, rel, text) : [];
    const imported = imports.reduce((n, i) => n + i.tokens, 0);
    const row = {
      file: t.label,
      bytes: Buffer.byteLength(raw),
      lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0),
      words: wordsOf(text),
      tokens,
      load,
      own,
      imported,
      imports,
      session: own + (load === 'session' ? imported : 0),
      before: null,
      delta: null,
      state: tracked.has(t.label) ? 'unchanged' : 'untracked',
    };
    files.push(ref && row.state !== 'untracked' ? againstThen(row, quietly(() => git(['show', `${ref}:${t.label}`]), null)) : row);
    notes.push({ file: t.label, lines: text.split('\n') });
  }
  files.sort((a, b) => b.session - a.session || b.tokens - a.tokens || a.file.localeCompare(b.file));
  const repeated = repeatsAmong(notes);
  const tokens = files.reduce((n, f) => n + f.tokens, 0);
  const { session, whenUsed } = loadTotals(files);
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
      session,
      whenUsed,
      before: ref ? before : null,
      since: ref ? { ref: since || ref.slice(0, 7), date } : null,
      repeated: repeatTotals(repeated),
    },
  };
}
