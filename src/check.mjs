/**
 * prumo — the analysis. Five checks, chosen by measured precision: case mismatch against the git
 * index, broken links, missing paths, commands naming a script or target nothing defines, and
 * agent configuration that points at nothing.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep, isAbsolute, dirname, posix } from 'node:path';

const VERSION = createRequire(import.meta.url)('../package.json').version;
/** Bumped when the shape of what analyze() returns changes in a way a consumer has to know about. */
export const SCHEMA_VERSION = 6;

export const DEFAULT_TARGETS = [
  'CLAUDE.md',
  'CLAUDE.local.md',
  'AGENTS.md',
  'AGENT.md',
  'GEMINI.md',
  'COPILOT.md',
  'JULES.md',
  'CONVENTIONS.md',
  '.cursorrules',
  '.clinerules',
  '.windsurfrules',
  '.github/copilot-instructions.md',
  '.claude/MEMORY.md',
  'MEMORY.md',
];

export const DEFAULT_DIRS = ['.cursor/rules', '.windsurf/rules', '.roo/rules', '.github/instructions', '.claude/commands'];

/** Where a host installs skills. A skill found here is read even when git does not track it. */
const SKILL_DIRS = ['.claude/skills', '.agents/skills'];
/** The folders a skill carries beside its `SKILL.md`. Missing, they are the skill's own gap, which is a finding, and never a sign that it documents another project. */
const SKILL_BUNDLE = /^(references|scripts|assets|templates)$/i;

export const NESTED = new Set(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'AGENT.md', 'GEMINI.md', 'COPILOT.md', 'SKILL.md']);

const ROOTS = /^(app|apps|src|lib|resources|routes|database|config|tests?|public|scripts|bootstrap|packages|components|pages|layouts|server|api|cmd|internal|docs|dist|build|backend|frontend|services|client|\.github|\.claude)\//i;
const CODE_EXT = /\.(php|vue|js|mjs|cjs|ts|tsx|jsx|css|scss|json|ya?ml|blade\.php|py|go|rb|rs|java|kt|sql|sh|html|toml|md)$/i;
/** A shell variable in front points wherever the variable does, like a home folder or a URL. */
const OUTSIDE_REPO = /^(~|\/|[A-Za-z]:[\\/]|\.\.\/|https?:|file:|\$)/;
/** `docs.example.com/page.md` and `gesetze-im-internet.de/x.html` start with a host, which is a web address written without its scheme. */
const HOSTNAME = /^[\w-]+(\.[\w-]+)*\.(com|org|net|io|dev|ai|app|co|edu|gov|de|br|uk|fr|es|it|nl|ch|at|eu|me|info|xyz)\//i;
/** What a note appends to a path to point inside the file: a line number, a GitHub `#L10` anchor, a `::symbol` or a `:symbol`. */
const INSIDE_FILE = /([:#]L?\d+(-L?\d+)?|::?[A-Za-z_$][\w.$]*(\(\))?)$/;
const WILDCARD = /[<>{}*[\]]|\.\.\.|…/;
/** `path/to/thing.js`, `tests/path/test.py` and `src/foo/bar.test.ts` are how an example spells its argument, not files in this repository. */
const PLACEHOLDER_PATH = /(^|[/])(path[/]|(foo|bar|baz)([/.]|$))/i;
/** `myplugin.md`, `src/mytopic/mycommand.ts` and `your-app/` are how an example names the thing the reader will create. */
const EXAMPLE_NAME = /(^|[/])(my|your)-?(app|plugin|topic|command|provider|project|skill|module|component|service|feature|package|file|folder|dir|script|tool|agent|repo|lib|api|test|example|org|name|site)s?([/.]|$)/i;
/** `@scope/package/file.css` is an npm import specifier. An `@/` alias keeps its slash right after the `@`, so it is not one. */
const SCOPED_PACKAGE = /^@[^/]+\//;
/**
 * Verbs that say the path is written by the agent, a command or a build, so the file is not here yet
 * by design: *"save it to `x`"*, *"the script creates `x`"*, *"Output: `x`"*. The verb nearest the
 * path in its sentence governs it, so *"read `a` and write the result to `b`"* keeps `a` checked.
 */
const PRODUCES = new RegExp('\\b(' + [
  'outputs?', 'writes?|writing|written', 'saves?|saved|saving', 'creates?|created|creating',
  'generates?|generated|generating', 'emits?|emitted|emitting', 'produces?|produced|producing',
  'renders? to|rendered to', 'dumps? to|dumped to', 'stores? (in|to|at)|stored (in|to|at)',
  'records? (in|to)|recorded (in|to)', 'logs? to|logged to', 'places? (in|at)|placed (in|at)',
  'puts? (it |them )?(in|at)', 'adds? (it |them )?to|added to', 'maintains?|maintaining', 'location', 'destination',
  'gera|geram|gere|gerar|gerad[oa]s?', 'cria|criam|crie|criar|criad[oa]s?', 'salva|salvam|salve|salvar|salv[oa]s?',
  'grava|gravam|grave|gravar|gravad[oa]s?', 'escreve|escrevem|escreva|escrever|escrit[oa]s?',
  'produz|produzem|produza|produzir|produzid[oa]s?',
].join('|') + ')\\b', 'i');
/**
 * Verbs that presume the file is here: it is read, edited, run or said to live somewhere. They only
 * matter beside a producing verb, since a path with no verb at all is checked anyway.
 */
const CONSUMES = new RegExp('\\b(' + [
  'reads?|reading', 'see', 'consults?', 'refers? to', 'checks?', 'looks? (at|in|into)', 'opens?', 'edits?|editing',
  'updates?|updating', 'modif(y|ies|ying)', 'follows?', 'defined in', 'lives? in', 'found in', 'located (in|at)',
  'exists? (in|at)', 'sits? in', 'uses?|using', 'imports?', 'includes?', 'requires?', 'runs?|running', 'executes?',
  'loads?', 'from', 'outputs? of', 'keeps?', 'according to',
  '(generated|created|written|produced|saved|emitted|rendered|built|made) (by|via|with|using)',
  '(gerad[oa]s?|criad[oa]s?|escrit[oa]s?|produzid[oa]s?) (por|via|com|usando)',
  'leia|leiam', 'veja|vejam', 'consulte|consultem', 'confira|confiram', 'abra|abram', 'edite|editem',
  'atualize|atualizem', 'use|usem', 'rode|rodem', 'execute|executem', 'importe|importem', 'carregue', 'siga|sigam',
  'fica em|ficam em', 'est[áa] em|est[ãa]o em', 'definid[oa]s? em', 'mora em', 'encontra-se em', 'a partir de',
].join('|') + ')\\b', 'i');
/** A producing verb after the path counts only in the passive: *"`x` is generated"*, never *"`x` creates users"*. */
const PRODUCED = /\b(is|are|gets?|be|will be|should be|must be|ser[áa]|ser[ãa]o|s[ãa]o|fica|ficam|deve ser|devem ser)\s+(written|created|generated|saved|stored|placed|produced|emitted|rendered|dumped|recorded|logged|output|gerad[oa]s?|criad[oa]s?|salv[oa]s?|gravad[oa]s?|escrit[oa]s?|produzid[oa]s?)\b/i;
/** A label in front of the path that names it as the thing written: `Output: x`, `Location: x`, `Saída: x`. */
const OUTPUT_LABEL = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*|__)?(?:outputs?|output (?:files?|paths?)|location|destination|target (?:files?|paths?)|generated files?|sa[íi]da|destino|arquivos? gerados?)(?:\*\*|__)?\s*:/i;
/** In a command, what marks the next token as the file the command writes. */
const REDIRECT = /^(>|>>|-o|--out|--output|--outfile|--out-file|--output-file|--out-dir|--output-dir|--dest|--destination|-O)$/;
const OUTPUT_FLAG = /^--?(o|out|output|outfile|out-file|output-file|out-dir|output-dir|dest|destination|O)=/;
/** Commands whose arguments are the files or folders they bring into being. */
const CREATES = /^(mkdir|touch|tee)$/;
const PRODUCES_ALL = new RegExp(PRODUCES.source, 'gi');
const PRODUCED_ALL = new RegExp(PRODUCED.source, 'gi');
const CONSUMES_ALL = new RegExp(CONSUMES.source, 'gi');
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const TABLE_ROW = /^\s*\|/;
/** `report-YYYY-MM-DD.md`, `product/vX.Y.Z/` and `shots/shot_NN.md` name a file to be created, not one that is here. */
const TEMPLATE_TOKEN = /\bYYYY(?:[-_]?MM(?:[-_]?DD)?)?\b|\bv?X\.Y\.Z\b|(^|[_\-/])N{2,}([_\-.]|$)/;
/** `src/common/constants.hpp/.cpp` is two files written as one token, never a path. */
const COMPOUND_EXT = /\.[a-z0-9]{1,5}\/\.[a-z0-9]{1,5}$/i;
/** What a markdown link may point at besides code and markdown: the images and documents a note embeds. */
const LINK_EXT = /\.(mdx|png|jpe?g|gif|svg|webp|avif|pdf|ico|txt|csv)$/i;

const NEGATION = new RegExp(
  [
    '(does|do|did|is|are|was|were|has|have|will) ?n.?t ',
    'no longer', '\\bnever', 'used to', 'formerly', 'replaced by', 'deprecated',
    'was removed', 'were removed', 'has been removed', 'deleted', 'renamed', 'migrated', '\\bmoved\\b',
    'historical', 'reverted', 'superseded', 'not published', 'not exist',
    'n[ãa]o (existe|publica|h[áa]|tem)', 'n[ãa]o [ée] ', 'removid', 'apagad', 'deletad',
    'exclu[ií]d', '\\bsumi', 'deixou de', 'foi renomead', 'virou', 'passou a ser',
    'hist[óo]ric', 'obsolet', 'superad', 'revertid', 'substitu[íi]d',
    'antes (era|fazia|chamava)', '\\berrad', 'min[úu]scul', 'mai[úu]scul', 'caixa',
    '\\bcitad', 'exemplo', 'placeholder', 'example', '\\be\\.g\\.', 'gitignor', '\\bno\\b[^.\\n]{0,40}\\bfound\\b',
  ].join('|'),
  'i'
);

const HISTORICAL_NAME = /((phase|fase)[_\- ]?\d*[_\- ]?(done|complete|conclu)|[_-](superseded|superad|historic|revertid|reverted))/i;
const HISTORICAL_DESC = /^description:.*(historical|superseded|reverted|hist[óo]ric|SUPERAD|REVERTID)/im;

const TRANSIENT = /^(public\/(hot|build|storage)|bootstrap\/cache|scratchpad|storage|vendor|managed_components|target)(\/|$)|(^|\/)(\.vite|dist|coverage|\.next|\.nuxt|node_modules|__pycache__)(\/|$)/i;

const IGNORE_LINE = /<!--\s*prumo-ignore\s*-->/;
const IGNORE_NEXT = /<!--\s*prumo-ignore-next-line\s*-->/;
const IGNORE_FILE = /<!--\s*prumo-ignore-file\s*-->/;

/** A fenced block that quotes markdown is an example of syntax, so nothing inside it is a claim. */
const QUOTES_MARKDOWN = /^(md|markdown|mdx)\b/i;
const SOURCE_LANGUAGE = /^(js|javascript|jsx|ts|typescript|tsx|mjs|cjs|py|python|php|go|golang|rb|ruby|java|kt|kotlin|rs|rust|c|cpp|c\+\+|h|hpp|cs|csharp|swift|scala|dart|lua|perl|r|sql|vue|svelte|html|xml|css|scss|less)(\s|$)/i;
const PROMPT = /^[$>]\s+/;
const CODE_COMMENT = /^(#|\/\/)/;

const TRY_EXT = ['.php', '.vue', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rb', '.blade.php'];
const ALIAS_ROOTS = ['resources/js', 'src', 'app', 'lib'];
const TS_FOR = { js: ['.ts', '.tsx'], jsx: ['.tsx'], mjs: ['.mts'], cjs: ['.cts'] };

/** Turns a glob (`*`, `**`, `?`) into an anchored regular expression. */
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { out += '(?:.*/)?'; i++; } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

/** Builds the test for one config list. A pattern with no wildcard that names a folder
 *  covers everything under it, so `public/dist` reaches `public/dist/app.js`. */
function makeMatcher(patterns = []) {
  const res = patterns.map(globToRegExp);
  const folders = patterns.filter((p) => !/[*?]/.test(p)).map((p) => p.replace(/\/+$/, '').toLowerCase() + '/');
  return (value) => res.some((re) => re.test(value)) || folders.some((f) => value.toLowerCase().startsWith(f));
}

/** Reads `.prumorc.json` from the repository root. Absent or invalid means no config. */
export function loadConfig(repo) {
  const path = join(repo, '.prumorc.json');
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return {
      ignore: Array.isArray(raw.ignore) ? raw.ignore : [],
      exclude: Array.isArray(raw.exclude) ? raw.exclude : [],
      targets: Array.isArray(raw.targets) ? raw.targets : [],
      transient: Array.isArray(raw.transient) ? raw.transient : [],
    };
  } catch {
    throw new Error('.prumorc.json is not valid JSON');
  }
}

/** The baseline: findings recorded once, at the repository root, and held back on later runs so only what is new fails. */
export const BASELINE_FILE = '.prumo-baseline.json';

/** What each list of findings is called in the baseline, in SARIF and in the GitHub output. */
const KIND_OF = { caseMismatch: 'case-mismatch', brokenLinks: 'broken-link', missingPaths: 'missing-path', unknownCommands: 'unknown-command', configIssues: 'agent-config' };

/** The identity of a finding across runs: its kind, its file and what it cites. Line numbers move, so they are left out. */
const keyOf = (kind, file, cited) => `${kind}\0${file}\0${cited}`;

/**
 * Reads the baseline from the repository root. Absent means none. Invalid is an error rather than a
 * silent nothing, since a baseline that failed to load would make every finding it holds fail again.
 */
export function loadBaseline(repo) {
  const path = join(repo, BASELINE_FILE);
  if (!existsSync(path)) return null;
  let raw;
  try { raw = JSON.parse(readTextFile(path)); } catch { throw new Error(`${BASELINE_FILE} is not valid JSON`); }
  if (!raw || !Array.isArray(raw.findings)) throw new Error(`${BASELINE_FILE} has no "findings" list`);
  return raw;
}

/** The baseline a result leaves behind: one entry per kind, file and cited path, with how many lines cite it, in a stable order. */
export function baselineOf(result) {
  const entries = new Map();
  const note = (kind, file, cited) => {
    const k = keyOf(kind, file, cited);
    const e = entries.get(k) || { kind, file, cited, count: 0 };
    e.count++;
    entries.set(k, e);
  };
  for (const [list, kind] of Object.entries(KIND_OF)) for (const o of result[list] || []) note(kind, o.file, o.cited);
  for (const file of result.orphans || []) note('not-in-index', file, '');
  const findings = [...entries.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file) || a.cited.localeCompare(b.cited));
  return { prumoVersion: VERSION, recordedAt: new Date().toISOString(), findings };
}

/** How long ago a commit was, in the words a person uses. */
function ageOf(seconds, now = Date.now() / 1000) {
  const days = Math.floor((now - seconds) / 86400);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.round(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

/** At most this many paths are asked of the history in one run; a repository citing more is a catalogue. */
const HISTORY_BUDGET = 200;

/**
 * What git recorded about a path that is not here: the commit that renamed it, followed to where
 * the file is now, or the commit that deleted it. A rename is git's own detection, by similarity,
 * so what is reported is a fact of the history rather than a guess from a name. Nothing comes back
 * when the history never held the path, which is what a placeholder or another project's path
 * looks like, or when the last commit that touched it is not the one that took it away.
 */
function makeHistorian(repo, index) {
  const commits = new Map();
  const seen = new Map();
  let budget = HISTORY_BUDGET;
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  const changesOf = (sha) => {
    if (commits.has(sha)) return commits.get(sha);
    const c = { renamed: new Map(), deleted: new Set() };
    try {
      // -l raises git's rename limit, which a commit touching thousands of files would otherwise hit in silence, reading every move as a deletion
      const parts = git(['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '-l10000', '-m', '-z', sha]).split('\0');
      for (let i = 0; i < parts.length; i++) {
        const status = parts[i];
        if (!status) continue;
        if (/^[RC]/.test(status)) { if (!c.renamed.has(parts[i + 1])) c.renamed.set(parts[i + 1], parts[i + 2]); i += 2; }
        else { if (status === 'D') c.deleted.add(parts[i + 1]); i += 1; }
      }
    } catch { /* an unreadable commit reads as one that changed nothing */ }
    commits.set(sha, c);
    return c;
  };
  const lastTouch = (path) => {
    let out = '';
    try { out = git(['log', '-1', '--format=%H%x09%ct', '--', path]).trim(); } catch { return null; }
    if (!out) return null;
    const [sha, at] = out.split('\t');
    return { sha, at: Number(at) };
  };
  const follow = (path, depth) => {
    if (depth > 5 || budget-- <= 0) return null;
    const touch = lastTouch(path);
    if (!touch) return null;
    const changes = changesOf(touch.sha);
    const hop = { commit: touch.sha.slice(0, 7), date: new Date(touch.at * 1000).toISOString(), when: ageOf(touch.at) };
    const to = changes.renamed.get(path);
    if (to !== undefined) {
      if (index.known.has(to)) return { event: 'renamed', to, ...hop };
      return follow(to, depth + 1);
    }
    if (changes.deleted.has(path)) return { event: 'deleted', ...hop };
    return null;
  };
  return {
    /** The history of a cited path, tried as written from the root and then from beside the note. */
    of(cited, file, exact = false) {
      const bare = cited.replace(/^\.\//, '');
      if (!bare || /[*?<>{}]/.test(bare) || bare.endsWith('/') || bare.startsWith('/') || bare.startsWith('../')) return null;
      const candidates = exact ? [bare] : [bare];
      if (!exact && file.includes('/')) {
        const beside = posix.normalize(posix.join(posix.dirname(file), bare));
        if (!beside.startsWith('../') && beside !== bare) candidates.push(beside);
      }
      for (const path of candidates) {
        if (!seen.has(path)) seen.set(path, follow(path, 0));
        const h = seen.get(path);
        if (h) return h;
      }
      return null;
    },
  };
}

/**
 * The files a commit would carry, with `staged`, or the ones changed since a revision, as paths
 * relative to the repository root. Deleted files are left out, since there is nothing to check in them.
 */
export function changedFiles(repo, { staged = false, since = '' } = {}) {
  const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] : ['diff', '--name-only', '--diff-filter=ACMR', '-z', since];
  let out;
  try { out = execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { throw new Error(since ? `--since: git does not know "${since}"` : `git diff failed: ${String(e.stderr || e.message).trim()}`); }
  return new Set(out.split('\0').filter(Boolean));
}

function readTextFile(path) {
  try {
    if (statSync(path).size > 2_000_000) return null;
    return readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
}

const trackedCache = new Map();

/**
 * Every path git tracks, spelled the way git holds it. `core.quotepath` is on by default and
 * returns a non-ASCII name quoted and octal-escaped, which would leave every accented path out
 * of the index; `-z` keeps a name that contains a newline in one piece. The list lives until the
 * current synchronous run ends, so a CLI run or one MCP request reads the index once and a
 * server that stays up never answers from a stale one.
 */
function trackedFiles(repo) {
  const key = resolve(repo);
  const kept = trackedCache.get(key);
  if (kept) return kept;
  const list = execSync('git -c core.quotepath=false ls-files -z', { cwd: repo, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().split('\0').filter(Boolean);
  if (!trackedCache.size) queueMicrotask(() => trackedCache.clear());
  trackedCache.set(key, list);
  return list;
}

/**
 * True when the repository is itself a skill. Auto-detection leaves a root `SKILL.md` out, so a run
 * inside a published skill finds nothing, which reads like a broken tool unless the message says why.
 */
export function hasRootSkill(repo) {
  let tracked = [];
  try { tracked = trackedFiles(repo); } catch { tracked = []; }
  return tracked.includes('SKILL.md');
}

/**
 * The git index — the only source that knows a path's true letter case. Every file and folder is
 * listed under its last name, so a path cited in short form is matched by how it ends without
 * storing every ending of every path, which grew with the depth of the tree.
 */
function buildIndex(repo) {
  let tracked;
  try {
    tracked = trackedFiles(repo);
  } catch {
    return null;
  }

  const known = new Set(tracked);
  for (const p of tracked) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) known.add(parts.slice(0, i).join('/'));
  }

  const byName = new Map();
  const byNameLower = new Map();
  const lower = new Map();
  const file = (map, key, p) => { const list = map.get(key); if (list) list.push(p); else map.set(key, [p]); };
  for (const p of known) {
    const name = p.slice(p.lastIndexOf('/') + 1);
    file(byName, name, p);
    file(byNameLower, name.toLowerCase(), p);
    lower.set(p.toLowerCase(), p);
  }

  return { tracked, known, byName, byNameLower, lower, aliasRoot: ALIAS_ROOTS.some((r) => known.has(r)) };
}

/** The first indexed path that ends in `/tail`, or null. With `exact` off, `tail` is lower case and so is the comparison. */
function endingIn(index, tail, exact) {
  const list = (exact ? index.byName : index.byNameLower).get(tail.slice(tail.lastIndexOf('/') + 1));
  if (!list) return null;
  const want = '/' + tail;
  for (const p of list) if ((exact ? p : p.toLowerCase()).endsWith(want)) return p;
  return null;
}

function expandTarget(repo, target) {
  const abs = isAbsolute(target) ? target : join(repo, target);
  let st;
  try { st = statSync(abs); } catch { return []; }
  if (st.isDirectory()) {
    return readdirSync(abs)
      .filter((f) => /\.(md|mdc)$/i.test(f))
      .map((f) => ({ label: f, path: join(abs, f), fromDir: true }));
  }
  return [{ label: relative(repo, abs).split(sep).join('/') || target, path: abs, fromDir: false }];
}

/**
 * Auto-detects the context files of every agent we know, including nested ones. Nested files come
 * from the git index; a skill installed under a host's folder is also looked for on disk, since an
 * installed skill is often left out of git on purpose. A target that was asked for explicitly must
 * exist: falling back to auto-detection would answer about a different file than the one named.
 */
export function resolveTargets(repo, explicit = []) {
  if (explicit.length) {
    const missing = explicit.filter((t) => !existsSync(isAbsolute(t) ? t : join(repo, t)));
    if (missing.length) throw new Error(`target not found: ${missing.join(', ')}`);
    return explicit.flatMap((t) => expandTarget(repo, t)).map((t) => ({ ...t, explicit: true }));
  }

  const targets = [];
  const seen = new Set();
  const add = (label, path, fromDir = false) => {
    if (seen.has(label)) return;
    seen.add(label);
    targets.push({ label, path, fromDir });
  };

  for (const p of DEFAULT_TARGETS) {
    if (existsSync(join(repo, p))) add(p, join(repo, p));
  }
  for (const d of DEFAULT_DIRS) {
    if (existsSync(join(repo, d))) for (const t of expandTarget(repo, d)) add(`${d}/${t.label}`, t.path, true);
  }

  let tracked = [];
  try {
    tracked = trackedFiles(repo);
  } catch {
    tracked = [];
  }
  for (const p of tracked) {
    if (p.includes('/') && NESTED.has(p.slice(p.lastIndexOf('/') + 1)) && !TRANSIENT.test(p)) add(p, join(repo, p));
  }
  for (const d of SKILL_DIRS) {
    let names = [];
    try { names = readdirSync(join(repo, d)); } catch { continue; }
    for (const n of names) {
      const label = `${d}/${n}/SKILL.md`;
      if (existsSync(join(repo, label))) add(label, join(repo, label));
    }
  }

  return targets;
}

/** A command that moves or deletes names its old path on purpose. */
const MOVES_OR_DELETES = /^(git\s+)?(mv|rm|del|rename)\b/i;

/**
 * Marks each line as prose, code inside a fenced block, or skipped: a fence line, a block that
 * quotes markdown, a block under a `prumo-ignore-next-line` marker, and anything inside an HTML
 * comment. A code line keeps the index of its opening fence, so the sentence that introduces the
 * block counts as its context.
 */
function classifyLines(lines) {
  const out = [];
  let fence = null;
  let comment = false;
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i];
    if (fence) {
      const close = text.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) { fence = null; out.push({ kind: 'skip' }); }
      else out.push(fence.read ? { kind: 'code', text, anchor: fence.at, lang: fence.lang } : { kind: 'skip' });
      continue;
    }
    if (comment) {
      const end = text.indexOf('-->');
      if (end < 0) { out.push({ kind: 'skip' }); continue; }
      text = text.slice(end + 3);
      comment = false;
    }
    let open;
    while ((open = text.indexOf('<!--')) >= 0) {
      const end = text.indexOf('-->', open + 4);
      if (end < 0) { text = text.slice(0, open); comment = true; break; }
      text = text.slice(0, open) + ' ' + text.slice(end + 3);
    }
    const opener = text.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (opener && !(opener[1][0] === '`' && opener[2].includes('`'))) {
      const info = opener[2].trim();
      const read = !QUOTES_MARKDOWN.test(info) && !SOURCE_LANGUAGE.test(info) && !(i > 0 && IGNORE_NEXT.test(lines[i - 1]));
      fence = { char: opener[1][0], len: opener[1].length, at: i, read, lang: info.split(/\s+/)[0].toLowerCase() };
      out.push({ kind: 'skip' });
      continue;
    }
    out.push({ kind: 'prose', text, anchor: i });
  }
  return out;
}

/** What is stripped from a command's argument: a flag's name, quotes and punctuation. A code line also loses brackets and a colon. */
const PROSE_STRIP = /^["']|["'.,;]+$/g;
const CODE_STRIP = /^["'([{<]+|["'.,;:)\]}>]+$/g;
const CALL_PREFIX = /^[\w$.]+[(=]+["'(]*/;
const TREE_GLYPH = /^[│├└─┼┬┴┤|`+\\-]+$/;

const SHELL_LANGUAGE = /^(bash|sh|shell|zsh|fish|console|terminal|cmd|bat|powershell|ps1?|pwsh|text|txt|plaintext|plain|makefile|make|dockerfile)?$/;
const ENV_ASSIGNMENT = /^[A-Za-z_]\w*=/;
const ELSEWHERE_FLAG = /^(-w|--workspaces?|-C|--directory|--dir|-f|--file|--filter|-r|--recursive|--cwd|--prefix)(=.*)?$/;
const YARN_BUILTIN = new Set('access add audit autoclean bin cache check config constraints create dedupe dlx exec explain generate-lock-entry global help import info init install licenses link list login logout node outdated owner pack patch patch-commit plugin policies publish rebuild remove run search set stage tag team unlink unplug up upgrade upgrade-interactive version versions why workspace workspaces'.split(' '));
const PNPM_BUILTIN = new Set('add install i update up upgrade remove rm uninstall un link unlink import rebuild rb prune fetch dedupe patch patch-commit patch-remove audit licenses outdated list ls why run exec dlx create publish pack recursive server store env setup init deploy doctor config cat-file cat-index find-hash approve-builds ignored-builds self-update root bin help'.split(' '));
const COMPOSER_BUILTIN = new Set('about archive audit browse bump check-platform-reqs clear-cache clearcache cc completion config create-project depends diagnose dump-autoload dumpautoload exec fund global help home init install i licenses list outdated prohibits reinstall remove require run run-script search self-update selfupdate show status suggests update u upgrade validate why why-not'.split(' '));
const KNOWN_BIN = new Set(['tsc', 'tsserver', 'playwright', 'commitlint', 'changeset', 'svelte-kit', 'ng', 'sb', 'nest', 'remix', 'eas', 'firebase', 'netlify', 'biome']);

/**
 * Splits a command into its arguments, marking the one a redirect, an output flag or a creating
 * command points at, since that argument is the file the command writes.
 */
function tokensOf(span, strip) {
  const raw = span.split(/\s+/);
  const creates = CREATES.test(raw[0]);
  return raw.map((r, i) => ({
    tok: r.replace(/^>+/, '').replace(/^--?[\w-]+=/, '').replace(strip, '').replace(CALL_PREFIX, ''),
    out: creates || r.startsWith('>') || OUTPUT_FLAG.test(r) || (i > 0 && REDIRECT.test(raw[i - 1])),
  }));
}

/** The tokens that read as paths of this repository, in the spelling the note uses, each with whether the command writes it. */
function pathsAmong(tokens) {
  const found = [];
  for (const { tok: raw, out } of tokens) {
    const tok = raw.includes('\\') ? raw.split('\\').join('/') : raw;
    if (WILDCARD.test(tok) || OUTSIDE_REPO.test(tok) || HOSTNAME.test(tok) || PLACEHOLDER_PATH.test(tok) || EXAMPLE_NAME.test(tok) || SCOPED_PACKAGE.test(tok)) continue;
    if (TEMPLATE_TOKEN.test(tok) || COMPOUND_EXT.test(tok)) continue;
    if (!(ROOTS.test(tok) || (tok.includes('/') && CODE_EXT.test(tok)))) continue;
    found.push({ p: tok.replace(/^\.\//, '').replace(INSIDE_FILE, '').replace(/\/$/, ''), out });
  }
  return found;
}

/**
 * Paths cited in backticks, each with where its span starts on the line. A backtick span with
 * spaces is read as a command, and each of its arguments is tried as a path: `python scripts/seed.py`.
 */
function pathsInProse(line) {
  const found = [];
  for (const m of line.matchAll(/`([^`\n]{3,120})`/g)) {
    const t = m[1].trim();
    if (OUTSIDE_REPO.test(t)) continue;
    let tokens = [{ tok: t, out: false }];
    if (/\s/.test(t)) {
      const first = t.split(/\s+/)[0];
      if (MOVES_OR_DELETES.test(t) || /^\d/.test(first) || (first.includes('/') && !first.startsWith('./'))) continue;
      tokens = tokensOf(t, PROSE_STRIP);
    }
    for (const f of pathsAmong(tokens)) found.push({ ...f, at: m.index, len: m[0].length, command: false });
  }
  return found;
}

/**
 * Paths on a line of a fenced block, read as a command or as a file tree, so every token is tried.
 * A comment line is what a command prints, a line too long to be a command is data, and `./name`
 * with no folder is an argument the reader supplies, like a bare file name in prose. A line with
 * more than one argument is a command, whose program has to be here whatever the block is about.
 */
function pathsInCode(line) {
  const t = line.trim().replace(PROMPT, '');
  if (!t || t.length > 300 || CODE_COMMENT.test(t) || MOVES_OR_DELETES.test(t)) return [];
  const tokens = tokensOf(t, CODE_STRIP).filter(({ tok }) => tok && !TREE_GLYPH.test(tok) && !(tok.startsWith('./') && !tok.slice(2).includes('/')));
  return pathsAmong(tokens).map((f) => ({ ...f, at: 0, len: line.length, command: tokens.length > 1 }));
}

/**
 * Asks git which of these paths .gitignore covers. A path ignored on purpose is
 * expected to be absent from the index and often from this machine, so its
 * absence says nothing about the note. Returns the subset that is ignored.
 */
function gitIgnored(repo, paths) {
  if (!paths.length) return new Set();
  const parse = (buf) => new Set(String(buf || '').split('\0').map((s) => s.trim()).filter(Boolean));
  try {
    return parse(execSync('git check-ignore --stdin -z', { cwd: repo, input: paths.join('\0') + '\0', stdio: ['pipe', 'pipe', 'ignore'] }));
  } catch (err) {
    return parse(err.stdout);
  }
}

/**
 * A markdown link writes a space as `%20`, so the target has to be decoded before it is resolved and
 * re-encoded before it is written back, or a fix would turn a working link into a broken one.
 */
function decodeLink(to) {
  try { return decodeURIComponent(to); } catch { return to; }
}

/** The `owner/name` this repository pushes to, so a link naming a different one can be told apart. */
function originRepo(repo) {
  try {
    const url = execSync('git remote get-url origin', { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const m = url.match(/(?:github|gitlab)\.com[:/]([\w.-]+\/[\w.-]+)/i);
    return m ? m[1].replace(/\.git$/, '').toLowerCase() : '';
  } catch { return ''; }
}

/** True when the lines around a citation name another repository, which is whose path it is. */
function namesAnotherRepo(window, own) {
  if (!own) return false;
  for (const m of window.matchAll(/(?:github|gitlab)\.com[:/]([\w.-]+\/[\w.-]+)/gi)) {
    if (m[1].replace(/\.git$/, '').toLowerCase() !== own) return true;
  }
  return false;
}

const masked = (text) => text.replace(/`[^`\n]*`/g, (s) => ' '.repeat(s.length));

/**
 * The sentence a citation sits in: from the terminator before it to the one after, with backtick
 * spans masked first, since a path holds dots of its own. `at` is where the citation starts.
 */
function sentenceAround(text, at, len) {
  const plain = masked(text);
  let start = 0;
  for (const m of plain.matchAll(/[.!?;]\s/g)) { if (m.index < at) start = m.index + m[0].length; else break; }
  const tail = plain.slice(at + len).search(/[.!?;](\s|$)/);
  const end = tail < 0 ? text.length : at + len + tail;
  return { text: text.slice(start, end), at: at - start };
}

/**
 * Which family of verb governs the citation at `at`: the producing or the consuming one nearest to
 * it, a producing verb after it counting only in the passive. Empty when neither family is there.
 * Backtick spans are masked, since `scripts/generate.js` holds a verb that governs nothing.
 */
function governs(text, at, len) {
  const plain = masked(text);
  const nearest = (re, after) => {
    let best = Infinity;
    for (const m of plain.matchAll(re)) {
      if (m.index + m[0].length <= at) best = Math.min(best, at - (m.index + m[0].length));
      else if (after && m.index >= at + len) best = Math.min(best, m.index - (at + len));
    }
    return best;
  };
  const p = Math.min(nearest(PRODUCES_ALL, false), nearest(PRODUCED_ALL, true));
  const c = nearest(CONSUMES_ALL, true);
  if (p === Infinity && c === Infinity) return '';
  return p <= c ? 'produces' : 'consumes';
}

/** True when the sentence makes the file's existence a condition: *"if `x` exists, read it"*, *"check whether `x` is present"*, *"se `x` existir"*. */
function conditionalExistence(text, at, len) {
  const s = sentenceAround(text, at, len);
  const plain = masked(s.text);
  const state = '(exists?|present|available|found|missing|absent|existir|existirem|exista|existe|presente|ausente|faltar)';
  const after = plain.slice(s.at + len);
  return (/\b(if|when|whether|unless|se|caso|quando)\b[^.;!?]{0,60}$/i.test(plain.slice(0, s.at)) && new RegExp('^[^.;!?]{0,40}\\b' + state + '\\b', 'i').test(after))
    || new RegExp('^[^.;!?]{0,40}\\b(if|when|whether|unless|se|caso|quando)\\b[^.;!?]{0,40}\\b' + state + '\\b', 'i').test(after);
}

/** What a heading or a block's introduction says about the paths under it: a producing verb anywhere wins, since *"Output path | When to use"* is about outputs. */
function mentions(text) {
  const plain = masked(text);
  if (PRODUCES.test(plain) || PRODUCED.test(plain)) return 'produces';
  return CONSUMES.test(plain) ? 'consumes' : '';
}

/** For each line, the index of the nearest heading above it, or -1. */
function headingsAbove(lines, marked) {
  const out = [];
  for (let j = 0, last = -1; j < lines.length; j++) {
    if (marked[j].kind === 'prose' && /^#{1,6}\s/.test(lines[j])) last = j;
    out.push(last);
  }
  return out;
}

/**
 * The line that introduces the block a citation sits in: the sentence above a fenced block or a
 * list, the parent item of a nested list, and for a table its header row with the sentence above.
 */
function introOf(lines, marked, i, m) {
  const proseAt = (j) => (j >= 0 && marked[j].kind === 'prose' ? lines[j] : '');
  const aboveBlank = (j) => (j >= 0 && !lines[j].trim() ? j - 1 : j);
  if (m.kind === 'code') return proseAt(aboveBlank(m.anchor - 1));
  const item = lines[i].match(LIST_ITEM);
  if (item) {
    let j = i - 1;
    for (; j >= 0; j--) {
      const it = lines[j].match(LIST_ITEM);
      if (it) { if (it[1].length < item[1].length) break; continue; }
      if (/^\s+\S/.test(lines[j]) || (!lines[j].trim() && j > 0 && LIST_ITEM.test(lines[j - 1]))) continue;
      break;
    }
    return proseAt(aboveBlank(j));
  }
  if (TABLE_ROW.test(lines[i])) {
    let j = i;
    while (j > 0 && TABLE_ROW.test(lines[j - 1])) j--;
    return `${lines[j]} ${proseAt(aboveBlank(j - 1))}`;
  }
  return '';
}

/**
 * Whether the sentence, the block's introduction or the section heading says the path is produced
 * or consumed. A label such as `Output:` opening the line settles it on its own.
 */
function verdictOn(lines, marked, headings, i, m, at, len) {
  if (m.kind === 'prose') {
    const s = sentenceAround(m.text, at, len);
    if (s.at === at && OUTPUT_LABEL.test(m.text)) return 'produces';
    const v = governs(s.text, s.at, len);
    if (v) return v;
  }
  const lead = mentions(introOf(lines, marked, i, m));
  if (lead) return lead;
  const h = headings[i];
  return h >= 0 ? mentions(lines[h]) : '';
}

/** The targets a Makefile defines. A target built from a variable or a pattern cannot be listed, so the file is marked dynamic and the check stands down. */
function makeTargets(body) {
  const targets = new Set();
  let dynamic = false;
  for (const raw of body.split('\n')) {
    if (raw.startsWith('\t')) continue;
    const m = raw.replace(/#.*$/, '').match(/^([^\s:=#][^:=]*?)\s*::?(?!=)/);
    if (!m) continue;
    for (const name of m[1].trim().split(/\s+/)) {
      if (/[%$]/.test(name)) dynamic = true;
      else if (/^[\w./-]+$/.test(name)) targets.add(name);
    }
  }
  return { targets, dynamic };
}

/**
 * The scripts and targets this repository defines, read from every package.json, composer.json
 * and Makefile git tracks, so a note anywhere in a monorepo may name any of them. A kind the
 * repository has no file of is null, since then the command belongs to another project. Besides
 * its scripts, `yarn x` and `pnpm x` run a dependency's binary, so those names are accepted too.
 */
function commandSources(repo, tracked) {
  const scripts = new Set(), accepted = new Set(KNOWN_BIN), composer = new Set(), make = new Set();
  let sawNpm = false, sawComposer = false, sawMake = false, dynamic = false;
  const manifest = (p) => { try { return JSON.parse(readFileSync(join(repo, p), 'utf8')) || {}; } catch { return {}; } };
  for (const p of tracked) {
    const name = p.slice(p.lastIndexOf('/') + 1);
    if (name === 'package.json') {
      sawNpm = true;
      const j = manifest(p);
      for (const s of Object.keys(j.scripts || {})) { scripts.add(s); accepted.add(s); }
      for (const d of Object.keys(j.dependencies || {}).concat(Object.keys(j.devDependencies || {}))) accepted.add(d.replace(/^@[^/]+\//, ''));
    } else if (name === 'composer.json') {
      sawComposer = true;
      for (const s of Object.keys(manifest(p).scripts || {})) composer.add(s);
    } else if (/^(GNUmakefile|[Mm]akefile)$/.test(name) || name.endsWith('.mk')) {
      sawMake = true;
      const r = makeTargets(readTextFile(join(repo, p)) || '');
      for (const t of r.targets) make.add(t);
      if (r.dynamic) dynamic = true;
    }
  }
  return {
    scripts: sawNpm ? scripts : null,
    accepted: sawNpm ? accepted : null,
    'composer.json': sawComposer ? composer : null,
    Makefile: sawMake && !dynamic ? make : null,
  };
}

/**
 * The scripts and targets a line of commands names: `npm run x`, `yarn x`, `pnpm x`, `bun run x`,
 * `make x` and `composer x`. A chain is split on `&&`, `||`, `;` and `|`; a variable in front,
 * `sudo` and `time` are skipped; a flag that points at another folder or package skips the command.
 * `strict` says the name has to be a script, as `npm run` accepts nothing else.
 */
function commandsIn(text) {
  const found = [];
  const add = (cited, name, source, strict) => { if (!/[./\\*{}$<>[\]]/.test(name)) found.push({ cited, name, source, strict }); };
  for (const seg of text.replace(PROMPT, '').split(/\s*(?:&&|\|\||;|\|)\s*/)) {
    const tok = seg.replace(/(["'])(?:(?!\1).)*\1/g, (q) => (q.includes(' ') ? '' : q)).trim().split(/\s+/).map((t) => t.replace(/^["'`]+|["'`]+$/g, '')).filter(Boolean);
    while (tok.length && (ENV_ASSIGNMENT.test(tok[0]) || tok[0] === 'sudo' || tok[0] === 'time')) tok.shift();
    const [cmd, ...rest] = tok;
    if (!cmd || rest.some((t) => ELSEWHERE_FLAG.test(t))) continue;
    const args = rest.filter((t) => !t.startsWith('-') && !t.includes('='));
    const [first, second] = args;
    if (!first) continue;
    if (cmd === 'npm') {
      if (/^run(-script)?$/.test(first)) { if (second) add(`npm ${first} ${second}`, second, 'package.json', true); }
      else if (/^(test|stop|restart)$/.test(first)) add(`npm ${first}`, first, 'package.json', true);
    } else if (cmd === 'yarn' || cmd === 'pnpm') {
      if (first === 'run') { if (second) add(`${cmd} run ${second}`, second, 'package.json', true); }
      else if (!(cmd === 'yarn' ? YARN_BUILTIN : PNPM_BUILTIN).has(first)) add(`${cmd} ${first}`, first, 'package.json', false);
    } else if (cmd === 'bun') {
      if (first === 'run' && second) add(`bun run ${second}`, second, 'package.json', true);
    } else if (cmd === 'make') {
      for (const t of args) add(`make ${t}`, t, 'Makefile', true);
    } else if (cmd === 'composer') {
      if (/^run(-script)?$/.test(first)) { if (second) add(`composer ${first} ${second}`, second, 'composer.json', true); }
      else if (!COMPOSER_BUILTIN.has(first)) add(`composer ${first}`, first, 'composer.json', true);
    }
  }
  return found;
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** The defined name a typo most likely meant: the same letters once `-`, `_` and `:` are dropped, or at most two edits away. */
function closestName(names, name) {
  const loose = (s) => s.toLowerCase().replace(/[-_:]/g, '');
  const want = loose(name);
  let best = null, bestDistance = 3;
  for (const n of names) {
    if (loose(n) === want) return n;
    const d = editDistance(n.toLowerCase(), name.toLowerCase());
    if (d < bestDistance) { bestDistance = d; best = n; }
  }
  return best;
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
 * Tries the literal path, then `@/` aliases, then the path without a first segment that names
 * no folder here, which is how a note spells the project name in front of a real path, then the
 * TypeScript source behind an emitted `.js`, then omitted extensions. The prefix step demands an
 * exact nested match, so a wrongly cased first segment stays a case mismatch.
 */
function resolvePath(index, p) {
  const tries = [p];
  if (p.startsWith('@/')) {
    tries.push(p.slice(2));
    for (const r of ALIAS_ROOTS) tries.push(r + '/' + p.slice(2));
  }
  const head = p.includes('/') ? p.slice(0, p.indexOf('/')) : '';
  const rest = head ? p.slice(head.length + 1) : '';
  if (head && rest.includes('/') && !index.known.has(head) && index.known.has(rest)) tries.push(rest);
  const js = p.match(/\.(js|jsx|mjs|cjs)$/i);
  if (js) for (const base of [...tries]) for (const e of TS_FOR[js[1].toLowerCase()]) tries.push(base.slice(0, -js[0].length) + e);
  if (!/\.[a-z0-9]{2,5}$/i.test(p)) {
    for (const base of [...tries]) for (const e of TRY_EXT) tries.push(base + e);
  }
  for (const t of tries) {
    if (index.known.has(t) || endingIn(index, t, true)) return { state: 'ok' };
  }
  for (const t of tries) {
    const low = t.toLowerCase();
    const real = index.lower.get(low) || endingIn(index, low, false);
    if (real) return { state: 'case', real };
  }
  return { state: 'missing' };
}

/** Agent configuration read as data rather than as prose: MCP servers and hooks name scripts that have to be here. */
const CONFIG_FILES = ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json', '.claude/settings.json'];
const INSTALLED_SKILL = /(^|\/)skills\/[^/]+\/SKILL\.md$/i;
const HOST_SKILL = /(^|\/)\.(claude|agents)\/skills\//i;
const CURSOR_RULE = /(^|\/)\.cursor\/rules\/[^/]+\.mdc$/i;
const COPILOT_INSTRUCTION = /(^|\/)\.github\/instructions\/[^/]+\.md$/i;
const PROJECT_DIR_VAR = /\$\{?CLAUDE_PROJECT_DIR\}?\//g;

/**
 * The front matter of a note, read as flat fields: `key: value` lines and the list items under a
 * key, each with its line number. Enough for globs, names and descriptions, nothing nested.
 */
function frontmatterOf(lines) {
  const fields = new Map();
  if ((lines[0] || '').trim() !== '---') return fields;
  let key = '';
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (/^(---|\.\.\.)\s*$/.test(line)) break;
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) { key = kv[1]; fields.set(key, { value: kv[2].trim(), line: i + 1, items: [] }); continue; }
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key && fields.has(key)) { fields.get(key).items.push(item[1].trim()); continue; }
    const more = line.match(/^\s+(\S.*)$/);
    if (more && key && fields.has(key)) { const field = fields.get(key); field.value = (field.value + ' ' + more[1].trim()).trim(); }
  }
  return fields;
}

/** Splits a comma list without breaking a brace group such as `*.{ts,tsx}`. */
function splitOutsideBraces(text) {
  const parts = [];
  let depth = 0, current = '';
  for (const ch of text) {
    if (ch === '{') depth++;
    if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; } else current += ch;
  }
  parts.push(current);
  return parts;
}

/** Expands `a.{ts,tsx}` into `a.ts` and `a.tsx`, one level deep, which is how rule globs write alternatives. */
function expandBraces(glob) {
  const m = glob.match(/^(.*?)\{([^{}]*)\}(.*)$/);
  if (!m) return [glob];
  return m[2].split(',').flatMap((alt) => expandBraces(m[1] + alt.trim() + m[3]));
}

const unquoted = (s) => s.replace(/^["']|["']$/g, '');

/** The globs a field holds, whether written as one string, a comma list, a bracket list or list items. */
function globsOf(field) {
  return splitOutsideBraces([field.value, ...field.items].join(',').replace(/[[\]]/g, '')).map((g) => unquoted(g.trim())).filter(Boolean);
}

/**
 * Whether a rule's glob reaches at least one tracked file. It is tried against the full path, then
 * under any folder; a glob without a wildcard may simply name a folder that exists, and a bare
 * extension, `.cpp`, is read as any `.cpp` file in any folder, which is what its author meant.
 */
function globMatchesAny(glob, index) {
  for (const one of expandBraces(glob)) {
    const bare = one.replace(/^\.\//, '').replace(/\/$/, '');
    if (!/[*?]/.test(bare) && index.known.has(bare)) return true;
    const pattern = /^\.[\w.-]+$/.test(bare) ? '**/*' + bare : bare;
    const res = [globToRegExp(pattern)];
    if (!pattern.startsWith('**')) res.push(globToRegExp('**/' + pattern));
    for (const p of index.tracked) for (const re of res) if (re.test(p)) return true;
  }
  return false;
}

/**
 * The globs a rule is attached by: `globs:` in a Cursor rule, `applyTo:` in a Copilot instruction,
 * unless `alwaysApply: true` makes them moot. Null when the file is not such a rule.
 */
function ruleGlobs(label, fm) {
  const key = CURSOR_RULE.test(label) ? 'globs' : COPILOT_INSTRUCTION.test(label) ? 'applyTo' : '';
  const field = key ? fm.get(key) : null;
  const always = fm.get('alwaysApply');
  if (!field || (always && /^true$/i.test(always.value))) return null;
  return { line: field.line, globs: globsOf(field) };
}

/**
 * What the front matter of a rule or a skill promises and the repository cannot keep: a rule none
 * of whose globs matches anything, so it never applies, and a skill with no description, so nothing
 * says when to use it. A rule attaches when any one of its globs matches, so a dead glob beside a
 * live one is harmless and is not reported. Outside a host's skills folder, only front matter that
 * carries a top-level `name` is read as a skill's, since a `SKILL.md` elsewhere may follow another
 * schema. A skill's `name` is not held against its folder, since hosts differ on whether it must
 * match or is only a display name.
 */
function frontmatterIssues(label, lines, index) {
  const issues = [];
  const fm = frontmatterOf(lines);
  const at = (line, kind, cited, message) => issues.push({ file: label, line, kind, cited, message });
  if (INSTALLED_SKILL.test(label)) {
    const description = fm.get('description');
    const standard = fm.has('name') || HOST_SKILL.test(label);
    if (fm.size && standard && !(description && description.value)) at(1, 'skill-description', 'description', 'missing from the front matter, so nothing says when to use the skill');
    if (!fm.size && HOST_SKILL.test(label)) at(1, 'skill-description', 'front matter', 'missing, so the skill has no name and no description to be picked by');
  }
  const rule = ruleGlobs(label, fm);
  if (rule && rule.globs.length && !rule.globs.some((glob) => globMatchesAny(glob, index))) {
    const { globs } = rule;
    const shown = globs.length > 3 ? `${globs.slice(0, 3).join(', ')} and ${globs.length - 3} more` : globs.join(', ');
    at(rule.line, 'glob', shown, `${globs.length === 1 ? 'matches' : 'match'} no file in the repository, so the rule never applies`);
  }
  return issues;
}

/**
 * The scripts an MCP server or a hook names in a JSON configuration, checked like a command in a
 * fenced block: each argument that reads as a path of this repository has to be here.
 */
function configFileIssues(rel, text, repo, index, ignored, resolveOnce) {
  const issues = [];
  let json;
  try { json = JSON.parse(text); } catch { return issues; }
  const lines = text.split('\n');
  const lineOf = (needle) => { const i = lines.findIndex((l) => l.includes(needle)); return i < 0 ? 1 : i + 1; };
  const check = (command, where) => {
    for (const { p } of pathsInCode(command.replace(PROJECT_DIR_VAR, ''))) {
      if (ignored(p) || TRANSIENT.test(p)) continue;
      const r = resolveOnce(p);
      if (r.state === 'case') issues.push({ file: rel, line: lineOf(p.slice(p.lastIndexOf('/') + 1)), kind: 'config-path', cited: p, message: `named ${where}; the repository has ${r.real}` });
      else if (r.state === 'missing' && !existsSync(join(repo, p))) issues.push({ file: rel, line: lineOf(p.slice(p.lastIndexOf('/') + 1)), kind: 'config-path', cited: p, message: `named ${where}, not here` });
    }
  };
  const servers = (json && typeof json === 'object' && (json.mcpServers || json.servers)) || {};
  for (const [name, server] of Object.entries(servers)) {
    if (!server || typeof server !== 'object') continue;
    const command = [server.command, ...(Array.isArray(server.args) ? server.args : [])].filter((x) => typeof x === 'string').join(' ');
    if (command) check(command, `by the MCP server "${name}"`);
  }
  for (const [event, groups] of Object.entries((json && json.hooks) || {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of Array.isArray(group && group.hooks) ? group.hooks : []) {
        if (hook && typeof hook.command === 'string') check(hook.command, `by the ${event} hook`);
      }
    }
  }
  return issues;
}

/**
 * Runs the five checks. A wikilink may point at any markdown file git tracks,
 * not only at the notes being checked, so `linkable` is built from the whole index.
 * A path is reported on every line that cites it, and a path that a sentence excuses stays
 * excused on the lines of that file that follow, since they speak of the same file.
 * `only` limits the targets and the configuration files to the paths it holds, for a run over what
 * a commit or a branch touched. `baseline` holds back the findings it records, counted in `stats.baselined`.
 * @returns {{schemaVersion:number, prumoVersion:string, repo:string, checkedAt:string, caseMismatch:[], brokenLinks:[], missingPaths:[], orphans:[], stats:{}}}
 */
export function analyze({ repo, targets, config = null, baseline = null, only = null }) {
  const index = buildIndex(repo);
  if (!index) throw new Error(`not a git repository: ${repo}`);
  if (!index.tracked.length) throw new Error('the git index is empty, so nothing can be checked against it. Commit or "git add" the files first.');

  const own = originRepo(repo);
  const settings = config ?? loadConfig(repo);
  const ignored = makeMatcher(settings.ignore);
  const excluded = makeMatcher(settings.exclude);
  const extraTransient = makeMatcher(settings.transient);
  const checked = targets.filter((t) => !excluded(t.label) && (!only || only.paths.has(t.label)));
  const inIndex = (t) => {
    const rel = relative(repo, t.path).split(sep).join('/');
    return index.known.has(rel) || index.lower.has(rel.toLowerCase());
  };

  const names = new Set(checked.map((t) => t.label.replace(/\.(md|mdc)$/i, '')));
  const linkable = new Set(names);
  for (const p of index.tracked) {
    if (!/.(md|mdc)$/i.test(p)) continue;
    const bare = p.replace(/.(md|mdc)$/i, '');
    linkable.add(bare);
    linkable.add(bare.slice(bare.lastIndexOf('/') + 1));
  }
  const loose = new Map();
  for (const n of linkable) loose.set(n.toLowerCase().replace(/[_-]/g, ''), n);

  const caseMismatch = [], missingPaths = [], brokenLinks = [], unknownCommands = [], configIssues = [], orphans = [], elsewhere = [];
  let historical = 0, suppressed = 0, untracked = 0, configs = 0;
  const autoRun = !checked.some((t) => t.explicit);
  const rulesFolders = new Map();
  const rulesElsewhere = (folder) => { let c = rulesFolders.get(folder); if (!c) { c = { cited: 0, absent: 0 }; rulesFolders.set(folder, c); } return c; };
  const relOf = new Map();
  const resolved = new Map();
  const resolveOnce = (p) => {
    let r = resolved.get(p);
    if (!r) { r = resolvePath(index, p); resolved.set(p, r); }
    return r;
  };
  let sources = null;
  const sourcesOnce = () => sources || (sources = commandSources(repo, index.tracked));
  const anchorCache = new Map();
  const anchorsOf = (abs, text) => {
    const key = resolve(abs);
    let set = anchorCache.get(key);
    if (!set) { set = anchorsIn(text ?? (readTextFile(abs) || '')); anchorCache.set(key, set); }
    return set;
  };
  const looseAnchor = (s) => s.replace(/[-_]/g, '');
  const nearAnchor = (set, anchor) => {
    const want = looseAnchor(anchor);
    for (const a of set) if (looseAnchor(a) === want) return a;
    for (const a of set) { const l = looseAnchor(a); if (want && l.endsWith(want) && l.length - want.length <= 3) return a; }
    return null;
  };

  for (const target of checked) {
    const body = readTextFile(target.path);
    if (body === null) continue;
    if (!inIndex(target)) untracked++;
    if (IGNORE_FILE.test(body.slice(0, 400))) { suppressed++; continue; }
    const lines = body.split('\n');
    const isHistorical = HISTORICAL_NAME.test(target.label) || HISTORICAL_DESC.test(body.slice(0, 600));
    if (isHistorical) historical++;
    const marked = classifyLines(lines);
    const headings = headingsAbove(lines, marked);
    const excused = new Set();
    const opened = { caseMismatch: caseMismatch.length, brokenLinks: brokenLinks.length, missingPaths: missingPaths.length, unknownCommands: unknownCommands.length };
    const citedHere = new Set(), absentHere = new Set();
    const isSkill = /(^|\/)SKILL\.md$/i.test(target.label);
    const cite = (p, missing) => {
      citedHere.add(p);
      const head = p.split('/')[0];
      if (missing && !index.known.has(head) && !(isSkill && SKILL_BUNDLE.test(head))) absentHere.add(p);
    };
    const context = (i, anchor, before, after) => (anchor === i
      ? lines.slice(Math.max(0, i - before), i + after + 1)
      : lines.slice(Math.max(0, anchor - before), anchor).concat(lines.slice(Math.max(anchor + 1, i - before), i + 1))
    ).join(' ');

    marked.forEach((m, i) => {
      const line = lines[i];
      if (IGNORE_LINE.test(line) || (i > 0 && IGNORE_NEXT.test(lines[i - 1]))) { suppressed++; return; }
      if (m.kind === 'skip') return;
      const code = m.kind === 'code';

      if (!isHistorical) {
        const seen = new Set();
        for (const { p, at, len, out, command } of code ? pathsInCode(m.text) : pathsInProse(m.text)) {
          if (seen.has(p) || excused.has(p) || TRANSIENT.test(p) || extraTransient(p) || ignored(p)) continue;
          seen.add(p);
          if (!CODE_EXT.test(p) && !index.known.has(p.split('/')[0])) continue;
          if (p.startsWith('@/') && !index.aliasRoot) continue;

          const r = resolveOnce(p);
          if (r.state === 'ok') { cite(p, false); continue; }
          const paragraph = context(i, m.anchor, 2, 2);
          if (NEGATION.test(paragraph) || namesAnotherRepo(context(i, m.anchor, 6, 1), own) || (!code && conditionalExistence(m.text, at, len))) { excused.add(p); continue; }
          if (r.state !== 'case') {
            const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
            const v = out ? 'produces' : command ? '' : verdictOn(lines, marked, headings, i, m, at, len);
            if (v === 'produces' || (parent && !index.known.has(parent) && PRODUCES.test(paragraph))) { excused.add(p); continue; }
          }

          if (r.state === 'case') {
            cite(p, false);
            caseMismatch.push({ file: target.label, line: i + 1, cited: p, actual: r.real });
          } else if (!existsSync(join(repo, p)) && !existsSync(join(dirname(target.path), p))) {
            cite(p, true);
            missingPaths.push({ file: target.label, line: i + 1, cited: p, excerpt: line.trim().slice(0, 160) });
          } else cite(p, false);
        }

        if (!code || SHELL_LANGUAGE.test(m.lang)) {
          const spans = code ? [m.text] : [...m.text.matchAll(/`([^`\n]{3,200})`/g)].map((s) => s[1]).filter((s) => /\s/.test(s));
          const seenCommand = new Set();
          for (const span of spans) {
            for (const c of commandsIn(span)) {
              const src = sourcesOnce();
              const defined = c.source === 'package.json' ? (c.strict ? src.scripts : src.accepted) : src[c.source];
              if (!defined || defined.has(c.name) || seenCommand.has(c.cited)) continue;
              seenCommand.add(c.cited);
              if (NEGATION.test(context(i, m.anchor, 2, 2))) continue;
              const near = closestName(c.source === 'package.json' ? src.scripts : defined, c.name);
              unknownCommands.push({
                file: target.label,
                line: i + 1,
                cited: c.cited,
                name: c.name,
                source: c.source,
                suggestion: near ? c.cited.slice(0, -c.name.length) + near : null,
                excerpt: line.trim().slice(0, 160),
              });
            }
          }
        }
      }
      if (code) return;

      const prose = m.text.replace(/`[^`\n]*`/g, ' ').replace(/^\[([^\]]+)\]:\s*(\S+)\s*$/, '[$1]($2)');

      for (const l of prose.matchAll(/\[\[([A-Za-z0-9][\w .\/-]{1,80})\]\]/g)) {
        const to = l[1].trim();
        if (linkable.has(to) || ignored(to)) continue;
        if (to.startsWith('@/') && !index.aliasRoot) continue;
        if (to !== l[1] || to.includes('.') || /[\w$]/.test(prose[l.index - 1] || '')) continue;
        brokenLinks.push({
          file: target.label,
          line: i + 1,
          kind: 'wikilink',
          cited: to,
          suggestion: loose.get(to.toLowerCase().replace(/[_-]/g, '')) || null,
        });
      }

      for (const l of prose.matchAll(/\]\((?:<([^<>#]+)(?:#([^>]*))?>|([^)\s#]+)(?:#([^)\s]*))?|#([^)\s]+))\)/gi)) {
        const to = l[1] || l[3] || '';
        const fragment = l[2] || l[4] || l[5] || '';
        const anchor = decodeLink(fragment).toLowerCase();
        if (!to) {
          const own = anchorsOf(target.path, body);
          if (anchor && !own.has(anchor)) {
            const near = nearAnchor(own, anchor);
            brokenLinks.push({ file: target.label, line: i + 1, kind: 'anchor', cited: `#${fragment}`, suggestion: near ? `#${near}` : null });
          }
          continue;
        }
        if (!CODE_EXT.test(to) && !LINK_EXT.test(to)) continue;
        if (WILDCARD.test(to) || HOSTNAME.test(to) || PLACEHOLDER_PATH.test(to) || EXAMPLE_NAME.test(to) || TEMPLATE_TOKEN.test(to) || SCOPED_PACKAGE.test(to)) continue;
        if (/^(https?:|\/\/)/i.test(to) || ignored(to)) continue;
        const mdc = /^mdc:/i.test(to);
        const href = mdc ? '/' + decodeLink(to.slice(4)).replace(/^\.?\//, '') : decodeLink(to);
        let abs = href.startsWith('/') ? join(repo, href.slice(1)) : join(dirname(target.path), href);
        let rel = relative(repo, abs).split(sep).join('/');
        const fromRoot = href.replace(/^\.\//, '');
        const atRoot = !/^(\/|\.\.\/)/.test(href) && !index.known.has(rel) && !index.lower.has(rel.toLowerCase())
          && (index.known.has(fromRoot) || index.lower.has(fromRoot.toLowerCase()));
        if (atRoot) { abs = join(repo, fromRoot); rel = fromRoot; }
        const inside = rel && !rel.startsWith('../') && !isAbsolute(rel);
        if (inside && index.known.has(rel)) {
          cite(rel, false);
          if (anchor && /\.(md|mdx)$/i.test(rel)) {
            const theirs = anchorsOf(abs);
            if (!theirs.has(anchor)) {
              const near = nearAnchor(theirs, anchor);
              brokenLinks.push({ file: target.label, line: i + 1, kind: 'anchor', cited: `${to}#${fragment}`, suggestion: near ? `${to}#${near}` : null });
            }
          }
          continue;
        }
        if (inside) {
          const real = index.lower.get(rel.toLowerCase());
          if (real) {
            const fileDir = posix.dirname(relative(repo, target.path).split(sep).join('/'));
            const fixed = mdc ? `mdc:${real}` : atRoot ? real : posix.relative(fileDir, real);
            cite(rel, false);
            caseMismatch.push({ file: target.label, line: i + 1, kind: 'link', cited: to, actual: href === to ? fixed : fixed.split(' ').join('%20') });
            continue;
          }
        }
        if (existsSync(abs)) { if (inside) cite(rel, false); continue; }
        const bare = href.slice(href.lastIndexOf('/') + 1).replace(/\.mdx?$/i, '');
        const finding = {
          file: target.label,
          line: i + 1,
          kind: 'link',
          cited: to,
          suggestion: loose.get(bare.toLowerCase().replace(/[_-]/g, '')) || null,
        };
        if (inside) { cite(rel, true); relOf.set(finding, rel); }
        brokenLinks.push(finding);
      }
    });

    const runners = new Map();
    for (const c of unknownCommands.slice(opened.unknownCommands)) {
      const set = runners.get(c.name) || new Set();
      set.add(c.cited.split(' ')[0]);
      runners.set(c.name, set);
    }
    if ([...runners.values()].some((set) => set.size > 1)) {
      const kept = unknownCommands.slice(opened.unknownCommands).filter((c) => runners.get(c.name).size < 2);
      unknownCommands.splice(opened.unknownCommands, unknownCommands.length, ...kept);
    }

    if (!target.explicit && absentHere.size >= 4 && absentHere.size >= citedHere.size * 0.6) {
      elsewhere.push({ file: target.label, cited: citedHere.size, absent: absentHere.size });
      caseMismatch.splice(opened.caseMismatch);
      brokenLinks.splice(opened.brokenLinks);
      missingPaths.splice(opened.missingPaths);
      unknownCommands.splice(opened.unknownCommands);
    }
    for (const issue of frontmatterIssues(target.label, lines, index)) {
      configIssues.push(issue);
      if (issue.kind === 'glob' && !target.explicit) rulesElsewhere(posix.dirname(target.label)).absent++;
    }
    if (!target.explicit) { const rule = ruleGlobs(target.label, frontmatterOf(lines)); if (rule && rule.globs.length) rulesElsewhere(posix.dirname(target.label)).cited++; }
  }

  for (const [folder, count] of rulesFolders) {
    if (count.absent < 4 || count.absent < count.cited * 0.6) continue;
    const kept = configIssues.filter((c) => !(c.kind === 'glob' && posix.dirname(c.file) === folder));
    configIssues.length = 0;
    configIssues.push(...kept);
    elsewhere.push({ file: folder, cited: count.cited, absent: count.absent, unit: 'rules' });
  }

  if (autoRun) {
    for (const rel of CONFIG_FILES) {
      if (!index.known.has(rel) || excluded(rel) || (only && !only.paths.has(rel))) continue;
      const text = readTextFile(join(repo, rel));
      if (text === null) continue;
      configs++;
      configIssues.push(...configFileIssues(rel, text, repo, index, ignored, resolveOnce));
    }
  }

  for (const m of missingPaths) relOf.set(m, m.cited);
  const candidates = [...new Set(relOf.values())];
  const ignoredByGit = gitIgnored(repo, candidates);
  let gitignored = 0;
  const keep = (list) => list.filter((f) => {
    const rel = relOf.get(f);
    if (rel && ignoredByGit.has(rel)) { gitignored++; return false; }
    return true;
  });
  const missingKept = keep(missingPaths), linksKept = keep(brokenLinks);
  missingPaths.length = 0; missingPaths.push(...missingKept);
  brokenLinks.length = 0; brokenLinks.push(...linksKept);

  const indexFile = checked.find((t) => t.fromDir && /^MEMORY\.md$/i.test(t.label));
  if (indexFile) {
    const folder = dirname(indexFile.path);
    const body = readTextFile(indexFile.path) || '';
    for (const t of checked) {
      if (t === indexFile || !t.fromDir || dirname(t.path) !== folder || ignored(t.label)) continue;
      if (!body.includes(t.label) && !body.includes(t.label.replace(/\.md$/i, ''))) orphans.push(t.label);
    }
  }

  let baselined = 0, baselineStale = 0;
  if (baseline) {
    const left = new Map();
    for (const e of baseline.findings) if (e && typeof e.kind === 'string' && typeof e.file === 'string') left.set(keyOf(e.kind, e.file, e.cited ?? ''), Math.max(1, Number(e.count) || 1));
    const met = new Set();
    const held = (kind, file, cited) => {
      const k = keyOf(kind, file, cited);
      const n = left.get(k);
      if (!n) return false;
      left.set(k, n - 1);
      met.add(k);
      baselined++;
      return true;
    };
    const lists = { caseMismatch, brokenLinks, missingPaths, unknownCommands, configIssues };
    for (const [name, kind] of Object.entries(KIND_OF)) {
      const kept = lists[name].filter((o) => !held(kind, o.file, o.cited));
      lists[name].length = 0;
      lists[name].push(...kept);
    }
    const keptOrphans = orphans.filter((file) => !held('not-in-index', file, ''));
    orphans.length = 0;
    orphans.push(...keptOrphans);
    for (const k of left.keys()) if (!met.has(k)) baselineStale++;
  }

  const historian = makeHistorian(repo, index);
  for (const o of missingPaths) {
    const h = historian.of(o.cited, o.file);
    if (h) o.history = h;
  }
  for (const o of brokenLinks) {
    if (o.kind !== 'link' || !relOf.has(o)) continue;
    const h = historian.of(relOf.get(o), o.file, true);
    if (h) o.history = h;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    prumoVersion: VERSION,
    repo: resolve(repo),
    checkedAt: new Date().toISOString(),
    caseMismatch,
    brokenLinks,
    missingPaths,
    unknownCommands,
    configIssues,
    orphans,
    elsewhere,
    stats: { tracked: index.tracked.length, targets: checked.length, historical, suppressed, gitignored, untracked, configs, baselined, baselineStale, ...(only ? { only: only.label } : {}) },
  };
}
