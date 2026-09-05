import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'prumo-mcp.mjs');
const made = [];

/** Builds a throwaway git repository whose index holds exactly the given files. */
function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'prumo-mcp-'));
  made.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content ?? '');
  }
  execSync('git init -q', { cwd: dir, stdio: 'ignore' });
  execSync('git add -A', { cwd: dir, stdio: 'ignore' });
  return dir;
}

process.on('exit', () => {
  for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
});

/** Sends each message on its own line, as a client would, and returns the replies parsed, in order. */
function talk(messages) {
  const input = messages.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('\n') + '\n';
  const { stdout, status } = spawnSync(process.execPath, [SERVER], { input, encoding: 'utf8' });
  assert.equal(status, 0);
  return stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('initialize answers with the protocol version, the server name and the package version', () => {
  const version = JSON.parse(readFileSync(join(dirname(SERVER), '..', 'package.json'), 'utf8')).version;
  const [r] = talk([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }]);
  assert.equal(r.id, 1);
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.deepEqual(r.result.serverInfo, { name: 'prumo', version });
  assert.deepEqual(r.result.capabilities, { tools: {} });
});

test('tools/list offers prumo_check, prumo_drift and prumo_budget as read only and prumo_fix as a writer', () => {
  const [r] = talk([{ jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  const byName = Object.fromEntries(r.result.tools.map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(byName).sort(), ['prumo_budget', 'prumo_check', 'prumo_drift', 'prumo_fix']);
  assert.equal(byName.prumo_check.annotations.readOnlyHint, true);
  assert.equal(byName.prumo_drift.annotations.readOnlyHint, true);
  assert.equal(byName.prumo_budget.annotations.readOnlyHint, true);
  assert.equal(byName.prumo_fix.annotations.readOnlyHint, false);
  assert.equal(byName.prumo_budget.inputSchema.properties.since.type, 'string');
  for (const t of r.result.tools) assert.equal(t.inputSchema.type, 'object');
});

test('prumo_drift and prumo_budget return their reports as text and as structured content', () => {
  const repo = repoWith({ 'CLAUDE.md': '# app\n\n## Layout\n\nSee `src/app.js`.\n', 'src/app.js': '' });
  execSync('git -c user.email=t@t -c user.name=t commit -qm first', { cwd: repo, stdio: 'ignore' });
  const [d, b] = talk([
    { jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name: 'prumo_drift', arguments: { repo } } },
    { jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'prumo_budget', arguments: { repo, since: 'HEAD' } } },
  ]);
  assert.equal(d.result.isError, false);
  assert.match(d.result.content[0].text, /^prumo — drift, 1 context file, 2 sections, 1 cited file/);
  assert.equal(d.result.structuredContent.command, 'drift');
  assert.deepEqual(d.result.structuredContent.sections.map((s) => [s.section, s.cited, s.commits, s.age]), [['Layout', 1, 0, 'today']]);
  assert.equal(d.result.structuredContent.stats.quiet, 1, 'the title section cites nothing');
  assert.equal(b.result.isError, false);
  assert.match(b.result.content[0].text, /^prumo — budget, 1 context file, \d+ tokens at four characters each\n        since HEAD, /);
  assert.equal(b.result.structuredContent.command, 'budget');
  assert.equal(b.result.structuredContent.files[0].state, 'unchanged');
});

test('prumo_check returns the text report and the findings as structured content', () => {
  const repo = repoWith({ 'CLAUDE.md': 'See `layouts/App.vue` and [[gone-note]].\n', 'resources/js/Layouts/App.vue': '' });
  const [r] = talk([{ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'prumo_check', arguments: { repo } } }]);
  assert.equal(r.result.isError, false);
  assert.match(r.result.content[0].text, /^prumo — 1 context file, 2 files in the git index/);
  assert.match(r.result.content[0].text, /2 to review$/);
  const s = r.result.structuredContent;
  assert.equal(s.total, 2);
  assert.equal(s.fixed, null);
  assert.equal(s.caseMismatch[0].cited, 'layouts/App.vue');
  assert.equal(s.brokenLinks[0].cited, 'gone-note');
  assert.equal(s.schemaVersion, 9);
  assert.equal(typeof s.prumoVersion, 'string');
});

test('prumo_fix rewrites the case, then reports what remains', () => {
  const repo = repoWith({ 'CLAUDE.md': 'See `layouts/App.vue` and `config/gone.php`.\n', 'resources/js/Layouts/App.vue': '' });
  const [r] = talk([{ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'prumo_fix', arguments: { repo } } }]);
  assert.equal(r.result.isError, false);
  assert.equal(r.result.structuredContent.fixed.paths, 1);
  assert.equal(r.result.structuredContent.caseMismatch.length, 0);
  assert.equal(r.result.structuredContent.missingPaths.length, 1);
  assert.match(readFileSync(join(repo, 'CLAUDE.md'), 'utf8'), /`resources\/js\/Layouts\/App\.vue`/);
});

test('errors follow JSON-RPC: unknown tool, unknown method, a line that is not JSON, a target that does not exist, a folder that is no repository', () => {
  const repo = repoWith({ 'CLAUDE.md': '# x\n' });
  const replies = talk([
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'prumo_nope', arguments: {} } },
    { jsonrpc: '2.0', id: 6, method: 'nothing/here' },
    '{ not json',
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'prumo_check', arguments: { repo, targets: ['no-such-file.md'] } } },
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'prumo_check', arguments: { repo: join(repo, 'no-such-dir') } } },
  ]);
  assert.deepEqual(replies.map((r) => r.id), [5, 6, null, 7, 8]);
  assert.equal(replies[0].error.code, -32602);
  assert.equal(replies[1].error.code, -32601);
  assert.equal(replies[2].error.code, -32700);
  assert.equal(replies[3].result.isError, true);
  assert.match(replies[3].result.content[0].text, /target not found: no-such-file\.md/);
  assert.equal(replies[4].result.isError, true);
  assert.match(replies[4].result.content[0].text, /not a git repository/);
});

test('a notification, which carries no id, gets no reply, and ping gets an empty one', () => {
  const replies = talk([
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 9, method: 'ping' },
  ]);
  assert.deepEqual(replies, [{ jsonrpc: '2.0', id: 9, result: {} }]);
});
