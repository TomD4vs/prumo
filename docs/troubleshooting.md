# Troubleshooting and questions

[← README](../README.md) · [Ler em português](troubleshooting.pt-BR.md)

---

## Troubleshooting

<details>
<summary><code>prumo: not a git repository</code></summary>

prumo reads the git index to learn the true spelling of every path, so it has to run against a repository.

```bash
cd /path/to/your/project
prumo

# or point at it from anywhere
prumo /path/to/your/project
```

A skill installed under your home folder, such as `~/.claude/skills/<name>/`, is outside any repository, so prumo cannot read it there. Check it where it is published, or run `git init` inside the skill folder first.
</details>

<details>
<summary><code>prumo: the git index is empty</code></summary>

The repository has nothing committed or staged, so there is nothing to compare the notes against; every path would come out as missing. Run `git add` on the files first. The same message appears when a clone was cut short, for instance by a path too long for Windows.
</details>

<details>
<summary><code>prumo: target not found</code></summary>

A file or folder named on the command line, or under `targets` in `.prumorc.json`, is not there. prumo stops instead of checking something else, so a typo never comes back as a clean report about a different file:

```bash
prumo . docs/architecture.md    # the name has to exist
```

The path is read from the repository folder, not from where you are standing, unless you write it absolute.
</details>

<details>
<summary><code>prumo: no context files found</code></summary>

There is no `CLAUDE.md`, `AGENTS.md` or equivalent in that repository. Create one, or name what to read:

```bash
prumo . docs/architecture.md    # one file
prumo . docs/                   # the .md files directly in a folder
```
</details>

<details>
<summary>It reports nothing, but something is clearly stale</summary>

Expected. prumo checks paths, letter case and links, which is what can be verified exactly. It does not assess whether a sentence such as *"this flag disables caching"* is still accurate. See [Why so few checks](design.md#why-so-few-checks).
</details>

<details>
<summary>It flagged a line that is correct</summary>

Read the sentence before changing anything. Three cases are already filtered automatically: a path named *because it is gone*, as in *"the project does not publish `config/dompdf.php`"*; a historical note such as `phase-3-complete.md` whose whole subject is what got removed; and a path that `.gitignore` covers, which is absent on purpose.

Three more are not, because they need judgement:

- A recipe that tells the reader to create the file, as in *"copy the template into `config/database.php`"*. The path is correct and the file is meant not to exist yet. Add `<!-- prumo-ignore -->` to that line.
- A `[[wikilink]]` to a note kept in another folder. Pass both folders in one run, `prumo . notes-a notes-b`, and the link resolves.
- A page that a build step generates, such as a documentation site's landing page. List it under `ignore` in `.prumorc.json`, or add it to `.gitignore` if it is never meant to be tracked.

If yours slipped through, a clearer sentence is usually the fix. The filter reads a paragraph of context, in English and Portuguese.
</details>

<details>
<summary>Node version errors, or <code>Unexpected token</code></summary>

You are on a Node older than 18. Check with `node --version` and upgrade at [nodejs.org](https://nodejs.org).
</details>

<details>
<summary>Windows: the path is not recognised</summary>

Quote paths containing spaces, and prefer forward slashes:

```bash
prumo "C:/Users/me/My Project"
```
</details>

---

## Questions

<details>
<summary><b>Does it send my code anywhere?</b></summary>

No. prumo makes no network calls. It reads your markdown, runs `git ls-files`, and prints. There is no telemetry, account, API key or model involved; it is a static checker and works offline.
</details>

<details>
<summary><b>Does it change my files?</b></summary>

Only with `--fix`, and then only case mismatches. By default it reads and prints, and the edit is yours to make.
</details>

<details>
<summary><b>Do I need Claude Code? Does it work with my agent?</b></summary>

No agent is required. prumo reads files, not agents, and the [reference](reference.md#files-found-automatically) lists every file and folder it detects automatically. Engineering notes kept in `docs/` go stale the same way, so point it there too.
</details>

<details>
<summary><b>Does it work outside JavaScript projects?</b></summary>

Yes. It reads markdown and the git index, so it is language-agnostic. It was built and measured against two PHP and Vue codebases, then checked against public repositories in Go, C++, Python and TypeScript, and the path checks recognise the conventional roots of Python, Go, Rust, Ruby and Java projects.
</details>

<details>
<summary><b>Why not markdownlint, or a link checker?</b></summary>

Those check a document against itself: syntax, style, links between pages. prumo checks it against the code beside it, which is the part that moved. The case check also needs the git index specifically, because a plain `exists()` test passes on Windows and macOS for a path that is dead on Linux.
</details>

<details>
<summary><b>How often should I run it?</b></summary>

Once per pull request in CI is the cheapest answer, since it takes seconds and needs no configuration. Otherwise run it after renames and large refactors, when documentation goes stale fastest.
</details>
