#!/usr/bin/env bash
# Hook PostToolUse (Edit|Write): formata o arquivo editado e roda o lint dele.
# Rápido de propósito: só o arquivo tocado. Testes completos ficam com `make test`/CI.
set -uo pipefail
input=$(cat)
file=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.file_path??"")}catch{}})')
[[ -z "$file" || ! -f "$file" ]] && exit 0
root=$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0

case "$file" in
  *.ts|*.tsx|*.mjs|*.js|*.json|*.css|*.yml|*.yaml)
    [[ -x node_modules/.bin/prettier ]] && node_modules/.bin/prettier --write --log-level warn "$file" >/dev/null 2>&1
    if [[ "$file" =~ \.(ts|tsx|mjs|js)$ && -x node_modules/.bin/eslint ]]; then
      if ! out=$(node_modules/.bin/eslint --max-warnings=0 "$file" 2>&1); then
        echo "$out" | tail -20 >&2
        exit 2 # mostra os problemas de lint ao Claude
      fi
    fi
    ;;
  *.py)
    if command -v uv >/dev/null 2>&1; then
      (cd apps/worker-media && uv run --quiet ruff format "$file" >/dev/null 2>&1 && uv run --quiet ruff check "$file" >&2) || exit 2
    fi
    ;;
esac
exit 0
