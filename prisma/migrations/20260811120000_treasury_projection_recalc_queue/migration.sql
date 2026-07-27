-- Central de Tesouraria — fila persistente de recálculo de projeção (PostgreSQL).
-- Aditiva: enums + CREATE TABLE + índices. Sem broker externo no MVP.
-- Não aplicar em produção via Cursor.

CREATE TYPE "TreasuryProjectionRecalcJobStatus" AS ENUM (
  'PENDING',
  'LOCKED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'DEAD'
);

CREATE TYPE "TreasuryProjectionRecalcEventType" AS ENUM (
  'AR_SYNC',
  'AP_SYNC',
  'SETTLEMENT',
  'CANCELLATION',
  'EXPECTATION',
  'PROMISE',
  'PROGRAMMING',
  'LEDGER_ENTRY',
  'TRANSFER',
  'BALANCE',
  'RECONCILIATION',
  'REVERSAL',
  'CLOSING',
  'REOPENING'
);

CREATE TABLE "TreasuryProjectionRecalcJob" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyCode" TEXT NOT NULL,
  "scenario" "TreasuryProjectionScenario" NOT NULL,
  "eventType" "TreasuryProjectionRecalcEventType" NOT NULL,
  "status" "TreasuryProjectionRecalcJobStatus" NOT NULL DEFAULT 'PENDING',
  "deduplicationKey" TEXT NOT NULL,
  "subjectId" TEXT,
  "payloadJson" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMPTZ(6),
  "lockedBy" TEXT,
  "lockToken" TEXT,
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "lastErrorDetail" JSONB,
  "completedAt" TIMESTAMPTZ(6),
  "requestId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryProjectionRecalcJob_pkey" PRIMARY KEY ("id")
);

-- No máximo um job ativo (PENDING/LOCKED/PROCESSING) por chave de dedupe.
CREATE UNIQUE INDEX "TreasuryProjectionRecalcJob_active_dedupe_uidx"
  ON "TreasuryProjectionRecalcJob" ("deduplicationKey")
  WHERE "status" IN ('PENDING', 'LOCKED', 'PROCESSING');

CREATE INDEX "TreasuryProjectionRecalcJob_claim_idx"
  ON "TreasuryProjectionRecalcJob" ("status", "availableAt");

CREATE INDEX "TreasuryProjectionRecalcJob_company_scenario_status_idx"
  ON "TreasuryProjectionRecalcJob" ("companyCode", "scenario", "status");

CREATE INDEX "TreasuryProjectionRecalcJob_eventType_idx"
  ON "TreasuryProjectionRecalcJob" ("eventType");

CREATE INDEX "TreasuryProjectionRecalcJob_requestId_idx"
  ON "TreasuryProjectionRecalcJob" ("requestId");
