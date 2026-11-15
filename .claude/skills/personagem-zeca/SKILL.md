---
name: personagem-zeca
description: Como o personagem Zeca Neon é animado (marcações do roteiro, voz, Rhubarb, linha do tempo, arte em camadas, render determinístico) e como mexer nele com segurança — nova expressão, gesto, forma de boca, ajuste da arte, troca de motor (Rive) ou de provedor de voz. Use em qualquer trabalho em packages/avatar, packages/providers, apps/render (ZecaClip/RivePoc) ou no job character.clip.
---

# Personagem Zeca Neon

## Fluxo (um clipe)
1. Roteiro com marcações → `parseScript` (`packages/avatar/src/markup.ts`): cada marcação quebra o
   texto em trechos; expressão vale até a próxima; gesto começa no trecho; `[pausa:ms]` 100–3000.
2. Regra 7: `assertCharacterLine` (`packages/policy/src/character.ts`) — o Zeca nunca diz que é
   humano nem nega ser IA. Sempre antes de gastar voz.
3. Voz por trecho: `TtsProvider` (`packages/providers`): `google` (Chirp 3 HD, com `CachedTts`) ou
   `fake` (espeak-ng). Escolha em `apps/agents/src/character/tts.ts` (`ttsForClip`: modo simulado =
   voz de teste, salvo pedido no clipe), com trava da cota grátis e do teto; `recordTts` grava
   caracteres e custo real no `CostLedger`.
4. Trilha: worker-media `/audio/voice-track` junta os trechos com as pausas e devolve início/fim de
   cada um. Bocas: `/lipsync` (Rhubarb `-r phonetic --threads 1`, formas A–H e X).
5. `buildTimeline` + `frameState` (puros): expressão, boca, piscada (semente), gesto e respiração
   por quadro.
6. Render: `POST render:/render` (assíncrono) com a composição `ZecaClip`; o áudio é servido pelo
   próprio render em `/work/...`. Saída em `/data/work/clips/<id>/`.

## Regras que não podem quebrar
- **Determinismo**: o mesmo roteiro dá os mesmos quadros (o aceite compara `framemd5` de 2 renders).
  Nada de `Math.random`, `Date.now` ou estado entre quadros no desenho; use `seededRandom`/`seedFrom`.
  Chrome em `RENDER_GL=swiftshader` (o `swangle` variava 1 unidade em pixels).
- A arte é **provisória** (selo ARTE PROVISÓRIA) até chegar a do ilustrador com contrato de cessão
  (vira manifesto de direitos na Fase 3). Mudou a arte? Suba `ART_VERSION` em
  `apps/agents/src/character/clip.ts` (entra no id do clipe).
- Voz de teste (`real: false`) nunca vai para vídeo publicado.
- Bíblia: `LOCKED_RULES` não saem; cada edição é versão nova (`saveBibleVersion`, auditada).

## Como adicionar
- **Expressão**: `EXPRESSIONS`/`EXPRESSION_LABEL` (spec.ts) → estilo em `STYLE` (art/Zeca.tsx:
  sobrancelha, olhos, sorriso, inclinação) → testes de arte (cada expressão desenha diferente).
- **Gesto**: `GESTURES`/`GESTURE_SECONDS` → ângulo do braço em `ZecaArt` → teste.
- **Motor Rive**: veja `docs/fase-2-rive-poc.md`; o componente oficial `<RemotionRiveCanvas>` não
  serve (só animação linear e WASM do unpkg). Use o padrão de `RivePoc.tsx` (runtime local, avaliação
  por quadro sem estado).
- **Outro provedor de voz**: implemente `TtsProvider` em `packages/providers` (custo por caractere,
  `real: true`, `cacheKey` para o `CachedTts`), adicione o id em `TTS_PROVIDERS`, em
  `settings.character.ttsProvider` e no `createTtsProvider`, e uma trava como a do Google em
  `ttsForClip`. Consulte a documentação atual do provedor antes (campos e preços mudam; o documento
  de descoberta `$discovery/rest` do Google é a fonte oficial alcançável). Chave só no `.env`.
- **Trocar a voz do Google**: Configurações → Voz do Zeca. Mudou voz ou velocidade, muda a chave do
  cache (gera de novo, uma vez).

## Testar
- `pnpm --filter @studio/avatar test` (marcações, linha do tempo, arte determinística).
- Integração do job: `apps/agents/test/character.integration.test.ts` (serviços falsos).
- Na pilha: `make zeca` / `make accept-2` (2 renders com hash idêntico, Short 9:16).
