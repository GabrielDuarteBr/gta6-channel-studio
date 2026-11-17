#!/usr/bin/env bash
# Critérios de aceite da Fase 4 (Parceiros e react), rodados no notebook:
#  1. a pilha sobe (worker-media com o faster-whisper e o modelo Whisper dentro da imagem)
#  2. parceiro de teste com permissão + arquivo: importado para a Biblioteca (S3 + manifesto
#     ligado à permissão) e analisado (transcrição, trechos de fala, música, cenas)
#  3. link do YouTube recusado na importação (regra 1)
#  4. Short de react dentro dos limites: clipe ≤ 50% (padrão 45%), comentário com conteúdo
#     ≥ 50%, clipe pausado nos comentários, crédito e condições na descrição (modo simulado)
#  5. o mesmo react renderizado 2 vezes tem todos os quadros idênticos
#  6. sem permissão ativa o pipeline para (3ª camada)
#  7. Caçador de parceiros (só com YOUTUBE_API_KEY): candidatos com rascunho, nada enviado
#  8. custo real por react (REAL=1: Comentarista e Revisor com o Claude, voz do Google)
#  9. testes (unitários, integração e e2e)
# O vídeo vai para a Área de Trabalho do Windows (radar-neon-fase4-*).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

COMPOSE="docker compose -f infra/docker-compose.yml ${COMPOSE_EXTRA:-} --env-file .env"
OUT=${ACCEPT_OUT:-radar-neon-aceite-fase-4.txt}
FIXTURE=e2e/fixtures/parceiro-teste.mp4

run() {
  declare -a RESULTS=()
  FAILED=0
  pass() { RESULTS+=("✅ $1"); }
  fail() { RESULTS+=("❌ $1"); FAILED=1; }
  info() { RESULTS+=("ℹ️  $1"); }
  step() { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }
  last_json() { echo "$1" | grep -E "^\{\"$2\"" | tail -1; }
  get() { python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$1" "$2" 2>/dev/null; }
  react() { $COMPOSE exec -T agents node_modules/.bin/tsx src/scripts/react.ts "$@" 2>&1; }
  copy_out() { # <arquivo na pasta de trabalho> <nome local>
    if [[ -n "$1" && "$1" != "None" ]] && $COMPOSE cp "render:/data/work/$1" "$2" >/dev/null 2>&1; then
      COPIES+=("$2")
    fi
  }
  COPIES=()

  step "1. make up"
  if make up; then pass "Pilha do notebook no ar (make up)"; else fail "make up falhou"; fi
  w=$($COMPOSE exec -T worker-media python -c 'import urllib.request,json;print(json.load(urllib.request.urlopen("http://127.0.0.1:4300/health"))["whisper"])' 2>/dev/null | tr -d '\r')
  if [[ "$w" == small* ]]; then pass "Worker de mídia com o faster-whisper ($w)"; else fail "faster-whisper indisponível no worker-media ($w)"; fi

  step "2. Parceiro de teste + arquivo → Biblioteca e análise"
  $COMPOSE exec -T agents mkdir -p /data/work/aceite >/dev/null 2>&1
  if $COMPOSE cp "$FIXTURE" agents:/data/work/aceite/parceiro-teste.mp4 >/dev/null 2>&1; then
    p=$(react --preparar=/data/work/aceite/parceiro-teste.mp4)
    echo "$p" | grep -v '^{' | tail -8
    P=$(last_json "$p" preparar)
    if [[ -n "$P" && "$(get "$P" 'd["preparar"]["segments"] > 0')" == "True" ]]; then
      pass "Vídeo do parceiro importado (S3 + manifesto da permissão) e analisado: $(get "$P" 'd["preparar"]["segments"]') trecho(s) de fala ($(get "$P" 'd["preparar"]["language"]')), $(get "$P" 'd["preparar"]["scenes"]') troca(s) de cena, $(get "$P" 'd["preparar"]["model"]')"
    else
      fail "Importação/análise do vídeo de teste falhou: $(echo "$p" | tail -2 | tr '\n' ' ')"
    fi
  else
    fail "Não consegui copiar o vídeo de teste para o container"
  fi

  step "3. Link do YouTube é recusado"
  y=$(react --youtube); echo "$y" | tail -2
  Y=$(last_json "$y" youtube)
  if [[ "$(get "$Y" 'd["youtube"]["refused"]')" == "True" ]]; then pass "Importar do YouTube: recusado (regra 1)"; else fail "O link do YouTube não foi recusado"; fi

  step "4. Short de react (simulado)"
  r=$(react --produzir); echo "$r" | grep -v '^{' | tail -14
  R=$(last_json "$r" react)
  [[ -z "$R" ]] && R='{"react":{}}'
  react_id=$(get "$R" 'd["react"].get("id","")')
  if [[ "$(get "$R" 'd["react"].get("status")')" == "READY" ]]; then
    cr=$(get "$R" 'round(d["react"]["clipRatio"]*100)'); mr=$(get "$R" 'round(d["react"]["commentRatio"]*100)')
    desc_ok=$(get "$R" '"Clipe: Parceiro de Teste" in d["react"]["description"] and "#parceirodeteste" in d["react"]["description"]')
    paused=$(get "$R" 'd["react"]["blocks"][0] == "comment" and all(a != b or a == "comment" for a, b in zip(d["react"]["blocks"], d["react"]["blocks"][1:]))')
    if (( cr <= 50 && mr >= 50 )) && [[ "$desc_ok" == "True" && "$paused" == "True" ]]; then
      pass "Short de react pronto: clipe ${cr}% · comentário ${mr}% · clipe pausado nos comentários · crédito, link e hashtag na descrição · monetização: $(get "$R" 'd["react"]["monetization"]') (condição do parceiro)"
    else
      fail "React fora dos limites (clipe ${cr}%, comentário ${mr}%, descrição ok=$desc_ok, pausa ok=$paused)"
    fi
    copy_out "$(get "$R" 'd["react"]["video"]')" radar-neon-fase4-react.mp4
  else
    fail "React não ficou pronto: $(get "$R" 'd["react"].get("status")') $(get "$R" 'd["react"].get("error")')"
  fi

  step "5. Render repetível"
  if [[ -n "$react_id" ]]; then
    t=$(react --repetir="$react_id"); echo "$t" | tail -2
    T=$(last_json "$t" repetir)
    if [[ "$(get "$T" 'd["repetir"]["allIdentical"]')" == "True" ]]; then
      pass "Dois renders do mesmo react: $(get "$T" 'd["repetir"]["frames"]') quadros idênticos"
    else
      fail "Os dois renders deram quadros diferentes ($(get "$T" 'd["repetir"].get("identical")') de $(get "$T" 'd["repetir"].get("frames")'))"
    fi
  else
    fail "Sem react pronto para repetir o render"
  fi

  step "6. Sem permissão ativa o pipeline para"
  s=$(react --sem-permissao); echo "$s" | tail -2
  S=$(last_json "$s" semPermissao)
  if [[ "$(get "$S" 'd["semPermissao"]["refused"]')" == "True" ]]; then
    pass "Permissão suspensa: produção parada ($(get "$S" 'd["semPermissao"]["error"]' | cut -c1-90))"
  else
    fail "O pipeline não parou sem permissão"
  fi

  step "7. Caçador de parceiros"
  c=$(react --cacador); echo "$c" | tail -2
  C=$(last_json "$c" cacador)
  if [[ -n "$(get "$C" 'd["cacador"].get("skipped") or ""')" ]]; then
    info "Caçador não rodou: $(get "$C" 'd["cacador"]["skipped"]') (ele roda toda semana quando a chave do YouTube estiver no .env)"
  elif [[ -n "$C" ]]; then
    pass "Caçador: $(get "$C" 'd["cacador"]["found"]') canal(is) lido(s), $(get "$C" 'd["cacador"]["created"]') candidato(s) novo(s) com rascunho de mensagem (nada foi enviado) — veja em Parceiros"
  else
    fail "Caçador falhou: $(echo "$c" | tail -1)"
  fi

  step "8. Custo real por Short de react"
  rep=$(python3 - "$R" <<'PY' 2>/dev/null
import json, sys
v = json.loads(sys.argv[1])["react"]["renderReport"][-1]["video"]
cpu = v.get("cpuSeconds", 0)
secs = max(v["seconds"], 0.1)
print(f"{v['width']}x{v['height']}: {secs:.0f} s de render, {v['frames']} quadros, CPU {cpu:.0f} s, pico {v.get('peakMemoryMb', 0)} MB; na VPS: ~{secs:.0f} a {secs * 1.4:.0f} s")
PY
)
  [[ -n "$rep" ]] && info "Render do react $rep"
  if [[ "${REAL:-0}" == "1" ]]; then
    rr=$(react --produzir --real); echo "$rr" | grep -v '^{' | tail -10
    RR=$(last_json "$rr" react)
    if [[ "$(get "$RR" 'd["react"]["status"]')" == "READY" ]]; then
      cost=$(get "$RR" '("R$ %.2f" % d["react"]["costBrl"]).replace(".", ",")')
      pass "React real pronto: custo ${cost} (Comentarista + Revisor + voz)"
      copy_out "$(get "$RR" 'd["react"]["video"]')" radar-neon-fase4-react-REAL.mp4
    else
      fail "React real não ficou pronto: $(get "$RR" 'd["react"].get("status")') $(get "$RR" 'd["react"].get("error")')"
    fi
  else
    info "Custo real não medido (rode com REAL=1). Estimativa: ≈ R\$ 0,50 por Short de react (Comentarista e Revisor com Sonnet 5.5; transcrição local e grátis; voz na cota grátis)"
  fi

  step "9. Testes"
  if make test; then pass "Lint, tipos e testes (unitários + integração + Python com o Whisper)"; else fail "make test falhou"; fi
  if make e2e; then pass "Painel no navegador (e2e): Parceiros, permissão, envio, análise e Short de react"; else fail "make e2e falhou"; fi
  make test-down >/dev/null 2>&1 || true

  printf '\n\033[1mResultado da Fase 4\033[0m\n'
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
    for f in radar-neon-fase4-*; do
      [[ -f "$f" ]] && cp "$f" "$wdesk/" 2>/dev/null && echo "Na Área de Trabalho: $desk\\$f"
    done
  fi
fi
exit "$code"
