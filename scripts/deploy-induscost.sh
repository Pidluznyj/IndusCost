#!/usr/bin/env bash
# Alias operacional para deploy em produção (/opt/induscost).
# Uso: cd /opt/induscost && bash scripts/deploy-induscost.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/deploy-server-main-update.sh" "$@"
