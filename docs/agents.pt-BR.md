# Agentes

[← README](../LEIAME.md) · [Read in English](agents.md)

Todas as formas de ligar o prumo a um agente de código, do pedido avulso ao hook que dispara a cada edição. O README mostra a forma curta de cada uma; esta página traz a configuração completa.

---

## Peça ao agente para rodar

`npx @tomd4vs/prumo` funciona em qualquer repositório git, e cobre sozinho as skills instaladas em `.claude/skills/`. Para um repositório que é ele mesmo uma skill, nomeie o arquivo:

```bash
npx @tomd4vs/prumo . SKILL.md
```

A saída em texto traz arquivo, linha e correção, o que basta para um agente agir sem precisar interpretar nada. `--format json` devolve os mesmos achados como dados estruturados; o formato deles está na [API](api.pt-BR.md).

---

## Exponha como ferramenta

O pacote traz o `prumo-mcp`, um servidor MCP por stdio com quatro ferramentas: `prumo_check`, que só lê, `prumo_fix`, que reescreve a capitalização e os renames que o git registrou, e os dois relatórios, `prumo_drift` e `prumo_budget`, que também só leem. O agente decide quando chamar e recebe o mesmo relatório do CLI, mais os achados como dados.

No Claude Code:

```bash
claude mcp add prumo -- npx -y -p @tomd4vs/prumo prumo-mcp
```

Para qualquer outro cliente MCP, a configuração equivalente é:

```json
{
  "mcpServers": {
    "prumo": { "command": "npx", "args": ["-y", "-p", "@tomd4vs/prumo", "prumo-mcp"] }
  }
}
```

O servidor não faz chamadas de rede e não precisa de configuração; ele verifica o repositório que o cliente indicar, ou a pasta em que foi iniciado.

---

## Crie um comando de barra

Um arquivo em `.claude/commands/prumo.md` transforma a checagem em `/prumo`:

```markdown
Rode `npx @tomd4vs/prumo` e corrija todos os achados que ele reportar.
```

---

## Rode automaticamente depois de cada edição

No Claude Code, um hook `PostToolUse` em `.claude/settings.json` dispara depois que o agente grava um arquivo. Rodar o prumo a cada gravação faria barulho à toa, então o hook filtra antes e só roda quando o arquivo era de contexto:

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

O hook recebe a chamada da ferramenta como JSON na entrada padrão. O filtro em `node -e` lê `tool_input.file_path`, troca as barras invertidas do Windows por barras normais e sai com código diferente de zero a menos que o caminho seja um que o prumo detectaria sozinho. O padrão espelha a lista em [src/check.mjs](../src/check.mjs), então o prumo só roda quando um arquivo de contexto mudou. Usa node em vez de `jq` porque quem roda o prumo já tem node. O `|| true` no fim impede que um achado trave a rodada: a saída do prumo aparece na transcrição, o agente vê e pode corrigir ali mesmo.

No Windows, o Claude Code roda os hooks no Git Bash quando ele está instalado e no PowerShell quando não está, e o comando acima foi escrito para bash. Sem Git Bash, use este hook no lugar. Ele declara o shell e faz o mesmo filtro em PowerShell:

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

Os dois blocos são exercitados pela [simulação](api.pt-BR.md#desenvolvimento) a cada versão, contra payloads reais de `PostToolUse`.
