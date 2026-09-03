# Resolvendo problemas e perguntas

[← README](../LEIAME.md) · [Read in English](troubleshooting.md)

---

## Resolvendo problemas

<details>
<summary><code>prumo: not a git repository</code></summary>

O prumo lê o índice do git para saber a grafia real de cada caminho, então precisa rodar contra um repositório.

```bash
cd /caminho/do/seu/projeto
prumo

# ou aponte de qualquer lugar
prumo /caminho/do/seu/projeto
```
</details>

<details>
<summary><code>prumo: no context files found</code></summary>

Não existe `CLAUDE.md`, `AGENTS.md` ou equivalente naquele repositório. Crie um, ou diga o que ler:

```bash
prumo . docs/arquitetura.md    # um arquivo
prumo . docs/                  # os .md que estão direto na pasta
```
</details>

<details>
<summary>Não reporta nada, mas algo está claramente desatualizado</summary>

Esperado. O prumo confere caminhos, capitalização e links, que é o que dá para verificar com exatidão. Ele não avalia se uma frase como *"esta flag desliga o cache"* continua correta. Veja [Por que tão poucas checagens](design.pt-BR.md#por-que-tão-poucas-checagens).
</details>

<details>
<summary>Ele apontou uma linha que está certa</summary>

Leia a frase antes de mudar qualquer coisa. Dois casos já são filtrados sozinhos: um caminho citado *porque sumiu*, como em *"o projeto não publica `config/dompdf.php`"*, e uma nota histórica como `fase-3-concluida.md`, cujo assunto inteiro é o que foi removido.

Se o seu escapou, uma frase mais clara costuma resolver. O filtro lê um parágrafo de contexto, em português e em inglês.
</details>

<details>
<summary>Erro de versão do Node, ou <code>Unexpected token</code></summary>

Você está num Node anterior ao 18. Confira com `node --version` e atualize em [nodejs.org](https://nodejs.org).
</details>

<details>
<summary>Windows: o caminho não é reconhecido</summary>

Use aspas em caminhos com espaço, e prefira barras normais:

```bash
prumo "C:/Users/eu/Meu Projeto"
```
</details>

---

## Perguntas

<details>
<summary><b>Ele manda meu código para algum lugar?</b></summary>

Não. O prumo não faz nenhuma chamada de rede. Ele lê seu markdown, roda `git ls-files` e imprime. Não há telemetria, conta, chave de API nem modelo envolvido; é um verificador estático e funciona offline.
</details>

<details>
<summary><b>Ele altera meus arquivos?</b></summary>

Só com `--fix`, e mesmo assim apenas a capitalização. Por padrão ele lê e imprime, e a edição é sua.
</details>

<details>
<summary><b>Preciso do Claude Code? Funciona com o meu agente?</b></summary>

Nenhum agente é necessário. O prumo lê arquivos, não agentes, e a [referência](reference.pt-BR.md#arquivos-encontrados-automaticamente) lista todos os arquivos e pastas que ele detecta sozinho. Notas de engenharia guardadas em `docs/` ficam desatualizadas do mesmo jeito, então aponte para lá também.
</details>

<details>
<summary><b>Funciona fora de projetos JavaScript?</b></summary>

Sim. Ele lê markdown e o índice do git, então independe de linguagem. Foi construído e medido em duas bases PHP e Vue, e as checagens de caminho reconhecem as raízes convencionais de projetos Python, Go, Rust, Ruby e Java.
</details>

<details>
<summary><b>Por que não usar markdownlint, ou um verificador de links?</b></summary>

Esses conferem um documento contra ele mesmo: sintaxe, estilo, links entre páginas. O prumo confere contra o código ao lado, que é a parte que se moveu. A checagem de capitalização também exige o índice do git especificamente, porque um `exists()` comum passa no Windows e no macOS para um caminho morto no Linux.
</details>

<details>
<summary><b>Com que frequência devo rodar?</b></summary>

Uma vez por pull request no CI é a resposta mais barata, já que leva segundos e não pede configuração. Fora isso, rode depois de renomeações e refatorações grandes, quando a documentação fica desatualizada mais rápido.
</details>
