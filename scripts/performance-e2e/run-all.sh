#!/usr/bin/env bash
# Roteiro completo do módulo Desempenho e Cultura no Chrome real, do zero.
# Pré-requisitos (tudo LOCAL e descartável — ver docs/avaliacao-desempenho/EVIDENCIAS_TESTES.md):
#   1. PostgreSQL local com as migrations aplicadas e DATABASE_URL apontando para ele.
#   2. Dados fictícios: npx tsx scripts/seedPerformanceLocalDemo.ts (com PERF_DEMO_PASSWORD).
#   3. Servidor local na porta 3100 com PERFORMANCE_CYCLE_ENABLED=1 só no processo.
# Uso (na raiz do repositório): PERF_DEMO_PASSWORD=... DATABASE_URL=... bash scripts/performance-e2e/run-all.sh
set -u
case "${DATABASE_URL:-}" in
  *@127.0.0.1:*|*@localhost:*) ;;
  *) echo "Recusado: DATABASE_URL precisa ser local."; exit 1 ;;
esac
D="scripts/performance-e2e"
npx tsx "$D/resetModuleData.mts" || exit 1
export TSX_CLI="$PWD/node_modules/tsx/dist/cli.mjs"
export TOGGLE_SCRIPT="$PWD/$D/toggleLeader.mts"
rm -rf tmp/performance-e2e
for p in part1-hr-setup part2-portal part3-leader part4-hr-calibration part5-leader-revision part6-hr-close part7-leader-followup part8-profile-and-access; do
  echo "== $p"
  node "$D/$p.mjs" 2>&1 | grep -E "^(PASS|FAIL)|^logs"
done
