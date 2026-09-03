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
| Nota histórica é isenta | Uma entrada chamada *fase 3 concluída* cita o que foi removido depois. Esse é o assunto dela, não um defeito. |
| Artefato transitório ignorado | `public/build`, `.vite`, `node_modules`, `dist` nascem e morrem fora do git. |
| Alias e caminho curto resolvidos | `@/utils/foo.js` e `tests/Concerns/LeTextoDePdf` são referências reais escritas em forma curta. |
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

Três coisas ficam fora de escopo por decisão. O prumo não julga afirmações, já que *"esta flag faz X"* exige um modelo. Não edita além da capitalização, porque uma nota corrigida errado é pior que uma desatualizada. E não faz chamada de rede nenhuma.

Duas regras decorrem da medição. Nenhuma checagem entra antes de ter a precisão medida num projeto real. Encontrar mais é fácil; acertar é o produto inteiro, e uma checagem que aponta algo correto uma vez por semana faz a ferramenta inteira ser desinstalada. E se um dia entrar uma camada semântica, um modelo julgando se uma afirmação continua valendo, ela fica atrás de um comando separado, que o usuário liga, com a precisão publicada antes do lançamento. Misturá-la à execução padrão desfaria o motivo pelo qual a ferramenta é confiável.

---

## Como um caminho é resolvido

O índice do git é a única fonte que guarda a capitalização real de um caminho. O `existsSync` devolve `true` para a caixa errada no Windows e no macOS, então uma checagem construída sobre ele passa localmente e não enxerga o defeito. É por isso que a checagem de capitalização existe: uma nota dizendo `layouts/AppLayout.vue` quando o repositório tem `resources/js/Layouts/AppLayout.vue` abre normalmente na máquina de quem escreveu e aponta para o nada no Linux e no CI.

O `resolvePath` em [src/check.mjs](../src/check.mjs) tenta, nesta ordem: correspondência exata no índice; correspondência sem distinção de caixa, que vira um achado `CASE MISMATCH`; e só então `existsSync`, como último recurso para arquivos que o git não rastreia. Essa ordem não deve ser alterada.

O índice precisa ser lido como o git escreve. O `git ls-files` roda com o `core.quotepath` ligado por padrão, e isso devolve um nome não-ASCII entre aspas e com escape octal: `"docs/A\303\247\303\243o.md"` no lugar de `docs/Ação.md`. Lido assim, todo caminho acentuado fica de fora do índice: a checagem de capitalização emudece nele e, no Windows, o `existsSync` aceita a caixa errada sem dizer nada. Um arquivo de contexto dentro de uma pasta acentuada nem chega a ser detectado. Por isso a chamada é `git -c core.quotepath=false ls-files -z`, e o `-z` mantém inteiro um nome que contenha quebra de linha. Toda chamada nova a `git ls-files` passa pelo `trackedFiles`.

Duas consequências. Um caminho citado é comparado pelo final, não pelo começo, porque as notas escrevem caminhos em forma curta e relativa (`pages/Auth/Login.vue`) muito mais do que por inteiro. Uma busca que parte de `resources/js/pages/` perde todos eles; foi assim que quatro caminhos errados sobreviveram a seis auditorias feitas à mão, um deles por dois meses. E o CI roda no Linux, Windows e macOS só por esse motivo: o comportamento sob teste muda conforme o sistema de arquivos, então uma execução verde numa plataforma não prova nada sobre as outras.

---

## Sobre o nome

*Prumo* é o fio de prumo, o peso pendurado num barbante que o pedreiro encosta na parede para saber se ela ainda está **no lugar**. Em inglês essa mesma ideia se diz *true*, que também quer dizer "verdadeiro".

Documentação se afasta do código do mesmo jeito que uma parede sai do prumo: devagar, sem ninguém ver, até alguém construir em cima.
