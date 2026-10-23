#!/usr/bin/env bash
# Instalação versionada da agenda própria de Pedidos de Compra Nomus.
#
#   installNomusPurchaseOrdersCron.sh render                      # imprime o arquivo que seria instalado
#   installNomusPurchaseOrdersCron.sh verify                      # compara o instalado com o renderizado
#   sudo installNomusPurchaseOrdersCron.sh install --environment=production
#   sudo installNomusPurchaseOrdersCron.sh install --environment=homolog --allow-homolog
#   sudo installNomusPurchaseOrdersCron.sh uninstall              # move o arquivo para backup (rollback)
#
# Homologação: agenda externa desligada por padrão — instalar só com --allow-homolog explícito.
# O cron NÃO decide qual fonte executa: NOMUS_PO_SCHEDULE_SOURCE (chain|independent) no .env do app decide.
# Rollback operacional: NOMUS_PO_SCHEDULE_SOURCE=chain (efeito imediato, sem mexer no cron).
set -Eeuo pipefail

ACTION="${1:-render}"
shift || true

APP_DIR="${INDUSCOST_APP_DIR:-/opt/induscost}"
TARGET="${NOMUS_PO_CRON_FILE:-/etc/cron.d/induscost-nomus-purchase-orders}"
LOG_FILE="${NOMUS_PO_CRON_LOG_FILE:-/var/log/induscost-nomus-purchase-orders-cron.log}"
RUN_AS="${NOMUS_PO_CRON_USER:-root}"
BACKUP_DIR="${NOMUS_PO_CRON_BACKUP_DIR:-/var/backups/induscost-cron}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${NOMUS_PO_CRON_TEMPLATE:-$SCRIPT_DIR/../infra/cron/nomus-purchase-orders/induscost-nomus-purchase-orders.cron.template}"

ENVIRONMENT=""
ALLOW_HOMOLOG=0
for arg in "$@"; do
  case "$arg" in
    --environment=*) ENVIRONMENT="${arg#--environment=}" ;;
    --allow-homolog) ALLOW_HOMOLOG=1 ;;
    *) echo "[po-cron] argumento desconhecido: $arg"; exit 2 ;;
  esac
done

# 03:37 em America/Sao_Paulo convertido para a hora local do host (cron do sistema usa o fuso do host).
host_offset_minutes() {
  local raw sign hh mm
  raw="$(date +%z)"
  sign="${raw:0:1}"; hh="${raw:1:2}"; mm="${raw:3:2}"
  local total=$((10#$hh * 60 + 10#$mm))
  [[ "$sign" == "-" ]] && total=$((-total))
  echo "$total"
}

daily_hour_for_host() {
  local offset utc_minutes local_minutes
  offset="$(host_offset_minutes)"
  if (( offset % 60 != 0 )); then
    echo "[po-cron] ERRO: fuso do host com offset fracionário ($(date +%z)); minuto 37 não se mantém." >&2
    exit 3
  fi
  # 03:37 BRT (UTC-03:00, sem horário de verão) = 06:37 UTC.
  utc_minutes=$((6 * 60 + 37))
  local_minutes=$(( (utc_minutes + offset + 1440) % 1440 ))
  echo $((local_minutes / 60))
}

render() {
  [[ -f "$TEMPLATE" ]] || { echo "[po-cron] template ausente: $TEMPLATE" >&2; exit 3; }
  local hour tz
  hour="$(daily_hour_for_host)"
  tz="$(cat /etc/timezone 2>/dev/null || readlink /etc/localtime 2>/dev/null || echo desconhecido)"
  sed -e "s#__APP_DIR__#${APP_DIR}#g" \
      -e "s#__LOG_FILE__#${LOG_FILE}#g" \
      -e "s#__RUN_AS__#${RUN_AS}#g" \
      -e "s#__DAILY_HOUR__#${hour}#g" \
      -e "s#__HOST_TZ__#${tz}#g" \
      -e "s#__HOST_OFFSET__#$(date +%z)#g" \
      "$TEMPLATE"
}

case "$ACTION" in
  render)
    render
    ;;
  verify)
    if [[ ! -f "$TARGET" ]]; then
      echo "[po-cron] NÃO INSTALADO: $TARGET"
      exit 1
    fi
    if diff -u "$TARGET" <(render); then
      echo "[po-cron] OK: $TARGET idêntico ao template renderizado"
    else
      echo "[po-cron] DIVERGENTE: $TARGET difere do template renderizado"
      exit 1
    fi
    if [[ ! -x "$APP_DIR/scripts/runNomusPurchaseOrdersSync.sh" ]]; then
      echo "[po-cron] AVISO: $APP_DIR/scripts/runNomusPurchaseOrdersSync.sh sem permissão de execução"
    fi
    ;;
  install)
    case "$ENVIRONMENT" in
      production) ;;
      homolog)
        if [[ "$ALLOW_HOMOLOG" != "1" ]]; then
          echo "[po-cron] RECUSADO: agenda externa desligada por padrão em homologação (use --allow-homolog)."
          exit 4
        fi
        ;;
      *)
        echo "[po-cron] RECUSADO: informe --environment=production|homolog."
        exit 2
        ;;
    esac
    tmp="$(mktemp)"
    render > "$tmp"
    if [[ -f "$TARGET" ]]; then
      mkdir -p "$BACKUP_DIR"
      cp -p "$TARGET" "$BACKUP_DIR/$(basename "$TARGET").$(date -u +%Y%m%dT%H%M%SZ)"
    fi
    install -m 0644 -o root -g root "$tmp" "$TARGET"
    rm -f "$tmp"
    chmod +x "$APP_DIR/scripts/runNomusPurchaseOrdersSync.sh" || true
    echo "[po-cron] INSTALADO: $TARGET (hora diária no host: $(daily_hour_for_host))"
    echo "[po-cron] Fonte ativa continua sendo NOMUS_PO_SCHEDULE_SOURCE no .env (padrão chain)."
    ;;
  uninstall)
    if [[ ! -f "$TARGET" ]]; then
      echo "[po-cron] nada a remover: $TARGET"
      exit 0
    fi
    mkdir -p "$BACKUP_DIR"
    mv "$TARGET" "$BACKUP_DIR/$(basename "$TARGET").removed.$(date -u +%Y%m%dT%H%M%SZ)"
    echo "[po-cron] DESINSTALADO (backup em $BACKUP_DIR). Lembre: NOMUS_PO_SCHEDULE_SOURCE=chain para o encadeamento voltar a executar."
    ;;
  *)
    echo "[po-cron] ação inválida: $ACTION (render|verify|install|uninstall)"
    exit 2
    ;;
esac
