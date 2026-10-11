import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readTextFile } from './repository.mjs';
import { VERSION } from './version.mjs';

export const BASELINE_FILE = '.prumo-baseline.json';

const KIND_OF = { caseMismatch: 'case-mismatch', brokenLinks: 'broken-link', missingPaths: 'missing-path', unknownCommands: 'unknown-command', configIssues: 'agent-config' };

/** The identity of a finding across runs: its kind, its file and what it cites. Line numbers move, so they are left out. */
const keyOf = (kind, file, cited) => `${kind}\0${file}\0${cited}`;

/** Keeps in `list`, in place, only what `keep` accepts. */
export function retain(list, keep) {
  const kept = list.filter(keep);
  list.length = 0;
  list.push(...kept);
}

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

/**
 * Removes from the lists, in place, every finding the baseline records, as many times as it counts
 * it. Returns how many were held back and how many entries of the baseline matched nothing.
 */
export function holdBack(findings, baseline) {
  const left = new Map();
  for (const e of baseline.findings) if (e && typeof e.kind === 'string' && typeof e.file === 'string') left.set(keyOf(e.kind, e.file, e.cited ?? ''), Math.max(1, Number(e.count) || 1));
  const met = new Set();
  let baselined = 0, baselineStale = 0;
  const held = (kind, file, cited) => {
    const k = keyOf(kind, file, cited);
    const n = left.get(k);
    if (!n) return false;
    left.set(k, n - 1);
    met.add(k);
    baselined++;
    return true;
  };
  for (const [name, kind] of Object.entries(KIND_OF)) retain(findings[name], (o) => !held(kind, o.file, o.cited));
  retain(findings.orphans, (file) => !held('not-in-index', file, ''));
  for (const k of left.keys()) if (!met.has(k)) baselineStale++;
  return { baselined, baselineStale };
}
