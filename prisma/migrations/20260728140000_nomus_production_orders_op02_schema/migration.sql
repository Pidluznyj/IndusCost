-- OP-02: amplia stage NomusProductionOrder / SalesLink (aditivo + renomes).
-- Compatível com banco vazio (após 20260728120000) e com dados históricos já sincronizados.
-- Sem SyncState: incremental continua em cursor arquivo + IntegrationRun genérico.

-- Cabeçalho OP: novos campos
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "priority" TEXT;
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "productDescription" TEXT;
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "productAdditionalInfo" TEXT;
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "productConfigId" INTEGER;
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "productConfigCode" TEXT;
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "externalCompanyId" INTEGER;
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "stockSector" TEXT;
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "openedAt" TIMESTAMP(3);
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "plannedAt" TIMESTAMP(3);
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "nomusUpdatedAt" TIMESTAMP(3);
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "payloadHash" TEXT;
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "firstSeenAt" TIMESTAMP(3);
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "lastChangedAt" TIMESTAMP(3);

-- Backfill timestamps / hash para linhas já existentes
UPDATE "NomusProductionOrder"
SET
  "payloadHash" = COALESCE(NULLIF("payloadHash", ''), md5(COALESCE("rawJson"::text, ''))),
  "firstSeenAt" = COALESCE("firstSeenAt", "createdAt", CURRENT_TIMESTAMP),
  "lastChangedAt" = COALESCE("lastChangedAt", "updatedAt", "syncedAt", CURRENT_TIMESTAMP)
WHERE "payloadHash" IS NULL
   OR "payloadHash" = ''
   OR "firstSeenAt" IS NULL
   OR "lastChangedAt" IS NULL;

ALTER TABLE "NomusProductionOrder" ALTER COLUMN "payloadHash" SET NOT NULL;
ALTER TABLE "NomusProductionOrder" ALTER COLUMN "firstSeenAt" SET NOT NULL;
ALTER TABLE "NomusProductionOrder" ALTER COLUMN "firstSeenAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "NomusProductionOrder" ALTER COLUMN "lastChangedAt" SET NOT NULL;
ALTER TABLE "NomusProductionOrder" ALTER COLUMN "lastChangedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Vínculos: renomes retrocompatíveis
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'NomusProductionOrderSalesLink' AND column_name = 'itemSequence'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'NomusProductionOrderSalesLink' AND column_name = 'itemNumber'
  ) THEN
    ALTER TABLE "NomusProductionOrderSalesLink" RENAME COLUMN "itemSequence" TO "itemNumber";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'NomusProductionOrderSalesLink' AND column_name = 'linkQuantity'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'NomusProductionOrderSalesLink' AND column_name = 'linkedQuantity'
  ) THEN
    ALTER TABLE "NomusProductionOrderSalesLink" RENAME COLUMN "linkQuantity" TO "linkedQuantity";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'NomusProductionOrderSalesLink' AND column_name = 'presentInLastPayload'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'NomusProductionOrderSalesLink' AND column_name = 'isCurrent'
  ) THEN
    ALTER TABLE "NomusProductionOrderSalesLink" RENAME COLUMN "presentInLastPayload" TO "isCurrent";
  END IF;
END $$;

ALTER TABLE "NomusProductionOrderSalesLink" ADD COLUMN IF NOT EXISTS "removedAt" TIMESTAMP(3);

-- Índices novos / renomeados
CREATE INDEX IF NOT EXISTS "NomusProductionOrder_priority_idx" ON "NomusProductionOrder"("priority");
CREATE INDEX IF NOT EXISTS "NomusProductionOrder_externalCompanyId_idx" ON "NomusProductionOrder"("externalCompanyId");
CREATE INDEX IF NOT EXISTS "NomusProductionOrder_stockSector_idx" ON "NomusProductionOrder"("stockSector");
CREATE INDEX IF NOT EXISTS "NomusProductionOrder_openedAt_idx" ON "NomusProductionOrder"("openedAt");
CREATE INDEX IF NOT EXISTS "NomusProductionOrder_closedAt_idx" ON "NomusProductionOrder"("closedAt");
CREATE INDEX IF NOT EXISTS "NomusProductionOrder_lastSeenAt_idx" ON "NomusProductionOrder"("lastSeenAt");
CREATE INDEX IF NOT EXISTS "NomusProductionOrder_lastChangedAt_idx" ON "NomusProductionOrder"("lastChangedAt");
CREATE INDEX IF NOT EXISTS "NomusProductionOrder_payloadHash_idx" ON "NomusProductionOrder"("payloadHash");

DROP INDEX IF EXISTS "NomusProductionOrderSalesLink_presentInLastPayload_idx";
CREATE INDEX IF NOT EXISTS "NomusProductionOrderSalesLink_isCurrent_idx" ON "NomusProductionOrderSalesLink"("isCurrent");
CREATE INDEX IF NOT EXISTS "NomusProductionOrderSalesLink_removedAt_idx" ON "NomusProductionOrderSalesLink"("removedAt");
CREATE INDEX IF NOT EXISTS "NomusProductionOrderSalesLink_externalSalesOrderId_isCurrent_idx"
  ON "NomusProductionOrderSalesLink"("externalSalesOrderId", "isCurrent");
CREATE INDEX IF NOT EXISTS "NomusProductionOrderSalesLink_externalSalesOrderItemId_isCurrent_idx"
  ON "NomusProductionOrderSalesLink"("externalSalesOrderItemId", "isCurrent");
