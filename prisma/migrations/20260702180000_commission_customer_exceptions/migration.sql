-- Exceções de cliente/produto sem comissão (decisão auditável)
CREATE TABLE "CommissionCustomerException" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customerExternalId" INTEGER,
    "customerName" TEXT,
    "commissionPersonId" UUID,
    "productCode" TEXT,
    "productExternalId" INTEGER,
    "reason" TEXT NOT NULL,
    "startDate" TIMESTAMPTZ(6) NOT NULL,
    "endDate" TIMESTAMPTZ(6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" UUID,
    "updatedByUserId" UUID,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionCustomerException_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommissionCustomerException_customerExternalId_idx" ON "CommissionCustomerException"("customerExternalId");
CREATE INDEX "CommissionCustomerException_commissionPersonId_idx" ON "CommissionCustomerException"("commissionPersonId");
CREATE INDEX "CommissionCustomerException_productCode_idx" ON "CommissionCustomerException"("productCode");
CREATE INDEX "CommissionCustomerException_active_idx" ON "CommissionCustomerException"("active");
CREATE INDEX "CommissionCustomerException_startDate_endDate_idx" ON "CommissionCustomerException"("startDate", "endDate");

ALTER TABLE "CommissionCustomerException" ADD CONSTRAINT "CommissionCustomerException_commissionPersonId_fkey" FOREIGN KEY ("commissionPersonId") REFERENCES "CommissionPerson"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
