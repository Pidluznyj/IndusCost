-- Metas (OKR) — índice do histórico do cliente.
--
-- As variáveis calculadas ("primeira compra", "reativação", "recompra")
-- classificam cada pedido comparando-o com o histórico do cliente:
--   PARTITION BY "customerId" ORDER BY "issueDate"
-- Os índices existentes são separados ("customerId" e "issueDate"), o que
-- obriga o Postgres a ordenar a partição a cada execução. O composto serve a
-- window function diretamente.
--
-- Aditivo e reversível: só cria índice, não toca dado nem estrutura.
-- IF NOT EXISTS mantém o reprocessamento idempotente.

CREATE INDEX IF NOT EXISTS "SalesOrder_customerId_issueDate_idx"
  ON "SalesOrder" ("customerId", "issueDate");
