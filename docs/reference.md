# Reference

[← README](../README.md) · [Ler em português](reference.pt-BR.md)

Every argument, option and finding, plus how to silence one and how `--fix` decides what to touch.

---

## Usage

```
prumo [repo] [target...] [options]
```

| Argument | Meaning |
| --- | --- |
| `repo` | Path to a git repository. Defaults to the current folder. |
| `target` | A markdown file, or the markdown files directly inside a folder. Omit for auto-detection. A target that does not exist is an error, not a fall back to auto-detection. |

| Option | Meaning |
| --- | --- |
| `--fix` | Correct case mismatches and the renames git recorded, in place; nothing else is touched |
| `--format F` | `text` (default), `github`, `json`, or `sarif` |
| `--sarif FILE` | Also write the findings to `FILE` as SARIF, for code scanning |
| `--all` | Show every finding instead of the first 25 |
| `--json FILE` | Also write the findings to `FILE` as JSON |
| `--quiet` | Print nothing; use the exit code |
| `--no-config` | Ignore `.prumorc.json` |
| `--baseline` | Record the current findings in `.prumo-baseline.json`; later runs fail only on what is new |
| `--no-baseline` | Ignore `.prumo-baseline.json` for this run |
| `--staged` | Check only the context files staged for commit |
| `--since REF` | Check only the context files changed since `REF`, a commit or a branch |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

In a terminal, the report opens with the name drawn large, the version and the GitHub page. Each section title becomes a coloured label, the path the note cites is painted apart from the one the repository holds, and the last line counts the findings by kind. When the output goes to a pipe, a file, CI or an agent, nothing comes before the header line and no colour is used, so what those read is exactly what this page shows.

| Variable | Meaning |
| --- | --- |
| `PRUMO_BANNER=0` | No name above the report, even in a terminal; `=1` shows it even in a pipe |
| `NO_COLOR=1` | Plain text in a terminal |
| `FORCE_COLOR=1` | Colour even in a pipe |

### Files found automatically

| Agent | Files |
| --- | --- |
| Claude Code | `CLAUDE.md`, `CLAUDE.local.md`, `.claude/MEMORY.md`, `.claude/commands/` |
| Codex, Amp, and the AGENTS.md convention | `AGENTS.md`, `AGENT.md` |
| Cursor | `.cursorrules`, `.cursor/rules/` |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/` |
| Gemini CLI / Jules | `GEMINI.md`, `JULES.md` |
| Windsurf | `.windsurfrules`, `.windsurf/rules/` |
| Cline / Roo | `.clinerules`, `.roo/rules/` |
| Aider | `CONVENTIONS.md` |
| Agent Skills, any host | `SKILL.md` inside any subfolder, such as `.claude/skills/deploy/`, whether git tracks it or not |
| Any | `MEMORY.md`, `COPILOT.md` |

`CLAUDE.md`, `AGENTS.md` and `SKILL.md` are also collected from subfolders, so `packages/api/AGENTS.md` and `.claude/skills/deploy/SKILL.md` are read the same as a file at the root. Folders such as `vendor/`, `node_modules/` and `managed_components/` are left out, because a context file there documents a dependency.

A skill under `.claude/skills/` or `.agents/skills/` is read even when git does not track it, as an installed skill often is not. The header counts the files read that way. The files beside such a skill are looked up on disk, since the index does not hold them, so a wrong letter case in one of those goes unnoticed.

Besides the context files, `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` and `.claude/settings.json` are read as configuration when git tracks them and the context files were auto-detected, for the `AGENT CONFIG` check below. The header does not list them; `stats.configs` in the JSON counts them.

A `SKILL.md` at the repository root is not detected automatically. At the root, a file with that name is often a tool's own instructions rather than an installed skill, and the paths in it are examples rather than references. When the repository is itself a skill, name the file: `prumo . SKILL.md`.

### Examples

```bash
prumo                                  # this repository, auto-detected files
prumo .                                # the same, written explicitly
prumo . docs/notes                     # also sweep a folder of markdown
prumo ~/work/api                       # a repository somewhere else
prumo . --all                          # do not truncate the list
prumo . --json findings.json           # save the findings as JSON
prumo . SKILL.md                       # a repository that is itself a skill

# Windows: quote any path containing spaces
prumo "C:/Users/me/My Project"
```

### Exit codes

| Code | Meaning |
| :---: | --- |
| `0` | Nothing to review |
| `1` | Findings to review |
| `2` | Bad usage: not a git repo, empty git index, no files found, unknown option |

---

## What each finding means

**What prumo reads as a path.** In prose, only a citation that names a folder is checked: one that
starts with a usual top-level folder (`app/`, `src/`, `docs/`, `packages/`, `tests/` and the rest),
or that contains a `/` and ends in a known extension. A bare file name with no folder in front of
it, `politica.md`, is left alone, because notes mention file names in passing far more often than
they cite them as paths. Write it as `docs/politica.md`, or as a markdown link
`[politica](politica.md)`, and it is checked like any other. A span with spaces is read as a command,
and each of its arguments is tried as a path; a span that opens with a number, such as
`000 Inbox/Inbox.md`, is a name and is left alone. A host written without its scheme,
`docs.example.com/guide.md`, and a `file://` address are web addresses. A `:42`, a `#L10` or a
`:symbol` after the path points inside the file and is dropped before the path is looked up.

**A fenced code block is read as code.** Every line inside a ```` ``` ```` block is read as a
command or as an entry in a file tree, so `node scripts/seed.py` and `src/components/Button.tsx`
are checked there without backticks, and the sentence that introduces the block counts as its
context. A block marked `markdown` is an example of syntax, and so is anything inside an HTML
comment, so neither is read. A block in a programming language such as `js`, `python` or `php` is
source code, and a string in it is something the language resolves, so it is not read either. In a
block that is read, `require('lib/x.js')` and `path=lib/x.js` are checked as `lib/x.js`. A link
inside a fenced block is only being quoted, so it is left alone. A path cited on several lines is
reported on each of them.

### `CASE MISMATCH`

A path is spelled with different letter case than the repository uses. prumo compares against the git index, which is the only place that stores the real spelling; the filesystem won't tell you the truth about this on Windows or macOS.

The result is the classic "works on my machine": fine locally, dead on Linux, in CI and in Docker. Copy the path shown after the `->`.

### `BROKEN LINK`

A `[[wikilink]]`, or a markdown link such as `[Setup](docs/setup.md)`, points at a file that isn't there. An agent following it finds nothing and carries on without saying so. Wikilinks are matched by name against the notes being checked and against every markdown file git tracks; markdown links are resolved relative to the file that contains them, and a link that starts with `/` from the repository root, as GitHub renders it, or with `mdc:`, as a Cursor rule writes it; a link with a `file:` scheme is an address, like a `file://` path in prose. A link that resolves from the repository root and from nowhere else is read from the root, since that is how an agent reads a path, and how a note nested in `.claude/skills/` tends to write one. A `%20` in the target is read as the space it stands for, and `--fix` writes it back encoded, so a corrected link still works.

The target may be a markdown page, an image, a PDF or a source file, and the three ways markdown writes a link are all read: `[a](x.md)`, `[a](<a name with spaces.md>)` and a `[a][ref]` whose `[ref]:` definition is reported on its own line. A link to a heading, `[setup](docs/guide.md#quick-start)` or `[top](#quick-start)`, is checked against the headings of that page, turned into anchors the way GitHub does it, and against any `id` or `name` attribute in its HTML. Double brackets glued to a word, holding a dot or padded with spaces, as in `df[[col]]`, `[[rule.threat]]` or `$[[ inputs.stage ]]`, are code or template syntax and are left alone.

Where prumo prints a `-> suggestion`, that is almost certainly the intended file; the two usually differ only in `-` versus `_`. With no suggestion, the target was renamed or deleted, so update the link or drop it. For a markdown link, git's history is asked the same way as for a missing path, below, and a rename git recorded replaces the guess from the name. A link whose text is the same path in backticks is one citation, reported once, as the link.

Hundreds of these usually share one systematic cause. In one measured run, every link was written in kebab-case while every file was named in snake_case, and renaming the files cleared 247 at once.

### `MISSING PATH`

The note cites a file that no longer exists anywhere in the repository. Update the path, or rewrite the sentence if its point is that the file is gone. prumo recognises phrasing such as *"was removed"*, *"no longer exists"*, *"renamed to"*, *"migrated from"*, *"moved to"* and *"no skills found"*, in English, Portuguese and Chinese, and stays quiet when it finds it.

When git holds the file's history, the finding says where it went. `->  config/db.php   renamed in a3f21c9, 4 months ago` is git's own rename detection, by similarity, followed through later renames to the name that exists now, and `deleted in a3f21c9, 4 months ago` is the commit that removed it. A file moved and rewritten at once reads as deleted, since git pairs a rename by similarity, while a move inside a commit that touched thousands of files is still read as a move, because the lookup raises git's rename limit. Nothing is said when the history never held the path, which is what a placeholder, a typo or another project's path looks like, or when the clone is shallow. The lookup asks git only about the paths it reports, at most two hundred in one run. Two shapes are not reported at all: a file each machine writes for itself, `CLAUDE.local.md`, `settings.local.json` or any name with `.local` before its extension; and a skill cited by the path a host installs it under, `.claude/skills/deploy/scripts/x.sh`, when the same file exists beside a `SKILL.md` somewhere in the repository. A rename is the one thing beyond letter case that `--fix` applies, below; a deletion is never rewritten.

It also recognises a sentence that says the file gets written, such as *"Output: `docs/report.md`"*, *"save the plan to `docs/plan.md`"* or *"`docs/run.log` is generated by the build"*, and leaves that path alone. The verb nearest the path in its sentence decides, so *"read `a` and write the result to `b`"* still checks `a`. A list or a table takes the verdict from the sentence that introduces it, or from the heading of its section, and in a command a `>` redirect, an `-o` flag or `mkdir` marks what is written. A sentence that makes the file's existence a condition, *"if `docs/context.md` exists, read it"* or *"read `docs/context.md` if it exists"*, is left alone as well. A path with the wrong case is reported whatever the sentence says.

A path that `.gitignore` covers is absent on purpose, so it is exempt from this check and from the broken-link check. The header counts these exemptions, so a repository that leans on them never reads as clean by accident.

### `UNKNOWN COMMAND`

The note tells the agent to run `npm run test:unit`, `yarn build`, `make deploy` or `composer lint`, and no `package.json`, `Makefile` or `composer.json` git tracks defines a script or target of that name. Scripts get renamed more often than files, and an agent that runs the old name stops on the spot. Every manifest in the repository counts, so the note of a monorepo may name a script of any package, and `yarn x` and `pnpm x` also accept the name of a dependency, since they run its binary. A command pointed elsewhere, with `-w`, `--filter` or `make -C`, is left alone, and so is `make` when a target is built from a variable, since the list cannot be read then. A note that shows the same script under several package managers, `npm run lint` in one row and `pnpm lint` in the next, is listing alternatives, and none of them is reported. Where prumo prints a `-> suggestion`, that is the defined name closest to the one cited.

### `AGENT CONFIG`

A setting in the agent's configuration that points at nothing, which fails in silence: the rule never applies, the skill never loads, the server never starts, and no message says so. Four shapes are read, all from structured sources. A rule in `.cursor/rules/*.mdc`, or an instruction in `.github/instructions/*.md`, none of whose `globs:` or `applyTo:` patterns matches a file git tracks, unless `alwaysApply: true` makes the patterns moot; a dead pattern beside a live one is left alone, since the rule attaches when any of them matches, and a pattern that is only an extension, `.cpp`, is read as `**/*.cpp`. A `SKILL.md` under a `skills/` folder whose front matter has no `description`, since that is what an agent picks a skill by; outside `.claude/skills/` and `.agents/skills/` only a front matter that carries a `name` is read as a skill's, because a `SKILL.md` elsewhere may follow another schema, and the `name` is not held against the folder, because hosts differ on whether the two must agree; a skill installed under `.claude/skills/` or `.agents/skills/` with no front matter at all is reported for the same reason. An MCP server in `.mcp.json`, `.cursor/mcp.json` or `.vscode/mcp.json` whose `command` or `args` name a script that is not here, and a hook in `.claude/settings.json` that does the same; `$CLAUDE_PROJECT_DIR` in front of a path is read as the repository root. The JSON files are read only when the context files were auto-detected, and only when git tracks them; naming a target checks that target alone.

### `ANOTHER PROJECT`

Not a finding. A context file whose cited paths start, for the most part, in folders this repository does not have (at least four of them, and at least six in ten of what it cites) is read as documenting another project: a template `CLAUDE.md` waiting to be copied, or a skill written for the codebase it will be installed into. Its findings are held back, the section names the file with the count, and nothing of it counts in the exit code. A file you name on the command line, or in `targets` of `.prumorc.json`, is always checked in full, so `prumo . CLAUDE.md` lists what was held back. A note that has gone stale still cites the folders the repository has, which is why the folder is the signal. For a `SKILL.md`, the folders a skill carries beside it, `references/`, `scripts/`, `assets/` and `templates/`, never count toward the gate: a skill missing its own files is a finding. A rules folder gets the same reading: when most of the rules in `.cursor/rules/` or `.github/instructions/` match nothing here (the same four, and six in ten, counted over rules), its `AGENT CONFIG` findings are held back and the section names the folder, since a catalogue of rules kept for many stacks is not a stale rule.

### `NOT IN INDEX`

Appears only when you pass a folder of notes. A file sits in the folder but `MEMORY.md` never mentions it, so nothing leads a reader to it. Add it to the index or delete it.

---

## Continuous integration

Three ways in, all the same check.

**The action.** `TomD4vs/prumo@v1` is a composite step that runs the checked-out prumo at that tag, so there is nothing to install and no network call. `@v1` follows the latest release; pin `@v0.6.0` to freeze it.

```yaml
- uses: TomD4vs/prumo@v1
  with:
    path: .                    # the repository to check, relative to the workspace
    targets: ''                # files or folders to check instead of auto-detecting, separated by spaces
    format: github             # github annotates the pull request; text, json and sarif are the others
    sarif-file: ''             # also write SARIF here, for the upload below
    fail-on-findings: 'true'   # 'false' only annotates
    since: ''                  # check only the context files changed since this commit or branch
```

Every value above is the default, so the one-line form in the README is this same step. The step's `total` output is the number of findings.

**SARIF.** `--format sarif` prints SARIF 2.1.0, and `--sarif FILE` writes it beside whatever the run prints: one result per finding, with its rule, level, file and line. GitHub code scanning takes the file through the upload action, and the workflow needs `permissions: security-events: write` for it:

```yaml
- uses: TomD4vs/prumo@v1
  with: { sarif-file: prumo.sarif, fail-on-findings: 'false' }
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: prumo.sarif }
```

**pre-commit.** The repository ships a hook for the [pre-commit](https://pre-commit.com) framework. It runs when a staged file is one prumo auto-detects, checks the staged context files against the whole index, and blocks the commit on a finding:

```yaml
repos:
  - repo: https://github.com/TomD4vs/prumo
    rev: v0.7.1
    hooks:
      - id: prumo
```

**Only what changed.** `--staged` checks the context files staged for commit and nothing else, and `--since REF` the ones changed since a commit or a branch, `--since origin/main` on a pull request. The checks still run against the whole index, so a staged note that cites a file the commit does not touch is checked in full; what neither limit sees is a note left untouched while the file it cites was renamed, which is why the full run belongs on the main branch or on a schedule. The header says which limit applied, and a run that reaches no context file exits 0. The action takes the same limit through its `since` input, and the checkout then needs the history that reaches the branch, `fetch-depth: 0` on `actions/checkout`.

## Silencing a finding

Sooner or later prumo flags something you know is fine. Use the narrowest suppression that covers it.

Inline, for a single line:

```markdown
Legacy note about `config/old.php`. <!-- prumo-ignore -->

<!-- prumo-ignore-next-line -->
Another about `config/older.php`.

<!-- prumo-ignore-file -->
```

Placed on the line before a fenced block, `<!-- prumo-ignore-next-line -->` silences the whole block, counted once.

`.prumorc.json` at the repository root, for a pattern:

```jsonc
{
  "ignore":    ["docs/legacy/**", "config/vendor.php"],  // paths and links to skip
  "exclude":   ["CHANGELOG.md"],                         // context files not to check
  "targets":   ["CLAUDE.md", "docs/notes"],              // check these instead of auto-detecting
  "transient": ["public/dist", "coverage-html"]          // extra build output to ignore
}
```

`ignore`, `exclude` and `transient` accept globs (`*`, `**`, `?`); a pattern with no wildcard that names a folder covers everything under it. `--no-config` bypasses the file for one run.

A baseline, for a repository with a backlog. `prumo --baseline` records every finding of the run in `.prumo-baseline.json` at the repository root, and from then on a run holds those back, fails only on what is new, and says in the header how many it held. Commit the file, so CI and the hooks read the same baseline. A finding is recorded by its kind, its file and the path it cites, with how many lines cite it; line numbers are left out, since they move with every edit. When a held finding is fixed, the header says that an entry matches nothing now, and running `--baseline` again rewrites the file with what remains. `--no-baseline` ignores the file for one run, `--fix` touches only what is reported, and the MCP server applies the baseline it finds but never writes one, since holding a finding back is a decision for a person.

Suppressions and the baseline are counted in the header, so a silenced repository never reads as a clean one.

---

## Fixing case and renames automatically

```bash
prumo --fix
```

```
FIXED  2 paths in 1 file
  CLAUDE.md:18   layouts/AppLayout.vue  ->  resources/js/Layouts/AppLayout.vue
  CLAUDE.md:30   config/database.php  ->  config/db.php   renamed in a3f21c9
```

Two things are rewritten, because only they have a correct value that is read rather than guessed: a case mismatch, whose spelling comes from the git index, and a missing path or a markdown link whose file git recorded as renamed, whose new name comes from the history. Everything else is left alone: a link suggested from a name is an educated guess, a missing path with no history may be missing on purpose, and a deleted file has nothing to be written in its place.

Every way a path can be cited is rewritten where it stands: in backticks, inside a command, inside a fenced block, spelled with backslashes, followed by a line number, and in a link written as `[a](x)`, `[a](<x>)` or `[ref]: x`. A renamed path is written the way the citation was: from the root, from beside the note, with `/` or `mdc:` in front, or with its spaces as `%20`. A path cited on several lines is corrected on all of them in one pass.

If a line changed between the scan and the fix, prumo leaves that line as it is and says so in the report.
