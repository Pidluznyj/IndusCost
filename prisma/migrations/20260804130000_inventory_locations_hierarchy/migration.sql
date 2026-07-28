-- OP-07 — Locais internos do almoxarifado (aditivo).
-- Tipos, padrão, hierarquia e endereçamento (corredor/estante/posição).

CREATE TYPE "InventoryLocationType" AS ENUM ('PHYSICAL', 'QUARANTINE', 'PRODUCTION');

ALTER TABLE "InventoryLocation" ADD COLUMN "locationType" "InventoryLocationType" NOT NULL DEFAULT 'PHYSICAL';
ALTER TABLE "InventoryLocation" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InventoryLocation" ADD COLUMN "parentLocationId" UUID;
ALTER TABLE "InventoryLocation" ADD COLUMN "aisle" TEXT;
ALTER TABLE "InventoryLocation" ADD COLUMN "shelf" TEXT;
ALTER TABLE "InventoryLocation" ADD COLUMN "position" TEXT;
ALTER TABLE "InventoryLocation" ADD COLUMN "notes" TEXT;

CREATE INDEX "InventoryLocation_locationType_idx" ON "InventoryLocation"("locationType");
CREATE INDEX "InventoryLocation_parentLocationId_idx" ON "InventoryLocation"("parentLocationId");
CREATE INDEX "InventoryLocation_isDefault_idx" ON "InventoryLocation"("isDefault");

-- No máximo um local padrão ativo por almoxarifado.
CREATE UNIQUE INDEX "InventoryLocation_warehouse_default_active_key"
  ON "InventoryLocation"("warehouseId")
  WHERE "isDefault" = true AND "status" = 'ACTIVE';

ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_parentLocationId_fkey"
  FOREIGN KEY ("parentLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
