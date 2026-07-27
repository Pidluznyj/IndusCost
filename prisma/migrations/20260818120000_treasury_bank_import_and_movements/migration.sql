-- Central de Tesouraria — lote de importação bancária + movimentos normalizados.
-- Aditiva: enums + CREATE TABLE + índices/unicidade anti-duplicidade.
-- Não armazena arquivo OFX bruto nem número de conta completo.
-- Não aplicar em produção via Cursor.

CREATE TYPE "TreasuryBankImportBatchStatus" AS ENUM (
  'RECEIVED',
  'PROCESSED',
  'FAILED',
  'DISCARDED'
);

CREATE TYPE "TreasuryBankOfxFormat" AS ENUM (
  'OFX1',
  'OFX2',
  'UNKNOWN'
);

CREATE TYPE "TreasuryBankMovementDirection" AS ENUM (
  'DEBIT',
  'CREDIT'
);

CREATE TYPE "TreasuryBankMovementReconciliationStatus" AS ENUM (
  'PENDING',
  'PARTIAL',
  'MATCHED',
  'UNMATCHED',
  'IGNORED'
);

CREATE TABLE "TreasuryBankImportBatch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyCode" TEXT NOT NULL,
  "accountId" UUID NOT NULL,
  "fileSha256" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "byteLength" INTEGER NOT NULL,
  "format" "TreasuryBankOfxFormat" NOT NULL DEFAULT 'UNKNOWN',
  "status" "TreasuryBankImportBatchStatus" NOT NULL DEFAULT 'RECEIVED',
  "transactionCount" INTEGER NOT NULL DEFAULT 0,
  "summaryJson" JSONB,
  "requestId" TEXT,
  "notes" TEXT,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ(6),

  CONSTRAINT "TreasuryBankImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryBankImportBatch_accountId_fileSha256_key"
  ON "TreasuryBankImportBatch"("accountId", "fileSha256");

CREATE INDEX "TreasuryBankImportBatch_companyCode_createdAt_idx"
  ON "TreasuryBankImportBatch"("companyCode", "createdAt");

CREATE INDEX "TreasuryBankImportBatch_accountId_status_idx"
  ON "TreasuryBankImportBatch"("accountId", "status");

CREATE INDEX "TreasuryBankImportBatch_status_idx"
  ON "TreasuryBankImportBatch"("status");

CREATE INDEX "TreasuryBankImportBatch_fileSha256_idx"
  ON "TreasuryBankImportBatch"("fileSha256");

CREATE INDEX "TreasuryBankImportBatch_createdByUserId_idx"
  ON "TreasuryBankImportBatch"("createdByUserId");

CREATE INDEX "TreasuryBankImportBatch_requestId_idx"
  ON "TreasuryBankImportBatch"("requestId");

CREATE TABLE "TreasuryBankMovement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batchId" UUID NOT NULL,
  "companyCode" TEXT NOT NULL,
  "accountId" UUID NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "fitId" TEXT,
  "direction" "TreasuryBankMovementDirection" NOT NULL,
  "amount" DECIMAL(20,2) NOT NULL,
  "currency" "TreasuryCurrencyCode" NOT NULL DEFAULT 'BRL',
  "postedCivilDate" DATE NOT NULL,
  "userCivilDate" DATE,
  "description" TEXT,
  "documentNumber" TEXT,
  "counterpartyName" TEXT,
  "trnType" TEXT,
  "reconciliationStatus" "TreasuryBankMovementReconciliationStatus" NOT NULL DEFAULT 'PENDING',
  "reconciledAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "normalizedPayloadJson" JSONB,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryBankMovement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryBankMovement_accountId_fingerprint_key"
  ON "TreasuryBankMovement"("accountId", "fingerprint");

CREATE UNIQUE INDEX "TreasuryBankMovement_accountId_fitId_key"
  ON "TreasuryBankMovement"("accountId", "fitId");

CREATE INDEX "TreasuryBankMovement_batchId_sortOrder_idx"
  ON "TreasuryBankMovement"("batchId", "sortOrder");

CREATE INDEX "TreasuryBankMovement_companyCode_postedCivilDate_idx"
  ON "TreasuryBankMovement"("companyCode", "postedCivilDate");

CREATE INDEX "TreasuryBankMovement_accountId_postedCivilDate_idx"
  ON "TreasuryBankMovement"("accountId", "postedCivilDate");

CREATE INDEX "TreasuryBankMovement_accountId_reconciliationStatus_idx"
  ON "TreasuryBankMovement"("accountId", "reconciliationStatus");

CREATE INDEX "TreasuryBankMovement_reconciliationStatus_idx"
  ON "TreasuryBankMovement"("reconciliationStatus");

CREATE INDEX "TreasuryBankMovement_direction_idx"
  ON "TreasuryBankMovement"("direction");

CREATE INDEX "TreasuryBankMovement_fitId_idx"
  ON "TreasuryBankMovement"("fitId");

CREATE INDEX "TreasuryBankMovement_documentNumber_idx"
  ON "TreasuryBankMovement"("documentNumber");

ALTER TABLE "TreasuryBankImportBatch"
  ADD CONSTRAINT "TreasuryBankImportBatch_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "TreasuryFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryBankImportBatch"
  ADD CONSTRAINT "TreasuryBankImportBatch_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryBankMovement"
  ADD CONSTRAINT "TreasuryBankMovement_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "TreasuryBankImportBatch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryBankMovement"
  ADD CONSTRAINT "TreasuryBankMovement_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "TreasuryFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Valor conciliado não pode exceder o valor do movimento (defesa no banco).
ALTER TABLE "TreasuryBankMovement"
  ADD CONSTRAINT "TreasuryBankMovement_reconciledAmount_range_chk"
  CHECK ("reconciledAmount" >= 0 AND "reconciledAmount" <= "amount");

ALTER TABLE "TreasuryBankMovement"
  ADD CONSTRAINT "TreasuryBankMovement_amount_nonneg_chk"
  CHECK ("amount" >= 0);
