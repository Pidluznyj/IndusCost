-- InventoryStockSector.defaultCostCenterId — centro de custo das saídas do setor
-- (retirada pelo Collector e ajuste negativo de contagem).
-- Aditiva: 1 coluna NULLABLE na tabela nova do próprio recurso + índice + FK.
-- Zero DROP / RENAME; nada muda em InventoryBalance, InventoryMovement,
-- InventoryItem, InventoryWarehouse, CostCenter, Product, Material ou Nomus*.
-- Sem backfill: setores existentes ficam com NULL.

ALTER TABLE "InventoryStockSector"
  ADD COLUMN "defaultCostCenterId" UUID;

CREATE INDEX "InventoryStockSector_defaultCostCenterId_idx"
  ON "InventoryStockSector"("defaultCostCenterId");

ALTER TABLE "InventoryStockSector"
  ADD CONSTRAINT "InventoryStockSector_defaultCostCenterId_fkey"
  FOREIGN KEY ("defaultCostCenterId") REFERENCES "CostCenter"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
