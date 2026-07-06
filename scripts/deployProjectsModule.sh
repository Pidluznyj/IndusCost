#!/usr/bin/env bash
set -euo pipefail

cd /opt/induscost

echo "=== Aplicar módulo Projetos ==="
git pull --ff-only origin main

echo ""
echo "=== Confirmar commit aplicado ==="
git log -6 --oneline
git status --branch --short

echo ""
echo "=== Aplicar migration Projetos ==="
npx prisma migrate deploy

echo ""
echo "=== Gerar Prisma Client ==="
npx prisma generate

echo ""
echo "=== Validar Prisma ==="
npx prisma validate

echo ""
echo "=== Testes Projetos e permissões ==="
npm run test:projects
npm run test:auth:access-profiles
npm run test:finance:navigation

echo ""
echo "=== Auditoria pós-apply ==="
git diff -- . | grep -nE "DROP|TRUNCATE|deleteMany|DATABASE_URL|NOMUS_AUTH|Basic |ProductBOM|sync:nomus|finance-control-room|financeControlRoomTheme|cash-flow-page-formatted" || true
git grep -n "finance-control-room\|financeControlRoomTheme\|cash-flow-page-formatted" -- . || true

echo ""
echo "=== Lint e build ==="
npm run lint
npm run build

echo ""
echo "=== Reiniciar app ==="
fuser -k 3000/tcp || true
sleep 2
nohup npm run dev > app.log 2>&1 &
sleep 5

echo ""
echo "=== Verificar app ==="
tail -n 80 app.log
curl -I http://127.0.0.1:3000 2>/dev/null | head -n 20 || true

echo ""
echo "=== Status final ==="
git status --branch --short
git log -5 --oneline
