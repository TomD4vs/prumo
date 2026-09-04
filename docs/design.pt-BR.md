# Design

[← README](../LEIAME.md) · [Read in English](design.md)

Por que o prumo checa tão pouco, o que custou descobrir isso, como um caminho é resolvido, e de onde vem o nome.

---

## Por que tão poucas checagens

A funcionalidade óbvia é conferir todo símbolo das notas contra o código. Um protótipo inicial fazia exatamente isso. Rodado em duas bases de produção, levantou cerca de **512 alertas, dos quais dez eram reais**. Isso dá mais ou menos 2% de precisão, conferida com o que sete revisões do mesmo material tinham encontrado, seis delas feitas à mão. Essa checagem foi removida. Um detector que erra 98% das vezes ninguém roda duas vezes, porque ler os alarmes falsos custa mais do que a documentação desatualizada que eles deveriam pegar.

O que foi lançado faz o contrário: só as checagens que quase sempre acertam, com a maior parte do código gasta em mantê-las caladas:

| Filtro | Por que existe |
| --- | --- |
| Negação, lida no parágrafo | *"o projeto não publica `config/x.php`"* nomeia um arquivo que **não pode** existir. O grep vê caminho morto; quem lê vê frase certa. |
| Bloco cercado lido como código, comentário não lido | Um caminho dentro de um bloco ```` ``` ```` é um comando ou uma árvore de arquivos e é checado como tal, com a frase acima do bloco como contexto. Um link ali está sendo citado, como qualquer coisa dentro de `<!-- -->`, e nenhum dos dois é checado. Uma linha de comentário dentro do bloco é o que um comando imprime, e `./nome` sem pasta é um argumento que o leitor fornece. |
| Nota histórica é isenta | Uma entrada chamada *fase 3 concluída* cita o que foi removido depois. Esse é o assunto dela, não um defeito. |
| Artefato transitório ignorado | `public/build`, `.vite`, `node_modules`, `dist` nascem e morrem fora do git. |
| Alias, caminho curto e extensão emitida resolvidos | `@/utils/foo.js` e `tests/Concerns/LeTextoDePdf` são referências reais escritas em forma curta. O `@/` é testado contra a raiz do repositório além de `src`, `app` e os demais, e um projeto TypeScript que escreve `./logger.js` para o `logger.ts` que o git guarda é casado com a fonte. |
| Marcador de posição e identificador | `path/to/test.js` num exemplo de comando, `chapters/ch01-<slug>.md` e `.agents/commands/[name].md` num template, `reports/review-YYYY-MM-DD.md` para um arquivo ainda a escrever, e `server/discover` ao lado de `tools/list` não são arquivos. Nem `constants.hpp/.cpp`, que são dois arquivos num token só. Um nome sem extensão só é caminho quando a pasta com que ele começa existe ali. |
| Prefixo com o nome do projeto resolvido | `meuapp/app/api/route.ts` quando o repositório guarda `app/api/route.ts` e não tem pasta `meuapp/`. Só vale casamento exato e aninhado, então um primeiro segmento com a caixa errada continua sendo case mismatch. |
| Caminho que pertence a outro repositório | Uma nota que nomeia `github.com/outro/projeto` algumas linhas acima do caminho, e um alias `@/` num repositório que não tem nenhuma das pastas contra as quais um alias resolve. Os dois descrevem código que mora em outro lugar. |
| Import de pacote não é caminho | `@escopo/pacote/style.css` é algo que o npm resolve, não um arquivo daqui. Um alias `@/` mantém a barra logo depois do `@`, então continua sendo checado. |
| Algo que só o autor sabe estar certo | `.prumorc.json` e os marcadores `prumo-ignore`. Toda supressão é contada no cabeçalho, então um repositório silenciado nunca se parece com um limpo. |

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
código que um gerador vai escrever, a maior parte não está.** Distinguir os dois é a próxima coisa a
construir, e será medida em repositórios que nada disso usou.

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

Lendo uma coluna, a ferramenta melhorou. Lendo uma linha, o material é outro. As duas coisas são
verdade, e só as colunas respondem se uma release ajudou.

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

Três coisas ficam fora de escopo por decisão. O prumo não julga afirmações, já que *"esta flag faz X"* exige um modelo. Não edita além da capitalização, porque uma nota corrigida errado é pior que uma desatualizada. E não faz chamada de rede nenhuma.

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
