#!/usr/bin/env bash
# Checagem do ambiente do notebook (Ubuntu no WSL 2 + Docker Desktop).
# Não altera nada: só mostra o que está certo e o que precisa de ajuste.
set -uo pipefail
cd "$(dirname "$0")/.."

ok() { printf '  ✅ %s\n' "$1"; }
warn() { printf '  ⚠️  %s\n' "$1"; WARN=1; }
fail() { printf '  ❌ %s\n' "$1"; FAIL=1; }
WARN=0
FAIL=0

echo "Radar Neon — checagem do ambiente"
echo

echo "Sistema"
if [[ "${WSL_DISTRO_NAME:-}" == docker-desktop* ]] || [[ "$(hostname)" == docker-desktop* ]]; then
  fail "você está na distro interna do Docker Desktop. Abra o 'Ubuntu 24.04' (menu Iniciar) ou rode 'wsl -d Ubuntu-24.04' no PowerShell."
fi
if grep -qi microsoft /proc/version 2>/dev/null; then
  ok "rodando no WSL ($(. /etc/os-release && echo "$PRETTY_NAME"))"
  if [[ "$(uname -r)" == *WSL2* ]] || grep -qi "wsl2" /proc/version; then ok "WSL 2"; else warn "não confirmei WSL 2 (rode 'wsl -l -v' no PowerShell)"; fi
else
  warn "não parece WSL (ok se for a VPS ou um Linux nativo)"
fi

case "$PWD" in
  /mnt/*) fail "o projeto está em $PWD (disco do Windows). Mova para ~/projetos: é muito mais rápido e os containers enxergam as alterações." ;;
  *) ok "projeto no disco do Linux ($PWD)" ;;
esac

cpus=$(nproc)
mem_gb=$(awk '/MemTotal/ {printf "%.1f", $2/1024/1024}' /proc/meminfo)
echo "  ℹ️  WSL enxerga ${cpus} CPUs e ${mem_gb} GB de RAM"
if awk "BEGIN {exit !($mem_gb < 7.5)}"; then
  warn "menos de 8 GB para o WSL. Ajuste o .wslconfig (veja docs/notebook-setup.md)."
fi

echo
echo "Ferramentas"
for bin in git make curl openssl; do
  command -v "$bin" >/dev/null && ok "$bin" || fail "$bin não instalado (sudo apt install -y $bin)"
done
if command -v docker >/dev/null; then
  ok "docker CLI"
  if docker info >/dev/null 2>&1; then
    ok "Docker respondendo ($(docker info --format '{{.OperatingSystem}}' 2>/dev/null))"
    docker compose version >/dev/null 2>&1 && ok "docker compose $(docker compose version --short)" || fail "docker compose ausente"
    dmem=$(docker info --format '{{.MemTotal}}' 2>/dev/null)
    [[ -n "$dmem" ]] && echo "  ℹ️  Docker pode usar $(awk "BEGIN {printf \"%.1f\", $dmem/1024/1024/1024}") GB"
  else
    fail "Docker não responde. Abra o Docker Desktop e ative a integração com esta distro (Settings → Resources → WSL integration)."
  fi
else
  fail "docker não encontrado. Instale o Docker Desktop no Windows com backend WSL 2."
fi

echo
echo "Repositório"
if git config core.autocrlf | grep -qi true; then
  warn "git core.autocrlf=true: pode converter fim de linha. Rode: git config --global core.autocrlf input"
else
  ok "core.autocrlf não converte para CRLF"
fi
crlf=$(git ls-files --eol 2>/dev/null | awk '$2 ~ /crlf/ {print $NF}' | head -5)
[[ -z "$crlf" ]] && ok "nenhum arquivo com CRLF no checkout" || fail "arquivos com CRLF: $crlf"
[[ -f .env ]] && ok ".env presente ($(stat -c %a .env))" || warn ".env ainda não existe (rode make setup)"

echo
if [[ $FAIL -ne 0 ]]; then echo "Resultado: corrija os itens ❌ antes de 'make up'."; exit 1; fi
if [[ $WARN -ne 0 ]]; then echo "Resultado: dá para seguir, mas veja os ⚠️."; exit 0; fi
echo "Resultado: tudo certo."
