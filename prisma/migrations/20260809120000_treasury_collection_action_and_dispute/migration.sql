-- Central de Tesouraria — ações de cobrança + contestações.
-- Aditiva: enums + CREATE TABLE + índices/FKs AppUser.
-- Histórico append-only (sem DELETE). Não aplicar em produção via Cursor.

CREATE TYPE "TreasuryCollectionActionType" AS ENUM (
  'PHONE',
  'WHATSAPP',
  'EMAIL',
  'MEETING',
  'COMMERCIAL_CONTACT',
  'INTERNAL_ANALYSIS',
  'OTHER'
);

CREATE TYPE "TreasuryDisputeStatus" AS ENUM (
  'OPEN',
  'RESOLVED',
  'CANCELLED'
);

CREATE TABLE "TreasuryCollectionAction" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "titleType" "TreasuryOfficialTitleKind" NOT NULL,
  "officialTitleId" UUID NOT NULL,
  "officialExternalId" INTEGER NOT NULL,
  "actionType" "TreasuryCollectionActionType" NOT NULL,
  "performedAt" TIMESTAMPTZ(6) NOT NULL,
  "contactPerson" TEXT,
  "result" TEXT,
  "notes" TEXT,
  "nextAction" TEXT,
  "responsibleUserId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" UUID NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByUserId" UUID,
  "cancelledAt" TIMESTAMPTZ(6),
  "cancelledByUserId" UUID,
  "cancellationReason" TEXT,

  CONSTRAINT "TreasuryCollectionAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreasuryCollectionAction_titleType_officialTitleId_idx"
  ON "TreasuryCollectionAction"("titleType", "officialTitleId");

CREATE INDEX "TreasuryCollectionAction_titleType_officialExternalId_idx"
  ON "TreasuryCollectionAction"("titleType", "officialExternalId");

CREATE INDEX "TreasuryCollectionAction_actionType_performedAt_idx"
  ON "TreasuryCollectionAction"("actionType", "performedAt");

CREATE INDEX "TreasuryCollectionAction_nextAction_idx"
  ON "TreasuryCollectionAction"("nextAction");

CREATE INDEX "TreasuryCollectionAction_responsibleUserId_idx"
  ON "TreasuryCollectionAction"("responsibleUserId");

CREATE INDEX "TreasuryCollectionAction_createdByUserId_idx"
  ON "TreasuryCollectionAction"("createdByUserId");

CREATE INDEX "TreasuryCollectionAction_cancelledAt_idx"
  ON "TreasuryCollectionAction"("cancelledAt");

ALTER TABLE "TreasuryCollectionAction"
  ADD CONSTRAINT "TreasuryCollectionAction_responsibleUserId_fkey"
  FOREIGN KEY ("responsibleUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryCollectionAction"
  ADD CONSTRAINT "TreasuryCollectionAction_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryCollectionAction"
  ADD CONSTRAINT "TreasuryCollectionAction_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryCollectionAction"
  ADD CONSTRAINT "TreasuryCollectionAction_cancelledByUserId_fkey"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TreasuryDispute" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "titleType" "TreasuryOfficialTitleKind" NOT NULL,
  "officialTitleId" UUID NOT NULL,
  "officialExternalId" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "amountDisputed" DECIMAL(20,2),
  "responsibleUserId" UUID,
  "involvedArea" TEXT,
  "dueDate" DATE,
  "notes" TEXT,
  "status" "TreasuryDisputeStatus" NOT NULL DEFAULT 'OPEN',
  "resolutionNote" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" UUID NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByUserId" UUID,
  "cancelledAt" TIMESTAMPTZ(6),
  "cancelledByUserId" UUID,
  "resolvedAt" TIMESTAMPTZ(6),

  CONSTRAINT "TreasuryDispute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreasuryDispute_titleType_officialTitleId_idx"
  ON "TreasuryDispute"("titleType", "officialTitleId");

CREATE INDEX "TreasuryDispute_titleType_officialExternalId_idx"
  ON "TreasuryDispute"("titleType", "officialExternalId");

CREATE INDEX "TreasuryDispute_status_dueDate_idx"
  ON "TreasuryDispute"("status", "dueDate");

CREATE INDEX "TreasuryDispute_responsibleUserId_idx"
  ON "TreasuryDispute"("responsibleUserId");

CREATE INDEX "TreasuryDispute_createdByUserId_idx"
  ON "TreasuryDispute"("createdByUserId");

CREATE INDEX "TreasuryDispute_cancelledAt_idx"
  ON "TreasuryDispute"("cancelledAt");

ALTER TABLE "TreasuryDispute"
  ADD CONSTRAINT "TreasuryDispute_responsibleUserId_fkey"
  FOREIGN KEY ("responsibleUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryDispute"
  ADD CONSTRAINT "TreasuryDispute_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryDispute"
  ADD CONSTRAINT "TreasuryDispute_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryDispute"
  ADD CONSTRAINT "TreasuryDispute_cancelledByUserId_fkey"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
