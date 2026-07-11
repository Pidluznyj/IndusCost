-- OrderToCashAudit: camada materializada de auditoria Pedido → Caixa.
-- Tabelas novas apenas — não altera SalesOrder, NF, CR, Fluxo de Caixa, Comissões nem demais fontes oficiais.

-- CreateTable
CREATE TABLE "OrderToCashAuditRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "mode" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "year" INTEGER,
    "dateAxis" TEXT,
    "customerFilter" TEXT,
    "sellerFilter" TEXT,
    "orderFilter" TEXT,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "totalOrderItems" INTEGER NOT NULL DEFAULT 0,
    "totalFacts" INTEGER NOT NULL DEFAULT 0,
    "totalOrderValue" DECIMAL(20,6),
    "totalAllocatedValue" DECIMAL(20,6),
    "totalReceivableValue" DECIMAL(20,6),
    "totalReceivedValue" DECIMAL(20,6),
    "totalOpenValue" DECIMAL(20,6),
    "totalBlockedValue" DECIMAL(20,6),
    "warningsJson" JSONB,
    "errorMessage" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderToCashAuditRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderToCashAuditFact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "auditKey" TEXT NOT NULL,
    "lineType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    "salesOrderId" TEXT,
    "externalSalesOrderId" INTEGER,
    "orderCode" TEXT,
    "orderStatus" TEXT,
    "orderIssueDate" TIMESTAMP(3),
    "orderExpectedDeliveryDate" TIMESTAMP(3),
    "orderTotalValue" DECIMAL(20,6),
    "orderNetValue" DECIMAL(20,6),
    "orderGrossValue" DECIMAL(20,6),
    "companyId" TEXT,
    "companyName" TEXT,

    "customerId" TEXT,
    "externalCustomerId" INTEGER,
    "customerName" TEXT,
    "customerDocument" TEXT,
    "customerGroup" TEXT,
    "customerCity" TEXT,
    "customerState" TEXT,

    "sellerId" TEXT,
    "externalSellerId" TEXT,
    "sellerName" TEXT,
    "sellerSource" TEXT,
    "sellerQualityStatus" TEXT,

    "paymentConditionId" TEXT,
    "paymentConditionName" TEXT,
    "paymentConditionSource" TEXT,
    "paymentTermsJson" JSONB,
    "plannedInstallmentsCount" INTEGER,
    "plannedFirstDueDate" TIMESTAMP(3),
    "plannedLastDueDate" TIMESTAMP(3),
    "plannedPaymentDatesJson" JSONB,
    "plannedReceivableValue" DECIMAL(20,6),
    "plannedPaymentStatus" TEXT,

    "salesOrderItemId" TEXT,
    "externalSalesOrderItemId" INTEGER,
    "orderItemSequence" INTEGER,
    "externalProductId" INTEGER,
    "productId" TEXT,
    "productCode" TEXT,
    "sku" TEXT,
    "productName" TEXT,
    "productDescription" TEXT,
    "orderedQuantity" DECIMAL(20,6),
    "orderUnitPrice" DECIMAL(20,6),
    "orderItemTotalValue" DECIMAL(20,6),
    "orderItemExpectedDeliveryDate" TIMESTAMP(3),
    "orderItemStatus" TEXT,

    "stockDocumentId" TEXT,
    "stockDocumentExternalId" INTEGER,
    "stockDocumentType" TEXT,
    "stockDocumentDate" TIMESTAMP(3),
    "stockDocumentTotalValue" DECIMAL(20,6),
    "stockDocumentPersonId" TEXT,
    "stockDocumentPersonName" TEXT,
    "stockDocumentIdNfe" INTEGER,

    "stockDocumentItemId" TEXT,
    "stockDocumentItemExternalProductId" INTEGER,
    "stockDocumentItemProductCode" TEXT,
    "stockDocumentItemProductName" TEXT,
    "stockDocumentItemQuantity" DECIMAL(20,6),
    "stockDocumentItemUnitValue" DECIMAL(20,6),
    "stockDocumentItemTotalValue" DECIMAL(20,6),
    "matchedByProduct" BOOLEAN NOT NULL DEFAULT false,
    "quantityUsedForOrder" DECIMAL(20,6),
    "quantityRemainingBeforeAllocation" DECIMAL(20,6),
    "quantityRemainingAfterAllocation" DECIMAL(20,6),
    "excessQuantity" DECIMAL(20,6),
    "outsideOrderQuantity" DECIMAL(20,6),
    "allocatedValueByOrderPrice" DECIMAL(20,6),
    "allocatedValueByDocumentPrice" DECIMAL(20,6),
    "priceDifferenceValue" DECIMAL(20,6),
    "priceDifferencePercent" DECIMAL(10,6),

    "nfeId" TEXT,
    "nfeExternalId" INTEGER,
    "nfeNumber" TEXT,
    "nfeSerie" TEXT,
    "nfeKey" TEXT,
    "nfeStatus" TEXT,
    "nfeOperationType" TEXT,
    "nfeProcessedAt" TIMESTAMP(3),
    "nfeIssueDate" TIMESTAMP(3),
    "nfeHeaderValue" DECIMAL(20,6),
    "nfeLinkedBy" TEXT,
    "nfeItemsAvailable" BOOLEAN NOT NULL DEFAULT false,
    "nfeItemsSource" TEXT,
    "nfeItemProductCode" TEXT,
    "nfeItemProductName" TEXT,
    "nfeItemQuantity" DECIMAL(20,6),
    "nfeItemUnitValue" DECIMAL(20,6),
    "nfeItemTotalValue" DECIMAL(20,6),
    "nfeItemMatchedOrderItem" BOOLEAN NOT NULL DEFAULT false,

    "receivableIdsJson" JSONB,
    "receivableCount" INTEGER,
    "receivableTotalValue" DECIMAL(20,6),
    "receivableOpenValue" DECIMAL(20,6),
    "receivableReceivedValue" DECIMAL(20,6),
    "receivableDueDatesJson" JSONB,
    "receivableSettlementDatesJson" JSONB,
    "receivableStatus" TEXT,
    "receivableSource" TEXT,

    "paymentScheduledDate" TIMESTAMP(3),
    "paymentDueDate" TIMESTAMP(3),
    "paymentSettlementDate" TIMESTAMP(3),
    "paymentReceivedAt" TIMESTAMP(3),
    "paymentExpectedValue" DECIMAL(20,6),
    "paymentReceivedValue" DECIMAL(20,6),
    "paymentOpenValue" DECIMAL(20,6),
    "paymentDelayDays" INTEGER,
    "paymentStatus" TEXT,

    "commercialStage" TEXT,
    "operationalStage" TEXT,
    "fiscalStage" TEXT,
    "financialStage" TEXT,
    "cashStage" TEXT,
    "orderToCashStage" TEXT,
    "temperature" TEXT,
    "confidenceScore" DECIMAL(10,4),
    "confidenceLabel" TEXT,
    "responsibleArea" TEXT,
    "recommendedAction" TEXT,

    "hasDeliveryDelay" BOOLEAN NOT NULL DEFAULT false,
    "hasMissingStockDocument" BOOLEAN NOT NULL DEFAULT false,
    "hasPartialFulfillment" BOOLEAN NOT NULL DEFAULT false,
    "hasFullFulfillment" BOOLEAN NOT NULL DEFAULT false,
    "hasExcessQuantity" BOOLEAN NOT NULL DEFAULT false,
    "hasProductOutsideOrder" BOOLEAN NOT NULL DEFAULT false,
    "hasNfeHeaderGreaterThanOrder" BOOLEAN NOT NULL DEFAULT false,
    "hasPriceMismatch" BOOLEAN NOT NULL DEFAULT false,
    "hasDocumentWithoutReceivable" BOOLEAN NOT NULL DEFAULT false,
    "hasReceivableWithoutSafeLink" BOOLEAN NOT NULL DEFAULT false,
    "hasPaymentConditionMissing" BOOLEAN NOT NULL DEFAULT false,
    "hasPaymentDateDivergence" BOOLEAN NOT NULL DEFAULT false,
    "hasOverdueReceivable" BOOLEAN NOT NULL DEFAULT false,
    "hasRecentPaymentNotReflected" BOOLEAN NOT NULL DEFAULT false,
    "alertsJson" JSONB,
    "blockingReasonsJson" JSONB,

    "lastOrderUpdateAt" TIMESTAMP(3),
    "lastDocumentDate" TIMESTAMP(3),
    "lastNfeDate" TIMESTAMP(3),
    "lastReceivableDueDate" TIMESTAMP(3),
    "lastReceivableSettlementDate" TIMESTAMP(3),
    "lastEvidenceDate" TIMESTAMP(3),
    "daysFromOrderToDocument" INTEGER,
    "daysFromDocumentToNfe" INTEGER,
    "daysFromNfeToReceivable" INTEGER,
    "daysFromReceivableToSettlement" INTEGER,
    "daysDeliveryDelay" INTEGER,
    "daysPaymentDelay" INTEGER,

    CONSTRAINT "OrderToCashAuditFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex OrderToCashAuditRun
CREATE INDEX "OrderToCashAuditRun_status_idx" ON "OrderToCashAuditRun"("status");
CREATE INDEX "OrderToCashAuditRun_mode_idx" ON "OrderToCashAuditRun"("mode");
CREATE INDEX "OrderToCashAuditRun_year_idx" ON "OrderToCashAuditRun"("year");
CREATE INDEX "OrderToCashAuditRun_startedAt_idx" ON "OrderToCashAuditRun"("startedAt");
CREATE INDEX "OrderToCashAuditRun_periodFrom_periodTo_idx" ON "OrderToCashAuditRun"("periodFrom", "periodTo");
CREATE INDEX "OrderToCashAuditRun_createdAt_idx" ON "OrderToCashAuditRun"("createdAt");

-- CreateIndex OrderToCashAuditFact
CREATE UNIQUE INDEX "OrderToCashAuditFact_runId_auditKey_key" ON "OrderToCashAuditFact"("runId", "auditKey");
CREATE INDEX "OrderToCashAuditFact_runId_idx" ON "OrderToCashAuditFact"("runId");
CREATE INDEX "OrderToCashAuditFact_salesOrderId_idx" ON "OrderToCashAuditFact"("salesOrderId");
CREATE INDEX "OrderToCashAuditFact_orderCode_idx" ON "OrderToCashAuditFact"("orderCode");
CREATE INDEX "OrderToCashAuditFact_externalSalesOrderId_idx" ON "OrderToCashAuditFact"("externalSalesOrderId");
CREATE INDEX "OrderToCashAuditFact_externalCustomerId_idx" ON "OrderToCashAuditFact"("externalCustomerId");
CREATE INDEX "OrderToCashAuditFact_customerName_idx" ON "OrderToCashAuditFact"("customerName");
CREATE INDEX "OrderToCashAuditFact_externalSellerId_idx" ON "OrderToCashAuditFact"("externalSellerId");
CREATE INDEX "OrderToCashAuditFact_sellerName_idx" ON "OrderToCashAuditFact"("sellerName");
CREATE INDEX "OrderToCashAuditFact_externalProductId_idx" ON "OrderToCashAuditFact"("externalProductId");
CREATE INDEX "OrderToCashAuditFact_productCode_idx" ON "OrderToCashAuditFact"("productCode");
CREATE INDEX "OrderToCashAuditFact_sku_idx" ON "OrderToCashAuditFact"("sku");
CREATE INDEX "OrderToCashAuditFact_nfeExternalId_idx" ON "OrderToCashAuditFact"("nfeExternalId");
CREATE INDEX "OrderToCashAuditFact_nfeNumber_idx" ON "OrderToCashAuditFact"("nfeNumber");
CREATE INDEX "OrderToCashAuditFact_stockDocumentId_idx" ON "OrderToCashAuditFact"("stockDocumentId");
CREATE INDEX "OrderToCashAuditFact_receivableStatus_idx" ON "OrderToCashAuditFact"("receivableStatus");
CREATE INDEX "OrderToCashAuditFact_paymentStatus_idx" ON "OrderToCashAuditFact"("paymentStatus");
CREATE INDEX "OrderToCashAuditFact_orderToCashStage_idx" ON "OrderToCashAuditFact"("orderToCashStage");
CREATE INDEX "OrderToCashAuditFact_operationalStage_idx" ON "OrderToCashAuditFact"("operationalStage");
CREATE INDEX "OrderToCashAuditFact_financialStage_idx" ON "OrderToCashAuditFact"("financialStage");
CREATE INDEX "OrderToCashAuditFact_temperature_idx" ON "OrderToCashAuditFact"("temperature");
CREATE INDEX "OrderToCashAuditFact_confidenceLabel_idx" ON "OrderToCashAuditFact"("confidenceLabel");
CREATE INDEX "OrderToCashAuditFact_orderIssueDate_idx" ON "OrderToCashAuditFact"("orderIssueDate");
CREATE INDEX "OrderToCashAuditFact_orderExpectedDeliveryDate_idx" ON "OrderToCashAuditFact"("orderExpectedDeliveryDate");
CREATE INDEX "OrderToCashAuditFact_stockDocumentDate_idx" ON "OrderToCashAuditFact"("stockDocumentDate");
CREATE INDEX "OrderToCashAuditFact_nfeIssueDate_idx" ON "OrderToCashAuditFact"("nfeIssueDate");
CREATE INDEX "OrderToCashAuditFact_paymentDueDate_idx" ON "OrderToCashAuditFact"("paymentDueDate");
CREATE INDEX "OrderToCashAuditFact_paymentSettlementDate_idx" ON "OrderToCashAuditFact"("paymentSettlementDate");
CREATE INDEX "OrderToCashAuditFact_lineType_idx" ON "OrderToCashAuditFact"("lineType");
CREATE INDEX "OrderToCashAuditFact_auditKey_idx" ON "OrderToCashAuditFact"("auditKey");

-- AddForeignKey
ALTER TABLE "OrderToCashAuditFact" ADD CONSTRAINT "OrderToCashAuditFact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "OrderToCashAuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
