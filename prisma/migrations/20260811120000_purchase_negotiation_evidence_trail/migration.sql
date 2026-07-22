-- OP-17 — Trilha de evidências da negociação (aditivo).
-- Reutiliza PurchaseEvidence + appLocalFileStorage. Sem DROP/RENAME.

ALTER TYPE "PurchaseEvidenceEntityType" ADD VALUE IF NOT EXISTS 'CONFIRMATION';

DO $$ BEGIN
  CREATE TYPE "PurchaseEvidenceHistoryAction" AS ENUM (
    'UPLOADED', 'REPLACED', 'SOFT_DELETED', 'LOCKED', 'UNLOCKED', 'DOWNLOAD'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "PurchaseEvidence" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;
ALTER TABLE "PurchaseEvidence" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "PurchaseEvidence" ADD COLUMN IF NOT EXISTS "uploadedByName" TEXT;
ALTER TABLE "PurchaseEvidence" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "PurchaseEvidence" ADD COLUMN IF NOT EXISTS "deletedBy" TEXT;
ALTER TABLE "PurchaseEvidence" ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;
ALTER TABLE "PurchaseEvidence" ADD COLUMN IF NOT EXISTS "replacesId" UUID;
ALTER TABLE "PurchaseEvidence" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMPTZ(6);
ALTER TABLE "PurchaseEvidence" ADD COLUMN IF NOT EXISTS "lockedReason" TEXT;

CREATE INDEX IF NOT EXISTS "PurchaseEvidence_contentHash_idx" ON "PurchaseEvidence"("contentHash");
CREATE INDEX IF NOT EXISTS "PurchaseEvidence_deletedAt_idx" ON "PurchaseEvidence"("deletedAt");
CREATE INDEX IF NOT EXISTS "PurchaseEvidence_replacesId_idx" ON "PurchaseEvidence"("replacesId");

DO $$ BEGIN
  ALTER TABLE "PurchaseEvidence"
    ADD CONSTRAINT "PurchaseEvidence_replacesId_fkey"
    FOREIGN KEY ("replacesId") REFERENCES "PurchaseEvidence"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PurchaseEvidenceHistoryEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "evidenceId" UUID NOT NULL,
  "action" "PurchaseEvidenceHistoryAction" NOT NULL,
  "reason" TEXT,
  "userId" TEXT,
  "userName" TEXT,
  "metaJson" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseEvidenceHistoryEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PurchaseEvidenceHistoryEvent_evidenceId_createdAt_idx"
  ON "PurchaseEvidenceHistoryEvent"("evidenceId", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseEvidenceHistoryEvent_action_idx"
  ON "PurchaseEvidenceHistoryEvent"("action");

DO $$ BEGIN
  ALTER TABLE "PurchaseEvidenceHistoryEvent"
    ADD CONSTRAINT "PurchaseEvidenceHistoryEvent_evidenceId_fkey"
    FOREIGN KEY ("evidenceId") REFERENCES "PurchaseEvidence"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
