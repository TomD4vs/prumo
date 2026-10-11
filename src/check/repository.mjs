/**
 * prumo — what is read from the repository besides the index: a file's text, what a commit or a
 * branch changed, what `.gitignore` covers, and where the repository pushes to.
 */

import { readFileSync, statSync } from 'node:fs';
import { execSync, execFileSync } from 'node:child_process';

export function readTextFile(path) {
  try {
    if (statSync(path).size > 2_000_000) return null;
    return readFileSync(path, 'utf8').replace(/^﻿/, '');
  } catch {
    return null;
  }
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

/**
 * Asks git which of these paths .gitignore covers. A path ignored on purpose is
 * expected to be absent from the index and often from this machine, so its
 * absence says nothing about the note. Returns the subset that is ignored.
 */
export function gitIgnored(repo, paths) {
  if (!paths.length) return new Set();
  const parse = (buf) => new Set(String(buf || '').split('\0').map((s) => s.trim()).filter(Boolean));
  try {
    return parse(execSync('git check-ignore --stdin -z', { cwd: repo, input: paths.join('\0') + '\0', stdio: ['pipe', 'pipe', 'ignore'] }));
  } catch (err) {
    return parse(err.stdout);
  }
}

/** The `owner/name` this repository pushes to, so a link naming a different one can be told apart. */
export function originRepo(repo) {
  try {
    const url = execSync('git remote get-url origin', { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const m = url.match(/(?:github|gitlab)\.com[:/]([\w.-]+\/[\w.-]+)/i);
    return m ? m[1].replace(/\.git$/, '').toLowerCase() : '';
  } catch { return ''; }
}
