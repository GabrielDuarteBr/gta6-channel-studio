# Radar Neon — GTA6 Channel Studio

Canal de notícias de GTA 6 apresentado pelo personagem 2D **Zeca Neon**. O sistema pesquisa
notícias, escreve roteiros originais, produz vídeos e Shorts, publica no YouTube com aprovação
humana e mostra métricas num painel. Roda no notebook do dono (Windows 11 + WSL 2 + Docker
Desktop) durante as Fases 0–7 e numa VPS Ubuntu 24.04 na Fase 8.

Fale com o dono em **português**. Ele usa Windows: passos fora do Ubuntu (PowerShell, Docker
Desktop, configurações do Windows) devem ser explicados passo a passo.

## Regras inegociáveis (implementadas como código em `packages/policy`)

1. **Nunca baixar vídeo/áudio/imagem do YouTube.** Pesquisa no YouTube é só de metadados via Data
   API. Mídia entra só pela Biblioteca (imprensa oficial, arquivos enviados pelo parceiro, imagens
   do nosso provedor, upload do dono), sempre com **manifesto de direitos**. Sem manifesto, não
   entra em render. `assertMediaImportAllowed` recusa domínios do YouTube; o CI falha se surgir
   dependência de download (`scripts/forbidden-deps.json`).
2. **Cortes de terceiros** só de parceiros com permissão registrada (tipo, prova, condições,
   status). Frase vaga como "cortes liberados" vira candidato, não permissão. Condições aplicadas em
   cada Short. Revogação lista os vídeos afetados. Música/filme/TV de terceiros no clipe é cortado
   ou silenciado.
3. **React**: clipe do parceiro ≤ 50% do Short; comentário do personagem ≥ 50%, pausando o clipe.
   "Uau"/"olha isso" não contam. Crédito visível durante o clipe e na descrição.
4. **Rockstar/Take-Two**: bloquear vazamentos, cópias pré-lançamento, cutscenes isoladas,
   entretenimento in-game isolado, trapaças online e mods não autorizados. **Anti-spoiler** após
   19/11/2026 com janela configurável.
5. **Conteúdo original**: ≥ 70% de narração/comentário próprio nos vídeos de notícia; compilados só
   com segmentos do próprio canal; variar formatos; limites diários (padrão 1 longo + 4 Shorts).
6. **Fatos**: toda afirmação com fonte; rumor rotulado e com ≥ 2 fontes independentes; fontes
   oficiais têm prioridade.
7. **Divulgação de IA**: `status.containsSyntheticMedia` no upload; o personagem nunca afirma ser
   humano.
8. **Humano no circuito**: tudo sobe privado + agendado; público só após aprovação no painel. Piloto
   automático desligado por padrão, só o dono liga, e ainda passa por Conformidade e Revisor visual.
   Mensagens a criadores são só rascunhos — o sistema nunca envia.
9. **Segredos** só no `.env` (fora do Git; 600 na VPS) ou cofre. Nunca no código, no repositório ou
   nos logs. Tokens OAuth e segredo TOTP cifrados (AES-256-GCM, `@studio/shared/crypto`). O logger
   (`createLogger`) mascara segredos.

Aplicação em três camadas: ferramenta MCP valida → hook `PreToolUse` do Agent SDK bloqueia →
worker de render/upload confere de novo no banco. Toda decisão vai para `AuditLog`.

## Arquitetura

```
apps/web           Next.js 16 (App Router) + Tailwind 4 + Auth.js v5 (senha + TOTP). Painel em :3000
apps/agents        Orquestrador (Claude Agent SDK, a partir da Fase 1) + workers BullMQ. /health :4100
apps/render        Remotion 4 (composições, avatar, thumbnails). /health :4200
apps/worker-media  Python 3.11 + FastAPI interna: FFmpeg, faster-whisper (modelo small na imagem), Rhubarb. :4300
packages/shared    config zod, perfis notebook|vps, settings, logger com redação, crypto, datas
packages/policy    regras inegociáveis como funções puras
packages/db        Prisma 7 (adapter pg), login do dono, settings auditadas
packages/queue     filas BullMQ, jobId determinístico, registro de jobs
packages/research  feeds RSS/Atom/RDF, páginas sem feed, YouTube (metadados), URL canônica,
                   relevância GTA 6, agrupamento por história, pontuação, prompt da triagem
packages/llm       cliente Claude com saída estruturada (zod), teto de gasto e CostLedger
packages/avatar    personagem: marcações do roteiro, linha do tempo, piscadas, bíblia (zod) e a
                   arte em camadas do Zeca (`@studio/avatar/art`, React puro, usada no render e no painel)
packages/providers provedores plugáveis (voz/TTS e imagem; upload na Fase 5), com Fake
packages/storage   S3 (SeaweedFS), leitura do tipo de imagem pelos bytes e a Biblioteca (manifesto)
packages/production roteiro do vídeo (zod), plano do vídeo (cenas, legendas, fonte, rumor), thumbnails,
                   react (trechos candidatos, roteiro do Comentarista, plano com o clipe pausado)
e2e                Playwright (pilha isolada)
infra              Dockerfiles, Compose (notebook, testes, produção), Caddy, SeaweedFS
```

- **Armazenamento S3**: SeaweedFS (a edição comunitária do MinIO foi arquivada em 2026 e não publica
  mais imagens). O app fala S3 puro, então o backend é trocável.
- **Filas**: `research, llm, tts, image, render, upload, media, system`. Concorrência por perfil
  (`packages/shared/src/profile.ts`). Todo job tem id determinístico (`deterministicJobId`) e é
  idempotente; jobs `RUNNING` ao subir viram `INTERRUPTED` e o BullMQ os devolve à fila.
- **Cota do YouTube** conta por dia do Pacífico (`youtubeQuotaDay`); orçamento por dia de Brasília.
- **Valores em reais**: o dono usa R$. O `CostLedger` guarda o que as APIs cobram (US$), mas tudo o
  que o dono vê (painel, relatórios, scripts, mensagens de teto) sai em reais via `currentFx`
  (`packages/db/src/fx.ts`): PTAX de venda do Banco Central (job `fx.update` na fila `system`, a cada
  6 h; tabela `FxRate`) ou cotação fixa, mais spread do banco e IOF (`settings.currency`). Teto em
  reais (`settings.budget.dailyBrl/monthlyBrl`, padrão R$ 5/dia e R$ 150/mês), convertido para
  dólar em `budgetStatus`. Use `formatBrl`/`fx.formatUsd`; nunca mostre US$ ao dono. Fale de custos
  com o dono em reais.
- **Pesquisa (Fase 1)**: fila `research`, job `collect` (uma coleta por vez). Agendada por Job
  Scheduler (`research-collect`, intervalo em Configurações) + uma coleta de recuperação ao subir se a
  última ficou velha. Pipeline em `apps/agents/src/research/pipeline.ts`: coleta (GET condicional,
  ETag) → grava itens (idempotente por URL canônica) → agrupa (similaridade de manchete, limiar 0.42,
  números conflitantes separam) → atualiza histórias (manchete da fonte de maior nível) → pontua
  (fonte oficial 1.0, imprensa 0.6, comunidade 0.3, meia-vida 24 h) → triagem com
  `claude-haiku-5-5` (PT-BR, tipo, relevância, duplicatas entre idiomas; lotes de 15). Com modo
  simulado ou sem `ANTHROPIC_API_KEY`, a triagem é falsa e custa zero. Promover história passa por
  `canPromoteStory` (vazamento, trapaça, mods, spoiler na janela, rumor com < 2 fontes). Fontes
  padrão em `packages/research/src/default-sources.ts` (semeadas uma vez; o dono edita em Pauta →
  Fontes). **Reddit fora**: a API fechou para apps novos e os feeds RSS desligam em 13/11/2026.
- **Personagem (Fase 2)**: roteiro com marcações `[feliz] [empolgado] [surpreso] [serio] [debochado]
  [desconfiado] [bravo] [neutro]`, gestos `[aponta_tela] [aceno]` e `[pausa]`/`[pausa:ms]` → cada trecho vira um áudio
  (TTS plugável: `google` = Chirp 3 HD, `fake` = espeak-ng) → worker-media junta a trilha com pausas e devolve
  o tempo de cada trecho → Rhubarb (`-r phonetic --threads 1`, bocas A–H/X) → linha do tempo →
  composição `ZecaClip` (16:9 ou 9:16). Job `character.clip` na fila `render` (agents). O render é
  assíncrono (`POST /render` devolve id; `GET /render/<id>`) e serve `/data/work` só na rede interna;
  o painel vê os vídeos por `/api/media` (só o dono). Chrome em `RENDER_GL=swiftshader`: com `swangle`
  os quadros variavam 1 unidade entre renders. Regra 7 em código: `assertCharacterLine` recusa o Zeca
  dizendo que é humano. Bíblia versionada (`CharacterBible`, regras fixas que nenhuma versão remove).
  Rive: prova de conceito em `docs/fase-2-rive-poc.md` (componente próprio, sem CDN); camadas é o
  padrão.
- **Voz (Google Chirp 3 HD)**: `packages/providers/src/google-tts.ts`, conferido no documento de
  descoberta oficial (`v1/text:synthesize`, chave no cabeçalho `x-goog-api-key`, LINEAR16 com
  cabeçalho WAV, `speakingRate` 0,25–2). Chave `GOOGLE_TTS_API_KEY` só no `.env` (agents). Cache por
  voz+velocidade+texto em `/data/work/tts-cache` (não paga duas vezes, render repetível). Trava em 95%
  da cota grátis mensal (`settings.character.freeCharsPerMonth`, padrão 1 milhão) salvo
  `allowPaid`, e teto de gasto; caracteres no `CostLedger.characters`. Modo simulado = voz de teste,
  salvo pedido explícito no clipe (`tts: 'google'`). `make vozes` lista as vozes da chave e gera
  amostras.
- **Notícias em vídeo (Fase 3)**: Pauta → "Produzir" (tela Produção; nunca automático) → job
  `production.run` na fila `render`, em `apps/agents/src/production/pipeline.ts`, com retomada pelo
  banco (`Production.script/plan/outputs/review`): Roteirista (`writer.ts`, Sonnet 5.5, bíblia no
  system em cache, saída estruturada; o código confere `finalizeScript` + `checkScript` e pede UMA
  correção) → Diretor de arte (`art.ts`: Biblioteca com manifesto ativo, ou gera com Imagen/Gemini
  via `packages/providers/src/image.ts`; mesmo prompt não é pago 2×; imagem vira mídia com manifesto
  `IMAGE_PROVIDER`) → voz por trecho + Rhubarb → `buildVideoPlan` → 3ª camada (`assertAssetRenderable`
  no banco, `assertOriginalCommentary`) → render `NewsVideo` + 3 `Thumbnail` (stills) → Revisor
  (`review.ts`: quadros-chave do worker-media + thumbnails para o Claude com visão; o código decide a
  aprovação; correções fechadas: trocar imagem da cena, descartar thumbnail) até
  `production.maxReviewRounds`. Claude Sonnet/Opus 5.5 com fallback do servidor
  (`fallbacks: 'default'`). Custo por vídeo em `CostLedger.productionId`; render reporta CPU e pico de
  memória do cgroup do container. Limite diário (`limits.daily`) no "Produzir". Biblioteca: S3 com
  nome pelo sha256, upload do dono e importação só de rockstargames.com/take2games.com
  (`fetchOfficialImage`, nunca YouTube). Tela Arte: aprovar (tag `aprovada` → o Roteirista pode
  reutilizar), variação (job `art.variation` na fila `image`), descartar (revoga). Fontes Anton e
  Inter embutidas (Fontsource, OFL). Chave `GEMINI_API_KEY` só no `.env`.
- **Parceiros e react (Fase 4)**: tabelas `Partner` (candidato → parceiro), `PartnerPermission`
  (tipo `REACT_CLIPS`, prova, condições `{credit, link, hashtag, monetization, maxClipSec}`, status
  ACTIVE/SUSPENDED/REVOKED) e `PartnerImport`; `Asset` ganhou vídeo (`durationSec`, `analysis`,
  `audioCleared`) e `RightsManifest.permissionId`; `Production.kind` NEWS|REACT (`storyId` opcional).
  Regras em `packages/policy/src/partner.ts`: `assertPermissionInput` (frase vaga não é permissão),
  `assertPartnerPermission` (camadas 1–3), `parseShareLink` (só Dropbox/Drive; YouTube recusado),
  `isAllowedDownloadHost` (cada redirecionamento conferido), `checkReactTimeline` (clipe ≤ 50%,
  comentário substantivo ≥ 50%, sem sobreposição, crédito em todo clipe). Caçador
  (`apps/agents/src/partners/hunter.ts`, job `partners.hunt` na fila `research`, semanal +
  botão): YouTube só metadados (`search.list type=channel` + `channels.list`), Haiku dá nota e a
  abertura; o texto fixo do rascunho (com aviso de IA) é do código; **nunca envia**. Importação
  (`partner.import`, fila `media`): Dropbox (`dl=1`), Drive API v3 (`files.get alt=media`, chave
  `GOOGLE_DRIVE_API_KEY` ou a do YouTube, no cabeçalho `x-goog-api-key`) ou envio pelo painel
  (`/api/partners/upload`, fora do proxy, em fluxo para `incoming/` no S3); confere bytes (mp4/mov/
  mkv/webm/zip), tamanho e duração, guarda em `library/` com manifesto e copia para
  `/data/work/partners/<sha>.<ext>` (agents agora monta o volume de trabalho). Análise
  (`media.analyze`): faster-whisper small int8 (fala via Silero VAD, música = ♪/[música]),
  cenas pelo `scdet` do FFmpeg, volume por segundo. React (`apps/agents/src/react/pipeline.ts`,
  mesmo job `production.run`): `clipCandidates` → Comentarista (Sonnet, quadros + transcrição,
  avalia cutscene/mídia de terceiros/vazamento/spoiler) → voz → `fitClipDurations` (≤ 45% com
  folga) → `cut` (só a voz do parceiro; áudio inteiro só com `audioCleared`) → trilha com pausas do
  tamanho dos clipes → `buildReactPlan` → 3ª camada (permissão, manifesto, regra 3, condições na
  descrição) → `ReactShort` (layouts tv/split/cinema em rodízio; `Freeze` + `OffthreadVideo`) →
  Revisor. Nomes dos jobs em `@studio/queue` (`PARTNER_IMPORT_JOB`, `ANALYZE_JOB`, `HUNT_JOB`).
- **Publicação, métricas e Comando (Fases 5–7)**: vídeo READY → `onReady` → job `publish.compliance`
  (fila `llm`, `apps/agents/src/publish/compliance.ts`): monta `Production.metadata` (descrição com
  "Fontes:", créditos, `AI_NOTICE`, hashtags; o que o dono edita fica com `editedByOwner`), roda
  `checkCompliance` (`packages/policy/src/compliance.ts`) + revisão de título com Haiku → `Production.compliance`.
  Aprovação no painel (`apps/web/src/server/publish.ts`) cria `Publication` (privado + `publishAt`,
  limite diário por dia de publicação): `mode=api` com o YouTube conectado ou no modo simulado,
  senão `MANUAL` (pacote: vídeo, thumbnail, .txt em `/api/publish/<id>/pacote`). Envio: job
  `publish.upload` (fila `upload`, `publish/upload.ts`): 3ª camada (Conformidade ok, direitos de
  cada mídia, data futura), resumable com `uploadUri` salvo (retoma após reinício), thumbnail só no
  longo; simulado = `SIMULADO-…` sem rede. YouTube em `packages/providers/src/youtube.ts`
  (`insertBody` força private + `containsSyntheticMedia`), OAuth web (`/api/youtube/connect` com
  state em cookie → `/api/youtube/callback`; redirect `${AUTH_URL}/api/youtube/callback`), token
  cifrado em `OAuthToken` (`packages/db/src/youtube-token.ts`); `GOOGLE_OAUTH_CLIENT_ID/SECRET` só no
  `.env` (web e agents). Sem auditoria do Google os envios ficam privados (o painel avisa).
  Métricas: `metrics.sync` (fila `system`, a cada 3 h) → `ChannelStat`/`VideoStat`. Produção diária:
  `pauta.daily` disparado pelo batimento de 5 min quando passa de `schedule.daily.time` (Brasília) e
  ainda não rodou hoje (`ranToday` pela auditoria); "Rodar agora" = `{force:true}`. Comando:
  `chat.turn` (fila `llm`, `apps/agents/src/command/chat.ts`): Sonnet 5.5 com ferramentas fechadas
  (`Llm.toolChat`, laço manual em streaming, `fallbacks: 'default'`), resposta escrita aos poucos em
  `ChatMessage` e lida pelo painel via SSE (`/api/command/stream`); publicar só cria `PendingAction`
  que o dono confirma. Piloto automático (`mode.autopilot`) só liga com código TOTP
  (`verifyOwnerTotp`). Produção ao vivo: SSE `/api/production/stream` + `LiveRefresh`.
- **Arte do artista e estilo do Zeca**: arte autoral em camadas PNG/SVG com nomes fixos
  (`packages/avatar/src/art-pack.ts`: `REQUIRED_LAYERS`/`OPTIONAL_LAYERS`, `checkArtFiles` confere
  nomes, tipo pelos bytes, SVG seguro, mesma tela; `layerFrame` decide boca/olhos/sobrancelhas/braço
  por quadro). Tabela `CharacterArt` (versão, DRAFT/ACTIVE/ARCHIVED, prova de direitos obrigatória,
  camadas no S3 em `character-art/v<n>/`, nomes em minúsculas) em `packages/db/src/character-art.ts`.
  Painel: Personagem → Arte do artista (envio, prévia, clipe de teste com rascunho, "Usar esta arte");
  camadas servidas por `/api/character-art/v<n>/<arquivo>` (SVG com CSP sandbox). Agents copia a arte
  ativa para `/data/work/character-art/` (`artForRender`) e passa `art` nas props; o render usa
  `Character` → `LayeredArt` com o `<Img>` da Remotion (todas as camadas montadas, só a da vez
  visível) ou a provisória. Modelo para o artista: `scripts/gerar-modelo-arte.py` →
  `docs/modelo-arte-zeca/` e `apps/web/public/modelo-arte-zeca.zip`; guia: `docs/guia-arte-zeca.md`.
  Estilo: bíblia com `style` (faça/nunca faça/exemplos; comentarista youtuber, sarcástico, sem
  palavrão); `personaSection`/`markupSection` (`packages/production/src/persona.ts`) entram no
  Roteirista e no Comentarista; `styleIssues` (tom de telejornal, < 4/3 expressões, pouca opinião,
  sem "você") pede UMA melhora sem bloquear. `ensureBible` troca a bíblia padrão só se o dono nunca
  editou.
- **TypeScript**: pacotes exportam o código-fonte `.ts` (sem build); serviços rodam com `tsx`;
  imports sem extensão (resolução `Bundler`). TS 6 (o typescript-eslint ainda não suporta o 7).

## Comandos

Notebook (Ubuntu no WSL, projeto em `~/projetos/gta6-channel-studio`, nunca em `/mnt/c`):

| Comando | O que faz |
|---|---|
| `make setup` | cria o `.env` com senhas/chaves novas (não sobrescreve) |
| `make wsl-check` | confere WSL 2, Docker, memória, pasta e fim de linha |
| `make up` / `make down` | sobe (com build e espera de healthchecks) / para |
| `make logs s=web` | logs ao vivo |
| `make owner` | cria/recria o dono do painel (QR do 2FA no terminal) |
| `make test` | lint + tipos + testes Node e Python, em containers, pilha isolada |
| `make e2e` | Playwright contra pilha isolada em 127.0.0.1:3100 |
| `make render-test` | render de teste do Zeca no container |
| `make build-prod` | imagens de produção |
| `make coletar` | coleta notícias agora (pela fila) e imprime o resultado por fonte |
| `make zeca` | clipe de teste do Zeca (`ROTEIRO="..."`, `VERTICAL=1`, `VOZ=google`, `ARTE=<versão>`, `DUAS=1` compara 2 renders) |
| `make vozes` | vozes Chirp 3 HD da chave + amostras (`AMOSTRAS=0` só lista) |
| `make produzir` | produz um vídeo pela fila e espera (`FORMATO=LONG`, `HISTORIA=`, `REAL=1`) |
| `make imagens` | modelos de imagem da chave Gemini (`COMPARAR=1` gera o comparativo, pago) |
| `make accept-3` | aceite da Fase 3 (Short + longo + thumbnails + Revisor, render repetível, direitos; `REAL=1` mede custo) |
| `make parceiros` | roda o Caçador de parceiros agora (precisa da `YOUTUBE_API_KEY`; só rascunha) |
| `make accept-5` | aceite da etapa final (Short → Conformidade → aprovação → envio simulado, bloqueio, Comando, diária, YouTube; `ENVIAR=1` faz um envio real privado de teste) |
| `make publicar` | confere a conexão com o YouTube e sincroniza as métricas (só leitura) |
| `make accept-4` | aceite da Fase 4 (parceiro de teste + arquivo → react dentro dos limites, render repetível, bloqueios; `REAL=1` mede custo) |
| `make accept-0` | todos os critérios de aceite da Fase 0 |
| `make accept-1` | aceite da Fase 1 (coleta real + testes); `ESPERAR=1` espera a automática |
| `make accept-2` | aceite da Fase 2 (clipe 2× com quadros idênticos, Short, testes) |
| `make reset` | apaga dados locais (pede confirmação) |

Desenvolvimento com Node local (opcional): `pnpm install`, `pnpm lint`, `pnpm turbo run typecheck
test`. Testes de integração precisam de `TEST_DATABASE_URL` e `TEST_REDIS_URL` (cada pacote usa o
banco `<nome>_<pacote>`, criado pelo global-setup, porque o Turbo roda os pacotes em paralelo). O e2e
usa dados de demonstração (`apps/agents/src/scripts/seed-demo-pauta.ts`, só com `DEMO_SEED=1`) e a
pilha de testes roda com `RESEARCH_SCHEDULE=off`, `FX_SCHEDULE=off`, `PARTNER_HUNT_SCHEDULE=off`,
`DAILY_SCHEDULE=off` e `METRICS_SCHEDULE=off` (sem rede real).
`pnpm --filter @studio/db migrate:dev --name <nome>` cria migration (depois rode `pnpm db:generate`;
o Prisma 7 não gera o cliente sozinho).

## Convenções

- Idioma: UI, mensagens, comentários e commits em português; identificadores em inglês.
- zod em toda entrada externa; erros não vazam segredos (`parseEnv` só cita nomes).
- Nada de shell livre nos agentes: ferramentas tipadas com operações fechadas. FFmpeg só via
  `apps/worker-media/app/media_tools.py` (caminhos restritos a `/data/work`). Nenhum MCP de FFmpeg da
  comunidade.
- Ações com efeito no canal (publicar, apagar, alterar vídeo público) sempre pedem confirmação do
  dono.
- Antes de usar uma API externa, consulte a documentação atual (Agent SDK, YouTube Data/Analytics,
  Remotion, Rive, Caddy, Docker). Não confie em memória para nomes de campos ou custos de cota.
- Toda mudança de configuração passa por `setSetting` (valida e audita).
- Licença do Remotion: gratuita (pessoa física / até 3 pessoas). Rever se isso mudar.

## Claude Code neste repositório

- `.claude/settings.json`: hooks (`post-edit.sh` formata e roda o lint do arquivo editado;
  `guard-secrets.sh` bloqueia `git add/commit` de `.env` e de diffs com chaves), permissões (nega ler
  `.env` e usar ssh/scp) e plugins `remotion@remotion` e `frontend-design@claude-plugins-official`.
- `.mcp.json`: Playwright, Postgres (`postgres-mcp` em modo restrito, só leitura), Context7 e GitHub.
  Variáveis no shell do Ubuntu (nunca no repositório): `STUDIO_DB_URL` (URL do Postgres local em
  `127.0.0.1:55432`) e `GITHUB_MCP_PAT` (token fine-grained do GitHub, só leitura).
- Subagentes em `.claude/agents/` (revisor-codigo, testador-ui, especialista-youtube-api,
  especialista-ffmpeg, especialista-remotion, especialista-infra) e skills em `.claude/skills/`.
- Depois de instalar plugins ou mudar MCPs, reinicie a sessão do Claude Code.

## Notebook (WSL 2)

Setup completo para o dono em `docs/notebook-setup.md` (.wslconfig para 16 GB: `memory=10GB`,
Docker Desktop com integração WSL). Painel só em `127.0.0.1`. Perfil `APP_PROFILE=notebook`: render
720p, 1 render por vez, limites de container somando ~8,5 GB. RTX 3050: opcional (Fase 2/3,
`docker-compose.gpu.yml`); o caminho CPU é o padrão por paridade com a VPS.

## Deploy e VPS (Fase 8)

`infra/docker-compose.prod.yml`: só o Caddy publica 80/443 (portas do Docker passam por fora do UFW);
imagens `ghcr.io/gabrielduartebr/radar-neon-{web,agents,render,worker-media}`. O CI constrói as
imagens e publica no GHCR só a partir da `main`. Deploy por SSH (pull, `prisma migrate deploy`,
`up -d`) e rollback entram na Fase 8. **Nunca rode comandos na VPS sem mostrar ao dono e esperar o OK
para os que alteram o servidor.**

## Fluxo de trabalho

Uma branch por fase (`fase-N-<nome>`); só avança quando `make accept-N` passa no notebook do dono.
No fim de cada fase: o que foi feito, como testar, o que o dono precisa providenciar e riscos.
Perguntar antes de decisões que afetem custo, conformidade, parceiros, segurança do servidor ou o
canal público.
