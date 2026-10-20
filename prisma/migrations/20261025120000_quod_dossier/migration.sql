-- Dossiê QUOD Completo. Aditivo. Não altera cadastro de cliente nem saldo oficial.

CREATE TABLE IF NOT EXISTS "QuodDossierConsultation" (
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
    "score" INTEGER,
    "restrictionCount" INTEGER,
    "confirmedRestriction" BOOLEAN NOT NULL DEFAULT false,
    "insufficient" BOOLEAN NOT NULL DEFAULT false,
    "sections" JSONB,
    "partners" JSONB,
    "validUntil" TIMESTAMPTZ(6),
    "consultedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuodDossierConsultation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "QuodDossierConsultation_idempotencyKey_key" ON "QuodDossierConsultation"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "QuodDossierConsultation_customerId_createdAt_idx" ON "QuodDossierConsultation"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "QuodDossierConsultation_cnpj_createdAt_idx" ON "QuodDossierConsultation"("cnpj", "createdAt");
CREATE INDEX IF NOT EXISTS "QuodDossierConsultation_status_idx" ON "QuodDossierConsultation"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "QuodDossierConsultation_inflight_cnpj_idx" ON "QuodDossierConsultation"("cnpj") WHERE "status" IN ('RESERVED', 'SENT');

DO $$ BEGIN
  ALTER TABLE "QuodDossierConsultation" ADD CONSTRAINT "QuodDossierConsultation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
