---
name: adicionar-fonte-noticias
description: Adiciona, corrige ou avalia uma fonte de notícias de GTA 6 na pesquisa do Radar Neon (feed RSS/Atom, página oficial sem feed ou canal do YouTube por metadados). Use quando o dono pedir uma fonte nova, quando uma fonte aparecer com erro em Pauta → Fontes ou quando for mudar as fontes padrão.
---

# Adicionar ou corrigir uma fonte de notícias

## Regras antes de tudo
- **YouTube só pela Data API, só metadados.** Nunca cadastre `youtube.com`/`youtu.be` como feed ou
  página: o painel recusa e a regra 1 do CLAUDE.md proíbe. Canal do YouTube entra como
  `YOUTUBE_CHANNEL` com o `@handle`.
- **Nível certo**: `OFFICIAL` só para Rockstar/Take-Two (Newswire, IR, canais oficiais). Imprensa
  estabelecida = `PRESS`. Sites de fãs, insiders, agregadores = `COMMUNITY`. O nível muda o peso na
  pontuação e a regra de rumor (rumor precisa de 2 fontes independentes ou 1 oficial).
- **Sem Reddit** (API fechada para apps novos; RSS desligado em 13/11/2026).
- Não adicione fontes que publicam vazamentos, cópias pré-lançamento, trapaças ou mods não
  autorizados como linha editorial.

## Caminho do dono (painel)
Pauta → **Gerenciar fontes** → "Adicionar fonte". Para um site com feed, basta o endereço do site:
o coletor descobre o feed pelo `<link rel="alternate">`. Página sem feed precisa do **padrão do link**
dos artigos (ex.: `/newswire/article/`). Marque "Site focado em GTA/Rockstar" só se o site for
dedicado ao assunto (aceita manchetes que citam só Rockstar/Leonida).

## Caminho do código (mudar as fontes padrão)
1. Edite `packages/research/src/default-sources.ts` (`key` estável, `kind`, `tier`, `url`,
   `language`, `config.gtaOnly`/`config.linkPattern`).
2. A semeadura (`seedDefaultSources`) só cria chaves que faltam: **não sobrescreve** o que o dono
   mudou. Para trocar a URL de uma fonte padrão existente, oriente o dono a editar em Fontes.
3. Teste com uma amostra offline: salve um exemplo do feed/página em `packages/research/test/fixtures/`
   e cubra em `feeds.test.ts` (parse) e, se mudar agrupamento/pontuação, em `logic.test.ts`.
4. `pnpm --filter @studio/research test` e, com banco, os testes de integração do agents.

## Diagnóstico de uma fonte com erro
- `make coletar` mostra estado, itens de GTA 6 e o erro por fonte.
- `HTTP 403/429`: o site bloqueia robôs; não insista com outro User-Agent nem contorne bloqueio.
  Procure o feed oficial do site ou desative a fonte.
- `nenhum feed encontrado`: o site não anuncia feed; ache o endereço do feed (muitos WordPress usam
  `/feed/`) ou cadastre como página com padrão de link.
- `0 de GTA 6` com status ok: o feed é genérico; normal se o site publicar pouco sobre o jogo.
- Página oficial renderizada só por JavaScript (sem links no HTML) não funciona como `PAGE`: use o
  canal oficial do YouTube (metadados) ou outra fonte oficial com feed.
