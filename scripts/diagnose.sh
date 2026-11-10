#!/usr/bin/env bash
# Mostra por que algum serviço não ficou saudável: estado, último teste de saúde e logs.
# Uso: bash scripts/diagnose.sh [arquivo-compose] [arquivo-env]
set -uo pipefail
cd "$(dirname "$0")/.."
compose_file=${1:-infra/docker-compose.yml}
env_file=${2:-.env}
dc() { docker compose -f "$compose_file" --env-file "$env_file" "$@"; }

echo
echo "================= DIAGNÓSTICO (mande isto para o Claude) ================="
dc ps -a --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
for svc in $(dc ps -a --services 2>/dev/null); do
  cid=$(dc ps -a -q "$svc" 2>/dev/null | head -1)
  [[ -z "$cid" ]] && continue
  state=$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null)
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null)
  exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$cid" 2>/dev/null)
  # migrate termina com 0 de propósito; o resto deve estar running/healthy
  if [[ "$svc" == "migrate" && "$exit_code" == "0" ]]; then continue; fi
  if [[ "$state" == "running" && ( -z "$health" || "$health" == "healthy" ) ]]; then continue; fi
  echo
  echo "----- $svc: estado=$state saúde=${health:-sem teste} código=$exit_code -----"
  if [[ -n "$health" ]]; then
    echo "Último teste de saúde:"
    docker inspect -f '{{range .State.Health.Log}}{{.ExitCode}}: {{.Output}}{{end}}' "$cid" 2>/dev/null | tail -c 1500
  fi
  echo "Proxy visto pelo container: $(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$cid" 2>/dev/null | grep -iE '^(https?|no)_proxy=' | sed -E 's#(://)[^@/]*@#\1***@#' | tr '\n' ' ')"
  echo "Últimas linhas do log:"
  dc logs --no-color --tail=40 "$svc" 2>&1
done
echo "=========================================================================="
