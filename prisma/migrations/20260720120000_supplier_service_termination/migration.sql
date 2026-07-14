-- Encerramento de Prestação de Serviço (cálculo gerencial/contratual)

CREATE TYPE "SupplierServiceTerminationStatus" AS ENUM ('DRAFT', 'FINALIZED', 'CANCELED');
CREATE TYPE "SupplierServiceTerminationCalcMode" AS ENUM ('WORKED_MONTHS', 'WORKED_DAYS');

CREATE TABLE "SupplierServiceTermination" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supplierId" UUID NOT NULL,
    "personName" TEXT NOT NULL,
    "personDocument" TEXT,
    "serviceRole" TEXT,
    "contractStartDate" DATE NOT NULL,
    "contractEndDate" DATE NOT NULL,
    "monthlyServiceAmount" DECIMAL(20,2) NOT NULL,
    "monthlyHours" DECIMAL(12,2) NOT NULL,
    "hourlyServiceAmount" DECIMAL(20,4) NOT NULL,
    "dailyServiceAmount" DECIMAL(20,4) NOT NULL,
    "restDaysPerYear" DECIMAL(8,2) NOT NULL DEFAULT 20,
    "calculationMode" "SupplierServiceTerminationCalcMode" NOT NULL DEFAULT 'WORKED_MONTHS',
    "workedMonths" DECIMAL(10,4) NOT NULL,
    "workedDays" INTEGER NOT NULL DEFAULT 0,
    "proportionalRestDays" DECIMAL(12,4) NOT NULL,
    "proportionalRestAmount" DECIMAL(20,2) NOT NULL,
    "commissionReportId" TEXT,
    "commissionReportTotal" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "otherCredits" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "otherDiscounts" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "totalTerminationAmount" DECIMAL(20,2) NOT NULL,
    "status" "SupplierServiceTerminationStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "adjustmentNotes" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "finalizedById" TEXT,
    "finalizedByName" TEXT,
    "finalizedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierServiceTermination_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierServiceTerminationCommissionLink" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "terminationId" UUID NOT NULL,
    "commissionReportKey" TEXT NOT NULL,
    "commissionPersonId" TEXT,
    "commissionPersonName" TEXT,
    "periodLabel" TEXT,
    "commissionAmount" DECIMAL(20,2) NOT NULL,
    "source" TEXT,
    "statusLabel" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierServiceTerminationCommissionLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierServiceTermination_supplierId_idx" ON "SupplierServiceTermination"("supplierId");
CREATE INDEX "SupplierServiceTermination_status_idx" ON "SupplierServiceTermination"("status");
CREATE INDEX "SupplierServiceTermination_personName_idx" ON "SupplierServiceTermination"("personName");
CREATE INDEX "SupplierServiceTermination_contractEndDate_idx" ON "SupplierServiceTermination"("contractEndDate");
CREATE INDEX "SupplierServiceTermination_createdAt_idx" ON "SupplierServiceTermination"("createdAt");
CREATE INDEX "SupplierServiceTerminationCommissionLink_terminationId_idx" ON "SupplierServiceTerminationCommissionLink"("terminationId");
CREATE INDEX "SupplierServiceTerminationCommissionLink_commissionReportKey_idx" ON "SupplierServiceTerminationCommissionLink"("commissionReportKey");

ALTER TABLE "SupplierServiceTermination" ADD CONSTRAINT "SupplierServiceTermination_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "FinancialSupplier"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SupplierServiceTerminationCommissionLink" ADD CONSTRAINT "SupplierServiceTerminationCommissionLink_terminationId_fkey" FOREIGN KEY ("terminationId") REFERENCES "SupplierServiceTermination"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
