import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { globToRegExp } from './config.mjs';
import { pathsInCode, TRANSIENT } from './paths.mjs';

export const CONFIG_FILES = ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json', '.claude/settings.json'];
const INSTALLED_SKILL = /(^|\/)skills\/[^/]+\/SKILL\.md$/i;
const HOST_SKILL = /(^|\/)\.(claude|agents)\/skills\//i;
const CURSOR_RULE = /(^|\/)\.cursor\/rules\/[^/]+\.mdc$/i;
const COPILOT_INSTRUCTION = /(^|\/)\.github\/instructions\/[^/]+\.md$/i;
const PROJECT_DIR_VAR = /\$\{?CLAUDE_PROJECT_DIR\}?\//g;

/**
 * The front matter of a note, read as flat fields: `key: value` lines and the list items under a
 * key, each with its line number. Enough for globs, names and descriptions, nothing nested.
 */
export function frontmatterOf(lines) {
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
    for (const p of index.tracked) for (const re of res) if (re && re.test(p)) return true;
  }
  return false;
}

/**
 * The globs a rule is attached by: `globs:` in a Cursor rule, `applyTo:` in a Copilot instruction,
 * unless `alwaysApply: true` makes them moot. Null when the file is not such a rule.
 */
export function ruleGlobs(label, lines) {
  const fm = frontmatterOf(lines);
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
export function frontmatterIssues(label, lines, index) {
  const x = { label, index, fm: frontmatterOf(lines), rule: ruleGlobs(label, lines) };
  return FRONTMATTER_PROBLEMS.filter((problem) => problem.when(x)).map((problem) => ({ file: label, ...problem.issue(x) }));
}

/** The globs of a rule as a report names them: all of them up to three, then how many more. */
const globsShown = (globs) => (globs.length > 3 ? `${globs.slice(0, 3).join(', ')} and ${globs.length - 3} more` : globs.join(', '));

const FRONTMATTER_PROBLEMS = [
  {
    when: (x) => INSTALLED_SKILL.test(x.label) && x.fm.size && (x.fm.has('name') || HOST_SKILL.test(x.label)) && !x.fm.get('description')?.value,
    issue: () => ({ line: 1, kind: 'skill-description', cited: 'description', message: 'missing from the front matter, so nothing says when to use the skill' }),
  },
  {
    when: (x) => INSTALLED_SKILL.test(x.label) && !x.fm.size && HOST_SKILL.test(x.label),
    issue: () => ({ line: 1, kind: 'skill-description', cited: 'front matter', message: 'missing, so the skill has no name and no description to be picked by' }),
  },
  {
    when: (x) => x.rule && x.rule.globs.length && !x.rule.globs.some((glob) => globMatchesAny(glob, x.index)),
    issue: (x) => ({ line: x.rule.line, kind: 'glob', cited: globsShown(x.rule.globs), message: `${x.rule.globs.length === 1 ? 'matches' : 'match'} no file in the repository, so the rule never applies` }),
  },
];

/** Every command a JSON configuration runs, with who runs it: each MCP server with its arguments, and each hook of each event. */
function commandsOf(json) {
  const servers = (json && typeof json === 'object' && (json.mcpServers || json.servers)) || {};
  const fromServers = Object.entries(servers)
    .filter(([, server]) => server && typeof server === 'object')
    .map(([name, server]) => ({ command: [server.command, ...(Array.isArray(server.args) ? server.args : [])].filter((s) => typeof s === 'string').join(' '), where: `by the MCP server "${name}"` }));
  const fromHooks = Object.entries((json && json.hooks) || {}).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : [])
    .flatMap((group) => (Array.isArray(group && group.hooks) ? group.hooks : []))
    .filter((hook) => hook && typeof hook.command === 'string')
    .map((hook) => ({ command: hook.command, where: `by the ${event} hook` })));
  return [...fromServers, ...fromHooks].filter((c) => c.command);
}

const CONFIG_PATH_PROBLEMS = [
  { when: (r) => r.state === 'case', message: (where, r) => `named ${where}; the repository has ${r.real}` },
  { when: (r, p, repo) => r.state === 'missing' && !existsSync(join(repo, p)), message: (where) => `named ${where}, not here` },
];

/**
 * The scripts an MCP server or a hook names in a JSON configuration, checked like a command in a
 * fenced block: each argument that reads as a path of this repository has to be here.
 */
export function configFileIssues(rel, text, repo, ignored, resolveOnce) {
  let json;
  try { json = JSON.parse(text); } catch { return []; }
  const lines = text.split(/\r?\n/);
  const lineOf = (needle) => { const i = lines.findIndex((l) => l.includes(needle)); return i < 0 ? 1 : i + 1; };
  return commandsOf(json).flatMap(({ command, where }) => pathsInCode(command.replace(PROJECT_DIR_VAR, ''))
    .filter(({ p, why }) => !why && !ignored(p) && !TRANSIENT.test(p))
    .flatMap(({ p }) => {
      const r = resolveOnce(p);
      const problem = CONFIG_PATH_PROBLEMS.find((c) => c.when(r, p, repo));
      return problem ? [{ file: rel, line: lineOf(p.slice(p.lastIndexOf('/') + 1)), kind: 'config-path', cited: p, message: problem.message(where, r) }] : [];
    }));
}
