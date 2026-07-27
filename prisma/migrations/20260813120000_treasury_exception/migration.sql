-- Central de Tesouraria — exceções operacionais persistidas.
-- Aditiva: enums + CREATE TABLE + índices/FKs.
-- Idempotência por uniqueKey (mesma causa aberta atualiza; recorrência preservada).
-- Não aplicar em produção via Cursor.

CREATE TYPE "TreasuryExceptionSeverity" AS ENUM (
  'INFO',
  'WARNING',
  'CRITICAL'
);

CREATE TYPE "TreasuryExceptionStatus" AS ENUM (
  'OPEN',
  'ACK',
  'RESOLVED',
  'CANCELLED'
);

CREATE TYPE "TreasuryExceptionType" AS ENUM (
  'POSITION_ALERT',
  'BALANCE_DIVERGENCE',
  'NEGATIVE_BALANCE',
  'HIGH_PRIORITY_RECEIVABLES',
  'HIGH_PRIORITY_PAYABLES',
  'OVERDUE_WITHOUT_FORECAST',
  'TRANSFER_IN_TRANSIT',
  'OFX_UNMATCHED',
  'MANUAL',
  'OTHER'
);

CREATE TYPE "TreasuryExceptionEntityKind" AS ENUM (
  'ACCOUNT',
  'RECEIVABLE',
  'PAYABLE',
  'TRANSFER',
  'LEDGER_ENTRY',
  'POSITION',
  'PROJECTION',
  'CLOSING',
  'RECONCILIATION',
  'OTHER'
);

CREATE TABLE "TreasuryException" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyCode" TEXT NOT NULL,
  "uniqueKey" TEXT NOT NULL,
  "type" "TreasuryExceptionType" NOT NULL,
  "severity" "TreasuryExceptionSeverity" NOT NULL,
  "status" "TreasuryExceptionStatus" NOT NULL DEFAULT 'OPEN',
  "entityKind" "TreasuryExceptionEntityKind",
  "entityId" TEXT,
  "accountId" UUID,
  "nomusExternalId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "amount" DECIMAL(20,2),
  "detectedAt" TIMESTAMPTZ(6) NOT NULL,
  "dueAt" DATE,
  "responsibleUserId" UUID,
  "resolution" TEXT,
  "ignoreJustification" TEXT,
  "recurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "metadataJson" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" UUID NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByUserId" UUID,
  "acknowledgedAt" TIMESTAMPTZ(6),
  "resolvedAt" TIMESTAMPTZ(6),
  "cancelledAt" TIMESTAMPTZ(6),
  "cancelledByUserId" UUID,

  CONSTRAINT "TreasuryException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryException_uniqueKey_key"
  ON "TreasuryException"("uniqueKey");

CREATE INDEX "TreasuryException_companyCode_status_severity_idx"
  ON "TreasuryException"("companyCode", "status", "severity");

CREATE INDEX "TreasuryException_type_status_idx"
  ON "TreasuryException"("type", "status");

CREATE INDEX "TreasuryException_entityKind_entityId_idx"
  ON "TreasuryException"("entityKind", "entityId");

CREATE INDEX "TreasuryException_accountId_idx"
  ON "TreasuryException"("accountId");

CREATE INDEX "TreasuryException_responsibleUserId_idx"
  ON "TreasuryException"("responsibleUserId");

CREATE INDEX "TreasuryException_detectedAt_idx"
  ON "TreasuryException"("detectedAt");

CREATE INDEX "TreasuryException_dueAt_idx"
  ON "TreasuryException"("dueAt");

CREATE INDEX "TreasuryException_createdByUserId_idx"
  ON "TreasuryException"("createdByUserId");

ALTER TABLE "TreasuryException"
  ADD CONSTRAINT "TreasuryException_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "TreasuryFinancialAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryException"
  ADD CONSTRAINT "TreasuryException_responsibleUserId_fkey"
  FOREIGN KEY ("responsibleUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryException"
  ADD CONSTRAINT "TreasuryException_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryException"
  ADD CONSTRAINT "TreasuryException_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryException"
  ADD CONSTRAINT "TreasuryException_cancelledByUserId_fkey"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
