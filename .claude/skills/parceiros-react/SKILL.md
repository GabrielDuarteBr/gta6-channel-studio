---
name: parceiros-react
description: Como parceiros, permissões e o Short de react funcionam (Caçador, permissão com prova e condições, importação por Dropbox/Drive/envio, análise com faster-whisper, Cortador, Comentarista, ReactShort, Revisor) e como mexer com segurança. Use em qualquer trabalho em apps/agents/src/partners, apps/agents/src/react, packages/policy/src/partner.ts, packages/production/src/react.ts, apps/render/src/remotion/react, apps/worker-media (vídeo/whisper) ou na tela Parceiros.
---

# Parceiros e Short de react (Fase 4)

## Caminho
1. **Caçador** (`partners/hunter.ts`, job `partners.hunt` na fila `research`; semanal pelo Job
   Scheduler `partners-hunt` — o job confere `settings.partners.huntWeekly` — e pelo botão/`make
   parceiros`). YouTube SÓ metadados: `searchChannels` (balde `search.list`) + `channels` (1 unidade).
   `findPermissionHints` anota frases vagas como INDÍCIO. Haiku dá `fit`, `reason` e a abertura; o
   resto da mensagem (`draftPartnerMessage`) é texto fixo do código, com o aviso de IA e "não
   baixamos nada do YouTube". O sistema NUNCA envia: o dono copia.
2. **Permissão** (tela Parceiros → `registerPermission`): `assertPermissionInput` exige confirmação
   explícita do dono, prova com conteúdo (frase vaga sozinha é recusada, salvo print anexado), data
   coerente e `assertConditions` (crédito, link https público, hashtag, monetização, teto de clipe).
   Revogar → manifestos dos arquivos viram REVOKED e a tela lista os vídeos afetados
   (`affectedProductions`). Suspender trava sem apagar.
3. **Importação** (`partners/import.ts`, job `partner.import` na fila `media`): permissão ativa de
   novo (3ª camada) → `parseShareLink` (Dropbox `dl=1`, Drive por id; YouTube e outros sites
   recusados) → `downloadShareLink` (cada redirecionamento passa por `isAllowedDownloadHost`; teto
   de bytes; Drive com `x-goog-api-key`, nunca na URL) ou envio do painel (S3 `incoming/`) → tipo
   pelos bytes (`sniffMedia`) → `.zip` de pasta do Dropbox vira vídeos (`extract_videos`, sem zip
   slip) → `addVideoAsset` (manifesto com `permissionId`, crédito) → cópia em
   `/data/work/partners/<sha>.<ext>` → `media.analyze`.
4. **Análise** (`runAnalyze` → worker-media `/video/analyze`, `app/transcribe.py`): faster-whisper
   small int8 (modelo dentro da imagem, `HF_HUB_OFFLINE=1`), fala pelo Silero VAD, música = segmentos
   com ♪/[música], cenas pelo `scdet` do FFmpeg, volume por segundo.
5. **React** (`react/pipeline.ts`, mesmo job `production.run`, despachado por `Production.kind`):
   `clipCandidates` (sem música, sem cortar frase) → Comentarista (`react/commentator.ts`: um quadro
   por candidato + transcrição; avalia cutscene, entretenimento do jogo, mídia de terceiros,
   vazamento/trapaça, spoiler) → `finalizeReactScript` + `checkReactScript` (uma correção) → voz por
   trecho → `fitClipDurations` (clipe ≤ `settings.react.maxClipRatio` − 2% de folga e ≤ teto do
   parceiro) → `/video/cut` (`voice` por padrão; `full` só com `Asset.audioCleared`) → trilha com
   pausa = clipe (`combineReactLines`) → Rhubarb → `buildReactPlan` → 3ª camada: permissão +
   `assertAssetRenderable` + `assertReactTimeline` + `checkDescriptionConditions` → `ReactShort`
   (vertical) → `reviewReact` (o código aprova; correção = trocar layout) → READY.

## Regras que não podem cair
- Nada do YouTube: nem link, nem redirecionamento (`parseShareLink`, `isAllowedDownloadHost`).
- Material de parceiro só com permissão ATIVA, vigente e do tipo `REACT_CLIPS` — conferida na tela,
  no job de importação e de novo antes do render (no banco).
- Clipe ≤ 50% (a configuração só aperta); comentário com conteúdo ≥ 50%; o clipe PAUSA enquanto o
  Zeca fala (blocos sem sobreposição, nunca dois clipes seguidos); crédito em todo bloco de clipe.
- Música/filme/TV de terceiros: corte só com a voz (o resto mudo) e trechos com ♪ fora do corte.
- O rascunho de mensagem nunca é enviado; não crie ferramenta que envie.
- Condições do parceiro na descrição (crédito, link, hashtag) e a monetização no `outputs`.

## Render repetível (ReactShort)
Dois renders do mesmo plano têm de dar os mesmos quadros (`react.ts --repetir`). O que já quebrou
isso e não pode voltar:
- redimensionar o Zeca durante o vídeo ou ter um segundo Zeca pequeno (o Chrome redesenha a
  estampa da camisa de forma assíncrona) — o Zeca tem tamanho e lugar fixos;
- caixa do Zeca passando da borda do quadro — fica inteira dentro;
- área do clipe sem camada própria (`willChange/translateZ`) — cada quadro novo do clipe fazia o
  Chrome redesenhar a vizinhança no meio do render;
- texto dentro do SVG do Zeca colado na borda inferior (selo "arte provisória") — o selo vai em
  HTML, abaixo do aviso de IA.
Para investigar: renderize a mesma faixa 2× (`remotion render ... --frames=A-B`) e compare com
`framemd5`; a sequência PNG (`--sequence`) pode sair igual mesmo quando o MP4 não sai.

## Testar
- `packages/policy/test/partner.test.ts`, `packages/production/test/react.test.ts`.
- `apps/agents/test/partners.integration.test.ts` (Dropbox, Drive, bloqueios, Caçador, react com
  serviços falsos).
- `apps/worker-media/tests/test_partner_video.py` (corte só com a voz medido em dB; transcrição de
  verdade quando o modelo está na imagem).
- `e2e/tests/parceiros.spec.ts` (vídeo sintético em `e2e/fixtures/parceiro-teste.mp4`).
- Notebook: `make accept-4` (`REAL=1` mede o custo).
