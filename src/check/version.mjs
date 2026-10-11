/**
 * prumo — the version that runs and the version of the shape analyze() returns.
 */

import { createRequire } from 'node:module';

export const VERSION = createRequire(import.meta.url)('../../package.json').version;
/** Bumped when the shape of what analyze() returns changes in a way a consumer has to know about. */
export const SCHEMA_VERSION = 9;
