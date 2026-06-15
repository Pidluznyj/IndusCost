-- Fase 4: vínculo opcional CommercialActivity → SalesOrder
ALTER TABLE "CommercialActivity" ADD COLUMN IF NOT EXISTS "salesOrderId" UUID;

CREATE INDEX IF NOT EXISTS "CommercialActivity_salesOrderId_idx"
  ON "CommercialActivity" ("salesOrderId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CommercialActivity_salesOrderId_fkey'
  ) THEN
    ALTER TABLE "CommercialActivity"
      ADD CONSTRAINT "CommercialActivity_salesOrderId_fkey"
      FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- Backfill: proposalId → salesOrderId quando SalesOrder.proposalId é vínculo único
UPDATE "CommercialActivity" ca
SET "salesOrderId" = so.id
FROM "SalesOrder" so
WHERE ca."proposalId" IS NOT NULL
  AND ca."salesOrderId" IS NULL
  AND so."proposalId" = ca."proposalId";
