# prumo

A zero-dependency CLI that checks whether the context files a coding agent reads
still match the code. Node 18+, ESM, no build step.

## Layout

- `bin/prumo.mjs` — CLI: argument parsing, then the report, or one of the two reports, `drift` and `budget`. No analysis lives here.
- `bin/prumo-mcp.mjs` — MCP server over stdio, four tools, same analysis and same reports.
- `src/check.mjs` — the five checks, exported as `analyze()` and `resolveTargets()`.
- `src/drift.mjs` and `src/budget.mjs` — the two reports, `drift()` and `budget()`: git blame and git log behind the sections of a note, and the size, growth and repeated paragraphs of each file. Neither is a check.
- `src/index.mjs` — what the package exports: everything from the modules above and below.
- `src/fix.mjs` — the only automatic rewrites: case mismatches, and the renames git recorded.
- `src/report.mjs` — the text and GitHub renderers, shared by the CLI and the MCP server. Colour is a flag the CLI sets for a terminal; without it the text is the contract the README shows.
- `src/banner.mjs` — the name and version above the report, printed only when stdout is a terminal.
- `test/check.test.mjs`, `test/report.test.mjs`, `test/mcp.test.mjs`, `test/banner.test.mjs`, `test/baseline.test.mjs`, `test/history.test.mjs`, `test/drift.test.mjs`, `test/budget.test.mjs` — the suite: the analysis and the fix, the baseline and the limits to what changed, the history behind a missing path, the two renderers, the server driven over stdio, the banner, and the two reports. Every test that needs a repository builds a throwaway one.
- `test/simulate-new-user.sh` — a new user follows the README against the packed tarball; `npm run simulate`.
- `action.yml` — the GitHub Action, `uses: TomD4vs/prumo@v1`: a composite step that runs the checked-out `bin/prumo.mjs`. Not in the npm tarball.
- `.pre-commit-hooks.yaml` — the hook for the pre-commit framework; its `files:` regex is guarded by the same test as the hook in `docs/agents.md`.
- `docs/design.md` — **read this before changing behaviour.** Why there are so few checks,
  what was measured and rejected, what each filter defends against, and the order in which a
  path is resolved. `docs/api.md` has the development recipes.
- `CONTRIBUTING.md` — the bar an outside change has to clear, in both languages.
- `assets/social.html` — source of `assets/social.png`, rendered headless at 1280x640.
- `assets/demo.gif` and `assets/report.png` — the demo at the top of the README and the still image under "Reading the result", both from one recording of a real Windows Terminal window; `docs/api.md` says what is recorded.

## Running it

```bash
node bin/prumo.mjs .            # this repository
node bin/prumo.mjs ../other     # somewhere else
node bin/prumo.mjs . --all      # do not truncate
```

## Rules that matter

- **The git index is the source of truth for paths**, never the filesystem: `existsSync`
  reports success for the wrong letter case on Windows and macOS, which is the exact bug
  the case check exists to find.
- **Precision over recall.** A generic "does this symbol exist" check was built and removed
  after measuring 2% precision across seven audits. Do not add a check without measuring it
  on a real corpus first.
- **Filters are the product.** Most of `check.mjs` exists to stay quiet: negation read across
  a paragraph, historical entries, transient artifacts, aliases and short paths.
- **Never write to the user's files.** The tool reads and reports; the edit is theirs.
- **Comments only where they earn it**: the file header and a docblock on a declaration.
  Nothing inside a function body.

## Before publishing

Run `npm run simulate` before a publish and `npm run simulate -- --registry` after it; the unit tests
exercise `analyze()`, the simulation exercises what the docs promise through the CLI.
Run it against a real repository with a large context file, not only against this one.
`--json` output is the stable contract for anything consuming it programmatically; it carries `schemaVersion`,
which goes up when its shape changes.
