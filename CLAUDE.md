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
apps/worker-media  Python 3.11 + FastAPI interna: FFmpeg, faster-whisper, PySceneDetect, Rhubarb. :4300
packages/shared    config zod, perfis notebook|vps, settings, logger com redação, crypto, datas
packages/policy    regras inegociáveis como funções puras
packages/db        Prisma 7 (adapter pg), login do dono, settings auditadas
packages/queue     filas BullMQ, jobId determinístico, registro de jobs
e2e                Playwright (pilha isolada)
infra              Dockerfiles, Compose (notebook, testes, produção), Caddy, SeaweedFS
```

- **Armazenamento S3**: SeaweedFS (a edição comunitária do MinIO foi arquivada em 2026 e não publica
  mais imagens). O app fala S3 puro, então o backend é trocável.
- **Filas**: `research, llm, tts, image, render, upload, media, system`. Concorrência por perfil
  (`packages/shared/src/profile.ts`). Todo job tem id determinístico (`deterministicJobId`) e é
  idempotente; jobs `RUNNING` ao subir viram `INTERRUPTED` e o BullMQ os devolve à fila.
- **Cota do YouTube** conta por dia do Pacífico (`youtubeQuotaDay`); orçamento por dia de Brasília.
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
| `make accept-0` | todos os critérios de aceite da Fase 0 |
| `make reset` | apaga dados locais (pede confirmação) |

Desenvolvimento com Node local (opcional): `pnpm install`, `pnpm lint`, `pnpm turbo run typecheck
test`. Testes de integração precisam de `TEST_DATABASE_URL` e `TEST_REDIS_URL`.
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
