#!/usr/bin/env bash
# Verificação SOMENTE LEITURA de um executor de deploy (produção ou homologação).
# Confere se ele usa infra/deploy/induscost-deploy-safety.sh (v2) nos pontos que causaram o incidente de
# 26/10/2026 e nas garantias G1–G6 da biblioteca.
#
#   sudo bash scripts/ops/checkDeployExecutorSafety.sh /usr/local/bin/deploy-induscost-producao
#   sudo bash scripts/ops/checkDeployExecutorSafety.sh "$(command -v induscost-deploy-homologacao)"
#
# IDS_LIB_INSTALLED (padrão /usr/local/lib/induscost/induscost-deploy-safety.sh): cópia que o executor carrega;
# precisa ser idêntica à versão deste repositório.
# Saída 0 = todas as proteções presentes; 1 = alguma ausente (listadas).
set -uo pipefail

EXECUTOR="${1:-/usr/local/bin/deploy-induscost-producao}"
INSTALLED="${IDS_LIB_INSTALLED:-/usr/local/lib/induscost/induscost-deploy-safety.sh}"
REPO_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/infra/deploy/induscost-deploy-safety.sh"
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
lacks() { grep -Eq -e "$1" <<<"$CODE" && echo 0 || echo 1; }
line_of() { grep -nE -e "$1" <<<"$CODE" | head -1 | cut -d: -f1; }
before() {
  # $1 antes de $2 (primeira ocorrência de cada); ambos precisam existir.
  local a b
  a="$(line_of "$1")"
  b="$(line_of "$2")"
  [[ -n "$a" && -n "$b" && "$a" -lt "$b" ]] && echo 1 || echo 0
}
both() { [[ "$1" == 1 && "$2" == 1 ]] && echo 1 || echo 0; }

check "carrega a biblioteca (source …/induscost-deploy-safety.sh)" "$(has '(source|\.)[[:space:]]+[^#]*induscost-deploy-safety\.sh')"
if [[ -r "$INSTALLED" && -r "$REPO_LIB" ]] && cmp -s "$INSTALLED" "$REPO_LIB"; then
  check "biblioteca instalada ($INSTALLED) idêntica à do repositório" 1
else
  check "biblioteca instalada ($INSTALLED) idêntica à do repositório" 0
fi
check "G5: ids_recover_db_state no início (interrupção de execução anterior)" "$(before 'ids_recover_db_state[[:space:]]' 'ids_backup_db[[:space:]]')"
check "diretório de backup via ids_prepare_backup_dir" "$(has 'ids_prepare_backup_dir[[:space:]]')"
check "G1: escritores pausados (ids_pause_writers) ANTES do backup" "$(before 'ids_pause_writers[[:space:]]' 'ids_backup_db[[:space:]]')"
check "G1: escritores retomados (ids_resume_writers)" "$(has 'ids_resume_writers[[:space:]]')"
check "G2: backup via ids_backup_db (dump conferido como postgres + cerca de XID)" "$(has 'ids_backup_db[[:space:]]')"
check "G2: ids_mark_db_changes_started com o banco, antes de prisma migrate deploy" \
  "$(both "$(has 'ids_mark_db_changes_started[[:space:]]+"?\$\{?BACKUP_DIR\}?"?[[:space:]]+"?\$\{?DB\b')" "$(before 'ids_mark_db_changes_started[[:space:]]' 'prisma[[:space:]]+migrate[[:space:]]+deploy')")"
check "G3: ids_mark_app_starting depois das migrations (antes de subir a aplicação nova)" "$(before 'prisma[[:space:]]+migrate[[:space:]]+deploy' 'ids_mark_app_starting[[:space:]]')"
check "G3/G5: rollback via ids_rollback_db_if_needed (assinatura v2, sem DB_OWNER)" \
  "$(both "$(has 'ids_rollback_db_if_needed[[:space:]]')" "$(lacks 'ids_rollback_db_if_needed[^|;&]*DB_OWNER')")"
check "G3: DB_RC=2 (decisão manual) tratado pelo executor" "$(has 'DB_RC"?[[:space:]]*(==|-eq)[[:space:]]*"?2\b')"
check "G6: testes via ids_run_test_gate (sem banco/credenciais/locks reais)" "$(has 'ids_run_test_gate')"
check "nenhum dropdb no executor" "$(lacks '\bdropdb\b')"
check "nenhum pg_restore --clean / DROP DATABASE no executor" "$(lacks '--clean|DROP[[:space:]]+DATABASE')"
check "nenhum pg_restore --no-owner/--no-acl no executor (perderia donos e permissões)" "$(lacks '--no-owner|--no-acl')"

if [[ "$fail" == 0 ]]; then
  echo "RESULTADO: executor protegido."
else
  echo "RESULTADO: executor SEM as proteções acima — não fazer deploy até corrigir (ver infra/deploy/APLICAR.md)."
fi
exit "$fail"
