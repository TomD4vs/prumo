---
name: development-gotchas
description: "Things that cost time while building prumo: the test runner path on Git Bash, headless rendering of the social card, and the CLI argument off-by-one"
metadata:
  type: reference
---

**`node --test test/` fails under Git Bash on Windows.** The path argument is mangled and Node tries to load a module literally named `test`. Use `node --test` with no argument and let it discover `**/*.test.mjs`. That is what `npm test` runs.

**The social card is rendered, not drawn by hand.** `assets/social.html` is screenshotted headlessly at 1280×640:

```bash
msedge --headless=new --disable-gpu --no-first-run --user-data-dir=<tmp> \
  --window-size=1280,640 --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=6000 --screenshot=assets/social.png \
  "file:///<abs>/assets/social.html"
```

⚠️ `--virtual-time-budget` is required, otherwise the shot lands before the web fonts load and the card renders in a fallback face.

**An argument off-by-one shipped and passed its first test by accident.** Filtering flag values with `i !== jsonAt + 1` drops **argv[0]** when `--json` is absent, because `jsonAt` is `-1`. The first test passed only because the repository argument fell back to `.` and the shell happened to be in the right directory. Guard the index explicitly.

⚠️ **Test the CLI from a different working directory than the repository being checked.** Running it from inside the target hides exactly this class of defect.

Related: [[tested-on-a-second-repo]].
