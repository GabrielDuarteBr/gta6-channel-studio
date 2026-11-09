#!/usr/bin/env bash
# =====================================================================
# Bootstrap da VPS (Ubuntu 24.04) — ESBOÇO. Implementado e testado na Fase 8.
#
# Será idempotente e fará:
#   1. usuário "deploy" sem root, no grupo docker, com chave SSH
#   2. SSH só por chave; login por senha e de root desativados
#   3. UFW liberando só 22, 80 e 443 (e lembrando que portas do Docker
#      passam por fora do UFW — por isso só o Caddy publica portas)
#   4. fail2ban, unattended-upgrades (segurança), fuso America/Sao_Paulo
#   5. swap, Docker Engine + Compose plugin (repositório oficial)
#   6. /opt/radar-neon com .env 600 e a unidade systemd radar-neon.service
#
# Regra do projeto: nenhum comando roda na VPS sem ser mostrado ao dono
# antes, e os que alteram o servidor esperam o OK dele.
# =====================================================================
set -euo pipefail
echo "bootstrap-vps.sh é um esboço: será concluído e testado na Fase 8." >&2
exit 1
