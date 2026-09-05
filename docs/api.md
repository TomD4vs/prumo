# API and development

[← README](../README.md) · [Ler em português](api.pt-BR.md)

---

## Programmatic use

```js
import { analyze, resolveTargets, loadBaseline, changedFiles } from '@tomd4vs/prumo';

const targets = resolveTargets('.', []);          // [] = auto-detect
const result  = analyze({ repo: '.', targets });
// with the baseline at the root, and only the files staged for commit:
// analyze({ repo: '.', targets, baseline: loadBaseline('.'), only: { paths: changedFiles('.', { staged: true }), label: 'staged' } })

console.log(result.schemaVersion);  // 7, bumped when this shape changes
console.log(result.prumoVersion);   // the version that ran
console.log(result.repo);           // absolute path of the repository checked
console.log(result.checkedAt);      // when, as an ISO 8601 date
console.log(result.caseMismatch);   // [{ file, line, cited, actual, kind? }]
console.log(result.brokenLinks);    // [{ file, line, kind, cited, suggestion, history? }]
console.log(result.missingPaths);   // [{ file, line, cited, excerpt, history? }]
console.log(result.unknownCommands); // [{ file, line, cited, name, source, suggestion, excerpt }]
console.log(result.configIssues);   // [{ file, line, kind, cited, message }]
console.log(result.orphans);        // ['note-nobody-links-to.md']
console.log(result.elsewhere);      // [{ file, cited, absent, unit? }]
console.log(result.stats);          // { tracked, targets, historical, suppressed, gitignored, untracked, configs, baselined, baselineStale, only? }
```

The first four fields identify the run. A consumer can tell a change of shape from a breakage, and a report about one repository from a report about another. `--format json`, `--json FILE` and the MCP server's structured content carry them too. A path cited on several lines is one finding per line. `schemaVersion` went from 1 to 2 when `unknownCommands` arrived, to 3 with `elsewhere`: the auto-detected files whose findings were held back because most of their cited paths start in folders the repository does not have, with the two counts, and to 4 with `configIssues`, whose `kind` is `glob`, `skill-description` or `config-path`, `stats.configs`, the JSON configuration files read, and `unit` on an `elsewhere` entry, present as `rules` when what was held back is a rules folder most of whose rules match nothing; and to 5 with `stats.baselined`, the findings a baseline held back, `stats.baselineStale`, its entries that match nothing now, and `stats.only`, present as `staged` or `since REF` when the run was limited to what changed; and to 6 with `history` on a missing path or a markdown link, `{ event, to?, commit, date, when }`, where `event` is `renamed`, with `to` the name that exists now, or `deleted`, `commit` is the short hash, `date` ISO 8601 and `when` the age in words; and to 7 with `from` on that `history`, the path git was asked about, which is the cited path from the root or from beside the note.

`renameFixes(result)` lists the rewrites a result allows, one per missing path or markdown link with a rename in its history, and `applyFixes(changes, targets)` applies them, or case mismatches, in place; `applyCaseFixes` is the older name of the same function. Each change carries `why`, `case` or `rename`, and a rename its `commit`.

`loadBaseline(repo)` reads `.prumo-baseline.json` from the repository root, or returns null; `baselineOf(result)` builds the object `--baseline` writes; `changedFiles(repo, { staged: true })` or `changedFiles(repo, { since: REF })` is the set of paths that `only` takes, beside a `label` for the header; and `BASELINE_FILE` is the file name.

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