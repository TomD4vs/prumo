---
name: git-index-not-the-filesystem
description: "Path checks must read the git index, never existsSync — the filesystem lies about letter case on Windows and macOS, which is the exact bug the tool exists to catch"
metadata:
  type: project
---

**The git index is the only source that stores a path's true letter case.** `existsSync` returns `true` for the wrong case on Windows and macOS, so a check built on it passes locally and misses the defect entirely.

That is not a detail — it is the reason the case check exists. A note saying `layouts/AppLayout.vue` when the repository holds `resources/js/Layouts/AppLayout.vue` opens fine on the author's machine and points at nothing on Linux and in CI.

**How to apply:** resolution order in `resolvePath` is exact match in the index, then a case-insensitive match (which becomes a `CASE MISMATCH` finding), and only then `existsSync` as a last resort for files git does not track. Never reorder those.

⚠️ **Match by SUFFIX, not by prefix.** Notes cite paths in relative form (`pages/Auth/Login.vue`) far more often than in full. A prefix search for `resources/js/pages/` misses every one of them — that is exactly how four wrong paths survived six hand-run audits of the same files, one of them wrong for two months.

⚠️ **The CI matrix runs Linux, Windows and macOS for this reason alone.** The behaviour under test differs per filesystem, so a green run on one platform proves nothing about the others.

Related: [[three-checks-and-the-two-percent]], [[tested-on-a-second-repo]].
