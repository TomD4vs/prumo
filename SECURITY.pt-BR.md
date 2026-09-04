# Segurança

[← README](LEIAME.md) · [Read in English](SECURITY.md)

## Como relatar uma vulnerabilidade

Use o canal privado do GitHub: **[Report a vulnerability](https://github.com/TomD4vs/prumo/security/advisories/new)**.
O relato fica privado até a correção sair. Evite abrir uma issue pública para algo explorável.

Este é um projeto pequeno, com um mantenedor só, então a primeira resposta vem em dias, não em
horas. Só a última versão publicada recebe correção; não há branches antigas em manutenção.

Se o prumo apontou uma linha que está correta, isso é um alarme falso e não uma vulnerabilidade;
o [CONTRIBUTING.pt-BR.md](CONTRIBUTING.pt-BR.md) diz para onde levar.

---

## Até onde o prumo alcança

A maior parte da resposta é que há muito pouco ao alcance.

- **Nenhum acesso à rede, em momento nenhum.** Sem telemetria, sem conta, sem modelo, sem checagem
  de atualização. O pacote não tem nenhuma dependência, então nada que ele instala consegue fazer
  uma chamada também.
- **Ele roda o `git`, com comandos fixos.** `git ls-files`, `git check-ignore` e `git rev-parse`,
  os três escritos como constantes. O caminho do repositório que você passa vira o diretório de
  trabalho do processo filho e nunca é montado dentro de uma string de comando, e os caminhos
  entregues ao `git check-ignore` entram pela entrada padrão. Uma pasta cujo nome tem caracteres de
  shell é só um nome de pasta.
- **Ele lê, e quase não escreve.** Lê os seus arquivos de contexto e o índice do git. A única
  escrita é o `--fix`, ou o `prumo_fix` pelo MCP, e ela só reescreve a capitalização nas linhas
  que ele já reportou, para a grafia que o índice guarda.

## O servidor MCP

O `prumo-mcp` fala JSON-RPC pela entrada e pela saída padrão e não escuta em porta nenhuma. Ele
recebe um caminho de repositório e uma lista de alvos do agente que o iniciou, então consegue ler
qualquer repositório que esse agente já consiga ler, e o `prumo_fix` consegue reescrever a capitalização em
arquivos que esse agente já consiga escrever. Inicie o servidor só a partir de um agente em que
você confia com aquela pasta.
