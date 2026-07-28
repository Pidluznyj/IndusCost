-- OP-14 — Workflow de solicitação de compra (aditivo).
-- Sem DROP/RENAME. Não cria PO nem Contas a Pagar.

ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'AGUARDANDO_APROVACAO';
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'REJEITADA';
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'EM_COTACAO';

ALTER TYPE "PurchaseApprovalTargetType" ADD VALUE IF NOT EXISTS 'REQUEST';

ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "projectId" UUID;
ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "projectCodeSnapshot" TEXT;
ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "projectTitleSnapshot" TEXT;
ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "externalReference" TEXT;

CREATE INDEX IF NOT EXISTS "PurchaseRequest_projectId_idx" ON "PurchaseRequest"("projectId");

DO $$ BEGIN
  ALTER TABLE "PurchaseRequest"
    ADD CONSTRAINT "PurchaseRequest_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PurchaseRequestHistoryEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchaseRequestId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "fromStatus" "PurchaseRequestStatus",
  "toStatus" "PurchaseRequestStatus",
  "reason" TEXT,
  "notes" TEXT,
  "userId" TEXT,
  "userName" TEXT,
  "metaJson" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseRequestHistoryEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PurchaseRequestHistoryEvent_purchaseRequestId_createdAt_idx"
  ON "PurchaseRequestHistoryEvent"("purchaseRequestId", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseRequestHistoryEvent_action_idx"
  ON "PurchaseRequestHistoryEvent"("action");

DO $$ BEGIN
  ALTER TABLE "PurchaseRequestHistoryEvent"
    ADD CONSTRAINT "PurchaseRequestHistoryEvent_purchaseRequestId_fkey"
    FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "PurchaseApproval" ADD COLUMN IF NOT EXISTS "purchaseRequestId" UUID;
CREATE INDEX IF NOT EXISTS "PurchaseApproval_purchaseRequestId_idx"
  ON "PurchaseApproval"("purchaseRequestId");

DO $$ BEGIN
  ALTER TABLE "PurchaseApproval"
    ADD CONSTRAINT "PurchaseApproval_purchaseRequestId_fkey"
    FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
