-- Consulta semanal de CNPJ. Aditiva.
-- Não altera cadastro de cliente, fornecedor nem saldo oficial.
-- Não aplicada neste ambiente.

CREATE TABLE IF NOT EXISTS "CnpjRefreshRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scheduleSlot" TEXT,
  "trigger" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ(6),
  "finishedAt" TIMESTAMPTZ(6),
  "heartbeatAt" TIMESTAMPTZ(6),
  "eligibleCount" INTEGER NOT NULL DEFAULT 0,
  "consultedCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "partialCount" INTEGER NOT NULL DEFAULT 0,
  "invalidCount" INTEGER NOT NULL DEFAULT 0,
  "missingDocumentCount" INTEGER NOT NULL DEFAULT 0,
  "customerCount" INTEGER NOT NULL DEFAULT 0,
  "supplierCount" INTEGER NOT NULL DEFAULT 0,
  "lastCnpj" TEXT,
  "sourceLabel" TEXT,
  "statusDetail" TEXT,
  "errorMessage" TEXT,
  "requestedByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CnpjRefreshRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CnpjRefreshRun_scheduleSlot_key" ON "CnpjRefreshRun"("scheduleSlot");
CREATE UNIQUE INDEX IF NOT EXISTS "CnpjRefreshRun_single_running_idx" ON "CnpjRefreshRun"("status") WHERE "status" = 'RUNNING';
CREATE INDEX IF NOT EXISTS "CnpjRefreshRun_status_idx" ON "CnpjRefreshRun"("status");
CREATE INDEX IF NOT EXISTS "CnpjRefreshRun_createdAt_idx" ON "CnpjRefreshRun"("createdAt");

CREATE TABLE IF NOT EXISTS "CnpjRefreshRunItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "subjectKey" TEXT NOT NULL,
  "cnpj" TEXT,
  "status" TEXT NOT NULL,
  "partyKind" TEXT NOT NULL,
  "customerId" UUID,
  "supplierIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "digitLength" INTEGER,
  "documentClass" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lookupId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "consultedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CnpjRefreshRunItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CnpjRefreshRunItem_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "CnpjRefreshRun"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "CnpjRefreshRunItem_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "CnpjRefreshRunItem_runId_subjectKey_key" ON "CnpjRefreshRunItem"("runId", "subjectKey");
CREATE INDEX IF NOT EXISTS "CnpjRefreshRunItem_runId_status_idx" ON "CnpjRefreshRunItem"("runId", "status");
CREATE INDEX IF NOT EXISTS "CnpjRefreshRunItem_customerId_idx" ON "CnpjRefreshRunItem"("customerId");

CREATE TABLE IF NOT EXISTS "CnpjCadastreChange" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "cnpj" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "previousValue" TEXT,
  "nextValue" TEXT,
  "source" TEXT,
  "consultedAt" TIMESTAMPTZ(6) NOT NULL,
  "detectedAt" TIMESTAMPTZ(6) NOT NULL,
  "lookupId" TEXT,
  CONSTRAINT "CnpjCadastreChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CnpjCadastreChange_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "CnpjRefreshRun"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "CnpjCadastreChange_runId_idx" ON "CnpjCadastreChange"("runId");
CREATE INDEX IF NOT EXISTS "CnpjCadastreChange_cnpj_detectedAt_idx" ON "CnpjCadastreChange"("cnpj", "detectedAt");

CREATE TABLE IF NOT EXISTS "CnpjCadastreDivergence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "cnpj" TEXT NOT NULL,
  "partyKind" TEXT NOT NULL,
  "partyId" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "officialValue" TEXT,
  "consultedValue" TEXT,
  "detectedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CnpjCadastreDivergence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CnpjCadastreDivergence_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "CnpjRefreshRun"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "CnpjCadastreDivergence_runId_idx" ON "CnpjCadastreDivergence"("runId");
CREATE INDEX IF NOT EXISTS "CnpjCadastreDivergence_partyId_idx" ON "CnpjCadastreDivergence"("partyId");
