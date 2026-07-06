-- CreateTable
CREATE TABLE "MaterialCostTableVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "effectiveDate" DATE NOT NULL,
    "status" "ProductionCostTableVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL,
    "supersedesVersionId" UUID,
    "source" TEXT,
    "notes" TEXT,
    "summaryJson" JSONB,
    "publishedAt" TIMESTAMPTZ(6),
    "publishedBy" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialCostTableVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialCostTableItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "materialCostTableVersionId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "materialCodeSnapshot" TEXT NOT NULL,
    "materialDescriptionSnapshot" TEXT NOT NULL,
    "unitSnapshot" TEXT NOT NULL,
    "currentCostSnapshot" DECIMAL(20,6) NOT NULL,
    "freightSnapshot" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "landedCostSnapshot" DECIMAL(20,6) NOT NULL,
    "averageCostSnapshot" DECIMAL(20,6),
    "standardCostSnapshot" DECIMAL(20,6),
    "standardLossSnapshot" DECIMAL(10,6),
    "costSource" TEXT NOT NULL DEFAULT 'CURRENT_MATERIAL',
    "warningsJson" JSONB,
    "calculationHash" TEXT,
    "calculationSnapshot" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialCostTableItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialCostTableVersion_code_idx" ON "MaterialCostTableVersion"("code");

-- CreateIndex
CREATE INDEX "MaterialCostTableVersion_status_idx" ON "MaterialCostTableVersion"("status");

-- CreateIndex
CREATE INDEX "MaterialCostTableVersion_effectiveDate_idx" ON "MaterialCostTableVersion"("effectiveDate");

-- CreateIndex
CREATE INDEX "MaterialCostTableVersion_publishedAt_idx" ON "MaterialCostTableVersion"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialCostTableVersion_code_revision_key" ON "MaterialCostTableVersion"("code", "revision");

-- CreateIndex
CREATE INDEX "MaterialCostTableItem_materialCostTableVersionId_idx" ON "MaterialCostTableItem"("materialCostTableVersionId");

-- CreateIndex
CREATE INDEX "MaterialCostTableItem_materialId_idx" ON "MaterialCostTableItem"("materialId");

-- CreateIndex
CREATE INDEX "MaterialCostTableItem_materialCodeSnapshot_idx" ON "MaterialCostTableItem"("materialCodeSnapshot");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialCostTableItem_materialCostTableVersionId_materialId_key" ON "MaterialCostTableItem"("materialCostTableVersionId", "materialId");

-- AddForeignKey
ALTER TABLE "MaterialCostTableVersion" ADD CONSTRAINT "MaterialCostTableVersion_supersedesVersionId_fkey" FOREIGN KEY ("supersedesVersionId") REFERENCES "MaterialCostTableVersion"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MaterialCostTableItem" ADD CONSTRAINT "MaterialCostTableItem_materialCostTableVersionId_fkey" FOREIGN KEY ("materialCostTableVersionId") REFERENCES "MaterialCostTableVersion"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MaterialCostTableItem" ADD CONSTRAINT "MaterialCostTableItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
