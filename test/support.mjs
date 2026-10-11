/**
 * prumo — what the test files share: the paths of the two programs, throwaway repositories that
 * are removed when the run ends, and the CLI run the way a pipe sees it.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyze, resolveTargets } from '../src/check.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = join(ROOT, 'bin', 'prumo.mjs');
export const SERVER = join(ROOT, 'bin', 'prumo-mcp.mjs');

/** Every run of git in a test has an identity, and never stops on a line ending it would convert. */
const GIT = 'git -c user.email=t@t -c user.name=t -c core.safecrlf=false';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

/** An empty folder under the system's temporary one, removed when the run ends. */
export function tempDir(prefix = 'prumo-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** Writes each file, creating the folders it sits in. */
export function write(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content ?? '');
  }
}

/** Runs a git command in `dir` and returns what it printed, trimmed. */
export function git(dir, cmd, env = {}) {
  return execSync(`${GIT} ${cmd}`, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, ...env } }).toString().trim();
}

/** The environment that dates a commit, for a test that needs history at known times. */
export const dated = (date) => (date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {});

/** Builds a throwaway git repository whose index holds exactly the given files, staged and not committed. */
export function repoWith(files) {
  const dir = tempDir();
  write(dir, files);
  git(dir, 'init -q');
  git(dir, 'add -A');
  return dir;
}

/** The same repository with the files committed, at `date` when one is given, for a test that reads the history. */
export function committedRepo(files, date = '') {
  const dir = repoWith(files);
  git(dir, 'commit -qm first', dated(date));
  return dir;
}

/** Builds a repository from the files and analyses it: the context files named, or the ones found on their own. */
export function checkFiles(files, explicit = []) {
  const repo = repoWith(files);
  return analyze({ repo, targets: resolveTargets(repo, explicit) });
}

/** Sends each message to the MCP server on its own line, as a client would, and returns the replies parsed, in order. */
export function talk(messages) {
  const input = messages.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('\n') + '\n';
  const { stdout, status } = spawnSync(process.execPath, [SERVER], { input, encoding: 'utf8' });
  if (status !== 0) throw new Error(`the MCP server exited with ${status}`);
  return stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * Runs the CLI and returns its exit status and both streams. The shell running the suite may
 * carry FORCE_COLOR, so every run starts from the plain report, with no banner.
 */
export function cli(args, { cwd, env = {} } = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '', NO_COLOR: '1', PRUMO_BANNER: '', ...env } });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
