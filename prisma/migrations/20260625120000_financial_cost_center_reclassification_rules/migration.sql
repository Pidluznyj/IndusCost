-- Regras gerenciais de reclassificação de centro de custo (descrição AP → subcentro).

CREATE TABLE "FinancialCostCenterReclassificationRule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sourceCostCenterName" TEXT,
  "sourceParentName" TEXT,
  "targetCostCenterId" UUID NOT NULL,
  "matchFields" JSONB NOT NULL,
  "keywords" JSONB NOT NULL,
  "matchMode" TEXT NOT NULL DEFAULT 'CONTAINS_ANY',
  "applyToSources" JSONB NOT NULL,
  "skipManual" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "FinancialCostCenterReclassificationRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FinancialCostCenterReclassificationRule_isActive_idx"
  ON "FinancialCostCenterReclassificationRule"("isActive");

CREATE INDEX "FinancialCostCenterReclassificationRule_priority_idx"
  ON "FinancialCostCenterReclassificationRule"("priority");

CREATE INDEX "FinancialCostCenterReclassificationRule_targetCostCenterId_idx"
  ON "FinancialCostCenterReclassificationRule"("targetCostCenterId");

ALTER TABLE "FinancialCostCenterReclassificationRule"
  ADD CONSTRAINT "FinancialCostCenterReclassificationRule_targetCostCenterId_fkey"
  FOREIGN KEY ("targetCostCenterId") REFERENCES "FinancialCostCenter"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
