-- OP-08 — Vínculo logístico de matéria-prima oficial ao estoque (aditivo).
-- Não altera colunas oficiais de Material; apenas InventoryItem + FKs locais.

ALTER TABLE "InventoryItem" ADD COLUMN "controlsStock" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "InventoryItem" ADD COLUMN "allowsReservation" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "InventoryItem" ADD COLUMN "allowsBlock" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "InventoryItem" ADD COLUMN "safetyStock" DECIMAL(20,6);
ALTER TABLE "InventoryItem" ADD COLUMN "materialCodeSnapshot" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "materialDescriptionSnapshot" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "materialUnitSnapshot" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "materialCategorySnapshot" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "defaultWarehouseId" UUID;
ALTER TABLE "InventoryItem" ADD COLUMN "defaultLocationId" UUID;

CREATE INDEX "InventoryItem_defaultWarehouseId_idx" ON "InventoryItem"("defaultWarehouseId");
CREATE INDEX "InventoryItem_defaultLocationId_idx" ON "InventoryItem"("defaultLocationId");
CREATE INDEX "InventoryItem_controlsStock_idx" ON "InventoryItem"("controlsStock");

-- Uma MP oficial ativa por contexto logístico global (fase 1: uma unidade).
-- Inativos podem coexistir; reativação exige unicidade.
CREATE UNIQUE INDEX "InventoryItem_materialId_active_key"
  ON "InventoryItem"("materialId")
  WHERE "materialId" IS NOT NULL AND "status" = 'ACTIVE';

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_defaultWarehouseId_fkey"
  FOREIGN KEY ("defaultWarehouseId") REFERENCES "InventoryWarehouse"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_defaultLocationId_fkey"
  FOREIGN KEY ("defaultLocationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
