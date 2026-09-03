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

Uma skill instalada na sua pasta de usuário, como `~/.claude/skills/<nome>/`, está fora de qualquer repositório, então o prumo não consegue lê-la ali. Verifique onde ela está publicada, ou rode `git init` dentro da pasta da skill antes.
</details>

<details>
<summary><code>prumo: the git index is empty</code></summary>

O repositório não tem nada commitado nem preparado, então não há com o que comparar as notas; todo caminho sairia como ausente. Rode `git add` nos arquivos antes. A mesma mensagem aparece quando um clone foi interrompido, por exemplo por um caminho longo demais para o Windows.
</details>

<details>
<summary><code>prumo: target not found</code></summary>

Um arquivo ou pasta que você nomeou na linha de comando, ou colocou em `targets` no `.prumorc.json`, não está lá. O prumo para em vez de checar outra coisa, para que um erro de digitação nunca volte como um relatório limpo sobre outro arquivo:

```bash
prumo . docs/arquitetura.md    # o nome precisa existir
```

O caminho é lido a partir da pasta do repositório, não de onde você está, a menos que você escreva o caminho absoluto.
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

Leia a frase antes de mudar qualquer coisa. Três casos já são filtrados sozinhos: um caminho citado *porque sumiu*, como em *"o projeto não publica `config/dompdf.php`"*; uma nota histórica como `fase-3-concluida.md`, cujo assunto inteiro é o que foi removido; e um caminho coberto pelo `.gitignore`, que está ausente de propósito.

Outros três não são, porque pedem julgamento:

- Uma receita que manda o leitor criar o arquivo, como em *"copie o modelo para `config/database.php`"*. O caminho está certo e o arquivo ainda não deve existir. Ponha `<!-- prumo-ignore -->` nessa linha.
- Um `[[wikilink]]` para uma nota guardada em outra pasta. Passe as duas pastas na mesma rodada, `prumo . notas-a notas-b`, e o link resolve.
- Uma página gerada por uma etapa de build, como a página inicial de um site de documentação. Liste-a em `ignore` no `.prumorc.json`, ou inclua no `.gitignore` se ela nunca deve ser versionada.

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

Sim. Ele lê markdown e o índice do git, então independe de linguagem. Foi construído e medido em duas bases PHP e Vue, depois conferido em repositórios públicos em Go, C++, Python e TypeScript, e as checagens de caminho reconhecem as raízes convencionais de projetos Python, Go, Rust, Ruby e Java.
</details>

<details>
<summary><b>Por que não usar markdownlint, ou um verificador de links?</b></summary>

Esses conferem um documento contra ele mesmo: sintaxe, estilo, links entre páginas. O prumo confere contra o código ao lado, que é a parte que se moveu. A checagem de capitalização também exige o índice do git especificamente, porque um `exists()` comum passa no Windows e no macOS para um caminho morto no Linux.
</details>

<details>
<summary><b>Com que frequência devo rodar?</b></summary>

Uma vez por pull request no CI é a resposta mais barata, já que leva segundos e não pede configuração. Fora isso, rode depois de renomeações e refatorações grandes, quando a documentação fica desatualizada mais rápido.
</details>
