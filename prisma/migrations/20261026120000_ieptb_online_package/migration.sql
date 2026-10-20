-- Protestos Nacional IEPTB Online. Aditivo.
-- Não altera cadastro de cliente, saldo oficial, protesto interno Nomus nem o histórico QUOD.

CREATE TABLE IF NOT EXISTS "IeptbOnlineConsultation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL,
    "companyName" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedByRole" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "billingStatus" TEXT NOT NULL,
    "authorizedCostCents" INTEGER NOT NULL,
    "chargedCostCents" INTEGER,
    "providerQueryId" TEXT,
    "providerHttpStatus" INTEGER,
    "failureCode" TEXT,
    "confirmedProtest" BOOLEAN NOT NULL DEFAULT false,
    "confirmedClear" BOOLEAN NOT NULL DEFAULT false,
    "insufficient" BOOLEAN NOT NULL DEFAULT false,
    "protestCount" INTEGER,
    "totalAmount" DOUBLE PRECISION,
    "states" JSONB,
    "coverageNote" TEXT NOT NULL DEFAULT 'IEPTB Online',
    "sections" JSONB,
    "validUntil" TIMESTAMPTZ(6),
    "consultedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IeptbOnlineConsultation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IeptbOnlineConsultation_idempotencyKey_key" ON "IeptbOnlineConsultation"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "IeptbOnlineConsultation_customerId_createdAt_idx" ON "IeptbOnlineConsultation"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "IeptbOnlineConsultation_cnpj_createdAt_idx" ON "IeptbOnlineConsultation"("cnpj", "createdAt");
CREATE INDEX IF NOT EXISTS "IeptbOnlineConsultation_status_idx" ON "IeptbOnlineConsultation"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "IeptbOnlineConsultation_inflight_cnpj_idx" ON "IeptbOnlineConsultation"("cnpj") WHERE "status" IN ('RESERVED', 'SENT');

DO $$ BEGIN
  ALTER TABLE "IeptbOnlineConsultation" ADD CONSTRAINT "IeptbOnlineConsultation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
