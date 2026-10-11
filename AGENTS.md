# prumo

A zero-dependency CLI that checks whether the context files a coding agent reads
still match the code. Node 18+, ESM, no build step.

## Layout

- `bin/prumo.mjs` — CLI: argument parsing, then the report, or one of the two reports, `drift` and `budget`. No analysis lives here.
- `bin/prumo-mcp.mjs` — MCP server over stdio, four tools, same analysis and same reports.
- `src/check.mjs` — what the analysis exports, `analyze()` and `resolveTargets()` among it; the code lives under `src/check/`, one module per job:
  - `analyze.mjs` runs the checks over each context file, then the gates on another project, `.gitignore`, the baseline and the history;
  - `paths.mjs`, `links.mjs`, `commands.mjs` and `agent-config.mjs` are the checks, each with the filters only it uses;
  - `sentence.mjs` reads what the words around a citation say: negation, a file that gets written, a condition;
  - `lines.mjs` tells prose from a fenced block and holds the `prumo-ignore` markers;
  - `git-index.mjs` reads the index and resolves a path against it, in the order `docs/design.md` fixes;
  - `targets.mjs`, `config.mjs`, `baseline.mjs`, `history.mjs`, `repository.mjs` and `version.mjs` are what the run reads around the notes.
- `src/drift.mjs` and `src/budget.mjs` — the two reports, `drift()` and `budget()`: git blame and git log behind the sections of a note, and the size, growth and repeated paragraphs of each file. Neither is a check.
- `src/index.mjs` — what the package exports: everything from the modules above and below.
- `src/fix.mjs` — the only automatic rewrites: case mismatches, and the renames git recorded.
- `src/report.mjs` — the text and GitHub renderers, shared by the CLI and the MCP server. Colour is a flag the CLI sets for a terminal; without it the text is the contract the README shows.
- `src/banner.mjs` — the name and version above the report, printed only when stdout is a terminal.
- `test/` — the suite, one file per subject: `paths`, `filters`, `links`, `commands`, `agent-config`, `lines`, `targets`, `config` and `fix` for the analysis, `hostile` for notes built to make a pattern backtrack, `cli` for what the command line and the docs promise, then `baseline`, `history`, `report`, `mcp`, `banner`, `drift` and `budget`. `test/support.mjs` builds the throwaway repositories every test needs and runs the CLI with the shell's colour settings cleared; `node --test` loads it as a file of its own, which is why the count is one above the tests.
- `test/simulate-new-user.sh` — a new user follows the README against the packed tarball; `npm run simulate`.
- `action.yml` — the GitHub Action, `uses: TomD4vs/prumo@v1`: a composite step that runs the checked-out `bin/prumo.mjs`. Not in the npm tarball.
- `.pre-commit-hooks.yaml` — the hook for the pre-commit framework; its `files:` regex is guarded by the same test as the hook in `docs/agents.md`.
- `server.json` — the entry of the MCP server in the official MCP Registry, published with `mcp-publisher`; its `name` must equal `mcpName` in `package.json`, and both versions follow the package. Not in the npm tarball.
- `glama.json` — the claim of the server listing on Glama, naming the maintainers who may configure its Docker build and cut a release there; the quality score the awesome-mcp-servers listing asks for comes from that release. Not in the npm tarball.
- `docs/design.md` — **read this before changing behaviour.** Why there are so few checks,
  what was measured and rejected, what each filter defends against, and the order in which a
  path is resolved. `docs/api.md` has the development recipes.
- `CONTRIBUTING.md` — the bar an outside change has to clear, in both languages.
- `assets/social.html` — source of `assets/social.png`, rendered headless at 1280x640.
- `assets/header.html` and `assets/lang.html` — sources of the README header and the language button, `assets/header-dark.png`, `assets/header-light.png` and the four `assets/lang-*.png`, one per GitHub theme, rendered headless on a transparent ground; `docs/api.md` has the command.
- `assets/demo.gif` — the demo at the top of the README, a recording of a real Windows Terminal window; `docs/api.md` says what is recorded.

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
- **Split a file into lines with `/\r?\n/`, never with `'\n'`.** A CRLF checkout keeps its `\r`
  otherwise, the fence opener stops matching, and every filter that rests on a fenced block is
  off on Windows while Linux reads the same file clean. A real repository showed it in 0.9.1.
- **Precision over recall.** A generic "does this symbol exist" check was built and removed
  after measuring 2% precision across seven audits. Do not add a check without measuring it
  on a real corpus first.
- **Filters are the product.** Most of `check.mjs` exists to stay quiet: negation read across
  a paragraph, historical entries, transient artifacts, aliases and short paths.
- **Never write to the user's files.** The tool reads and reports; the edit is theirs.
- **Comments only where they earn it**: the file header and a docblock on a declaration.
  Nothing inside a function body.

## Before saying a change is done

Every change, however small, goes through these steps before it is called done, and before any commit
command is suggested. Nobody has to ask for them.

1. **Rerun the reproduction.** A fix is done when the exact command that exposed the bug prints the right
   thing now. Show the output from before and after side by side; a green suite answers a different question.
2. **Prove the test by breaking the code.** Revert the fix, or remove the rule, and watch the new test fail.
   A test that passes both ways tests nothing.
3. **Run the whole suite**, `npm test`, never one file. Run `npm run simulate` too when the change reaches
   the CLI, the text report or anything the docs show. For a change in `src/check/`, also run the old and the
   new tree over a corpus of real repositories and read every finding that appears or disappears.
4. **Scan the diff for bugs and security holes**, not only the file that was meant to change:
   - who else calls what changed, and the same flow in the other check, the MCP server and the CLI;
   - a path from a note or from the MCP client that escapes the repository: `--fix` and `prumo_fix` must
     only ever write to the context files they read;
   - a value from a note reaching a shell: git runs through `execFileSync` with an argument list, never a
     command string built from text;
   - a regular expression a hostile note can make backtrack for minutes, since every line of every note is
     matched against dozens of them; `test/hostile.test.mjs` is where a new shape goes;
   - a regular expression built from text the repository supplies, such as a rule's glob: the engine compiles
     it on its first match and may refuse it there as too large, which once stopped the whole run;
   - a crash on unexpected input: an empty file, a binary one, a huge line, an invalid JSON config;
   - the absence check that silences a case mismatch, as `docs/design.md` warns.
   Say in the report what the scan found, or that it found nothing.
5. **Check CI after the push**, `gh run list --limit 3`. It runs the suite on Linux, Windows and macOS
   with three Node versions, a floor on coverage, the simulation, semgrep and gitleaks, and the same
   jobs again every Monday. A green local run proves nothing about the other two systems.

## Before publishing

Run `npm run simulate` before a publish and `npm run simulate -- --registry` after it; the unit tests
exercise `analyze()`, the simulation exercises what the docs promise through the CLI.
Run it against a real repository with a large context file, not only against this one.
`--json` output is the stable contract for anything consuming it programmatically; it carries `schemaVersion`,
which goes up when its shape changes.
