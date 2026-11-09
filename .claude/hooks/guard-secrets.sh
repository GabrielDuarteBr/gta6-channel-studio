#!/usr/bin/env bash
# Hook PreToolUse (Bash): bloqueia commits/adds de .env e de arquivos com segredos.
# Entrada: JSON do Claude Code no stdin. Saída 2 = bloqueia e mostra o motivo ao Claude.
set -euo pipefail
input=$(cat)
cmd=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.command??"")}catch{}})')

# Só interessa git add/commit.
if ! grep -Eq '(^|[;&|[:space:]])git[[:space:]]+(add|commit)' <<<"$cmd"; then exit 0; fi

# 1) .env (exceto .env.example) citado explicitamente
if grep -Eq '(^|[[:space:]/])\.env(\.[A-Za-z0-9_-]+)?([[:space:]]|$)' <<<"$cmd" && ! grep -Eq '\.env\.example' <<<"$cmd"; then
  echo "Bloqueado: .env contém segredos e nunca vai para o Git." >&2
  exit 2
fi

# 2) No commit, confere o que está staged
if grep -Eq 'git[[:space:]]+commit' <<<"$cmd"; then
  staged=$(git diff --cached --name-only 2>/dev/null || true)
  if grep -Eq '(^|/)\.env(\.[^/]*)?$' <<<"$staged" && ! grep -Eq '(^|/)\.env\.example$' <<<"$staged"; then
    echo "Bloqueado: há um .env staged. Rode 'git restore --staged <arquivo>'." >&2
    exit 2
  fi
  if command -v gitleaks >/dev/null 2>&1; then
    if ! gitleaks protect --staged --redact --no-banner --config .gitleaks.toml >/dev/null 2>&1; then
      echo "Bloqueado: gitleaks encontrou possível segredo nos arquivos staged (rode 'gitleaks protect --staged -v')." >&2
      exit 2
    fi
  else
    # Varredura simples de padrões conhecidos no diff staged
    if git diff --cached -U0 2>/dev/null | grep -E '^\+' | grep -Eq 'sk-ant-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}'; then
      echo "Bloqueado: o diff staged parece conter uma chave ou token." >&2
      exit 2
    fi
  fi
fi
exit 0
