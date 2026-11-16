#!/usr/bin/env bash
# Critérios de aceite da Fase 3 (Notícias em vídeo), rodados no notebook:
#  1. a pilha sobe (Biblioteca no S3, render com as composições novas)
#  2. uma história da Pauta vira Short 9:16 e vídeo longo 16:9, com 3 thumbnails cada,
#     aprovados pelo Revisor visual (modo simulado: roteiro, imagens e voz de teste)
#  3. o mesmo vídeo renderizado 2 vezes tem todos os quadros idênticos
#  4. o render recusa mídia sem direitos (manifesto revogado)
#  5. relatório de tempo, CPU e memória por render, com estimativa para a VPS
#  6. custo por vídeo × orçamento de US$ 50: com REAL=1, produz 1 Short e 1 longo de verdade
#     (Claude, imagens e voz do Google; custa ~US$ 1 e respeita o teto); sem REAL=1, estimativa
#  7. testes (unitários, integração e e2e)
# Vídeos e thumbnails vão para a Área de Trabalho do Windows (radar-neon-fase3-*).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

COMPOSE="docker compose -f infra/docker-compose.yml ${COMPOSE_EXTRA:-} --env-file .env"
OUT=${ACCEPT_OUT:-radar-neon-aceite-fase-3.txt}
COPIES=()

run() {
  declare -a RESULTS=()
  FAILED=0
  pass() { RESULTS+=("✅ $1"); }
  fail() { RESULTS+=("❌ $1"); FAILED=1; }
  info() { RESULTS+=("ℹ️  $1"); }
  step() { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }
  # last_json <saída> <chave>: último JSON da saída que tem a chave
  last_json() { echo "$1" | grep -E "^\{\"$2\"" | tail -1; }
  # get <json> <expressão python sobre d>
  get() { python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$1" "$2" 2>/dev/null; }
  produce() { $COMPOSE exec -T agents node_modules/.bin/tsx src/scripts/produce.ts "$@" 2>&1; }
  copy_out() { # <arquivo na pasta de trabalho> <nome local>
    if [[ -n "$1" && "$1" != "None" ]] && $COMPOSE cp "render:/data/work/$1" "$2" >/dev/null 2>&1; then
      COPIES+=("$2")
    fi
  }

  step "1. make up"
  if make up; then pass "Pilha do notebook no ar (make up)"; else fail "make up falhou"; fi

  step "2a. História da Pauta → Short 9:16 (simulado)"
  s=$(produce --formato=SHORT)
  if [[ "$s" == *"nenhuma história pode virar vídeo"* ]]; then
    echo "Sem história disponível: coletando notícias agora..."
    make coletar >/dev/null 2>&1 || true
    s=$(produce --formato=SHORT)
  fi
  echo "$s" | grep -v '^{' | tail -15
  S=$(last_json "$s" producao)
  [[ -z "$S" ]] && S='{"producao":{}}'
  short_id=$(get "$S" 'd["producao"].get("id","")')
  if [[ "$(get "$S" 'd["producao"].get("status")')" == "READY" ]]; then
    w=$(get "$S" 'd["producao"]["renderReport"][-1]["video"]["width"]')
    h=$(get "$S" 'd["producao"]["renderReport"][-1]["video"]["height"]')
    nt=$(get "$S" 'len(d["producao"]["thumbnails"])')
    if (( h > w )) && [[ "$nt" == "3" ]]; then
      pass "Short ${w}x${h} com 3 thumbnails, aprovado pelo Revisor ($(get "$S" 'd["producao"]["rounds"]') volta)"
    else
      fail "Short fora do formato (${w}x${h}, $nt thumbnails)"
    fi
    copy_out "$(get "$S" 'd["producao"]["video"]')" radar-neon-fase3-short.mp4
    copy_out "$(get "$S" 'd["producao"]["thumbnail"]')" radar-neon-fase3-short-thumb.png
  else
    fail "Short não ficou pronto: $(get "$S" 'd["producao"].get("status")') $(get "$S" 'd["producao"].get("error")')"
  fi

  step "2b. Vídeo longo 16:9 (simulado)"
  l=$(produce --formato=LONG)
  echo "$l" | grep -v '^{' | tail -15
  L=$(last_json "$l" producao)
  [[ -z "$L" ]] && L='{"producao":{}}'
  if [[ "$(get "$L" 'd["producao"].get("status")')" == "READY" ]]; then
    w=$(get "$L" 'd["producao"]["renderReport"][-1]["video"]["width"]')
    h=$(get "$L" 'd["producao"]["renderReport"][-1]["video"]["height"]')
    if (( w > h )) && [[ "$(get "$L" 'len(d["producao"]["thumbnails"])')" == "3" ]]; then
      pass "Longo ${w}x${h} com 3 thumbnails, aprovado pelo Revisor"
    else
      fail "Longo fora do formato (${w}x${h})"
    fi
    copy_out "$(get "$L" 'd["producao"]["video"]')" radar-neon-fase3-longo.mp4
    copy_out "$(get "$L" 'd["producao"]["thumbnail"]')" radar-neon-fase3-longo-thumb.png
  else
    fail "Longo não ficou pronto: $(get "$L" 'd["producao"].get("status")') $(get "$L" 'd["producao"].get("error")')"
  fi

  step "3. Render repetível (Short renderizado de novo)"
  if [[ -n "$short_id" ]]; then
    r=$(produce --repetir="$short_id")
    echo "$r" | tail -3
    R=$(last_json "$r" repetir)
    if [[ "$(get "$R" 'd["repetir"]["allIdentical"]')" == "True" ]]; then
      pass "Dois renders do mesmo vídeo: $(get "$R" 'd["repetir"]["frames"]') quadros idênticos"
    else
      fail "Os dois renders deram quadros diferentes ($(get "$R" 'd["repetir"].get("identical")') de $(get "$R" 'd["repetir"].get("frames")'))"
    fi
  else
    fail "Sem Short pronto para repetir o render"
  fi

  step "4. Render recusa mídia sem direitos"
  t=$(produce --teste-direitos)
  echo "$t" | tail -3
  T=$(last_json "$t" direitos)
  if [[ "$(get "$T" 'd["direitos"]["refused"]')" == "True" ]]; then
    pass "Mídia com manifesto revogado: render recusado ($(get "$T" 'd["direitos"]["error"]' | cut -c1-90))"
  else
    fail "O render não recusou a mídia sem direitos"
  fi

  step "5. Tempo, CPU e memória por render"
  for J in "$S" "$L"; do
    rep=$(python3 - "$J" <<'PY' 2>/dev/null
import json, sys
v = json.loads(sys.argv[1])["producao"]["renderReport"][-1]["video"]
cpu = v.get("cpuSeconds", 0)
secs = max(v["seconds"], 0.1)
# O render roda 1 por vez e usa ~1 núcleo: na VPS o tempo fica parecido com o do notebook
# (vCPU de nuvem costuma ser até ~40% mais lenta que um núcleo do i7), não dividido por 4.
print(
    f"{v['width']}x{v['height']}: {secs:.0f} s de render, {v['frames']} quadros, "
    f"CPU {cpu:.0f} s (~{cpu / secs:.1f} núcleo em média), pico {v.get('peakMemoryMb', 0)} MB "
    f"({v.get('metricsSource', '?')}); na VPS: ~{secs:.0f} a {secs * 1.4:.0f} s"
)
PY
)
    [[ -n "$rep" ]] && info "Render $rep"
  done

  step "6. Custo por vídeo × orçamento"
  if [[ "${REAL:-0}" == "1" ]]; then
    rs=$(produce --formato=SHORT --real); echo "$rs" | grep -v '^{' | tail -12
    rl=$(produce --formato=LONG --real); echo "$rl" | grep -v '^{' | tail -12
    RS=$(last_json "$rs" producao); RL=$(last_json "$rl" producao)
    cs=$(get "$RS" 'd["producao"]["costUsd"]'); cl=$(get "$RL" 'd["producao"]["costUsd"]')
    if [[ "$(get "$RS" 'd["producao"]["status"]')" == "READY" && "$(get "$RL" 'd["producao"]["status"]')" == "READY" ]]; then
      month=$(python3 -c "print(f'{($cl + 4*$cs)*30:.2f}')")
      pass "Custo real: Short US\$ $cs, longo US\$ $cl → ritmo padrão (1 longo + 4 Shorts/dia) ≈ US\$ $month/mês (teto US\$ 50)"
      copy_out "$(get "$RS" 'd["producao"]["video"]')" radar-neon-fase3-short-REAL.mp4
      copy_out "$(get "$RL" 'd["producao"]["video"]')" radar-neon-fase3-longo-REAL.mp4
      copy_out "$(get "$RL" 'd["producao"]["thumbnail"]')" radar-neon-fase3-longo-REAL-thumb.png
    else
      fail "Produção real não ficou pronta: Short $(get "$RS" 'd["producao"].get("status")') $(get "$RS" 'd["producao"].get("error")') · Longo $(get "$RL" 'd["producao"].get("status")') $(get "$RL" 'd["producao"].get("error")')"
    fi
  else
    info "Custo real não medido (rode com REAL=1). Estimativa pela tabela: Short ≈ US\$ 0,10, longo ≈ US\$ 0,35 → ≈ US\$ 22/mês no ritmo padrão (Imagen 4 Fast, Sonnet 5.5, voz na cota grátis)"
  fi

  step "7. Testes"
  if make test; then pass "Lint, tipos e testes (unitários + integração) passam"; else fail "make test falhou"; fi
  if make e2e; then pass "Painel no navegador (e2e): Biblioteca, Arte e produção de um Short"; else fail "make e2e falhou"; fi
  make test-down >/dev/null 2>&1 || true

  printf '\n\033[1mResultado da Fase 3\033[0m\n'
  printf '  %s\n' "${RESULTS[@]}"
  return "$FAILED"
}

run 2>&1 | tee "$OUT"
code=${PIPESTATUS[0]}
echo ""
echo "Relatório salvo em $(pwd)/$OUT"
if command -v powershell.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
  desk=$(powershell.exe -NoProfile -Command '[Environment]::GetFolderPath("Desktop")' 2>/dev/null | tr -d '\r')
  if [[ -n "$desk" ]]; then
    wdesk=$(wslpath -u "$desk")
    cp "$OUT" "$wdesk/" 2>/dev/null && echo "Cópia na Área de Trabalho do Windows: $desk\\$OUT"
    for f in radar-neon-fase3-*; do
      [[ -f "$f" ]] && cp "$f" "$wdesk/" 2>/dev/null && echo "Na Área de Trabalho: $desk\\$f"
    done
  fi
fi
exit "$code"
