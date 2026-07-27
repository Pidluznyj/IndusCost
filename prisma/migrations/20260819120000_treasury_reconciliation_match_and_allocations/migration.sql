-- Central de Tesouraria — conciliação bancária (match + allocations).
-- Aditiva: enums + CREATE TABLE + FKs/índices.
-- Não muta Nomus; não cria baixa oficial; soft-unmatch preserva histórico.
-- Não aplicar em produção via Cursor.

CREATE TYPE "TreasuryReconciliationMatchStatus" AS ENUM (
  'PENDING',
  'MATCHED',
  'UNMATCHED',
  'IGNORED'
);

CREATE TYPE "TreasuryReconciliationAllocationKind" AS ENUM (
  'TITLE',
  'FEE',
  'INTEREST',
  'DISCOUNT',
  'ABATEMENT',
  'DIFFERENCE',
  'TRANSFER',
  'MANUAL_LEDGER',
  'UNIDENTIFIED'
);

CREATE TABLE "TreasuryReconciliationMatch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyCode" TEXT NOT NULL,
  "accountId" UUID NOT NULL,
  "status" "TreasuryReconciliationMatchStatus" NOT NULL DEFAULT 'MATCHED',
  "matchedAmount" DECIMAL(20,2) NOT NULL,
  "currency" "TreasuryCurrencyCode" NOT NULL DEFAULT 'BRL',
  "matchedCivilDate" DATE NOT NULL,
  "justification" TEXT,
  "suggestionKey" TEXT,
  "algorithmVersion" TEXT,
  "suggestionScore" INTEGER,
  "suggestionConfidence" TEXT,
  "suggestionReasonsJson" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" UUID NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByUserId" UUID,
  "unmatchedAt" TIMESTAMPTZ(6),
  "unmatchedByUserId" UUID,
  "unmatchReason" TEXT,

  CONSTRAINT "TreasuryReconciliationMatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreasuryReconciliationMatch_companyCode_status_idx"
  ON "TreasuryReconciliationMatch"("companyCode", "status");

CREATE INDEX "TreasuryReconciliationMatch_accountId_matchedCivilDate_idx"
  ON "TreasuryReconciliationMatch"("accountId", "matchedCivilDate");

CREATE INDEX "TreasuryReconciliationMatch_status_idx"
  ON "TreasuryReconciliationMatch"("status");

CREATE INDEX "TreasuryReconciliationMatch_createdByUserId_idx"
  ON "TreasuryReconciliationMatch"("createdByUserId");

CREATE INDEX "TreasuryReconciliationMatch_updatedByUserId_idx"
  ON "TreasuryReconciliationMatch"("updatedByUserId");

CREATE INDEX "TreasuryReconciliationMatch_unmatchedByUserId_idx"
  ON "TreasuryReconciliationMatch"("unmatchedByUserId");

CREATE TABLE "TreasuryReconciliationMatchMovement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "bankMovementId" UUID NOT NULL,
  "amount" DECIMAL(20,2) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryReconciliationMatchMovement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryReconciliationMatchMovement_matchId_bankMovementId_key"
  ON "TreasuryReconciliationMatchMovement"("matchId", "bankMovementId");

CREATE INDEX "TreasuryReconciliationMatchMovement_bankMovementId_idx"
  ON "TreasuryReconciliationMatchMovement"("bankMovementId");

CREATE INDEX "TreasuryReconciliationMatchMovement_matchId_sortOrder_idx"
  ON "TreasuryReconciliationMatchMovement"("matchId", "sortOrder");

CREATE TABLE "TreasuryReconciliationAllocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matchId" UUID NOT NULL,
  "kind" "TreasuryReconciliationAllocationKind" NOT NULL,
  "amount" DECIMAL(20,2) NOT NULL,
  "memo" TEXT,
  "nomusSide" TEXT,
  "officialTitleId" TEXT,
  "nomusExternalId" INTEGER,
  "transferId" UUID,
  "transferGroupId" UUID,
  "ledgerEntryId" UUID,
  "differenceCode" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryReconciliationAllocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreasuryReconciliationAllocation_matchId_kind_idx"
  ON "TreasuryReconciliationAllocation"("matchId", "kind");

CREATE INDEX "TreasuryReconciliationAllocation_officialTitleId_idx"
  ON "TreasuryReconciliationAllocation"("officialTitleId");

CREATE INDEX "TreasuryReconciliationAllocation_nomusExternalId_idx"
  ON "TreasuryReconciliationAllocation"("nomusExternalId");

CREATE INDEX "TreasuryReconciliationAllocation_transferId_idx"
  ON "TreasuryReconciliationAllocation"("transferId");

CREATE INDEX "TreasuryReconciliationAllocation_ledgerEntryId_idx"
  ON "TreasuryReconciliationAllocation"("ledgerEntryId");

ALTER TABLE "TreasuryReconciliationMatch"
  ADD CONSTRAINT "TreasuryReconciliationMatch_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "TreasuryFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryReconciliationMatch"
  ADD CONSTRAINT "TreasuryReconciliationMatch_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryReconciliationMatch"
  ADD CONSTRAINT "TreasuryReconciliationMatch_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryReconciliationMatch"
  ADD CONSTRAINT "TreasuryReconciliationMatch_unmatchedByUserId_fkey"
  FOREIGN KEY ("unmatchedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryReconciliationMatchMovement"
  ADD CONSTRAINT "TreasuryReconciliationMatchMovement_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "TreasuryReconciliationMatch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryReconciliationMatchMovement"
  ADD CONSTRAINT "TreasuryReconciliationMatchMovement_bankMovementId_fkey"
  FOREIGN KEY ("bankMovementId") REFERENCES "TreasuryBankMovement"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryReconciliationAllocation"
  ADD CONSTRAINT "TreasuryReconciliationAllocation_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "TreasuryReconciliationMatch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryReconciliationMatch"
  ADD CONSTRAINT "TreasuryReconciliationMatch_matchedAmount_nonneg_chk"
  CHECK ("matchedAmount" >= 0);

ALTER TABLE "TreasuryReconciliationMatchMovement"
  ADD CONSTRAINT "TreasuryReconciliationMatchMovement_amount_positive_chk"
  CHECK ("amount" > 0);

ALTER TABLE "TreasuryReconciliationAllocation"
  ADD CONSTRAINT "TreasuryReconciliationAllocation_amount_positive_chk"
  CHECK ("amount" > 0);
