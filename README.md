<p align="center">
  <img src="assets/social.png" alt="prumo — is your documentation still true?" width="820">
</p>

<p align="center">
  Checks the context files your coding agent reads against the code beside them.
</p>

<p align="center">
  <a href="LEIAME.md">🇧🇷 Leia em português</a>
</p>

---

## The problem

Three months ago someone wrote this in `CLAUDE.md`:

```markdown
The sidebar logo lives in `layouts/AppLayout.vue`.
```

The folder has since been renamed to `Layouts`, with a capital L. Windows and macOS still open that path, so nothing ever complained. Linux and CI don't, and every agent that reads the file gets sent somewhere that doesn't exist.

That line survived six hand-run audits of the same files. prumo found it in four seconds.

---

## Quick start

You need [Node.js 18+](https://nodejs.org) and `git`. There is nothing to install, configure or sign up for.

From a terminal inside any git repository:

```bash
npx @tomd4vs/prumo
```

prumo locates your context files on its own: `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, `.github/copilot-instructions.md`, installed skills in `.claude/skills/` and the rest. Every file and folder it looks for is in the [reference](docs/reference.md#files-found-automatically).

---

## Reading the result

A clean run:

```
prumo — 1 context file, 401 files in the git index

nothing to review.
```

A run with findings, annotated:

```
prumo — 3 context files, 412 files in the git index           ← what it read
        1 historical entry exempt from path checks            ← what it skipped on purpose

CASE MISMATCH  (1)   resolves on Windows and macOS, breaks on Linux and CI
  CLAUDE.md:18                                                ← file and line
      layouts/AppLayout.vue                                   ← what the note says
      ->  resources/js/Layouts/AppLayout.vue                  ← what the repository has

BROKEN LINK  (2)   1 with a likely destination
  CLAUDE.md:21  [[deploy-checklist]]   ->  deploy_checklist   ← the file it probably meant
  CLAUDE.md:30  [[old-architecture]]                          ← no candidate: renamed or deleted

MISSING PATH  (1)   paths cited to say they are gone were filtered out
  docs/setup.md:44  config/database.php                       ← file, line, dead path
      Copy the template into `config/database.php`…           ← the sentence, so you can judge

4 to review                                                   ← 1 + 2 + 1
```

Every finding carries a file, a line number and the correction. Nothing is guessed and nothing is written. What each finding means, and what to do about it, is in the [reference](docs/reference.md#what-each-finding-means). If it flags a line you know is correct, [Silencing a finding](docs/reference.md#silencing-a-finding) covers the two ways to say so.

---

## What it will not do

Three limits, chosen on purpose and explained in [Design](docs/design.md):

- It does not judge claims. Whether *"this flag disables caching"* is still true needs a model, and that is a different tool.
- It does not edit beyond letter case. A link suggestion is an educated guess, and a missing path may be missing on purpose.
- It makes no network calls. No telemetry, no account, no model.

---

## Installing

`npx @tomd4vs/prumo` works without installing anything. For frequent use:

```bash
npm install -g @tomd4vs/prumo       # available everywhere on your machine
npm install --save-dev @tomd4vs/prumo   # or as a dev dependency of one project
```

Either way the command is `prumo`. Node 18 or newer, `git` on the `PATH`, zero dependencies. Errors at this step, such as an old Node or a folder that isn't a git repository, are in [Troubleshooting](docs/troubleshooting.md).

---

## Using it from an agent

prumo is a plain CLI, so any agent with shell access can run it.

**Ask the agent to run it.** `npx @tomd4vs/prumo` works in any git repository, and covers skills installed under `.claude/skills/` on its own. For a repository that is itself a skill, name the file: `npx @tomd4vs/prumo . SKILL.md`. The text output names the file, the line and the correction, which is enough for an agent to act on without parsing. `--format json` returns the same findings as structured data.

**Run it automatically after edits.** In Claude Code, a `PostToolUse` hook in `.claude/settings.json` fires after the agent writes a file. This one runs prumo only when the file was a context file:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "node -e 'let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>{const p=((JSON.parse(d).tool_input||{}).file_path||\"\").split(\"\\\\\").join(\"/\");process.exit(/(^|[/])(CLAUDE([.]local)?[.]md|AGENTS?[.]md|(GEMINI|COPILOT|JULES|CONVENTIONS|MEMORY)[.]md|[.](cursor|cline|windsurf)rules|copilot-instructions[.]md)$|(^|[/])[.](cursor|windsurf|roo)[/]rules[/]|(^|[/])[.]github[/]instructions[/]|[/]SKILL[.]md$/i.test(p)?0:1)})' && npx @tomd4vs/prumo || true"
      }]
    }]
  }
}
```

The hook receives the tool call as JSON on stdin. The `node -e` filter reads `tool_input.file_path`, turns Windows backslashes into slashes, and exits non-zero unless the path is one prumo would detect on its own. The pattern mirrors the list in [src/check.mjs](src/check.mjs), so prumo runs only when a context file changed. It uses node rather than `jq` because anyone running prumo already has node. prumo's output lands in the transcript, so the agent sees the findings and can fix them in the same turn. The shape of those findings as data is in the [API](docs/api.md).

On Windows, Claude Code runs hooks in Git Bash when it is installed and in PowerShell when it is not, and the command above is written for bash. Without Git Bash, use this hook instead. It declares its shell and does the same filtering in PowerShell:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "shell": "powershell",
        "command": "$p = (ConvertFrom-Json ([Console]::In.ReadToEnd())).tool_input.file_path -replace '\\\\','/'; if ($p -match '(^|/)(CLAUDE(\\.local)?\\.md|AGENTS?\\.md|(GEMINI|COPILOT|JULES|CONVENTIONS|MEMORY)\\.md|\\.(cursor|cline|windsurf)rules|copilot-instructions\\.md)$|(^|/)\\.(cursor|windsurf|roo)/rules/|(^|/)\\.github/instructions/|/SKILL\\.md$') { npx @tomd4vs/prumo }; exit 0"
      }]
    }]
  }
}
```

**Expose it as a tool.** The package also ships `prumo-mcp`, an MCP server over stdio with two tools: `prumo_check`, which is read only, and `prumo_fix`, which rewrites letter case. The agent decides when to call them and reads the same report as the CLI, plus the findings as structured data. In Claude Code:

```bash
claude mcp add prumo -- npx -y -p @tomd4vs/prumo prumo-mcp
```

For any other MCP client, the equivalent configuration is:

```json
{
  "mcpServers": {
    "prumo": { "command": "npx", "args": ["-y", "-p", "@tomd4vs/prumo", "prumo-mcp"] }
  }
}
```

The server makes no network calls of its own and needs no configuration; it checks the repository the client points it at, or the folder it was started in.

**Add a slash command.** A file at `.claude/commands/prumo.md` turns the check into `/prumo`:

```markdown
Run `npx @tomd4vs/prumo` and fix every finding it reports.
```

---

## Continuous integration

prumo exits non-zero on findings, so it drops into a pipeline as a single step:

```yaml
# .github/workflows/docs.yml
name: docs
on: [push, pull_request]
jobs:
  prumo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npx @tomd4vs/prumo --quiet
```

Use `actions/checkout` as normal; prumo reads the git index, so a checkout that omits it will not work. `--format github` turns findings into annotations on the exact line of the pull request. `--quiet`, `--format` and the other options are in the [reference](docs/reference.md#usage).

---

## Documentation

| Page | What it answers |
| --- | --- |
| [Reference](docs/reference.md) | Every option and exit code, what each finding means, how to silence one, what `--fix` touches |
| [Design](docs/design.md) | Why only three checks: the measurement that removed the fourth, and the filters that keep the rest quiet |
| [Troubleshooting](docs/troubleshooting.md) | Error messages, and the questions people ask before adopting it |
| [API](docs/api.md) | Calling it from code, and running the test suite |

## License

MIT
