-- Auditoria SOMENTE LEITURA de status e cancelamentos de Pedidos de Venda Nomus no IndusCost.
-- Documentacao, comandos por ambiente e leitura: docs/sales/sales-order-nomus-status-lifecycle.md
--
-- Garantias: transacao READ ONLY encerrada com ROLLBACK; so SELECT; lock_timeout curto; statement_timeout por
-- consulta; PostgreSQL 12 e 17; roda ANTES da migration 20261102120000 (o historico de status, que depende dela,
-- e consultado so se a tabela existir). Saida sem nome de cliente nem documento: so codigos de pedido, contagens,
-- valores e NOMES/VALORES de campos de status.
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '3s';
SET LOCAL idle_in_transaction_session_timeout = '10min';

\echo '== S0. Alvo da auditoria (producao AWS = PG17/teste_bi; homologacao = PG17/teste_bi_homolog; PG12 do servidor-01 = legado)'
SELECT current_database() AS banco, current_setting('server_version') AS versao,
       current_setting('transaction_read_only') AS somente_leitura, now() AS executado_em;

-- S1. Campos de status do CABECALHO no payload real (nomes e valores distintos; nenhum dado pessoal).
\echo '== S1. Status de cabecalho presentes no payload Nomus'
SELECT k.key AS campo, jsonb_typeof(k.value) AS tipo, left(k.value::text, 60) AS valor, count(*) AS pedidos
FROM "SalesOrder" so, LATERAL jsonb_each(so."nomusRawResponse") k
WHERE so."sourceSystem" = 'NOMUS' AND jsonb_typeof(so."nomusRawResponse") = 'object'
  AND k.key ~* '^(status|situacao|situacaoPedido|statusPedido|descricaoStatus|cancelado|ativo)$'
GROUP BY 1, 2, 3 ORDER BY 1, 4 DESC LIMIT 60;

-- S1b. Campos de data/motivo de cancelamento, reativacao ou ultima alteracao (so nomes e frequencia).
SELECT 'pedido' AS onde, k AS campo, count(*) AS ocorrencias
FROM "SalesOrder" so, LATERAL jsonb_object_keys(so."nomusRawResponse") k
WHERE so."sourceSystem" = 'NOMUS' AND jsonb_typeof(so."nomusRawResponse") = 'object'
  AND k ~* '(cancel|motivo|reativ|alterac|atualiz|modific)'
GROUP BY 1, 2
UNION ALL
SELECT 'item', k, count(*)
FROM "SalesOrderItem" i, LATERAL jsonb_object_keys(i."nomusRawItem") k
WHERE jsonb_typeof(i."nomusRawItem") = 'object' AND k ~* '(cancel|motivo|reativ|alterac|atualiz|modific|corte|cortad)'
GROUP BY 1, 2
ORDER BY 1, 3 DESC;

-- S2. Status de ITEM: codigo bruto recebido x status normalizado gravado x bandeiras.
\echo '== S2. Status de item (bruto x normalizado x bandeiras)'
SELECT coalesce(i."nomusItemStatusRaw", '(ausente)') AS status_bruto,
       coalesce(i."nomusItemStatusNormalized", '(nulo)') AS normalizado,
       i."nomusIsCanceled" AS cancelado, i."nomusIsCut" AS cortado, i."nomusIsStale" AS fora_do_payload,
       count(*) AS itens
FROM "SalesOrderItem" i JOIN "SalesOrder" so ON so.id = i."salesOrderId" AND so."sourceSystem" = 'NOMUS'
GROUP BY 1, 2, 3, 4, 5 ORDER BY 6 DESC LIMIT 40;

-- S2b. Quantidades presentes nos itens brutos (comprova se ha cancelamento parcial por quantidade).
SELECT count(*) AS itens_nomus,
       count(*) FILTER (WHERE i."nomusRawItem" ? 'quantidadeCancelada') AS com_quantidadeCancelada,
       count(*) FILTER (WHERE i."nomusRawItem" ? 'quantidadeAtendida') AS com_quantidadeAtendida,
       count(*) FILTER (WHERE i."nomusRawItem" ? 'quantidadeFaturada') AS com_quantidadeFaturada,
       count(*) FILTER (WHERE i."nomusQuantityPending" IS NOT NULL) AS com_pendente_gravado
FROM "SalesOrderItem" i JOIN "SalesOrder" so ON so.id = i."salesOrderId" AND so."sourceSystem" = 'NOMUS'
WHERE jsonb_typeof(i."nomusRawItem") = 'object';

-- Base por pedido (mesma regra de src/lib/sales/salesOrderNomusLifecycle.ts).
\echo '== S3. Pedidos por situacao de cancelamento (pelos itens)'
WITH it AS (
  SELECT i."salesOrderId" AS so_id,
         count(*) AS itens,
         count(*) FILTER (WHERE NOT i."nomusIsCanceled" AND NOT i."nomusIsStale") AS ativos,
         count(*) FILTER (WHERE i."nomusIsCanceled" AND NOT i."nomusIsStale") AS cancelados,
         count(*) FILTER (WHERE i."nomusIsStale") AS fora_do_payload,
         count(*) FILTER (WHERE i."nomusIsCut" AND NOT i."nomusIsCanceled" AND NOT i."nomusIsStale") AS cortados,
         count(*) FILTER (WHERE i."nomusItemStatusNormalized" = 'PARTIAL' AND coalesce(i."nomusQuantityPending", 0) > 0) AS atendidos_com_saldo,
         count(*) FILTER (WHERE coalesce(i."nomusItemStatusNormalized", 'UNKNOWN') = 'UNKNOWN' AND NOT i."nomusIsStale") AS sem_evidencia,
         sum(i."totalNetValue") AS valor_itens,
         sum(i."totalNetValue") FILTER (WHERE NOT i."nomusIsCanceled" AND NOT i."nomusIsStale") AS valor_ativo
  FROM "SalesOrderItem" i GROUP BY 1
),
o AS (
  SELECT so.id, so."orderCode", so.status, so."totalNetValue", so."sourcePresenceStatus", it.*,
         CASE WHEN it.itens IS NULL THEN 'SEM_ITENS'
              WHEN it.ativos = 0 AND it.cancelados > 0 THEN 'TOTALMENTE_CANCELADO'
              WHEN it.ativos = 0 THEN 'TODOS_FORA_DO_PAYLOAD'
              WHEN it.cancelados + it.fora_do_payload > 0 THEN 'PARCIALMENTE_CANCELADO'
              ELSE 'ABERTO' END AS situacao,
         EXISTS (
           SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(so."nomusRawResponse" -> 'nfes') = 'array'
                                                  THEN so."nomusRawResponse" -> 'nfes' ELSE '[]'::jsonb END) n
         ) AS tem_nfe
  FROM "SalesOrder" so LEFT JOIN it ON it.so_id = so.id
  WHERE so."sourceSystem" = 'NOMUS'
)
SELECT situacao, count(*) AS pedidos,
       count(*) FILTER (WHERE tem_nfe) AS com_nfe,
       count(*) FILTER (WHERE status = 'CANCELLED') AS cabecalho_cancelled,
       sum(cortados) AS itens_cortados, sum(atendidos_com_saldo) AS itens_atendidos_com_saldo,
       sum(sem_evidencia) AS itens_sem_evidencia_de_status,
       round(sum("totalNetValue"), 2) AS valor_cabecalho, round(sum(valor_ativo), 2) AS valor_itens_ativos
FROM o GROUP BY situacao ORDER BY situacao;

-- S4. Previsao/carteira ANTES desta versao (cabecalho != CANCELLED, sem NF): pedidos com item cancelado que
--     compunham o saldo pelo valor cheio do cabecalho.
\echo '== S4. Pedidos cancelados (total ou parcial) que a regra antiga mantinha na carteira/previsao'
WITH it AS (
  SELECT i."salesOrderId" AS so_id,
         count(*) FILTER (WHERE NOT i."nomusIsCanceled" AND NOT i."nomusIsStale") AS ativos,
         count(*) FILTER (WHERE i."nomusIsCanceled" OR i."nomusIsStale") AS inativos,
         sum(i."totalNetValue") FILTER (WHERE NOT i."nomusIsCanceled" AND NOT i."nomusIsStale") AS valor_ativo
  FROM "SalesOrderItem" i GROUP BY 1
)
SELECT CASE WHEN it.ativos = 0 THEN 'total' ELSE 'parcial' END AS cancelamento,
       count(*) AS pedidos, round(sum(so."totalNetValue"), 2) AS valor_cabecalho_na_regra_antiga,
       round(sum(coalesce(it.valor_ativo, 0)), 2) AS valor_ativo_dos_itens
FROM "SalesOrder" so JOIN it ON it.so_id = so.id AND it.inativos > 0
WHERE so."sourceSystem" = 'NOMUS' AND so.status <> 'CANCELLED'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(so."nomusRawResponse" -> 'nfes') = 'array'
                                           THEN so."nomusRawResponse" -> 'nfes' ELSE '[]'::jsonb END) n)
GROUP BY 1 ORDER BY 1;

-- S5. Cabecalho x itens: o valorTotal do Nomus ja abate itens cancelados? (evidencia para a regra de valor)
\echo '== S5. valorTotal do cabecalho x soma dos itens (pedidos com item cancelado)'
WITH it AS (
  SELECT i."salesOrderId" AS so_id,
         sum(i."totalNetValue") AS todos,
         sum(i."totalNetValue") FILTER (WHERE NOT i."nomusIsCanceled" AND NOT i."nomusIsStale") AS ativos,
         count(*) FILTER (WHERE i."nomusIsCanceled") AS cancelados
  FROM "SalesOrderItem" i GROUP BY 1
)
SELECT CASE
         WHEN abs(so."totalNetValue" - it.todos) <= 0.05 THEN 'cabecalho = todos os itens (Nomus NAO abate cancelados)'
         WHEN abs(so."totalNetValue" - coalesce(it.ativos, 0)) <= 0.05 THEN 'cabecalho = itens ativos (Nomus abate cancelados)'
         ELSE 'outro (frete/impostos/arredondamento: conferir no Nomus)'
       END AS evidencia, count(*) AS pedidos
FROM "SalesOrder" so JOIN it ON it.so_id = so.id AND it.cancelados > 0
WHERE so."sourceSystem" = 'NOMUS'
GROUP BY 1 ORDER BY 2 DESC;

-- S6. Exemplos para conferencia manual no Nomus (codigo do pedido apenas).
\echo '== S6. Exemplos por situacao (ate 5 cada)'
WITH it AS (
  SELECT i."salesOrderId" AS so_id,
         count(*) FILTER (WHERE NOT i."nomusIsCanceled" AND NOT i."nomusIsStale") AS ativos,
         count(*) FILTER (WHERE i."nomusIsCanceled") AS cancelados,
         count(*) FILTER (WHERE i."nomusIsCut") AS cortados,
         count(*) FILTER (WHERE coalesce(i."nomusItemStatusNormalized", 'UNKNOWN') = 'UNKNOWN') AS sem_evidencia
  FROM "SalesOrderItem" i GROUP BY 1
),
o AS (
  SELECT so."orderCode", so."issueDate",
         CASE WHEN it.ativos = 0 AND it.cancelados > 0 THEN 'TOTALMENTE_CANCELADO'
              WHEN it.cancelados > 0 THEN 'PARCIALMENTE_CANCELADO'
              WHEN it.cortados > 0 THEN 'COM_CORTE'
              WHEN it.sem_evidencia > 0 THEN 'SEM_EVIDENCIA_DE_STATUS' END AS situacao
  FROM "SalesOrder" so JOIN it ON it.so_id = so.id
  WHERE so."sourceSystem" = 'NOMUS'
),
r AS (SELECT o.*, row_number() OVER (PARTITION BY situacao ORDER BY "issueDate" DESC NULLS LAST) AS rn FROM o WHERE situacao IS NOT NULL)
SELECT situacao, "orderCode" AS pedido, "issueDate"::date AS emissao FROM r WHERE rn <= 5 ORDER BY situacao, emissao DESC;

-- S7. Historico de mudancas entre sincronizacoes (so existe depois da migration 20261102120000).
\echo '== S7. Historico de status entre sincronizacoes'
SELECT to_regclass('public."SalesOrderNomusStatusEvent"') IS NOT NULL AS tem_historico
\gset
\if :tem_historico
SELECT kind AS evento, count(*) AS ocorrencias, min("createdAt")::date AS primeiro, max("createdAt")::date AS ultimo
FROM "SalesOrderNomusStatusEvent" GROUP BY 1 ORDER BY 2 DESC;
\else
\echo 'Historico ainda nao disponivel (migration 20261102120000 nao aplicada): mudancas anteriores nao sao reconstruiveis.'
\endif

ROLLBACK;
