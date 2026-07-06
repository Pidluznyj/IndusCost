-- CreateTable
CREATE TABLE "ProductionHourCostSimulation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "payrollCostMonth" DECIMAL(20, 6) NOT NULL,
  "payrollCostComment" TEXT,
  "energyCostMonth" DECIMAL(20, 6) NOT NULL,
  "energyCostComment" TEXT,
  "otherProductiveCostsMonth" DECIMAL(20, 6) NOT NULL,
  "otherProductiveCostsComment" TEXT,
  "productiveHoursMonth" DECIMAL(20, 6) NOT NULL,
  "productiveHoursComment" TEXT,
  "payrollCostPerHour" DECIMAL(20, 6) NOT NULL,
  "energyCostPerHour" DECIMAL(20, 6) NOT NULL,
  "otherCostPerHour" DECIMAL(20, 6) NOT NULL,
  "totalProductionHourCost" DECIMAL(20, 6) NOT NULL,
  "formulaText" TEXT NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductionHourCostSimulation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionHourCostSimulation_createdAt_idx" ON "ProductionHourCostSimulation" ("createdAt");
