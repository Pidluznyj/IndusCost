-- Central de Tesouraria — complemento operacional de títulos oficiais Nomus.
-- Aditiva: enums + CREATE TABLE + índices/unicidade.
-- Não copia cliente/fornecedor/valor original/vencimento oficial.
-- Não aplicar em produção via Cursor — usuário executa migrate deploy.

CREATE TYPE "TreasuryOfficialTitleKind" AS ENUM ('RECEIVABLE', 'PAYABLE');

CREATE TYPE "TreasuryTitleOperationalStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

CREATE TYPE "TreasuryTitleOperationalPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

CREATE TABLE "TreasuryTitleOperationalComplement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "titleType" "TreasuryOfficialTitleKind" NOT NULL,
  "officialTitleId" UUID NOT NULL,
  "officialExternalId" INTEGER NOT NULL,
  "expectedDate" DATE,
  "confirmedDate" DATE,
  "scheduledDate" DATE,
  "expectedAmount" DECIMAL(20,2),
  "confirmedAmount" DECIMAL(20,2),
  "scheduledAmount" DECIMAL(20,2),
  "status" "TreasuryTitleOperationalStatus" NOT NULL DEFAULT 'ACTIVE',
  "priority" "TreasuryTitleOperationalPriority" NOT NULL DEFAULT 'NORMAL',
  "plannedAccountId" UUID,
  "responsibleUserId" UUID,
  "nextAction" TEXT,
  "reason" TEXT,
  "notes" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" UUID NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByUserId" UUID,
  "cancelledAt" TIMESTAMPTZ(6),
  "cancelledByUserId" UUID,
  "cancellationReason" TEXT,

  CONSTRAINT "TreasuryTitleOperationalComplement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryTitleOperationalComplement_titleType_officialTitleId_key"
  ON "TreasuryTitleOperationalComplement"("titleType", "officialTitleId");

CREATE UNIQUE INDEX "TreasuryTitleOperationalComplement_titleType_officialExternalId_key"
  ON "TreasuryTitleOperationalComplement"("titleType", "officialExternalId");

CREATE INDEX "TreasuryTitleOperationalComplement_titleType_status_idx"
  ON "TreasuryTitleOperationalComplement"("titleType", "status");

CREATE INDEX "TreasuryTitleOperationalComplement_expectedDate_idx"
  ON "TreasuryTitleOperationalComplement"("expectedDate");

CREATE INDEX "TreasuryTitleOperationalComplement_confirmedDate_idx"
  ON "TreasuryTitleOperationalComplement"("confirmedDate");

CREATE INDEX "TreasuryTitleOperationalComplement_scheduledDate_idx"
  ON "TreasuryTitleOperationalComplement"("scheduledDate");

CREATE INDEX "TreasuryTitleOperationalComplement_plannedAccountId_idx"
  ON "TreasuryTitleOperationalComplement"("plannedAccountId");

CREATE INDEX "TreasuryTitleOperationalComplement_responsibleUserId_idx"
  ON "TreasuryTitleOperationalComplement"("responsibleUserId");

CREATE INDEX "TreasuryTitleOperationalComplement_createdByUserId_idx"
  ON "TreasuryTitleOperationalComplement"("createdByUserId");

CREATE INDEX "TreasuryTitleOperationalComplement_cancelledAt_idx"
  ON "TreasuryTitleOperationalComplement"("cancelledAt");

ALTER TABLE "TreasuryTitleOperationalComplement"
  ADD CONSTRAINT "TreasuryTitleOperationalComplement_plannedAccountId_fkey"
  FOREIGN KEY ("plannedAccountId") REFERENCES "TreasuryFinancialAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryTitleOperationalComplement"
  ADD CONSTRAINT "TreasuryTitleOperationalComplement_responsibleUserId_fkey"
  FOREIGN KEY ("responsibleUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryTitleOperationalComplement"
  ADD CONSTRAINT "TreasuryTitleOperationalComplement_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryTitleOperationalComplement"
  ADD CONSTRAINT "TreasuryTitleOperationalComplement_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryTitleOperationalComplement"
  ADD CONSTRAINT "TreasuryTitleOperationalComplement_cancelledByUserId_fkey"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
