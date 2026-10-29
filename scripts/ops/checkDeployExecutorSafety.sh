#!/usr/bin/env bash
# Verificação SOMENTE LEITURA de um executor de deploy (produção ou homologação).
# Aceita o wrapper instalado por infra/deploy/install-induscost-deploy.sh (segue até o executor versionado e confere
# o MANIFEST) ou um executor qualquer. Confere as garantias G1–G8 da biblioteca v5 (infra/deploy/induscost-deploy-safety.sh).
#
#   sudo bash scripts/ops/checkDeployExecutorSafety.sh /usr/local/bin/deploy-induscost-producao
#   sudo bash scripts/ops/checkDeployExecutorSafety.sh "$(command -v induscost-deploy-homologacao)"
#
# Saída 0 = todas as proteções presentes; 1 = alguma ausente (listadas); 2 = não foi possível ler.
set -uo pipefail

EXECUTOR="${1:-/usr/local/bin/deploy-induscost-producao}"
REPO_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/infra/deploy/induscost-deploy-safety.sh"
if [[ ! -r "$EXECUTOR" ]]; then
  echo "ERRO: não consigo ler $EXECUTOR (rode com sudo)."
  exit 2
fi

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

# Link simbólico e wrapper legado (exec de outro caminho absoluto, até 2 saltos) → wrapper instalado → executor versionado.
TARGET="$(readlink -f "$EXECUTOR" 2>/dev/null || printf '%s' "$EXECUTOR")"
[[ "$TARGET" != "$EXECUTOR" ]] && echo "link → $TARGET"
for _hop in 1 2; do
  next="$(sed -nE 's/^[[:space:]]*exec[[:space:]]+"?(\/[^" ]+)"?.*/\1/p' "$TARGET" 2>/dev/null | head -n 1)"
  [[ -n "$next" && "$next" != *induscost-deploy-executor.sh && -r "$next" ]] || break
  echo "exec → $next"
  TARGET="$next"
done
wrapped="$(sed -nE 's/^exec "([^"]*induscost-deploy-executor\.sh)".*/\1/p' "$TARGET" | head -n 1)"
if [[ -n "$wrapped" ]]; then
  echo "wrapper → $wrapped"
  TARGET="$wrapped"
  if [[ -r "$TARGET" ]] && (cd "$(dirname "$TARGET")" && sha256sum -c --quiet --strict MANIFEST.sha256 >/dev/null 2>&1); then
    check "instalação íntegra (MANIFEST.sha256 de $(dirname "$TARGET"))" 1
    manifest_ok=1
  else
    check "instalação íntegra (MANIFEST.sha256 de $(dirname "$TARGET"))" 0
  fi
fi
LIB_NEXT="$(dirname "$TARGET")/induscost-deploy-safety.sh"
if [[ -r "$LIB_NEXT" && -r "$REPO_LIB" ]] && cmp -s "$LIB_NEXT" "$REPO_LIB"; then
  echo "OK    biblioteca ao lado do executor idêntica à do repositório"
elif [[ "${manifest_ok:-0}" == 1 ]]; then
  # Instalação íntegra (MANIFEST) de outra versão do repositório: aviso, não falha.
  echo "AVISO biblioteca instalada ($LIB_NEXT) difere da do checkout atual ($REPO_LIB): outra versão instalada"
else
  check "biblioteca ao lado do executor idêntica à do repositório ($LIB_NEXT)" 0
fi

# Ignora comentários para não aceitar proteção "só no comentário".
CODE="$(sed -E 's/^[[:space:]]*#.*$//' "$TARGET")"
has() { grep -Eq -e "$1" <<<"$CODE" && echo 1 || echo 0; }
lacks() { grep -Eq -e "$1" <<<"$CODE" && echo 0 || echo 1; }
line_of() { grep -nE -e "$1" <<<"$CODE" | head -1 | cut -d: -f1; }
before() {
  local a b
  a="$(line_of "$1")"
  b="$(line_of "$2")"
  [[ -n "$a" && -n "$b" && "$a" -lt "$b" ]] && echo 1 || echo 0
}
both() { [[ "$1" == 1 && "$2" == 1 ]] && echo 1 || echo 0; }
# Primeira linha com $1 depois da linha $2.
first_after() { grep -nE -e "$1" <<<"$CODE" | awk -F: -v n="$2" '$1 > n { print $1; exit }'; }
MIGRATE='prisma[[:space:]]+migrate[[:space:]]+deploy'
open_ok() {
  local m o s
  m="$(line_of "$MIGRATE")"
  [[ -n "$m" ]] || { echo 0; return; }
  o="$(first_after 'ids_open_for_app[[:space:]]' "$m")"
  s="$(first_after 'start[[:space:]]+"\$SERVICE"' "$m")"
  [[ -n "$o" && -n "$s" && "$o" -lt "$s" ]] && echo 1 || echo 0
}

check "carrega a biblioteca induscost-deploy-safety.sh" "$(has '(source|\.)[[:space:]]+[^#]*induscost-deploy-safety\.sh')"
# A parada do serviço no fluxo de deploy é `service_stop || {` (no rollback é `service_stop || echo`).
STOP_APP='service_stop[[:space:]]*\|\|[[:space:]]*\{'
check "G7: cluster conferido (ids_assert_cluster) antes de parar o serviço" "$(before 'ids_assert_cluster[[:space:]]*\|\|' "$STOP_APP")"
check "G7: banco protegido recusado (ids_assert_not_protected_db) antes de parar o serviço" "$(before 'ids_assert_not_protected_db[[:space:]]' "$STOP_APP")"
check "G8: escopo da janela conferido (ids_assert_isolation_scope) antes de parar o serviço" "$(before 'ids_assert_isolation_scope[[:space:]]*\|\|' "$STOP_APP")"
check "confere a integridade (MANIFEST.sha256) antes de executar" "$(has 'sha256sum[[:space:]]+-c')"
check "G1: recusa janela de manutenção pendente e recupera o banco antes de começar" "$(both "$(has 'ids_state_file')" "$(before 'ids_recover_db_state[[:space:]]' 'ids_maintenance_begin[[:space:]]')")"
check "G1/G2: janela de manutenção (ids_maintenance_begin) ANTES do backup" "$(before 'ids_maintenance_begin[[:space:]]' 'ids_backup_db[[:space:]]')"
check "G1: janela encerrada (ids_maintenance_end) no sucesso e no rollback" "$(has 'ids_maintenance_end')"
check "G3: backup com prova (ids_backup_db)" "$(has 'ids_backup_db[[:space:]]')"
check "G3: ids_mark_db_changes_started antes de prisma migrate deploy" "$(before 'ids_mark_db_changes_started[[:space:]]' "$MIGRATE")"
check "G3: observador de sessões (ids_migrate_watch_start) antes das migrations" "$(before 'ids_migrate_watch_start[[:space:]]' "$MIGRATE")"
check "G2: exceção da trava só na URL das migrations (ids_migrate_database_url)" "$(has 'ids_migrate_database_url')"
check "G3: ids_open_for_app depois das migrations e antes de subir a aplicação" "$(open_ok)"
check "G4: rollback por ids_rollback_db_if_needed com o diretório das migrations" "$(has 'ids_rollback_db_if_needed[[:space:]].*prisma/migrations')"
check "G4: BLOQUEIO (DB_RC=2) tratado" "$(has 'DB_RC"?[[:space:]]*(==|-eq)[[:space:]]*"?2\b')"
check "G6: testes via ids_run_test_gate" "$(has 'ids_run_test_gate')"
check "um executor por vez (flock)" "$(has 'flock[[:space:]]+-n')"
check "nenhum dropdb" "$(lacks '\bdropdb\b')"
check "nenhum pg_restore --clean / DROP DATABASE" "$(lacks '--clean|DROP[[:space:]]+DATABASE')"
check "nenhum --no-owner/--no-acl (perderia donos e permissões)" "$(lacks '--no-owner|--no-acl')"

if [[ "$fail" == 0 ]]; then
  echo "RESULTADO: executor protegido."
else
  echo "RESULTADO: executor SEM as proteções acima — não fazer deploy até corrigir (ver infra/deploy/APLICAR.md)."
fi
exit "$fail"
