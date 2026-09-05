# Agents

[← README](../README.md) · [Ler em português](agents.pt-BR.md)

Every way to wire prumo into a coding agent, from asking once to a hook that fires on every edit. The README shows the short form of each; this page has the full configuration.

---

## Ask the agent to run it

`npx @tomd4vs/prumo` works in any git repository, and covers skills installed under `.claude/skills/` on its own. For a repository that is itself a skill, name the file:

```bash
npx @tomd4vs/prumo . SKILL.md
```

The text output names the file, the line and the correction, which is enough for an agent to act on without parsing. `--format json` returns the same findings as structured data; their shape is in the [API](api.md).

---

## Expose it as a tool

The package ships `prumo-mcp`, an MCP server over stdio with four tools: `prumo_check`, which is read only, `prumo_fix`, which rewrites letter case and the renames git recorded, and the two reports, `prumo_drift` and `prumo_budget`, read only as well. The agent decides when to call them and reads the same report as the CLI, plus the findings as structured data.

In Claude Code:

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

---

## Add a slash command

A file at `.claude/commands/prumo.md` turns the check into `/prumo`:

```markdown
Run `npx @tomd4vs/prumo` and fix every finding it reports.
```

---

## Run it automatically after edits

In Claude Code, a `PostToolUse` hook in `.claude/settings.json` fires after the agent writes a file. Running prumo on every write would be noisy, so the hook filters first and runs prumo only when the file was a context file:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "node -e 'let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>{const p=((JSON.parse(d).tool_input||{}).file_path||\"\").split(\"\\\\\").join(\"/\");process.exit(/(^|[/])(CLAUDE([.]local)?[.]md|AGENTS?[.]md|(GEMINI|COPILOT|JULES|CONVENTIONS|MEMORY)[.]md|[.](cursor|cline|windsurf)rules|copilot-instructions[.]md)$|(^|[/])[.](cursor|windsurf|roo)[/]rules[/]|(^|[/])[.]github[/]instructions[/]|(^|[/])[.]claude[/]commands[/]|[/]SKILL[.]md$/i.test(p)?0:1)})' && npx @tomd4vs/prumo || true"
      }]
    }]
  }
}
```

The hook receives the tool call as JSON on stdin. The `node -e` filter reads `tool_input.file_path`, turns Windows backslashes into slashes, and exits non-zero unless the path is one prumo would detect on its own. The pattern mirrors the list in [src/check.mjs](../src/check.mjs), so prumo runs only when a context file changed. It uses node rather than `jq` because anyone running prumo already has node. The trailing `|| true` keeps a finding from blocking the turn: prumo's output lands in the transcript, the agent sees it and can fix it in the same turn.

On Windows, Claude Code runs hooks in Git Bash when it is installed and in PowerShell when it is not, and the command above is written for bash. Without Git Bash, use this hook instead. It declares its shell and does the same filtering in PowerShell:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "shell": "powershell",
        "command": "$p = (ConvertFrom-Json ([Console]::In.ReadToEnd())).tool_input.file_path -replace '\\\\','/'; if ($p -match '(^|/)(CLAUDE(\\.local)?\\.md|AGENTS?\\.md|(GEMINI|COPILOT|JULES|CONVENTIONS|MEMORY)\\.md|\\.(cursor|cline|windsurf)rules|copilot-instructions\\.md)$|(^|/)\\.(cursor|windsurf|roo)/rules/|(^|/)\\.github/instructions/|(^|/)\\.claude/commands/|/SKILL\\.md$') { npx @tomd4vs/prumo }; exit 0"
      }]
    }]
  }
}
```

Both blocks are exercised by [the simulation](api.md#development) on every release, against real `PostToolUse` payloads.
