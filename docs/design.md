# Design

[← README](../README.md) · [Ler em português](design.pt-BR.md)

Why prumo checks so little, what that cost to find out, how a path is resolved, and where the name comes from.

---

## Why so few checks

The obvious feature is checking every symbol in the notes against the codebase. An early prototype did exactly that. Run against two production repositories, it raised roughly **512 alerts, of which ten were real**: about 2% precision, measured against ground truth from seven audits of the same corpus, six of them by hand. That checker was removed. A detector that is wrong 98% of the time is one nobody runs twice, because reading the noise costs more than the rot.

What shipped is the opposite bet: only the checks that are almost always right, with most of the code spent on suppression:

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

Those columns measure noise removed, not precision. prumo's own precision was never tabulated on a corpus before its first cleanup, and the corpora available today have already been maintained with it, so what remains there is the residue it cannot resolve rather than a sample of what it catches.

Three things stay out of scope by design. prumo does not judge claims, since *"this flag does X"* needs a model. It does not edit beyond case, since a note corrected wrongly is worse than a stale one. And it makes no network calls at all.

Two rules follow from the measurement. No check is added without its precision measured on a real corpus first; recall is cheap here and precision is the entire product, and a check that fires on something correct once a week gets the whole tool uninstalled. And if a semantic layer is ever added, a model judging whether a statement still holds, it belongs behind a separate opt-in command with its precision published before release. Folding it into the default run would undo the reason the tool is trusted.

---

## How a path is resolved

The git index is the only source that stores a path's true letter case. `existsSync` returns `true` for the wrong case on Windows and macOS, so a check built on it passes locally and misses the defect entirely. That is the reason the case check exists at all: a note saying `layouts/AppLayout.vue` when the repository holds `resources/js/Layouts/AppLayout.vue` opens fine on the author's machine and points at nothing on Linux and in CI.

`resolvePath` in [src/check.mjs](../src/check.mjs) therefore tries, in this order: an exact match in the index; a case-insensitive match, which becomes a `CASE MISMATCH` finding; and only then `existsSync`, as a last resort for files git does not track. That order is not to be changed.

Two consequences follow. Paths are matched by suffix, not prefix, because notes cite them in relative form (`pages/Auth/Login.vue`) far more often than in full; a prefix search from `resources/js/pages/` misses every one of them, which is how four wrong paths survived six hand-run audits, one of them for two months. And CI runs on Linux, Windows and macOS for this reason alone: the behaviour under test differs per filesystem, so a green run on one platform proves nothing about the others.

---

## About the name

*Prumo* is Portuguese for a plumb line, the weighted string a mason hangs against a wall to find out whether it is still **true**, which in English is also the carpentry word for aligned.

Documentation drifts the way a wall does: slowly, invisibly, until something is built against it.
