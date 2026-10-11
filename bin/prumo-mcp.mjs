#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { analyze, resolveTargets, loadConfig, loadBaseline, hasRootSkill } from '../src/check.mjs';
import { applyFixes, renameFixes } from '../src/fix.mjs';
import { renderText, renderDrift, renderBudget, renderCoverage } from '../src/report.mjs';
import { drift } from '../src/drift.mjs';
import { budget } from '../src/budget.mjs';
import { coverage } from '../src/coverage.mjs';

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
      'Checks the context files a coding agent reads (CLAUDE.md, AGENTS.md, SKILL.md, .cursor/rules and the rest) against the git index of a repository. Reports paths whose letter case disagrees with git, broken [[wikilinks]], markdown links, heading anchors and @ imports of a CLAUDE.md, paths that no longer exist, commands naming a script or target no package.json, Makefile or composer.json defines, agent configuration that points at nothing (a rule whose globs match no file, a skill without a description, an MCP server or a hook naming a missing script), and notes an index never mentions. Findings recorded in a .prumo-baseline.json at the repository root are held back and counted in stats.baselined. Nothing is written.',
    inputSchema: {
      type: 'object',
      properties: { repo: REPO_ARG, targets: TARGETS_ARG },
    },
    annotations: { title: 'prumo check', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'prumo_fix',
    description:
      'Rewrites case mismatches in place to the spelling the git index holds, and a missing path, a markdown link or an @ import to the name git recorded when it renamed the file, then reports what remains. Nothing else is touched: a link suggested from a name, a missing path with no history and a deleted file are never edited.',
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
      'Reports what the context files cost the agent: bytes, lines, words and an estimate of tokens at four characters each, and when each is read, at every session with the files a CLAUDE.md imports, or only when used, as a skill, the note of a folder or a scoped rule is, the cost at every session first; how much each grew since an earlier commit, the one thirty days ago unless `since` names another; and the paragraphs of twelve words or more written in two places. It measures and counts; nothing here is a finding. Nothing is written.',
    inputSchema: {
      type: 'object',
      properties: { repo: REPO_ARG, targets: TARGETS_ARG, since: { type: 'string', description: 'The commit or branch to compare sizes with. Omit for the commit thirty days ago, or the first commit of a younger repository.' } },
    },
    annotations: { title: 'prumo budget', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'prumo_coverage',
    description:
      'Reports the folders of the code that no context file mentions: every top-level folder, or every package of a workspace, that no context file cites a path in and that holds no context file of its own, with the files git tracks in it, its commits in the last ninety days and its last commit, the most active first. It is what the agent is never told about, never a finding: a folder may be left out of the notes on purpose. Nothing is written.',
    inputSchema: {
      type: 'object',
      properties: { repo: REPO_ARG, targets: TARGETS_ARG },
    },
    annotations: { title: 'prumo coverage', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

/** The context files a tool call runs on: the ones named, the ones `.prumorc.json` lists, or the ones found; none is an error for the agent. */
function contextOf({ repo = '.', targets: explicit = [] }) {
  try { execSync('git rev-parse --is-inside-work-tree', { cwd: repo, stdio: 'ignore' }); } catch { throw new Error(`not a git repository: ${repo}`); }
  const config = loadConfig(repo);
  const targets = resolveTargets(repo, explicit.length ? explicit : (config.targets || []));
  if (targets.length) return { repo, config, targets };
  throw new Error(hasRootSkill(repo)
    ? 'no context files found. This repository has a SKILL.md at the root, which is not detected automatically because at the root that name is usually a template. Pass targets ["SKILL.md"] to check it.'
    : 'no context files found. Pass targets, or create a CLAUDE.md / AGENTS.md.');
}

/** The check with the baseline at the root, and with `fix`, the case mismatches and the renames git recorded rewritten first. */
function checked({ repo, config, targets }, fix) {
  const baseline = loadBaseline(repo);
  const result = analyze({ repo, targets, config, baseline });
  const changes = fix ? [...result.caseMismatch, ...renameFixes(result)] : [];
  const fixed = changes.length ? applyFixes(changes, targets) : null;
  return { result: fixed ? analyze({ repo, targets, config, baseline }) : result, fixed };
}

const RUNS = new Map([
  ['prumo_check', (ctx) => checked(ctx, false)],
  ['prumo_fix', (ctx) => checked(ctx, true)],
  ['prumo_drift', ({ repo, targets, config }) => ({ result: drift({ repo, targets, config }), fixed: null })],
  ['prumo_budget', ({ repo, targets, config, since }) => ({ result: budget({ repo, targets, config, since: String(since || '') }), fixed: null })],
  ['prumo_coverage', ({ repo, targets, config }) => ({ result: coverage({ repo, targets, config }), fixed: null })],
]);

const REPORT_TEXT = { drift: renderDrift, budget: renderBudget, coverage: renderCoverage };

/** What a tool call answers: a report as its text and its result, the check as its text with the total and what a fix did. */
function toolContent({ result, fixed }) {
  const render = REPORT_TEXT[result.command];
  if (render) return { content: [{ type: 'text', text: render(result, { all: true }) }], structuredContent: result, isError: false };
  const total = ['caseMismatch', 'brokenLinks', 'missingPaths', 'unknownCommands', 'configIssues', 'orphans'].reduce((n, k) => n + result[k].length, 0);
  return { content: [{ type: 'text', text: renderText(result, { all: true, fixed }) }], structuredContent: { ...result, fixed, total }, isError: false };
}

/** Runs one tool call; an error is an answer the agent reads, with the message prumo would print. */
function callTool(name, args) {
  try { return toolContent(RUNS.get(name)({ ...contextOf(args), since: args.since })); } catch (err) { return { content: [{ type: 'text', text: `prumo: ${err.message}` }], isError: true }; }
}

const METHODS = {
  initialize: () => ({
    protocolVersion: PROTOCOL,
    capabilities: { tools: {} },
    serverInfo: { name: 'prumo', version: VERSION },
    instructions: 'Call prumo_check on a repository to learn which paths and links in its context files are stale. Call prumo_fix to correct letter case and the renames git recorded; everything else is for you to edit by hand. Call prumo_drift to learn which sections describe code that changed since they were written, prumo_budget to learn what each context file costs and what is written twice, and prumo_coverage to learn which folders of the code no context file mentions.',
  }),
  ping: () => ({}),
  'tools/list': () => ({ tools: TOOLS }),
  'tools/call': ({ name, arguments: args }) => (RUNS.has(name) ? callTool(name, args || {}) : { error: { code: -32602, message: `unknown tool: ${name}` } }),
};

/** Answers one JSON-RPC message: a method's result, an error, or nothing for a notification it does not know. */
function handle({ id, method, params = {} }) {
  const answer = Object.hasOwn(METHODS, method) ? METHODS[method](params) : id === undefined ? null : { error: { code: -32601, message: `method not found: ${method}` } };
  if (!answer) return null;
  return answer.error ? { jsonrpc: '2.0', id, error: answer.error } : { jsonrpc: '2.0', id, result: answer };
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
