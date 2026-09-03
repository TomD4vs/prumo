# API e desenvolvimento

[← README](../README.pt-BR.md) · [Read in English](api.md)

---

## Uso programático

```js
import { analyze, resolveTargets } from '@tomd4vs/prumo';

const targets = resolveTargets('.', []);          // [] = detectar sozinho
const result  = analyze({ repo: '.', targets });

console.log(result.caseMismatch);   // [{ file, line, cited, actual }]
console.log(result.brokenLinks);    // [{ file, line, cited, suggestion }]
console.log(result.missingPaths);   // [{ file, line, cited, excerpt }]
console.log(result.orphans);        // ['nota-que-ninguem-linka.md']
console.log(result.stats);          // { tracked, targets, historical }
```

---

## Desenvolvimento

```bash
git clone https://github.com/TomD4vs/prumo.git
cd prumo
node --test          # 23 testes, sem dependências
node bin/prumo.mjs . # rodar nele mesmo
```

Dentro deste repositório, rode `node bin/prumo.mjs` em vez de `npx @tomd4vs/prumo`: o npx encontra o `package.json` local e procura um binário que não está instalado aqui.

Cada teste monta um repositório git descartável, então a suíte não versiona fixture nenhuma e não deixa resíduo. O CI roda no Linux, Windows e macOS contra Node 18, 20 e 22, já que a checagem de capitalização se comporta diferente em cada plataforma.

### O que custou tempo uma vez

`node --test test/` falha no Git Bash do Windows: o argumento de caminho é mutilado e o Node tenta carregar um módulo chamado literalmente `test`. Rode `node --test` sem argumento e deixe-o descobrir `**/*.test.mjs`, que é o que o `npm test` faz.

Teste a CLI a partir de um diretório diferente do repositório sendo checado. Um off-by-one de argumento chegou a ser lançado e passou no primeiro teste por acidente: filtrar os valores de flag com `i !== jsonAt + 1` descartava o `argv[0]` sempre que `--json` estava ausente, porque `jsonAt` era `-1`, e o teste só passou porque o argumento do repositório caiu no padrão `.` enquanto o shell por acaso estava no lugar certo. Rodar de dentro do alvo esconde exatamente essa classe de defeito.

O card social é renderizado, não desenhado. O `assets/social.html` é fotografado em modo headless a 1280×640:

```bash
msedge --headless=new --disable-gpu --no-first-run --user-data-dir=<tmp> \
  --window-size=1280,640 --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=6000 --screenshot=assets/social.png \
  "file:///<abs>/assets/social.html"
```

O `--virtual-time-budget` é obrigatório; sem ele a captura acontece antes de as fontes carregarem e o card sai com uma fonte de fallback.
