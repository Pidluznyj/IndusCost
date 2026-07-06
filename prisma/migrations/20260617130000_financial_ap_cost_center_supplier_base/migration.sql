-- Financeiro: base de fornecedores consolidados, centros de custo financeiros e classificação AP.
-- Camada aditiva; NomusAccountsPayable não é alterada (apenas FK de referência opcional).

CREATE TYPE "FinancialSupplierSource" AS ENUM (
  'AUTO_SYNC',
  'MANUAL',
  'IMPORT',
  'NOMUS_BOOTSTRAP'
);

CREATE TYPE "FinancialSupplierStatus" AS ENUM (
  'ACTIVE',
  'NEEDS_REVIEW',
  'MERGED',
  'INACTIVE'
);

CREATE TYPE "FinancialCostCenterStatus" AS ENUM (
  'ACTIVE',
  'INACTIVE'
);

CREATE TYPE "CostCenterAllocationSource" AS ENUM (
  'AUTO_RULE',
  'MANUAL',
  'BATCH'
);

CREATE TABLE "FinancialSupplier" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "displayName" TEXT NOT NULL,
  "legalName" TEXT,
  "tradeName" TEXT,
  "document" TEXT,
  "normalizedDocument" TEXT,
  "normalizedName" TEXT,
  "source" "FinancialSupplierSource" NOT NULL DEFAULT 'NOMUS_BOOTSTRAP',
  "status" "FinancialSupplierStatus" NOT NULL DEFAULT 'ACTIVE',
  "confidence" DECIMAL(5, 2),
  "firstSeenAt" TIMESTAMPTZ(6),
  "lastSeenAt" TIMESTAMPTZ(6),
  "titlesCount" INTEGER NOT NULL DEFAULT 0,
  "totalAmountSeen" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "FinancialSupplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialSupplierAlias" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "source" "FinancialSupplierSource" NOT NULL DEFAULT 'AUTO_SYNC',
  "externalSupplierId" INTEGER,
  "originalName" TEXT,
  "originalDocument" TEXT,
  "normalizedName" TEXT,
  "normalizedDocument" TEXT,
  "firstSeenAt" TIMESTAMPTZ(6),
  "lastSeenAt" TIMESTAMPTZ(6),
  "titlesCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "FinancialSupplierAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialCostCenter" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "parentId" UUID,
  "responsibleUserId" TEXT,
  "responsibleName" TEXT,
  "status" "FinancialCostCenterStatus" NOT NULL DEFAULT 'ACTIVE',
  "color" TEXT,
  "icon" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "FinancialCostCenter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierCostCenterRule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplierId" UUID NOT NULL,
  "costCenterId" UUID NOT NULL,
  "percentage" DECIMAL(5, 2) NOT NULL DEFAULT 100,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "autoApply" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "company" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "SupplierCostCenterRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountsPayableCostCenterAllocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountsPayableId" INTEGER NOT NULL,
  "supplierId" UUID,
  "costCenterId" UUID NOT NULL,
  "amount" DECIMAL(20, 2),
  "percentage" DECIMAL(5, 2) NOT NULL DEFAULT 100,
  "source" "CostCenterAllocationSource" NOT NULL,
  "confidence" DECIMAL(5, 2),
  "lockedManual" BOOLEAN NOT NULL DEFAULT false,
  "ruleId" UUID,
  "notes" TEXT,
  "createdByUserId" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "AccountsPayableCostCenterAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialCostCenterAuditLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "userId" TEXT,
  "userName" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FinancialCostCenterAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinancialCostCenter_code_key" ON "FinancialCostCenter"("code");

CREATE UNIQUE INDEX "AccountsPayableCostCenterAllocation_accountsPayableId_costCenterId_key"
  ON "AccountsPayableCostCenterAllocation"("accountsPayableId", "costCenterId");

CREATE INDEX "FinancialSupplier_normalizedDocument_idx" ON "FinancialSupplier"("normalizedDocument");
CREATE INDEX "FinancialSupplier_normalizedName_idx" ON "FinancialSupplier"("normalizedName");
CREATE INDEX "FinancialSupplier_status_idx" ON "FinancialSupplier"("status");
CREATE INDEX "FinancialSupplier_displayName_idx" ON "FinancialSupplier"("displayName");

CREATE INDEX "FinancialSupplierAlias_supplierId_idx" ON "FinancialSupplierAlias"("supplierId");
CREATE INDEX "FinancialSupplierAlias_externalSupplierId_idx" ON "FinancialSupplierAlias"("externalSupplierId");
CREATE INDEX "FinancialSupplierAlias_normalizedDocument_idx" ON "FinancialSupplierAlias"("normalizedDocument");
CREATE INDEX "FinancialSupplierAlias_normalizedName_idx" ON "FinancialSupplierAlias"("normalizedName");

CREATE INDEX "FinancialCostCenter_status_idx" ON "FinancialCostCenter"("status");
CREATE INDEX "FinancialCostCenter_parentId_idx" ON "FinancialCostCenter"("parentId");

CREATE INDEX "SupplierCostCenterRule_supplierId_isActive_idx" ON "SupplierCostCenterRule"("supplierId", "isActive");
CREATE INDEX "SupplierCostCenterRule_costCenterId_idx" ON "SupplierCostCenterRule"("costCenterId");
CREATE INDEX "SupplierCostCenterRule_company_idx" ON "SupplierCostCenterRule"("company");
CREATE INDEX "SupplierCostCenterRule_priority_idx" ON "SupplierCostCenterRule"("priority");

CREATE INDEX "AccountsPayableCostCenterAllocation_accountsPayableId_idx"
  ON "AccountsPayableCostCenterAllocation"("accountsPayableId");
CREATE INDEX "AccountsPayableCostCenterAllocation_supplierId_idx"
  ON "AccountsPayableCostCenterAllocation"("supplierId");
CREATE INDEX "AccountsPayableCostCenterAllocation_costCenterId_idx"
  ON "AccountsPayableCostCenterAllocation"("costCenterId");
CREATE INDEX "AccountsPayableCostCenterAllocation_source_idx"
  ON "AccountsPayableCostCenterAllocation"("source");
CREATE INDEX "AccountsPayableCostCenterAllocation_lockedManual_idx"
  ON "AccountsPayableCostCenterAllocation"("lockedManual");

CREATE INDEX "FinancialCostCenterAuditLog_entityType_entityId_idx"
  ON "FinancialCostCenterAuditLog"("entityType", "entityId");
CREATE INDEX "FinancialCostCenterAuditLog_userId_idx" ON "FinancialCostCenterAuditLog"("userId");
CREATE INDEX "FinancialCostCenterAuditLog_createdAt_idx" ON "FinancialCostCenterAuditLog"("createdAt");
CREATE INDEX "FinancialCostCenterAuditLog_action_idx" ON "FinancialCostCenterAuditLog"("action");

ALTER TABLE "FinancialSupplierAlias"
  ADD CONSTRAINT "FinancialSupplierAlias_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "FinancialSupplier"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "FinancialCostCenter"
  ADD CONSTRAINT "FinancialCostCenter_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "FinancialCostCenter"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "SupplierCostCenterRule"
  ADD CONSTRAINT "SupplierCostCenterRule_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "FinancialSupplier"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "SupplierCostCenterRule"
  ADD CONSTRAINT "SupplierCostCenterRule_costCenterId_fkey"
  FOREIGN KEY ("costCenterId") REFERENCES "FinancialCostCenter"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "AccountsPayableCostCenterAllocation"
  ADD CONSTRAINT "AccountsPayableCostCenterAllocation_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "FinancialSupplier"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "AccountsPayableCostCenterAllocation"
  ADD CONSTRAINT "AccountsPayableCostCenterAllocation_costCenterId_fkey"
  FOREIGN KEY ("costCenterId") REFERENCES "FinancialCostCenter"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "AccountsPayableCostCenterAllocation"
  ADD CONSTRAINT "AccountsPayableCostCenterAllocation_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "SupplierCostCenterRule"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "AccountsPayableCostCenterAllocation"
  ADD CONSTRAINT "AccountsPayableCostCenterAllocation_accountsPayableId_fkey"
  FOREIGN KEY ("accountsPayableId") REFERENCES "NomusAccountsPayable"("externalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
