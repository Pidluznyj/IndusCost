-- AlterTable: CRM mínimo em CommercialActivity (campos opcionais, TIMESTAMP(6) alinhado ao schema existente)
ALTER TABLE "CommercialActivity" ADD COLUMN IF NOT EXISTS "contactDate" TIMESTAMP(6);
ALTER TABLE "CommercialActivity" ADD COLUMN IF NOT EXISTS "channel" TEXT;
ALTER TABLE "CommercialActivity" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "CommercialActivity" ADD COLUMN IF NOT EXISTS "outcome" TEXT;
ALTER TABLE "CommercialActivity" ADD COLUMN IF NOT EXISTS "nextActionAt" TIMESTAMP(6);
ALTER TABLE "CommercialActivity" ADD COLUMN IF NOT EXISTS "nextActionDescription" TEXT;
ALTER TABLE "CommercialActivity" ADD COLUMN IF NOT EXISTS "createdByName" TEXT;
ALTER TABLE "CommercialActivity" ADD COLUMN IF NOT EXISTS "createdByPhone" TEXT;
ALTER TABLE "CommercialActivity" ADD COLUMN IF NOT EXISTS "createdByEmail" TEXT;

CREATE INDEX IF NOT EXISTS "CommercialActivity_customerId_contactDate_idx"
ON "CommercialActivity" ("customerId", "contactDate");

CREATE INDEX IF NOT EXISTS "CommercialActivity_nextActionAt_idx"
ON "CommercialActivity" ("nextActionAt");

CREATE INDEX IF NOT EXISTS "CommercialActivity_status_idx"
ON "CommercialActivity" ("status");
