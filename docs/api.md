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

console.log(result.schemaVersion);  // 9, bumped when this shape changes
console.log(result.prumoVersion);   // the version that ran
console.log(result.repo);           // absolute path of the repository checked
console.log(result.checkedAt);      // when, as an ISO 8601 date
console.log(result.command);        // 'check'; the two reports say 'drift' and 'budget'
console.log(result.caseMismatch);   // [{ file, line, cited, actual, kind? }]
console.log(result.brokenLinks);    // [{ file, line, kind, cited, suggestion, history? }]
console.log(result.missingPaths);   // [{ file, line, cited, excerpt, history? }]
console.log(result.unknownCommands); // [{ file, line, cited, name, source, suggestion, excerpt }]
console.log(result.configIssues);   // [{ file, line, kind, cited, message }]
console.log(result.orphans);        // ['note-nobody-links-to.md']
console.log(result.elsewhere);      // [{ file, cited, absent, unit? }], file "." for the repository as a whole
console.log(result.stats);          // { tracked, targets, historical, suppressed, gitignored, untracked, configs, baselined, baselineStale, cited, absent, only? }
```

The first four fields identify the run. A consumer can tell a change of shape from a breakage, and a report about one repository from a report about another. `--format json`, `--json FILE` and the MCP server's structured content carry them too. A path cited on several lines is one finding per line. `schemaVersion` went from 1 to 2 when `unknownCommands` arrived, to 3 with `elsewhere`: the auto-detected files whose findings were held back because most of their cited paths start in folders the repository does not have, with the two counts, and to 4 with `configIssues`, whose `kind` is `glob`, `skill-description` or `config-path`, `stats.configs`, the JSON configuration files read, and `unit` on an `elsewhere` entry, present as `rules` when what was held back is a rules folder most of whose rules match nothing; and to 5 with `stats.baselined`, the findings a baseline held back, `stats.baselineStale`, its entries that match nothing now, and `stats.only`, present as `staged` or `since REF` when the run was limited to what changed; and to 6 with `history` on a missing path or a markdown link, `{ event, to?, commit, date, when }`, where `event` is `renamed`, with `to` the name that exists now, or `deleted`, `commit` is the short hash, `date` ISO 8601 and `when` the age in words; and to 7 with `from` on that `history`, the path git was asked about, which is the cited path from the root or from beside the note; and to 8 with `stats.cited` and `stats.absent`, the distinct paths the auto-detected files cite and the ones among them whose folder is absent, pooled over the repository, which is what the repository-level gate reads, and with `elsewhere` naming `.` when that gate held the whole repository back; and to 9 with `command`, `check` on this result and `drift` or `budget` on the two reports, which share the version number and the first four fields.

```js
import { drift, budget } from '@tomd4vs/prumo';

const d = drift({ repo: '.', targets });   // the same first four fields, then command: 'drift'
console.log(d.sections);                   // [{ file, line, section, since, age, cited, changed, commits }], most moved first
console.log(d.stats);                      // { targets, sections, cited, quiet, uncommitted }

const b = budget({ repo: '.', targets, since: 'v1.0.0' });   // since is optional
console.log(b.files);                      // [{ file, bytes, lines, words, tokens, before, delta, state }], largest first
console.log(b.repeated);                   // [{ words, at: [{ file, line }, ...] }]
console.log(b.stats);                      // { targets, tokens, before, since: { ref, date } | null, repeated: { paragraphs, copies, words } }
```

In a drift section, `since` is the date of the newest commit among its lines and `age` that date in words, or `not committed`; `cited`, `changed` and `commits` are the files it cites that the repository has, how many of them changed after that date, and the distinct commits that touched them. In a budget file, `state` is `changed`, `unchanged`, `new` or `untracked`, and `before` and `delta` are null unless the file existed at the commit compared with. `analyze({ collect: true })` is what drift reads: the result gains `citations`, every citation that reached a file or a folder git knows, `{ file, line, cited, path }`, and `files`, the context files read.

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

The demo at the top of the README, `assets/demo.gif`, is a recording of a real Windows Terminal window running the published package on the example repository, `npx @tomd4vs/prumo` typed at a human pace and the report as it prints; `assets/report.png`, further down the README, is the last frame of the same recording. Both are redone whenever the report changes its look, from the maintainer's machine.