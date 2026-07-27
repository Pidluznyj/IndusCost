-- Central de Tesouraria — promessas de pagamento sobre títulos oficiais Nomus.
-- Aditiva: enum + CREATE TABLE + índices/FKs AppUser.
-- Não altera vencimento/saldo oficiais. Não aplicar em produção via Cursor.

CREATE TYPE "TreasuryPaymentPromiseStatus" AS ENUM (
  'ACTIVE',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'EXPIRED',
  'BROKEN',
  'CANCELLED'
);

CREATE TABLE "TreasuryPaymentPromise" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "titleType" "TreasuryOfficialTitleKind" NOT NULL,
  "officialTitleId" UUID NOT NULL,
  "officialExternalId" INTEGER NOT NULL,
  "promisedDate" DATE NOT NULL,
  "promisedAmount" DECIMAL(20,2) NOT NULL,
  "fulfilledAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "contactNote" TEXT,
  "channel" TEXT,
  "notes" TEXT,
  "responsibleUserId" UUID,
  "status" "TreasuryPaymentPromiseStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" UUID NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByUserId" UUID,
  "cancelledAt" TIMESTAMPTZ(6),
  "cancelledByUserId" UUID,
  "cancellationReason" TEXT,
  "fulfilledAt" TIMESTAMPTZ(6),

  CONSTRAINT "TreasuryPaymentPromise_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreasuryPaymentPromise_titleType_officialTitleId_idx"
  ON "TreasuryPaymentPromise"("titleType", "officialTitleId");

CREATE INDEX "TreasuryPaymentPromise_titleType_officialExternalId_idx"
  ON "TreasuryPaymentPromise"("titleType", "officialExternalId");

CREATE INDEX "TreasuryPaymentPromise_status_promisedDate_idx"
  ON "TreasuryPaymentPromise"("status", "promisedDate");

CREATE INDEX "TreasuryPaymentPromise_responsibleUserId_idx"
  ON "TreasuryPaymentPromise"("responsibleUserId");

CREATE INDEX "TreasuryPaymentPromise_createdByUserId_idx"
  ON "TreasuryPaymentPromise"("createdByUserId");

CREATE INDEX "TreasuryPaymentPromise_cancelledAt_idx"
  ON "TreasuryPaymentPromise"("cancelledAt");

ALTER TABLE "TreasuryPaymentPromise"
  ADD CONSTRAINT "TreasuryPaymentPromise_responsibleUserId_fkey"
  FOREIGN KEY ("responsibleUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryPaymentPromise"
  ADD CONSTRAINT "TreasuryPaymentPromise_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryPaymentPromise"
  ADD CONSTRAINT "TreasuryPaymentPromise_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryPaymentPromise"
  ADD CONSTRAINT "TreasuryPaymentPromise_cancelledByUserId_fkey"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
