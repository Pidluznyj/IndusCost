#!/usr/bin/env bash
# Ensaio da biblioteca de segurança do deploy NO SERVIDOR, sem tocar no banco operacional, na aplicação, no cron
# ou nos timers: cria bancos descartáveis `ids_ensaio_<n>_*` no próprio cluster e exercita, com as ferramentas e
# permissões reais do servidor (runuser postgres, pg_dump/pg_restore instalados, diretório de backup com pais 0711
# criados por root — a causa do incidente de 26/10/2026):
#   1. trava de escrita (inclusive superusuário e nextval);
#   2. backup como postgres + prova; escrita forçada depois do backup barra as migrations;
#   3. migration incompatível → restauração REAL, conferência integral, troca atômica, <db>__failed_<ts>;
#   4. migration compatível com escrita da aplicação → banco mantido;
#   5. banco congelado por queda → ids_recover_db_state reabre;
#   6. janela de manutenção restaurada (agendamentos aqui são fictícios: cron e timers do ensaio são vazios).
#
#   sudo bash scripts/ops/rehearseDeploySafety.sh            # roda e mantém os bancos ids_ensaio_* para inspeção
#   sudo bash scripts/ops/rehearseDeploySafety.sh --cleanup  # remove SOMENTE bancos ids_ensaio_* e o diretório do ensaio
#
# Saída 0 = todos os passos OK. Variáveis para rodar fora do servidor (ensaio local): IDS_PG, IDS_PG_USER,
# IDS_ENSAIO_ROOT (padrão /var/backups/induscost-deploy-ensaio), IDS_ENSAIO_STATE (padrão /var/lib/induscost/deploy-ensaio).
set -uo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/infra/deploy/induscost-deploy-safety.sh"
ENSAIO_ROOT="${IDS_ENSAIO_ROOT:-/var/backups/induscost-deploy-ensaio}"
ENSAIO_STATE="${IDS_ENSAIO_STATE:-/var/lib/induscost/deploy-ensaio}"
export IDS_STATE_DIR="$ENSAIO_STATE/state"
export IDS_MAINT_FLAG="$ENSAIO_STATE/flag"
export IDS_CRON_DIR="$ENSAIO_STATE/cron.d"
export IDS_CRON_SCAN_FILES=""
export IDS_CRON_SPOOL_DIRS=""
export IDS_CRON_RELOAD_WAIT=0
export IDS_UNIT_GLOB="ids-ensaio-inexistente-*"
export IDS_WRITER_PROCESS_PATTERN="ids-ensaio-processo-inexistente"
# shellcheck disable=SC1090
source "$LIB"

PREFIX="ids_ensaio_"
if [[ "${1:-}" == "--cleanup" ]]; then
  mapfile -t dbs < <(ids_psql postgres "SELECT datname FROM pg_database WHERE datname LIKE '${PREFIX}%' ORDER BY 1")
  for d in "${dbs[@]}"; do
    [[ "$d" == ${PREFIX}* ]] || continue
    ids_psql postgres "ALTER DATABASE \"$d\" WITH ALLOW_CONNECTIONS true" >/dev/null 2>&1 || true
    $IDS_PG dropdb --if-exists "$d" && echo "removido: $d"
  done
  rm -rf "$ENSAIO_ROOT" "$ENSAIO_STATE"
  exit 0
fi

RUN="$(date +%s)"
pass=0
failn=0
step() {
  if [[ "$2" == 0 ]]; then echo "PASSO OK    $1"; pass=$((pass + 1)); else echo "PASSO FALHOU $1"; failn=$((failn + 1)); fi
}
mkdir -p "$IDS_CRON_DIR"
q() { ids_psql "$@"; }
# "Migration" do deploy: mesma exceção à trava e identificação das migrations reais.
migrate() { PGOPTIONS="-c default_transaction_read_only=off" PGAPPNAME="$IDS_MIGRATE_APPNAME" $IDS_PG psql -X -q -v ON_ERROR_STOP=1 -d "$1" -c "$2" >/dev/null; }
forced() { PGOPTIONS="-c default_transaction_read_only=off" PGAPPNAME=ensaio-forcado $IDS_PG psql -X -q -v ON_ERROR_STOP=1 -d "$1" -c "$2" >/dev/null; }

new_db() {
  local db="${PREFIX}${RUN}_$1"
  $IDS_PG createdb -T template0 -E UTF8 "$db" || return 1
  q postgres "ALTER DATABASE \"$db\" SET statement_timeout TO '5min'" >/dev/null
  q postgres "ALTER DATABASE \"$db\" SET search_path TO \"\$user\", public" >/dev/null
  q postgres "REVOKE ALL ON DATABASE \"$db\" FROM PUBLIC" >/dev/null
  $IDS_PG psql -X -q -v ON_ERROR_STOP=1 -d "$db" >/dev/null <<'SQL'
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

echo "== ensaio da biblioteca v$IDS_VERSION em $(hostname) — bancos ${PREFIX}${RUN}_* =="

# 1–3: incompatível → restauração real.
IFS='|' read -r DB DIR TS < <(scenario inc)
ids_maintenance_begin "$DB" >/dev/null; step "janela de manutenção aberta em $DB" $?
q "$DB" "INSERT INTO \"Item\" (name) VALUES ('nao-pode')" >/dev/null 2>&1; [[ $? != 0 ]]; step "trava: escrita comum recusada (inclusive superusuário)" $?
q "$DB" "SELECT nextval('\"Item_id_seq\"')" >/dev/null 2>&1; [[ $? != 0 ]]; step "trava: nextval recusado" $?
ids_backup_db "$DB" "$DIR/database-before.dump" >/dev/null; step "backup como ${IDS_PG_USER:-usuário atual} em diretório 0700 sob pais 0711 + prova" $?
$IDS_PG pg_restore -l "$DIR/database-before.dump" >/dev/null; step "dump legível pelo usuário do restore" $?
ids_mark_db_changes_started "$DIR" "$DB" >/dev/null; step "marcador antes das migrations" $?
ids_migrate_watch_start "$DIR" "$DB"
migrate "$DB" 'ALTER TABLE "Item" DROP COLUMN legacy'; step "migration incompatível aplicada com a exceção da trava" $?
out="$(ids_rollback_db_if_needed "$DIR" "$DB" "$DIR/database-before.dump" "$TS")"; rc=$?
[[ $rc == 0 && "$out" == *"decisão: RESTAURAR"* ]]; step "rollback decide RESTAURAR e restaura com pg_restore real" $?
diff -q <(ids_db_fingerprint "$DB" rows,seq) "$DIR/fingerprint-before.txt" >/dev/null; step "banco restaurado idêntico ao backup (linhas, sequências, índices, constraints, donos, ACL, migrations)" $?
diff -q <(ids_db_meta "$DB") "$DIR/db-meta.txt" >/dev/null; step "propriedades do banco iguais (encoding, collation, dono, ACL, configurações)" $?
[[ "$(q postgres "SELECT count(*) FROM pg_database WHERE datname = '${DB}__failed_${TS}'")" == 1 ]]; step "estado anterior preservado em ${DB}__failed_${TS}" $?
ids_maintenance_end >/dev/null; step "janela encerrada; trava removida" $?

# 2b: escrita forçada depois do backup barra as migrations.
IFS='|' read -r DB DIR TS < <(scenario esc)
ids_maintenance_begin "$DB" >/dev/null && ids_backup_db "$DB" "$DIR/database-before.dump" >/dev/null
forced "$DB" "INSERT INTO \"Item\" (name) VALUES ('escrita-forcada')"
ids_mark_db_changes_started "$DIR" "$DB" >/dev/null; [[ $? == 43 ]]; step "escrita forçada depois do backup: migrations recusadas (43)" $?
ids_maintenance_end >/dev/null

# 4: compatível + escrita da aplicação → mantido.
IFS='|' read -r DB DIR TS < <(scenario comp)
ids_maintenance_begin "$DB" >/dev/null && ids_backup_db "$DB" "$DIR/database-before.dump" >/dev/null && ids_mark_db_changes_started "$DIR" "$DB" >/dev/null
ids_migrate_watch_start "$DIR" "$DB"
migrate "$DB" 'ALTER TABLE "Item" ADD COLUMN color text'
ids_open_for_app "$DIR" "$DB" >/dev/null
q "$DB" "INSERT INTO \"Item\" (name, color) VALUES ('pedido', 'azul')" >/dev/null
out="$(ids_rollback_db_if_needed "$DIR" "$DB" "$DIR/database-before.dump" "$TS")"; rc=$?
[[ $rc == 0 && "$out" == *"banco MANTIDO"* && "$(q "$DB" "SELECT count(*) FROM \"Item\" WHERE name = 'pedido'")" == 1 ]]; step "schema compatível: banco mantido com a escrita da aplicação" $?
ids_maintenance_end >/dev/null

# 5: banco congelado por queda → recuperação.
IFS='|' read -r DB DIR TS < <(scenario rec)
q postgres "ALTER DATABASE \"$DB\" WITH ALLOW_CONNECTIONS false" >/dev/null
ids_recover_db_state "$DB" "$DIR" >/dev/null && [[ "$(q postgres "SELECT datallowconn FROM pg_database WHERE datname = '$DB'")" == t ]]; step "banco congelado por queda reaberto por ids_recover_db_state" $?

echo "== resultado: $pass OK, $failn falha(s). Bancos do ensaio mantidos; remover com: sudo bash $0 --cleanup =="
[[ "$failn" == 0 ]]
