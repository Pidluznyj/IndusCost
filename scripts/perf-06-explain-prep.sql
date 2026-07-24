-- PERFORMANCE 06 — EXPLAIN read-only (staging/local).
-- NÃO executar em produção neste passo.
-- NÃO usar EXPLAIN ANALYZE sem autorização explícita.
-- Sem parâmetros sensíveis: apenas datas/anos genéricos.

-- ============================================================================
-- Pedidos de venda — listagem (ORDER BY createdAt — candidato P1)
-- ============================================================================
EXPLAIN (FORMAT TEXT)
SELECT id
FROM "SalesOrder"
WHERE status <> 'CANCELLED'
  AND "issueDate" >= DATE '2026-01-01'
  AND "issueDate" < DATE '2027-01-01'
ORDER BY "createdAt" DESC, "issueDate" DESC
LIMIT 20;

EXPLAIN (FORMAT TEXT)
SELECT COUNT(*)::int AS total,
       COALESCE(SUM("totalNetValue"), 0) AS sum_net,
       COALESCE(SUM("totalItems"), 0) AS sum_items
FROM "SalesOrder"
WHERE status <> 'CANCELLED'
  AND "issueDate" >= DATE '2026-01-01'
  AND "issueDate" < DATE '2027-01-01';

-- Filtro vendedor (candidato P1 externalSellerId)
EXPLAIN (FORMAT TEXT)
SELECT id
FROM "SalesOrder"
WHERE status <> 'CANCELLED'
  AND "externalSellerId" = 1
ORDER BY "createdAt" DESC
LIMIT 20;

-- ============================================================================
-- Contas a receber — carteira aberta (candidato P1 parcial balance)
-- ============================================================================
EXPLAIN (FORMAT TEXT)
SELECT id
FROM "NomusAccountsReceivable"
WHERE "balanceReceivable" > 0
ORDER BY "dueDate" ASC
LIMIT 100;

EXPLAIN (FORMAT TEXT)
SELECT id
FROM "NomusAccountsReceivable"
WHERE "balanceReceivable" > 0
  AND "syncedAt" >= TIMESTAMPTZ '2020-01-01'
ORDER BY "dueDate" ASC
LIMIT 100;

-- ============================================================================
-- Contas a pagar — carteira aberta
-- ============================================================================
EXPLAIN (FORMAT TEXT)
SELECT id
FROM "NomusAccountsPayable"
WHERE "balancePayable" > 0
ORDER BY "dueDate" ASC
LIMIT 100;

EXPLAIN (FORMAT TEXT)
SELECT id
FROM "NomusAccountsPayable"
WHERE "balancePayable" > 0
  AND "syncedAt" >= TIMESTAMPTZ '2020-01-01'
ORDER BY "dueDate" ASC
LIMIT 100;

-- ============================================================================
-- Billing NF-e autorizada (candidato P2 parcial)
-- ============================================================================
EXPLAIN (FORMAT TEXT)
SELECT id
FROM "NomusNfe"
WHERE status = 4
  AND "isMarketSale" = true
  AND "billingClassification" = 'MARKET_REVENUE'
  AND "xmlDhEmi" >= TIMESTAMPTZ '2026-01-01'
  AND "xmlDhEmi" < TIMESTAMPTZ '2027-01-01'
ORDER BY "xmlDhEmi" DESC, "dataProcessamento" DESC
LIMIT 50;

-- ============================================================================
-- Linked NFe por página de pedidos (já coberto por UNIQUE — baseline)
-- ============================================================================
EXPLAIN (FORMAT TEXT)
SELECT l.id
FROM "SalesOrderNfeLink" l
WHERE l."salesOrderId" IN (
  SELECT id FROM "SalesOrder" WHERE status <> 'CANCELLED' LIMIT 20
);

-- ============================================================================
-- Quando autorizado em staging (não produção neste passo):
-- EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) <mesma query>;
-- ============================================================================
