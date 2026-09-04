# Referência

[← README](../LEIAME.md) · [Read in English](reference.md)

Todo argumento, opção e achado, mais como silenciar um e como o `--fix` decide o que tocar.

---

## Uso

```
prumo [repo] [alvo...] [opções]
```

| Argumento | Significado |
| --- | --- |
| `repo` | Caminho de um repositório git. Padrão: a pasta atual. |
| `alvo` | Um arquivo markdown, ou os arquivos markdown que estão direto numa pasta. Omita para detecção automática. Um alvo que não existe é erro, não volta para a detecção automática. |

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

No terminal, o relatório abre com o nome em letras grandes, a versão e a página do GitHub. Cada título de seção vira um rótulo colorido, o caminho que a nota cita é pintado em cor diferente do que o repositório tem, e a última linha conta os achados por tipo. Quando a saída vai para um pipe, um arquivo, o CI ou um agente, nada vem antes da linha de cabeçalho e nenhuma cor é usada, então o que eles leem é exatamente o que esta página mostra.

| Variável | Significado |
| --- | --- |
| `PRUMO_BANNER=0` | Sem o nome acima do relatório, mesmo no terminal; `=1` mostra até em pipe |
| `NO_COLOR=1` | Texto sem cor no terminal |
| `FORCE_COLOR=1` | Cor mesmo em pipe |

### Arquivos encontrados automaticamente

| Agente | Arquivos |
| --- | --- |
| Claude Code | `CLAUDE.md`, `CLAUDE.local.md`, `.claude/MEMORY.md`, `.claude/commands/` |
| Codex, Amp e a convenção AGENTS.md | `AGENTS.md`, `AGENT.md` |
| Cursor | `.cursorrules`, `.cursor/rules/` |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/` |
| Gemini CLI / Jules | `GEMINI.md`, `JULES.md` |
| Windsurf | `.windsurfrules`, `.windsurf/rules/` |
| Cline / Roo | `.clinerules`, `.roo/rules/` |
| Aider | `CONVENTIONS.md` |
| Agent Skills, qualquer host | `SKILL.md` em qualquer subpasta, como `.claude/skills/deploy/`, rastreado pelo git ou não |
| Qualquer um | `MEMORY.md`, `COPILOT.md` |

`CLAUDE.md`, `AGENTS.md` e `SKILL.md` também são recolhidos de subpastas, então `packages/api/AGENTS.md` e `.claude/skills/deploy/SKILL.md` são lidos igual a um arquivo da raiz. Pastas como `vendor/` e `node_modules/` ficam de fora, porque um arquivo de contexto ali documenta uma dependência.

Uma skill em `.claude/skills/` ou `.agents/skills/` é lida mesmo quando o git não a rastreia, como costuma acontecer com uma skill instalada. O cabeçalho conta os arquivos lidos desse jeito. Os arquivos ao lado dessa skill são procurados no disco, já que o índice não os tem, então uma capitalização errada num deles passa despercebida.

Um `SKILL.md` na raiz do repositório não é detectado automaticamente. Na raiz, um arquivo com esse nome costuma ser a instrução de uma ferramenta, não uma skill instalada, e os caminhos dentro dele são exemplos, não referências. Quando o repositório é ele mesmo uma skill, nomeie o arquivo: `prumo . SKILL.md`.

### Exemplos

```bash
prumo                                  # este repositório, arquivos detectados sozinhos
prumo .                                # o mesmo, escrito explicitamente
prumo . docs/notas                     # varre também uma pasta de markdown
prumo ~/trabalho/api                   # um repositório em outro lugar
prumo . --all                          # não truncar a lista
prumo . --json findings.json           # salvar os achados como JSON
prumo . SKILL.md                       # um repositório que é ele mesmo uma skill

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

**O que o prumo lê como caminho.** Na prosa, só é checada a citação que nomeia uma pasta: a que
começa por uma pasta de primeiro nível conhecida (`app/`, `src/`, `docs/`, `packages/`, `tests/` e
as demais), ou a que tem uma `/` e termina numa extensão conhecida. Um nome de arquivo solto, sem
pasta na frente, como `politica.md`, fica de fora, porque as notas mencionam nomes de arquivo de
passagem muito mais do que os citam como caminho. Escreva `docs/politica.md`, ou use um link
markdown `[politica](politica.md)`, e ele passa a ser checado como qualquer outro.

**Um bloco de código cercado é lido como código.** Cada linha dentro de um bloco ```` ``` ```` é
lida como um comando ou como uma entrada de árvore de arquivos, então `node scripts/seed.py` e
`src/components/Button.tsx` são checados ali sem crase, e a frase que apresenta o bloco conta como
contexto dele. Um bloco marcado como `markdown` é um exemplo de sintaxe, assim como qualquer coisa
dentro de um comentário HTML, então nenhum dos dois é lido. Um link dentro de um bloco cercado está
sendo citado, e fica de fora. Um caminho citado em várias linhas é reportado em cada uma delas.

### `CASE MISMATCH`

Um caminho escrito com capitalização diferente da que o repositório usa. O prumo compara contra o índice do git, que é o único lugar que guarda a grafia real. O sistema de arquivos não conta essa verdade no Windows nem no macOS.

O resultado é o clássico "na minha máquina funciona": passa localmente e morre no Linux, no CI e no Docker. Copie o caminho mostrado depois do `->`.

### `BROKEN LINK`

Um `[[wikilink]]`, ou um link markdown como `[Setup](docs/setup.md)`, aponta para um arquivo que não está lá. O agente que segue esse link não encontra nada e segue adiante sem avisar. Wikilinks são casados pelo nome contra as notas sendo checadas e contra todo arquivo markdown rastreado pelo git; links markdown são resolvidos relativos ao arquivo que os contém, e um link que começa com `/` a partir da raiz do repositório, como o GitHub faz. Um `%20` no destino é lido como o espaço que ele representa, e o `--fix` o devolve codificado, para que um link corrigido continue funcionando.

O alvo pode ser uma página markdown, uma imagem, um PDF ou um arquivo de código, e as três formas de escrever link em markdown são lidas: `[a](x.md)`, `[a](<um nome com espaços.md>)` e um `[a][ref]` cuja definição `[ref]:` é reportada na própria linha dela.

Quando o prumo imprime `-> sugestão`, aquele é quase certamente o arquivo pretendido; os dois costumam divergir só em `-` contra `_`. Sem sugestão, o destino foi renomeado ou apagado, então atualize ou remova o link.

Centenas desses geralmente têm uma causa sistemática só. Numa execução medida, todo link estava em kebab-case enquanto todo arquivo estava em snake_case, e renomear os arquivos resolveu 247 de uma vez.

### `MISSING PATH`

A nota cita um arquivo que não existe mais em lugar nenhum do repositório. Atualize o caminho, ou reescreva a frase se o ponto dela for justamente que o arquivo sumiu. O prumo reconhece construções como *"foi removido"*, *"não existe mais"* e *"renomeado para"*, e se cala quando encontra uma.

Um caminho coberto pelo `.gitignore` está ausente de propósito, então fica isento desta checagem e da de links quebrados. O cabeçalho conta essas isenções, para que um repositório que depende delas nunca pareça limpo por acidente.

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

Colocado na linha anterior a um bloco de código cercado, o `<!-- prumo-ignore-next-line -->` silencia o bloco inteiro, contado uma vez.

`.prumorc.json` na raiz do repositório, para um padrão:

```jsonc
{
  "ignore":    ["docs/legacy/**", "config/vendor.php"],  // caminhos e links a pular
  "exclude":   ["CHANGELOG.md"],                         // arquivos de contexto a não checar
  "targets":   ["CLAUDE.md", "docs/notas"],              // checar estes em vez de detectar
  "transient": ["public/dist", "coverage-html"]          // build extra a ignorar
}
```

`ignore`, `exclude` e `transient` aceitam globs (`*`, `**`, `?`); um padrão sem curinga que nomeia uma pasta cobre tudo o que está dentro dela. O `--no-config` ignora o arquivo por uma execução. As supressões são contadas no cabeçalho, então um repositório silenciado nunca se parece com um limpo.

---

## Corrigindo capitalização automaticamente

```bash
prumo --fix
```

```
FIXED  1 path in 1 file
  CLAUDE.md:18   layouts/AppLayout.vue  ->  resources/js/Layouts/AppLayout.vue
```

Só a capitalização é reescrita, porque só nela o valor correto pode ser lido do índice do git em vez de adivinhado. Links quebrados e caminhos ausentes ficam intocados: a sugestão de link é um palpite bem informado, e um caminho ausente pode estar ausente de propósito.

Toda forma de citar um caminho é reescrita onde está: entre crases, dentro de um comando, dentro de um bloco de código cercado, escrita com barra invertida, seguida de número de linha, e num link escrito como `[a](x)`, `[a](<x>)` ou `[ref]: x`. Um caminho citado em várias linhas é corrigido em todas elas numa passada só.

Se uma linha mudou entre a varredura e o `--fix`, o prumo deixa a linha como está e avisa no relatório.
