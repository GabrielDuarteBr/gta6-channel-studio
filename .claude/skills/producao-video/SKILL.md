---
name: producao-video
description: Como uma história da Pauta vira vídeo de notícia (Roteirista, Diretor de arte, voz, Editor/Remotion, thumbnails, Revisor visual) e como mexer com segurança — prompt do roteiro, provedor de imagem, layout do vídeo, critérios do Revisor, Biblioteca e manifesto. Use em qualquer trabalho em apps/agents/src/production, packages/production, packages/storage, apps/render/src/remotion/news ou nas telas Produção, Biblioteca e Arte.
---

# Produção de vídeos de notícia (Fase 3)

## Caminho
1. Pauta → "Virar longo/Short" (status da história) → tela **Produção** → **Produzir** (só aí gasta;
   `startProduction` confere `assertCanPromoteStory` e `assertDailyLimit`).
2. Job `production.run` (fila `render`) → `runProduction` em `apps/agents/src/production/pipeline.ts`.
   Cada etapa grava na `Production` e é pulada na retomada:
   - `script` — Roteirista (`writer.ts`). System = bíblia + regras (estável, em cache); user =
     história, fontes com ids, Biblioteca. Depois do Claude: `finalizeScript` (formato/marcações) +
     `checkScript` (fonte por afirmação, rumor com 2 domínios e dito em voz alta, IA, Rockstar,
     spoiler) + duração. Uma correção com a lista de problemas; depois `ScriptRejectedError`.
   - `plan.art` — Diretor de arte (`art.ts`). Biblioteca só com manifesto ativo; "gerar" passa por
     `assertImagePromptAllowed` + guia de estilo; reuso pelo prompt; vira mídia `IMAGE_PROVIDER`.
     Imagem recusada pelo filtro ou mídia sem direitos → cena só com o Zeca + nota (não derruba).
   - `plan.voice` — voz por trecho (`combineScriptLines`) + trilha + Rhubarb (uma vez por roteiro).
   - render — `buildVideoPlan` → 3ª camada (`assertAssetRenderable` no banco,
     `assertOriginalCommentary`) → `NewsVideo` (mp4) + 3 `Thumbnail` (png, `still: true`).
   - `review` — `reviewVideo` (quadros em `reviewTimes`, prévias das thumbnails). O CÓDIGO decide a
     aprovação (`verdictFrom`: nada grave/médio no vídeo e uma thumbnail aproveitável). Correções
     fechadas: trocar imagem da cena (novo prompt "alternative composition N") e variar thumbnails.
3. `READY` (pronto para o dono; publicação é Fase 5) ou `NEEDS_ATTENTION` depois das voltas.

## Regras que não podem cair
- Nenhuma mídia sem manifesto ativo no render (regra 1/2) — a conferência no banco fica no pipeline.
- Nada do YouTube na Biblioteca (`assertMediaImportAllowed`, `fetchOfficialImage` só sites oficiais).
- Prompt de imagem sem nomes/lugares/marcas do jogo (`assertImagePromptAllowed`).
- Toda fala de fato/rumor/contexto com `sourceIds` da própria história; rumor rotulado na tela
  (selo RUMOR) e na fala.
- Aviso de IA sempre visível no vídeo (`AI_NOTICE`).
- Render repetível: nada de `Date.now()`/aleatório sem semente nas composições; fontes locais
  (`useFontsReady`); `RENDER_GL=swiftshader`.

## Mexendo
- **Prompt do roteiro**: `writerSystemPrompt` (estável) e `userPrompt`. Não coloque nada variável
  (data, ids) no system, senão o cache não pega.
- **Provedor de imagem**: `packages/providers/src/image.ts` (`ImageProvider`). Novo provedor = nova
  classe + `createImageProvider` + preço em `imagePriceUsd` + opção em `settings.images.provider`.
  Confira a documentação atual antes (o documento de descoberta `$discovery/rest` do Google é a
  fonte oficial alcançável do sandbox).
- **Layout do vídeo/thumbnail**: `apps/render/src/remotion/news/*`. Teste com o servidor de render
  local (`MEDIA_WORK_ROOT` numa pasta temporária) e olhe os quadros; rode o aceite (2 renders
  idênticos).
- **Critérios do Revisor**: `REVIEWER_SYSTEM` + `ISSUE_KINDS`; a decisão fica em `verdictFrom`.
- **Modelos**: `settings.production.writerModel/reviewerModel`; preços em `packages/llm/src/pricing.ts`.
- Testes: `apps/agents/test/production.integration.test.ts` (pipeline com serviços falsos),
  `writer.test.ts`, `review.test.ts`, `packages/production/test`, `e2e/tests/producao.spec.ts`.
