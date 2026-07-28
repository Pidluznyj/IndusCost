-- Espelho assíncrono IndusCost → planilha de matéria-prima (outbox PostgreSQL).
-- Unidirecional: planilha/Power Apps não escrevem no IndusCost.
-- Não aplicar em produção via Cursor.

CREATE TYPE "MaterialStockSpreadsheetMirrorStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SYNCED',
  'ERROR'
);

CREATE TYPE "MaterialStockSpreadsheetMirrorEventType" AS ENUM (
  'CONFERENCE',
  'LEVELS_UPDATE',
  'MATERIAL_MASTER'
);

CREATE TABLE "MaterialStockSpreadsheetOutbox" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "materialId" UUID NOT NULL,
  "materialCode" TEXT NOT NULL,
  "eventType" "MaterialStockSpreadsheetMirrorEventType" NOT NULL,
  "status" "MaterialStockSpreadsheetMirrorStatus" NOT NULL DEFAULT 'PENDING',
  "deduplicationKey" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMPTZ(6),
  "lockedAt" TIMESTAMPTZ(6),
  "lockedBy" TEXT,
  "lockToken" TEXT,
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "syncedAt" TIMESTAMPTZ(6),
  "requestId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MaterialStockSpreadsheetOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaterialStockSpreadsheetOutbox_idempotencyKey_key"
  ON "MaterialStockSpreadsheetOutbox" ("idempotencyKey");

-- No máximo um evento ativo (PENDING/PROCESSING) por material.
CREATE UNIQUE INDEX "MaterialStockSpreadsheetOutbox_active_dedupe_uidx"
  ON "MaterialStockSpreadsheetOutbox" ("deduplicationKey")
  WHERE "status" IN ('PENDING', 'PROCESSING');

CREATE INDEX "MaterialStockSpreadsheetOutbox_status_availableAt_idx"
  ON "MaterialStockSpreadsheetOutbox" ("status", "availableAt");

CREATE INDEX "MaterialStockSpreadsheetOutbox_materialId_status_idx"
  ON "MaterialStockSpreadsheetOutbox" ("materialId", "status");

CREATE INDEX "MaterialStockSpreadsheetOutbox_materialCode_idx"
  ON "MaterialStockSpreadsheetOutbox" ("materialCode");

CREATE INDEX "MaterialStockSpreadsheetOutbox_deduplicationKey_idx"
  ON "MaterialStockSpreadsheetOutbox" ("deduplicationKey");

CREATE INDEX "MaterialStockSpreadsheetOutbox_syncedAt_idx"
  ON "MaterialStockSpreadsheetOutbox" ("syncedAt");

ALTER TABLE "MaterialStockSpreadsheetOutbox"
  ADD CONSTRAINT "MaterialStockSpreadsheetOutbox_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
