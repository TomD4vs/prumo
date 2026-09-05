# API e desenvolvimento

[← README](../LEIAME.md) · [Read in English](api.md)

---

## Uso programático

```js
import { analyze, resolveTargets, loadBaseline, changedFiles } from '@tomd4vs/prumo';

const targets = resolveTargets('.', []);          // [] = detectar sozinho
const result  = analyze({ repo: '.', targets });
// com o baseline da raiz, e só os arquivos em stage para o commit:
// analyze({ repo: '.', targets, baseline: loadBaseline('.'), only: { paths: changedFiles('.', { staged: true }), label: 'staged' } })

console.log(result.schemaVersion);  // 6, sobe quando este formato muda
console.log(result.prumoVersion);   // a versão que rodou
console.log(result.repo);           // caminho absoluto do repositório checado
console.log(result.checkedAt);      // quando, como data ISO 8601
console.log(result.caseMismatch);   // [{ file, line, cited, actual, kind? }]
console.log(result.brokenLinks);    // [{ file, line, kind, cited, suggestion, history? }]
console.log(result.missingPaths);   // [{ file, line, cited, excerpt, history? }]
console.log(result.unknownCommands); // [{ file, line, cited, name, source, suggestion, excerpt }]
console.log(result.configIssues);   // [{ file, line, kind, cited, message }]
console.log(result.orphans);        // ['nota-que-ninguem-linka.md']
console.log(result.elsewhere);      // [{ file, cited, absent, unit? }]
console.log(result.stats);          // { tracked, targets, historical, suppressed, gitignored, untracked, configs, baselined, baselineStale, only? }
```

Os quatro primeiros campos identificam a rodada. Quem consome o JSON distingue uma mudança de formato de uma quebra, e o relatório de um repositório do relatório de outro. `--format json`, `--json ARQ` e o conteúdo estruturado do servidor MCP também os carregam. Um caminho citado em várias linhas é um achado por linha. O `schemaVersion` passou de 1 para 2 quando `unknownCommands` chegou, para 3 com `elsewhere`: os arquivos detectados sozinhos cujos achados ficaram retidos porque a maior parte dos caminhos que citam começa em pastas que o repositório não tem, com as duas contagens, e para 4 com `configIssues`, cujo `kind` é `glob`, `skill-description` ou `config-path`, `stats.configs`, os arquivos JSON de configuração lidos, e `unit` numa entrada de `elsewhere`, presente como `rules` quando o que ficou retido é uma pasta de regras em que a maioria das regras não casa com nada; e para 5 com `stats.baselined`, os achados que um baseline reteve, `stats.baselineStale`, as entradas dele que não casam mais com nada, e `stats.only`, presente como `staged` ou `since REF` quando a rodada foi limitada ao que mudou; e para 6 com `history` num caminho ausente ou num link markdown, `{ event, to?, commit, date, when }`, em que `event` é `renamed`, com `to` o nome que existe agora, ou `deleted`, `commit` é o hash curto, `date` ISO 8601 e `when` a idade em palavras.

`loadBaseline(repo)` lê o `.prumo-baseline.json` da raiz do repositório, ou devolve null; `baselineOf(result)` monta o objeto que o `--baseline` grava; `changedFiles(repo, { staged: true })` ou `changedFiles(repo, { since: REF })` é o conjunto de caminhos que o `only` recebe, ao lado de um `label` para o cabeçalho; e `BASELINE_FILE` é o nome do arquivo.

`kind` é `wikilink`, `link` ou `anchor`, este último um link para um título que a página de destino não tem. Num case mismatch ele só aparece quando o caminho veio de um link markdown, e aí `actual` é relativo ao arquivo que contém o link, como o próprio link. Num comando desconhecido, `cited` é o comando como a nota o escreve, `name` o script ou alvo que ele nomeia, `source` o tipo de arquivo que deveria defini-lo, e `suggestion` o mesmo comando com o nome definido mais próximo.

---

## Desenvolvimento

```bash
git clone https://github.com/TomD4vs/prumo.git
cd prumo
node --test          # todos os arquivos em test/, sem dependências
node bin/prumo.mjs . # rodar nele mesmo
npm run simulate     # um usuário novo segue o README contra o tarball empacotado
```

A simulação empacota o checkout como o `npm publish` faria, instala o tarball num projeto descartável e segue o README e estas páginas ao pé da letra, num repositório git temporário por cenário, comparando cada saída com o que a documentação mostra. Ela achou bugs que os testes unitários não pegavam, porque os testes exercitam o `analyze()` e a simulação exercita o que a doc promete pelo CLI. Rode antes de publicar, e de novo depois com `--registry` para testar a versão publicada. Ela também aciona o servidor MCP por stdio.

Dentro deste repositório, rode `node bin/prumo.mjs` em vez de `npx @tomd4vs/prumo`: o npx encontra o `package.json` local e procura um binário que não está instalado aqui.

Cada teste monta um repositório git descartável, então a suíte não versiona fixture nenhuma e não deixa nada para trás. O CI roda no Linux, Windows e macOS contra Node 18, 20 e 22, já que a checagem de capitalização se comporta diferente em cada plataforma.

### O que custou tempo uma vez

`node --test test/` falha no Git Bash do Windows: o argumento de caminho chega corrompido e o Node tenta carregar um módulo chamado literalmente `test`. Rode `node --test` sem argumento e deixe-o descobrir `**/*.test.mjs`, que é o que o `npm test` faz.

Teste a CLI a partir de um diretório diferente do repositório sendo checado. Um erro de índice na leitura dos argumentos chegou a ser lançado e passou no primeiro teste por acidente. Filtrar os valores de flag com `i !== jsonAt + 1` descartava o `argv[0]` sempre que `--json` estava ausente, porque `jsonAt` era `-1`; o teste só passou porque o argumento do repositório caiu no padrão `.` enquanto o shell por acaso estava no lugar certo. Rodar de dentro do alvo esconde exatamente esse tipo de defeito.

O card social é renderizado, não desenhado. O `assets/social.html` é capturado em modo headless a 1280×640:

```bash
msedge --headless=new --disable-gpu --no-first-run --user-data-dir=<tmp> \
  --window-size=1280,640 --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=6000 --screenshot=assets/social.png \
  "file:///<abs>/assets/social.html"
```

O `--virtual-time-budget` é obrigatório; sem ele a captura acontece antes de as fontes carregarem e o card sai com uma fonte de fallback.