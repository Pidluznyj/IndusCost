-- CreateEnum
CREATE TYPE "PortfolioReconciliationRunMode" AS ENUM ('preview', 'apply', 'manual');

-- CreateEnum
CREATE TYPE "PortfolioReconciliationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "PortfolioReconciliationForecastSource" AS ENUM ('RECEIVABLE', 'NFE', 'ORDER', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "PortfolioReconciliationConfidenceLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'BLOCKED');

-- CreateTable
CREATE TABLE "PortfolioReconciliationRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "status" "PortfolioReconciliationRunStatus" NOT NULL DEFAULT 'PENDING',
    "mode" "PortfolioReconciliationRunMode" NOT NULL,
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3),
    "customerExternalId" INTEGER,
    "filtersJson" JSONB,
    "summaryJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioReconciliationFact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerExternalId" INTEGER,
    "customerNameSnapshot" TEXT,
    "salesOrderId" TEXT,
    "externalSalesOrderId" INTEGER,
    "orderCode" TEXT,
    "orderIssueDate" TIMESTAMP(3),
    "expectedDeliveryDate" TIMESTAMP(3),
    "salesOrderItemId" TEXT,
    "externalSalesOrderItemId" INTEGER,
    "externalProductId" INTEGER,
    "productSkuSnapshot" TEXT,
    "productNameSnapshot" TEXT,
    "orderQuantity" DECIMAL(20,6),
    "orderUnitPrice" DECIMAL(20,6),
    "orderItemValue" DECIMAL(20,6),
    "nomusNfeId" TEXT,
    "nfeExternalId" INTEGER,
    "nfeNumber" TEXT,
    "nfeSerie" TEXT,
    "nfeKey" TEXT,
    "nfeProcessedAt" TIMESTAMP(3),
    "nfeHeaderValue" DECIMAL(20,6),
    "stockDocumentId" TEXT,
    "stockDocumentExternalId" INTEGER,
    "stockDocumentItemId" TEXT,
    "stockDocumentItemExternalId" INTEGER,
    "stockDocumentDate" TIMESTAMP(3),
    "stockQuantity" DECIMAL(20,6),
    "stockUnitValue" DECIMAL(20,6),
    "stockItemValue" DECIMAL(20,6),
    "allocatedQuantity" DECIMAL(20,6),
    "allocatedValueByOrderPrice" DECIMAL(20,6),
    "allocatedValueByStockPrice" DECIMAL(20,6),
    "remainingOrderQuantityAfterAllocation" DECIMAL(20,6),
    "remainingOrderValueAfterAllocation" DECIMAL(20,6),
    "priceDifferenceUnit" DECIMAL(20,6),
    "priceDifferenceTotal" DECIMAL(20,6),
    "receivableIdsJson" JSONB,
    "receivableTotalValue" DECIMAL(20,6),
    "receivedValue" DECIMAL(20,6),
    "openReceivableValue" DECIMAL(20,6),
    "dueDatesJson" JSONB,
    "settlementDatesJson" JSONB,
    "forecastSource" "PortfolioReconciliationForecastSource" NOT NULL DEFAULT 'UNRESOLVED',
    "forecastDate" TIMESTAMP(3),
    "forecastValue" DECIMAL(20,6),
    "confidenceLevel" "PortfolioReconciliationConfidenceLevel" NOT NULL DEFAULT 'LOW',
    "status" TEXT,
    "alertsJson" JSONB,
    "traceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioReconciliationFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortfolioReconciliationRun_status_idx" ON "PortfolioReconciliationRun"("status");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationRun_mode_idx" ON "PortfolioReconciliationRun"("mode");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationRun_startedAt_idx" ON "PortfolioReconciliationRun"("startedAt");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationRun_fromDate_toDate_idx" ON "PortfolioReconciliationRun"("fromDate", "toDate");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationRun_customerExternalId_idx" ON "PortfolioReconciliationRun"("customerExternalId");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationRun_createdAt_idx" ON "PortfolioReconciliationRun"("createdAt");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationFact_runId_idx" ON "PortfolioReconciliationFact"("runId");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationFact_salesOrderId_idx" ON "PortfolioReconciliationFact"("salesOrderId");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationFact_salesOrderItemId_idx" ON "PortfolioReconciliationFact"("salesOrderItemId");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationFact_customerExternalId_idx" ON "PortfolioReconciliationFact"("customerExternalId");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationFact_externalSalesOrderId_idx" ON "PortfolioReconciliationFact"("externalSalesOrderId");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationFact_orderCode_idx" ON "PortfolioReconciliationFact"("orderCode");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationFact_nfeExternalId_idx" ON "PortfolioReconciliationFact"("nfeExternalId");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationFact_stockDocumentExternalId_idx" ON "PortfolioReconciliationFact"("stockDocumentExternalId");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationFact_externalProductId_idx" ON "PortfolioReconciliationFact"("externalProductId");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationFact_forecastDate_idx" ON "PortfolioReconciliationFact"("forecastDate");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationFact_status_idx" ON "PortfolioReconciliationFact"("status");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationFact_confidenceLevel_idx" ON "PortfolioReconciliationFact"("confidenceLevel");

-- CreateIndex
CREATE INDEX "PortfolioReconciliationFact_forecastSource_idx" ON "PortfolioReconciliationFact"("forecastSource");

-- AddForeignKey
ALTER TABLE "PortfolioReconciliationFact" ADD CONSTRAINT "PortfolioReconciliationFact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PortfolioReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
