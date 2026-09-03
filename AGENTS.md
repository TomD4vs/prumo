# prumo

A zero-dependency CLI that checks whether the context files a coding agent reads
still match the code. Node 18+, ESM, no build step.

## Layout

- `bin/prumo.mjs` — CLI: argument parsing and the report. No analysis lives here.
- `src/check.mjs` — the three checks, exported as `analyze()` and `resolveTargets()`.
- `src/fix.mjs` — the only automatic rewrite: case mismatches.
- `test/check.test.mjs` — the suite. Every test builds a throwaway git repository.
- `docs/design.md` — **read this before changing behaviour.** Why there are only three checks,
  what was measured and rejected, what each filter defends against, and the order in which a
  path is resolved. `docs/api.md` has the development recipes.
- `assets/social.html` — source of `assets/social.png`, rendered headless at 1280x640.

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
- **Precision over recall.** A generic "does this symbol exist" check was built and removed
  after measuring 2% precision across seven audits. Do not add a check without measuring it
  on a real corpus first.
- **Filters are the product.** Most of `check.mjs` exists to stay quiet: negation read across
  a paragraph, historical entries, transient artifacts, aliases and short paths.
- **Never write to the user's files.** The tool reads and reports; the edit is theirs.
- **Comments only where they earn it**: the file header and a docblock on a declaration.
  Nothing inside a function body.

## Before publishing

Run it against a real repository with a large context file, not only against this one.
`--json` output is the stable contract for anything consuming it programmatically.
