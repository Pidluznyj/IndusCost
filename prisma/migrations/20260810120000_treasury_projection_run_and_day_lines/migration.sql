-- Central de Tesouraria — execução de projeção, linhas diárias e composição.
-- Aditiva: enums + CREATE TABLE + índices/FKs AppUser e TreasuryFinancialAccount.
-- Não aplicar em produção via Cursor.

CREATE TYPE "TreasuryProjectionScenario" AS ENUM (
  'CONTRACTUAL',
  'PROBABLE',
  'CONFIRMED',
  'MANUAL'
);

CREATE TYPE "TreasuryProjectionRunStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'PARTIAL',
  'CANCELLED'
);

CREATE TYPE "TreasuryProjectionRiskCode" AS ENUM (
  'NONE',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
);

CREATE TYPE "TreasuryProjectionItemKind" AS ENUM (
  'RECEIVABLE',
  'PAYABLE',
  'TRANSFER',
  'MANUAL_ENTRY',
  'REALIZED',
  'UNCERTAIN_RECEIVABLE',
  'OTHER'
);

CREATE TABLE "TreasuryProjectionRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyCode" TEXT,
  "scenario" "TreasuryProjectionScenario" NOT NULL,
  "status" "TreasuryProjectionRunStatus" NOT NULL DEFAULT 'PENDING',
  "periodFrom" DATE NOT NULL,
  "periodTo" DATE NOT NULL,
  "sourceVersion" TEXT NOT NULL,
  "algorithmVersion" TEXT NOT NULL,
  "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(6),
  "finishedAt" TIMESTAMPTZ(6),
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "failureDetail" JSONB,
  "requestId" TEXT,
  "idempotencyKey" TEXT,
  "notes" TEXT,
  "lineCount" INTEGER NOT NULL DEFAULT 0,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByUserId" UUID,

  CONSTRAINT "TreasuryProjectionRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryProjectionRun_idempotencyKey_key"
  ON "TreasuryProjectionRun"("idempotencyKey");

CREATE INDEX "TreasuryProjectionRun_companyCode_scenario_status_idx"
  ON "TreasuryProjectionRun"("companyCode", "scenario", "status");

CREATE INDEX "TreasuryProjectionRun_scenario_periodFrom_periodTo_idx"
  ON "TreasuryProjectionRun"("scenario", "periodFrom", "periodTo");

CREATE INDEX "TreasuryProjectionRun_sourceVersion_algorithmVersion_idx"
  ON "TreasuryProjectionRun"("sourceVersion", "algorithmVersion");

CREATE INDEX "TreasuryProjectionRun_status_requestedAt_idx"
  ON "TreasuryProjectionRun"("status", "requestedAt");

CREATE INDEX "TreasuryProjectionRun_createdByUserId_idx"
  ON "TreasuryProjectionRun"("createdByUserId");

CREATE INDEX "TreasuryProjectionRun_requestId_idx"
  ON "TreasuryProjectionRun"("requestId");

ALTER TABLE "TreasuryProjectionRun"
  ADD CONSTRAINT "TreasuryProjectionRun_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryProjectionRun"
  ADD CONSTRAINT "TreasuryProjectionRun_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TreasuryProjectionDayLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "civilDate" DATE NOT NULL,
  "openingBalance" DECIMAL(20,2) NOT NULL,
  "inflows" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "outflows" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "transfers" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "realized" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "closingBalance" DECIMAL(20,2) NOT NULL,
  "uncertainReceivables" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "minimumBalance" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "riskAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "riskCode" "TreasuryProjectionRiskCode" NOT NULL DEFAULT 'NONE',
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryProjectionDayLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryProjectionDayLine_runId_accountId_civilDate_key"
  ON "TreasuryProjectionDayLine"("runId", "accountId", "civilDate");

CREATE INDEX "TreasuryProjectionDayLine_runId_civilDate_idx"
  ON "TreasuryProjectionDayLine"("runId", "civilDate");

CREATE INDEX "TreasuryProjectionDayLine_accountId_civilDate_idx"
  ON "TreasuryProjectionDayLine"("accountId", "civilDate");

CREATE INDEX "TreasuryProjectionDayLine_riskCode_idx"
  ON "TreasuryProjectionDayLine"("riskCode");

ALTER TABLE "TreasuryProjectionDayLine"
  ADD CONSTRAINT "TreasuryProjectionDayLine_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "TreasuryProjectionRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TreasuryProjectionDayLine"
  ADD CONSTRAINT "TreasuryProjectionDayLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "TreasuryFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TreasuryProjectionCompositionItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "dayLineId" UUID NOT NULL,
  "itemKind" "TreasuryProjectionItemKind" NOT NULL,
  "amount" DECIMAL(20,2) NOT NULL,
  "label" TEXT,
  "officialTitleId" UUID,
  "nomusExternalId" INTEGER,
  "ledgerEntryId" UUID,
  "transferGroupId" UUID,
  "sourceRef" TEXT,
  "metadataJson" JSONB,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryProjectionCompositionItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreasuryProjectionCompositionItem_dayLineId_sortOrder_idx"
  ON "TreasuryProjectionCompositionItem"("dayLineId", "sortOrder");

CREATE INDEX "TreasuryProjectionCompositionItem_itemKind_idx"
  ON "TreasuryProjectionCompositionItem"("itemKind");

CREATE INDEX "TreasuryProjectionCompositionItem_officialTitleId_idx"
  ON "TreasuryProjectionCompositionItem"("officialTitleId");

CREATE INDEX "TreasuryProjectionCompositionItem_nomusExternalId_idx"
  ON "TreasuryProjectionCompositionItem"("nomusExternalId");

CREATE INDEX "TreasuryProjectionCompositionItem_transferGroupId_idx"
  ON "TreasuryProjectionCompositionItem"("transferGroupId");

ALTER TABLE "TreasuryProjectionCompositionItem"
  ADD CONSTRAINT "TreasuryProjectionCompositionItem_dayLineId_fkey"
  FOREIGN KEY ("dayLineId") REFERENCES "TreasuryProjectionDayLine"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
