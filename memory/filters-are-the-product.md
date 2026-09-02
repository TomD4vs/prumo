---
name: filters-are-the-product
description: "Most of check.mjs exists to stay quiet — the five false-positive families, and why the worst one is a correct sentence"
metadata:
  type: project
---

Most of `src/check.mjs` is not detection, it is **suppression**. The checks themselves are a dozen lines; the rest keeps them from crying wolf.

**The worst false positive is an honest sentence.** A note reading *"the project does not publish `config/dompdf.php`"* names a file that **must not** exist. A grep sees a dead path; a reader sees a correct sentence. This family alone was the largest source of noise.

The five families, and what handles each:

| Family | Handled by |
| --- | --- |
| Path cited *because* it is gone | `NEGATION`, read across a **paragraph** window, in English and Portuguese |
| Historical entry whose content is what was removed | `HISTORICAL_NAME` / `HISTORICAL_DESC` — the whole file is exempt from path checks |
| Build output that never enters git | `TRANSIENT` |
| Real reference written short | alias (`@/x`) and omitted-extension resolution in `resolvePath` |
| Something only the user knows is fine | `.prumorc.json` and the `prumo-ignore` markers |

⚠️ **Negation is matched on a paragraph, not a line.** A line-only window flagged the very note that documents this behaviour, because the explanation and the quoted wrong path sat on different lines.

⚠️ **Every suppression is counted in the header.** A silenced repository must never look like a clean one — otherwise the config becomes a way to hide the problem from yourself.

Related: [[three-checks-and-the-two-percent]].
