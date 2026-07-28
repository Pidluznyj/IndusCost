-- OP-22 — Recebimentos parciais/totais ligados ao ledger (PURCHASE_RECEIPT).
-- Aditivo. Não altera Nomus, Contas a Pagar nem custo publicado.

ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'PURCHASE_RECEIPT';

ALTER TABLE "PurchaseReceipt"
  ADD COLUMN IF NOT EXISTS "locationId" UUID,
  ADD COLUMN IF NOT EXISTS "documentNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "entryDocumentRef" TEXT,
  ADD COLUMN IF NOT EXISTS "freightValueActual" DECIMAL(20,6),
  ADD COLUMN IF NOT EXISTS "expensesActual" DECIMAL(20,6),
  ADD COLUMN IF NOT EXISTS "responsibleUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "responsibleUserName" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "confirmedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmIdempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "reversedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "reverseReason" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseReceipt_confirmIdempotencyKey_key"
  ON "PurchaseReceipt"("confirmIdempotencyKey")
  WHERE "confirmIdempotencyKey" IS NOT NULL;

ALTER TABLE "PurchaseReceiptItem"
  ADD COLUMN IF NOT EXISTS "lotNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "effectiveUnitCost" DECIMAL(20,6),
  ADD COLUMN IF NOT EXISTS "effectiveLineCost" DECIMAL(20,6),
  ADD COLUMN IF NOT EXISTS "reversalMovementId" UUID;

CREATE INDEX IF NOT EXISTS "PurchaseReceiptItem_lotNumber_idx"
  ON "PurchaseReceiptItem"("lotNumber");

CREATE TABLE IF NOT EXISTS "PurchaseReceiptHistoryEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "receiptId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "fromStatus" "PurchaseReceiptStatus",
  "toStatus" "PurchaseReceiptStatus",
  "reason" TEXT,
  "notes" TEXT,
  "userId" TEXT,
  "userName" TEXT,
  "metaJson" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseReceiptHistoryEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PurchaseReceiptHistoryEvent_receiptId_createdAt_idx"
  ON "PurchaseReceiptHistoryEvent"("receiptId", "createdAt");

CREATE INDEX IF NOT EXISTS "PurchaseReceiptHistoryEvent_action_idx"
  ON "PurchaseReceiptHistoryEvent"("action");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseReceiptHistoryEvent_receiptId_fkey'
  ) THEN
    ALTER TABLE "PurchaseReceiptHistoryEvent"
      ADD CONSTRAINT "PurchaseReceiptHistoryEvent_receiptId_fkey"
      FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
