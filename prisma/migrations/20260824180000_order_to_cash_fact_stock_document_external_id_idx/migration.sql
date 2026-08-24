-- Pedidos de Venda — Detalhe (Auditoria 360) — índice do vínculo com
-- Documento de Saída.
--
-- Evidência real (homolog, 24/08/2026, PostgreSQL 17.10):
--   SELECT ... FROM "OrderToCashAuditFact"
--    WHERE "stockDocumentExternalId" = <id>
--   → Seq Scan, 5 linhas retornadas, ~18.177 removidas pelo filtro,
--     shared hit=3584 buffers, ~9ms POR documento — dentro do caminho do
--     detalhe do pedido (uma vez por documento de saída, e no resolver em
--     lote via IN sobre a mesma coluna).
--
-- A coluna é Int? (NULL quando o fact não referencia documento); o índice
-- B-tree simples serve tanto ao predicado de igualdade quanto ao IN do
-- resolver em lote. Sem coluna adicional: nenhuma evidência pediu composto.
--
-- CONCURRENTLY não é usado: `prisma migrate deploy` executa a migration em
-- transação (CREATE INDEX CONCURRENTLY é proibido em transação) e a tabela
-- tem ~18k linhas — o CREATE INDEX normal conclui em milissegundos.
--
-- Aditivo e reversível: só cria índice, não toca dado nem estrutura.
-- IF NOT EXISTS mantém o reprocessamento idempotente.

CREATE INDEX IF NOT EXISTS "OrderToCashAuditFact_stockDocumentExternalId_idx"
  ON "OrderToCashAuditFact" ("stockDocumentExternalId");
