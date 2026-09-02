# Memory — prumo

> Design decisions that the code cannot state on its own: why the tool is this small, what it
> refuses to do, and what it cost to find out. One fact per file, one line per entry here.
> `prumo . memory` checks this folder, which is also the tool's own dogfood.

## Design

- [Three checks, and the 2% that killed the rest](three-checks-and-the-two-percent.md) — generic symbol checking measured ~2% precision over seven audits and was removed
- [The git index, never the filesystem](git-index-not-the-filesystem.md) — `existsSync` lies about letter case on Windows and macOS; ⚠️ match by **suffix**, not prefix
- [Filters are the product](filters-are-the-product.md) — the five false-positive families; ⚠️ the worst one is a correct sentence
- [Naming and scope](naming-and-scope.md) — why `prumo`, what was rejected, and the two things it will never grow into

## Building it

- [A second repository revealed the overfitting](tested-on-a-second-repo.md) — 8 findings, 8 tool bugs; the suite then found 2 more that Portuguese notes could never show
- [Development gotchas](development-gotchas.md) — `node --test` under Git Bash, headless render of the social card, the argv off-by-one that passed by accident
