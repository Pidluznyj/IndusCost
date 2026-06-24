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
# Backfill em lote: NÃO deve despejar milhares de SELECT NomusNfe.
# Query logs ficam desligados por padrão (PRISMA_QUERY_LOG=1 para habilitar).
npm run backfill:sales-order-nfe-links:dry || true

echo ""
echo "=== 11) BACKFILL NF-e (apply) — exige confirmação explícita ==="
# Não roda automaticamente. Revise o dry-run acima e depois rode manualmente:
#   npm run backfill:sales-order-nfe-links:apply
if [ "${RUN_BACKFILL_APPLY:-0}" = "1" ]; then
  echo "RUN_BACKFILL_APPLY=1 detectado — aplicando backfill..."
  npm run backfill:sales-order-nfe-links:apply
else
  echo "Pulado. Para aplicar: RUN_BACKFILL_APPLY=1 bash scripts/deploy-server-main-update.sh"
  echo "ou rode manualmente após revisar o dry-run."
fi

echo ""
echo "=== 12) AUDITORIA FINAL PEDIDOS ==="
npm run audit:sales-order-final-validation -- --year=$(date +%Y) || true

echo ""
echo "=== 13) BUILD (produção) ==="
NODE_ENV=production npm run build

echo ""
echo "=== 14) REINICIAR APP (NODE_ENV=production) ==="
PID=$(ss -ltnp 2>/dev/null | grep ':3000' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1 || true)

if [ -n "$PID" ]; then
  echo "Encerrando processo na porta 3000: $PID"
  kill "$PID"
  sleep 4
else
  echo "Nenhum PID encontrado na porta 3000"
fi

# CRÍTICO: subir SEMPRE em produção. Sem isto, o Vite serve módulos de
# desenvolvimento (react-dom_client.js?v=, prisma.ts) e a tela fica branca.
echo "Subindo aplicação em produção..."
NODE_ENV=production nohup npx tsx server.ts > /tmp/induscost-server.log 2>&1 &

sleep 10

echo ""
echo "=== 15) VALIDAR PORTA 3000 ==="
ss -ltnp | grep ':3000' || true

echo ""
echo "=== 16) HEALTH CHECK ==="
curl -sS http://127.0.0.1:3000/api/health || true

echo ""
echo ""
echo "=== 17) ASSET DE PRODUÇÃO SERVIDO ==="
# Em produção deve servir /assets/index-*.js (bundle Vite buildado).
# Em modo dev apareceria /src/main.tsx e imports com ?v= (NÃO pode ocorrer).
HTML=$(curl -sS http://127.0.0.1:3000/ || true)
echo "$HTML" | grep -E '/assets/index-.*\.js' && echo "OK: servindo bundle de produção." || echo "ATENÇÃO: bundle de produção não encontrado no HTML!"
if echo "$HTML" | grep -Eq '/src/main\.tsx|\?v='; then
  echo "ERRO: HTML contém referências de DESENVOLVIMENTO (Vite). App NÃO está em produção!"
fi

echo ""
echo "=== 18) LOG FINAL ==="
tail -60 /tmp/induscost-server.log || true

echo ""
echo "Deploy concluído. Commit: $(git rev-parse HEAD)"
echo "No navegador, force recarregar sem cache: Ctrl+Shift+R (ou Cmd+Shift+R)."
