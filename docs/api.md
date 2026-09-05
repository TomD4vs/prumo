# API and development

[← README](../README.md) · [Ler em português](api.pt-BR.md)

---

## Programmatic use

```js
import { analyze, resolveTargets } from '@tomd4vs/prumo';

const targets = resolveTargets('.', []);          // [] = auto-detect
const result  = analyze({ repo: '.', targets });

console.log(result.schemaVersion);  // 4, bumped when this shape changes
console.log(result.prumoVersion);   // the version that ran
console.log(result.repo);           // absolute path of the repository checked
console.log(result.checkedAt);      // when, as an ISO 8601 date
console.log(result.caseMismatch);   // [{ file, line, cited, actual, kind? }]
console.log(result.brokenLinks);    // [{ file, line, kind, cited, suggestion }]
console.log(result.missingPaths);   // [{ file, line, cited, excerpt }]
console.log(result.unknownCommands); // [{ file, line, cited, name, source, suggestion, excerpt }]
console.log(result.configIssues);   // [{ file, line, kind, cited, message }]
console.log(result.orphans);        // ['note-nobody-links-to.md']
console.log(result.elsewhere);      // [{ file, cited, absent, unit? }]
console.log(result.stats);          // { tracked, targets, historical, suppressed, gitignored, untracked, configs }
```

The first four fields identify the run. A consumer can tell a change of shape from a breakage, and a report about one repository from a report about another. `--format json`, `--json FILE` and the MCP server's structured content carry them too. A path cited on several lines is one finding per line. `schemaVersion` went from 1 to 2 when `unknownCommands` arrived, to 3 with `elsewhere`: the auto-detected files whose findings were held back because most of their cited paths start in folders the repository does not have, with the two counts, and to 4 with `configIssues`, whose `kind` is `glob`, `skill-description` or `config-path`, `stats.configs`, the JSON configuration files read, and `unit` on an `elsewhere` entry, present as `rules` when what was held back is a rules folder most of whose rules match nothing.

`kind` is `wikilink`, `link` or `anchor`, the last one a link to a heading the target page does not have. On a case mismatch it is present only when the path came from a markdown link, and then `actual` is relative to the file that holds the link, as the link itself is. In an unknown command, `cited` is the command as the note writes it, `name` the script or target it names, `source` the kind of file that should define it, and `suggestion` the same command with the closest defined name.

---

## Development

```bash
git clone https://github.com/TomD4vs/prumo.git
cd prumo
node --test          # every file under test/, no dependencies
node bin/prumo.mjs . # run it on itself
npm run simulate     # a new user follows the README against the packed tarball
```

The simulation packs the checkout the way `npm publish` would, installs the tarball into a throwaway project, and follows the README and these pages literally in one temporary git repository per scenario, comparing every output with what the documentation shows. It found bugs that the unit tests could not, because the tests exercise `analyze()` and the simulation exercises what the docs promise through the CLI. Run it before a publish, and again afterwards with `--registry` to test the published version. It also drives the MCP server over stdio.

Inside this repository, run `node bin/prumo.mjs` rather than `npx @tomd4vs/prumo`: npx finds the local `package.json` and looks for a binary that isn't installed here.

Each test builds a throwaway git repository, so the suite checks in no fixtures and leaves nothing behind. CI runs on Linux, Windows and macOS against Node 18, 20 and 22, since the case check behaves differently per platform.

### Things that cost time once

`node --test test/` fails under Git Bash on Windows: the path argument is mangled and Node tries to load a module literally named `test`. Run `node --test` with no argument and let it discover `**/*.test.mjs`, which is what `npm test` does.

Test the CLI from a directory other than the repository being checked. An off-by-one in the argument parsing once shipped and passed its first test by accident. Filtering flag values with `i !== jsonAt + 1` dropped `argv[0]` whenever `--json` was absent, because `jsonAt` was `-1`; the test passed only because the repository argument fell back to `.` while the shell happened to be in the right place. Running from inside the target hides exactly that kind of defect.

The social card is rendered, not drawn. `assets/social.html` is screenshotted headless at 1280×640:

```bash
msedge --headless=new --disable-gpu --no-first-run --user-data-dir=<tmp> \
  --window-size=1280,640 --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=6000 --screenshot=assets/social.png \
  "file:///<abs>/assets/social.html"
```

`--virtual-time-budget` is required; without it the shot lands before the web fonts load and the card renders in a fallback face.