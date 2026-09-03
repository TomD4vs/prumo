# Como contribuir

[← README](LEIAME.md) · [Read in English](CONTRIBUTING.md)

Antes de qualquer coisa, leia [docs/design.pt-BR.md](docs/design.pt-BR.md). Lá está por que o prumo
checa tão pouco e o que custou descobrir isso. Um pull request que adiciona uma checagem sem ter
lido essa página quase certamente será recusado.

---

## O critério para uma checagem nova

O prumo levanta três tipos de achado, e esse número saiu de uma medição, não do tempo disponível.
Um protótipo antigo checava cada símbolo das anotações contra o código. Em dois repositórios de
produção ele levantou cerca de 512 alertas, dos quais dez eram reais. Foi removido.

Então uma checagem nova precisa ter a precisão medida em repositórios reais antes de ser proposta,
não depois. Clone alguns projetos que ninguém checou ainda, rode a sua branch neles e classifique
cada achado na mão, real ou falso. Traga esses números junto com o pull request. Se a checagem
ainda não puder ser medida assim, diga isso e abra uma issue no lugar.

**Um alarme falso é o pior defeito que esta ferramenta pode ter.** Quem lê dois achados errados
para de ler o terceiro. Um achado que passou batido custa pouco perto disso, e é por isso que os
filtros ocupam a maior parte do `src/check.mjs`.

## Como rodar

```bash
npm test                      # a análise, contra repositórios git descartáveis
npm run simulate              # empacota o tarball, instala e segue a documentação pela CLI
npm run simulate -- --registry   # o mesmo, contra a versão publicada
```

`npm test` exercita o `analyze()`. `npm run simulate` exercita o que a documentação promete: roda
`npm pack`, instala esse tarball num projeto novo e então segue o README, a página de problemas e a
configuração do MCP ao pé da letra, comparando a saída com o que as páginas mostram. Os dois rodam
em Linux, Windows e macOS no CI.

## O que uma mudança precisa trazer

- **Um teste que falha sem ela.** Extraia o commit anterior numa cópia da árvore e rode o teste novo
  lá. Se ele passar, não é o seu teste que está cobrindo a mudança.
- **A documentação, nos dois idiomas.** Toda página em `docs/` tem uma gêmea `.pt-BR.md` com a mesma
  estrutura. O português é escrito, não traduzido.
- **Nenhuma dependência.** O prumo não traz nenhuma e não acessa a rede. Uma mudança que precise de
  um pacote precisa antes de um bom argumento.
- **Nenhum comentário dentro do corpo de uma função.** O resto do estilo da casa está no `AGENTS.md`.

## Relatar um achado que está errado

Se o prumo apontou uma linha que está correta, isso é um defeito e vale uma issue. Inclua a linha do
seu arquivo de contexto, o caminho que ele nomeou e como o arquivo se chama de verdade. A página de
[problemas comuns](docs/troubleshooting.pt-BR.md) lista as famílias já conhecidas, e o `.prumorc.json`
silencia o caso enquanto isso.
