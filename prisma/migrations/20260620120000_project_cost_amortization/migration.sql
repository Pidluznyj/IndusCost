CREATE TYPE "ProjectCostAmortizationSourceType" AS ENUM ('MOLD', 'OTHER_COST');

CREATE TYPE "ProjectCostAmortizationTargetType" AS ENUM (
  'OFFICIAL_PRODUCT',
  'OFFICIAL_COMPONENT',
  'SIMULATION',
  'LEGACY'
);

CREATE TYPE "ProjectCostAmortizationStatus" AS ENUM (
  'NOT_CONFIGURED',
  'INCOMPLETE',
  'EXCESS',
  'DISTRIBUTED',
  'NO_ELIGIBLE_ITEMS'
);

CREATE TABLE "ProjectCostAmortization" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "projectId" UUID NOT NULL,
  "sourceType" "ProjectCostAmortizationSourceType" NOT NULL,
  "sourceId" UUID NOT NULL,
  "sourceBatchId" UUID,
  "sourceDescriptionSnapshot" TEXT NOT NULL,
  "sourceTotalCostSnapshot" DECIMAL(20, 6) NOT NULL,
  "passThroughPercent" DECIMAL(10, 6) NOT NULL DEFAULT 100,
  "passThroughAmount" DECIMAL(20, 6) NOT NULL DEFAULT 0,
  "absorbedAmount" DECIMAL(20, 6) NOT NULL DEFAULT 0,
  "status" "ProjectCostAmortizationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCostAmortization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectCostAmortization_projectId_sourceType_sourceId_key"
  ON "ProjectCostAmortization"("projectId", "sourceType", "sourceId");
CREATE INDEX "ProjectCostAmortization_projectId_idx" ON "ProjectCostAmortization"("projectId");
CREATE INDEX "ProjectCostAmortization_sourceType_idx" ON "ProjectCostAmortization"("sourceType");

ALTER TABLE "ProjectCostAmortization"
  ADD CONSTRAINT "ProjectCostAmortization_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "ProjectCostAmortizationAllocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "amortizationId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "targetItemType" "ProjectCostAmortizationTargetType" NOT NULL,
  "targetItemId" TEXT NOT NULL,
  "targetSnapshotRootProductId" UUID,
  "targetDescriptionSnapshot" TEXT NOT NULL,
  "targetBaseUnitCostSnapshot" DECIMAL(20, 6) NOT NULL DEFAULT 0,
  "allocationPercent" DECIMAL(10, 6) NOT NULL DEFAULT 0,
  "allocatedAmount" DECIMAL(20, 6) NOT NULL DEFAULT 0,
  "amortizationQuantity" DECIMAL(20, 6) NOT NULL DEFAULT 1,
  "unitAmortizedCost" DECIMAL(20, 6) NOT NULL DEFAULT 0,
  "finalUnitCostSnapshot" DECIMAL(20, 6) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCostAmortizationAllocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectCostAmortizationAllocation_amortizationId_idx"
  ON "ProjectCostAmortizationAllocation"("amortizationId");
CREATE INDEX "ProjectCostAmortizationAllocation_projectId_idx"
  ON "ProjectCostAmortizationAllocation"("projectId");
CREATE INDEX "ProjectCostAmortizationAllocation_targetItemId_idx"
  ON "ProjectCostAmortizationAllocation"("targetItemId");

ALTER TABLE "ProjectCostAmortizationAllocation"
  ADD CONSTRAINT "ProjectCostAmortizationAllocation_amortizationId_fkey"
  FOREIGN KEY ("amortizationId") REFERENCES "ProjectCostAmortization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
