/**
 * prumo — which files are context files: the ones named on the command line, or the ones every
 * agent we know reads, found on their own.
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, isAbsolute } from 'node:path';
import { trackedFiles } from './git-index.mjs';
import { TRANSIENT } from './paths.mjs';

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

export const NESTED = new Set(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'AGENT.md', 'GEMINI.md', 'COPILOT.md', 'SKILL.md']);

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
