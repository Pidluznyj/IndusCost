-- CreateEnum
CREATE TYPE "TransformationHhHmCostSimulationType" AS ENUM ('CUSTO_MANUAL', 'CUSTO_CC');

-- CreateTable
CREATE TABLE "TransformationHhHmCostSimulation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "TransformationHhHmCostSimulationType" NOT NULL,
    "observation" TEXT,
    "periodLabel" TEXT,
    "dateAxis" TEXT,
    "hhEffectiveRate" DECIMAL(20,6),
    "hmEffectiveRate" DECIMAL(20,6),
    "finalHhHmRate" DECIMAL(20,6),
    "inputSnapshot" JSONB NOT NULL,
    "resultSnapshot" JSONB NOT NULL,
    "createdByUserId" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransformationHhHmCostSimulation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransformationHhHmCostSimulation_createdAt_idx" ON "TransformationHhHmCostSimulation"("createdAt");

-- CreateIndex
CREATE INDEX "TransformationHhHmCostSimulation_type_createdAt_idx" ON "TransformationHhHmCostSimulation"("type", "createdAt");
