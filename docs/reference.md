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
| `--fix` | Correct case mismatches in place; nothing else is touched |
| `--format F` | `text` (default), `github`, or `json` |
| `--all` | Show every finding instead of the first 25 |
| `--json FILE` | Also write the findings to `FILE` as JSON |
| `--quiet` | Print nothing; use the exit code |
| `--no-config` | Ignore `.prumorc.json` |
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

`CLAUDE.md`, `AGENTS.md` and `SKILL.md` are also collected from subfolders, so `packages/api/AGENTS.md` and `.claude/skills/deploy/SKILL.md` are read the same as a file at the root. Folders such as `vendor/` and `node_modules/` are left out, because a context file there documents a dependency.

A skill under `.claude/skills/` or `.agents/skills/` is read even when git does not track it, as an installed skill often is not. The header counts the files read that way. The files beside such a skill are looked up on disk, since the index does not hold them, so a wrong letter case in one of those goes unnoticed.

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

A `[[wikilink]]`, or a markdown link such as `[Setup](docs/setup.md)`, points at a file that isn't there. An agent following it finds nothing and carries on without saying so. Wikilinks are matched by name against the notes being checked and against every markdown file git tracks; markdown links are resolved relative to the file that contains them, and a link that starts with `/` from the repository root, as GitHub renders it. A link that resolves from the repository root and from nowhere else is read from the root, since that is how an agent reads a path, and how a note nested in `.claude/skills/` tends to write one. A `%20` in the target is read as the space it stands for, and `--fix` writes it back encoded, so a corrected link still works.

The target may be a markdown page, an image, a PDF or a source file, and the three ways markdown writes a link are all read: `[a](x.md)`, `[a](<a name with spaces.md>)` and a `[a][ref]` whose `[ref]:` definition is reported on its own line. A link to a heading, `[setup](docs/guide.md#quick-start)` or `[top](#quick-start)`, is checked against the headings of that page, turned into anchors the way GitHub does it, and against any `id` or `name` attribute in its HTML. Double brackets glued to a word, holding a dot or padded with spaces, as in `df[[col]]`, `[[rule.threat]]` or `$[[ inputs.stage ]]`, are code or template syntax and are left alone.

Where prumo prints a `-> suggestion`, that is almost certainly the intended file; the two usually differ only in `-` versus `_`. With no suggestion, the target was renamed or deleted, so update the link or drop it.

Hundreds of these usually share one systematic cause. In one measured run, every link was written in kebab-case while every file was named in snake_case, and renaming the files cleared 247 at once.

### `MISSING PATH`

The note cites a file that no longer exists anywhere in the repository. Update the path, or rewrite the sentence if its point is that the file is gone. prumo recognises phrasing such as *"was removed"*, *"no longer exists"*, *"renamed to"*, *"migrated from"* and *"moved to"*, and stays quiet when it finds it.

It also recognises a sentence that says the file gets written, such as *"Output: `docs/report.md`"*, *"save the plan to `docs/plan.md`"* or *"`docs/run.log` is generated by the build"*, and leaves that path alone. The verb nearest the path in its sentence decides, so *"read `a` and write the result to `b`"* still checks `a`. A list or a table takes the verdict from the sentence that introduces it, or from the heading of its section, and in a command a `>` redirect, an `-o` flag or `mkdir` marks what is written. A sentence that makes the file's existence a condition, *"if `docs/context.md` exists, read it"*, is left alone as well. A path with the wrong case is reported whatever the sentence says.

A path that `.gitignore` covers is absent on purpose, so it is exempt from this check and from the broken-link check. The header counts these exemptions, so a repository that leans on them never reads as clean by accident.

### `UNKNOWN COMMAND`

The note tells the agent to run `npm run test:unit`, `yarn build`, `make deploy` or `composer lint`, and no `package.json`, `Makefile` or `composer.json` git tracks defines a script or target of that name. Scripts get renamed more often than files, and an agent that runs the old name stops on the spot. Every manifest in the repository counts, so the note of a monorepo may name a script of any package, and `yarn x` and `pnpm x` also accept the name of a dependency, since they run its binary. A command pointed elsewhere, with `-w`, `--filter` or `make -C`, is left alone, and so is `make` when a target is built from a variable, since the list cannot be read then. Where prumo prints a `-> suggestion`, that is the defined name closest to the one cited.

### `ANOTHER PROJECT`

Not a finding. A context file whose cited paths start, for the most part, in folders this repository does not have (at least four of them, and at least six in ten of what it cites) is read as documenting another project: a template `CLAUDE.md` waiting to be copied, or a skill written for the codebase it will be installed into. Its findings are held back, the section names the file with the count, and nothing of it counts in the exit code. A file you name on the command line, or in `targets` of `.prumorc.json`, is always checked in full, so `prumo . CLAUDE.md` lists what was held back. A note that has gone stale still cites the folders the repository has, which is why the folder is the signal. For a `SKILL.md`, the folders a skill carries beside it, `references/`, `scripts/`, `assets/` and `templates/`, never count toward the gate: a skill missing its own files is a finding.

### `NOT IN INDEX`

Appears only when you pass a folder of notes. A file sits in the folder but `MEMORY.md` never mentions it, so nothing leads a reader to it. Add it to the index or delete it.

---

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

`ignore`, `exclude` and `transient` accept globs (`*`, `**`, `?`); a pattern with no wildcard that names a folder covers everything under it. `--no-config` bypasses the file for one run. Suppressions are counted in the header, so a silenced repository never reads as a clean one.

---

## Fixing case automatically

```bash
prumo --fix
```

```
FIXED  1 path in 1 file
  CLAUDE.md:18   layouts/AppLayout.vue  ->  resources/js/Layouts/AppLayout.vue
```

Only case mismatches are rewritten, because only they have a correct value that can be read from the git index rather than guessed. Broken links and missing paths are left alone: a link suggestion is an educated guess, and a missing path may be missing on purpose.

Every way a path can be cited is rewritten where it stands: in backticks, inside a command, inside a fenced block, spelled with backslashes, followed by a line number, and in a link written as `[a](x)`, `[a](<x>)` or `[ref]: x`. A path cited on several lines is corrected on all of them in one pass.

If a line changed between the scan and the fix, prumo leaves that line as it is and says so in the report.
