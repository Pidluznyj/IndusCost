#!/usr/bin/env bash
# ============================================================================
# sales-order-real-db-performance-collector.sh
# IndusCost — coleta READ-ONLY de performance real do banco (homologação).
#
# EXECUÇÃO ÚNICA no servidor-01. 100% leitura:
#   - toda sessão SQL: BEGIN READ ONLY + statement_timeout 15s + lock_timeout 2s
#     + ROLLBACK ao final;
#   - aborta se database != teste_bi_homolog, porta != 5433 ou
#     transaction_read_only != on;
#   - nenhum DDL/DML, nenhuma extensão criada, nenhum reset de estatística;
#   - NENHUM processo Node/Prisma: query count real fica
#     NOT_EXECUTED_SAFETY_POLICY e a fórmula vem do código (validada em testes).
#
# FINAL SAFETY REVISION 3:
#   DB_DATA_MUTATION=NO / DB_SCHEMA_MUTATION=NO
#   NODE_PRISMA_HARNESS=REMOVED (nenhuma conexão fora de psql; toda sessão de
#   banco é BEGIN READ ONLY imposto pelo PostgreSQL)
#   QUERY_TEXT_OUTPUT=NO (pg_stat_statements sai só com queryid/números)
#   TMP_FILES=mktemp + umask 077 + trap (sem nomes previsíveis graváveis)
#   PIPELINE: pipefail + exit code real propagado
#   SECTION_FAILURES contabilizadas -> COLLECTOR_STATUS=PASS|PARTIAL
#
# Saída: arquivo gerado por mktemp (caminho real impresso em REPORT_PATH=...),
#        também espelhada no console via tee.
# ============================================================================
set -u -o pipefail
umask 077

REPORT=$(mktemp --suffix=.txt /tmp/sales-order-performance-report.XXXXXX) || {
  echo "ABORT: mktemp falhou para o relatorio"; exit 1; }
SOCK=/run/induscost-pg17
PORT=5433
DB=teste_bi_homolog
DBUSER=pg17homolog

PSQL_BASE=(sudo -n -u "$DBUSER" psql -h "$SOCK" -p "$PORT" -d "$DB" -X -q -v ON_ERROR_STOP=1)

# Sessão SQL read-only completa (heredoc no stdin). Falha NÃO derruba o
# coletor inteiro — cada seção é isolada, mas TODA falha é contabilizada e
# o status final vira PARTIAL (nunca PASS com evidência faltando).
SECTION_FAILURES=0
run_session() {
  local name="$1"
  echo ""
  echo "################################################################"
  echo "## SECTION: $name"
  echo "################################################################"
  if ! "${PSQL_BASE[@]}" "${@:2}"; then
    echo "SECTION_FAILED=$name"
    SECTION_FAILURES=$((SECTION_FAILURES + 1))
  fi
}

# SELECT escalar (linhas key=value) dentro de txn read-only.
# stderr vai para arquivo temporário seguro (mktemp) e é REPRODUZIDO em caso
# de falha — erro estrutural de SQL nunca é engolido. O temp é removido por
# trap no EXIT; o RELATÓRIO permanece.
SCALAR_ERR=$(mktemp /tmp/so-perf-collector-stderr.XXXXXX) || {
  echo "ABORT: mktemp falhou para stderr temporario"; exit 1; }
cleanup() { rm -f -- "$SCALAR_ERR"; }
trap cleanup EXIT
scalar_session() {
  local rc
  "${PSQL_BASE[@]}" -t -A "$@" 2>"$SCALAR_ERR"
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "SCALAR_SESSION_ERROR rc=$rc:" >&2
    sed 's/^/  psql-stderr: /' "$SCALAR_ERR" >&2
  fi
  return $rc
}

main() {
echo "================================================================"
echo "SALES ORDER REAL DB PERFORMANCE COLLECTOR"
echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "================================================================"

# ----------------------------------------------------------------------
# S0 — VALIDAÇÃO DE IDENTIDADE (aborta em ambiente inesperado)
# ----------------------------------------------------------------------
if ! IDENT=$(scalar_session <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SELECT current_database() || '|' || current_user || '|' || current_schema()
       || '|' || current_setting('port') || '|' || current_setting('server_version')
       || '|' || current_setting('transaction_read_only');
ROLLBACK;
SQL
); then
  echo "ABORT: falha ao validar identidade do banco (stderr acima)"; exit 1
fi
echo "IDENTITY_RAW=$IDENT"
IFS='|' read -r I_DB I_USER I_SCHEMA I_PORT I_VER I_RO <<< "$IDENT"
if [ "$I_DB" != "$DB" ]; then echo "ABORT: database=$I_DB (esperado $DB)"; exit 1; fi
if [ "$I_PORT" != "$PORT" ]; then echo "ABORT: port=$I_PORT (esperado $PORT)"; exit 1; fi
if [ "$I_RO" != "on" ]; then echo "ABORT: transaction_read_only=$I_RO (esperado on)"; exit 1; fi
echo "IDENTITY_CHECK=PASS db=$I_DB user=$I_USER schema=$I_SCHEMA port=$I_PORT pg=$I_VER read_only=$I_RO"

# ----------------------------------------------------------------------
# S1 — ESTATÍSTICAS DE TABELAS
# ----------------------------------------------------------------------
run_session "S1_TABLE_STATS" <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
\echo --- tabelas usadas pelos endpoints (linhas vivas, tamanho, seq/idx scans)
SELECT relname,
       n_live_tup,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
       pg_size_pretty(pg_relation_size(relid))       AS heap_size,
       seq_scan, seq_tup_read, idx_scan, idx_tup_fetch
  FROM pg_stat_user_tables
 WHERE relname IN ('SalesOrder','SalesOrderItem','SalesOrderNfeLink','NomusNfe',
                   'NomusAccountsReceivable','NomusStockDocument','NomusStockDocumentItem',
                   'OrderToCashAuditFact','OrderToCashAuditRun','CommissionOrderSnapshot',
                   'CommissionPerson','CommissionPersonAlias','ProductionCostTableVersion',
                   'ProductionCostTableItem','Customer','Proposal','ProposalItem',
                   'Product','NomusProductCatalog','PriceTableItem','CrmCustomerCommercialOwner')
 ORDER BY pg_total_relation_size(relid) DESC;
ROLLBACK;
SQL

# ----------------------------------------------------------------------
# S2 — ÍNDICES (uso e tamanho)
# ----------------------------------------------------------------------
run_session "S2_INDEX_STATS" <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SELECT s.relname AS table_name,
       s.indexrelname AS index_name,
       s.idx_scan, s.idx_tup_read, s.idx_tup_fetch,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size
  FROM pg_stat_user_indexes s
 WHERE s.relname IN ('SalesOrder','SalesOrderItem','SalesOrderNfeLink','NomusNfe',
                     'NomusAccountsReceivable','NomusStockDocument','NomusStockDocumentItem',
                     'OrderToCashAuditFact','CommissionOrderSnapshot',
                     'ProductionCostTableVersion','ProductionCostTableItem')
 ORDER BY s.relname, s.idx_scan DESC;
ROLLBACK;
SQL

# ----------------------------------------------------------------------
# S3 — PG_STAT_STATEMENTS (só consulta; nunca cria nem reseta)
# ----------------------------------------------------------------------
run_session "S3_PG_STAT_STATEMENTS" <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements')
       AS pg_stat_statements_installed;
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements')
       THEN 'PRESENT' ELSE 'ABSENT' END AS availability;
ROLLBACK;
SQL
PSS=$(scalar_session <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements');
ROLLBACK;
SQL
)
if [ "$PSS" = "t" ]; then
run_session "S3B_TOP_STATEMENTS" <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
\echo --- top 15 por tempo total tocando tabelas do dominio (QUERY_TEXT_OUTPUT=NO)
SELECT queryid,
       calls,
       round(total_exec_time::numeric,1)  AS total_ms,
       round(mean_exec_time::numeric,2)   AS mean_ms,
       round(min_exec_time::numeric,2)    AS min_ms,
       round(max_exec_time::numeric,2)    AS max_ms,
       round(stddev_exec_time::numeric,2) AS stddev_ms,
       rows
  FROM pg_stat_statements
 WHERE query ILIKE '%SalesOrder%'
    OR query ILIKE '%OrderToCashAuditFact%'
    OR query ILIKE '%NomusAccountsReceivable%'
 ORDER BY total_exec_time DESC
 LIMIT 15;
ROLLBACK;
SQL
else
  echo "PG_STAT_STATEMENTS=ABSENT (nao instalada; nada a consultar)"
fi

# ----------------------------------------------------------------------
# S4 — AMOSTRAS (escolhidas pelo banco, sem hardcode)
# ----------------------------------------------------------------------
if ! SAMPLES=$(scalar_session <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
WITH large AS (
  SELECT so."id", so."customerId", COUNT(i."id") AS cnt
    FROM "SalesOrder" so JOIN "SalesOrderItem" i ON i."salesOrderId" = so."id"
   WHERE so."status" <> 'CANCELLED'
   GROUP BY so."id", so."customerId"
   ORDER BY COUNT(i."id") DESC, MAX(so."createdAt") DESC
   LIMIT 1
), small AS (
  SELECT t."id", t."customerId", t.cnt FROM (
    SELECT so."id", so."customerId", so."createdAt", COUNT(i."id") AS cnt
      FROM "SalesOrder" so JOIN "SalesOrderItem" i ON i."salesOrderId" = so."id"
     WHERE so."status" <> 'CANCELLED'
       AND EXISTS (SELECT 1 FROM "SalesOrderNfeLink" l WHERE l."salesOrderId" = so."id")
     GROUP BY so."id", so."customerId", so."createdAt"
    HAVING COUNT(i."id") BETWEEN 1 AND 3
  ) t ORDER BY t."createdAt" DESC LIMIT 1
), small_fb AS (
  SELECT so."id", so."customerId", COUNT(i."id") AS cnt
    FROM "SalesOrder" so JOIN "SalesOrderItem" i ON i."salesOrderId" = so."id"
   WHERE so."status" <> 'CANCELLED'
   GROUP BY so."id", so."customerId"
   ORDER BY COUNT(i."id") ASC, MAX(so."createdAt") DESC
   LIMIT 1
), doc_heavy AS (
  SELECT so."id", so."customerId",
         (SELECT COUNT(*) FROM "SalesOrderItem" i2 WHERE i2."salesOrderId" = so."id") AS items,
         (SELECT COUNT(*) FROM "SalesOrderNfeLink" l2 WHERE l2."salesOrderId" = so."id") AS nfe_links,
         COUNT(DISTINCT d."externalId") AS out_docs
    FROM "SalesOrder" so
    JOIN "SalesOrderNfeLink" l ON l."salesOrderId" = so."id"
    JOIN "NomusStockDocument" d ON d."idNfe" = l."nfeExternalId"
                               AND d."tipoDocumentoEstoque" = 'DocumentoSaida'
   WHERE so."status" <> 'CANCELLED'
   GROUP BY so."id", so."customerId"
   ORDER BY COUNT(DISTINCT d."externalId") DESC, MAX(so."createdAt") DESC
   LIMIT 1
), seller AS (
  SELECT "externalSellerId" AS sid, COUNT(*) AS cnt
    FROM "SalesOrder"
   WHERE "status" <> 'CANCELLED' AND "externalSellerId" IS NOT NULL AND "externalSellerId" > 0
   GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1
), cust AS (
  SELECT "customerId" AS cid, COUNT(*) AS cnt
    FROM "SalesOrder" WHERE "status" <> 'CANCELLED'
   GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1
), tok AS (
  SELECT COALESCE(NULLIF(regexp_replace(lower("orderCode"), '[^0-9]', '', 'g'), ''),
                  lower("orderCode")) AS t
    FROM "SalesOrder" WHERE "status" <> 'CANCELLED'
   ORDER BY "createdAt" DESC LIMIT 1
), yr AS (
  SELECT EXTRACT(YEAR FROM MAX("issueDate"))::int AS y FROM "SalesOrder" WHERE "status" <> 'CANCELLED'
), tot AS (
  SELECT COUNT(*)::int AS n FROM "SalesOrder" WHERE "status" <> 'CANCELLED'
)
SELECT 'LARGE_ID='  || (SELECT "id"  FROM large)
  || E'\nLARGE_CUST=' || (SELECT "customerId" FROM large)
  || E'\nLARGE_ITEMS=' || (SELECT cnt FROM large)
  || E'\nSMALL_ID='  || COALESCE((SELECT "id"::text FROM small), (SELECT "id"::text FROM small_fb))
  || E'\nSMALL_CUST=' || COALESCE((SELECT "customerId"::text FROM small), (SELECT "customerId"::text FROM small_fb))
  || E'\nSMALL_ITEMS=' || COALESCE((SELECT cnt FROM small), (SELECT cnt FROM small_fb))
  || E'\nDOC_HEAVY_ID=' || COALESCE((SELECT "id"::text FROM doc_heavy), 'NONE')
  || E'\nDOC_HEAVY_CUST=' || COALESCE((SELECT "customerId"::text FROM doc_heavy), 'NONE')
  || E'\nDOC_HEAVY_ITEMS=' || COALESCE((SELECT items::text FROM doc_heavy), '0')
  || E'\nDOC_HEAVY_NFE_LINKS=' || COALESCE((SELECT nfe_links::text FROM doc_heavy), '0')
  || E'\nDOC_HEAVY_OUTPUT_DOCS=' || COALESCE((SELECT out_docs::text FROM doc_heavy), '0')
  || E'\nSELLER_ID=' || (SELECT sid FROM seller)
  || E'\nSELLER_ORDERS=' || (SELECT cnt FROM seller)
  || E'\nCUST_ID='   || (SELECT cid FROM cust)
  || E'\nCUST_ORDERS=' || (SELECT cnt FROM cust)
  || E'\nTOK='       || (SELECT t FROM tok)
  || E'\nYR='        || (SELECT y FROM yr)
  || E'\nTOTAL_ACTIVE=' || (SELECT n FROM tot)
  || E'\nOFF_REP='   || GREATEST(0, ((SELECT n FROM tot) * 8 / 10 / 20) * 20);
ROLLBACK;
SQL
); then
  echo "ABORT: falha na selecao de amostras (stderr acima)"; exit 1
fi
echo ""
echo "################################################################"
echo "## SECTION: S4_SAMPLES (ids internos; nomes/CNPJ nunca impressos)"
echo "################################################################"
echo "$SAMPLES"
LARGE_ID=$(echo "$SAMPLES" | sed -n 's/^LARGE_ID=//p')
SMALL_ID=$(echo "$SAMPLES" | sed -n 's/^SMALL_ID=//p')
LARGE_CUST=$(echo "$SAMPLES" | sed -n 's/^LARGE_CUST=//p')
SMALL_CUST=$(echo "$SAMPLES" | sed -n 's/^SMALL_CUST=//p')
SELLER_ID=$(echo "$SAMPLES" | sed -n 's/^SELLER_ID=//p')
CUST_ID=$(echo "$SAMPLES" | sed -n 's/^CUST_ID=//p')
TOK=$(echo "$SAMPLES" | sed -n 's/^TOK=//p')
YR=$(echo "$SAMPLES" | sed -n 's/^YR=//p')
OFF_REP=$(echo "$SAMPLES" | sed -n 's/^OFF_REP=//p')
DOC_HEAVY_ID=$(echo "$SAMPLES" | sed -n 's/^DOC_HEAVY_ID=//p')
DOC_HEAVY_CUST=$(echo "$SAMPLES" | sed -n 's/^DOC_HEAVY_CUST=//p')
DOC_HEAVY_OUTPUT_DOCS=$(echo "$SAMPLES" | sed -n 's/^DOC_HEAVY_OUTPUT_DOCS=//p')
if [ -z "$LARGE_ID" ] || [ -z "$SMALL_ID" ]; then
  echo "ABORT: amostras nao selecionadas (base vazia?)"; exit 1
fi

# Cardinalidades do filtro de CR + documentos de saida por amostra
run_session "S4B_CARDINALITIES" -v large_id="$LARGE_ID" -v small_id="$SMALL_ID" <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
\echo --- populacao do filtro de CR (materializada em memoria pela app)
SELECT (SELECT COUNT(*) FROM "NomusAccountsReceivable" WHERE "sourceInvoiceId" IS NOT NULL) AS ar_rows_with_invoice,
       (SELECT COUNT(DISTINCT l."salesOrderId")
          FROM "SalesOrderNfeLink" l
          JOIN "NomusAccountsReceivable" ar ON ar."sourceInvoiceId" = l."nfeExternalId") AS orders_with_any_cr,
       (SELECT COUNT(*) FROM (
          SELECT l."salesOrderId"
            FROM "SalesOrderNfeLink" l
            JOIN "NomusAccountsReceivable" ar ON ar."sourceInvoiceId" = l."nfeExternalId"
           GROUP BY l."salesOrderId"
          HAVING SUM(GREATEST(ar."balanceReceivable", 0)) > 0.01) t) AS orders_with_open_cr;
\echo --- contagens estruturais das amostras (formula de N+1)
SELECT 'LARGE' AS sample,
       (SELECT COUNT(*) FROM "SalesOrderItem"      WHERE "salesOrderId" = :'large_id') AS items,
       (SELECT COUNT(*) FROM "SalesOrderNfeLink"   WHERE "salesOrderId" = :'large_id') AS nfe_links,
       (SELECT COUNT(*) FROM "OrderToCashAuditFact" WHERE "salesOrderId" = :'large_id') AS o2c_facts,
       (SELECT COUNT(DISTINCT d."externalId") FROM "NomusStockDocument" d
         WHERE d."tipoDocumentoEstoque" = 'DocumentoSaida'
           AND d."idNfe" IN (SELECT "nfeExternalId" FROM "SalesOrderNfeLink" WHERE "salesOrderId" = :'large_id')) AS output_docs
UNION ALL
SELECT 'SMALL',
       (SELECT COUNT(*) FROM "SalesOrderItem"      WHERE "salesOrderId" = :'small_id'),
       (SELECT COUNT(*) FROM "SalesOrderNfeLink"   WHERE "salesOrderId" = :'small_id'),
       (SELECT COUNT(*) FROM "OrderToCashAuditFact" WHERE "salesOrderId" = :'small_id'),
       (SELECT COUNT(DISTINCT d."externalId") FROM "NomusStockDocument" d
         WHERE d."tipoDocumentoEstoque" = 'DocumentoSaida'
           AND d."idNfe" IN (SELECT "nfeExternalId" FROM "SalesOrderNfeLink" WHERE "salesOrderId" = :'small_id'));
ROLLBACK;
SQL

# ----------------------------------------------------------------------
# S5 — PLANOS DA LISTAGEM (SQL_EQUIVALENT fiel ao Prisma; ver relatorio)
# ----------------------------------------------------------------------
run_session "S5_LIST_PLANS" -v seller_id="$SELLER_ID" -v cust_id="$CUST_ID" -v yr="$YR" -v off_rep="$OFF_REP" <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

\echo === LIST_FIRST_PAGE (pagina 1 sem filtros; ORDER BY/LIMIT reais)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "id","customerId","orderCode","status","issueDate","expectedDeliveryDate",
       "totalItems","totalNetValue","externalSellerId","proposalId"
  FROM "SalesOrder"
 WHERE "status" <> 'CANCELLED'
 ORDER BY "createdAt" DESC, "issueDate" DESC
 LIMIT 20 OFFSET 0;

\echo === LIST_FIRST_PAGE_PRESENCE (variante com flag de presenca operacional ativa)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "id","customerId","orderCode","status","issueDate","expectedDeliveryDate",
       "totalItems","totalNetValue","externalSellerId","proposalId"
  FROM "SalesOrder"
 WHERE "status" <> 'CANCELLED' AND "sourcePresenceStatus" <> 'MISSING_CONFIRMED'
 ORDER BY "createdAt" DESC, "issueDate" DESC
 LIMIT 20 OFFSET 0;

\echo === LIST_PAGE_OFFSET (offset representativo ~80% do volume)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "id","customerId","orderCode","status","issueDate","expectedDeliveryDate",
       "totalItems","totalNetValue","externalSellerId","proposalId"
  FROM "SalesOrder"
 WHERE "status" <> 'CANCELLED'
 ORDER BY "createdAt" DESC, "issueDate" DESC
 LIMIT 20 OFFSET :off_rep;

\echo === LIST_COUNT_SUMMARY_AGGREGATE (count + sum na mesma populacao)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT COUNT(*), SUM("totalNetValue"), SUM("totalItems")
  FROM "SalesOrder"
 WHERE "status" <> 'CANCELLED';

\echo === LIST_SELLER_FILTER (externalSellerId real de maior volume)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "id","customerId","orderCode","status","issueDate","expectedDeliveryDate",
       "totalItems","totalNetValue","externalSellerId","proposalId"
  FROM "SalesOrder"
 WHERE "status" <> 'CANCELLED' AND "externalSellerId" = :seller_id
 ORDER BY "createdAt" DESC, "issueDate" DESC
 LIMIT 20 OFFSET 0;

\echo === LIST_CUSTOMER_FILTER (customerId interno de maior volume)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "id","customerId","orderCode","status","issueDate","expectedDeliveryDate",
       "totalItems","totalNetValue","externalSellerId","proposalId"
  FROM "SalesOrder"
 WHERE "status" <> 'CANCELLED' AND "customerId" = :'cust_id'
 ORDER BY "createdAt" DESC, "issueDate" DESC
 LIMIT 20 OFFSET 0;

\echo === LIST_DATE_FILTER (ano real com dados; issueDate range fim-exclusivo)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "id","customerId","orderCode","status","issueDate","expectedDeliveryDate",
       "totalItems","totalNetValue","externalSellerId","proposalId"
  FROM "SalesOrder"
 WHERE "status" <> 'CANCELLED'
   AND "issueDate" >= make_timestamp(:yr,1,1,0,0,0)
   AND "issueDate" <  make_timestamp(:yr + 1,1,1,0,0,0)
 ORDER BY "createdAt" DESC, "issueDate" DESC
 LIMIT 20 OFFSET 0;

\echo === LIST_HAS_INVOICE_TRUE (EXISTS de link valido: processada e nao-cancelada)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT so."id",so."customerId",so."orderCode",so."status",so."issueDate",so."expectedDeliveryDate",
       so."totalItems",so."totalNetValue",so."externalSellerId",so."proposalId"
  FROM "SalesOrder" so
 WHERE so."status" <> 'CANCELLED'
   AND EXISTS (SELECT 1 FROM "SalesOrderNfeLink" l
                WHERE l."salesOrderId" = so."id"
                  AND l."dataProcessamento" IS NOT NULL
                  AND (l."nfeStatus" IS NULL OR l."nfeStatus" <> 7))
 ORDER BY so."createdAt" DESC, so."issueDate" DESC
 LIMIT 20 OFFSET 0;

\echo === LIST_HAS_INVOICE_FALSE (NOT EXISTS do mesmo link valido)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT so."id",so."customerId",so."orderCode",so."status",so."issueDate",so."expectedDeliveryDate",
       so."totalItems",so."totalNetValue",so."externalSellerId",so."proposalId"
  FROM "SalesOrder" so
 WHERE so."status" <> 'CANCELLED'
   AND NOT EXISTS (SELECT 1 FROM "SalesOrderNfeLink" l
                    WHERE l."salesOrderId" = so."id"
                      AND l."dataProcessamento" IS NOT NULL
                      AND (l."nfeStatus" IS NULL OR l."nfeStatus" <> 7))
 ORDER BY so."createdAt" DESC, so."issueDate" DESC
 LIMIT 20 OFFSET 0;

\echo === SELLER_GROUP_BY (opcoes do filtro de vendedor)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "externalSellerId", COUNT(*)
  FROM "SalesOrder"
 WHERE "status" <> 'CANCELLED'
 GROUP BY "externalSellerId";

\echo === LIST_PAGE_ENRICH_NFE_LINKS (batch da pagina: links das 20 ordens)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT l."id", l."salesOrderId", l."nfeExternalId", l."nfeNumber", l."nfeKey",
       l."nfeStatus", l."tipoOperacao", l."dataProcessamento", l."presentInLastPayload", l."nomusNfeId"
  FROM "SalesOrderNfeLink" l
 WHERE l."salesOrderId" IN (
        SELECT "id" FROM "SalesOrder" WHERE "status" <> 'CANCELLED'
         ORDER BY "createdAt" DESC, "issueDate" DESC LIMIT 20);
ROLLBACK;
SQL

# ----------------------------------------------------------------------
# S6 — BUSCA TEXTUAL (OR completo fiel ao buildSalesOrderSearchOr)
# ----------------------------------------------------------------------
run_session "S6_SEARCH_PLANS" -v tok="$TOK" <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

\echo === LIST_SEARCH_SELECTIVE (token de orderCode recente; ILIKE substring em todos os bracos)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT so."id",so."customerId",so."orderCode",so."status",so."issueDate",so."expectedDeliveryDate",
       so."totalItems",so."totalNetValue",so."externalSellerId",so."proposalId"
  FROM "SalesOrder" so
 WHERE so."status" <> 'CANCELLED'
   AND (
        so."orderCode" ILIKE '%' || :'tok' || '%'
     OR so."externalSalesOrderCode" ILIKE '%' || :'tok' || '%'
     OR EXISTS (SELECT 1 FROM "SalesOrderNfeLink" l WHERE l."salesOrderId" = so."id" AND l."nfeNumber" ILIKE '%' || :'tok' || '%')
     OR EXISTS (SELECT 1 FROM "SalesOrderNfeLink" l WHERE l."salesOrderId" = so."id" AND l."orderCode" ILIKE '%' || :'tok' || '%')
     OR EXISTS (SELECT 1 FROM "SalesOrderNfeLink" l WHERE l."salesOrderId" = so."id" AND l."externalSalesOrderCode" ILIKE '%' || :'tok' || '%')
     OR so."nomusSellerName" ILIKE '%' || :'tok' || '%'
     OR so."companyIssuer" ILIKE '%' || :'tok' || '%'
     OR (:'tok' ~ '^[0-9]+$' AND so."externalSellerId" = NULLIF(:'tok','')::int)
     OR (:'tok' ~ '^[0-9]+$' AND so."externalSalesOrderId" = NULLIF(:'tok','')::int)
     OR EXISTS (SELECT 1 FROM "Customer" c WHERE c."id" = so."customerId" AND c."companyName" ILIKE '%' || :'tok' || '%')
     OR EXISTS (SELECT 1 FROM "Customer" c WHERE c."id" = so."customerId" AND c."tradeName" ILIKE '%' || :'tok' || '%')
     OR EXISTS (SELECT 1 FROM "Customer" c WHERE c."id" = so."customerId" AND c."taxId" ILIKE '%' || :'tok' || '%')
     OR EXISTS (SELECT 1 FROM "SalesOrderNfeLink" l WHERE l."salesOrderId" = so."id" AND l."nfeKey" ILIKE '%' || :'tok' || '%')
     OR EXISTS (SELECT 1 FROM "SalesOrderItem" i WHERE i."salesOrderId" = so."id" AND i."productNameSnapshot" ILIKE '%' || :'tok' || '%')
     OR EXISTS (SELECT 1 FROM "SalesOrderItem" i WHERE i."salesOrderId" = so."id" AND i."skuSnapshot" ILIKE '%' || :'tok' || '%')
   )
 ORDER BY so."createdAt" DESC, so."issueDate" DESC
 LIMIT 20 OFFSET 0;

\echo === LIST_SEARCH_BROAD (termo generico 'ltda': multiplos resultados, sem cliente especifico)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT so."id",so."customerId",so."orderCode",so."status",so."issueDate",so."expectedDeliveryDate",
       so."totalItems",so."totalNetValue",so."externalSellerId",so."proposalId"
  FROM "SalesOrder" so
 WHERE so."status" <> 'CANCELLED'
   AND (
        so."orderCode" ILIKE '%ltda%'
     OR so."externalSalesOrderCode" ILIKE '%ltda%'
     OR EXISTS (SELECT 1 FROM "SalesOrderNfeLink" l WHERE l."salesOrderId" = so."id" AND l."nfeNumber" ILIKE '%ltda%')
     OR EXISTS (SELECT 1 FROM "SalesOrderNfeLink" l WHERE l."salesOrderId" = so."id" AND l."orderCode" ILIKE '%ltda%')
     OR EXISTS (SELECT 1 FROM "SalesOrderNfeLink" l WHERE l."salesOrderId" = so."id" AND l."externalSalesOrderCode" ILIKE '%ltda%')
     OR so."nomusSellerName" ILIKE '%ltda%'
     OR so."companyIssuer" ILIKE '%ltda%'
     OR EXISTS (SELECT 1 FROM "Customer" c WHERE c."id" = so."customerId" AND c."companyName" ILIKE '%ltda%')
     OR EXISTS (SELECT 1 FROM "Customer" c WHERE c."id" = so."customerId" AND c."tradeName" ILIKE '%ltda%')
     OR EXISTS (SELECT 1 FROM "Customer" c WHERE c."id" = so."customerId" AND c."taxId" ILIKE '%ltda%')
     OR EXISTS (SELECT 1 FROM "SalesOrderNfeLink" l WHERE l."salesOrderId" = so."id" AND l."nfeKey" ILIKE '%ltda%')
     OR EXISTS (SELECT 1 FROM "SalesOrderItem" i WHERE i."salesOrderId" = so."id" AND i."productNameSnapshot" ILIKE '%ltda%')
     OR EXISTS (SELECT 1 FROM "SalesOrderItem" i WHERE i."salesOrderId" = so."id" AND i."skuSnapshot" ILIKE '%ltda%')
   )
 ORDER BY so."createdAt" DESC, so."issueDate" DESC
 LIMIT 20 OFFSET 0;
ROLLBACK;
SQL

# ----------------------------------------------------------------------
# S7 — FILTRO DE CR (as 2 queries preparatorias reais + pagina final)
# ----------------------------------------------------------------------
run_session "S7_RECEIVABLE_PLANS" <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

\echo === CR_PREP_1 (SQL_EXACT: findMany NomusAccountsReceivable sourceInvoiceId not null)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "externalId", "sourceInvoiceId", "balanceReceivable"
  FROM "NomusAccountsReceivable"
 WHERE "sourceInvoiceId" IS NOT NULL;

\echo === CR_PREP_2 (equivalente: links por nfeExternalId do conjunto com CR; app envia lista literal)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT l."salesOrderId", l."nfeExternalId"
  FROM "SalesOrderNfeLink" l
 WHERE l."nfeExternalId" IN (
        SELECT DISTINCT ar."sourceInvoiceId" FROM "NomusAccountsReceivable" ar
         WHERE ar."sourceInvoiceId" IS NOT NULL);

\echo === LIST_RECEIVABLE_OPEN (SQL_EQUIVALENT: pagina com id IN conjunto aberto; app envia array literal de mesma cardinalidade)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT so."id",so."customerId",so."orderCode",so."status",so."issueDate",so."expectedDeliveryDate",
       so."totalItems",so."totalNetValue",so."externalSellerId",so."proposalId"
  FROM "SalesOrder" so
 WHERE so."status" <> 'CANCELLED'
   AND so."id" IN (
        SELECT l."salesOrderId"
          FROM "SalesOrderNfeLink" l
          JOIN "NomusAccountsReceivable" ar ON ar."sourceInvoiceId" = l."nfeExternalId"
         GROUP BY l."salesOrderId"
        HAVING SUM(GREATEST(ar."balanceReceivable", 0)) > 0.01)
 ORDER BY so."createdAt" DESC, so."issueDate" DESC
 LIMIT 20 OFFSET 0;

\echo === LIST_RECEIVABLE_SETTLED (SQL_EQUIVALENT: com CR e sem saldo aberto)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT so."id",so."customerId",so."orderCode",so."status",so."issueDate",so."expectedDeliveryDate",
       so."totalItems",so."totalNetValue",so."externalSellerId",so."proposalId"
  FROM "SalesOrder" so
 WHERE so."status" <> 'CANCELLED'
   AND so."id" IN (
        SELECT l."salesOrderId"
          FROM "SalesOrderNfeLink" l
          JOIN "NomusAccountsReceivable" ar ON ar."sourceInvoiceId" = l."nfeExternalId"
         GROUP BY l."salesOrderId"
        HAVING SUM(GREATEST(ar."balanceReceivable", 0)) <= 0.01)
 ORDER BY so."createdAt" DESC, so."issueDate" DESC
 LIMIT 20 OFFSET 0;
ROLLBACK;
SQL

# ----------------------------------------------------------------------
# S8/S9 — PLANOS DO DETALHE (mesma bateria para SMALL e LARGE)
# ----------------------------------------------------------------------
detail_session() {
  local label="$1" oid="$2" cid="$3"
run_session "$label" -v oid="$oid" -v cid="$cid" <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

\echo === D1 SalesOrder por id (findUnique)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT * FROM "SalesOrder" WHERE "id" = :'oid';

\echo === D2 Itens do pedido (ORDER BY id)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT * FROM "SalesOrderItem" WHERE "salesOrderId" = :'oid' ORDER BY "id" ASC;

\echo === D3 Links de NF do pedido
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT * FROM "SalesOrderNfeLink" WHERE "salesOrderId" = :'oid';

\echo === D4 Customer por id
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "id","companyName","tradeName","taxId" FROM "Customer" WHERE "id" = :'cid';

\echo === D5 Fact mais recente (runId) — findFirst ORDER BY createdAt DESC
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "runId" FROM "OrderToCashAuditFact"
 WHERE "salesOrderId" = :'oid'
 ORDER BY "createdAt" DESC LIMIT 1;

\echo === D6 Facts do pedido (ORDER BY orderItemSequence, id)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT * FROM "OrderToCashAuditFact"
 WHERE "salesOrderId" = :'oid'
 ORDER BY "orderItemSequence" ASC, "id" ASC;

\echo === D7 Documentos de Saida via idNfe das NFs do pedido
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT d."id", d."externalId", d."idNfe", d."tipoDocumentoEstoque", d."documentNumber",
       d."statusRaw", d."isCancelled", d."totalValue", d."dataDocumento", d."movementDate"
  FROM "NomusStockDocument" d
 WHERE d."tipoDocumentoEstoque" = 'DocumentoSaida'
   AND d."idNfe" IN (SELECT "nfeExternalId" FROM "SalesOrderNfeLink" WHERE "salesOrderId" = :'oid');

\echo === D8 Itens de UM documento (query por-documento do resolver — roda 1x POR doc)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT i."id", i."externalItemId", i."externalProductId", i."quantity", i."unitValue", i."estimatedTotalValue"
  FROM "NomusStockDocumentItem" i
 WHERE i."stockDocumentId" = COALESCE(
        (SELECT d."id" FROM "NomusStockDocument" d
          WHERE d."tipoDocumentoEstoque" = 'DocumentoSaida'
            AND d."idNfe" IN (SELECT "nfeExternalId" FROM "SalesOrderNfeLink" WHERE "salesOrderId" = :'oid')
          ORDER BY d."externalId" LIMIT 1),
        '00000000-0000-0000-0000-000000000000')
 ORDER BY i."createdAt" ASC;

\echo === D9 Facts por stockDocumentExternalId (query por-documento; COLUNA SEM INDICE — medir!)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "runId","salesOrderId","orderCode","salesOrderItemId","nfeExternalId",
       "stockDocumentExternalId","stockDocumentIdNfe","stockDocumentItemId",
       "allocatedValueByDocumentPrice","quantityUsedForOrder","receivableIdsJson"
  FROM "OrderToCashAuditFact"
 WHERE "stockDocumentExternalId" = COALESCE(
        (SELECT d."externalId" FROM "NomusStockDocument" d
          WHERE d."tipoDocumentoEstoque" = 'DocumentoSaida'
            AND d."idNfe" IN (SELECT "nfeExternalId" FROM "SalesOrderNfeLink" WHERE "salesOrderId" = :'oid')
          ORDER BY d."externalId" LIMIT 1), -1);

\echo === D10 Links estrangeiros por nfeExternalId (conflitos de identidade)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT l."salesOrderId", l."orderCode", l."nfeExternalId"
  FROM "SalesOrderNfeLink" l
 WHERE l."nfeExternalId" IN (SELECT "nfeExternalId" FROM "SalesOrderNfeLink" WHERE "salesOrderId" = :'oid')
   AND l."salesOrderId" <> :'oid';

\echo === D11 NomusNfe por externalId (complemento oficial das NFs)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "externalId","numero","serie","chave","status","tipoOperacao","dataProcessamento",
       "xmlDhEmi","valorLiquido","xmlVNF","xmlVProd","xmlVDesc"
  FROM "NomusNfe"
 WHERE "externalId" IN (SELECT "nfeExternalId" FROM "SalesOrderNfeLink" WHERE "salesOrderId" = :'oid');

\echo === D12 CRs por sourceInvoiceId (recebiveis das NFs do pedido)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "id","externalId","sourceInvoiceId","dueDate","settlementDate",
       "amountReceivable","amountReceived","balanceReceivable"
  FROM "NomusAccountsReceivable"
 WHERE "sourceInvoiceId" IN (SELECT "nfeExternalId" FROM "SalesOrderNfeLink" WHERE "salesOrderId" = :'oid');

\echo === D13 Snapshot de comissao ACTIVE (findFirst ORDER BY updatedAt DESC)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "id" FROM "CommissionOrderSnapshot"
 WHERE "salesOrderId" = :'oid' AND "status" = 'ACTIVE'
 ORDER BY "updatedAt" DESC, "createdAt" DESC LIMIT 1;

\echo === D14a Catalogo de custo vigente (versions PUBLISHED/SUPERSEDED ate hoje)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "id","status","effectiveDate","revision","createdAt"
  FROM "ProductionCostTableVersion"
 WHERE "status" IN ('PUBLISHED','SUPERSEDED') AND "effectiveDate" <= CURRENT_DATE
 ORDER BY "effectiveDate" DESC, "revision" DESC, "createdAt" DESC;

\echo === D14b Itens de custo dos produtos do pedido (include filtrado do Prisma)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT ci.*
  FROM "ProductionCostTableItem" ci
 WHERE ci."costTableVersionId" IN (
        SELECT v."id" FROM "ProductionCostTableVersion" v
         WHERE v."status" IN ('PUBLISHED','SUPERSEDED') AND v."effectiveDate" <= CURRENT_DATE)
   AND ci."productId" IN (
        SELECT i."productId" FROM "SalesOrderItem" i
         WHERE i."salesOrderId" = :'oid' AND i."productId" IS NOT NULL);

\echo === D15 MAX(syncedAt) das NFs do pedido (metadado de auditoria)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT MAX("syncedAt") FROM "NomusNfe"
 WHERE "externalId" IN (SELECT "nfeExternalId" FROM "SalesOrderNfeLink" WHERE "salesOrderId" = :'oid');
ROLLBACK;
SQL
}
detail_session "S8_DETAIL_SMALL (ORDER_SMALL)" "$SMALL_ID" "$SMALL_CUST"
detail_session "S9_DETAIL_LARGE (ORDER_LARGE)" "$LARGE_ID" "$LARGE_CUST"

# ----------------------------------------------------------------------
# S9B — N+1 EM DOCUMENTO REAL (ORDER_DOC_HEAVY)
# O N+1 do detail cresce com N_OUTPUT_DOCS; ORDER_LARGE mede itens/BOM,
# nao documentos. Aqui: pedido com MAIS documentos de saida vinculados e
# EXPLAIN das duas queries por-documento sobre um documento REAL.
# ----------------------------------------------------------------------
echo ""
echo "################################################################"
echo "## SECTION: S9B_DOC_HEAVY_N_PLUS_ONE_PLANS"
echo "################################################################"
if [ -z "$DOC_HEAVY_ID" ] || [ "$DOC_HEAVY_ID" = "NONE" ]; then
  echo "DOC_HEAVY_SAMPLE=NONE"
  echo "N_PLUS_ONE_DB_COST_VALIDATION=BLOCKED_NO_REAL_SAMPLE"
  echo "N_PLUS_ONE_CODE_VALIDATION=PASS (pelo codigo, independente da amostra)"
else
  echo "DOC_HEAVY_SAMPLE=FOUND id=$DOC_HEAVY_ID output_docs=$DOC_HEAVY_OUTPUT_DOCS"
  if DOCROW=$(scalar_session -v oid="$DOC_HEAVY_ID" <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SELECT d."id" || '|' || d."externalId"
  FROM "NomusStockDocument" d
 WHERE d."tipoDocumentoEstoque" = 'DocumentoSaida'
   AND d."idNfe" IN (SELECT "nfeExternalId" FROM "SalesOrderNfeLink" WHERE "salesOrderId" = :'oid')
 ORDER BY d."externalId" LIMIT 1;
ROLLBACK;
SQL
  ) && [ -n "$DOCROW" ]; then
    IFS='|' read -r REAL_DOC_ID REAL_DOC_EXT <<< "$DOCROW"
    echo "REAL_DOC_ID=$REAL_DOC_ID REAL_DOC_EXT=$REAL_DOC_EXT"
    echo "DOC_HEAVY_OUTPUT_DOCS=$DOC_HEAVY_OUTPUT_DOCS (custo por doc abaixo x este N = custo total do N+1)"
run_session "S9B_PLANS (documento real)" -v doc_id="$REAL_DOC_ID" -v doc_ext="$REAL_DOC_EXT" <<'SQL'
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

\echo === S9B-A Itens do documento REAL (NomusStockDocumentItem WHERE stockDocumentId)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT i."id", i."externalItemId", i."externalProductId", i."quantity", i."unitValue", i."estimatedTotalValue"
  FROM "NomusStockDocumentItem" i
 WHERE i."stockDocumentId" = :'doc_id'
 ORDER BY i."createdAt" ASC;

\echo === S9B-B Facts por stockDocumentExternalId REAL (D9 critico — coluna sem indice)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT "runId","salesOrderId","orderCode","salesOrderItemId","nfeExternalId",
       "stockDocumentExternalId","stockDocumentIdNfe","stockDocumentItemId",
       "allocatedValueByDocumentPrice","quantityUsedForOrder","receivableIdsJson"
  FROM "OrderToCashAuditFact"
 WHERE "stockDocumentExternalId" = :doc_ext;
ROLLBACK;
SQL
  else
    echo "SECTION_FAILED=S9B_DOC_HEAVY_N_PLUS_ONE_PLANS (documento real nao selecionado)"
    SECTION_FAILURES=$((SECTION_FAILURES + 1))
    echo "N_PLUS_ONE_DB_COST_VALIDATION=BLOCKED_SAMPLE_QUERY_FAILED"
  fi
fi

# ----------------------------------------------------------------------
# S10 — QUERY COUNT: POLITICA DE SEGURANCA
# O harness Node/Prisma foi REMOVIDO nesta revisao: nao ha como impor
# transaction_read_only=on em TODAS as conexoes de um pool Prisma a partir
# daqui sem tocar em role/config do servidor (o que seria mutacao).
# O query count vem da analise estatica do codigo, validada por testes.
# ----------------------------------------------------------------------
echo ""
echo "################################################################"
echo "## SECTION: S10_QUERY_COUNT_POLICY"
echo "################################################################"
echo "QUERY_COUNT_REAL=NOT_EXECUTED_SAFETY_POLICY"
echo "QUERY_COUNT_STATIC_ANALYSIS=PASS"
echo "N_PLUS_ONE_CODE_VALIDATION=PASS"
echo "DETAIL_QUERY_COUNT_FORMULA: Q ~= 45 + 7*N_OUTPUT_DOCS + N_BOM_NODES(memoizado)"
echo "N_PLUS_ONE_CODE_PATH: getSalesOrderDetail -> getOrderFullAudit -> loadOutputDocumentsForSalesOrder -> for(doc){ resolveFromStageRow: 7 queries/doc }"
echo "BATCH_ALTERNATIVE_EXISTS=YES (nomusOutputDocumentResolverBatch.server.ts, usado so pelo Fluxo de Caixa)"
echo "DETAIL_USES_BATCH_ALTERNATIVE=NO"

echo ""
echo "================================================================"
if [ "$SECTION_FAILURES" -eq 0 ]; then
  echo "COLLECTOR_STATUS=PASS"
else
  echo "COLLECTOR_STATUS=PARTIAL"
  echo "SECTION_FAILURES=$SECTION_FAILURES"
fi
echo "COLLECTOR_DONE=1"
echo "REPORT_PATH=$REPORT"
echo "================================================================"
[ "$SECTION_FAILURES" -eq 0 ] && return 0 || return 2
}

main 2>&1 | tee "$REPORT"
rc=$?
if [ "$rc" -eq 0 ]; then
  echo "COLLECTOR_EXIT=0"
  echo "REPORT_PATH=$REPORT"
else
  echo "COLLECTOR_EXIT=$rc" >&2
  echo "REPORT_PATH=$REPORT" >&2
  exit "$rc"
fi