-- Central de Tesouraria — lançamentos manuais/locais (ledger).
-- Aditiva: enums + CREATE TABLE + índices/FKs.
-- Reversão lógica (status REVERSED + lançamento REVERSAL); sem DELETE.
-- Não alterar títulos oficiais Nomus. Não aplicar em produção via Cursor.

CREATE TYPE "TreasuryLedgerDirection" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "TreasuryLedgerNature" AS ENUM (
  'MANUAL',
  'TRANSFER',
  'OFX_MATCH',
  'ADJUSTMENT',
  'REVERSAL'
);
CREATE TYPE "TreasuryLedgerStatus" AS ENUM ('ACTIVE', 'REVERSED');

CREATE TABLE "TreasuryLedgerEntry" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyCode" TEXT NOT NULL,
  "accountId" UUID NOT NULL,
  "civilDate" DATE NOT NULL,
  "amount" DECIMAL(20,2) NOT NULL,
  "currency" "TreasuryCurrencyCode" NOT NULL DEFAULT 'BRL',
  "direction" "TreasuryLedgerDirection" NOT NULL,
  "nature" "TreasuryLedgerNature" NOT NULL,
  "status" "TreasuryLedgerStatus" NOT NULL DEFAULT 'ACTIVE',
  "memo" TEXT,
  "counterpartRef" TEXT,
  "transferGroupId" UUID,
  "reversesEntryId" UUID,
  "reversedByEntryId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" UUID NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByUserId" UUID,

  CONSTRAINT "TreasuryLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryLedgerEntry_reversedByEntryId_key"
  ON "TreasuryLedgerEntry"("reversedByEntryId");

CREATE INDEX "TreasuryLedgerEntry_companyCode_accountId_civilDate_idx"
  ON "TreasuryLedgerEntry"("companyCode", "accountId", "civilDate");

CREATE INDEX "TreasuryLedgerEntry_accountId_status_civilDate_idx"
  ON "TreasuryLedgerEntry"("accountId", "status", "civilDate");

CREATE INDEX "TreasuryLedgerEntry_status_idx"
  ON "TreasuryLedgerEntry"("status");

CREATE INDEX "TreasuryLedgerEntry_nature_idx"
  ON "TreasuryLedgerEntry"("nature");

CREATE INDEX "TreasuryLedgerEntry_createdByUserId_idx"
  ON "TreasuryLedgerEntry"("createdByUserId");

CREATE INDEX "TreasuryLedgerEntry_reversesEntryId_idx"
  ON "TreasuryLedgerEntry"("reversesEntryId");

ALTER TABLE "TreasuryLedgerEntry"
  ADD CONSTRAINT "TreasuryLedgerEntry_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "TreasuryFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryLedgerEntry"
  ADD CONSTRAINT "TreasuryLedgerEntry_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryLedgerEntry"
  ADD CONSTRAINT "TreasuryLedgerEntry_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryLedgerEntry"
  ADD CONSTRAINT "TreasuryLedgerEntry_reversesEntryId_fkey"
  FOREIGN KEY ("reversesEntryId") REFERENCES "TreasuryLedgerEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryLedgerEntry"
  ADD CONSTRAINT "TreasuryLedgerEntry_reversedByEntryId_fkey"
  FOREIGN KEY ("reversedByEntryId") REFERENCES "TreasuryLedgerEntry"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
