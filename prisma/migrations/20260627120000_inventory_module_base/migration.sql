-- Estoque / Almoxarifado — MVP Fase 1 (módulo independente)

CREATE TYPE "InventoryItemType" AS ENUM (
  'FINISHED_PRODUCT',
  'SEMI_FINISHED',
  'COMPONENT',
  'RAW_MATERIAL',
  'PACKAGING',
  'PRODUCTION_SUPPLY',
  'ADMINISTRATIVE_SUPPLY',
  'MAINTENANCE',
  'PPE',
  'TOOLING',
  'OTHER'
);

CREATE TYPE "InventoryItemStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TYPE "InventoryWarehouseStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TYPE "InventoryLocationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TYPE "InventoryMovementType" AS ENUM (
  'MANUAL_ENTRY',
  'PURCHASE_ENTRY',
  'PRODUCTION_ENTRY',
  'MANUAL_EXIT',
  'REQUISITION_EXIT',
  'PRODUCTION_EXIT',
  'TRANSFER',
  'POSITIVE_ADJUSTMENT',
  'NEGATIVE_ADJUSTMENT',
  'BLOCK',
  'UNBLOCK',
  'RESERVE',
  'CANCEL_RESERVATION',
  'LOSS',
  'SCRAP',
  'RETURN',
  'REVERSAL'
);

CREATE TYPE "InventoryMovementOriginType" AS ENUM (
  'MANUAL',
  'PURCHASE',
  'SALES_ORDER',
  'PRODUCTION_ORDER',
  'COUNT_SESSION',
  'REVERSAL',
  'INTEGRATION',
  'OTHER'
);

CREATE TYPE "InventoryReservationType" AS ENUM (
  'SALES_ORDER',
  'PRODUCTION_ORDER',
  'INTERNAL_REQUISITION',
  'MAINTENANCE',
  'QUALITY',
  'MANUAL'
);

CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'CANCELED', 'CONSUMED');

CREATE TYPE "InventoryCountSessionStatus" AS ENUM (
  'OPEN',
  'COUNTING',
  'WAITING_APPROVAL',
  'APPROVED',
  'ADJUSTED',
  'CANCELED'
);

CREATE TABLE "InventoryItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "itemType" "InventoryItemType" NOT NULL,
  "unit" TEXT NOT NULL,
  "family" TEXT,
  "group" TEXT,
  "status" "InventoryItemStatus" NOT NULL DEFAULT 'ACTIVE',
  "controlsLot" BOOLEAN NOT NULL DEFAULT false,
  "controlsExpiration" BOOLEAN NOT NULL DEFAULT false,
  "controlsLocation" BOOLEAN NOT NULL DEFAULT false,
  "controlsQuality" BOOLEAN NOT NULL DEFAULT false,
  "minimumStock" DECIMAL(20,6),
  "maximumStock" DECIMAL(20,6),
  "reorderPoint" DECIMAL(20,6),
  "preferredSupplierName" TEXT,
  "averageCost" DECIMAL(20,6),
  "lastKnownCost" DECIMAL(20,6),
  "productId" UUID,
  "nomusProductCode" TEXT,
  "nomusProductId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryWarehouse" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "InventoryWarehouseStatus" NOT NULL DEFAULT 'ACTIVE',
  "allowsMovements" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryWarehouse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryLocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "warehouseId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "InventoryLocationStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryMovement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "itemId" UUID NOT NULL,
  "sourceWarehouseId" UUID,
  "destinationWarehouseId" UUID,
  "sourceLocationId" UUID,
  "destinationLocationId" UUID,
  "movementType" "InventoryMovementType" NOT NULL,
  "quantity" DECIMAL(20,6) NOT NULL,
  "unit" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "responsibleUserId" TEXT,
  "movementDate" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "originType" "InventoryMovementOriginType" NOT NULL DEFAULT 'MANUAL',
  "originId" TEXT,
  "documentNumber" TEXT,
  "costCenterId" UUID,
  "financialCostCenterId" UUID,
  "purchaseOrderId" UUID,
  "purchaseOrderCode" TEXT,
  "salesOrderId" UUID,
  "salesOrderCode" TEXT,
  "productionOrderId" UUID,
  "productionOrderCode" TEXT,
  "bomId" UUID,
  "productId" UUID,
  "nfeId" TEXT,
  "nfeNumber" TEXT,
  "previousPhysicalBalance" DECIMAL(20,6) NOT NULL,
  "nextPhysicalBalance" DECIMAL(20,6) NOT NULL,
  "previousReservedBalance" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "nextReservedBalance" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "previousBlockedBalance" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "nextBlockedBalance" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "previousQuarantineBalance" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "nextQuarantineBalance" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "previousAvailableBalance" DECIMAL(20,6) NOT NULL,
  "nextAvailableBalance" DECIMAL(20,6) NOT NULL,
  "reversedMovementId" UUID,
  "reservationId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryBalance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "itemId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "locationId" UUID,
  "balanceKey" TEXT NOT NULL,
  "physicalQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "reservedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "blockedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "quarantineQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "availableQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "averageCost" DECIMAL(20,6),
  "totalValue" DECIMAL(20,2),
  "lastMovementAt" TIMESTAMPTZ(6),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryReservation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "itemId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "locationId" UUID,
  "quantity" DECIMAL(20,6) NOT NULL,
  "reservationType" "InventoryReservationType" NOT NULL,
  "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "reason" TEXT NOT NULL,
  "originType" "InventoryMovementOriginType" NOT NULL DEFAULT 'MANUAL',
  "originId" TEXT,
  "createdByUserId" TEXT,
  "canceledByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "canceledAt" TIMESTAMPTZ(6),
  "notes" TEXT,
  CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryCountSession" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "warehouseId" UUID NOT NULL,
  "status" "InventoryCountSessionStatus" NOT NULL DEFAULT 'OPEN',
  "responsibleUserId" TEXT,
  "approvedByUserId" TEXT,
  "startedAt" TIMESTAMPTZ(6),
  "finishedAt" TIMESTAMPTZ(6),
  "approvedAt" TIMESTAMPTZ(6),
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryCountSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryCountLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL,
  "itemId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "locationId" UUID,
  "systemQuantity" DECIMAL(20,6) NOT NULL,
  "countedQuantity" DECIMAL(20,6),
  "differenceQuantity" DECIMAL(20,6),
  "differencePercent" DECIMAL(10,4),
  "justification" TEXT,
  "generatedMovementId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryCountLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryAuditLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "userId" TEXT,
  "userName" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryItem_code_key" ON "InventoryItem"("code");
CREATE INDEX "InventoryItem_itemType_idx" ON "InventoryItem"("itemType");
CREATE INDEX "InventoryItem_status_idx" ON "InventoryItem"("status");
CREATE INDEX "InventoryItem_productId_idx" ON "InventoryItem"("productId");
CREATE INDEX "InventoryItem_nomusProductCode_idx" ON "InventoryItem"("nomusProductCode");

CREATE UNIQUE INDEX "InventoryWarehouse_code_key" ON "InventoryWarehouse"("code");
CREATE INDEX "InventoryWarehouse_status_idx" ON "InventoryWarehouse"("status");

CREATE UNIQUE INDEX "InventoryLocation_warehouseId_code_key" ON "InventoryLocation"("warehouseId", "code");
CREATE INDEX "InventoryLocation_warehouseId_idx" ON "InventoryLocation"("warehouseId");
CREATE INDEX "InventoryLocation_status_idx" ON "InventoryLocation"("status");

CREATE INDEX "InventoryMovement_itemId_idx" ON "InventoryMovement"("itemId");
CREATE INDEX "InventoryMovement_movementType_idx" ON "InventoryMovement"("movementType");
CREATE INDEX "InventoryMovement_movementDate_idx" ON "InventoryMovement"("movementDate");
CREATE INDEX "InventoryMovement_sourceWarehouseId_idx" ON "InventoryMovement"("sourceWarehouseId");
CREATE INDEX "InventoryMovement_destinationWarehouseId_idx" ON "InventoryMovement"("destinationWarehouseId");
CREATE INDEX "InventoryMovement_costCenterId_idx" ON "InventoryMovement"("costCenterId");
CREATE INDEX "InventoryMovement_originType_originId_idx" ON "InventoryMovement"("originType", "originId");
CREATE INDEX "InventoryMovement_salesOrderId_idx" ON "InventoryMovement"("salesOrderId");
CREATE INDEX "InventoryMovement_purchaseOrderId_idx" ON "InventoryMovement"("purchaseOrderId");
CREATE INDEX "InventoryMovement_reservationId_idx" ON "InventoryMovement"("reservationId");

CREATE UNIQUE INDEX "InventoryBalance_itemId_balanceKey_key" ON "InventoryBalance"("itemId", "balanceKey");
CREATE INDEX "InventoryBalance_warehouseId_idx" ON "InventoryBalance"("warehouseId");
CREATE INDEX "InventoryBalance_locationId_idx" ON "InventoryBalance"("locationId");
CREATE INDEX "InventoryBalance_availableQuantity_idx" ON "InventoryBalance"("availableQuantity");

CREATE INDEX "InventoryReservation_itemId_idx" ON "InventoryReservation"("itemId");
CREATE INDEX "InventoryReservation_warehouseId_idx" ON "InventoryReservation"("warehouseId");
CREATE INDEX "InventoryReservation_status_idx" ON "InventoryReservation"("status");
CREATE INDEX "InventoryReservation_reservationType_idx" ON "InventoryReservation"("reservationType");

CREATE UNIQUE INDEX "InventoryCountSession_code_key" ON "InventoryCountSession"("code");
CREATE INDEX "InventoryCountSession_warehouseId_idx" ON "InventoryCountSession"("warehouseId");
CREATE INDEX "InventoryCountSession_status_idx" ON "InventoryCountSession"("status");

CREATE UNIQUE INDEX "InventoryCountLine_generatedMovementId_key" ON "InventoryCountLine"("generatedMovementId");
CREATE INDEX "InventoryCountLine_sessionId_idx" ON "InventoryCountLine"("sessionId");
CREATE INDEX "InventoryCountLine_itemId_idx" ON "InventoryCountLine"("itemId");
CREATE INDEX "InventoryCountLine_warehouseId_idx" ON "InventoryCountLine"("warehouseId");

CREATE INDEX "InventoryAuditLog_entityType_entityId_idx" ON "InventoryAuditLog"("entityType", "entityId");
CREATE INDEX "InventoryAuditLog_userId_idx" ON "InventoryAuditLog"("userId");
CREATE INDEX "InventoryAuditLog_createdAt_idx" ON "InventoryAuditLog"("createdAt");
CREATE INDEX "InventoryAuditLog_action_idx" ON "InventoryAuditLog"("action");

ALTER TABLE "InventoryItem"
  ADD CONSTRAINT "InventoryItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "InventoryLocation"
  ADD CONSTRAINT "InventoryLocation_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "InventoryWarehouse"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryMovement_sourceWarehouseId_fkey"
  FOREIGN KEY ("sourceWarehouseId") REFERENCES "InventoryWarehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryMovement_destinationWarehouseId_fkey"
  FOREIGN KEY ("destinationWarehouseId") REFERENCES "InventoryWarehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryMovement_sourceLocationId_fkey"
  FOREIGN KEY ("sourceLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryMovement_destinationLocationId_fkey"
  FOREIGN KEY ("destinationLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryMovement_costCenterId_fkey"
  FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryMovement_reversedMovementId_fkey"
  FOREIGN KEY ("reversedMovementId") REFERENCES "InventoryMovement"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryMovement_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "InventoryBalance"
  ADD CONSTRAINT "InventoryBalance_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryBalance_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "InventoryWarehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryBalance_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "InventoryReservation"
  ADD CONSTRAINT "InventoryReservation_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryReservation_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "InventoryWarehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryReservation_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "InventoryCountSession"
  ADD CONSTRAINT "InventoryCountSession_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "InventoryWarehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "InventoryCountLine"
  ADD CONSTRAINT "InventoryCountLine_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "InventoryCountSession"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryCountLine_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryCountLine_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "InventoryWarehouse"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryCountLine_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "InventoryCountLine_generatedMovementId_fkey"
  FOREIGN KEY ("generatedMovementId") REFERENCES "InventoryMovement"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
