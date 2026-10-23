-- Rollback TÉCNICO de 20261101120000_nomus_purchase_order_source_lifecycle — ÚLTIMO RECURSO.
-- Não é aplicado pelo Prisma. O rollback operacional recomendado NÃO mexe no schema:
--   NOMUS_SOURCE_RECONCILE_PURCHASE_ORDERS_ENABLED=0, NOMUS_OPS_EXCLUDE_MISSING_PURCHASE_ORDERS_ENABLED=0,
--   NOMUS_PO_SCHEDULE_SOURCE=chain (ver docs/nomus/purchase-orders-independent-sync-and-reconciliation.md).
--
-- Antes de executar (com backup verificado):
--   1. Exportar o histórico de presença, que este script remove:
--      \copy (SELECT * FROM "NomusPurchaseOrderPresenceEvent" ORDER BY "occurredAt") TO 'po-presence-events.csv' CSV HEADER
--   2. Conferir quantos pedidos estão ausentes (voltam a parecer presentes depois do rollback):
--      SELECT "sourcePresenceStatus", count(*) FROM "NomusPurchaseOrder" GROUP BY 1;
--   3. Remover a linha da migration em _prisma_migrations depois deste script, se for reaplicar:
--      DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261101120000_nomus_purchase_order_source_lifecycle';
--
-- Nenhum pedido, item, avaliação ou vínculo financeiro é apagado.
-- Os valores de enum PURCHASE_ORDER e SKIPPED permanecem (PostgreSQL não remove valor de enum sem recriar o
-- tipo); antes, garanta que não há NomusSourceSyncRun com esses valores se precisar recriar o tipo:
--      SELECT "entityType", "status", count(*) FROM "NomusSourceSyncRun"
--      WHERE "entityType" = 'PURCHASE_ORDER' OR "status" = 'SKIPPED' GROUP BY 1, 2;

ALTER TABLE "NomusPurchaseOrderPresenceEvent" DROP CONSTRAINT IF EXISTS "NomusPurchaseOrderPresenceEvent_syncRunId_fkey";
ALTER TABLE "NomusPurchaseOrderPresenceEvent" DROP CONSTRAINT IF EXISTS "NomusPurchaseOrderPresenceEvent_purchaseOrderId_fkey";
DROP TABLE IF EXISTS "NomusPurchaseOrderPresenceEvent";

ALTER TABLE "NomusPurchaseOrder" DROP CONSTRAINT IF EXISTS "NomusPurchaseOrder_lastSyncRunId_fkey";
DROP INDEX IF EXISTS "NomusPurchaseOrder_sourcePresenceStatus_idx";
DROP INDEX IF EXISTS "NomusPurchaseOrder_lastSyncRunId_idx";
ALTER TABLE "NomusPurchaseOrder"
  DROP COLUMN IF EXISTS "lastSyncRunId",
  DROP COLUMN IF EXISTS "missingConsecutiveRuns",
  DROP COLUMN IF EXISTS "missingSince",
  DROP COLUMN IF EXISTS "presentInLastPayload",
  DROP COLUMN IF EXISTS "sourcePresenceStatus",
  DROP COLUMN IF EXISTS "sourceRemovedAt";
