#!/usr/bin/env node
/**
 * prumo — MCP server over stdio, so an agent can ask for a check as a tool call.
 * Four tools: prumo_check (read only), prumo_fix (rewrites case mismatches and the renames git recorded),
 * and the two reports, prumo_drift and prumo_budget (read only).
 * JSON-RPC 2.0, one message per line, no dependencies.
 */

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { analyze, resolveTargets, loadConfig, loadBaseline, hasRootSkill } from '../src/check.mjs';
import { applyFixes, renameFixes } from '../src/fix.mjs';
import { renderText, renderDrift, renderBudget } from '../src/report.mjs';
import { drift } from '../src/drift.mjs';
import { budget } from '../src/budget.mjs';

const VERSION = createRequire(import.meta.url)('../package.json').version;
const PROTOCOL = '2025-06-18';

const REPO_ARG = {
  type: 'string',
  description: 'Path to the git repository. Defaults to the current working directory of the server.',
};
const TARGETS_ARG = {
  type: 'array',
  items: { type: 'string' },
  description: 'Markdown files or folders to check, relative to the repository. Omit to auto-detect CLAUDE.md, AGENTS.md, installed SKILL.md files and the rest.',
};

const TOOLS = [
  {
    name: 'prumo_check',
    description:
      'Checks the context files a coding agent reads (CLAUDE.md, AGENTS.md, SKILL.md, .cursor/rules and the rest) against the git index of a repository. Reports paths whose letter case disagrees with git, broken [[wikilinks]], markdown links and heading anchors, paths that no longer exist, commands naming a script or target no package.json, Makefile or composer.json defines, agent configuration that points at nothing (a rule whose globs match no file, a skill without a description, an MCP server or a hook naming a missing script), and notes an index never mentions. Findings recorded in a .prumo-baseline.json at the repository root are held back and counted in stats.baselined. Nothing is written.',
    inputSchema: {
      type: 'object',
      properties: { repo: REPO_ARG, targets: TARGETS_ARG },
    },
    annotations: { title: 'prumo check', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'prumo_fix',
    description:
      'Rewrites case mismatches in place to the spelling the git index holds, and a missing path or a markdown link to the name git recorded when it renamed the file, then reports what remains. Nothing else is touched: a link suggested from a name, a missing path with no history and a deleted file are never edited.',
    inputSchema: {
      type: 'object',
      properties: { repo: REPO_ARG, targets: TARGETS_ARG },
    },
    annotations: { title: 'prumo fix', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'prumo_drift',
    description:
      'Reports which sections of the context files describe code that changed after the section was last written: for every section that cites a file or a folder the repository has, when the section last changed according to git blame, how many of the files it cites changed since, and how many commits touched them. Sections come back ordered, the most moved first. It is a reading order for a review, never a finding: a section whose files changed may still be right. Nothing is written.',
    inputSchema: {
      type: 'object',
      properties: { repo: REPO_ARG, targets: TARGETS_ARG },
    },
    annotations: { title: 'prumo drift', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'prumo_budget',
    description:
      'Reports what each context file costs the agent that reads it at every session: bytes, lines, words and an estimate of tokens at four characters each, largest first; how much each grew since an earlier commit, the one thirty days ago unless `since` names another; and the paragraphs of twelve words or more written in two places. It measures and counts; nothing here is a finding. Nothing is written.',
    inputSchema: {
      type: 'object',
      properties: { repo: REPO_ARG, targets: TARGETS_ARG, since: { type: 'string', description: 'The commit or branch to compare sizes with. Omit for the commit thirty days ago, or the first commit of a younger repository.' } },
    },
    annotations: { title: 'prumo budget', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

/** Runs one check, one fix or one report; throws with a message meant for the agent. */
function run(name, { repo = '.', targets: explicit = [], since = '' } = {}) {
  try { execSync('git rev-parse --is-inside-work-tree', { cwd: repo, stdio: 'ignore' }); }
  catch { throw new Error(`not a git repository: ${repo}`); }
  const config = loadConfig(repo);
  const wanted = explicit.length ? explicit : (config.targets || []);
  const targets = resolveTargets(repo, wanted);
  if (!targets.length) throw new Error(hasRootSkill(repo)
    ? 'no context files found. This repository has a SKILL.md at the root, which is not detected automatically because at the root that name is usually a template. Pass targets ["SKILL.md"] to check it.'
    : 'no context files found. Pass targets, or create a CLAUDE.md / AGENTS.md.');

  if (name === 'prumo_drift') return { result: drift({ repo, targets, config }), fixed: null };
  if (name === 'prumo_budget') return { result: budget({ repo, targets, config, since: String(since || '') }), fixed: null };

  const baseline = loadBaseline(repo);
  let result = analyze({ repo, targets, config, baseline });
  let fixed = null;
  if (name === 'prumo_fix') {
    const changes = [...result.caseMismatch, ...renameFixes(result)];
    if (changes.length) {
      fixed = applyFixes(changes, targets);
      result = analyze({ repo, targets, config, baseline });
    }
  }
  return { result, fixed };
}

function handle(msg) {
  const { id, method, params = {} } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'prumo', version: VERSION },
        instructions: 'Call prumo_check on a repository to learn which paths and links in its context files are stale. Call prumo_fix to correct letter case and the renames git recorded; everything else is for you to edit by hand. Call prumo_drift to learn which sections describe code that changed since they were written, and prumo_budget to learn what each context file costs and what is written twice.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const { name, arguments: args } = params;
      if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `unknown tool: ${name}`);
      try {
        const { result, fixed } = run(name, args || {});
        if (result.command !== 'check') {
          const render = result.command === 'drift' ? renderDrift : renderBudget;
          return reply({ content: [{ type: 'text', text: render(result, { all: true }) }], structuredContent: result, isError: false });
        }
        const total = result.caseMismatch.length + result.brokenLinks.length + result.missingPaths.length + result.unknownCommands.length + result.configIssues.length + result.orphans.length;
        return reply({
          content: [{ type: 'text', text: renderText(result, { all: true, fixed }) }],
          structuredContent: { ...result, fixed, total },
          isError: false,
        });
      } catch (err) {
        return reply({ content: [{ type: 'text', text: `prumo: ${err.message}` }], isError: true });
      }
    }
    default:
      if (id === undefined) return null;
      return fail(-32601, `method not found: ${method}`);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); continue; }
    const out = handle(msg);
    if (out) process.stdout.write(JSON.stringify(out) + '\n');
  }
});
process.stdin.on('end', () => process.exit(0));
