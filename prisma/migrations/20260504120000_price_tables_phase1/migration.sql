-- CreateTable
CREATE TABLE "PriceTable" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultMarginPct" DECIMAL(10,6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceTableVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "priceTableId" UUID NOT NULL,
    "taxRuleId" UUID,
    "versionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "generatedAt" TIMESTAMPTZ(6),
    "publishedAt" TIMESTAMPTZ(6),
    "effectiveFrom" TIMESTAMPTZ(6),
    "effectiveTo" TIMESTAMPTZ(6),
    "notes" TEXT,
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "generationSummaryJson" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceTableVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceTableItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "priceTableVersionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "frozenTotalCost" DECIMAL(20,6) NOT NULL,
    "frozenMaterialCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "frozenHhCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "frozenHmCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "frozenTaxCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "frozenOtherCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "marginPct" DECIMAL(10,6) NOT NULL,
    "salePrice" DECIMAL(20,6) NOT NULL,
    "costSnapshotJson" JSONB,
    "formulaSnapshotJson" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceTableItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceTable_code_key" ON "PriceTable"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PriceTableVersion_priceTableId_versionNumber_key" ON "PriceTableVersion"("priceTableId", "versionNumber");

-- CreateIndex
CREATE INDEX "PriceTableVersion_priceTableId_idx" ON "PriceTableVersion"("priceTableId");

-- CreateIndex
CREATE INDEX "PriceTableVersion_taxRuleId_idx" ON "PriceTableVersion"("taxRuleId");

-- CreateIndex
CREATE INDEX "PriceTableVersion_status_idx" ON "PriceTableVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PriceTableItem_priceTableVersionId_productId_key" ON "PriceTableItem"("priceTableVersionId", "productId");

-- CreateIndex
CREATE INDEX "PriceTableItem_priceTableVersionId_idx" ON "PriceTableItem"("priceTableVersionId");

-- CreateIndex
CREATE INDEX "PriceTableItem_productId_idx" ON "PriceTableItem"("productId");

-- CreateIndex
CREATE INDEX "PriceTableItem_sku_idx" ON "PriceTableItem"("sku");

-- AddForeignKey
ALTER TABLE "PriceTableVersion" ADD CONSTRAINT "PriceTableVersion_priceTableId_fkey" FOREIGN KEY ("priceTableId") REFERENCES "PriceTable"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PriceTableVersion" ADD CONSTRAINT "PriceTableVersion_taxRuleId_fkey" FOREIGN KEY ("taxRuleId") REFERENCES "TaxRule"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PriceTableItem" ADD CONSTRAINT "PriceTableItem_priceTableVersionId_fkey" FOREIGN KEY ("priceTableVersionId") REFERENCES "PriceTableVersion"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PriceTableItem" ADD CONSTRAINT "PriceTableItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
