-- Slots agendados e trigger de coleta Brent (append-only; backfill seguro).

DO $$ BEGIN
  CREATE TYPE "CommodityCollectionSlot" AS ENUM ('MORNING', 'AFTERNOON');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CommodityCollectionTrigger" AS ENUM ('SCHEDULED', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "CommoditySnapshot"
  ADD COLUMN IF NOT EXISTS "scheduledSlot" "CommodityCollectionSlot",
  ADD COLUMN IF NOT EXISTS "trigger" "CommodityCollectionTrigger" NOT NULL DEFAULT 'SCHEDULED';

UPDATE "CommoditySnapshot"
SET "scheduledSlot" = CASE
  WHEN EXTRACT(HOUR FROM ("collectedAt" AT TIME ZONE 'America/Sao_Paulo')) < 15
    OR (
      EXTRACT(HOUR FROM ("collectedAt" AT TIME ZONE 'America/Sao_Paulo')) = 15
      AND EXTRACT(MINUTE FROM ("collectedAt" AT TIME ZONE 'America/Sao_Paulo')) < 30
    )
  THEN 'MORNING'::"CommodityCollectionSlot"
  ELSE 'AFTERNOON'::"CommodityCollectionSlot"
END
WHERE "scheduledSlot" IS NULL;

ALTER TABLE "CommoditySnapshot"
  ALTER COLUMN "scheduledSlot" SET NOT NULL;

DROP INDEX IF EXISTS "CommoditySnapshot_commodityType_quoteDate_idx";

CREATE INDEX IF NOT EXISTS "CommoditySnapshot_commodityType_quoteDate_scheduledSlot_idx"
  ON "CommoditySnapshot"("commodityType", "quoteDate" DESC, "scheduledSlot");
