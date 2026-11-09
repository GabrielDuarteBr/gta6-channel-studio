#!/usr/bin/env bash
# Cria o .env a partir do .env.example, gerando senhas e chaves fortes.
# Seguro para rodar de novo: não sobrescreve um .env existente.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  echo "✅ .env já existe — nada a fazer. (Para recomeçar: apague o .env com cuidado e rode de novo.)"
  chmod 600 .env
  exit 0
fi

command -v openssl >/dev/null || { echo "❌ openssl não encontrado. Rode: sudo apt install -y openssl"; exit 1; }

hex() { openssl rand -hex "$1"; }
b64() { openssl rand -base64 "$1" | tr -d '\n'; }

umask 077
cp .env.example .env

# Cada linha "NOME=__GERAR__" recebe um valor próprio.
declare -A values=(
  [POSTGRES_PASSWORD]="$(hex 24)"
  [REDIS_PASSWORD]="$(hex 24)"
  [S3_ACCESS_KEY]="studio$(hex 6)"
  [S3_SECRET_KEY]="$(hex 24)"
  [AUTH_SECRET]="$(b64 48)"
  [TOKEN_ENCRYPTION_KEY]="$(b64 32)"
)
for key in "${!values[@]}"; do
  value="${values[$key]}"
  # Delimitador | (os valores base64 podem conter /).
  sed -i "s|^${key}=__GERAR__$|${key}=${value}|" .env
done

if grep -q "__GERAR__" .env; then
  echo "❌ Ficou algum __GERAR__ sem valor no .env. Confira o .env.example."
  exit 1
fi
chmod 600 .env
echo "✅ .env criado com senhas e chaves novas (permissão 600). Ele NUNCA vai para o Git."
