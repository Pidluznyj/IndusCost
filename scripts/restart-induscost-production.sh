#!/usr/bin/env bash
# Reinício limpo em produção — libera porta 3000 e sobe só via systemd.
# Uso: sudo bash scripts/restart-induscost-production.sh
set -euo pipefail

SERVICE="${INDUSCOST_SYSTEMD_UNIT:-induscost.service}"
PORT="${INDUSCOST_PORT:-3000}"

echo "=== Parar unit systemd ($SERVICE) ==="
systemctl stop "$SERVICE" 2>/dev/null || true

echo "=== Encerrar processos órfãos (nohup / tsx server.ts) ==="
pkill -f "[t]sx server.ts" 2>/dev/null || true
sleep 2

echo "=== Liberar porta $PORT ==="
for _ in 1 2 3; do
  mapfile -t pids < <(ss -ltnp 2>/dev/null | grep ":${PORT} " | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u)
  if [ "${#pids[@]}" -eq 0 ]; then
    break
  fi
  for pid in "${pids[@]}"; do
    echo "kill $pid"
    kill "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
  done
  sleep 2
done

if ss -ltnp 2>/dev/null | grep -q ":${PORT} "; then
  echo "ERRO: porta $PORT ainda em uso:"
  ss -ltnp | grep ":${PORT} " || true
  exit 1
fi

echo "=== Subir via systemd ==="
systemctl start "$SERVICE"
sleep 4

echo "=== Status ==="
systemctl --no-pager status "$SERVICE" || true

echo ""
echo "=== Porta $PORT ==="
ss -ltnp | grep ":${PORT} " || true

echo ""
echo "=== Health ==="
curl -sS "http://127.0.0.1:${PORT}/api/health" || true
echo ""
curl -sS "http://127.0.0.1:${PORT}/api/app-version" || true
echo ""

ACTIVE_PID=$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null || echo "")
LISTEN_PID=$(ss -ltnp 2>/dev/null | grep ":${PORT} " | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1 || true)
if [ -n "$ACTIVE_PID" ] && [ -n "$LISTEN_PID" ] && [ "$ACTIVE_PID" = "$LISTEN_PID" ]; then
  echo "OK: systemd MainPID=$ACTIVE_PID escuta em $PORT"
else
  echo "ATENÇÃO: MainPID systemd=$ACTIVE_PID vs listener=$LISTEN_PID — pode haver processo órfão."
  exit 1
fi
