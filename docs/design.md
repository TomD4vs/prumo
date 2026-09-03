# Design

[← README](../README.md) · [Ler em português](design.pt-BR.md)

Why prumo checks so little, what that cost to find out, how a path is resolved, and where the name comes from.

---

## Why so few checks

The obvious feature is checking every symbol in the notes against the codebase. An early prototype did exactly that. Run against two production repositories, it raised roughly **512 alerts, of which ten were real**. That is about 2% precision, checked against what seven reviews of the same material had found, six of them done by hand. That checker was removed. A detector that is wrong 98% of the time is one nobody runs twice, because reading the false alarms costs more than the stale documentation they were meant to catch.

What shipped does the opposite: only the checks that are almost always right, with most of the code spent on keeping them quiet:

| Filter | Why it exists |
| --- | --- |
| Negation, read across a paragraph | *"the project does not publish `config/x.php`"* names a file that must **not** exist. A grep sees a dead path; a reader sees a correct sentence. |
| Historical notes exempt | An entry titled *phase 3 complete* cites what was later removed. That is its subject, not a defect. |
| Transient artifacts ignored | `public/build`, `.vite`, `node_modules`, `dist` are born and die outside git. |
| Aliases and short paths resolved | `@/utils/foo.js` and `tests/Concerns/ReadsPdf` are real references written in shorthand. |
| Anything only the author knows is fine | `.prumorc.json` and the `prumo-ignore` markers. Every suppression is counted in the header, so a silenced repository never reads as a clean one. |

Same tool, same files, with and without the filters:

| Target | Files | Before filters | After |
| --- | ---: | ---: | ---: |
| Notes folder, project A | 206 | 229 | **1** |
| `CLAUDE.md`, project A | 1 | 4 | **0** |
| Notes folder, project B | 66 | 251 | **10** |
| `CLAUDE.md`, project B | 1 | 8 | **1** |

Those columns count false alarms removed; they are not a precision figure. prumo's own precision was never measured on a project before prumo cleaned it. The two projects above have been maintained with prumo since, so what is left in them is what prumo cannot resolve, not a sample of what it catches.

Three things stay out of scope by design. prumo does not judge claims, since *"this flag does X"* needs a model. It does not edit beyond case, since a note corrected wrongly is worse than a stale one. And it makes no network calls at all.

Two rules follow from the measurement. No check is added before its precision is measured on a real project. Finding more is easy; being right is the whole product, and a check that flags something correct once a week gets the whole tool uninstalled. And if a semantic layer is ever added, a model judging whether a statement still holds, it goes behind a separate command the user turns on, with its precision published before release. Folding it into the default run would undo the reason the tool is trusted.

---

## How a path is resolved

The git index is the only source that stores a path's true letter case. `existsSync` returns `true` for the wrong case on Windows and macOS, so a check built on it passes locally and misses the defect entirely. That is the reason the case check exists at all: a note saying `layouts/AppLayout.vue` when the repository holds `resources/js/Layouts/AppLayout.vue` opens fine on the author's machine and points at nothing on Linux and in CI.

`resolvePath` in [src/check.mjs](../src/check.mjs) therefore tries, in this order: an exact match in the index; a case-insensitive match, which becomes a `CASE MISMATCH` finding; and only then `existsSync`, as a last resort for files git does not track. That order is not to be changed.

Two consequences follow. A cited path is matched by how it ends, not how it starts, because notes write paths in short relative form (`pages/Auth/Login.vue`) far more often than in full. A search that starts from `resources/js/pages/` misses every one of them; that is how four wrong paths survived six hand-run audits, one of them for two months. And CI runs on Linux, Windows and macOS for this reason alone: the behaviour under test changes with the filesystem, so a green run on one platform proves nothing about the others.

---

## About the name

*Prumo* is Portuguese for a plumb line, the weighted string a mason hangs against a wall to find out whether it is still **true**, which in English is also the carpentry word for aligned.

Documentation drifts the way a wall does: slowly, invisibly, until something is built against it.
