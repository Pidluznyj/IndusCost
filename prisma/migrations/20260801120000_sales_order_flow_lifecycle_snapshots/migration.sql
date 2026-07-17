-- OP-52 — Estruturas derivadas do Fluxo de Pedidos (Kanban).
-- Aditiva only: NÃO altera colunas de SalesOrder / SalesOrderItem oficiais
-- (apenas back-relations no Prisma schema). Sem backfill nesta etapa.
-- Tabelas reconstruíveis a partir do motor OP-49…OP-51.

-- CreateTable
CREATE TABLE "SalesOrderItemFlowSnapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salesOrderId" UUID NOT NULL,
    "salesOrderItemId" UUID NOT NULL,
    "currentStage" TEXT NOT NULL,
    "stageReason" TEXT,
    "fulfillmentClassification" TEXT NOT NULL,
    "requiresProductionClassification" TEXT,
    "requiresProduction" BOOLEAN,
    "orderedQuantity" DECIMAL(20,6),
    "productionOrderQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "producedQuantity" DECIMAL(20,6),
    "documentedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "invoicedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "shippedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "activeRemainingQuantity" DECIMAL(20,6),
    "shipTargetQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "cutQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "canceledQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "progressProductionOrder" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "progressProduced" DECIMAL(10,2),
    "progressDocumented" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "progressInvoiced" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "progressShipped" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "progressJson" JSONB,
    "inconsistenciesJson" JSONB,
    "nextAction" TEXT,
    "responsibleArea" TEXT,
    "stageEnteredAt" TIMESTAMPTZ(6),
    "promisedDeliveryAt" TIMESTAMPTZ(6),
    "isOverdue" BOOLEAN NOT NULL DEFAULT false,
    "isActiveForKanban" BOOLEAN NOT NULL DEFAULT true,
    "fingerprint" TEXT NOT NULL,
    "computationVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderItemFlowSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderFlowSnapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salesOrderId" UUID NOT NULL,
    "currentStage" TEXT NOT NULL,
    "bottleneckStage" TEXT,
    "bottleneckSalesOrderItemId" UUID,
    "bottleneckReason" TEXT,
    "nextAction" TEXT,
    "responsibleArea" TEXT,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "activeItems" INTEGER NOT NULL DEFAULT 0,
    "completedItems" INTEGER NOT NULL DEFAULT 0,
    "pendingItems" INTEGER NOT NULL DEFAULT 0,
    "inconsistentItems" INTEGER NOT NULL DEFAULT 0,
    "canceledItems" INTEGER NOT NULL DEFAULT 0,
    "progressProductionOrder" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "progressProduced" DECIMAL(10,2),
    "progressDocumented" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "progressInvoiced" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "progressShipped" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "progressJson" JSONB,
    "orderValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "fulfilledValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "activeResidualValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "cutValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "canceledValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "firstShippedAt" TIMESTAMPTZ(6),
    "lastShippedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "promisedDeliveryAt" TIMESTAMPTZ(6),
    "isOverdue" BOOLEAN NOT NULL DEFAULT false,
    "isInActiveOperationalColumn" BOOLEAN NOT NULL DEFAULT true,
    "inconsistenciesJson" JSONB,
    "badgesJson" JSONB,
    "fingerprint" TEXT NOT NULL,
    "computationVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderFlowSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderFlowEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salesOrderId" UUID NOT NULL,
    "salesOrderItemId" UUID,
    "eventType" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "payloadJson" JSONB,
    "actorId" TEXT,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderFlowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderFlowManagement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salesOrderId" UUID NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "responsibleUserId" UUID,
    "responsibleName" TEXT,
    "responsibleArea" TEXT,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockReason" TEXT,
    "reason" TEXT,
    "expectedResolutionAt" TIMESTAMPTZ(6),
    "internalNote" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderFlowManagement_pkey" PRIMARY KEY ("id")
);

-- Unique
CREATE UNIQUE INDEX "SalesOrderItemFlowSnapshot_salesOrderItemId_key" ON "SalesOrderItemFlowSnapshot"("salesOrderItemId");
CREATE UNIQUE INDEX "SalesOrderFlowSnapshot_salesOrderId_key" ON "SalesOrderFlowSnapshot"("salesOrderId");
CREATE UNIQUE INDEX "SalesOrderFlowEvent_dedupeKey_key" ON "SalesOrderFlowEvent"("dedupeKey");
CREATE UNIQUE INDEX "SalesOrderFlowManagement_salesOrderId_key" ON "SalesOrderFlowManagement"("salesOrderId");

-- Indexes — SalesOrderItemFlowSnapshot (Kanban por item)
CREATE INDEX "SalesOrderItemFlowSnapshot_salesOrderId_idx" ON "SalesOrderItemFlowSnapshot"("salesOrderId");
CREATE INDEX "SalesOrderItemFlowSnapshot_currentStage_idx" ON "SalesOrderItemFlowSnapshot"("currentStage");
CREATE INDEX "SalesOrderItemFlowSnapshot_isActiveForKanban_idx" ON "SalesOrderItemFlowSnapshot"("isActiveForKanban");
CREATE INDEX "SalesOrderItemFlowSnapshot_isOverdue_idx" ON "SalesOrderItemFlowSnapshot"("isOverdue");
CREATE INDEX "SalesOrderItemFlowSnapshot_responsibleArea_idx" ON "SalesOrderItemFlowSnapshot"("responsibleArea");
CREATE INDEX "SalesOrderItemFlowSnapshot_promisedDeliveryAt_idx" ON "SalesOrderItemFlowSnapshot"("promisedDeliveryAt");
CREATE INDEX "SalesOrderItemFlowSnapshot_computedAt_idx" ON "SalesOrderItemFlowSnapshot"("computedAt");
CREATE INDEX "SalesOrderItemFlowSnapshot_fingerprint_idx" ON "SalesOrderItemFlowSnapshot"("fingerprint");
CREATE INDEX "SalesOrderItemFlowSnapshot_salesOrderId_currentStage_idx" ON "SalesOrderItemFlowSnapshot"("salesOrderId", "currentStage");
CREATE INDEX "SalesOrderItemFlowSnapshot_currentStage_isActiveForKanban_idx" ON "SalesOrderItemFlowSnapshot"("currentStage", "isActiveForKanban");

-- Indexes — SalesOrderFlowSnapshot (Kanban por pedido)
CREATE INDEX "SalesOrderFlowSnapshot_currentStage_idx" ON "SalesOrderFlowSnapshot"("currentStage");
CREATE INDEX "SalesOrderFlowSnapshot_isOverdue_idx" ON "SalesOrderFlowSnapshot"("isOverdue");
CREATE INDEX "SalesOrderFlowSnapshot_isInActiveOperationalColumn_idx" ON "SalesOrderFlowSnapshot"("isInActiveOperationalColumn");
CREATE INDEX "SalesOrderFlowSnapshot_responsibleArea_idx" ON "SalesOrderFlowSnapshot"("responsibleArea");
CREATE INDEX "SalesOrderFlowSnapshot_promisedDeliveryAt_idx" ON "SalesOrderFlowSnapshot"("promisedDeliveryAt");
CREATE INDEX "SalesOrderFlowSnapshot_completedAt_idx" ON "SalesOrderFlowSnapshot"("completedAt");
CREATE INDEX "SalesOrderFlowSnapshot_computedAt_idx" ON "SalesOrderFlowSnapshot"("computedAt");
CREATE INDEX "SalesOrderFlowSnapshot_fingerprint_idx" ON "SalesOrderFlowSnapshot"("fingerprint");
CREATE INDEX "SalesOrderFlowSnapshot_currentStage_isInActiveOperationalColumn_idx" ON "SalesOrderFlowSnapshot"("currentStage", "isInActiveOperationalColumn");
CREATE INDEX "SalesOrderFlowSnapshot_isOverdue_currentStage_idx" ON "SalesOrderFlowSnapshot"("isOverdue", "currentStage");

-- Indexes — SalesOrderFlowEvent (append-only)
CREATE INDEX "SalesOrderFlowEvent_salesOrderId_occurredAt_idx" ON "SalesOrderFlowEvent"("salesOrderId", "occurredAt" DESC);
CREATE INDEX "SalesOrderFlowEvent_salesOrderItemId_idx" ON "SalesOrderFlowEvent"("salesOrderItemId");
CREATE INDEX "SalesOrderFlowEvent_eventType_idx" ON "SalesOrderFlowEvent"("eventType");
CREATE INDEX "SalesOrderFlowEvent_toStage_idx" ON "SalesOrderFlowEvent"("toStage");
CREATE INDEX "SalesOrderFlowEvent_occurredAt_idx" ON "SalesOrderFlowEvent"("occurredAt");

-- Indexes — SalesOrderFlowManagement
CREATE INDEX "SalesOrderFlowManagement_priority_idx" ON "SalesOrderFlowManagement"("priority");
CREATE INDEX "SalesOrderFlowManagement_isBlocked_idx" ON "SalesOrderFlowManagement"("isBlocked");
CREATE INDEX "SalesOrderFlowManagement_responsibleArea_idx" ON "SalesOrderFlowManagement"("responsibleArea");
CREATE INDEX "SalesOrderFlowManagement_responsibleUserId_idx" ON "SalesOrderFlowManagement"("responsibleUserId");
CREATE INDEX "SalesOrderFlowManagement_expectedResolutionAt_idx" ON "SalesOrderFlowManagement"("expectedResolutionAt");

-- ForeignKeys
ALTER TABLE "SalesOrderItemFlowSnapshot" ADD CONSTRAINT "SalesOrderItemFlowSnapshot_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SalesOrderItemFlowSnapshot" ADD CONSTRAINT "SalesOrderItemFlowSnapshot_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "SalesOrderFlowSnapshot" ADD CONSTRAINT "SalesOrderFlowSnapshot_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "SalesOrderFlowEvent" ADD CONSTRAINT "SalesOrderFlowEvent_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SalesOrderFlowEvent" ADD CONSTRAINT "SalesOrderFlowEvent_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "SalesOrderFlowManagement" ADD CONSTRAINT "SalesOrderFlowManagement_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
