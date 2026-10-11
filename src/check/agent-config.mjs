/**
 * prumo — the agent configuration check: a rule none of whose globs reaches a file, a skill with
 * no description, and an MCP server or a hook naming a script that is not here.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { globToRegExp } from './config.mjs';
import { pathsInCode, TRANSIENT } from './paths.mjs';

/** Agent configuration read as data rather than as prose: MCP servers and hooks name scripts that have to be here. */
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
  const issues = [];
  const fm = frontmatterOf(lines);
  const at = (line, kind, cited, message) => issues.push({ file: label, line, kind, cited, message });
  if (INSTALLED_SKILL.test(label)) {
    const description = fm.get('description');
    const standard = fm.has('name') || HOST_SKILL.test(label);
    if (fm.size && standard && !(description && description.value)) at(1, 'skill-description', 'description', 'missing from the front matter, so nothing says when to use the skill');
    if (!fm.size && HOST_SKILL.test(label)) at(1, 'skill-description', 'front matter', 'missing, so the skill has no name and no description to be picked by');
  }
  const rule = ruleGlobs(label, lines);
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
export function configFileIssues(rel, text, repo, ignored, resolveOnce) {
  const issues = [];
  let json;
  try { json = JSON.parse(text); } catch { return issues; }
  const lines = text.split(/\r?\n/);
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
