-- LIKE SERASA — Boa Vista Define Limite Positivo PJ (Direct Data). Aditivo. Persistência própria: nada compartilhado
-- com QUOD/IEPTB. Não altera cadastro de cliente, limite aprovado nem Score de Confiança V1.

CREATE TABLE IF NOT EXISTS "BoaVistaDefineLimiteConsultation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL,
    "companyName" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'LIVE',
    "provider" TEXT NOT NULL DEFAULT 'Direct Data',
    "product" TEXT NOT NULL DEFAULT 'Boa Vista — Define Limite Positivo Pessoa Jurídica',
    "idempotencyKey" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedByRole" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "billingStatus" TEXT NOT NULL,
    "authorizedCostCents" INTEGER NOT NULL,
    "chargedCostCents" INTEGER,
    "providerQueryId" TEXT,
    "providerHttpStatus" INTEGER,
    "providerResult" TEXT,
    "failureCode" TEXT,
    "scoreRaw" TEXT,
    "score" INTEGER,
    "scoreClass" TEXT,
    "riskText" TEXT,
    "defaultProbability" TEXT,
    "suggestedLimitCents" BIGINT,
    "suggestedLimitLabel" TEXT,
    "restrictionCount" INTEGER,
    "confirmedRestriction" BOOLEAN NOT NULL DEFAULT false,
    "insufficient" BOOLEAN NOT NULL DEFAULT false,
    "sections" JSONB,
    "rawPayload" JSONB,
    "parserVersion" TEXT,
    "receiptUrl" TEXT,
    "validUntil" TIMESTAMPTZ(6),
    "consultedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BoaVistaDefineLimiteConsultation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BoaVistaDefineLimiteConsultation_idempotencyKey_key" ON "BoaVistaDefineLimiteConsultation"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "BoaVistaDefineLimiteConsultation_customerId_createdAt_idx" ON "BoaVistaDefineLimiteConsultation"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "BoaVistaDefineLimiteConsultation_cnpj_createdAt_idx" ON "BoaVistaDefineLimiteConsultation"("cnpj", "createdAt");
CREATE INDEX IF NOT EXISTS "BoaVistaDefineLimiteConsultation_status_idx" ON "BoaVistaDefineLimiteConsultation"("status");
-- Trava no banco: uma consulta REAL em andamento por CNPJ (a simulação não concorre com a real).
CREATE UNIQUE INDEX IF NOT EXISTS "BoaVistaDefineLimiteConsultation_inflight_live_cnpj_idx" ON "BoaVistaDefineLimiteConsultation"("cnpj") WHERE "mode" = 'LIVE' AND "status" IN ('RESERVED', 'SENT');

DO $$ BEGIN
  ALTER TABLE "BoaVistaDefineLimiteConsultation" ADD CONSTRAINT "BoaVistaDefineLimiteConsultation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
