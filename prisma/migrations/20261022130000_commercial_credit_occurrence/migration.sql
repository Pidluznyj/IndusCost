-- Ocorrências de crédito comercial.
-- Aditiva: não altera Contas a Receber, cliente oficial nem pedido já existente.
-- Não aplicada neste ambiente. Homologação somente, sem execução em produção.

CREATE TABLE IF NOT EXISTS "CommercialCreditOccurrence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customerId" UUID NOT NULL,
  "titleExternalId" INTEGER,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL,
  "responsibleUserId" TEXT NOT NULL,
  "justification" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "closesOccurrenceId" UUID,
  "closedAt" TIMESTAMPTZ(6),
  "closedByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialCreditOccurrence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialCreditOccurrence_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommercialCreditOccurrence_dedupeKey_key"
  ON "CommercialCreditOccurrence"("dedupeKey");
CREATE INDEX IF NOT EXISTS "CommercialCreditOccurrence_customerId_status_kind_idx"
  ON "CommercialCreditOccurrence"("customerId", "status", "kind");
CREATE INDEX IF NOT EXISTS "CommercialCreditOccurrence_customerId_titleExternalId_idx"
  ON "CommercialCreditOccurrence"("customerId", "titleExternalId");

CREATE TABLE IF NOT EXISTS "CommercialCreditOccurrenceEvidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "occurrenceId" UUID NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "uploadedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialCreditOccurrenceEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialCreditOccurrenceEvidence_occurrenceId_fkey"
    FOREIGN KEY ("occurrenceId") REFERENCES "CommercialCreditOccurrence"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "CommercialCreditOccurrenceEvidence_occurrenceId_idx"
  ON "CommercialCreditOccurrenceEvidence"("occurrenceId");
