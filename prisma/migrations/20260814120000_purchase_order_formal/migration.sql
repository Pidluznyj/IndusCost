-- OP-20 — Pedido de Compra formal (aditivo).
-- Sem DROP/RENAME. Sem estoque Nomus / Contas a Pagar.

DO $$ BEGIN
  ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'APROVADO';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'ENVIADO';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "awardId" UUID;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "finalRoundId" UUID;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "approvalId" UUID;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "nonRecoverableTaxesSnapshot" DECIMAL(20,6);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "discountsSnapshot" DECIMAL(20,6);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "leadTimeDaysSnapshot" INTEGER;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "initialComparableTotalSnapshot" DECIMAL(20,6);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "negotiatedComparableTotalSnapshot" DECIMAL(20,6);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "totalGainSnapshot" DECIMAL(20,6);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "quotationCodeSnapshot" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "awardJustificationSnapshot" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "evidenceCountSnapshot" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "evidenceIdsJson" JSONB;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "operationalCommitmentAt" TIMESTAMPTZ(6);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "futureEntryPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "futureEntryMarkedAt" TIMESTAMPTZ(6);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMPTZ(6);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "approvedByUserId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "approvedByUserName" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMPTZ(6);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ(6);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "createdByUserName" TEXT;

CREATE INDEX IF NOT EXISTS "PurchaseOrder_awardId_idx" ON "PurchaseOrder"("awardId");

DO $$ BEGIN
  ALTER TABLE "PurchaseOrder"
    ADD CONSTRAINT "PurchaseOrder_awardId_fkey"
    FOREIGN KEY ("awardId") REFERENCES "PurchaseQuotationAward"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "offerItemId" UUID;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "awardAllocationId" UUID;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "initialUnitPriceSnapshot" DECIMAL(20,6);
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "lineGainSnapshot" DECIMAL(20,6);
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "freightValueSnapshot" DECIMAL(20,6);
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "nonRecoverableTaxesSnapshot" DECIMAL(20,6);
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "discountsSnapshot" DECIMAL(20,6);
ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "leadTimeDaysSnapshot" INTEGER;

CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_offerItemId_idx" ON "PurchaseOrderItem"("offerItemId");

CREATE TABLE IF NOT EXISTS "PurchaseOrderHistoryEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchaseOrderId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "fromStatus" "PurchaseOrderStatus",
  "toStatus" "PurchaseOrderStatus",
  "reason" TEXT,
  "notes" TEXT,
  "userId" TEXT,
  "userName" TEXT,
  "metaJson" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderHistoryEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PurchaseOrderHistoryEvent_purchaseOrderId_createdAt_idx"
  ON "PurchaseOrderHistoryEvent"("purchaseOrderId", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseOrderHistoryEvent_action_idx"
  ON "PurchaseOrderHistoryEvent"("action");

DO $$ BEGIN
  ALTER TABLE "PurchaseOrderHistoryEvent"
    ADD CONSTRAINT "PurchaseOrderHistoryEvent_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
