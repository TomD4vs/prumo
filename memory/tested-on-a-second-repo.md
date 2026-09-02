---
name: tested-on-a-second-repo
description: "Running the prototype against a second codebase exposed three bugs that a single corpus could never show — and the test suite later found two more"
metadata:
  type: feedback
---

The prototype was calibrated on one repository and looked finished. **Pointed at a second one, it produced eight findings and all eight were false positives caused by bugs in the tool**, not noise:

- an artisan-style command (`domain:action`) never matched, because the tokenizer split on `:`
- a directory reference (`components/ui`) never matched, because suffix comparison ran against files only, never directories
- a name fragment (`create_users`) never matched, because the index held only the whole token `create_users_table`

**How to apply:** a checker calibrated on one corpus is overfitted to it, and you cannot see that from inside. Before releasing, run it against a codebase you did not design it on — ideally in a different language or framework.

The pattern repeated once the suite existed. **Two more defects surfaced the first time the tests ran**, both invisible in Portuguese-language notes:

- the English negation list covered *"does not exist"* but not *"does not publish"*, the more natural phrasing
- the historical-entry pattern matched `phase2complete` but not `phase-2-complete`, the common form

And a third, from a config test: `analyze()` did not load `.prumorc.json` — only the CLI did — so the library silently behaved differently from the command.

⚠️ Twice the failing test was **right and the code was wrong**; once the assertion itself was wrong (it demanded the header count files that had been excluded, which would be a lie in the output). Read the failure before assuming which side is at fault.

Related: [[git-index-not-the-filesystem]], [[development-gotchas]].
