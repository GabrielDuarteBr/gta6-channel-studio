#!/usr/bin/env bash
# Critérios de aceite da Fase 2 (Personagem), rodados no notebook:
#  1. a pilha sobe com voz de teste (espeak-ng) e Rhubarb no worker-media
#  2. texto de teste → clipe com boca sincronizada e pelo menos 3 expressões
#  3. o mesmo clipe renderizado 2 vezes tem todos os quadros com hash idêntico
#  4. o Short (9:16) também renderiza
#  5. testes (unitários, integração, e2e da tela Personagem)
# O vídeo do teste vai para a Área de Trabalho do Windows (radar-neon-zeca-teste.mp4).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

COMPOSE="docker compose -f infra/docker-compose.yml ${COMPOSE_EXTRA:-} --env-file .env"
OUT=${ACCEPT_OUT:-radar-neon-aceite-fase-2.txt}
VIDEO_OUT=radar-neon-zeca-teste.mp4

run() {
  declare -a RESULTS=()
  FAILED=0
  pass() { RESULTS+=("✅ $1"); }
  fail() { RESULTS+=("❌ $1"); FAILED=1; }
  step() { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }
  # field <json> <chave> [len]: valor (listas viram "a, b") ou tamanho da lista
  field() {
    python3 -c '
import json, sys
d = json.loads(sys.argv[1]).get("resumo", {})
v = d.get(sys.argv[2])
if len(sys.argv) > 3:
    print(len([x for x in (v or []) if x != "X"]))
elif isinstance(v, list):
    print(", ".join(map(str, v)))
else:
    print("" if v is None else str(v).lower())
' "$1" "$2" ${3:-}
  }

  step "1. make up"
  if make up; then pass "Pilha do notebook no ar (make up)"; else fail "make up falhou"; fi

  step "Ferramentas de voz no worker-media"
  health=$($COMPOSE exec -T worker-media python -c "import urllib.request as u; print(u.build_opener(u.ProxyHandler({})).open('http://127.0.0.1:4300/health').read().decode())" 2>/dev/null)
  echo "$health"
  if [[ "$health" == *'"rhubarb":"1.14'* && "$health" != *'"espeak":"indispon'* ]]; then
    pass "Voz de teste (espeak-ng) e Rhubarb 1.14 instalados no worker-media"
  else
    fail "espeak-ng ou Rhubarb indisponível no worker-media"
  fi

  step "2 e 3. Clipe 16:9 do Zeca, renderizado duas vezes"
  saida=$($COMPOSE exec -T agents node_modules/.bin/tsx src/scripts/character-clip.ts --duas-vezes 2>&1)
  echo "$saida"
  R=$(echo "$saida" | grep -E '^\{"resumo"' | tail -1)
  [[ -z "$R" ]] && R='{"resumo":{}}'
  if [[ "$(field "$R" ok)" == "true" ]]; then
    pass "Clipe de $(field "$R" segundos | cut -c1-4) s em $(field "$R" largura)x$(field "$R" altura), render em $(field "$R" renderSegundos) s"
  else
    fail "O clipe não foi gerado: $(field "$R" erro)"
  fi
  nexp=$(field "$R" expressoes len)
  nbocas=$(field "$R" bocas len)
  trocas=$(field "$R" trocasDeBoca)
  if (( ${nexp:-0} >= 3 )); then pass "Expressões no clipe: $(field "$R" expressoes)"; else fail "Menos de 3 expressões ($(field "$R" expressoes))"; fi
  if (( ${nbocas:-0} >= 3 && ${trocas:-0} >= 10 )); then
    pass "Boca sincronizada pelo Rhubarb: formas $(field "$R" bocas), $trocas trocas"
  else
    fail "Boca quase parada (formas $(field "$R" bocas), trocas ${trocas:-0})"
  fi
  if [[ "$(field "$R" identicos)" == "true" ]]; then
    pass "Dois renders do mesmo clipe: $(field "$R" quadros) quadros com hash idêntico"
  else
    fail "Os dois renders não deram quadros idênticos"
  fi
  video=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("resumo",{}).get("video",""))' "$R")
  if [[ -n "$video" ]] && $COMPOSE cp "render:/data/work/$video" "$VIDEO_OUT" >/dev/null 2>&1; then
    echo "Vídeo copiado para $(pwd)/$VIDEO_OUT"
  fi

  step "4. Short (9:16)"
  vert=$($COMPOSE exec -T agents node_modules/.bin/tsx src/scripts/character-clip.ts --vertical 2>&1)
  echo "$vert" | tail -4
  V=$(echo "$vert" | grep -E '^\{"resumo"' | tail -1)
  [[ -z "$V" ]] && V='{"resumo":{}}'
  if [[ "$(field "$V" ok)" == "true" && "$(field "$V" altura)" -gt "$(field "$V" largura)" ]]; then
    pass "Short 9:16 renderizado ($(field "$V" largura)x$(field "$V" altura))"
  else
    fail "O Short 9:16 não renderizou"
  fi

  step "5. Testes"
  if make test; then pass "Lint, tipos e testes (unitários + integração) passam"; else fail "make test falhou"; fi
  if make e2e; then pass "Painel no navegador (e2e), incluindo gerar clipe e a bíblia"; else fail "make e2e falhou"; fi
  make test-down >/dev/null 2>&1 || true

  printf '\n\033[1mResultado da Fase 2\033[0m\n'
  printf '  %s\n' "${RESULTS[@]}"
  return "$FAILED"
}

run 2>&1 | tee "$OUT"
code=${PIPESTATUS[0]}
echo ""
echo "Relatório salvo em $(pwd)/$OUT"
# No WSL, deixa cópias na Área de Trabalho do Windows (relatório e o vídeo do Zeca).
if command -v powershell.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
  desk=$(powershell.exe -NoProfile -Command '[Environment]::GetFolderPath("Desktop")' 2>/dev/null | tr -d '\r')
  if [[ -n "$desk" ]]; then
    wdesk=$(wslpath -u "$desk")
    cp "$OUT" "$wdesk/" 2>/dev/null && echo "Cópia na Área de Trabalho do Windows: $desk\\$OUT"
    [[ -f "$VIDEO_OUT" ]] && cp "$VIDEO_OUT" "$wdesk/" 2>/dev/null && echo "Vídeo do Zeca na Área de Trabalho: $desk\\$VIDEO_OUT"
  fi
fi
exit "$code"
