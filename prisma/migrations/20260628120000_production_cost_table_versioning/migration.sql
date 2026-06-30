-- CreateEnum
CREATE TYPE "ProductionCostTableVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "ProductionCostTableVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "status" "ProductionCostTableVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL,
    "supersedesVersionId" UUID,
    "source" TEXT,
    "notes" TEXT,
    "publishedAt" TIMESTAMPTZ(6),
    "publishedBy" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionCostTableVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionCostTableItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "costTableVersionId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productCodeSnapshot" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "unitProductionCost" DECIMAL(20,6) NOT NULL,
    "materialCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "processCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "laborCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "machineCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "overheadCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "calculationHash" TEXT,
    "calculationSnapshot" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionCostTableItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionCostTableVersion_code_idx" ON "ProductionCostTableVersion"("code");

-- CreateIndex
CREATE INDEX "ProductionCostTableVersion_status_idx" ON "ProductionCostTableVersion"("status");

-- CreateIndex
CREATE INDEX "ProductionCostTableVersion_effectiveDate_idx" ON "ProductionCostTableVersion"("effectiveDate");

-- CreateIndex
CREATE INDEX "ProductionCostTableVersion_publishedAt_idx" ON "ProductionCostTableVersion"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionCostTableVersion_code_revision_key" ON "ProductionCostTableVersion"("code", "revision");

-- CreateIndex
CREATE INDEX "ProductionCostTableItem_costTableVersionId_idx" ON "ProductionCostTableItem"("costTableVersionId");

-- CreateIndex
CREATE INDEX "ProductionCostTableItem_productId_idx" ON "ProductionCostTableItem"("productId");

-- CreateIndex
CREATE INDEX "ProductionCostTableItem_productCodeSnapshot_idx" ON "ProductionCostTableItem"("productCodeSnapshot");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionCostTableItem_costTableVersionId_productId_key" ON "ProductionCostTableItem"("costTableVersionId", "productId");

-- AddForeignKey
ALTER TABLE "ProductionCostTableVersion" ADD CONSTRAINT "ProductionCostTableVersion_supersedesVersionId_fkey" FOREIGN KEY ("supersedesVersionId") REFERENCES "ProductionCostTableVersion"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProductionCostTableItem" ADD CONSTRAINT "ProductionCostTableItem_costTableVersionId_fkey" FOREIGN KEY ("costTableVersionId") REFERENCES "ProductionCostTableVersion"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProductionCostTableItem" ADD CONSTRAINT "ProductionCostTableItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
