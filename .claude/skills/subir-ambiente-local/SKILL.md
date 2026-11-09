---
name: subir-ambiente-local
description: Sobe, verifica, para ou reinicia o ambiente local do Radar Neon (Docker Compose no notebook com WSL 2) e diagnostica problemas comuns. Use quando pedirem para subir/derrubar o estúdio, ver por que um serviço não sobe ou preparar o notebook do zero.
---

# Subir o ambiente local

Tudo roda no Ubuntu do WSL 2, com o projeto em `~/projetos/gta6-channel-studio` (nunca em `/mnt/c`).

## Primeira vez
1. `make wsl-check` — corrija os itens ❌ (o guia para Windows está em `docs/notebook-setup.md`).
2. `make setup` — cria o `.env` com senhas e chaves novas (não sobrescreve um existente).
3. `make up` — constrói as imagens e espera os healthchecks.
4. `make owner` — o dono cria e-mail, senha e 2FA (QR no terminal). Nunca crie o dono por ele com dados inventados.
5. Painel em http://localhost:3000.

## Dia a dia
- Estado: `make ps` · Logs: `make logs s=<serviço>` · Reiniciar um serviço: `make restart s=<serviço>`
- Parar sem perder dados: `make down`
- `make reset` APAGA dados locais: só com pedido explícito do dono (ele confirma digitando APAGAR).

## Diagnóstico
| Sintoma | Verificar |
|---|---|
| `make up` para em `migrate` | `make logs s=migrate`; Postgres saudável? `.env` com `POSTGRES_PASSWORD`? |
| web "unhealthy" | `make logs s=web`; `/api/health` mostra qual dependência caiu (postgres/redis) |
| render "unhealthy" | Chrome headless não baixou no build; reconstruir `docker compose -f infra/docker-compose.yml build render` |
| s3 "unhealthy" | `make logs s=s3`; credenciais S3 no `.env` |
| Docker sem memória | `.wslconfig` (`memory=10GB` no notebook de 16 GB) e `wsl --shutdown` no PowerShell |
| Lento / sem recarregar | projeto em `/mnt/c`? mover para `~/projetos` |

Serviços: postgres, redis, s3 (SeaweedFS), migrate (one-shot), web (:3000), agents (:4100), render (:4200),
worker-media (:4300). Só o painel e o Postgres (127.0.0.1:55432, inspeção) são publicados, sempre em localhost.

## Testes e aceite
- `make test` (lint, tipos, testes Node e Python em pilha isolada) · `make e2e` (Playwright, 127.0.0.1:3100)
- `make accept-0` roda todos os critérios da Fase 0 e imprime ✅/❌.
