#!/usr/bin/env bash
# Deploy não destrutivo — /opt/induscost
# Uso: cd /opt/induscost && bash scripts/deploy-server-main-update.sh
set -euo pipefail

APP_DIR="${INDUSCOST_APP_DIR:-/opt/induscost}"
cd "$APP_DIR"

echo "=== 1) STATUS ATUAL ==="
git status --short
git branch --show-current
git log --oneline -8

echo ""
echo "=== 2) BUSCAR ATUALIZAÇÕES DO GIT ==="
git fetch origin main

echo ""
echo "=== 3) COMMITS PENDENTES ==="
git log --oneline HEAD..origin/main || true

echo ""
echo "=== 4) ARQUIVOS QUE VÃO MUDAR ==="
git diff --name-status HEAD..origin/main || true

echo ""
echo "=== 5) APLICAR PULL FAST-FORWARD ==="
git pull --ff-only origin main

echo ""
echo "=== 6) STATUS APÓS PULL ==="
git status --short
git log --oneline -10

echo ""
echo "=== 7) PRISMA VALIDATE ==="
npx prisma validate

echo ""
echo "=== 8) APLICAR MIGRATIONS ==="
npx prisma migrate deploy

echo ""
echo "=== 9) GERAR PRISMA CLIENT ==="
npx prisma generate

echo ""
echo "=== 10) BACKFILL NF-e (dry-run) ==="
npm run backfill:sales-order-nfe-links:dry || true

echo ""
echo "=== 11) BACKFILL NF-e (apply) — descomente após revisar dry-run ==="
# npm run backfill:sales-order-nfe-links:apply

echo ""
echo "=== 12) AUDITORIA FINAL PEDIDOS ==="
npm run audit:sales-order-final-validation -- --year=$(date +%Y) || true

echo ""
echo "=== 13) BUILD ==="
npm run build

echo ""
echo "=== 14) REINICIAR APP ==="
PID=$(ss -ltnp 2>/dev/null | grep ':3000' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1 || true)

if [ -n "$PID" ]; then
  echo "Encerrando processo na porta 3000: $PID"
  kill "$PID"
  sleep 4
else
  echo "Nenhum PID encontrado na porta 3000"
fi

echo "Subindo aplicação..."
nohup npx tsx server.ts > /tmp/induscost-server.log 2>&1 &

sleep 10

echo ""
echo "=== 15) VALIDAR PORTA 3000 ==="
ss -ltnp | grep ':3000' || true

echo ""
echo "=== 16) HEALTH CHECK ==="
curl -sS http://127.0.0.1:3000/api/health || true

echo ""
echo ""
echo "=== 17) LOG FINAL ==="
tail -100 /tmp/induscost-server.log || true

echo ""
echo "Deploy concluído. Commit: $(git rev-parse HEAD)"
