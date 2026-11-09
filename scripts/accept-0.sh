#!/usr/bin/env bash
# Critérios de aceite da Fase 0 (Fundação), rodados no notebook:
#  1. um comando sobe tudo e os serviços ficam saudáveis
#  2. o painel abre em localhost e só escuta em 127.0.0.1
#  3. login com senha + 2FA funciona (e2e numa pilha isolada)
#  4. os testes passam (Node + Python)
#  5. o render de teste roda dentro do container
#  6. as imagens de produção são construídas
set -uo pipefail
cd "$(dirname "$0")/.."

declare -a RESULTS=()
pass() { RESULTS+=("✅ $1"); }
fail() { RESULTS+=("❌ $1"); FAILED=1; }
FAILED=0
step() { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }

step "Ambiente"
bash scripts/wsl-check.sh || true

step "1. make up"
if make up; then pass "Pilha do notebook sobe com um comando (make up)"; else fail "make up falhou"; fi

step "2. Painel em localhost"
health=$(curl -fsS --max-time 10 http://127.0.0.1:3000/api/health || true)
if [[ "$health" == *'"status":"ok"'* ]]; then pass "Painel responde em http://localhost:3000 (/api/health ok)"; else fail "Painel não respondeu: $health"; fi

exposed=$(docker compose -f infra/docker-compose.yml --env-file .env ps --format '{{.Ports}}' | tr ',' '\n' | grep -E '0\.0\.0\.0|:::' || true)
if [[ -z "$exposed" ]]; then pass "Nenhuma porta aberta para a rede (só 127.0.0.1)"; else fail "Portas expostas para a rede: $exposed"; fi

step "3 e 4. Testes"
if make test; then pass "Lint, tipos e testes (Node + Python) passam"; else fail "make test falhou"; fi
if make e2e; then pass "Login com senha + TOTP e telas do painel (e2e)"; else fail "make e2e falhou"; fi
make test-down >/dev/null 2>&1 || true

step "5. Render de teste no container"
out=$(make -s render-test 2>&1 | tail -1)
echo "$out"
if [[ "$out" == *'"composition":"HelloZeca"'* ]]; then pass "Render do Zeca (720p) dentro do container: $(echo "$out" | grep -oE '"seconds":[0-9.]+' | cut -d: -f2) s"; else fail "Render de teste falhou"; fi

step "6. Imagens de produção"
if make build-prod; then pass "Imagens de produção construídas (web, agents, render, worker-media)"; else fail "make build-prod falhou"; fi

printf '\n\033[1mResultado da Fase 0\033[0m\n'
printf '  %s\n' "${RESULTS[@]}"
exit "$FAILED"
