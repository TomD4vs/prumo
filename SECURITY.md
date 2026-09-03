# Security

[← README](README.md) · [Ler em português](SECURITY.pt-BR.md)

## Reporting a vulnerability

Use GitHub's private reporting: **[Report a vulnerability](https://github.com/TomD4vs/prumo/security/advisories/new)**.
It is private until a fix is published. Please don't open a public issue for something exploitable.

This is a small project with one maintainer, so expect a first reply in days rather than hours. Only
the latest published version gets fixes; there are no maintained older branches.

If prumo flagged a line that is correct, that is a false positive rather than a vulnerability, and
[CONTRIBUTING.md](CONTRIBUTING.md) says where it goes.

---

## What prumo can reach

Most of the answer is that there is very little to reach.

- **No network access, at any point.** No telemetry, no account, no model, no update check. The
  package has zero dependencies, so nothing it installs can make a call either.
- **It runs `git`, with fixed commands.** `git ls-files`, `git check-ignore` and `git rev-parse`,
  all three written as constants. The repository path you pass becomes the child process's working
  directory and is never built into a command string, and the file paths handed to `git check-ignore`
  go in over stdin. A folder whose name contains shell characters is a folder name.
- **It reads, and it writes almost nothing.** It reads your context files and the git index. The
  only write is `--fix`, or `prumo_fix` over MCP, and it only rewrites letter case on lines it has
  already reported, to the spelling the index holds.

## The MCP server

`prumo-mcp` speaks JSON-RPC over stdin and stdout and listens on no port. It takes a repository path
and a list of targets from whatever agent starts it, so it can read any repository that agent can
already read, and `prumo_fix` can rewrite case in files that agent can already write. Start it only
from an agent you trust with the folder.
