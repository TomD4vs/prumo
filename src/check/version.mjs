import { createRequire } from 'node:module';

export const VERSION = createRequire(import.meta.url)('../../package.json').version;
export const SCHEMA_VERSION = 11;
