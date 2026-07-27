-- Central de Tesouraria — transferências internas entre contas.
-- Aditiva: enum + CREATE TABLE + índices/FKs.
-- Efeito consolidado neutro (duas pernas). Cancelamento lógico.
-- Não aplicar em produção via Cursor.

CREATE TYPE "TreasuryTransferStatus" AS ENUM (
  'FORECAST',
  'SCHEDULED',
  'SENT',
  'RECEIVED',
  'RECONCILED',
  'CANCELLED'
);

CREATE TABLE "TreasuryTransfer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "transferGroupId" UUID NOT NULL,
  "companyCode" TEXT NOT NULL,
  "fromAccountId" UUID NOT NULL,
  "toAccountId" UUID NOT NULL,
  "amount" DECIMAL(20,2) NOT NULL,
  "currency" "TreasuryCurrencyCode" NOT NULL DEFAULT 'BRL',
  "civilDate" DATE NOT NULL,
  "sentCivilDate" DATE,
  "receivedCivilDate" DATE,
  "reconciledCivilDate" DATE,
  "sentAt" TIMESTAMPTZ(6),
  "receivedAt" TIMESTAMPTZ(6),
  "reconciledAt" TIMESTAMPTZ(6),
  "status" "TreasuryTransferStatus" NOT NULL DEFAULT 'FORECAST',
  "memo" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" UUID NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByUserId" UUID,
  "cancelledAt" TIMESTAMPTZ(6),
  "cancelledByUserId" UUID,
  "cancellationReason" TEXT,

  CONSTRAINT "TreasuryTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryTransfer_transferGroupId_key"
  ON "TreasuryTransfer"("transferGroupId");

CREATE INDEX "TreasuryTransfer_companyCode_status_civilDate_idx"
  ON "TreasuryTransfer"("companyCode", "status", "civilDate");

CREATE INDEX "TreasuryTransfer_fromAccountId_civilDate_idx"
  ON "TreasuryTransfer"("fromAccountId", "civilDate");

CREATE INDEX "TreasuryTransfer_toAccountId_civilDate_idx"
  ON "TreasuryTransfer"("toAccountId", "civilDate");

CREATE INDEX "TreasuryTransfer_status_idx"
  ON "TreasuryTransfer"("status");

CREATE INDEX "TreasuryTransfer_createdByUserId_idx"
  ON "TreasuryTransfer"("createdByUserId");

CREATE INDEX "TreasuryTransfer_cancelledAt_idx"
  ON "TreasuryTransfer"("cancelledAt");

ALTER TABLE "TreasuryTransfer"
  ADD CONSTRAINT "TreasuryTransfer_fromAccountId_fkey"
  FOREIGN KEY ("fromAccountId") REFERENCES "TreasuryFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryTransfer"
  ADD CONSTRAINT "TreasuryTransfer_toAccountId_fkey"
  FOREIGN KEY ("toAccountId") REFERENCES "TreasuryFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryTransfer"
  ADD CONSTRAINT "TreasuryTransfer_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryTransfer"
  ADD CONSTRAINT "TreasuryTransfer_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryTransfer"
  ADD CONSTRAINT "TreasuryTransfer_cancelledByUserId_fkey"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
