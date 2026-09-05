import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { banner, wantsBanner, wantsColor } from '../src/banner.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'prumo.mjs');
const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const strip = (s) => s.replace(/\[[0-9;]*m/g, '');

test('the banner is eight lines: the name, a rule as wide as it, the version and the tagline', () => {
  const lines = banner('0.5.0').split('\n');
  assert.equal(lines.length, 8);
  const width = Math.max(...lines.slice(0, 6).map((l) => l.length));
  assert.equal(lines[6], '━'.repeat(width));
  assert.equal(lines[7], '0.5.0  is your documentation still true?');
  for (const l of lines.slice(0, 6)) assert.match(l, /^[█╗╔╝╚═║ ]+$/, 'the name is drawn in block and box characters only');
  assert.doesNotMatch(banner('0.5.0'), //, 'no escape code without colour');
});

test('the GitHub page is signed on the right, under the tagline, as wide as the rule, and painted as a link', () => {
  const lines = banner('0.5.0', { github: 'TomD4vs' }).split('\n');
  assert.equal(lines.length, 9);
  assert.equal(lines[8], 'github.com/TomD4vs'.padStart(lines[6].length));
  const painted = banner('0.5.0', { github: 'TomD4vs', color: true });
  assert.match(painted, /\x1b\[4;38;5;79mgithub\.com\/TomD4vs\x1b\[0m$/);
  assert.equal(strip(painted), banner('0.5.0', { github: 'TomD4vs' }));
});

test('with colour, the text under the escape codes is the same banner', () => {
  const coloured = banner('0.5.0', { color: true });
  assert.match(coloured, /\[1;97m/);
  assert.match(coloured, /\[38;5;79m━/);
  assert.equal(strip(coloured), banner('0.5.0'));
});

test('the banner wants a terminal, and PRUMO_BANNER overrides it either way', () => {
  assert.equal(wantsBanner({}, { isTTY: true }), true);
  assert.equal(wantsBanner({}, { isTTY: false }), false);
  assert.equal(wantsBanner({ PRUMO_BANNER: '1' }, { isTTY: false }), true);
  assert.equal(wantsBanner({ PRUMO_BANNER: '0' }, { isTTY: true }), false);
});

test('colour wants a terminal too, FORCE_COLOR turns it on and NO_COLOR wins', () => {
  assert.equal(wantsColor({}, { isTTY: true }), true);
  assert.equal(wantsColor({}, { isTTY: false }), false);
  assert.equal(wantsColor({ FORCE_COLOR: '1' }, { isTTY: false }), true);
  assert.equal(wantsColor({ NO_COLOR: '1', FORCE_COLOR: '1' }, { isTTY: true }), false);
});

test('piped output opens with the header line, and only PRUMO_BANNER=1 puts the banner above it', () => {
  const repo = mkdtempSync(join(tmpdir(), 'prumo-banner-'));
  made.push(repo);
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'CLAUDE.md'), 'See `src/index.ts`.\n');
  writeFileSync(join(repo, 'src/index.ts'), '');
  execSync('git init -q && git add -A', { cwd: repo, stdio: 'ignore' });
  const run = (env) => execSync('node ' + JSON.stringify(BIN) + ' .', { cwd: repo, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'ignore'] }).toString();

  const plain = run({ PRUMO_BANNER: '' });
  assert.match(plain, /^prumo — 1 context file, 2 files in the git index\n/);
  assert.doesNotMatch(plain, /█/);

  const shown = run({ PRUMO_BANNER: '1', NO_COLOR: '1' });
  assert.match(shown, /^██████╗ /);
  assert.match(shown, /━\n\d+\.\d+\.\d+  is your documentation still true\?\n +github\.com\/TomD4vs\n\nprumo — 1 context file/);
  assert.doesNotMatch(shown, //, 'NO_COLOR keeps the banner and drops the colour');
});
