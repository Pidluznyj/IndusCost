-- OP-06 — Base aditiva do ledger de Estoque / Almoxarifado.
-- Reaproveita Inventory* existente; apenas ADD coluna/tabela/enum/índice.
-- Não altera motores oficiais (Material só recebe back-relation no Prisma).

-- CreateEnum
CREATE TYPE "InventoryBlockStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "InventoryBlockReasonType" AS ENUM (
  'QUALITY',
  'QUARANTINE',
  'DAMAGE',
  'AUDIT',
  'MANUAL',
  'OTHER'
);

-- CreateEnum
CREATE TYPE "InventoryStockSnapshotSource" AS ENUM (
  'MANUAL',
  'RECALCULATION',
  'SYSTEM',
  'COUNT_SESSION'
);

-- AlterTable InventoryItem — vínculo à MP oficial
ALTER TABLE "InventoryItem" ADD COLUMN "materialId" UUID;

-- AlterTable InventoryWarehouse — auditoria usuário
ALTER TABLE "InventoryWarehouse" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "InventoryWarehouse" ADD COLUMN "updatedByUserId" TEXT;

-- AlterTable InventoryLocation — auditoria usuário
ALTER TABLE "InventoryLocation" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "InventoryLocation" ADD COLUMN "updatedByUserId" TEXT;

-- AlterTable InventoryBalance — rastreio do movimento que materializou o saldo
ALTER TABLE "InventoryBalance" ADD COLUMN "lastMovementId" UUID;

-- AlterTable InventoryMovement — rastreabilidade, snapshot MP, bloqueio, auditoria
ALTER TABLE "InventoryMovement" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "materialId" UUID;
ALTER TABLE "InventoryMovement" ADD COLUMN "materialCodeSnapshot" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "materialDescriptionSnapshot" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "lotNumber" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "serialNumber" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "expirationDate" TIMESTAMPTZ(6);
ALTER TABLE "InventoryMovement" ADD COLUMN "blockId" UUID;

-- CreateTable InventoryBlock
CREATE TABLE "InventoryBlock" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "itemId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "locationId" UUID,
  "quantity" DECIMAL(20,6) NOT NULL,
  "reasonType" "InventoryBlockReasonType" NOT NULL DEFAULT 'MANUAL',
  "status" "InventoryBlockStatus" NOT NULL DEFAULT 'ACTIVE',
  "reason" TEXT NOT NULL,
  "originType" "InventoryMovementOriginType" NOT NULL DEFAULT 'MANUAL',
  "originId" TEXT,
  "createdByUserId" TEXT,
  "releasedByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMPTZ(6),
  "notes" TEXT,

  CONSTRAINT "InventoryBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable InventoryStockSnapshot
CREATE TABLE "InventoryStockSnapshot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "asOfAt" TIMESTAMPTZ(6) NOT NULL,
  "source" "InventoryStockSnapshotSource" NOT NULL DEFAULT 'RECALCULATION',
  "reason" TEXT,
  "createdByUserId" TEXT,
  "createdByUserName" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventoryStockSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable InventoryStockSnapshotLine
CREATE TABLE "InventoryStockSnapshotLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "snapshotId" UUID NOT NULL,
  "itemId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "locationId" UUID,
  "balanceKey" TEXT NOT NULL,
  "physicalQuantity" DECIMAL(20,6) NOT NULL,
  "reservedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "blockedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "quarantineQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "availableQuantity" DECIMAL(20,6) NOT NULL,
  "unit" TEXT NOT NULL,
  "materialId" UUID,
  "materialCodeSnapshot" TEXT,
  "lastMovementId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventoryStockSnapshotLine_pkey" PRIMARY KEY ("id")
);

-- Indexes / uniques
CREATE INDEX "InventoryItem_materialId_idx" ON "InventoryItem"("materialId");

CREATE INDEX "InventoryBalance_lastMovementId_idx" ON "InventoryBalance"("lastMovementId");

CREATE UNIQUE INDEX "InventoryMovement_reversedMovementId_key" ON "InventoryMovement"("reversedMovementId");
CREATE INDEX "InventoryMovement_blockId_idx" ON "InventoryMovement"("blockId");
CREATE INDEX "InventoryMovement_materialId_idx" ON "InventoryMovement"("materialId");
CREATE INDEX "InventoryMovement_lotNumber_idx" ON "InventoryMovement"("lotNumber");
CREATE INDEX "InventoryMovement_createdByUserId_idx" ON "InventoryMovement"("createdByUserId");
CREATE INDEX "InventoryMovement_createdAt_idx" ON "InventoryMovement"("createdAt");

CREATE INDEX "InventoryReservation_createdByUserId_idx" ON "InventoryReservation"("createdByUserId");
CREATE INDEX "InventoryReservation_createdAt_idx" ON "InventoryReservation"("createdAt");

CREATE INDEX "InventoryBlock_itemId_idx" ON "InventoryBlock"("itemId");
CREATE INDEX "InventoryBlock_warehouseId_idx" ON "InventoryBlock"("warehouseId");
CREATE INDEX "InventoryBlock_status_idx" ON "InventoryBlock"("status");
CREATE INDEX "InventoryBlock_reasonType_idx" ON "InventoryBlock"("reasonType");
CREATE INDEX "InventoryBlock_createdByUserId_idx" ON "InventoryBlock"("createdByUserId");
CREATE INDEX "InventoryBlock_createdAt_idx" ON "InventoryBlock"("createdAt");

CREATE INDEX "InventoryStockSnapshot_asOfAt_idx" ON "InventoryStockSnapshot"("asOfAt");
CREATE INDEX "InventoryStockSnapshot_source_idx" ON "InventoryStockSnapshot"("source");
CREATE INDEX "InventoryStockSnapshot_createdByUserId_idx" ON "InventoryStockSnapshot"("createdByUserId");
CREATE INDEX "InventoryStockSnapshot_createdAt_idx" ON "InventoryStockSnapshot"("createdAt");

CREATE INDEX "InventoryStockSnapshotLine_snapshotId_idx" ON "InventoryStockSnapshotLine"("snapshotId");
CREATE INDEX "InventoryStockSnapshotLine_itemId_balanceKey_idx" ON "InventoryStockSnapshotLine"("itemId", "balanceKey");
CREATE INDEX "InventoryStockSnapshotLine_warehouseId_idx" ON "InventoryStockSnapshotLine"("warehouseId");
CREATE INDEX "InventoryStockSnapshotLine_lastMovementId_idx" ON "InventoryStockSnapshotLine"("lastMovementId");

-- ForeignKeys (aditivas; Restrict/SetNull — sem cascade destrutivo em Material)
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "InventoryBlock" ADD CONSTRAINT "InventoryBlock_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "InventoryBlock" ADD CONSTRAINT "InventoryBlock_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "InventoryWarehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "InventoryBlock" ADD CONSTRAINT "InventoryBlock_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_blockId_fkey"
  FOREIGN KEY ("blockId") REFERENCES "InventoryBlock"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "InventoryStockSnapshotLine" ADD CONSTRAINT "InventoryStockSnapshotLine_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "InventoryStockSnapshot"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "InventoryStockSnapshotLine" ADD CONSTRAINT "InventoryStockSnapshotLine_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "InventoryStockSnapshotLine" ADD CONSTRAINT "InventoryStockSnapshotLine_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "InventoryWarehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "InventoryStockSnapshotLine" ADD CONSTRAINT "InventoryStockSnapshotLine_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "InventoryStockSnapshotLine" ADD CONSTRAINT "InventoryStockSnapshotLine_lastMovementId_fkey"
  FOREIGN KEY ("lastMovementId") REFERENCES "InventoryMovement"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
