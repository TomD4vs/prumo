---
name: three-checks-and-the-two-percent
description: "Generic symbol checking was built, measured at ~2% precision over seven audits, and removed — this is why prumo does so little"
metadata:
  type: project
---

The obvious feature — "check every symbol in the context file against the codebase" — **was built, run against two production repositories, and thrown away**.

**Why:** ground truth came from seven audits of the same corpus, six by hand and one by an early version of this tool. Across roughly **512 alerts, ten were real**. At ~2% precision nobody runs a detector twice, because reading the noise costs more than the rot does.

**How to apply:** do not add a check without measuring its precision on a real corpus first. Recall is cheap and worthless here; precision is the entire product. A check that fires on something correct once a week will get the whole tool uninstalled.

What survived, and the measured effect of the filters on the same files:

| Target | Files | Before filters | After |
| --- | ---: | ---: | ---: |
| Notes folder, project A | 206 | 229 | 1 |
| `CLAUDE.md`, project A | 1 | 4 | 0 |
| Notes folder, project B | 66 | 251 | 10 |
| `CLAUDE.md`, project B | 1 | 8 | 1 |

⚠️ If a semantic layer is ever added — a model judging whether a *statement* still holds — it belongs behind a separate opt-in command, with its measured precision published before release. Folding it into the default run would undo the reason this tool is trusted.

Related: [[filters-are-the-product]], [[git-index-not-the-filesystem]].
