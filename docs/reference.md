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

### Files found automatically

| Agent | Files |
| --- | --- |
| Claude Code | `CLAUDE.md`, `CLAUDE.local.md`, `.claude/MEMORY.md` |
| Codex, Amp, and the AGENTS.md convention | `AGENTS.md`, `AGENT.md` |
| Cursor | `.cursorrules`, `.cursor/rules/` |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/` |
| Gemini CLI / Jules | `GEMINI.md`, `JULES.md` |
| Windsurf | `.windsurfrules`, `.windsurf/rules/` |
| Cline / Roo | `.clinerules`, `.roo/rules/` |
| Aider | `CONVENTIONS.md` |
| Agent Skills, any host | `SKILL.md` inside any subfolder, such as `.claude/skills/deploy/` |
| Any | `MEMORY.md`, `COPILOT.md` |

`CLAUDE.md`, `AGENTS.md` and `SKILL.md` are also collected from subfolders, so `packages/api/AGENTS.md` and `.claude/skills/deploy/SKILL.md` are read the same as a file at the root. Folders such as `vendor/` and `node_modules/` are left out, because a context file there documents a dependency.

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

### `CASE MISMATCH`

A path is spelled with different capitalisation than the repository uses. prumo compares against the git index, which is the only place that stores the real spelling; the filesystem won't tell you the truth about this on Windows or macOS.

The result is the classic "works on my machine": fine locally, dead on Linux, in CI and in Docker. Copy the path shown after the `->`.

### `BROKEN LINK`

A `[[wikilink]]`, or a markdown link such as `[Setup](docs/setup.md)`, points at a file that isn't there. An agent following it finds nothing and carries on without saying so. Wikilinks are matched by name against the notes being checked and against every markdown file git tracks; markdown links are resolved relative to the file that contains them, and a link that starts with `/` from the repository root, as GitHub renders it.

Where prumo prints a `-> suggestion`, that is almost certainly the intended file; the two usually differ only in `-` versus `_`. With no suggestion, the target was renamed or deleted, so update the link or drop it.

Hundreds of these usually share one systematic cause. In one measured run, every link was written in kebab-case while every file was named in snake_case, and renaming the files cleared 247 at once.

### `MISSING PATH`

The note cites a file that no longer exists anywhere in the repository. Update the path, or rewrite the sentence if its point is that the file is gone. prumo recognises phrasing such as *"was removed"*, *"no longer exists"* and *"renamed to"*, and stays quiet when it finds it.

A path that `.gitignore` covers is absent on purpose, so it is exempt from this check and from the broken-link check. The header counts these exemptions, so a repository that leans on them never reads as clean by accident.

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

Lines that changed since the scan are reported and skipped rather than rewritten.
