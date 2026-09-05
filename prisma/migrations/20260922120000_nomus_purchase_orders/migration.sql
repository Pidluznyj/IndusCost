-- CreateTable
CREATE TABLE "NomusPurchaseOrder" (
    "id" TEXT NOT NULL,
    "externalId" INTEGER NOT NULL,
    "orderNumber" TEXT,
    "supplierExternalId" INTEGER,
    "supplierName" TEXT,
    "supplierTaxId" TEXT,
    "statusRaw" TEXT,
    "canceled" BOOLEAN,
    "stage" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "expectedAt" TIMESTAMP(3),
    "createdAtNomus" TIMESTAMP(3),
    "modifiedAtNomus" TIMESTAMP(3),
    "paymentTerms" TEXT,
    "comments" TEXT,
    "currency" TEXT,
    "totalAmount" DECIMAL(20,2),
    "discountAmount" DECIMAL(20,2),
    "freightAmount" DECIMAL(20,2),
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "orderedQuantity" DECIMAL(20,6),
    "receivedQuantity" DECIMAL(20,6),
    "remainingQuantity" DECIMAL(20,6),
    "rawPayload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusPurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NomusPurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "lineExternalId" INTEGER,
    "productExternalId" INTEGER,
    "productCode" TEXT,
    "description" TEXT,
    "unit" TEXT,
    "orderedQuantity" DECIMAL(20,6),
    "receivedQuantity" DECIMAL(20,6),
    "remainingQuantity" DECIMAL(20,6),
    "unitPrice" DECIMAL(20,6),
    "totalAmount" DECIMAL(20,2),
    "rawPayload" JSONB,
    "payloadHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusPurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NomusPurchaseOrder_externalId_key" ON "NomusPurchaseOrder"("externalId");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrder_orderNumber_idx" ON "NomusPurchaseOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrder_supplierExternalId_idx" ON "NomusPurchaseOrder"("supplierExternalId");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrder_supplierName_idx" ON "NomusPurchaseOrder"("supplierName");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrder_supplierTaxId_idx" ON "NomusPurchaseOrder"("supplierTaxId");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrder_issuedAt_idx" ON "NomusPurchaseOrder"("issuedAt");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrder_expectedAt_idx" ON "NomusPurchaseOrder"("expectedAt");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrder_stage_idx" ON "NomusPurchaseOrder"("stage");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrder_statusRaw_idx" ON "NomusPurchaseOrder"("statusRaw");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrder_canceled_idx" ON "NomusPurchaseOrder"("canceled");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrder_syncedAt_idx" ON "NomusPurchaseOrder"("syncedAt");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrder_lastSeenAt_idx" ON "NomusPurchaseOrder"("lastSeenAt");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrder_payloadHash_idx" ON "NomusPurchaseOrder"("payloadHash");

-- CreateIndex
CREATE UNIQUE INDEX "NomusPurchaseOrderItem_purchaseOrderId_lineIndex_key" ON "NomusPurchaseOrderItem"("purchaseOrderId", "lineIndex");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrderItem_lineExternalId_idx" ON "NomusPurchaseOrderItem"("lineExternalId");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrderItem_purchaseOrderId_idx" ON "NomusPurchaseOrderItem"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrderItem_productExternalId_idx" ON "NomusPurchaseOrderItem"("productExternalId");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrderItem_productCode_idx" ON "NomusPurchaseOrderItem"("productCode");

-- AddForeignKey
ALTER TABLE "NomusPurchaseOrderItem" ADD CONSTRAINT "NomusPurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "NomusPurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
