-- Nomus Production Orders (`/rest/ordens`) — stage oficial + vínculos Pedido/Item.
-- Aditivo e retrocompatível. Não altera tabelas de Pedido, NF-e, AR/AP, Fluxo, Comissões.

CREATE TABLE "NomusProductionOrder" (
    "id" TEXT NOT NULL,
    "externalId" INTEGER NOT NULL,
    "name" TEXT,
    "status" TEXT,
    "tipo" TEXT,
    "productCode" TEXT,
    "externalProductId" INTEGER,
    "quantity" DECIMAL(20,6),
    "unit" TEXT,
    "companyName" TEXT,
    "rawJson" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusProductionOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NomusProductionOrderSalesLink" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "productionOrderExternalId" INTEGER NOT NULL,
    "externalSalesOrderId" INTEGER NOT NULL,
    "externalSalesOrderItemId" INTEGER NOT NULL,
    "itemSequence" TEXT,
    "customerName" TEXT,
    "linkQuantity" DECIMAL(20,6),
    "rawJson" JSONB,
    "salesOrderId" UUID,
    "salesOrderItemId" UUID,
    "presentInLastPayload" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusProductionOrderSalesLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NomusProductionOrder_externalId_key" ON "NomusProductionOrder"("externalId");

CREATE INDEX "NomusProductionOrder_status_idx" ON "NomusProductionOrder"("status");
CREATE INDEX "NomusProductionOrder_tipo_idx" ON "NomusProductionOrder"("tipo");
CREATE INDEX "NomusProductionOrder_productCode_idx" ON "NomusProductionOrder"("productCode");
CREATE INDEX "NomusProductionOrder_externalProductId_idx" ON "NomusProductionOrder"("externalProductId");
CREATE INDEX "NomusProductionOrder_syncedAt_idx" ON "NomusProductionOrder"("syncedAt");
CREATE INDEX "NomusProductionOrder_name_idx" ON "NomusProductionOrder"("name");

CREATE UNIQUE INDEX "NomusProductionOrderSalesLink_productionOrderExternalId_externalSalesOrderItemId_key"
  ON "NomusProductionOrderSalesLink"("productionOrderExternalId", "externalSalesOrderItemId");

CREATE INDEX "NomusProductionOrderSalesLink_productionOrderId_idx" ON "NomusProductionOrderSalesLink"("productionOrderId");
CREATE INDEX "NomusProductionOrderSalesLink_externalSalesOrderId_idx" ON "NomusProductionOrderSalesLink"("externalSalesOrderId");
CREATE INDEX "NomusProductionOrderSalesLink_externalSalesOrderItemId_idx" ON "NomusProductionOrderSalesLink"("externalSalesOrderItemId");
CREATE INDEX "NomusProductionOrderSalesLink_salesOrderId_idx" ON "NomusProductionOrderSalesLink"("salesOrderId");
CREATE INDEX "NomusProductionOrderSalesLink_salesOrderItemId_idx" ON "NomusProductionOrderSalesLink"("salesOrderItemId");
CREATE INDEX "NomusProductionOrderSalesLink_presentInLastPayload_idx" ON "NomusProductionOrderSalesLink"("presentInLastPayload");

ALTER TABLE "NomusProductionOrderSalesLink"
  ADD CONSTRAINT "NomusProductionOrderSalesLink_productionOrderId_fkey"
  FOREIGN KEY ("productionOrderId") REFERENCES "NomusProductionOrder"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NomusProductionOrderSalesLink"
  ADD CONSTRAINT "NomusProductionOrderSalesLink_salesOrderId_fkey"
  FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "NomusProductionOrderSalesLink"
  ADD CONSTRAINT "NomusProductionOrderSalesLink_salesOrderItemId_fkey"
  FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
