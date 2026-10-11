/**
 * prumo — the analysis. Five checks, chosen by measured precision: case mismatch against the git
 * index, broken links, missing paths, commands naming a script or target nothing defines, and
 * agent configuration that points at nothing. Each lives in its own module under `src/check/`;
 * this file is what the CLI, the MCP server and the package import.
 */

export { VERSION, SCHEMA_VERSION } from './check/version.mjs';
export { DEFAULT_TARGETS, DEFAULT_DIRS, NESTED, resolveTargets } from './check/targets.mjs';
export { makeMatcher, loadConfig } from './check/config.mjs';
export { BASELINE_FILE, loadBaseline, baselineOf } from './check/baseline.mjs';
export { ageOf } from './check/history.mjs';
export { changedFiles, readTextFile } from './check/repository.mjs';
export { hasRootSkill } from './check/git-index.mjs';
export { classifyLines } from './check/lines.mjs';
export { analyze } from './check/analyze.mjs';
