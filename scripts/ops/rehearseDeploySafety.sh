#!/usr/bin/env bash
# Ensaio da biblioteca de segurança do deploy NO SERVIDOR, sem tocar no banco operacional, na aplicação, no cron
# ou nos timers: cria bancos descartáveis `ids_ensaio_<n>_*` NO CLUSTER CONFIGURADO NO ARQUIVO DE AMBIENTE e exercita,
# com as ferramentas e permissões reais do servidor (runuser do usuário do cluster, binários da versão do cluster,
# socket/porta/papel explícitos, diretório de backup com pais 0711 criados por root — a causa do incidente de
# 26/10/2026):
#   0. cluster conferido (versão maior, porta, socket, superusuário, clientes);
#   1. trava de escrita (inclusive superusuário e nextval);
#   2. backup como o usuário do cluster + prova; escrita forçada depois do backup barra as migrations;
#   3. migration incompatível → restauração REAL, conferência integral, troca atômica, <db>__failed_<ts>;
#   4. migration compatível com escrita da aplicação → banco mantido;
#   5. banco congelado por queda → ids_recover_db_state reabre;
#   6. janela de manutenção restaurada (agendamentos aqui são fictícios: cron e timers do ensaio são vazios).
#
#   sudo bash scripts/ops/rehearseDeploySafety.sh --env-file /etc/induscost/deploy-executor-homologacao.env
#   sudo bash scripts/ops/rehearseDeploySafety.sh --env-file /etc/induscost/deploy-executor-homologacao.env --cleanup
#
# Do arquivo de ambiente só entram as chaves do PostgreSQL (IDS_PG_*) e as proteções (PROTECTED_DATABASES, DB): o
# ensaio nunca usa APP, SERVICE, CRON_GLOB ou UNIT_GLOB. Sem --env-file o ensaio RECUSA: os padrões do libpq num
# host com dois clusters levariam os bancos de ensaio ao cluster errado (IDS_ENSAIO_ALLOW_ENV=1 só nas suítes locais,
# que passam IDS_PG_* pelo ambiente).
#
# --cleanup remove SOMENTE bancos cujo nome obedece ao padrão do ensaio (ids_ensaio_<época>_<cenário>[__failed|
# __rollback_...]) e sem sessões, mais o diretório do ensaio. O único `dropdb` do repositório está aqui.
#
# Saída 0 = todos os passos OK. IDS_ENSAIO_ROOT (padrão /var/backups/induscost-deploy-ensaio) e IDS_ENSAIO_STATE
# (padrão /var/lib/induscost/deploy-ensaio) podem ser trocados para ensaios locais.
set -uo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/infra/deploy/induscost-deploy-safety.sh"
ENV_FILE=""
CLEANUP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --cleanup) CLEANUP=1; shift ;;
    *) echo "opção desconhecida: $1"; exit 2 ;;
  esac
done
if [[ -n "$ENV_FILE" ]]; then
  [[ -r "$ENV_FILE" ]] || { echo "ERRO: $ENV_FILE ilegível"; exit 2; }
  eval "$(grep -E '^(IDS_PG_OS_USER|IDS_PG_BIN|IDS_PG_HOST|IDS_PG_PORT|IDS_PG_ADMIN_ROLE|IDS_PG_EXPECT_MAJOR|IDS_PG_MAINT_DB|PROTECTED_DATABASES|DB|BACKUP_ROOT)=' "$ENV_FILE")"
  IDS_STATE_DIR_REAL="/var/lib/induscost/deploy-safety/$(grep -E '^IDS_ENV_NAME=' "$ENV_FILE" | head -n 1 | cut -d= -f2)"
  for v in IDS_PG_OS_USER IDS_PG_BIN IDS_PG_HOST IDS_PG_PORT IDS_PG_ADMIN_ROLE IDS_PG_EXPECT_MAJOR; do
    if [[ -z "${!v:-}" || "${!v}" == *A_COLETAR* ]]; then
      echo "ERRO: $v não preenchido em $ENV_FILE (ver infra/deploy/COLETA.md); ensaio não executado"
      exit 3
    fi
  done
  if [[ "$IDS_PG_OS_USER" == none ]]; then export IDS_PG="" IDS_PG_USER=""; else export IDS_PG="runuser -u $IDS_PG_OS_USER --" IDS_PG_USER="$IDS_PG_OS_USER"; fi
  [[ "$IDS_PG_BIN" == PATH ]] && IDS_PG_BIN=""
  export IDS_PG_BIN IDS_PG_HOST IDS_PG_PORT IDS_PG_ADMIN_ROLE IDS_PG_EXPECT_MAJOR
  export IDS_PG_MAINT_DB="${IDS_PG_MAINT_DB:-postgres}"
  export IDS_PROTECTED_DATABASES="${PROTECTED_DATABASES:-} ${DB:-}"
elif [[ "${IDS_ENSAIO_ALLOW_ENV:-0}" != 1 ]]; then
  echo "ERRO: informe --env-file <arquivo de ambiente instalado>: o ensaio exige o cluster explícito (socket, porta, papel, binários)"
  exit 2
fi

ENSAIO_ROOT="${IDS_ENSAIO_ROOT:-/var/backups/induscost-deploy-ensaio}"
ENSAIO_STATE="${IDS_ENSAIO_STATE:-/var/lib/induscost/deploy-ensaio}"
export IDS_STATE_DIR="$ENSAIO_STATE/state"
export IDS_MAINT_FLAG="$ENSAIO_STATE/flag"
export IDS_CRON_DIR="$ENSAIO_STATE/cron.d"
export IDS_CRON_SCAN_FILES=""
export IDS_CRON_SPOOL_DIRS=""
export IDS_CRON_RELOAD_WAIT=0
export IDS_APP_MARK_PATTERN="$ENSAIO_STATE/app-inexistente"
export IDS_UNIT_GLOB="ids-ensaio-inexistente-*"
export IDS_WRITER_PROCESS_PATTERN="ids-ensaio-processo-inexistente"
# shellcheck disable=SC1090
source "$LIB"

PREFIX="ids_ensaio_"
NAME_RE='^ids_ensaio_[0-9]+_[a-z]+(__(failed|rollback)_[0-9]+_[a-z]+)?$'
[[ -n "$PREFIX" ]] || { echo "ERRO: prefixo do ensaio vazio"; exit 2; }

# Todo nome que o ensaio cria, congela, renomeia ou remove passa por aqui.
ensaio_name_ok() {
  [[ "$1" == ${PREFIX}* && "$1" =~ $NAME_RE ]] || { echo "ERRO: nome fora do padrão do ensaio: $1"; return 1; }
  ids_assert_not_protected_db "$1"
}

CLUSTER_RC=0
ids_assert_cluster || CLUSTER_RC=$?
[[ "$CLUSTER_RC" == 0 ]] || exit "$CLUSTER_RC"

# Diretórios do ensaio: absolutos, com "ensaio" no nome e nunca a raiz de backups/estado de um ambiente instalado.
for p in "$ENSAIO_ROOT" "$ENSAIO_STATE"; do
  if [[ "$p" != /* || "$p" != *ensaio* || "$p" == "${BACKUP_ROOT:-/nonexistent}" || "$p" == "${IDS_STATE_DIR_REAL:-/nonexistent}" ]]; then
    echo "ERRO: diretório de ensaio inválido: $p (precisa ser absoluto e ter 'ensaio' no caminho)"
    exit 2
  fi
done

if [[ "$CLEANUP" == 1 ]]; then
  rc=0
  mapfile -t dbs < <(ids_psql "$IDS_PG_MAINT_DB" "SELECT datname FROM pg_database WHERE datname LIKE '${PREFIX//_/\\_}%' ESCAPE '\\' ORDER BY 1")
  mapfile -t connopts < <(ids_pg_connopts)
  for d in "${dbs[@]}"; do
    [[ -n "$d" ]] || continue
    ensaio_name_ok "$d" || { rc=1; continue; }
    if [[ -n "$(ids_foreign_sessions "$d")" ]]; then
      echo "mantido (há sessões): $d"
      rc=1
      continue
    fi
    ids_psql "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$d\" WITH ALLOW_CONNECTIONS true" >/dev/null 2>&1 || true
    if $IDS_PG "$(ids_pg_bin dropdb)" "${connopts[@]}" --if-exists "$d"; then echo "removido: $d"; else rc=1; fi
  done
  rm -rf "$ENSAIO_ROOT" "$ENSAIO_STATE"
  exit "$rc"
fi

RUN="$(date +%s)"
EXPECTED_STEPS=16
pass=0
failn=0
step() {
  if [[ "$2" == 0 ]]; then echo "PASSO OK    $1"; pass=$((pass + 1)); else echo "PASSO FALHOU $1"; failn=$((failn + 1)); fi
}
# Cenário que não preparou banco/diretório aborta o ensaio (nunca segue com DB/DIR vazios).
prepare() {
  local out
  out="$(scenario "$1")" || { echo "ENSAIO ABORTADO: cenário $1 não preparou banco/diretório"; exit 1; }
  IFS='|' read -r DB DIR TS <<< "$out"
  [[ -n "$DB" && -n "$DIR" && -d "$DIR" && -n "$TS" ]] || { echo "ENSAIO ABORTADO: cenário $1 incompleto ($out)"; exit 1; }
  DIRS+=("$DIR")
}
DIRS=()
# Observadores e janela do ensaio nunca ficam para trás, mesmo numa interrupção.
cleanup_run() {
  local d
  for d in "${DIRS[@]}"; do ids_migrate_watch_stop "$d" >/dev/null 2>&1 || true; done
  [[ -f "$(ids_state_file)" ]] && ids_maintenance_end >/dev/null 2>&1 || true
}
trap cleanup_run EXIT
mkdir -p "$IDS_CRON_DIR"
q() { ids_psql "$@"; }
# "Migration" do deploy: mesma exceção à trava e identificação das migrations reais (na própria conexão, não no ambiente).
migrate() { $IDS_PG "$(ids_pg_bin psql)" -X -q -v ON_ERROR_STOP=1 -d "$(ids_conninfo "$1" "$IDS_MIGRATE_APPNAME") options='-c default_transaction_read_only=off'" -c "$2" >/dev/null; }
forced() { $IDS_PG "$(ids_pg_bin psql)" -X -q -v ON_ERROR_STOP=1 -d "$(ids_conninfo "$1" ensaio-forcado) options='-c default_transaction_read_only=off'" -c "$2" >/dev/null; }

new_db() {
  local db="${PREFIX}${RUN}_$1"
  local -a connopts=()
  ensaio_name_ok "$db" || return 1
  mapfile -t connopts < <(ids_pg_connopts)
  $IDS_PG "$(ids_pg_bin createdb)" "${connopts[@]}" -T template0 -E UTF8 "$db" || return 1
  q "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$db\" SET statement_timeout TO '5min'" >/dev/null
  q "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$db\" SET search_path TO \"\$user\", public" >/dev/null
  q "$IDS_PG_MAINT_DB" "REVOKE ALL ON DATABASE \"$db\" FROM PUBLIC" >/dev/null
  $IDS_PG "$(ids_pg_bin psql)" -X -q -v ON_ERROR_STOP=1 -d "$(ids_conninfo "$db")" >/dev/null <<'SQL'
CREATE TYPE "Status" AS ENUM ('A', 'B');
CREATE TABLE "Item" (id serial PRIMARY KEY, name text NOT NULL UNIQUE, qty int DEFAULT 0 CHECK (qty >= 0), status "Status" NOT NULL DEFAULT 'A', legacy text);
CREATE TABLE "ItemEvent" (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, item_id int NOT NULL REFERENCES "Item"(id), at timestamptz DEFAULT now());
CREATE INDEX "ItemEvent_item_idx" ON "ItemEvent"(item_id);
CREATE VIEW item_summary AS SELECT name, qty FROM "Item";
CREATE TABLE "_prisma_migrations" (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count int NOT NULL DEFAULT 0);
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ('m1', 'x', now(), '20261001120000_init', 1);
INSERT INTO "Item" (name, qty) VALUES ('a', 1), ('b', 2), ('c', 3);
INSERT INTO "ItemEvent" (item_id) VALUES (1), (2);
SELECT setval('"Item_id_seq"', 41);
GRANT SELECT ON "Item", item_summary TO PUBLIC;
SQL
  printf '%s\n' "$db"
}

# Cada cenário = um "deploy": diretório de backup próprio (mesma regra de permissões do executor) e janela.
scenario() {
  local name="$1" db ts dir
  db="$(new_db "$name")" || return 1
  ts="${RUN}_${name}"
  dir="$(ids_prepare_backup_dir "$ENSAIO_ROOT/deploys" "$ts")" || return 1
  printf '%s|%s|%s\n' "$db" "$dir" "$ts"
}

echo "== ensaio da biblioteca v$IDS_VERSION em $(hostname) — bancos ${PREFIX}${RUN}_* (cluster ${IDS_PG_HOST:-libpq}:${IDS_PG_PORT:-libpq}) =="
step "cluster conferido (versão, porta, socket, superusuário, clientes)" "$CLUSTER_RC"

# 1–3: incompatível → restauração real.
prepare inc
ids_maintenance_begin "$DB" >/dev/null; step "janela de manutenção aberta em $DB" $?
q "$DB" "INSERT INTO \"Item\" (name) VALUES ('nao-pode')" >/dev/null 2>&1; [[ $? != 0 ]]; step "trava: escrita comum recusada (inclusive superusuário)" $?
q "$DB" "SELECT nextval('\"Item_id_seq\"')" >/dev/null 2>&1; [[ $? != 0 ]]; step "trava: nextval recusado" $?
ids_backup_db "$DB" "$DIR/database-before.dump" >/dev/null; step "backup como ${IDS_PG_USER:-usuário atual} em diretório 0700 sob pais 0711 + prova" $?
$IDS_PG "$(ids_pg_bin pg_restore)" -l "$DIR/database-before.dump" >/dev/null; step "dump legível pelo usuário do restore" $?
ids_mark_db_changes_started "$DIR" "$DB" >/dev/null; step "marcador antes das migrations" $?
ids_migrate_watch_start "$DIR" "$DB"
migrate "$DB" 'ALTER TABLE "Item" DROP COLUMN legacy'; step "migration incompatível aplicada com a exceção da trava" $?
out="$(ids_rollback_db_if_needed "$DIR" "$DB" "$DIR/database-before.dump" "$TS")"; rc=$?
[[ $rc == 0 && "$out" == *"decisão: RESTAURAR"* ]]; step "rollback decide RESTAURAR e restaura com pg_restore real" $?
diff -q <(ids_db_fingerprint "$DB" rows,seq) "$DIR/fingerprint-before.txt" >/dev/null; step "banco restaurado idêntico ao backup (linhas, sequências, índices, constraints, donos, ACL, migrations)" $?
diff -q <(ids_db_meta "$DB") "$DIR/db-meta.txt" >/dev/null; step "propriedades do banco iguais (encoding, collation, dono, ACL, configurações)" $?
[[ "$(q "$IDS_PG_MAINT_DB" "SELECT count(*) FROM pg_database WHERE datname = '${DB}__failed_${TS}'")" == 1 ]]; step "estado anterior preservado em ${DB}__failed_${TS}" $?
ids_maintenance_end >/dev/null; step "janela encerrada; trava removida" $?

# 2b: escrita forçada depois do backup barra as migrations.
prepare esc
ids_maintenance_begin "$DB" >/dev/null && ids_backup_db "$DB" "$DIR/database-before.dump" >/dev/null
forced "$DB" "INSERT INTO \"Item\" (name) VALUES ('escrita-forcada')"
ids_mark_db_changes_started "$DIR" "$DB" >/dev/null; [[ $? == 43 ]]; step "escrita forçada depois do backup: migrations recusadas (43)" $?
ids_maintenance_end >/dev/null

# 4: compatível + escrita da aplicação → mantido.
prepare comp
ids_maintenance_begin "$DB" >/dev/null && ids_backup_db "$DB" "$DIR/database-before.dump" >/dev/null && ids_mark_db_changes_started "$DIR" "$DB" >/dev/null
ids_migrate_watch_start "$DIR" "$DB"
migrate "$DB" 'ALTER TABLE "Item" ADD COLUMN color text'
ids_open_for_app "$DIR" "$DB" >/dev/null
q "$DB" "INSERT INTO \"Item\" (name, color) VALUES ('pedido', 'azul')" >/dev/null
out="$(ids_rollback_db_if_needed "$DIR" "$DB" "$DIR/database-before.dump" "$TS")"; rc=$?
[[ $rc == 0 && "$out" == *"banco MANTIDO"* && "$(q "$DB" "SELECT count(*) FROM \"Item\" WHERE name = 'pedido'")" == 1 ]]; step "schema compatível: banco mantido com a escrita da aplicação" $?
ids_maintenance_end >/dev/null

# 5: banco congelado por queda → recuperação.
prepare rec
q "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$DB\" WITH ALLOW_CONNECTIONS false" >/dev/null
ids_recover_db_state "$DB" "$DIR" >/dev/null && [[ "$(q "$IDS_PG_MAINT_DB" "SELECT datallowconn FROM pg_database WHERE datname = '$DB'")" == t ]]; step "banco congelado por queda reaberto por ids_recover_db_state" $?

echo "== resultado: $pass OK, $failn falha(s) (esperado: $EXPECTED_STEPS OK). Bancos do ensaio mantidos; remover com: sudo bash $0 ${ENV_FILE:+--env-file $ENV_FILE }--cleanup =="
[[ "$failn" == 0 && "$pass" == "$EXPECTED_STEPS" ]]
