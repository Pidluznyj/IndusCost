-- CreateTable
CREATE TABLE "ComponentPerformanceChangeLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "productId" UUID NOT NULL,
    "skuSnapshot" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "productTypeSnapshot" "ItemType" NOT NULL,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByUserId" UUID NOT NULL,
    "changedByUserName" TEXT NOT NULL,
    "changedByUserEmail" TEXT NOT NULL,
    "responsiblePersonName" TEXT NOT NULL,
    "note" TEXT,
    "oldCycleTimeSeconds" DECIMAL(20,6),
    "newCycleTimeSeconds" DECIMAL(20,6),
    "oldCavities" INTEGER,
    "newCavities" INTEGER,
    "oldValuesJson" JSONB,
    "newValuesJson" JSONB,
    "changedFieldsJson" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'OPERATIONS_PERFORMANCE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComponentPerformanceChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ComponentPerformanceChangeLog_productId_idx" ON "ComponentPerformanceChangeLog"("productId");

-- CreateIndex
CREATE INDEX "ComponentPerformanceChangeLog_changedAt_idx" ON "ComponentPerformanceChangeLog"("changedAt");

-- CreateIndex
CREATE INDEX "ComponentPerformanceChangeLog_skuSnapshot_idx" ON "ComponentPerformanceChangeLog"("skuSnapshot");

-- CreateIndex
CREATE INDEX "ComponentPerformanceChangeLog_source_idx" ON "ComponentPerformanceChangeLog"("source");

-- AddForeignKey
ALTER TABLE "ComponentPerformanceChangeLog" ADD CONSTRAINT "ComponentPerformanceChangeLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
