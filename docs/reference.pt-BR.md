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
| `--fix` | Corrige capitalização e os renames que o git registrou, no lugar; nada mais é tocado |
| `--format F` | `text` (padrão), `github`, `json` ou `sarif` |
| `--sarif ARQ` | Também grava os achados em `ARQ` como SARIF, para o code scanning |
| `--all` | Mostra todos os achados em vez dos 25 primeiros |
| `--json ARQ` | Também grava os achados em `ARQ` como JSON |
| `--quiet` | Não imprime nada; use o código de saída |
| `--no-config` | Ignora o `.prumorc.json` |
| `--baseline` | Grava os achados atuais em `.prumo-baseline.json`; as rodadas seguintes só falham no que é novo |
| `--no-baseline` | Ignora o `.prumo-baseline.json` nesta rodada |
| `--staged` | Checa só os arquivos de contexto preparados para o commit |
| `--since REF` | Checa só os arquivos de contexto alterados desde `REF`, um commit ou um branch |
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

`CLAUDE.md`, `AGENTS.md` e `SKILL.md` também são recolhidos de subpastas, então `packages/api/AGENTS.md` e `.claude/skills/deploy/SKILL.md` são lidos igual a um arquivo da raiz. Pastas como `vendor/`, `node_modules/` e `managed_components/` ficam de fora, porque um arquivo de contexto ali documenta uma dependência.

Uma skill em `.claude/skills/` ou `.agents/skills/` é lida mesmo quando o git não a rastreia, como costuma acontecer com uma skill instalada. O cabeçalho conta os arquivos lidos desse jeito. Os arquivos ao lado dessa skill são procurados no disco, já que o índice não os tem, então uma capitalização errada num deles passa despercebida.

Além dos arquivos de contexto, `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` e `.claude/settings.json` são lidos como configuração quando o git os rastreia e os arquivos de contexto foram detectados sozinhos, para a checagem `AGENT CONFIG` abaixo. O cabeçalho não os lista; `stats.configs` no JSON os conta.

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
markdown `[politica](politica.md)`, e ele passa a ser checado como qualquer outro. Um trecho com espaços
é lido como comando, e cada argumento é tentado como caminho; um trecho que começa com número, como
`000 Inbox/Inbox.md`, é um nome e fica em paz. Um host escrito sem o esquema, `docs.exemplo.com/guia.md`,
e um endereço `file://` são endereços da web. Um `:42`, um `#L10` ou um `:simbolo` depois do caminho
aponta para dentro do arquivo e é descartado antes de o caminho ser procurado.

**Um bloco de código cercado é lido como código.** Cada linha dentro de um bloco ```` ``` ```` é
lida como um comando ou como uma entrada de árvore de arquivos, então `node scripts/seed.py` e
`src/components/Button.tsx` são checados ali sem crase, e a frase que apresenta o bloco conta como
contexto dele. Um bloco marcado como `markdown` é um exemplo de sintaxe, assim como qualquer coisa
dentro de um comentário HTML, então nenhum dos dois é lido. Um bloco numa linguagem de programação,
como `js`, `python` ou `php`, é código-fonte, e uma string ali é algo que a linguagem resolve, então
ele também não é lido. Num bloco que é lido, `require('lib/x.js')` e `path=lib/x.js` são checados
como `lib/x.js`, e o que segue um `#` numa linha de comando é comentário, e por isso não é lido. Um link dentro de um bloco cercado está sendo citado, e fica de fora. Um caminho
citado em várias linhas é reportado em cada uma delas.

### `CASE MISMATCH`

Um caminho escrito com capitalização diferente da que o repositório usa. O prumo compara contra o índice do git, que é o único lugar que guarda a grafia real. O sistema de arquivos não conta essa verdade no Windows nem no macOS.

O resultado é o clássico "na minha máquina funciona": passa localmente e morre no Linux, no CI e no Docker. Copie o caminho mostrado depois do `->`.

### `BROKEN LINK`

Um `[[wikilink]]`, ou um link markdown como `[Setup](docs/setup.md)`, aponta para um arquivo que não está lá. O agente que segue esse link não encontra nada e segue adiante sem avisar. Wikilinks são casados pelo nome contra as notas sendo checadas e contra todo arquivo markdown rastreado pelo git; links markdown são resolvidos relativos ao arquivo que os contém, e um link que começa com `/` a partir da raiz do repositório, como o GitHub faz, ou com `mdc:`, como uma regra do Cursor escreve; um link com esquema `file:` é um endereço, como um caminho `file://` na prosa. Um link que resolve a partir da raiz e de nenhum outro lugar é lido a partir da raiz, porque é assim que um agente lê um caminho, e é assim que uma nota aninhada em `.claude/skills/` costuma escrevê-lo. Um `%20` no destino é lido como o espaço que ele representa, e o `--fix` o devolve codificado, para que um link corrigido continue funcionando.

O alvo pode ser uma página markdown, uma imagem, um PDF ou um arquivo de código, e as três formas de escrever link em markdown são lidas: `[a](x.md)`, `[a](<um nome com espaços.md>)` e um `[a][ref]` cuja definição `[ref]:` é reportada na própria linha dela. Um link para um título, `[setup](docs/guide.md#quick-start)` ou `[topo](#quick-start)`, é checado contra os títulos daquela página, transformados em âncoras do jeito que o GitHub faz, e contra qualquer atributo `id` ou `name` no HTML dela. Colchetes duplos colados numa palavra, com ponto dentro ou com espaços nas bordas, como `df[[col]]`, `[[rule.threat]]` ou `$[[ inputs.stage ]]`, são código ou sintaxe de template, e ficam em paz.

Quando o prumo imprime `-> sugestão`, aquele é quase certamente o arquivo pretendido; os dois costumam divergir só em `-` contra `_`. Sem sugestão, o destino foi renomeado ou apagado, então atualize ou remova o link. Num link markdown, o histórico do git é consultado do mesmo jeito que num caminho ausente, abaixo, e um rename que o git registrou substitui o palpite pelo nome. Um link cujo texto é o mesmo caminho em crase é uma citação só, reportada uma vez, como link.

Centenas desses geralmente têm uma causa sistemática só. Numa execução medida, todo link estava em kebab-case enquanto todo arquivo estava em snake_case, e renomear os arquivos resolveu 247 de uma vez.

### `MISSING PATH`

A nota cita um arquivo que não existe mais em lugar nenhum do repositório. Atualize o caminho, ou reescreva a frase se o ponto dela for justamente que o arquivo sumiu. O prumo reconhece construções como *"foi removido"*, *"não existe mais"*, *"renomeado para"*, *"migrated from"*, *"moved to"* e *"no skills found"*, em inglês, português e chinês, e se cala quando encontra uma.

Quando o git guarda o histórico do arquivo, o achado diz para onde ele foi. `->  config/db.php   renamed in a3f21c9, 4 months ago` é a detecção de rename do próprio git, por similaridade, seguida por renomeações posteriores até o nome que existe agora, e `deleted in a3f21c9, 4 months ago` é o commit que o removeu. Um arquivo movido e reescrito de uma vez é lido como apagado, porque o git pareia um rename por similaridade, enquanto uma mudança dentro de um commit que tocou milhares de arquivos continua sendo lida como mudança, porque a consulta eleva o limite de renames do git. Nada é dito quando o histórico nunca teve o caminho, que é a cara de um marcador, de um erro de digitação ou de um caminho de outro projeto, nem quando o clone é raso. A consulta pergunta ao git só pelos caminhos que reporta, no máximo duzentos por execução. Duas formas não são reportadas: um arquivo que cada máquina escreve para si, `CLAUDE.local.md`, `settings.local.json` ou qualquer nome com `.local` antes da extensão; e uma skill citada pelo caminho em que um host a instala, `.claude/skills/deploy/scripts/x.sh`, quando o mesmo arquivo existe ao lado de um `SKILL.md` em algum lugar do repositório. Um rename é a única coisa além da capitalização que o `--fix` aplica, abaixo; uma exclusão nunca é reescrita.

Também reconhece uma frase que diz que o arquivo é escrito, como *"Output: `docs/report.md`"*, *"salve o plano em `docs/plano.md`"* ou *"`docs/run.log` é gerado pelo build"*, e deixa esse caminho em paz. O verbo mais perto do caminho na frase decide, então *"leia `a` e escreva o resultado em `b`"* continua checando `a`. Uma lista ou uma tabela toma o veredito da frase que as apresenta, ou do título da seção, e num comando um redirecionamento `>`, uma flag `-o` ou `mkdir` marca o que é escrito. Uma frase que faz da existência do arquivo uma condição, *"se `docs/contexto.md` existir, leia"* ou *"leia `docs/contexto.md` se existir"*, também fica em paz, assim como a que faz dele uma condição do repositório, *"se o repositório tem `docs/product/`, atualize lá"*. Um caminho com a caixa errada é reportado diga a frase o que disser.

Um caminho coberto pelo `.gitignore` está ausente de propósito, então fica isento desta checagem e da de links quebrados. O cabeçalho conta essas isenções, para que um repositório que depende delas nunca pareça limpo por acidente.

### `UNKNOWN COMMAND`

A nota manda o agente rodar `npm run test:unit`, `yarn build`, `make deploy` ou `composer lint`, e nenhum `package.json`, `Makefile` ou `composer.json` rastreado pelo git define um script ou alvo com esse nome. Script é renomeado com mais frequência do que arquivo, e um agente que roda o nome antigo para ali mesmo. Todo manifesto do repositório conta, então a nota de um monorepo pode nomear o script de qualquer pacote, e `yarn x` e `pnpm x` aceitam também o nome de uma dependência, porque rodam o binário dela. Um comando apontado para outro lugar, com `-w`, `--filter` ou `make -C`, fica em paz, assim como o `make` quando um alvo é montado a partir de variável, porque aí a lista não pode ser lida. Uma nota que mostra o mesmo script sob vários gerenciadores de pacote, `npm run lint` numa linha e `pnpm lint` na seguinte, está listando alternativas, e nenhuma delas é reportada. Quando o prumo imprime `-> sugestão`, aquele é o nome definido mais próximo do citado.

### `AGENT CONFIG`

Uma configuração do agente que aponta para o nada, o que falha em silêncio: a regra nunca se aplica, a skill nunca carrega, o servidor nunca sobe, e nenhuma mensagem diz isso. Quatro formas são lidas, todas de fonte estruturada. Uma regra em `.cursor/rules/*.mdc`, ou uma instrução em `.github/instructions/*.md`, em que nenhum padrão de `globs:` ou `applyTo:` casa com um arquivo rastreado pelo git, a menos que `alwaysApply: true` torne os padrões irrelevantes; um padrão morto ao lado de um vivo fica em paz, porque a regra se acopla quando qualquer um deles casa, e um padrão que é só uma extensão, `.cpp`, é lido como `**/*.cpp`. Um `SKILL.md` sob uma pasta `skills/` cujo frontmatter não tem `description`, porque é por ela que um agente escolhe a skill; fora de `.claude/skills/` e `.agents/skills/` só um frontmatter que traz `name` é lido como de skill, porque um `SKILL.md` em outro lugar pode seguir outro esquema, e o `name` não é cobrado contra a pasta, porque os hosts divergem sobre os dois terem de coincidir; uma skill instalada em `.claude/skills/` ou `.agents/skills/` sem frontmatter nenhum é reportada pelo mesmo motivo. Um servidor MCP em `.mcp.json`, `.cursor/mcp.json` ou `.vscode/mcp.json` cujo `command` ou `args` nomeia um script que não está aqui, e um hook em `.claude/settings.json` que faz o mesmo; `$CLAUDE_PROJECT_DIR` na frente de um caminho é lido como a raiz do repositório. Os arquivos JSON só são lidos quando os arquivos de contexto foram detectados sozinhos, e só quando o git os rastreia; nomear um alvo checa só aquele alvo.

### `ANOTHER PROJECT`

Não é um achado. Um arquivo de contexto cujos caminhos citados começam, na maior parte, em pastas que este repositório não tem (ao menos quatro, e ao menos seis em dez do que ele cita) é lido como documentação de outro projeto: um `CLAUDE.md` modelo esperando ser copiado, ou uma skill escrita para a base de código em que vai ser instalada. Seus achados ficam retidos, a seção nomeia o arquivo com a contagem, e nada disso conta no código de saída. Um arquivo que você nomeia na linha de comando, ou em `targets` do `.prumorc.json`, é sempre checado por inteiro, então `prumo . CLAUDE.md` lista o que ficou retido. Uma nota que envelheceu ainda cita as pastas que o repositório tem, e por isso o sinal é a pasta. Num `SKILL.md`, as pastas que uma skill carrega consigo, `references/`, `scripts/`, `assets/` e `templates/`, nunca contam para o portão: uma skill sem os próprios arquivos é um achado. Um link relativo conta pela pasta com que abre ao lado da nota, `python/` em `[a](python/x.py)`, porque a pasta da própria nota está sempre aqui, e um wikilink escrito com pasta, `[[concepts/budget]]`, conta também. Quando os arquivos de contexto, tomados juntos, citam pastas em maioria ausentes, ao menos doze e seis em dez, o repositório documenta outro projeto por inteiro, um plugin publicado para outra base de código ou notas que linkam um wiki guardado em outro lugar, e a seção nomeia `the repository` com as contagens somadas; nomear qualquer arquivo checa-o por inteiro. Uma pasta de regras recebe a mesma leitura: quando a maior parte das regras em `.cursor/rules/` ou `.github/instructions/` não casa com nada aqui (os mesmos quatro, e seis em dez, contados sobre regras), seus achados de `AGENT CONFIG` ficam retidos e a seção nomeia a pasta, porque um catálogo de regras guardado para várias stacks não é uma regra envelhecida.

### `NOT IN INDEX`

Só aparece quando você passa uma pasta de notas. Um arquivo está na pasta mas o `MEMORY.md` nunca o menciona, então nada leva o leitor até ele. Inclua no índice ou apague.

---

## Integração contínua

Três portas de entrada, a mesma checagem.

**A action.** `TomD4vs/prumo@v1` é um passo composto que roda o prumo do checkout daquela tag, então não há nada a instalar nem chamada de rede. `@v1` acompanha a última release; fixe `@v0.6.0` para congelar.

```yaml
- uses: TomD4vs/prumo@v1
  with:
    path: .                    # o repositório a checar, relativo ao workspace
    targets: ''                # arquivos ou pastas a checar em vez de detectar sozinho, separados por espaço
    format: github             # github anota o pull request; text, json e sarif são os outros
    sarif-file: ''             # também grava SARIF aqui, para o envio abaixo
    fail-on-findings: 'true'   # 'false' só anota
    since: ''                  # checa só os arquivos de contexto alterados desde este commit ou branch
```

Todo valor acima é o padrão, então a forma de uma linha do README é este mesmo passo. A saída `total` do passo é o número de achados.

**SARIF.** `--format sarif` imprime SARIF 2.1.0, e `--sarif ARQ` grava ao lado do que a execução imprime: um resultado por achado, com regra, nível, arquivo e linha. O code scanning do GitHub recebe o arquivo pela action de envio, e o workflow precisa de `permissions: security-events: write` para isso:

```yaml
- uses: TomD4vs/prumo@v1
  with: { sarif-file: prumo.sarif, fail-on-findings: 'false' }
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: prumo.sarif }
```

**pre-commit.** O repositório traz um hook para o framework [pre-commit](https://pre-commit.com). Ele roda quando um arquivo em stage é um dos que o prumo detecta sozinho, checa os arquivos de contexto em stage contra o índice inteiro, e bloqueia o commit quando há achado:

```yaml
repos:
  - repo: https://github.com/TomD4vs/prumo
    rev: v0.7.1
    hooks:
      - id: prumo
```

**Só o que mudou.** `--staged` checa os arquivos de contexto em stage para o commit e nada mais, e `--since REF` os alterados desde um commit ou um branch, `--since origin/main` num pull request. As checagens continuam rodando contra o índice inteiro, então uma nota em stage que cita um arquivo que o commit não toca é checada por inteiro; o que nenhum dos dois limites enxerga é uma nota intocada enquanto o arquivo que ela cita foi renomeado, e por isso a rodada completa pertence ao branch principal ou a um agendamento. O cabeçalho diz qual limite valeu, e uma rodada que não alcança arquivo de contexto nenhum sai com 0. A action recebe o mesmo limite pela entrada `since`, e o checkout então precisa do histórico que alcança o branch, `fetch-depth: 0` no `actions/checkout`.

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

`ignore`, `exclude` e `transient` aceitam globs (`*`, `**`, `?`); um padrão sem curinga que nomeia uma pasta cobre tudo o que está dentro dela. O `--no-config` ignora o arquivo por uma execução.

Um baseline, para um repositório com passivo. `prumo --baseline` grava todo achado da rodada em `.prumo-baseline.json` na raiz do repositório, e daí em diante uma rodada retém esses, falha só no que é novo, e diz no cabeçalho quantos reteve. Faça commit do arquivo, para que o CI e os hooks leiam o mesmo baseline. Um achado é gravado pelo tipo, pelo arquivo e pelo caminho que cita, com quantas linhas o citam; o número da linha fica de fora, porque muda a cada edição. Quando um achado retido é corrigido, o cabeçalho diz que uma entrada não casa mais com nada, e rodar `--baseline` de novo reescreve o arquivo com o que sobrou. O `--no-baseline` ignora o arquivo por uma execução, o `--fix` toca só o que foi reportado, e o servidor MCP aplica o baseline que encontra mas nunca grava um, porque reter um achado é decisão de uma pessoa.

As supressões e o baseline são contados no cabeçalho, então um repositório silenciado nunca se parece com um limpo.

---

## Corrigindo capitalização e renames automaticamente

```bash
prumo --fix
```

```
FIXED  2 paths in 1 file
  CLAUDE.md:18   layouts/AppLayout.vue  ->  resources/js/Layouts/AppLayout.vue
  CLAUDE.md:30   config/database.php  ->  config/db.php   renamed in a3f21c9
```

Duas coisas são reescritas, porque só nelas o valor correto é lido em vez de adivinhado: uma capitalização errada, cuja grafia vem do índice do git, e um caminho ausente ou um link markdown cujo arquivo o git registrou como renomeado, cujo nome novo vem do histórico. Todo o resto fica intocado: um link sugerido pelo nome é um palpite bem informado, um caminho ausente sem histórico pode estar ausente de propósito, e um arquivo apagado não tem o que ser escrito no lugar dele.

Toda forma de citar um caminho é reescrita onde está: entre crases, dentro de um comando, dentro de um bloco de código cercado, escrita com barra invertida, seguida de número de linha, e num link escrito como `[a](x)`, `[a](<x>)` ou `[ref]: x`. Um caminho renomeado é escrito do jeito que a citação era: a partir da raiz, a partir da pasta da nota, com `/` ou `mdc:` na frente, ou com os espaços como `%20`. Um caminho citado em várias linhas é corrigido em todas elas numa passada só.

Se uma linha mudou entre a varredura e o `--fix`, o prumo deixa a linha como está e avisa no relatório.
