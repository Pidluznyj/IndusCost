-- OP-10 — consistência temporal das contagens físicas.
-- Aditiva: nenhuma coluna existente muda de tipo/nullability, nenhum DROP,
-- nenhum backfill. Linhas legadas ficam com currentObservationId NULL e
-- continuam sendo resolvidas pela regra antiga.

ALTER TABLE "InventoryCountLine"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "currentObservationId" UUID;

CREATE TABLE "InventoryCountObservation" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "lineId"           UUID         NOT NULL,
  "operationId"      TEXT,
  "expectedQuantity" DECIMAL(20,6) NOT NULL,
  "countedQuantity"  DECIMAL(20,6) NOT NULL,
  "adjustmentDelta"  DECIMAL(20,6) NOT NULL,
  "justification"    TEXT,
  "actorType"        TEXT         NOT NULL DEFAULT 'USER',
  "userId"           TEXT,
  "deviceId"         TEXT,
  "observedAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "InventoryCountObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryCountObservation_operationId_key"
  ON "InventoryCountObservation"("operationId");

CREATE INDEX "InventoryCountObservation_lineId_observedAt_idx"
  ON "InventoryCountObservation"("lineId", "observedAt");

CREATE UNIQUE INDEX "InventoryCountLine_currentObservationId_key"
  ON "InventoryCountLine"("currentObservationId");

ALTER TABLE "InventoryCountObservation"
  ADD CONSTRAINT "InventoryCountObservation_lineId_fkey"
  FOREIGN KEY ("lineId") REFERENCES "InventoryCountLine"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "InventoryCountLine"
  ADD CONSTRAINT "InventoryCountLine_currentObservationId_fkey"
  FOREIGN KEY ("currentObservationId") REFERENCES "InventoryCountObservation"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
