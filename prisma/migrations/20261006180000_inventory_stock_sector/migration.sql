-- Fundação InventoryStockSector (setores configuráveis de estoque).
-- Aditiva: CREATE TABLE / CREATE TYPE / CREATE INDEX only.
-- Zero DROP, RENAME, ALTER em InventoryBalance / InventoryMovement /
-- InventoryItem / InventoryWarehouse / Product / Material / Nomus*.
-- Sem backfill. Collector legado (MP/CP/PA) não depende desta tabela.

CREATE TYPE "InventoryStockSectorStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TYPE "InventoryStockSectorStrategy" AS ENUM ('STANDARD', 'RAW_MATERIAL', 'PRODUCT');

CREATE TABLE "InventoryStockSector" (
  "id"                UUID                         NOT NULL DEFAULT gen_random_uuid(),
  "code"              TEXT                         NOT NULL,
  "name"              TEXT                         NOT NULL,
  "slug"              TEXT                         NOT NULL,
  "status"            "InventoryStockSectorStatus" NOT NULL DEFAULT 'ACTIVE',
  "warehouseId"       UUID                         NOT NULL,
  "strategy"          "InventoryStockSectorStrategy" NOT NULL,
  "itemType"          "InventoryItemType",
  "sessionCodePrefix" TEXT                         NOT NULL,
  "allowsCounting"    BOOLEAN                      NOT NULL DEFAULT true,
  "allowsWithdrawal"  BOOLEAN                      NOT NULL DEFAULT false,
  "createdAt"         TIMESTAMPTZ(6)               NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ(6)               NOT NULL DEFAULT now(),
  "createdByUserId"   TEXT,
  "updatedByUserId"   TEXT,
  CONSTRAINT "InventoryStockSector_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryStockSector_code_key"
  ON "InventoryStockSector"("code");

CREATE UNIQUE INDEX "InventoryStockSector_slug_key"
  ON "InventoryStockSector"("slug");

CREATE UNIQUE INDEX "InventoryStockSector_sessionCodePrefix_key"
  ON "InventoryStockSector"("sessionCodePrefix");

CREATE INDEX "InventoryStockSector_slug_idx"
  ON "InventoryStockSector"("slug");

CREATE INDEX "InventoryStockSector_code_idx"
  ON "InventoryStockSector"("code");

CREATE INDEX "InventoryStockSector_status_idx"
  ON "InventoryStockSector"("status");

CREATE INDEX "InventoryStockSector_warehouseId_idx"
  ON "InventoryStockSector"("warehouseId");

CREATE INDEX "InventoryStockSector_strategy_status_idx"
  ON "InventoryStockSector"("strategy", "status");

CREATE INDEX "InventoryStockSector_itemType_warehouseId_idx"
  ON "InventoryStockSector"("itemType", "warehouseId");

-- Um setor STANDARD ACTIVE por (itemType, warehouse) — evita duplicata operacional.
CREATE UNIQUE INDEX "InventoryStockSector_active_standard_item_warehouse_key"
  ON "InventoryStockSector"("itemType", "warehouseId")
  WHERE "status" = 'ACTIVE'
    AND "strategy" = 'STANDARD'
    AND "itemType" IS NOT NULL;

ALTER TABLE "InventoryStockSector"
  ADD CONSTRAINT "InventoryStockSector_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "InventoryWarehouse"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
