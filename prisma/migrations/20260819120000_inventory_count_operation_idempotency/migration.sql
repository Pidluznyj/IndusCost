-- FASE 2B — idempotência transacional + CAS da contagem física.
-- Aditiva: nenhuma coluna existente muda, nenhum DROP, nenhum backfill,
-- nenhuma Observation histórica sintetizada. InventoryCountLine.version e
-- InventoryCountObservation permanecem exatamente como na Fase 2A.

CREATE TABLE "InventoryCountOperation" (
  "id"              UUID           NOT NULL DEFAULT gen_random_uuid(),
  "operationId"     TEXT           NOT NULL,
  "sessionId"       UUID           NOT NULL,
  "lineId"          UUID           NOT NULL,
  "requestHash"     TEXT           NOT NULL,
  "expectedVersion" INTEGER        NOT NULL,
  "resultVersion"   INTEGER,
  "observationId"   UUID,
  "resultSnapshot"  JSONB,
  "actorType"       TEXT           NOT NULL DEFAULT 'USER',
  "userId"          TEXT,
  "deviceId"        TEXT,
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "InventoryCountOperation_pkey" PRIMARY KEY ("id")
);

-- Autoridade da idempotência: a aquisição usa INSERT ... ON CONFLICT DO NOTHING
-- contra este índice.
CREATE UNIQUE INDEX "InventoryCountOperation_operationId_key"
  ON "InventoryCountOperation"("operationId");

CREATE INDEX "InventoryCountOperation_lineId_idx"
  ON "InventoryCountOperation"("lineId");

CREATE INDEX "InventoryCountOperation_sessionId_idx"
  ON "InventoryCountOperation"("sessionId");

ALTER TABLE "InventoryCountOperation"
  ADD CONSTRAINT "InventoryCountOperation_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "InventoryCountSession"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "InventoryCountOperation"
  ADD CONSTRAINT "InventoryCountOperation_lineId_fkey"
  FOREIGN KEY ("lineId") REFERENCES "InventoryCountLine"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "InventoryCountOperation"
  ADD CONSTRAINT "InventoryCountOperation_observationId_fkey"
  FOREIGN KEY ("observationId") REFERENCES "InventoryCountObservation"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
