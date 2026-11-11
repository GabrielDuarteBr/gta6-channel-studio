#!/usr/bin/env bash
# Critérios de aceite da Fase 1 (Pesquisa), rodados no notebook:
#  1. a pilha sobe e a coleta automática fica agendada (intervalo ≤ 60 min)
#  2. uma coleta REAL lê as fontes e traz notícias de GTA 6 com links
#  3. deduplica: notícias iguais de sites diferentes viram uma história só
#  4. pontua: toda história tem nota e explicação
#  5. testes com amostras offline (unitários, integração e e2e da Pauta/Fontes)
# Opcional: ESPERAR=1 make accept-1  → espera até 60 min por uma coleta automática.
set -uo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f infra/docker-compose.yml ${COMPOSE_EXTRA:-} --env-file .env"
OUT=${ACCEPT_OUT:-radar-neon-aceite-fase-1.txt}
run() {
  declare -a RESULTS=()
  FAILED=0
  pass() { RESULTS+=("✅ $1"); }
  fail() { RESULTS+=("❌ $1"); FAILED=1; }
  note() { RESULTS+=("⚠️  $1"); }
  step() { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }
  field() { python3 -c 'import json,sys; d=json.loads(sys.argv[1])["resumo"]; v=d.get(sys.argv[2]); print(", ".join(v) if isinstance(v,list) else ("" if v is None else str(v).lower()))' "$RESUMO" "$1"; }

  step "1. make up"
  if make up; then pass "Pilha do notebook no ar (make up)"; else fail "make up falhou"; fi

  step "2. Coleta real agora (pela fila, igual ao botão do painel)"
  coleta=$($COMPOSE exec -T agents node_modules/.bin/tsx src/scripts/collect-now.ts 2>&1)
  echo "$coleta"
  RESUMO=$(echo "$coleta" | grep -E '^\{"resumo"' | tail -1)
  if [[ -z "$RESUMO" ]]; then
    fail "A coleta não devolveu resumo (veja acima)"
    RESUMO='{"resumo":{}}'
  fi

  if [[ "$(field coletaOk)" == "true" ]]; then
    pass "Coleta terminou em $(field segundos) s ($(field fontesOk) de $(field fontesAtivas) fontes ok)"
  else
    fail "Coleta não terminou bem"
  fi
  erros=$(field fontesErro)
  if [[ -n "$erros" ]]; then note "Fontes com erro (corrija o endereço em Pauta → Fontes): $erros"; fi
  fontesOk=$(field fontesOk)
  if (( ${fontesOk:-0} >= 3 )); then pass "Pelo menos 3 fontes reais responderam"; else fail "Menos de 3 fontes responderam"; fi

  itens=$(field itens); historias=$(field historias); links=$(field historiasComLink)
  if (( ${itens:-0} > 0 && ${historias:-0} > 0 )) && [[ "$links" == "$historias" ]]; then
    pass "Notícias reais com links: $itens itens em $historias histórias, todas com link"
  else
    fail "Sem notícias reais com link (itens=$itens, histórias=$historias, com link=$links)"
  fi

  step "3. Deduplicação"
  multi=$(field historiasMultiFonte); rep=$(field titulosRepetidos)
  if (( ${multi:-0} >= 1 )) && [[ "$rep" == "0" ]]; then
    pass "Deduplica: $multi histórias juntam 2+ fontes; nenhuma manchete repetida na pauta"
  else
    fail "Deduplicação: histórias com 2+ fontes=$multi, manchetes repetidas=$rep"
  fi

  step "4. Pontuação e agendamento"
  sem=$(field semPontuacao)
  if [[ "$sem" == "0" ]]; then pass "Toda história tem nota e explicação"; else fail "Histórias sem nota: ${sem:-?}"; fi
  min=$(field agendadorMin)
  if (( ${min:-0} >= 10 && ${min:-0} <= 60 )); then
    pass "Coleta automática a cada $min min (recupera sozinha se o notebook dormir)"
  else
    fail "Coleta automática não agendada ou intervalo acima de 60 min ($min)"
  fi

  if [[ "${ESPERAR:-0}" == "1" ]]; then
    step "Esperando uma coleta automática (até 60 min)"
    ok=0
    for _ in $(seq 1 62); do
      n=$($COMPOSE exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' <<'SQL' | tr -d '[:space:]'
  SELECT count(*) FROM "JobRun"
   WHERE queue = 'research' AND status = 'SUCCEEDED'
     AND coalesce(payload->>'reason', '') <> 'manual'
     AND "finishedAt" > now() - interval '65 minutes';
SQL
  )
      if (( ${n:-0} > 0 )); then ok=1; break; fi
      sleep 60
    done
    if (( ok )); then pass "Coleta automática rodou sozinha na última hora"; else fail "Nenhuma coleta automática em 60 min"; fi
  else
    auto=$(field automaticasUltimaHora)
    if (( ${auto:-0} > 0 )); then pass "Coleta automática já rodou sozinha na última hora ($auto)"; else note "Ainda não houve coleta automática na última hora (rode ESPERAR=1 make accept-1 para esperar)"; fi
  fi

  step "5. Testes com amostras offline"
  if make test; then pass "Lint, tipos e testes (unitários + integração) passam"; else fail "make test falhou"; fi
  if make e2e; then pass "Pauta e Fontes no painel (e2e: promover, bloquear rumor/vazamento, fontes)"; else fail "make e2e falhou"; fi
  make test-down >/dev/null 2>&1 || true

  printf '\n\033[1mResultado da Fase 1\033[0m\n'
  printf '  %s\n' "${RESULTS[@]}"
  return "$FAILED"
}

run 2>&1 | tee "$OUT"
code=${PIPESTATUS[0]}
echo ""
echo "Relatório salvo em $(pwd)/$OUT"
# No WSL, deixa uma cópia na Área de Trabalho do Windows (para mandar ao Claude).
if command -v powershell.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
  desk=$(powershell.exe -NoProfile -Command '[Environment]::GetFolderPath("Desktop")' 2>/dev/null | tr -d '\r')
  if [[ -n "$desk" ]] && cp "$OUT" "$(wslpath -u "$desk")/" 2>/dev/null; then
    echo "Cópia na Área de Trabalho do Windows: $desk\\$OUT"
  fi
fi
exit "$code"
