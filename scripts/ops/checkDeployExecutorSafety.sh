#!/usr/bin/env bash
# Verificação SOMENTE LEITURA de um executor de deploy (produção ou homologação).
# Confere se ele usa infra/deploy/induscost-deploy-safety.sh nos pontos que causaram o incidente de 26/10/2026.
#
#   sudo bash scripts/ops/checkDeployExecutorSafety.sh /usr/local/bin/deploy-induscost-producao
#   sudo bash scripts/ops/checkDeployExecutorSafety.sh "$(command -v induscost-deploy-homologacao)"
#
# Saída 0 = todas as proteções presentes; 1 = alguma ausente (listadas).
set -uo pipefail

EXECUTOR="${1:-/usr/local/bin/deploy-induscost-producao}"
if [[ ! -r "$EXECUTOR" ]]; then
  echo "ERRO: não consigo ler $EXECUTOR (rode com sudo)."
  exit 2
fi

# Ignora comentários para não aceitar proteção "só no comentário".
CODE="$(sed -E 's/^[[:space:]]*#.*$//' "$EXECUTOR")"
fail=0
check() {
  local label="$1" ok="$2"
  if [[ "$ok" == 1 ]]; then
    echo "OK    $label"
  else
    echo "FALTA $label"
    fail=1
  fi
}
has() { grep -Eq -e "$1" <<<"$CODE" && echo 1 || echo 0; }
line_of() { grep -nE -e "$1" <<<"$CODE" | head -1 | cut -d: -f1; }

check "carrega a biblioteca (source …/induscost-deploy-safety.sh)" "$(has '(source|\.)[[:space:]]+[^#]*induscost-deploy-safety\.sh')"
check "backup via ids_backup_db (dump verificado como postgres)" "$(has 'ids_backup_db[[:space:]]')"
check "diretório de backup via ids_prepare_backup_dir" "$(has 'ids_prepare_backup_dir[[:space:]]')"
check "testes via ids_run_test_gate (sem banco/credenciais/locks reais)" "$(has 'ids_run_test_gate')"
check "rollback do banco via ids_rollback_db_if_needed" "$(has 'ids_rollback_db_if_needed[[:space:]]')"
check "nenhum dropdb no executor" "$([[ "$(has '\bdropdb\b')" == 0 ]] && echo 1 || echo 0)"
check "nenhum pg_restore --clean / DROP DATABASE no executor" "$([[ "$(has '--clean|DROP[[:space:]]+DATABASE')" == 0 ]] && echo 1 || echo 0)"

mark="$(line_of 'ids_mark_db_changes_started[[:space:]]')"
migrate="$(line_of 'prisma[[:space:]]+migrate[[:space:]]+deploy')"
if [[ -n "$mark" && -n "$migrate" && "$mark" -lt "$migrate" ]]; then
  check "marcador ids_mark_db_changes_started antes de prisma migrate deploy" 1
else
  check "marcador ids_mark_db_changes_started antes de prisma migrate deploy" 0
fi

if [[ "$fail" == 0 ]]; then
  echo "RESULTADO: executor protegido."
else
  echo "RESULTADO: executor SEM as proteções acima — não fazer deploy até corrigir (ver infra/deploy/APLICAR.md)."
fi
exit "$fail"
