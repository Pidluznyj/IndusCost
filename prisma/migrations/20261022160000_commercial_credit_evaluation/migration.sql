-- Histórico da decisão de crédito. Aditiva.
-- Não copia título, saldo ou payload do Nomus.
-- Não aplicada neste ambiente.

CREATE TABLE IF NOT EXISTS "CommercialCreditEvaluation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customerId" UUID NOT NULL,
  "evaluatedAt" TIMESTAMPTZ(6) NOT NULL,
  "evaluatedBy" TEXT,
  "status" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "enforcement" TEXT NOT NULL,
  "saleKind" TEXT NOT NULL,
  "allowed" BOOLEAN NOT NULL,
  "sources" TEXT NOT NULL,
  "validUntil" TIMESTAMPTZ(6),
  "entityType" TEXT,
  "entityId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialCreditEvaluation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialCreditEvaluation_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "CommercialCreditEvaluation_customerId_evaluatedAt_idx"
  ON "CommercialCreditEvaluation"("customerId", "evaluatedAt");
