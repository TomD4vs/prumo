<p align="center">
  <img src="assets/social.png" alt="prumo — is your documentation still true?" width="820">
</p>

<h1 align="center">prumo</h1>

<p align="center">
  <b>Is your documentation still true?</b><br>
  <sub>Checks the context files your coding agent reads against the code beside them.</sub>
</p>

<p align="center">
  <a href="README.pt-BR.md">🇧🇷 Leia em português</a>
</p>

---

## The problem, in one example

Three months ago you wrote this in your `CLAUDE.md`:

```markdown
The sidebar logo lives in `layouts/AppLayout.vue`.
```

Since then the folder was renamed to `Layouts`, with a capital L. On Windows and macOS that path **still opens**, so nothing ever complained. On Linux and in CI it points at nothing — and every AI agent that reads the file is confidently told to look in a place that does not exist.

That single line survived **six hand-run audits** of the same files. `prumo` found it in four seconds.

---

## Try it in 10 seconds

You need [Node.js 18+](https://nodejs.org) and `git`. Nothing else — no install, no config, no account.

Open a terminal **inside any git repository** and run:

```bash
npx prumo
```

That is the whole thing. `prumo` finds your context files by itself.

<details>
<summary>What is <code>npx</code>?</summary>

`npx` comes with Node.js. It downloads and runs a tool once, without installing it. If you plan to use `prumo` often, see [Installing](#installing) below.
</details>

---

## Reading the result

### If everything is fine

```
prumo — 1 context file, 401 files in the git index

nothing to review.
```

Line 1 says **what it looked at**: one context file (it found your `CLAUDE.md`) and 401 files in the repository. Line 3 is the verdict. You are done.

### If it found something

Here is a real run, annotated:

```
prumo — 3 context files, 412 files in the git index     ← what it read
        1 historical entry exempt from path checks      ← what it skipped on purpose

CASE MISMATCH  (1)   resolves on Windows and macOS, breaks on Linux and CI
  CLAUDE.md:18                                          ← file and line
      layouts/AppLayout.vue                             ← what your note says
      ->  resources/js/Layouts/AppLayout.vue            ← what the repository has

BROKEN LINK  (2)   1 with a likely destination
  [[deploy-checklist]]   ->  deploy_checklist           ← the file it probably meant
  [[old-architecture]]                                  ← no candidate: renamed or deleted

MISSING PATH  (1)   paths cited to say they are gone were filtered out
  docs/setup.md:44  config/database.php                 ← file, line, dead path
      Copy the template into `config/database.php`…     ← the sentence, so you can judge

4 to review                                             ← 1 + 2 + 1
```

Every finding gives you **the file, the line number, and the fix**. Nothing is guessed, and nothing is changed.

---

## What each finding means, and what to do

### 1. `CASE MISMATCH` — the letters disagree

**What it means.** Your note writes a path with different capitalisation than the repository actually uses. `prumo` compares against the **git index**, which is the only place that stores the real spelling. Your filesystem will happily lie about this on Windows and macOS.

**Why it matters.** It works on your machine and fails on Linux, in CI, and in Docker — the classic "but it works here" bug.

**What to do.** Copy the path after the `->` into your note. That is the real one.

---

### 2. `BROKEN LINK` — a `[[link]]` to nothing

**What it means.** You wrote `[[some-note]]`, or a markdown link like `[Setup](docs/setup.md)`, and the target does not exist.

**Why it matters.** An agent following that link finds nothing and moves on silently.

**What to do.**
- **If a `-> suggestion` is shown**, that is almost certainly the file you meant — usually the two disagree only in `-` versus `_`. Fix whichever side is wrong.
- **If no suggestion is shown**, the target was renamed or deleted. Update the link or remove it.

> **Tip.** Seeing hundreds of these usually means one systematic cause, not hundreds of mistakes. In the run above, every link was written in `kebab-case` while every file was named in `snake_case`. Renaming the files fixed 247 of them at once.

---

### 3. `MISSING PATH` — the file is gone

**What it means.** Your note points at a file that no longer exists anywhere in the repository.

**What to do.** Either update the path, or — if you are mentioning it *because* it is gone — rephrase so the sentence says so. `prumo` recognises phrasing like *"was removed"*, *"no longer exists"*, *"renamed to"*, and will then stay quiet.

---

### 4. `NOT IN INDEX` *(only when you pass a folder of notes)*

**What it means.** A note exists in the folder but your `MEMORY.md` index never mentions it — so nothing ever leads a reader to it.

**What to do.** Add it to the index, or delete the file.

---

## Installing

You do not have to install anything — `npx prumo` always works. But if you use it often:

```bash
# available everywhere on your machine
npm install -g prumo
prumo

# or as a dev dependency of one project
npm install --save-dev prumo
npx prumo
```

---

## All the options

```
prumo [repo] [target...] [options]
```

| Argument | Meaning |
| --- | --- |
| `repo` | Path to a git repository. Defaults to the current folder. |
| `target` | A markdown file, or a folder of them. Omit it and `prumo` auto-detects (see below). |

| Option | Meaning |
| --- | --- |
| `--fix` | Correct case mismatches in place; nothing else is touched |
| `--format F` | `text` (default), `github`, or `json` |
| `--all` | Show every finding instead of the first 25 |
| `--json FILE` | Also write the findings to `FILE` as JSON |
| `--quiet` | Print nothing; just use the exit code |
| `--no-config` | Ignore `.prumorc.json` |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

**Files found automatically**

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
| Any | `MEMORY.md`, `COPILOT.md` |

**Monorepos are covered.** `CLAUDE.md` and `AGENTS.md` are also picked up from subfolders — `packages/api/AGENTS.md` is read the same as the one at the root.

### Examples

```bash
prumo                                  # this repository, auto-detected files
prumo .                                # the same, written explicitly
prumo . docs/notes                     # also sweep a folder of markdown
prumo ~/work/api                       # a repository somewhere else
prumo . --all                          # do not truncate the list
prumo . --json findings.json           # save the findings as JSON

# Windows: quote any path containing spaces
prumo "C:/Users/me/My Project"
```

### Exit codes

| Code | Meaning |
| :---: | --- |
| `0` | Nothing to review |
| `1` | Findings — something needs your attention |
| `2` | Bad usage (not a git repo, no files found, unknown option) |

---

## Running it in CI

Because it exits non-zero on findings, it drops into any pipeline as one step:

```yaml
# .github/workflows/docs.yml
name: docs
on: [push, pull_request]
jobs:
  prumo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx prumo --quiet
```

> **Important.** Use `actions/checkout` normally — `prumo` needs the git index, so a checkout without it will not work.

---

## Silencing a finding

`prumo` will eventually flag something you know is fine. There are two ways to say so — use the narrowest one that works.

**Inline**, when it is one line:

```markdown
Legacy note about `config/old.php`. <!-- prumo-ignore -->

<!-- prumo-ignore-next-line -->
Another about `config/older.php`.

<!-- prumo-ignore-file -->
```

**`.prumorc.json`** at the repository root, when it is a pattern:

```jsonc
{
  "ignore":    ["docs/legacy/**", "config/vendor.php"],  // paths and links to skip
  "exclude":   ["CHANGELOG.md"],                         // context files not to check
  "targets":   ["CLAUDE.md", "docs/notes"],              // check these instead of auto-detecting
  "transient": ["public/dist", "coverage-html"]          // extra build output to ignore
}
```

`ignore`, `exclude` and `transient` take globs (`*`, `**`, `?`). Run with `--no-config` to bypass the file once. Every suppression is counted in the header, so a silenced repository never looks like a clean one.

---

## Fixing the case automatically

```bash
prumo --fix
```

```
FIXED  1 path in 1 file
  CLAUDE.md:18   layouts/AppLayout.vue  ->  resources/js/Layouts/AppLayout.vue
```

**Only case mismatches are fixed, and that is the point.** Their correct value is *read from the git index*, not guessed — so the rewrite cannot invent anything. Broken links and missing paths are never touched, because there the right answer needs a human: a link suggestion is a heuristic, and a missing path may be missing on purpose.

A line that changed since the scan is skipped and reported rather than rewritten.

---

## Output for CI

```bash
prumo --format github
```

```
::error file=CLAUDE.md,line=18::Case mismatch: layouts/AppLayout.vue should be resources/js/Layouts/AppLayout.vue
```

GitHub renders these as annotations **on the exact line of the pull request**, instead of burying them in the job log. Use `--format json` to pipe the findings somewhere else.

---

## Common questions

<details>
<summary><b>Does it send my code anywhere?</b></summary>

No. `prumo` makes no network calls at all. It reads your markdown, runs `git ls-files`, and prints. No telemetry, no account, no API key, and no model — it is a plain static checker that works offline.
</details>

<details>
<summary><b>Does it change my files?</b></summary>

Never. It only reads. Every finding is printed with the file, the line, the wrong value and the right one, and the edit is yours. That is deliberate: a note corrected wrongly is worse than a stale one, because you stop doubting it.
</details>

<details>
<summary><b>Do I need Claude Code? Does it work with my agent?</b></summary>

You need no agent at all. `prumo` reads files, not agents — see the table above for the nine tools it detects automatically. If you keep engineering notes in `docs/`, point it there: those rot the same way.
</details>

<details>
<summary><b>Does it work outside JavaScript projects?</b></summary>

Yes. It reads markdown and the git index, so it is language-agnostic. It was built and measured against two PHP + Vue codebases, and the path checks recognise the conventional roots of Python, Go, Rust, Ruby and Java projects.
</details>

<details>
<summary><b>Why not just use markdownlint, or a link checker?</b></summary>

Those check a document against **itself** — syntax, style, links between pages. `prumo` checks a document against **the code beside it**, which is the thing that moved. And the case check needs the git index specifically: a plain `exists()` test passes on Windows and macOS for a path that is dead on Linux, so a generic checker cannot see it at all.
</details>

<details>
<summary><b>How often should I run it?</b></summary>

Once in CI on every pull request is the cheap answer — it takes seconds and needs no configuration. Otherwise, run it whenever you touch the context file, and after any rename or large refactor, which is when documentation drifts fastest.
</details>

---

## Something went wrong?

<details>
<summary><code>prumo: not a git repository</code></summary>

`prumo` reads the git index to know the true spelling of every path, so it must run inside a repository.

```bash
cd /path/to/your/project   # go into the repository
prumo
# or point at it from anywhere
prumo /path/to/your/project
```
</details>

<details>
<summary><code>prumo: no context files found</code></summary>

There is no `CLAUDE.md`, `AGENTS.md` or similar in that repository. Either create one, or tell `prumo` what to read:

```bash
prumo . docs/architecture.md    # one file
prumo . docs/                   # every .md in a folder
```
</details>

<details>
<summary>It reports nothing, but I am sure something is stale</summary>

That is expected, and it is a design decision. `prumo` only checks paths, letter case and links — the things a machine can verify **exactly**. It does not judge whether a sentence like *"this flag disables caching"* is still true. See [Why so few checks](#why-so-few-checks).
</details>

<details>
<summary>It flagged a line that is actually correct</summary>

Read the sentence before changing anything — that is the rule the whole tool is built on. Two cases are already filtered out automatically:

- a path named **because it is gone** — *"the project does not publish `config/dompdf.php`"*
- a **historical** note, such as `phase-3-complete.md`, whose whole content is what got removed

If yours slipped through, the usual fix is a clearer sentence. The filter reads a paragraph around the line, in English and Portuguese.
</details>

<details>
<summary>Node version errors, or <code>Unexpected token</code></summary>

You are on a Node older than 18. Check with `node --version` and upgrade at [nodejs.org](https://nodejs.org).
</details>

<details>
<summary>Windows: the path is not recognised</summary>

Quote paths that contain spaces, and prefer forward slashes:

```bash
prumo "C:/Users/me/My Project"
```
</details>

---

## Why so few checks

The obvious feature is "check every symbol in the notes against the codebase". It was built, run against two production repositories, and thrown away.

The measurement: seven audits of the same corpus — six by hand, one by this tool. Across roughly **512 alerts, ten were real**. A detector at **2% precision** is one nobody runs twice, because reading the noise costs more than the rot does.

So `prumo` keeps only checks that are nearly always right, and spends most of its code on *not* crying wolf:

| Filter | Why it exists |
| --- | --- |
| Negation, read across a paragraph | *"the project does not publish `config/x.php`"* names a file that **must not** exist. A grep sees a dead path; a reader sees a correct sentence. |
| Historical notes exempt | An entry titled *phase 3 complete* cites what was later removed. That is its content, not a defect. |
| Transient artifacts ignored | `public/build`, `.vite`, `node_modules`, `dist` — born and dying outside git. |
| Aliases and short paths resolved | `@/utils/foo.js` and `tests/Concerns/ReadsPdf` are real references, written short. |

The effect, same tool, same files:

| Target | Files | Before filters | After |
| --- | ---: | ---: | ---: |
| Notes folder, project A | 206 | 229 | **1** |
| `CLAUDE.md`, project A | 1 | 4 | **0** |
| Notes folder, project B | 66 | 251 | **10** |
| `CLAUDE.md`, project B | 1 | 8 | **1** |

---

## What it will never do

- **Judge a claim.** *"This flag does X"* is beyond it, on purpose.
- **Edit your files.** It prints; you decide. A note corrected wrongly is worse than a stale one, because you stop doubting it.
- **Phone home.** No network calls, no telemetry, no account, no model.

---

## Using it from code

```js
import { analyze, resolveTargets } from 'prumo';

const targets = resolveTargets('.', []);          // [] = auto-detect
const result  = analyze({ repo: '.', targets });

console.log(result.caseMismatch);   // [{ file, line, cited, actual }]
console.log(result.brokenLinks);    // [{ file, line, cited, suggestion }]
console.log(result.missingPaths);   // [{ file, line, cited, excerpt }]
console.log(result.orphans);        // ['note-nobody-links-to.md']
console.log(result.stats);          // { tracked, targets, historical }
```

---

## Development

```bash
git clone https://github.com/TomD4vs/prumo.git
cd prumo
node --test          # 22 tests, no dependencies
node bin/prumo.mjs . # run it on itself
```

Every test builds a throwaway git repository, so the suite needs no fixtures checked in and leaves nothing behind. CI runs it on Linux, Windows and macOS against Node 18, 20 and 22 — the case check behaves differently per platform, so all three matter.

---

## Why the name

**prumo** *(Portuguese)* is a plumb line — the weighted string a mason hangs against a wall to find out whether it is still **true**, which in English is also the carpentry word for "aligned".

Documentation drifts exactly the way a wall does: slowly, invisibly, until something is built against it.

## Requirements

Node 18 or newer, and `git` on the `PATH`. Zero dependencies.

## License

MIT
