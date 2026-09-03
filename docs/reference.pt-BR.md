# Referência

[← README](../README.pt-BR.md) · [Read in English](reference.md)

Todo argumento, opção e achado, mais como silenciar um e como o `--fix` decide o que tocar.

---

## Uso

```
prumo [repo] [alvo...] [opções]
```

| Argumento | Significado |
| --- | --- |
| `repo` | Caminho de um repositório git. Padrão: a pasta atual. |
| `alvo` | Um arquivo markdown, ou uma pasta deles. Omita para detecção automática. |

| Opção | Significado |
| --- | --- |
| `--fix` | Corrige capitalização no lugar; nada mais é tocado |
| `--format F` | `text` (padrão), `github` ou `json` |
| `--all` | Mostra todos os achados em vez dos 25 primeiros |
| `--json ARQ` | Também grava os achados em `ARQ` como JSON |
| `--quiet` | Não imprime nada; use o código de saída |
| `--no-config` | Ignora o `.prumorc.json` |
| `-h`, `--help` | Mostra a ajuda |
| `-v`, `--version` | Mostra a versão |

### Arquivos encontrados automaticamente

| Agente | Arquivos |
| --- | --- |
| Claude Code | `CLAUDE.md`, `CLAUDE.local.md`, `.claude/MEMORY.md` |
| Codex, Amp e a convenção AGENTS.md | `AGENTS.md`, `AGENT.md` |
| Cursor | `.cursorrules`, `.cursor/rules/` |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/` |
| Gemini CLI / Jules | `GEMINI.md`, `JULES.md` |
| Windsurf | `.windsurfrules`, `.windsurf/rules/` |
| Cline / Roo | `.clinerules`, `.roo/rules/` |
| Aider | `CONVENTIONS.md` |
| Qualquer um | `MEMORY.md`, `COPILOT.md` |

`CLAUDE.md` e `AGENTS.md` também são recolhidos de subpastas, então `packages/api/AGENTS.md` é lido igual ao da raiz.

### Exemplos

```bash
prumo                                  # este repositório, arquivos detectados sozinhos
prumo .                                # o mesmo, escrito explicitamente
prumo . docs/notas                     # varre também uma pasta de markdown
prumo ~/trabalho/api                   # um repositório em outro lugar
prumo . --all                          # não truncar a lista
prumo . --json findings.json           # salvar os achados como JSON

# Windows: use aspas em caminhos com espaço
prumo "C:/Users/eu/Meu Projeto"
```

### Códigos de saída

| Código | Significado |
| :---: | --- |
| `0` | Nada a revisar |
| `1` | Achados para revisar |
| `2` | Uso incorreto: não é repositório git, nenhum arquivo encontrado, opção desconhecida |

---

## O que cada achado significa

### `CASE MISMATCH`

Um caminho escrito com capitalização diferente da que o repositório usa. O prumo compara contra o índice do git, que é o único lugar que guarda a grafia real. O sistema de arquivos não conta essa verdade no Windows nem no macOS.

O resultado é o clássico "na minha máquina funciona": passa localmente e morre no Linux, no CI e no Docker. Copie o caminho mostrado depois do `->`.

### `BROKEN LINK`

Um `[[wikilink]]`, ou um link markdown como `[Setup](docs/setup.md)`, aponta para um arquivo que não está lá. O agente que segue esse link não encontra nada e segue adiante sem avisar.

Quando o prumo imprime `-> sugestão`, aquele é quase certamente o arquivo pretendido; os dois costumam divergir só em `-` contra `_`. Sem sugestão, o destino foi renomeado ou apagado, então atualize ou remova o link.

Centenas desses geralmente têm uma causa sistemática só. Numa execução medida, todo link estava em kebab-case enquanto todo arquivo estava em snake_case, e renomear os arquivos resolveu 247 de uma vez.

### `MISSING PATH`

A nota cita um arquivo que não existe mais em lugar nenhum do repositório. Atualize o caminho, ou reescreva a frase se o ponto dela for justamente que o arquivo sumiu. O prumo reconhece construções como *"foi removido"*, *"não existe mais"* e *"renomeado para"*, e se cala quando encontra uma.

### `NOT IN INDEX`

Só aparece quando você passa uma pasta de notas. Um arquivo está na pasta mas o `MEMORY.md` nunca o menciona, então nada leva o leitor até ele. Inclua no índice ou apague.

---

## Silenciando um achado

Cedo ou tarde o prumo aponta algo que você sabe estar certo. Use a supressão mais estreita que resolva.

Inline, para uma linha:

```markdown
Nota antiga sobre `config/old.php`. <!-- prumo-ignore -->

<!-- prumo-ignore-next-line -->
Outra sobre `config/older.php`.

<!-- prumo-ignore-file -->
```

`.prumorc.json` na raiz do repositório, para um padrão:

```jsonc
{
  "ignore":    ["docs/legacy/**", "config/vendor.php"],  // caminhos e links a pular
  "exclude":   ["CHANGELOG.md"],                         // arquivos de contexto a não checar
  "targets":   ["CLAUDE.md", "docs/notas"],              // checar estes em vez de detectar
  "transient": ["public/dist", "coverage-html"]          // build extra a ignorar
}
```

`ignore`, `exclude` e `transient` aceitam globs (`*`, `**`, `?`). O `--no-config` ignora o arquivo por uma execução. As supressões são contadas no cabeçalho, então um repositório silenciado nunca se parece com um limpo.

---

## Corrigindo capitalização automaticamente

```bash
prumo --fix
```

```
FIXED  1 path in 1 file
  CLAUDE.md:18   layouts/AppLayout.vue  ->  resources/js/Layouts/AppLayout.vue
```

Só a capitalização é reescrita, porque só nela o valor correto pode ser lido do índice do git em vez de deduzido. Links quebrados e caminhos ausentes ficam intocados: a sugestão de link é heurística, e um caminho ausente pode estar ausente de propósito.

Linhas que mudaram desde a varredura são reportadas e puladas, não reescritas.
