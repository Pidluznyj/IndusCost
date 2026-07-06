-- Regras gerenciais de classificação AP → centro de custo (fornecedor opcional)

CREATE TYPE "FinancialCostCenterClassificationRuleType" AS ENUM (
  'SUPPLIER',
  'NOMUS_CLASSIFICATION',
  'DESCRIPTION_CONTAINS',
  'DOCUMENT_CONTAINS',
  'KEYWORDS',
  'NO_SUPPLIER',
  'FINANCIAL_NATURE',
  'MANUAL',
  'COMPOSITE'
);

CREATE TABLE "FinancialCostCenterClassificationRule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "ruleType" "FinancialCostCenterClassificationRuleType" NOT NULL,
  "costCenterId" UUID NOT NULL,
  "percentage" DECIMAL(5, 2) NOT NULL DEFAULT 100,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "autoApply" BOOLEAN NOT NULL DEFAULT false,
  "supplierId" UUID,
  "nomusClassification" TEXT,
  "descriptionContains" TEXT,
  "documentContains" TEXT,
  "keywords" JSONB,
  "financialNature" TEXT,
  "company" TEXT,
  "minAmount" DECIMAL(20, 2),
  "maxAmount" DECIMAL(20, 2),
  "titleStatus" TEXT,
  "accountsPayableId" INTEGER,
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FinancialCostCenterClassificationRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FinancialCostCenterClassificationRule_ruleType_isActive_idx"
  ON "FinancialCostCenterClassificationRule"("ruleType", "isActive");

CREATE INDEX "FinancialCostCenterClassificationRule_supplierId_idx"
  ON "FinancialCostCenterClassificationRule"("supplierId");

CREATE INDEX "FinancialCostCenterClassificationRule_costCenterId_idx"
  ON "FinancialCostCenterClassificationRule"("costCenterId");

CREATE INDEX "FinancialCostCenterClassificationRule_priority_idx"
  ON "FinancialCostCenterClassificationRule"("priority");

CREATE INDEX "FinancialCostCenterClassificationRule_accountsPayableId_idx"
  ON "FinancialCostCenterClassificationRule"("accountsPayableId");

CREATE INDEX "FinancialCostCenterClassificationRule_company_idx"
  ON "FinancialCostCenterClassificationRule"("company");

ALTER TABLE "FinancialCostCenterClassificationRule"
  ADD CONSTRAINT "FinancialCostCenterClassificationRule_costCenterId_fkey"
  FOREIGN KEY ("costCenterId") REFERENCES "FinancialCostCenter"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "FinancialCostCenterClassificationRule"
  ADD CONSTRAINT "FinancialCostCenterClassificationRule_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "FinancialSupplier"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "AccountsPayableCostCenterAllocation"
  ADD COLUMN "classificationRuleId" UUID,
  ADD COLUMN "classificationRuleType" TEXT,
  ADD COLUMN "classificationRuleName" TEXT,
  ADD COLUMN "classificationRuleReason" TEXT;

CREATE INDEX "AccountsPayableCostCenterAllocation_classificationRuleId_idx"
  ON "AccountsPayableCostCenterAllocation"("classificationRuleId");

ALTER TABLE "AccountsPayableCostCenterAllocation"
  ADD CONSTRAINT "AccountsPayableCostCenterAllocation_classificationRuleId_fkey"
  FOREIGN KEY ("classificationRuleId") REFERENCES "FinancialCostCenterClassificationRule"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
