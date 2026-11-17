#!/usr/bin/env bash
# Critérios de aceite da etapa final (Fases 5–7: Conformidade, publicação, métricas, Comando e
# produção diária), rodados no notebook:
#  1. a pilha sobe (make up)
#  2. um vídeo pronto (Short simulado, pela fila)
#  3. Conformidade → aprovação → envio SIMULADO: descrição com fontes e aviso de IA, agendado
#  4. Conformidade reprovada: o envio é recusado no banco (3ª camada)
#  5. Comando: o Diretor responde usando as ferramentas
#  6. produção diária (só no modo simulado: não gasta)
#  7. YouTube: conexão, canal e métricas (só leitura). ENVIAR=1: envio REAL de teste,
#     PRIVADO e agendado para daqui a 30 dias (apague depois no YouTube Studio)
#  8. testes (unitários, integração e e2e)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

COMPOSE="docker compose -f infra/docker-compose.yml ${COMPOSE_EXTRA:-} --env-file .env"
OUT=${ACCEPT_OUT:-radar-neon-aceite-etapa-final.txt}

run() {
  declare -a RESULTS=()
  FAILED=0
  pass() { RESULTS+=("✅ $1"); }
  fail() { RESULTS+=("❌ $1"); FAILED=1; }
  info() { RESULTS+=("ℹ️  $1"); }
  step() { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }
  last_json() { echo "$1" | grep -E "^\{\"$2\"" | tail -1; }
  get() { python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$1" "$2" 2>/dev/null; }
  pub() { $COMPOSE exec -T agents node_modules/.bin/tsx src/scripts/publish.ts "$@" 2>&1; }

  step "1. make up"
  if make up; then pass "Pilha do notebook no ar (make up)"; else fail "make up falhou"; fi

  step "2. Vídeo pronto para aprovar"
  p=$($COMPOSE exec -T agents node_modules/.bin/tsx src/scripts/produce.ts --formato=SHORT 2>&1)
  echo "$p" | grep -v '^{' | tail -6
  P=$(last_json "$p" producao)
  if [[ "$(get "$P" 'd["producao"].get("status")')" == "READY" ]]; then
    pass "Short simulado pronto (roteiro, voz, render e Revisor)"
  else
    fail "O vídeo de teste não ficou pronto: $(get "$P" 'd["producao"].get("status")') $(get "$P" 'd["producao"].get("error")')"
  fi

  step "3. Conformidade → aprovação → envio simulado"
  f=$(pub --fluxo); echo "$f" | tail -2
  F=$(last_json "$f" fluxo)
  if [[ "$(get "$F" 'd["fluxo"].get("complianceOk")')" == "True" && "$(get "$F" 'd["fluxo"].get("status")')" == "SCHEDULED" ]]; then
    pass "Conformidade aprovou (fontes na descrição: $(get "$F" 'd["fluxo"]["hasSources"]'), aviso de IA: $(get "$F" 'd["fluxo"]["hasAiNotice"]')) e o envio simulado ficou agendado para $(get "$F" 'd["fluxo"]["publishAt"]') — veja em Aprovação e Calendário"
  elif [[ "$(get "$F" 'd["fluxo"].get("complianceOk")')" == "False" ]]; then
    fail "Conformidade reprovou o vídeo de teste: $(get "$F" '"; ".join(d["fluxo"]["failed"])')"
  else
    fail "Fluxo de publicação falhou: $(get "$F" 'd["fluxo"].get("error") or d["fluxo"].get("status")')"
  fi

  step "4. Reprovado pela Conformidade não sobe"
  b=$(pub --bloqueio); echo "$b" | tail -1
  B=$(last_json "$b" bloqueio)
  if [[ "$(get "$B" 'd["bloqueio"]["refused"]')" == "True" ]]; then
    pass "Envio recusado no banco (3ª camada): $(get "$B" 'd["bloqueio"]["error"]' | cut -c1-90)"
  else
    fail "O envio de um vídeo reprovado não foi recusado"
  fi

  step "5. Comando (chat com o Diretor)"
  c=$(pub --comando); echo "$c" | tail -1
  C=$(last_json "$c" comando)
  if [[ "$(get "$C" 'd["comando"]["state"]')" == "pronto" && "$(get "$C" '"ver_pauta" in d["comando"]["tools"]')" == "True" ]]; then
    pass "Diretor respondeu usando a ferramenta ver_pauta (abra Comando no painel para conversar)"
  else
    fail "O Diretor não respondeu: $(get "$C" 'd["comando"]')"
  fi

  step "6. Produção diária"
  d=$(pub --diaria); echo "$d" | tail -1
  D=$(last_json "$d" diaria)
  if [[ -n "$(get "$D" 'd["diaria"].get("skipped") or ""')" ]]; then
    info "Produção diária não testada agora: $(get "$D" 'd["diaria"]["skipped"]')"
  elif [[ "$(get "$D" 'd["diaria"]["ran"]')" == "True" ]]; then
    pass "Produção diária rodou: $(get "$D" 'd["diaria"]["created"]') vídeo(s) na fila (simulados). Automática todo dia às $(get "$D" 'd["diaria"]["time"]') (Brasília)"
  else
    fail "A produção diária não rodou"
  fi

  step "7. YouTube"
  if [[ "${ENVIAR:-0}" == "1" ]]; then y=$(pub --youtube --enviar); else y=$(pub --youtube); fi
  echo "$y" | tail -1
  Y=$(last_json "$y" youtube)
  if [[ -n "$(get "$Y" 'd["youtube"].get("skipped") or ""')" ]]; then
    info "YouTube: $(get "$Y" 'd["youtube"]["skipped"]'). Sem conexão, aprovar gera o pacote manual para o YouTube Studio"
  elif [[ -n "$Y" ]]; then
    pass "YouTube conectado: canal $(get "$Y" 'd["youtube"]["channel"]'); métricas: $(get "$Y" 'd["youtube"]["metrics"]')"
    if [[ "${ENVIAR:-0}" == "1" ]]; then
      if [[ "$(get "$Y" 'd["youtube"]["upload"]["status"]')" == "SCHEDULED" ]]; then
        pass "Envio real de teste: vídeo $(get "$Y" 'd["youtube"]["upload"]["videoId"]') PRIVADO, agendado para $(get "$Y" 'd["youtube"]["upload"]["publishAt"]'). Apague no YouTube Studio depois de conferir"
      else
        fail "Envio real falhou: $(get "$Y" 'd["youtube"]["upload"]')"
      fi
    else
      info "Envio real não testado (rode com ENVIAR=1: sobe um vídeo PRIVADO agendado para daqui a 30 dias)"
    fi
  else
    fail "Conferência do YouTube falhou: $(echo "$y" | tail -1)"
  fi

  step "8. Testes"
  if make test; then pass "Lint, tipos e testes (unitários + integração)"; else fail "make test falhou"; fi
  if make e2e; then pass "Painel no navegador (e2e): Aprovação, Calendário, Comando, Configurações e Visão geral"; else fail "make e2e falhou"; fi
  make test-down >/dev/null 2>&1 || true

  printf '\n\033[1mResultado da etapa final\033[0m\n'
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
    cp "$OUT" "$(wslpath -u "$desk")/" 2>/dev/null && echo "Cópia na Área de Trabalho do Windows: $desk\\$OUT"
  fi
fi
exit "$code"
