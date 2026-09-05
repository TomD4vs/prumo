# Design

[← README](../LEIAME.md) · [Read in English](design.md)

Por que o prumo checa tão pouco, o que custou descobrir isso, como um caminho é resolvido, e de onde vem o nome.

---

## Por que tão poucas checagens

A funcionalidade óbvia é conferir todo símbolo das notas contra o código. Um protótipo inicial fazia exatamente isso. Rodado em duas bases de produção, levantou cerca de **512 alertas, dos quais dez eram reais**. Isso dá mais ou menos 2% de precisão, conferida com o que sete revisões do mesmo material tinham encontrado, seis delas feitas à mão. Essa checagem foi removida. Um detector que erra 98% das vezes ninguém roda duas vezes, porque ler os alarmes falsos custa mais do que a documentação desatualizada que eles deveriam pegar.

O que foi lançado faz o contrário: só as checagens que quase sempre acertam, com a maior parte do código gasta em mantê-las caladas:

| Filtro | Por que existe |
| --- | --- |
| Negação, lida no parágrafo | *"o projeto não publica `config/x.php`"* nomeia um arquivo que **não pode** existir. O grep vê caminho morto; quem lê vê frase certa. Uma frase que faz da existência uma condição, *"se `docs/contexto.md` existir, leia"*, diz o mesmo sobre o arquivo que nomeia. |
| Um arquivo que documenta outro projeto | Um arquivo de contexto cujos caminhos citados começam, na maior parte, em pastas que este repositório não tem é um modelo, ou uma skill escrita para a base de código em que vai ser instalada. Seus achados ficam retidos atrás de uma linha que o nomeia, e um arquivo nomeado na linha de comando é sempre checado por inteiro. Na quarta passagem, dezenove dos vinte e nove falsos estavam em seis repositórios onde nada era real, e na oitava todo falso que sobrou fora dos catálogos tinha essa forma. A pasta é o sinal porque uma nota envelhecida ainda cita as pastas que o repositório tem. Desde a décima terceira passagem a mesma leitura é feita do repositório por inteiro, somando todos os arquivos de contexto, porque um plugin publicado para outra base de código e notas que linkam um wiki guardado em outro lugar citam caminhos de menos por arquivo para o portão por arquivo, e em maioria ausentes no repositório inteiro. |
| Uma regra viva por um glob, uma pasta de regras guardada para várias stacks | Uma regra do Cursor ou uma instrução do Copilot se acopla quando qualquer um de seus globs casa, então um glob morto ao lado de um vivo fica em paz; só uma regra em que nenhum glob alcança um arquivo é reportada. E uma pasta de regras em que a maioria das regras não casa com nada aqui é um catálogo escrito para os projetos em que vai ser copiado, retido como fica um arquivo que documenta outro projeto. Na décima primeira passagem, todo glob que uma primeira versão reportou um a um estava ao lado de um vivo. |
| Bloco cercado lido como código, comentário não lido | Um caminho dentro de um bloco ```` ``` ```` é um comando ou uma árvore de arquivos e é checado como tal, com a frase acima do bloco como contexto. Um link ali está sendo citado, como qualquer coisa dentro de `<!-- -->`, e nenhum dos dois é checado. Uma linha de comentário dentro do bloco é o que um comando imprime, e `./nome` sem pasta é um argumento que o leitor fornece. Um bloco numa linguagem de programação, `js` ou `python`, é código-fonte, e uma string ali é um especificador de módulo que a linguagem resolve, então ele não é lido. |
| Um caminho que a frase diz que é escrito | *"Output: `docs/report.md`"*, *"salve o plano em `docs/plano.md`"* e *"`docs/run.log` é gerado pelo build"* nomeiam um arquivo que ainda não existe por definição. O verbo mais perto do caminho na frase decide, então *"leia `a` e escreva o resultado em `b`"* mantém `a` checado, e um verbo depois do caminho só conta na voz passiva, porque *"`x` cria usuários"* faz do caminho o autor. Uma lista, uma tabela ou um bloco cercado toma o veredito da frase que os apresenta ou do título da seção; num comando, um redirecionamento `>`, uma flag `-o` e `mkdir` marcam o que é escrito. Um caminho com a caixa errada é reportado diga a frase o que disser. |
| Nota histórica é isenta | Uma entrada chamada *fase 3 concluída* cita o que foi removido depois. Esse é o assunto dela, não um defeito. |
| Artefato transitório ignorado | `public/build`, `.vite`, `node_modules`, `dist` nascem e morrem fora do git. |
| Alias, caminho curto e extensão emitida resolvidos | `@/utils/foo.js` e `tests/Concerns/LeTextoDePdf` são referências reais escritas em forma curta. O `@/` é testado contra a raiz do repositório além de `src`, `app` e os demais, e um projeto TypeScript que escreve `./logger.js` para o `logger.ts` que o git guarda é casado com a fonte. Um link que resolve a partir da raiz do repositório e de nenhum outro lugar é lido a partir da raiz, como um agente o lê. |
| Marcador de posição e identificador | `path/to/test.js`, `src/foo/bar.test.ts` e `src/plugins/myplugin.ts` num exemplo de comando, `chapters/ch01-<slug>.md` e `.agents/commands/[name].md` num template, `reports/review-YYYY-MM-DD.md` e `shots/shot_NN.md` para um arquivo ainda a escrever, e `server/discover` ao lado de `tools/list` não são arquivos. Nem `constants.hpp/.cpp`, que são dois arquivos num token só, nem `docs.exemplo.com/guia.md`, que é um endereço da web sem o esquema. Um nome sem extensão só é caminho quando a pasta com que ele começa existe ali. |
| Prefixo com o nome do projeto resolvido | `meuapp/app/api/route.ts` quando o repositório guarda `app/api/route.ts` e não tem pasta `meuapp/`. Só vale casamento exato e aninhado, então um primeiro segmento com a caixa errada continua sendo case mismatch. Um prefixo que deixaria um arquivo solto na raiz é mantido, a menos que seja o nome do próprio repositório na origem, como faz uma nota que escreve `dono/repo/AGENTS.md`; a décima quarta passagem teve um repositório fazendo isso em vinte e nove arquivos. |
| Caminho que pertence a outro repositório | Uma nota que nomeia `github.com/outro/projeto` algumas linhas acima do caminho, e um alias `@/` num repositório que não tem nenhuma das pastas contra as quais um alias resolve. Os dois descrevem código que mora em outro lugar. |
| Import de pacote não é caminho | `@escopo/pacote/style.css` é algo que o npm resolve, não um arquivo daqui. Um alias `@/` mantém a barra logo depois do `@`, então continua sendo checado. |
| Um arquivo que cada máquina escreve para si | `CLAUDE.local.md`, `settings.local.json`, `.env.local`: um nome com `.local` antes da extensão é escrito por máquina e nunca entra no commit, então uma nota que manda o agente lê-lo nomeia um arquivo ausente de propósito. Na décima segunda passagem um repositório citou um arquivo assim sete vezes. |
| Uma skill citada pelo caminho de instalação | `.claude/skills/deploy/scripts/x.sh` é onde um host instala a skill; a skill em si mora numa pasta de plugin, numa pasta de docs ou na pasta de outro host, e o script está lá. Quando o mesmo arquivo existe ao lado de um `SKILL.md` em algum lugar do repositório, a citação resolve. |
| Algo que só o autor sabe estar certo | `.prumorc.json`, os marcadores `prumo-ignore` e, num repositório com passivo, o baseline que retém o que existia quando foi gravado. Toda supressão é contada no cabeçalho, então um repositório silenciado nunca se parece com um limpo. |

Mesma ferramenta, mesmos arquivos, com e sem os filtros:

| Alvo | Arquivos | Antes dos filtros | Depois |
| --- | ---: | ---: | ---: |
| Pasta de notas, projeto A | 206 | 229 | **1** |
| `CLAUDE.md`, projeto A | 1 | 4 | **0** |
| Pasta de notas, projeto B | 66 | 251 | **10** |
| `CLAUDE.md`, projeto B | 1 | 8 | **1** |

Essas colunas contam alarmes falsos removidos; não são um número de precisão. Os dois projetos acima vêm sendo mantidos com o prumo desde então, então o que sobra neles é o que o prumo não consegue resolver, não uma amostra do que ele pega.

A precisão em si foi medida depois, em repositórios públicos que têm um `AGENTS.md` na raiz, escolhidos numa busca de código do GitHub e nunca vistos pelo prumo antes:

| Repositórios públicos, 2026-09-03 | |
| --- | ---: |
| Repositórios verificados | 14 |
| Limpos | 8 |
| Achados da versão daquele dia | 11 |
| Reais | 8 |
| Falsos | 3 |
| Achados da versão seguinte | 8 |

Os reais foram uma skill que promete guias que ela não traz, e um cabeçalho citado com um nome que nunca teve. Cada falso virou regra no mesmo dia: um link que começa com `/` resolve a partir da raiz do repositório, como o GitHub faz; um arquivo de contexto dentro de `vendor/` documenta uma dependência e não é alvo; e um índice do git vazio é erro, não uma parede de caminhos ausentes. A amostra é pequena, e o próximo repositório vai achar a próxima regra. O número está publicado para que o leitor saiba em que ele se apoia.

Uma segunda passagem no mesmo dia, em repositórios nunca checados antes e nenhum deles da primeira lista:

| Repositórios públicos, segunda passagem | |
| --- | ---: |
| Repositórios checados | 16 |
| Limpos | 12 |
| Achados levantados pela versão do dia | 6 |
| Reais | 3 |
| Falsos | 3 |
| Achados levantados pela versão seguinte | 3 |
| As duas listas juntas, antes das regras novas | 14 |
| As duas listas juntas, depois delas | 11 |

Os reais eram dois documentos que tinham mudado para uma subpasta e uma página de referência convertida para
outro formato enquanto a nota ainda nomeava o arquivo antigo. Os falsos viraram a linha de marcador de posição
e identificador da tabela de filtros. Nada real se perdeu: os achados que somem entre as duas últimas linhas
são exatamente os falsos.

Uma terceira passagem, em quarenta repositórios que não estavam em nenhuma das duas listas, e buscados pelo
`CLAUDE.md` além do `AGENTS.md` pela primeira vez:

| Repositórios públicos, terceira passagem | |
| --- | ---: |
| Repositórios checados | 40 |
| Limpos | 28 |
| Achados levantados pela versão do dia | 35 |
| Reais | 15 |
| Falsos | 20 |
| Achados levantados pela versão seguinte | 19 |

Saíram dela quatro filtros, publicados juntos: um alias `@/` testado contra a raiz do repositório, um
especificador de pacote com escopo lido como import do npm e não como caminho, a fonte TypeScript por trás de
um `.js` emitido, e o nome do projeto escrito na frente de um caminho real. Os mesmos quinze achados reais
sobrevivem aos quatro.

Essa última linha não é uma medida de precisão, pelo mesmo motivo que a primeira tabela não é: os quatro
filtros foram construídos a partir dos próprios achados que os mediram. Então uma quarta passagem correu em
quarenta e cinco repositórios que nada disso havia tocado, com a versão publicada, e sem permissão de mexer
em filtro nenhum, desse no que desse:

| Repositórios públicos, quarta passagem | |
| --- | ---: |
| Repositórios checados | 45 |
| Limpos | 30 |
| Com pelo menos um achado real | 9 |
| Onde todo achado era falso | 6 |
| Achados | 61 |
| Reais | 32 |
| Falsos | 29 |
| Precisão sobre todos os achados | **52%** |
| Precisão nos nove que tinham algo real | **76%** |

Leia as duas linhas de precisão juntas, porque elas respondem a perguntas diferentes. Dois de cada três
repositórios receberam `nothing to review`. Nos nove em que o prumo achou algo real, três achados em quatro
estavam certos. E os falsos não estão espalhados pela amostra: dezenove dos vinte e nove ficam em seis
repositórios onde nada era real, e a maioria desses seis documenta um código que mora em outro lugar. Um é uma
skill cujos caminhos pertencem ao repositório público que ela nomeia duas linhas acima; outro é uma pasta de
configuração de agente escrita para os projetos em que ela é copiada.

**52% foi o que este projeto mediu ali**, sobre todos os achados, e foi o primeiro número tirado de material que não moldou regra nenhuma. A passagem seguinte diz até onde esse
número viaja. As nove famílias por trás dos vinte e nove falsos são conhecidas e
estão anotadas. Depois do caminho que pertence a outro repositório, elas são pequenas: colchetes em
`[name].md`, um `YYYY-MM-DD` num nome de arquivo ainda a criar, um nome de domínio lido como pasta, uma
negação escrita num terceiro idioma. Elas ficam de propósito. Consertá-las torna o número ajustado de novo, e
o seguinte teria de ser medido em repositórios que nenhum dos consertos usou.

Uma quinta passagem, em mais trinta e cinco repositórios que não estavam em nenhuma lista anterior,
diz algo que a quarta não podia dizer, porque desta vez a busca incluiu `SKILL.md` e alcançou um tipo
de projeto que as amostras anteriores quase não tinham: uma skill cujo propósito inteiro é escrever
arquivos.

| Repositórios públicos, quinta passagem | |
| --- | ---: |
| Repositórios checados | 35 |
| Limpos | 26 |
| Achados | 40 |
| Reais | 5 |
| Falsos | 35 |
| Precisão | 13% |

Trinta desses trinta e cinco falsos são uma família só. As notas dizem *"Output:
`docs/gtm/strategy.md`"*, *"Save to `planning/milestone_X_tasks.md`"*, *"Location:
`context/session-XXX.md`"*, e o prumo lê um caminho que não está lá, porque o arquivo ainda não foi
gerado. Um repositório sozinho responde por dezenove deles.

Posta ao lado da quarta passagem, essa não é uma versão piorando. A mesma versão publicada levanta
64% no material da quarta e 13% no da quinta, então o que mudou foi o material, não a ferramenta. A
afirmação honesta é condicional, e é o limite que vale conhecer antes de instalar: **num repositório
que documenta código que existe, a maior parte do que o prumo diz está certa; num que documenta
código que um gerador vai escrever, a maior parte não está.** Distinguir os dois é a regra que a 0.5.1
acrescentou, pelo verbo que rege o caminho, e a oitava passagem abaixo mede essa regra em repositórios
que nada disso usou. Neste quinto corpus mesmo, a 0.5.0 levantava 31 achados com 7 reais, 23%; a 0.5.1
levanta 16, os mesmos 7 mais um script renomeado por baixo da nota, 50%, e os dezesseis que saíram são
todos falsos.

Veio então uma sexta passagem, em mais cinquenta repositórios, com o código congelado antes de rodar e
sem permissão de mexer em filtro, desse no que desse:

| Repositórios públicos, sexta passagem | |
| --- | ---: |
| Repositórios checados | 36 |
| Limpos | 26 |
| Achados | 25 |
| Reais | 8 |
| Falsos | 17 |
| Precisão | 32% |
| Precisão nos três que tinham algo real | 100% |

Duas passagens com números diferentes convidam a uma leitura errada, então vale fechar essa porta: uma
porcentagem comparada entre passagens compara populações, não versões. Só um acervo fixo compara
versões, e em acervo fixo toda release removeu achado falso e manteve todos os reais:

| Medido no mesmo material | quarta passagem, 45 repos | sexta passagem, 50 repos |
| --- | ---: | ---: |
| 0.4.7 | 52% | 30% |
| 0.4.10 | 86% | 32% |
| 0.5.1 | 87% | 57% |
| 0.5.2 | 92% | 57% |
| 0.5.3 | 92% | 62% |

Lendo uma coluna, a ferramenta melhorou. Lendo uma linha, o material é outro. As duas coisas são
verdade, e só as colunas respondem se uma release ajudou. A última linha conta as três checagens que as
linhas anteriores tinham, para as colunas continuarem comparáveis; as duas checagens que a 0.5.1
acrescentou aparecem por conta própria na oitava passagem, abaixo.

A distância entre 86% e 32% é o que o ajuste custa. Os filtros da coluna da esquerda foram construídos
a partir daquele mesmo material; medido onde nada foi ajustado, o mais novo deles vale um achado em
vinte e seis. É por isso que os dois números estão publicados aqui, e por que nenhum deles vale ser
citado sem o material de onde saiu.

Uma sétima passagem, em sessenta repositórios fora de todas as listas anteriores, amostrados de uma busca que
incluiu `SKILL.md`. Esta rodou a 0.4.10 publicada e a árvore da 0.5.0 sobre o mesmo material, então o que ela compara
são duas versões da ferramenta sobre um conjunto só de repositórios:

| Repositórios públicos, sétima passagem, 0.4.10 contra 0.5.0 | |
| --- | ---: |
| Repositórios checados | 57 |
| Limpos na 0.4.10 | 36 |
| Limpos na 0.5.0 | 34 |
| Achados na 0.4.10 | 2599 |
| Achados na 0.5.0 | 2863 |
| Removidos, todos falsos: prefixo `$VAR/`, exemplo com `e.g.` | 144 |
| Acrescentados como o mesmo caminho em outra linha | 404 |
| Acrescentados por blocos de código cercados | 4 |
| Desses, reais | 2 |

Nove achados em dez nesse material estão em cinco repositórios que catalogam skills para outros projetos. É a
forma que a quinta passagem mediu, então nenhuma precisão por achado é reivindicada aqui. O que a passagem diz
é mais estreito. Ler blocos cercados achou dois comandos de teste desatualizados num repositório que a 0.4.10
chamava de limpo, e dois arquivos de saída de exemplo em outro. `.claude/commands` virou alvo em dois
repositórios e não levantou nada. `.claude/agents` foi testada do mesmo jeito e descartada, porque seus quinze
achados eram todos caminhos de exemplo dentro de definições de agente. Três regras saíram desse material, a
variável de shell, o `e.g.` e uma pasta chamada `path`, então a próxima passagem precisa rodar em repositórios
que nada disso tocou.

Uma oitava passagem, para a 0.5.1, em sessenta repositórios achados buscando `SKILL.md` por "Output",
"generates" e "Save to", nenhum em lista anterior: o material em que uma skill escreve arquivos, que é
a forma que levou a quinta passagem a 13%. A regra que lê o verbo foi congelada antes de o corpus ser
clonado. Quinze dos sessenta não têm arquivo de contexto que o prumo detecte, e dezessete são catálogos
de skills para outros projetos, cada um com mais de cinquenta achados na 0.5.0, então ficam contados à
parte:

| Repositórios públicos, oitava passagem, 0.5.0 contra 0.5.1 | |
| --- | ---: |
| Repositórios checados | 45 |
| Catálogos de skills, mais de cinquenta achados cada | 17 |
| Achados nos catálogos na 0.5.0 | 29825 |
| Achados nos catálogos na 0.5.1 | 29626 |
| Removidos ali, de quarenta lidos à mão, falsos | 39 |
| Os outros 28 repositórios, achados na 0.5.0 | 294 |
| Reais | 133 |
| Achados na 0.5.1 | 267 |
| Reais | 134 |
| Precisão, 0.5.0 | 45% |
| Precisão, 0.5.1 | 50% |

Real aqui quer dizer que o arquivo, o script ou o título não está lá, faça o mantenedor o que fizer com
isso: uma skill copiada sem a pasta `references/` conta, como contou na sexta passagem. O que continua
falso tem uma forma só, uma skill que documenta o projeto em que vai ser instalada, e nenhuma regra por
frase alcança isso; um portão sobre o arquivo inteiro é a próxima coisa a medir. Três regras nasceram
deste corpus e por isso não são medidas por ele: um link que resolve a partir da raiz do repositório e
de nenhum outro lugar, a ferramenta depois de *"generated by"*, e `pnpm --dir` como comando que aponta
para outro lugar. A única remoção lida à mão que estava errada virou a segunda delas.

As duas checagens que a 0.5.1 acrescentou foram medidas em todo corpus no disco, e o retrato é o mesmo
que os caminhos já davam. No quarto corpus, quarenta e cinco repositórios que documentam código que
existe, a checagem de comandos levantou quatro achados e os quatro são reais, um script e um alvo
renomeados por baixo da nota; a de âncoras levantou vinte e oito, todos sumários cujos links não rolam
a página no GitHub, porque um título que abre com emoji ou número ganha uma âncora que o link escrito à
mão não tem. No quinto corpus, o único comando levantado é real. No oitavo, os comandos levantados
dentro dos catálogos nomeiam scripts dos projetos a que aquelas skills se destinam, que é a mesma
família falsa dos caminhos.

Uma nona passagem, para a 0.5.2, em sessenta repositórios de buscas simples por `SKILL.md`,
`CLAUDE.md` e `AGENTS.md`, nenhum em lista anterior, a 0.5.1 publicada contra esta release. O portão
sobre o arquivo que documenta outro projeto, a existência condicional, os colchetes de template e o
trecho numerado foram congelados antes de ela rodar; seis regras menores nasceram do que ela mostrou
e estão marcadas como tal. Oito dos sessenta não têm arquivo de contexto que o prumo detecte, oito
são catálogos acima de cinquenta achados, e os outros quarenta e quatro ficam contados à parte:

| Repositórios públicos, nona passagem, 0.5.1 contra 0.5.2 | |
| --- | ---: |
| Repositórios checados | 52 |
| Catálogos de skills, mais de cinquenta achados cada | 8 |
| Achados nos catálogos na 0.5.1 | 1991 |
| Achados nos catálogos na 0.5.2 | 1650 |
| Retidos ali, de trinta lidos à mão: caminhos de outro projeto, endpoints de API escritos como caminho, hosts lidos como pasta | 18 |
| Dos mesmos trinta: um pacote de personas linkando arquivos de prompt que não carrega | 12 |
| Os outros 44 repositórios, achados na 0.5.1 | 87 |
| Reais | 30 |
| Achados na 0.5.2 | 69 |
| Reais | 29 |
| Precisão, 0.5.1 | 34% |
| Precisão, 0.5.2 | 42% |

O portão não disparou em nenhum dos quarenta e quatro. O que ele reteve está em três catálogos, e os
doze links do pacote de personas são a troca que ele faz: pela convenção acima são reais, porque os
arquivos de prompt não estão lá, e o portão lê um arquivo cujas pastas estão todas ausentes como
pertencente a outro lugar e diz isso numa linha. Os dezoito achados que saíram dos quarenta e quatro
são cinco *"migrated from"*, seis endereços `file://`, dois argumentos entre aspas que uma linha de
`make` tinha partido em alvo, um estêncil, um `:simbolo`, e um que a convenção chamava de real, um
stub cujo corpo tinha *"moved to"* outro arquivo. As três regras que a 0.5.1 tirou do oitavo corpus
não mudaram nada aqui. No oitavo corpus esta release remove mais vinte achados fora dos catálogos,
todos falsos, 267 para 247 e 50% para 54%, e 3807 dentro deles; no quarto remove os dois hosts lidos
como pasta, família nomeada ali e intocada desde então, e as três checagens que ela divide com a
0.4.7 ficam em 92%.

Uma décima passagem, para a 0.5.3, em sessenta repositórios das mesmas buscas, nenhum em lista
anterior. Ela responde duas perguntas. As seis regras que a 0.5.2 tinha tirado do nono corpus,
rodadas aqui como 0.5.1 contra 0.5.2, removem 67 achados e não acrescentam nenhum, todos falsos: 61
são hosts escritos sem esquema num segundo repositório de skills jurídicas alemãs, a mesma família
que o nono tinha mostrado, e o resto é um *"moved"*, três *"if `x` exists"* e um
`[[tool.mypy.overrides]]`. As quatro regras que esta release acrescenta das sobras do nono valeram
doze achados no nono, onde foram encontradas, um no sexto e um aqui. Nove dos sessenta não têm
arquivo de contexto que o prumo detecte, dois são catálogos, e os outros quarenta e nove ficam
contados à parte:

| Repositórios públicos, décima passagem, 0.5.1 a 0.5.3 | |
| --- | ---: |
| Repositórios checados | 51 |
| Achados na 0.5.1 | 582 |
| Removidos pelas seis regras que a 0.5.2 tirou do nono, todos falsos | 67 |
| Desses, hosts escritos sem esquema | 61 |
| Achados na 0.5.2 | 515 |
| Os 49 repositórios fora dos catálogos, na 0.5.2 | 143 |
| Reais | 45 |
| Precisão | 31% |
| Removidos ali pelas quatro regras da 0.5.3 | 0 |
| Removidos ali por cinco regras nascidas deste corpus, todos falsos | 18 |
| Achados na 0.5.3, os mesmos 45 reais | 125 |
| Precisão | 36% |

Os reais têm as formas que as passagens anteriores já conheciam: referências cruzadas entre skills
de um mesmo repositório cujos nomes mudaram, um módulo documentado em `docs/` que `src/` não tem
mais, uma tabela de arquivos com contagem de linhas nomeando três arquivos que se moveram, e skills
copiadas linkando vizinhas que nunca foram copiadas. Os falsos são skills copiadas para outro
projeto, uma de Laravel, uma de Convex, um revisor de código com seu próprio `npm run preflight`,
mais locais de configuração do usuário, wikilinks de template como `[[Person Name]]`, e notas de
renomeação escritas como *"(was `x`)"*. As cinco regras nascidas deste corpus, e por isso sem
medida: a condição pode vir depois do caminho, *"read `x` if it exists"*; `managed_components/` é
pasta de dependência, então os arquivos de contexto de um componente não são alvos; estênceis
`YYYYMMDD` e `YYYY-MM`; `foo.py`; e `:initConfig()` depois de um caminho. Nos corpora fixos esta
release muda um achado, o sexto perde o *"No project skills found"* e fica em 62%; o quarto e o
quinto seguem intocados, e os quarenta e quatro do nono vão de 69 achados para 57 com os mesmos 29
reais, 42% para 51%. Dentro dos catálogos do oitavo e do nono, um arquivo que perde um caminho de
exemplo para a regra de marcador pode cair abaixo do portão, e seus outros achados reaparecem:
vinte e oito lá e sete aqui, arquivos de execução e caminhos de outro projeto, nenhum real.

Uma décima primeira passagem, para a 0.7.0, é a primeira medição da quinta checagem, e rodou em
todos os corpora de uma vez, os oito acima, porque a checagem é nova e as três mais antigas não
mudaram: nos corpora fixos esta release não remove nem acrescenta nada fora da seção nova. A
primeira versão da checagem, rodada antes de qualquer decisão, levantou mais de cinco mil achados
nos oito, quase todos errados dos mesmos poucos jeitos, e as seis decisões que vieram depois foram
tomadas sobre esse material, então o número abaixo é ajustado; um décimo segundo corpus seria o
primeiro número honesto desta checagem. O `name` de uma skill era cobrado contra a pasta, e só o
oitavo corpus tinha 3767 skills com nome diferente da pasta sob um host que trata o nome como
rótulo, então a comparação foi retirada. Cada glob de uma regra era reportado um a um, e cada um dos
oito reportados no nono e no décimo primeiro estava ao lado de um glob vivo na mesma regra, então
uma regra só é reportada quando nenhum de seus globs casa. Uma `description:` espalhada por uma
segunda linha indentada era lida como vazia. Uma pasta de regras escrita para várias stacks tinha a
maioria das regras morta, 14 de 16 e 5 de 7 no quinto, e agora fica retida como fica um arquivo que
documenta outro projeto. Um glob escrito como extensão nua, `.cpp`, num repositório com duzentos
arquivos `.cpp`, é lido como qualquer arquivo `.cpp`. E um `SKILL.md` fora da pasta de skills de
um host cujo frontmatter segue outro esquema, 48 no oitavo com `metadata:` ou `slug:` e sem
`name`, deixou de ser lido como skill.

| Repositórios públicos, décima primeira passagem, a checagem de configuração do agente, 0.6.0 a 0.7.0 | |
| --- | ---: |
| Repositórios checados | 443 |
| Com `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` ou `.claude/settings.json` rastreado | 64 |
| Regras com globs, em `.cursor/rules/` e `.github/instructions/` | 939 |
| Arquivos `SKILL.md` que o git rastreia sob uma pasta `skills/` | 103786 |
| Desses, sob `.claude/skills/` ou `.agents/skills/` | 13409 |
| Achados | 689 |
| Num único repositório cujas 666 skills não têm frontmatter | 666 |
| Fora dele | 23 |
| Reais | 23 |
| Regras reportadas mortas, fora da pasta retida | 0 |
| Scripts nomeados por um servidor ou um hook e ausentes | 0 |

Cada um dos vinte e três é um `SKILL.md` sob `.claude/skills/` ou `.agents/skills/` sem
frontmatter nenhum, em sete repositórios: dez deles são um acidente só, arquivos achatados numa
única linha sem nenhuma quebra, e dois são um `AGENTS.md` e um `CLAUDE.md` copiados com nome de
skill. O que a passagem diz sobre as outras formas é só que elas são raras no material público.
Nenhuma regra foi reportada morta fora da pasta retida, e nenhum servidor ou hook nomeou script
ausente nos sessenta e quatro repositórios que configuram um, então para essas duas formas os testes
unitários e a simulação são a única evidência, e a precisão delas segue sem medida.

O histórico por trás de um caminho ausente, para a 0.7.2, foi medido no nono, no décimo e no décimo
primeiro corpus com o histórico restaurado, porque os clones eram rasos e um clone raso não tem
rename para contar; quatro repositórios não puderam ser baixados por inteiro. A checagem em si não
mudou: um caminho ausente ou um link markdown que se moveu agora diz para onde o git moveu o
arquivo, ou quando o git o apagou, e a pergunta da medição era se o que o git diz é o que a nota
deveria dizer. Cada linha que o git deu foi lida contra o commit dela:

| Repositórios públicos, o histórico por trás de um caminho ausente, 0.7.2 | |
| --- | ---: |
| Repositórios do nono ao décimo primeiro corpus com o histórico restaurado | 176 |
| Caminhos ausentes e links markdown fora dos catálogos | 335 |
| Com um rename ou uma exclusão no histórico | 15 |
| Renames, todos certos | 6 |
| Exclusões, todas certas | 9 |
| Nunca estiveram no histórico | 320 |
| Dentro de um catálogo reorganizando seus plugins, achados com linha de histórico | 28 |

Os seis renames são uma tabela de arquivos nomeando três arquivos que se moveram quando um projeto
trocou de nome, duas skills cujas pastas perderam um prefixo, e um logo movido para uma pasta de
assets; as nove exclusões são cinco docs removidos numa reestruturação, um script aposentado em
favor de outro com nome diferente, um arquivo de teste substituído pelo formato nativo, e mais dois.
Os 320 que o git nunca teve são os caminhos de outro projeto, marcadores, e arquivos que uma nota
descreve antes de alguém fazer commit deles; sessenta deles foram procurados em todos os branches, e
nenhum esteve lá. Então, no material público, o histórico fala por um caminho ausente em vinte, e
fala bem: dentro do único catálogo que estava reorganizando seus plugins, vinte e quatro das vinte e
oito linhas eram renames para a nova árvore de pastas, e os três seguidos à mão estavam certos. Duas
decisões foram tomadas sobre esse material e são ajustadas a ele: o limite de renames do git é
elevado na consulta, porque um commit que tocou milhares de arquivos no décimo corpus leu duas
skills movidas como exclusões até que fosse, e um link escrito como `mdc:caminho`, que é como uma
regra do Cursor aponta para a raiz do repositório, é resolvido a partir da raiz, o que limpou dezoito
links falsos no décimo primeiro e fez uma skill copiada no oitavo cruzar o portão de outro projeto,
vinte e dois achados retidos. Nos corpora fixos esta release não remove nem acrescenta nada.

Com a 0.8.0, o `--fix` aplica esses renames, a primeira vez que ele escreve algo além da
capitalização, e pode porque o nome novo vem do git em vez de um palpite. No catálogo acima, o que
estava reorganizando seus plugins, uma passada reescreveu dezenove citações em três arquivos, não
pulou nenhuma, e a rodada seguinte não reportou rename nenhum; o diff foi lido linha a linha antes
de o clone ser restaurado. Uma exclusão nunca é reescrita, porque não há o que escrever no lugar.

Uma décima segunda passagem, para a 0.8.1, em sessenta repositórios das mesmas buscas, nenhum em
lista anterior, e o primeiro número honesto da quinta checagem, porque nada dela foi moldado ali.
Um clone falhou, oito não têm arquivo de contexto que o prumo detecte, cinco deles um `SKILL.md`
na raiz, seis são catálogos acima de cinquenta, vinte e oito vieram limpos, e os outros dezesseis
ficam contados à parte. O histórico foi restaurado em todos menos um, então a informação de rename
da 0.7.2 foi medida em material fresco na mesma passagem:

| Repositórios públicos, décima segunda passagem, 0.8.0 a 0.8.1 | |
| --- | ---: |
| Repositórios checados | 58 |
| Achados fora dos catálogos, na 0.8.0 | 97 |
| Reais | 43 |
| Precisão | 44% |
| Removidos por três regras nascidas deste corpus | 9 |
| Desses, reais | 1 |
| Achados na 0.8.1, 42 reais | 88 |
| Precisão | 48% |
| Achados de `AGENT CONFIG`, todos reais | 4 |
| Caminhos ausentes e links pelos quais o git falou, todos certos | 12 |

A quinta checagem leu oito repositórios com JSON de configuração, onze regras e sete mil skills, e
reportou quatro coisas: dois hooks num mesmo `.claude/settings.json` nomeando um script que mora em
outra pasta, e duas skills copiadas para uma pasta de documentação sem o frontmatter. Nenhum falso,
em material que não moldou regra nenhuma dela; o número é pequeno porque as formas são raras, como a
décima primeira passagem já tinha dito. Os achados reais das outras checagens são os conhecidos, uma
pasta de schemas que se moveu, um título cujo slug perdeu o parêntese, links escritos uma pasta
rasos demais a partir de uma pasta de regras, uma pasta de skills que se moveu de `.claude/` para
`.agents/` enquanto as próprias instruções seguiam citando o lugar antigo; o git confirmou doze
deles, três mudanças e nove exclusões, e corrigiu três que a leitura à mão tinha tomado por exemplo,
porque os arquivos existiram e foram apagados. Os falsos são as famílias das passagens anteriores:
arquivos que um passo de configuração cria, exemplos dentro de skills que ensinam a escrever skills,
pastas de execução, e caminhos de um plugin citados pelo lugar em que ele é instalado. Três regras
nasceram deste corpus e são ajustadas a ele: `pnpm version` é o próprio pnpm, uma frase que diz
apagado, removido ou desativado em chinês é negação como as equivalentes em inglês e português, e
uma marca de ênfase colada depois de um caminho, `scripts/sync.mjs._`, fica de fora dele. Elas
removeram nove achados, oito falsos e um real que estava ao lado de uma negação em chinês, a mesma
troca que a regra de parágrafo sempre fez.

Uma décima terceira passagem, para a 0.8.2, em sessenta repositórios das mesmas buscas, nenhum em
lista anterior. Ela mede as três regras nascidas do décimo segundo corpus, e mais duas nascidas ali
para a 0.8.2: um arquivo que cada máquina escreve para si, com `.local` antes da extensão, e uma
skill citada pelo caminho em que um host a instala quando o mesmo arquivo existe ao lado de um
`SKILL.md` no repositório. No décimo segundo as duas removeram vinte achados fora dos catálogos,
todos falsos menos dois, e os dois, uma pasta de skills que se mudou da pasta de um host para a de
outro e uma skill movida para dentro de um plugin, são o tipo brando de envelhecido, em que o
arquivo que a nota quer dizer está lá com outro nome. Uma terceira regra foi tentada e descartada:
um título que diz que a seção mostra exemplos governaria os caminhos abaixo dele, mas a skill de
amostra que a motivou carrega o próprio título `#`, que encerra a seção, e num catálogo a regra
calou citações que se leem como reais. Três clones falharam, doze não têm arquivo de contexto que o
prumo detecte, quatro são catálogos acima de cinquenta, e vinte e oito vieram limpos:

| Repositórios públicos, décima terceira passagem, 0.8.0 a 0.8.2 | |
| --- | ---: |
| Repositórios checados | 57 |
| Achados fora dos catálogos, na 0.8.0 | 83 |
| Reais | 18 |
| Precisão | 22% |
| Removidos pelas cinco regras da 0.8.1 e da 0.8.2, todas ajustadas em outro lugar | 1 |
| Desses, reais | 0 |
| Achados na 0.8.2, os mesmos 18 reais | 82 |
| Achados de `AGENT CONFIG`, todos reais | 1 |

As cinco regras medidas aqui quase não tiveram o que remover: a regra do caminho de instalação
limpou uma citação de uma skill arquivada pelo caminho de instalação, falsa, e as outras quatro não
encontraram linha nenhuma, o que só diz que elas são estreitas. A quinta checagem leu oito
repositórios com JSON de configuração e reportou uma coisa, um `.mcp.json` nomeando um script de
servidor que não está no repositório; com o décimo segundo, são cinco reportes em material que não
moldou regra nenhuma dela, todos reais. Os achados reais são sete skills irmãs que um plugin linka e
nunca acrescentou, um doc citado pelo nome do pacote onde o pacote mora uma pasta mais fundo, uma
biblioteca de banco citada sem a pasta de versão, um doc de workflow e um script de preflight que
sumiram, e dois arquivos de regra linkando docs uma pasta rasos demais. Os falsos ficam em três
repositórios, cinquenta dos sessenta e quatro: um plugin de contribuição publicado em três cópias
para três hosts, cujas skills linkam os arquivos do shell de banco em que ele deve rodar; um
repositório de skills de agente cujas notas linkam as páginas de um wiki guardado em outro lugar; e
skills que documentam um framework do qual o repositório depende. Cada arquivo deles cita caminhos
de menos para o portão por arquivo, e juntos dizem onde está a próxima regra: um repositório cujos
caminhos citados são em maioria ausentes em todos os arquivos documenta outro projeto por inteiro.
Essa regra não foi construída ainda, para que possa ser medida em material de onde não veio. Uma
regra nasceu deste corpus e é ajustada a ele: um link com esquema `file:` é um endereço, como a
regra da prosa já dizia, e ela limpou dois.

Uma décima quarta passagem, para a 0.8.3, em sessenta repositórios das mesmas buscas, nenhum em
lista anterior. Ela mede a regra que a décima terceira pediu: um repositório cujos arquivos de
contexto detectados citam, somados, pelo menos doze caminhos cuja primeira pasta está ausente do
índice, e seis em cada dez de tudo que citam, documenta outro projeto por inteiro e recebe uma
linha só. Os dois números foram fixados nas contagens somadas do nono ao décimo terceiro corpus,
onde nenhum repositório com achado real cruza os dois. No décimo terceiro o portão levou dois dos
três repositórios que o motivaram, trinta e três achados, todos falsos; o terceiro linka um wiki
por nomes de página sem pasta, que o portão não conta, e fica. Medi-lo no décimo segundo o refinou
duas vezes: um link escrito como nome solto ao lado da nota mantém a própria pasta da nota como
cabeça, então uma skill sem um arquivo seu é achado e nunca outro projeto, e um pacote de skill é
reconhecido pelo último segmento da pasta. Neste corpus o portão não removeu nada fora dos
catálogos, e não havia o que remover: nenhum repositório aqui cruza os dois números, e os achados
falsos ficam em famílias que nenhum dos dois portões cobre. Dentro dos catálogos, contados à parte,
ele aparece: limpou noventa e uma citações em três deles aqui, e no décimo segundo corpus levou
um marketplace de skills inteiro, setecentos e noventa e seis achados numa linha, com o jeito de
checar um arquivo dele por inteiro na página de referência. Oito repositórios não têm arquivo de
contexto que o prumo detecte, três deles um `SKILL.md` na raiz, sete são catálogos acima de
cinquenta, e trinta e quatro vieram limpos:

| Repositórios públicos, décima quarta passagem, 0.8.2 a 0.8.3 | |
| --- | ---: |
| Repositórios checados | 60 |
| Achados fora dos catálogos, na 0.8.2 | 79 |
| Reais | 21 |
| Precisão | 27% |
| Removidos pelo portão por repositório, nascido do décimo terceiro corpus | 0 |
| Removidos por três regras nascidas deste corpus | 34 |
| Desses, reais | 0 |
| Achados na 0.8.3, os mesmos 21 reais | 45 |
| Precisão | 47% |
| Achados de `AGENT CONFIG`, seis repositórios com JSON de configuração | 0 |

A regra do `file:` da 0.8.2, ajustada no décimo terceiro corpus, não encontrou linha nenhuma aqui
fora dos catálogos, nem as outras duas regras da 0.8.2, que limparam dezesseis citações dentro
deles, caminhos de instalação e arquivos `.local`. A quinta checagem leu
seis repositórios com JSON de configuração e não reportou nada; com o décimo segundo e o décimo
terceiro, são cinco reportes em material que não moldou regra nenhuma dela, todos reais, e um
corpus sem o que reportar. Os achados reais são os tipos conhecidos: quatro páginas de documentação
que uma nota linka e nunca foram acrescentadas, dois pacotes internos renomeados, uma tabela de
rotas e um arquivo de aliases que se mudaram, páginas irmãs que uma cópia vendorizada de um conjunto
de skills deixou para trás, um arquivo de regras citado uma pasta curto, uma nota de revisão que
sumiu, e seis links escritos uma pasta rasos demais de dentro de uma pasta de skills. Os falsos que
sobram depois desta versão ficam em quatro repositórios: pastas que um pipeline escreve em tempo de
execução; uma skill que documenta outro aplicativo, copiada em cada exercício de um curso, em que
toda cópia cita quatro caminhos e o repositório inteiro cita muitos mais que existem; instruções
dentro de skills que constroem coisas, *"edite `config/app.js` e acrescente"*, que nomeiam um
arquivo do projeto em que a skill vai rodar; e um exemplo. Três regras nasceram deste corpus e são
ajustadas a ele: o que segue um `#` numa linha de comando é comentário, então as palavras de um
comentário depois de um alvo do make não são lidas como mais alvos; o nome do próprio repositório,
lido da origem, é um prefixo que uma nota pode escrever antes de um arquivo da raiz, como um
repositório fez em vinte e nove notas; e uma frase que faz de uma pasta uma condição, *"se o
repositório tem `docs/product/`"*, é condicional como *"se existir"*. Elas removeram trinta e
quatro achados, todos falsos. No décimo segundo e no décimo terceiro corpus, que não moldaram
nenhuma delas, não removeram nada fora dos catálogos, e sete citações dentro, todas em frases que
fazem de um arquivo de estado ou de configuração uma condição, *"se o usuário já tem"*, que se leem
como certas.

Três coisas ficam fora de escopo por decisão. O prumo não julga afirmações, já que *"esta flag faz X"* exige um modelo. Não edita além da capitalização e dos renames que o próprio git registrou, porque uma nota corrigida errado é pior que uma desatualizada, e essas duas são as únicas correções lidas do git em vez de adivinhadas. E não faz chamada de rede nenhuma.

Duas regras decorrem da medição. Nenhuma checagem entra antes de ter a precisão medida num projeto real. Encontrar mais é fácil; acertar é o produto inteiro, e uma checagem que aponta algo correto uma vez por semana faz a ferramenta inteira ser desinstalada. E se um dia entrar uma camada semântica, um modelo julgando se uma afirmação continua valendo, ela fica atrás de um comando separado, que o usuário liga, com a precisão publicada antes do lançamento. Misturá-la à execução padrão desfaria o motivo pelo qual a ferramenta é confiável.

---

## Como um caminho é resolvido

O índice do git é a única fonte que guarda a capitalização real de um caminho. O `existsSync` devolve `true` para a caixa errada no Windows e no macOS, então uma checagem construída sobre ele passa localmente e não enxerga o defeito. É por isso que a checagem de capitalização existe: uma nota dizendo `layouts/AppLayout.vue` quando o repositório tem `resources/js/Layouts/AppLayout.vue` abre normalmente na máquina de quem escreveu e aponta para o nada no Linux e no CI.

O `resolvePath` em [src/check.mjs](../src/check.mjs) tenta, nesta ordem: correspondência exata no índice; correspondência sem distinção de caixa, que vira um achado `CASE MISMATCH`; e só então `existsSync`, como último recurso para arquivos que o git não rastreia. Essa ordem não deve ser alterada.

O índice precisa ser lido como o git escreve. O `git ls-files` roda com o `core.quotepath` ligado por padrão, e isso devolve um nome não-ASCII entre aspas e com escape octal: `"docs/A\303\247\303\243o.md"` no lugar de `docs/Ação.md`. Lido assim, todo caminho acentuado fica de fora do índice: a checagem de capitalização fica em silêncio nele e, no Windows, o `existsSync` aceita a caixa errada sem dizer nada. Um arquivo de contexto dentro de uma pasta acentuada nem chega a ser detectado. Por isso a chamada é `git -c core.quotepath=false ls-files -z`, e o `-z` mantém inteiro um nome que contenha quebra de linha. Toda chamada nova a `git ls-files` passa pelo `trackedFiles`.

Duas consequências. Um caminho citado é comparado pelo final, não pelo começo, porque as notas escrevem caminhos em forma curta e relativa (`pages/Auth/Login.vue`) muito mais do que por inteiro. Uma busca que parte de `resources/js/pages/` perde todos eles; foi assim que quatro caminhos errados sobreviveram a seis auditorias feitas à mão, um deles por dois meses. E o CI roda no Linux, Windows e macOS só por esse motivo: o comportamento sob teste muda conforme o sistema de arquivos, então uma execução verde numa plataforma não prova nada sobre as outras.

Um caminho é reportado em toda linha que o cita, então um `--fix` corrige todas. Até a 0.4.10 um caminho era reportado uma vez por arquivo, e a segunda citação em diante ficava invisível para o relatório e para o `--fix`, que precisava de uma rodada por citação. Uma coisa daquele comportamento foi mantida de propósito. Um caminho que uma frase desculpa, por ter sumido, por ser uma saída ou por pertencer a outro repositório, continua desculpado nas linhas seguintes do mesmo arquivo, porque elas falam do mesmo arquivo. A mesma versão fez o `--fix` reescrever um caminho onde quer que ele esteja. Antes ele só encontrava o alvo entre crases ou depois de `](`, e respondia *"line changed since the scan"* para uma definição de referência, um comando, um caminho do Windows ou um número de linha que não tinham mudado nada.

---

## Sobre o nome

*Prumo* é o fio de prumo, o peso pendurado num barbante que o pedreiro encosta na parede para saber se ela ainda está **no lugar**. Em inglês essa mesma ideia se diz *true*, que também quer dizer "verdadeiro".

Documentação se afasta do código do mesmo jeito que uma parede sai do prumo: devagar, sem ninguém ver, até alguém construir em cima.
