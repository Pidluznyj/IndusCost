-- Regras de exclusão de comissionamento por cliente
CREATE TYPE "CommissionCustomerExclusionRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "CommissionCustomerExclusionRule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customerId" UUID,
    "customerExternalId" INTEGER,
    "customerNameSnapshot" TEXT NOT NULL,
    "normalizedCustomerName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "CommissionCustomerExclusionRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" UUID,
    "inactivatedAt" TIMESTAMPTZ(6),
    "inactivatedByUserId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionCustomerExclusionRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommissionCustomerExclusionRule_status_idx" ON "CommissionCustomerExclusionRule"("status");
CREATE INDEX "CommissionCustomerExclusionRule_customerId_idx" ON "CommissionCustomerExclusionRule"("customerId");
CREATE INDEX "CommissionCustomerExclusionRule_customerExternalId_idx" ON "CommissionCustomerExclusionRule"("customerExternalId");
CREATE INDEX "CommissionCustomerExclusionRule_normalizedCustomerName_idx" ON "CommissionCustomerExclusionRule"("normalizedCustomerName");
CREATE INDEX "CommissionCustomerExclusionRule_effectiveFrom_effectiveTo_idx" ON "CommissionCustomerExclusionRule"("effectiveFrom", "effectiveTo");

ALTER TABLE "CommissionCustomerExclusionRule" ADD CONSTRAINT "CommissionCustomerExclusionRule_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
