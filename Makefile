# =====================================================================
# Radar Neon — comandos do dia a dia (rode no Ubuntu do WSL ou na VPS)
#   make help     lista tudo
# =====================================================================
SHELL := /bin/bash
.DEFAULT_GOAL := help

# Flags extras (ex.: proxy corporativo). Normalmente vazias.
COMPOSE_EXTRA ?=
DOCKER_BUILD_FLAGS ?=

COMPOSE      := docker compose -f infra/docker-compose.yml $(COMPOSE_EXTRA) --env-file .env
TEST_COMPOSE := docker compose -p radar-neon-test -f infra/docker-compose.yml -f infra/docker-compose.test.yml $(COMPOSE_EXTRA) --env-file infra/test.env
GHCR_OWNER   ?= gabrielduartebr
IMAGE_TAG    ?= local

.PHONY: help setup wsl-check up down restart logs ps owner reset test test-down e2e render-test build-prod accept-0 diagnose

help: ## Lista os comandos
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

setup: ## Cria o .env com senhas e chaves novas (não sobrescreve)
	@bash scripts/setup-env.sh

wsl-check: ## Confere WSL 2, Docker, memória, pasta do projeto e fim de linha
	@bash scripts/wsl-check.sh

.env:
	@echo "❌ .env não encontrado. Rode: make setup" && exit 1

up: .env ## Sobe tudo (constrói as imagens e espera os serviços ficarem saudáveis)
	@$(COMPOSE) up -d --build --wait || { bash scripts/diagnose.sh; exit 1; }
	@echo ""
	@echo "✅ Painel em http://localhost:3000  (primeira vez? rode: make owner)"

down: ## Para tudo (mantém os dados)
	$(COMPOSE) down

restart: .env ## Reinicia os serviços (s=nome para um só)
	$(COMPOSE) restart $(s)

logs: ## Mostra os logs ao vivo (s=nome para um só, ex.: make logs s=web)
	$(COMPOSE) logs -f --tail=200 $(s)

ps: ## Estado e saúde dos serviços
	$(COMPOSE) ps

owner: .env ## Cria/recria o dono do painel (e-mail, senha e 2FA)
	$(COMPOSE) exec agents node_modules/.bin/tsx /app/packages/db/scripts/create-owner.ts

reset: ## APAGA banco, filas e arquivos locais (pede confirmação)
	@read -r -p "Isso apaga banco, filas e arquivos locais do notebook. Digite APAGAR para confirmar: " c; \
	  if [ "$$c" != "APAGAR" ]; then echo "Cancelado."; exit 1; fi
	$(COMPOSE) down -v --remove-orphans

test: ## Lint, tipos e testes (Node + Python) em containers, numa pilha isolada
	$(TEST_COMPOSE) up -d --wait postgres redis
	$(TEST_COMPOSE) run --rm --build tests
	docker build $(DOCKER_BUILD_FLAGS) -f infra/docker/worker-media.Dockerfile --target test -t radar-neon/worker-media-test:local .
	docker run --rm radar-neon/worker-media-test:local

e2e: ## Testes de ponta a ponta do painel (pilha isolada em 127.0.0.1:3100)
	$(TEST_COMPOSE) up -d --build --wait
	$(TEST_COMPOSE) exec -T \
	  -e OWNER_EMAIL=dono-e2e@radarneon.local -e OWNER_PASSWORD=senha-e2e-muito-forte \
	  -e OWNER_TOTP_SECRET=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP \
	  agents node_modules/.bin/tsx /app/packages/db/scripts/create-owner.ts > /dev/null
	$(TEST_COMPOSE) run --rm --build e2e

test-down: ## Derruba e apaga a pilha isolada de testes
	$(TEST_COMPOSE) --profile tests down -v --remove-orphans

render-test: .env ## Render de teste do Zeca dentro do container (720p no notebook)
	$(COMPOSE) exec -e RENDER_OUT_DIR=/data/work/hello render node_modules/.bin/tsx src/scripts/render-hello.ts

build-prod: ## Constrói as imagens de produção (as mesmas que vão para o GHCR)
	@for t in web agents render; do \
	  docker build $(DOCKER_BUILD_FLAGS) -f infra/docker/node.Dockerfile --target $$t \
	    -t ghcr.io/$(GHCR_OWNER)/radar-neon-$$t:$(IMAGE_TAG) . || exit 1; \
	done
	docker build $(DOCKER_BUILD_FLAGS) -f infra/docker/worker-media.Dockerfile --target worker-media \
	  -t ghcr.io/$(GHCR_OWNER)/radar-neon-worker-media:$(IMAGE_TAG) .

accept-0: ## Roda todos os critérios de aceite da Fase 0
	@bash scripts/accept-0.sh

diagnose: ## Mostra por que algum serviço não está saudável (estado, teste de saúde e logs)
	@bash scripts/diagnose.sh
