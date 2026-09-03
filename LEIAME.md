<p align="center">
  <img src="assets/social.png" alt="prumo — sua documentação ainda é verdade?" width="820">
</p>

<p align="center">
  Confere os arquivos de contexto que seu agente de código lê contra o código ao lado deles.
</p>

<p align="center">
  <a href="README.md">🇬🇧 Read in English</a>
</p>

---

## O problema

Há três meses alguém escreveu isto no `CLAUDE.md`:

```markdown
A logo da sidebar fica em `layouts/AppLayout.vue`.
```

De lá para cá a pasta foi renomeada para `Layouts`, com L maiúsculo. No Windows e no macOS aquele caminho continua abrindo, então nada nunca reclamou. No Linux e no CI ele aponta para o nada, e todo agente que lê o arquivo é mandado para um lugar que não existe.

Essa linha sobreviveu a seis auditorias feitas à mão nos mesmos arquivos. O prumo achou em quatro segundos.

---

## Começando

Você precisa de [Node.js 18+](https://nodejs.org) e `git`. Não há nada para instalar, configurar ou cadastrar.

Num terminal, dentro de qualquer repositório git:

```bash
npx @tomd4vs/prumo
```

O prumo localiza seus arquivos de contexto sozinho: `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, `.github/copilot-instructions.md`, skills instaladas em `.claude/skills/` e os demais. Todo arquivo e pasta que ele procura está na [referência](docs/reference.pt-BR.md#arquivos-encontrados-automaticamente).

---

## Lendo o resultado

Execução limpa:

```
prumo — 1 context file, 401 files in the git index

nothing to review.
```

Uma execução com achados, anotada:

```
prumo — 3 context files, 412 files in the git index     ← o que ele leu
        1 historical entry exempt from path checks      ← o que ele pulou de propósito

CASE MISMATCH  (1)   resolves on Windows and macOS, breaks on Linux and CI
  CLAUDE.md:18                                          ← arquivo e linha
      layouts/AppLayout.vue                             ← o que a nota diz
      ->  resources/js/Layouts/AppLayout.vue            ← o que o repositório tem

BROKEN LINK  (2)   1 with a likely destination
  [[deploy-checklist]]   ->  deploy_checklist           ← o arquivo que provavelmente era
  [[old-architecture]]                                  ← sem candidato: renomeado ou apagado

MISSING PATH  (1)   paths cited to say they are gone were filtered out
  docs/setup.md:44  config/database.php                 ← arquivo, linha, caminho morto
      Copie o modelo para `config/database.php`…        ← a frase, para você julgar

4 to review                                             ← 1 + 2 + 1
```

Todo achado traz arquivo, número da linha e a correção. Nada é adivinhado e nada é gravado. O que cada achado significa, e o que fazer com ele, está na [referência](docs/reference.pt-BR.md#o-que-cada-achado-significa). Se ele apontar uma linha que você sabe estar certa, [Silenciando um achado](docs/reference.pt-BR.md#silenciando-um-achado) mostra as duas formas de dizer isso.

---

## O que ele não faz

Três limites, escolhidos de propósito e explicados em [Design](docs/design.pt-BR.md):

- Não julga afirmações. Saber se *"esta flag desliga o cache"* continua verdade exige um modelo, e isso é outra ferramenta.
- Não edita além da capitalização. A sugestão de link é heurística, e um caminho ausente pode estar ausente de propósito.
- Não faz chamada de rede. Sem telemetria, sem conta, sem modelo.

---

## Instalando

O `npx @tomd4vs/prumo` funciona sem instalar nada. Para uso frequente:

```bash
npm install -g @tomd4vs/prumo           # disponível em qualquer lugar da máquina
npm install --save-dev @tomd4vs/prumo   # ou como dependência de desenvolvimento de um projeto
```

Nos dois casos o comando é `prumo`. Node 18 ou mais novo, `git` no `PATH`, zero dependências. Erros nesta etapa, como um Node antigo ou uma pasta que não é repositório git, estão em [Resolvendo problemas](docs/troubleshooting.pt-BR.md).

---

## Usando a partir de um agente

O prumo é uma CLI comum, então qualquer agente com acesso a shell consegue rodá-lo.

**Peça ao agente para rodar.** `npx @tomd4vs/prumo` funciona em qualquer repositório git. A saída em texto traz arquivo, linha e correção, o que basta para um agente agir sem precisar interpretar nada. `--format json` devolve os mesmos achados como dados estruturados.

**Rode automaticamente depois de cada edição.** No Claude Code, um hook `PostToolUse` em `.claude/settings.json` dispara depois que o agente grava um arquivo. Este só roda o prumo quando o arquivo era de contexto:

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

O hook recebe a chamada da ferramenta como JSON na entrada padrão. O filtro em `node -e` lê `tool_input.file_path`, normaliza as barras do Windows e sai com código diferente de zero a menos que o caminho seja um que o prumo detectaria sozinho; o padrão espelha a lista em [src/check.mjs](src/check.mjs), então o prumo só roda quando um arquivo de contexto mudou. Usa node em vez de `jq` porque quem roda o prumo já tem node. A saída do prumo aparece na transcrição, então o agente vê os achados e pode corrigir na mesma rodada. O formato desses achados como dados está na [API](docs/api.pt-BR.md).

**Crie um comando de barra.** Um arquivo em `.claude/commands/prumo.md` transforma a checagem em `/prumo`:

```markdown
Rode `npx @tomd4vs/prumo` e corrija todos os achados que ele reportar.
```

---

## Integração contínua

O prumo sai com código diferente de zero quando acha algo, então entra em qualquer pipeline como um passo só:

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

Use o `actions/checkout` normalmente; o prumo lê o índice do git, então um checkout que o dispense não funciona. O `--format github` transforma os achados em anotações na linha exata do pull request. `--quiet`, `--format` e as demais opções estão na [referência](docs/reference.pt-BR.md#uso).

---

## Documentação

| Página | O que responde |
| --- | --- |
| [Referência](docs/reference.pt-BR.md) | Toda opção e código de saída, o que cada achado significa, como silenciar um, o que o `--fix` toca |
| [Design](docs/design.pt-BR.md) | Por que só três checagens: a medição que removeu a quarta, e os filtros que mantêm as outras caladas |
| [Resolvendo problemas](docs/troubleshooting.pt-BR.md) | Mensagens de erro, e as perguntas que as pessoas fazem antes de adotar |
| [API](docs/api.pt-BR.md) | Chamar a partir de código, e rodar a suíte de testes |

## Licença

MIT
