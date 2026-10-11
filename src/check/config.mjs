/**
 * prumo — `.prumorc.json` and the glob matching its lists use.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Turns a glob (`*`, `**`, `?`) into an anchored regular expression, or null when the engine
 * refuses it as too large: a glob no path can match, which must not stop the run over the others.
 * The engine compiles a pattern on its first match, so that is where the refusal comes from.
 */
export function globToRegExp(glob) {
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
  try {
    const re = new RegExp(`^${out}$`, 'i');
    re.test('');
    return re;
  } catch { return null; }
}

/** Builds the test for one config list. A pattern with no wildcard that names a folder
 *  covers everything under it, so `public/dist` reaches `public/dist/app.js`. */
export function makeMatcher(patterns = []) {
  const res = patterns.map(globToRegExp).filter(Boolean);
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
