-- Cache de consulta a protesto externo.
-- Aditiva. Não altera Contas a Receber, cliente oficial nem pedido.
-- Não aplicada neste ambiente. A integração nasce desligada.

CREATE TABLE IF NOT EXISTS "CommercialExternalProtestConsultation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customerId" UUID,
  "cnpj" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "executionStatus" TEXT NOT NULL,
  "protestSituation" TEXT NOT NULL,
  "occurrenceId" TEXT,
  "evidenceRef" TEXT,
  "source" TEXT NOT NULL,
  "consultedAt" TIMESTAMPTZ(6) NOT NULL,
  "validUntil" TIMESTAMPTZ(6) NOT NULL,
  "errorCode" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialExternalProtestConsultation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialExternalProtestConsultation_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "CommercialExternalProtestConsultation_cnpj_validUntil_idx"
  ON "CommercialExternalProtestConsultation"("cnpj", "validUntil");
CREATE INDEX IF NOT EXISTS "CommercialExternalProtestConsultation_provider_consultedAt_idx"
  ON "CommercialExternalProtestConsultation"("provider", "consultedAt");
CREATE INDEX IF NOT EXISTS "CommercialExternalProtestConsultation_customerId_consultedAt_idx"
  ON "CommercialExternalProtestConsultation"("customerId", "consultedAt");
