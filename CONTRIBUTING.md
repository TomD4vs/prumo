# Contributing

[← README](README.md) · [Ler em português](CONTRIBUTING.pt-BR.md)

Before anything else, read [docs/design.md](docs/design.md). It explains why prumo checks so
little and what it cost to find that out. A pull request that adds a check without reading it
will almost certainly be turned down.

---

## The bar for a new check

prumo raises three kinds of finding, and that number is the result of a measurement, not of how
much time there was. An early prototype checked every symbol in the notes against the code. On
two production repositories it raised roughly 512 alerts, of which ten were real. It was removed.

So a new check needs its precision measured on real repositories before it can be proposed, not
after. Clone a handful of projects nobody has checked before, run your branch against them, and
classify every finding by hand as real or false. Bring those numbers with the pull request. If a
check cannot be measured that way yet, say so and open an issue instead.

**A false positive is the worst bug this tool can have.** Someone who reads two wrong findings
stops reading the third. A missed finding costs nothing by comparison, which is why the filters
are most of `src/check.mjs`.

## Running it

```bash
npm test                      # the analysis, against throwaway git repositories
npm run simulate              # packs the tarball, installs it, follows the docs through the CLI
npm run simulate -- --registry   # the same, against the published version
```

`npm test` exercises `analyze()`. `npm run simulate` exercises what the documentation promises:
it runs `npm pack`, installs that tarball into a fresh project, and then follows the README, the
troubleshooting page and the MCP setup literally, comparing the output to what the pages show.
Both run on Linux, Windows and macOS in CI.

## What a change should carry

- **A test that fails without it.** Check out the previous commit into a copy of the tree and run
  the new test there. If it passes, it is not testing your change.
- **The documentation, in both languages.** Every page under `docs/` has a `.pt-BR.md` twin with
  the same structure. Portuguese is written, not translated.
- **No dependencies.** prumo ships with none and reads nothing from the network. A change that
  needs a package needs a good argument first.
- **No comments inside a function body.** `AGENTS.md` has the rest of the house style.

## Reporting a finding that is wrong

If prumo flagged a line that is correct, that is a bug worth an issue. Include the line from your
context file, the path it named, and what the file is really called. [Troubleshooting](docs/troubleshooting.md)
lists the families already known, and `.prumorc.json` will silence it in the meantime.
