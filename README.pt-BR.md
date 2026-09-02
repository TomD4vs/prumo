<p align="center">
  <img src="assets/social.png" alt="prumo — sua documentação está fora de prumo?" width="820">
</p>

<h1 align="center">prumo</h1>

<p align="center">
  <b>Sua documentação está fora de prumo?</b><br>
  <sub>Confere os arquivos de contexto que seu agente de código lê contra o código ao lado deles.</sub>
</p>

<p align="center">
  <a href="README.md">🇬🇧 Read in English</a>
</p>

---

## O problema, num exemplo só

Há três meses você escreveu isto no seu `CLAUDE.md`:

```markdown
A logo da sidebar fica em `layouts/AppLayout.vue`.
```

De lá para cá a pasta foi renomeada para `Layouts`, com L maiúsculo. No Windows e no macOS aquele caminho **continua abrindo**, então nada nunca reclamou. No Linux e no CI ele aponta para o nada — e todo agente de IA que lê o arquivo é mandado, com toda a confiança, para um lugar que não existe.

Essa linha sozinha sobreviveu a **seis auditorias feitas à mão** nos mesmos arquivos. O `prumo` achou em quatro segundos.

---

## Teste em 10 segundos

Você precisa de [Node.js 18+](https://nodejs.org) e `git`. Mais nada — sem instalar, sem configurar, sem conta.

Abra um terminal **dentro de qualquer repositório git** e rode:

```bash
npx @tomd4vs/prumo
```

É isso. O `prumo` acha seus arquivos de contexto sozinho.

<details>
<summary>O que é <code>npx</code>?</summary>

O `npx` vem junto com o Node.js. Ele baixa e roda uma ferramenta uma vez, sem instalar. Se for usar sempre, veja [Instalando](#instalando) mais abaixo.
</details>

---

## Lendo o resultado

### Se estiver tudo certo

```
prumo — 1 context file, 401 files in the git index

nothing to review.
```

A linha 1 diz **o que ele olhou**: um arquivo de contexto (achou seu `CLAUDE.md`) e 401 arquivos no repositório. A linha 3 é o veredito. Acabou.

### Se ele achar algo

Uma execução real, anotada:

```
prumo — 3 context files, 412 files in the git index     ← o que ele leu
        1 historical entry exempt from path checks      ← o que ele pulou de propósito

CASE MISMATCH  (1)   resolves on Windows and macOS, breaks on Linux and CI
  CLAUDE.md:18                                          ← arquivo e linha
      layouts/AppLayout.vue                             ← o que sua nota diz
      ->  resources/js/Layouts/AppLayout.vue            ← o que o repositório tem

BROKEN LINK  (2)   1 with a likely destination
  [[deploy-checklist]]   ->  deploy_checklist           ← o arquivo que provavelmente era
  [[old-architecture]]                                  ← sem candidato: renomeado ou apagado

MISSING PATH  (1)   paths cited to say they are gone were filtered out
  docs/setup.md:44  config/database.php                 ← arquivo, linha, caminho morto
      Copie o modelo para `config/database.php`…        ← a frase, para você julgar

4 to review                                             ← 1 + 2 + 1
```

Todo achado te dá **o arquivo, o número da linha e a correção**. Nada é adivinhado e nada é alterado.

---

## O que cada achado significa, e o que fazer

### 1. `CASE MISMATCH` — as letras não batem

**O que significa.** Sua nota escreve um caminho com maiúsculas/minúsculas diferentes das que o repositório usa de verdade. O `prumo` compara contra o **índice do git**, o único lugar que guarda a grafia real. Seu sistema de arquivos mente alegremente sobre isso no Windows e no macOS.

**Por que importa.** Funciona na sua máquina e quebra no Linux, no CI e no Docker — o clássico "mas aqui funciona".

**O que fazer.** Copie o caminho depois da seta `->` para dentro da nota. É o verdadeiro.

---

### 2. `BROKEN LINK` — um `[[link]]` para o nada

**O que significa.** Você escreveu `[[alguma-nota]]`, ou um link markdown como `[Instalação](docs/setup.md)`, e o destino não existe.

**Por que importa.** O agente que seguir aquele link não acha nada e segue adiante, calado.

**O que fazer.**
- **Se aparecer uma sugestão `->`**, é quase certo que seja o arquivo que você queria — normalmente os dois só divergem em `-` contra `_`. Corrija o lado que estiver errado.
- **Se não houver sugestão**, o destino foi renomeado ou apagado. Atualize o link ou remova.

> **Dica.** Ver centenas desses geralmente significa **uma causa sistemática**, não centenas de erros. Na execução acima, todos os links estavam em `kebab-case` e todos os arquivos nomeados em `snake_case`. Renomear os arquivos corrigiu 247 de uma vez.

---

### 3. `MISSING PATH` — o arquivo sumiu

**O que significa.** Sua nota aponta para um arquivo que não existe mais em lugar nenhum do repositório.

**O que fazer.** Ou atualize o caminho, ou — se você está citando *porque* ele sumiu — reescreva a frase dizendo isso. O `prumo` reconhece construções como *"foi removido"*, *"não existe mais"*, *"foi renomeado para"*, e aí fica quieto.

---

### 4. `NOT IN INDEX` *(só quando você passa uma pasta de notas)*

**O que significa.** A nota existe na pasta mas seu `MEMORY.md` nunca a menciona — então nada leva ninguém até ela.

**O que fazer.** Inclua no índice, ou apague o arquivo.

---

## Instalando

Você não precisa instalar nada — `npx @tomd4vs/prumo` sempre funciona. Mas se for usar sempre:

```bash
# disponível em qualquer lugar da máquina
npm install -g @tomd4vs/prumo
prumo

# ou como dependência de desenvolvimento de um projeto
npm install --save-dev @tomd4vs/prumo
npx prumo
```

---

## Todas as opções

```
prumo [repo] [alvo...] [opções]
```

| Argumento | Significado |
| --- | --- |
| `repo` | Caminho de um repositório git. O padrão é a pasta atual. |
| `alvo` | Um arquivo markdown, ou uma pasta deles. Omita e o `prumo` autodetecta (lista abaixo). |

| Opção | Significado |
| --- | --- |
| `--fix` | Corrige a caixa divergente no arquivo; nada mais é tocado |
| `--format F` | `text` (padrão), `github` ou `json` |
| `--all` | Mostra todos os achados em vez dos 25 primeiros |
| `--json ARQUIVO` | Grava também os achados em `ARQUIVO`, como JSON |
| `--quiet` | Não imprime nada; use só o código de saída |
| `--no-config` | Ignora o `.prumorc.json` |
| `-h`, `--help` | Mostra a ajuda |
| `-v`, `--version` | Mostra a versão |

**Arquivos achados automaticamente**

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

**Monorepo é coberto.** `CLAUDE.md` e `AGENTS.md` também são lidos em subpastas — `packages/api/AGENTS.md` entra igual ao da raiz.

### Exemplos

```bash
prumo                                  # este repositório, arquivos autodetectados
prumo .                                # o mesmo, escrito explicitamente
prumo . docs/notas                     # varre também uma pasta de markdown
prumo ~/trabalho/api                   # um repositório em outro lugar
prumo . --all                          # não corta a lista
prumo . --json achados.json            # salva os achados em JSON

# Windows: use aspas em caminho com espaço
prumo "C:/Users/eu/Meu Projeto"
```

### Códigos de saída

| Código | Significado |
| :---: | --- |
| `0` | Nada a revisar |
| `1` | Achados — algo precisa da sua atenção |
| `2` | Uso errado (não é repo git, nenhum arquivo achado, opção desconhecida) |

---

## Rodando no CI

Como ele sai com código diferente de zero quando acha algo, entra em qualquer pipeline como um passo:

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

> **Importante.** Use o `actions/checkout` normalmente — o `prumo` precisa do índice do git, então um checkout sem ele não funciona.

---

## Silenciando um achado

Uma hora o `prumo` vai acusar algo que você sabe que está certo. Há dois jeitos de dizer isso — use o mais estreito que resolver.

**Inline**, quando é uma linha:

```markdown
Nota antiga sobre `config/old.php`. <!-- prumo-ignore -->

<!-- prumo-ignore-next-line -->
Outra sobre `config/older.php`.

<!-- prumo-ignore-file -->
```

**`.prumorc.json`** na raiz do repositório, quando é um padrão:

```jsonc
{
  "ignore":    ["docs/legacy/**", "config/vendor.php"],  // caminhos e links a pular
  "exclude":   ["CHANGELOG.md"],                         // arquivos de contexto a não checar
  "targets":   ["CLAUDE.md", "docs/notas"],              // checar estes em vez de autodetectar
  "transient": ["public/dist", "coverage-html"]          // saída de build extra a ignorar
}
```

`ignore`, `exclude` e `transient` aceitam glob (`*`, `**`, `?`). Use `--no-config` para ignorar o arquivo uma vez. Toda supressão é contada no cabeçalho, então um repositório silenciado nunca se parece com um limpo.

---

## Corrigindo a caixa automaticamente

```bash
prumo --fix
```

```
FIXED  1 path in 1 file
  CLAUDE.md:18   layouts/AppLayout.vue  ->  resources/js/Layouts/AppLayout.vue
```

**Só a caixa divergente é corrigida, e isso é o ponto.** O valor certo é *lido do índice do git*, não adivinhado — então a reescrita não tem como inventar nada. Link quebrado e caminho inexistente nunca são tocados, porque ali a resposta certa exige um humano: sugestão de link é heurística, e caminho ausente pode estar ausente de propósito.

Linha que mudou desde a varredura é pulada e reportada, nunca reescrita.

---

## Saída para o CI

```bash
prumo --format github
```

```
::error file=CLAUDE.md,line=18::Case mismatch: layouts/AppLayout.vue should be resources/js/Layouts/AppLayout.vue
```

O GitHub renderiza isso como anotação **na linha exata do pull request**, em vez de enterrar no log do job. Use `--format json` para mandar os achados para outro lugar.

---

## Perguntas frequentes

<details>
<summary><b>Ele manda meu código para algum lugar?</b></summary>

Não. O `prumo` não faz nenhuma chamada de rede. Ele lê seu markdown, roda `git ls-files` e imprime. Sem telemetria, sem conta, sem chave de API e sem modelo — é um verificador estático simples, que funciona offline.
</details>

<details>
<summary><b>Ele altera meus arquivos?</b></summary>

Nunca. Ele só lê. Todo achado é impresso com o arquivo, a linha, o valor errado e o certo, e a edição é sua. Isso é proposital: nota corrigida errado é pior que nota velha, porque você para de desconfiar dela.
</details>

<details>
<summary><b>Preciso do Claude Code? Funciona com o meu agente?</b></summary>

Você não precisa de agente nenhum. O `prumo` lê arquivos, não agentes — veja na tabela acima as nove ferramentas que ele detecta sozinho. E se você guarda anotações de engenharia em `docs/`, aponte para lá: elas apodrecem igual.
</details>

<details>
<summary><b>Funciona fora de projeto JavaScript?</b></summary>

Sim. Ele lê markdown e o índice do git, então é agnóstico de linguagem. Foi construído e medido contra duas bases PHP + Vue, e as checagens de caminho reconhecem as raízes convencionais de projetos Python, Go, Rust, Ruby e Java.
</details>

<details>
<summary><b>Por que não usar markdownlint, ou um verificador de links?</b></summary>

Eles conferem o documento contra **ele mesmo** — sintaxe, estilo, links entre páginas. O `prumo` confere o documento contra **o código ao lado dele**, que é o que se moveu. E a checagem de caixa precisa especificamente do índice do git: um `exists()` comum passa no Windows e no macOS para um caminho que está morto no Linux, então um verificador genérico não enxerga isso.
</details>

<details>
<summary><b>De quanto em quanto tempo devo rodar?</b></summary>

Uma vez no CI a cada pull request é a resposta barata — leva segundos e não precisa de configuração. Fora isso, rode sempre que mexer no arquivo de contexto, e depois de qualquer rename ou refatoração grande, que é quando a documentação entorta mais rápido.
</details>

---

## Deu algum problema?

<details>
<summary><code>prumo: not a git repository</code></summary>

O `prumo` lê o índice do git para saber a grafia verdadeira de cada caminho, então ele precisa rodar dentro de um repositório.

```bash
cd /caminho/do/seu/projeto   # entre no repositório
prumo
# ou aponte para ele de qualquer lugar
prumo /caminho/do/seu/projeto
```
</details>

<details>
<summary><code>prumo: no context files found</code></summary>

Não há `CLAUDE.md`, `AGENTS.md` nem similar naquele repositório. Ou crie um, ou diga ao `prumo` o que ler:

```bash
prumo . docs/arquitetura.md     # um arquivo
prumo . docs/                   # todo .md de uma pasta
```
</details>

<details>
<summary>Ele não reporta nada, mas tenho certeza de que há coisa desatualizada</summary>

Isso é esperado, e é uma decisão de projeto. O `prumo` só checa caminho, caixa e link — o que a máquina verifica **com exatidão**. Ele não julga se uma frase como *"essa flag desliga o cache"* ainda é verdade. Veja [Por que tão poucas checagens](#por-que-tão-poucas-checagens).
</details>

<details>
<summary>Ele acusou uma linha que está certa</summary>

Leia a frase antes de mudar qualquer coisa — é a regra sobre a qual a ferramenta inteira foi construída. Dois casos já são filtrados sozinhos:

- caminho citado **porque sumiu** — *"o projeto não publica `config/dompdf.php`"*
- nota **histórica**, como `fase-3-concluida.md`, cujo conteúdo inteiro é o que foi removido

Se o seu escapou, a correção costuma ser uma frase mais clara. O filtro lê um parágrafo em volta da linha, em português e em inglês.
</details>

<details>
<summary>Erro de versão do Node, ou <code>Unexpected token</code></summary>

Seu Node é anterior ao 18. Confira com `node --version` e atualize em [nodejs.org](https://nodejs.org).
</details>

<details>
<summary>Windows: o caminho não é reconhecido</summary>

Use aspas em caminho com espaço, e prefira barras normais:

```bash
prumo "C:/Users/eu/Meu Projeto"
```
</details>

---

## Por que tão poucas checagens

A funcionalidade óbvia é "conferir todo símbolo das notas contra o código". Ela foi construída, rodada em duas bases em produção e jogada fora.

A medição: sete auditorias do mesmo acervo — seis à mão, uma pela própria ferramenta. Em cerca de **512 alertas, dez eram reais**. Detector de **2% de precisão** ninguém roda duas vezes, porque ler o ruído custa mais caro do que a podridão.

Então o `prumo` fica só com as checagens que quase sempre acertam, e gasta a maior parte do código em **não** dar alarme falso:

| Filtro | Por que existe |
| --- | --- |
| Negação, lida no parágrafo | *"o projeto não publica `config/x.php`"* nomeia um arquivo que **não pode** existir. O grep vê caminho morto; quem lê vê frase certa. |
| Nota histórica é isenta | Uma entrada chamada *fase 3 concluída* cita o que foi removido depois. Isso é o conteúdo dela, não um defeito. |
| Artefato transitório ignorado | `public/build`, `.vite`, `node_modules`, `dist` — nascem e morrem fora do git. |
| Alias e caminho curto resolvidos | `@/utils/foo.js` e `tests/Concerns/LeTextoDePdf` são referências reais, escritas curtas. |

O efeito, mesma ferramenta, mesmos arquivos:

| Alvo | Arquivos | Antes dos filtros | Depois |
| --- | ---: | ---: | ---: |
| Pasta de notas, projeto A | 206 | 229 | **1** |
| `CLAUDE.md`, projeto A | 1 | 4 | **0** |
| Pasta de notas, projeto B | 66 | 251 | **10** |
| `CLAUDE.md`, projeto B | 1 | 8 | **1** |

---

## O que ele nunca vai fazer

- **Julgar uma afirmação.** *"Essa flag faz X"* está fora do alcance, de propósito.
- **Editar seus arquivos.** Ele imprime; você decide. Nota corrigida errado é pior que nota velha, porque você para de desconfiar dela.
- **Falar com a internet.** Nenhuma chamada de rede, nenhuma telemetria, nenhuma conta, nenhum modelo.

---

## Usando pelo código

```js
import { analyze, resolveTargets } from 'prumo';

const alvos = resolveTargets('.', []);            // [] = autodetectar
const r     = analyze({ repo: '.', targets: alvos });

console.log(r.caseMismatch);   // [{ file, line, cited, actual }]
console.log(r.brokenLinks);    // [{ file, line, cited, suggestion }]
console.log(r.missingPaths);   // [{ file, line, cited, excerpt }]
console.log(r.orphans);        // ['nota-que-ninguem-linka.md']
console.log(r.stats);          // { tracked, targets, historical }
```

---

## Desenvolvimento

```bash
git clone https://github.com/TomD4vs/prumo.git
cd prumo
node --test          # 22 testes, sem dependência
node bin/prumo.mjs . # roda nele mesmo
```

Cada teste monta um repositório git descartável, então a suíte não precisa de fixture no repo e não deixa nada para trás. O CI roda em Linux, Windows e macOS contra Node 18, 20 e 22 — a checagem de caixa se comporta diferente por plataforma, então os três importam.

---

## De onde vem o nome

**prumo** é o fio com peso que o pedreiro pendura na parede para saber se ela ainda está reta. Em inglês, *true* também é o termo de marcenaria para "alinhado" — então o trocadilho funciona nos dois idiomas.

Documentação entorta igual a uma parede: devagar, sem aparecer, até alguém construir em cima.

## Requisitos

Node 18 ou mais novo, e `git` no `PATH`. Zero dependências.

## Licença

MIT
