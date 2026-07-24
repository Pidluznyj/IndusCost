-- PERFORMANCE 02 — comandos EXPLAIN read-only para execução autorizada posterior.
-- NÃO executar EXPLAIN ANALYZE em produção neste passo.
-- Substitua :year / datas conforme o cenário medido.

-- 1) Lista de pedidos (orderBy createdAt — candidato a índice)
EXPLAIN (FORMAT TEXT)
SELECT id
FROM "SalesOrder"
WHERE status <> 'CANCELLED'
  AND "issueDate" >= DATE '2026-01-01'
  AND "issueDate" < DATE '2027-01-01'
ORDER BY "createdAt" DESC, "issueDate" DESC
LIMIT 20;

-- 2) Contagem da mesma população
EXPLAIN (FORMAT TEXT)
SELECT COUNT(*)
FROM "SalesOrder"
WHERE status <> 'CANCELLED'
  AND "issueDate" >= DATE '2026-01-01'
  AND "issueDate" < DATE '2027-01-01';

-- 3) Contas a receber (carteira ordenada por dueDate)
EXPLAIN (FORMAT TEXT)
SELECT id
FROM "NomusAccountsReceivable"
ORDER BY "dueDate" ASC
LIMIT 100;

-- 4) Contas a pagar
EXPLAIN (FORMAT TEXT)
SELECT id
FROM "NomusAccountsPayable"
ORDER BY "dueDate" ASC
LIMIT 100;

-- 5) NF-e por competência de emissão (Billing / DRE)
EXPLAIN (FORMAT TEXT)
SELECT id
FROM "NomusNfe"
WHERE "xmlDhEmi" >= TIMESTAMPTZ '2026-01-01'
  AND "xmlDhEmi" < TIMESTAMPTZ '2027-01-01'
ORDER BY "xmlDhEmi" DESC
LIMIT 50;

-- 6) Itens do pedido (detalhe)
EXPLAIN (FORMAT TEXT)
SELECT i.id
FROM "SalesOrderItem" i
WHERE i."salesOrderId" = (
  SELECT id FROM "SalesOrder" WHERE status <> 'CANCELLED' LIMIT 1
);

-- Quando autorizado (staging/local):
-- EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) <mesma query>;
