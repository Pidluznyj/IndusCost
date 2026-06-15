-- CreateEnum
CREATE TYPE "ProjectPricingItemStatus" AS ENUM ('NO_COST', 'PENDING', 'CALCULATED', 'ERROR');

-- CreateTable
CREATE TABLE "ProjectPricingConfig" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "fiscalRuleId" UUID,
    "defaultMarginPercent" DECIMAL(10,6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPricingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPricingItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "configId" UUID NOT NULL,
    "targetItemId" TEXT NOT NULL,
    "targetItemType" "ProjectCostAmortizationTargetType" NOT NULL,
    "targetDescriptionSnapshot" TEXT NOT NULL,
    "fiscalRuleId" UUID,
    "fiscalRuleNameSnapshot" TEXT,
    "costBaseUnitSnapshot" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "amortizationUnitCostSnapshot" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "finalUnitCostSnapshot" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "taxPercentSnapshot" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "targetMarginPercent" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "suggestedPrice" DECIMAL(20,6),
    "taxAmount" DECIMAL(20,6),
    "marginAmount" DECIMAL(20,6),
    "status" "ProjectPricingItemStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPricingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPricingConfig_projectId_key" ON "ProjectPricingConfig"("projectId");

-- CreateIndex
CREATE INDEX "ProjectPricingConfig_fiscalRuleId_idx" ON "ProjectPricingConfig"("fiscalRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPricingItem_projectId_targetItemId_key" ON "ProjectPricingItem"("projectId", "targetItemId");

-- CreateIndex
CREATE INDEX "ProjectPricingItem_projectId_idx" ON "ProjectPricingItem"("projectId");

-- CreateIndex
CREATE INDEX "ProjectPricingItem_configId_idx" ON "ProjectPricingItem"("configId");

-- CreateIndex
CREATE INDEX "ProjectPricingItem_targetItemId_idx" ON "ProjectPricingItem"("targetItemId");

-- AddForeignKey
ALTER TABLE "ProjectPricingConfig" ADD CONSTRAINT "ProjectPricingConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProjectPricingConfig" ADD CONSTRAINT "ProjectPricingConfig_fiscalRuleId_fkey" FOREIGN KEY ("fiscalRuleId") REFERENCES "TaxRule"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProjectPricingItem" ADD CONSTRAINT "ProjectPricingItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProjectPricingItem" ADD CONSTRAINT "ProjectPricingItem_configId_fkey" FOREIGN KEY ("configId") REFERENCES "ProjectPricingConfig"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProjectPricingItem" ADD CONSTRAINT "ProjectPricingItem_fiscalRuleId_fkey" FOREIGN KEY ("fiscalRuleId") REFERENCES "TaxRule"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
