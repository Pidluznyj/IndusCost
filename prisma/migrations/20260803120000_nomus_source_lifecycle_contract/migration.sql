-- SYNC-02 — Contrato comum de ciclo de vida Nomus (schema + execução tipada).
-- Aditiva: não altera externalId, chaves oficiais nem valores comerciais/financeiros.
-- Inicialização técnica: PRESENT / presentInLastPayload=true / missingConsecutiveRuns=0.
-- Rollback lógico: dropar colunas novas + tabela NomusSourceSyncRun + enums (ver docs).

-- Enums
CREATE TYPE "NomusSourcePresenceStatus" AS ENUM ('PRESENT', 'MISSING_CANDIDATE', 'MISSING_CONFIRMED');
CREATE TYPE "NomusSourceSyncEntityType" AS ENUM ('SALES_ORDER', 'ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE');
CREATE TYPE "NomusSourceSyncRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'INCONCLUSIVE');

-- Execução tipada de sync (complementa IntegrationRun)
CREATE TABLE "NomusSourceSyncRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entityType" "NomusSourceSyncEntityType" NOT NULL,
    "strategy" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" "NomusSourceSyncRunStatus" NOT NULL DEFAULT 'RUNNING',
    "payloadComplete" BOOLEAN NOT NULL DEFAULT false,
    "pagesRead" INTEGER NOT NULL DEFAULT 0,
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "missingCandidateCount" INTEGER NOT NULL DEFAULT 0,
    "missingConfirmedCount" INTEGER NOT NULL DEFAULT 0,
    "reactivatedCount" INTEGER NOT NULL DEFAULT 0,
    "http429Count" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "coveredFrom" TIMESTAMP(3),
    "coveredTo" TIMESTAMP(3),
    "errorMessage" TEXT,
    "summaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NomusSourceSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NomusSourceSyncRun_entityType_status_startedAt_idx"
  ON "NomusSourceSyncRun"("entityType", "status", "startedAt");
CREATE INDEX "NomusSourceSyncRun_status_idx" ON "NomusSourceSyncRun"("status");
CREATE INDEX "NomusSourceSyncRun_payloadComplete_idx" ON "NomusSourceSyncRun"("payloadComplete");
CREATE INDEX "NomusSourceSyncRun_startedAt_idx" ON "NomusSourceSyncRun"("startedAt");
CREATE INDEX "NomusSourceSyncRun_entityType_coveredFrom_coveredTo_idx"
  ON "NomusSourceSyncRun"("entityType", "coveredFrom", "coveredTo");

-- SalesOrder (payloadHash novo; demais defaults seguros)
ALTER TABLE "SalesOrder" ADD COLUMN "payloadHash" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "sourcePresenceStatus" "NomusSourcePresenceStatus" NOT NULL DEFAULT 'PRESENT';
ALTER TABLE "SalesOrder" ADD COLUMN "presentInLastPayload" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SalesOrder" ADD COLUMN "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SalesOrder" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SalesOrder" ADD COLUMN "missingSince" TIMESTAMP(3);
ALTER TABLE "SalesOrder" ADD COLUMN "missingConsecutiveRuns" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrder" ADD COLUMN "sourceRemovedAt" TIMESTAMP(3);
ALTER TABLE "SalesOrder" ADD COLUMN "lastSyncRunId" UUID;

-- Inicialização técnica sem alterar dados comerciais: best-effort timestamps
UPDATE "SalesOrder" SET "firstSeenAt" = "createdAt", "lastSeenAt" = "updatedAt";

CREATE INDEX "SalesOrder_sourcePresenceStatus_idx" ON "SalesOrder"("sourcePresenceStatus");
CREATE INDEX "SalesOrder_lastSeenAt_idx" ON "SalesOrder"("lastSeenAt");
CREATE INDEX "SalesOrder_lastSyncRunId_idx" ON "SalesOrder"("lastSyncRunId");
CREATE INDEX "SalesOrder_externalSalesOrderId_idx" ON "SalesOrder"("externalSalesOrderId");
CREATE INDEX "SalesOrder_payloadHash_idx" ON "SalesOrder"("payloadHash");

ALTER TABLE "SalesOrder"
  ADD CONSTRAINT "SalesOrder_lastSyncRunId_fkey"
  FOREIGN KEY ("lastSyncRunId") REFERENCES "NomusSourceSyncRun"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

-- NomusAccountsReceivable (reutiliza payloadHash existente)
ALTER TABLE "NomusAccountsReceivable" ADD COLUMN "sourcePresenceStatus" "NomusSourcePresenceStatus" NOT NULL DEFAULT 'PRESENT';
ALTER TABLE "NomusAccountsReceivable" ADD COLUMN "presentInLastPayload" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "NomusAccountsReceivable" ADD COLUMN "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "NomusAccountsReceivable" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "NomusAccountsReceivable" ADD COLUMN "missingSince" TIMESTAMP(3);
ALTER TABLE "NomusAccountsReceivable" ADD COLUMN "missingConsecutiveRuns" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NomusAccountsReceivable" ADD COLUMN "sourceRemovedAt" TIMESTAMP(3);
ALTER TABLE "NomusAccountsReceivable" ADD COLUMN "lastSyncRunId" UUID;

UPDATE "NomusAccountsReceivable"
SET "firstSeenAt" = "createdAt",
    "lastSeenAt" = COALESCE("syncedAt", "updatedAt", "createdAt");

CREATE INDEX "NomusAccountsReceivable_sourcePresenceStatus_idx"
  ON "NomusAccountsReceivable"("sourcePresenceStatus");
CREATE INDEX "NomusAccountsReceivable_lastSeenAt_idx"
  ON "NomusAccountsReceivable"("lastSeenAt");
CREATE INDEX "NomusAccountsReceivable_lastSyncRunId_idx"
  ON "NomusAccountsReceivable"("lastSyncRunId");

ALTER TABLE "NomusAccountsReceivable"
  ADD CONSTRAINT "NomusAccountsReceivable_lastSyncRunId_fkey"
  FOREIGN KEY ("lastSyncRunId") REFERENCES "NomusSourceSyncRun"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

-- NomusAccountsPayable (reutiliza payloadHash existente)
ALTER TABLE "NomusAccountsPayable" ADD COLUMN "sourcePresenceStatus" "NomusSourcePresenceStatus" NOT NULL DEFAULT 'PRESENT';
ALTER TABLE "NomusAccountsPayable" ADD COLUMN "presentInLastPayload" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "NomusAccountsPayable" ADD COLUMN "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "NomusAccountsPayable" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "NomusAccountsPayable" ADD COLUMN "missingSince" TIMESTAMP(3);
ALTER TABLE "NomusAccountsPayable" ADD COLUMN "missingConsecutiveRuns" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NomusAccountsPayable" ADD COLUMN "sourceRemovedAt" TIMESTAMP(3);
ALTER TABLE "NomusAccountsPayable" ADD COLUMN "lastSyncRunId" UUID;

UPDATE "NomusAccountsPayable"
SET "firstSeenAt" = "createdAt",
    "lastSeenAt" = COALESCE("syncedAt", "updatedAt", "createdAt");

CREATE INDEX "NomusAccountsPayable_sourcePresenceStatus_idx"
  ON "NomusAccountsPayable"("sourcePresenceStatus");
CREATE INDEX "NomusAccountsPayable_lastSeenAt_idx"
  ON "NomusAccountsPayable"("lastSeenAt");
CREATE INDEX "NomusAccountsPayable_lastSyncRunId_idx"
  ON "NomusAccountsPayable"("lastSyncRunId");

ALTER TABLE "NomusAccountsPayable"
  ADD CONSTRAINT "NomusAccountsPayable_lastSyncRunId_fkey"
  FOREIGN KEY ("lastSyncRunId") REFERENCES "NomusSourceSyncRun"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
