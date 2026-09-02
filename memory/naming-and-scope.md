---
name: naming-and-scope
description: "Why the tool is called prumo, which names were rejected and why, and the two things it will not grow into"
metadata:
  type: project
---

**prumo** is Portuguese for a plumb line — the weighted string a mason hangs against a wall to find out whether it is still *true*, which in English is also the carpentry word for "aligned". The pun survives translation, which is why it beat the alternatives:

| Rejected | Why |
| --- | --- |
| `fibber` (available) | Names the culprit, not the instrument; and its Portuguese translation, *mentiroso*, is an accusation rather than the affectionate English "fibber" |
| `mothball` (available) | Lovely metaphor, but *"the project was mothballed"* means abandoned |
| `truing`, `retrue` (available) | `truing` reads as *Turing* to a developer; `retrue` is one letter from `retry` |
| `moth`, `plumb`, `sooth`, `wisp`, `argus`, `bitrot` | Taken on npm |

**Check availability at `https://registry.npmjs.org/<name>`** — a 404 means the name is free. An *unpublished* package (`bitrot`) is not reusable, so treat it as taken.

## Out of scope, deliberately

- **Judging claims.** *"This flag does X"* needs a model, and that is a different product — see [[three-checks-and-the-two-percent]].
- **Generating documentation.** It reads and reports; writing docs is somebody else's tool.
- **Editing beyond case.** `--fix` touches only case mismatches, whose correct value is read from the git index rather than guessed. Link suggestions are heuristics and a missing path may be missing on purpose, so both stay untouched.

Related: [[three-checks-and-the-two-percent]], [[filters-are-the-product]].
