-- T05: apuração fiscal (B), guias/recolhimento (C), alocação gerencial (D).
-- Pagamento oficial permanece em NomusAccountsPayable quando accountsPayableExternalId é preenchido.

CREATE TYPE "FiscalJurisdiction" AS ENUM ('FEDERAL', 'STATE', 'MUNICIPAL', 'REFORM');
CREATE TYPE "FiscalApurationStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');
CREATE TYPE "FiscalApurationLineNature" AS ENUM ('DEBIT', 'CREDIT', 'RETENTION', 'COMPENSATION', 'INTEREST', 'FINE');
CREATE TYPE "FiscalGuideType" AS ENUM ('DARF', 'GNRE', 'DAS', 'DAE', 'GPS', 'STATE_GUIDE', 'MUNICIPAL_GUIDE', 'OTHER');
CREATE TYPE "FiscalGuideStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'REVERSED');
CREATE TYPE "FiscalAllocationMethod" AS ENUM ('PRO_RATA_HIGHLIGHTED', 'DIRECT_GUIDE_NFE', 'MANUAL');

CREATE TABLE "FiscalApurationPeriod" (
    "id" TEXT NOT NULL,
    "companyName" TEXT,
    "jurisdiction" "FiscalJurisdiction" NOT NULL,
    "uf" TEXT,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "FiscalApurationStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "closedAt" TIMESTAMP(3),
    "closedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalApurationPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FiscalApurationLine" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "taxType" TEXT NOT NULL,
    "nature" "FiscalApurationLineNature" NOT NULL,
    "revenueCode" TEXT,
    "assessedAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "creditsAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "compensationsAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "interestAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "fineAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "amountDue" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalApurationLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FiscalPaymentGuide" (
    "id" TEXT NOT NULL,
    "periodId" TEXT,
    "taxType" TEXT NOT NULL,
    "jurisdiction" "FiscalJurisdiction" NOT NULL,
    "revenueCode" TEXT,
    "guideType" "FiscalGuideType" NOT NULL,
    "guideNumber" TEXT,
    "barcode" TEXT,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE,
    "assessedAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "creditsAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "compensationsAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "interestAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "fineAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "amountDue" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "balanceDue" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "status" "FiscalGuideStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentAccount" TEXT,
    "accountsPayableExternalId" INTEGER,
    "costCenterId" TEXT,
    "dedupeKey" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalPaymentGuide_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FiscalPaymentProof" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "notes" TEXT,
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalPaymentProof_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FiscalAllocation" (
    "id" TEXT NOT NULL,
    "guideId" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "nomusNfeId" TEXT,
    "taxType" TEXT NOT NULL,
    "allocatedAmount" DECIMAL(20,2) NOT NULL,
    "allocationMethod" "FiscalAllocationMethod" NOT NULL,
    "allocationBase" DECIMAL(20,2),
    "periodStart" DATE,
    "periodEnd" DATE,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FiscalSettlementAuditLog" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalSettlementAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FiscalApurationPeriod_periodStart_periodEnd_idx" ON "FiscalApurationPeriod"("periodStart", "periodEnd");
CREATE INDEX "FiscalApurationPeriod_jurisdiction_status_idx" ON "FiscalApurationPeriod"("jurisdiction", "status");
CREATE INDEX "FiscalApurationPeriod_uf_idx" ON "FiscalApurationPeriod"("uf");
CREATE INDEX "FiscalApurationPeriod_companyName_idx" ON "FiscalApurationPeriod"("companyName");

CREATE INDEX "FiscalApurationLine_periodId_taxType_idx" ON "FiscalApurationLine"("periodId", "taxType");
CREATE INDEX "FiscalApurationLine_nature_idx" ON "FiscalApurationLine"("nature");
CREATE INDEX "FiscalApurationLine_revenueCode_idx" ON "FiscalApurationLine"("revenueCode");

CREATE UNIQUE INDEX "FiscalPaymentGuide_dedupeKey_key" ON "FiscalPaymentGuide"("dedupeKey");
CREATE INDEX "FiscalPaymentGuide_status_dueDate_idx" ON "FiscalPaymentGuide"("status", "dueDate");
CREATE INDEX "FiscalPaymentGuide_guideType_guideNumber_idx" ON "FiscalPaymentGuide"("guideType", "guideNumber");
CREATE INDEX "FiscalPaymentGuide_taxType_idx" ON "FiscalPaymentGuide"("taxType");
CREATE INDEX "FiscalPaymentGuide_accountsPayableExternalId_idx" ON "FiscalPaymentGuide"("accountsPayableExternalId");
CREATE INDEX "FiscalPaymentGuide_periodStart_periodEnd_idx" ON "FiscalPaymentGuide"("periodStart", "periodEnd");
CREATE INDEX "FiscalPaymentGuide_periodId_idx" ON "FiscalPaymentGuide"("periodId");

CREATE INDEX "FiscalPaymentProof_guideId_uploadedAt_idx" ON "FiscalPaymentProof"("guideId", "uploadedAt" DESC);

CREATE INDEX "FiscalAllocation_guideId_idx" ON "FiscalAllocation"("guideId");
CREATE INDEX "FiscalAllocation_salesOrderId_idx" ON "FiscalAllocation"("salesOrderId");
CREATE INDEX "FiscalAllocation_nomusNfeId_idx" ON "FiscalAllocation"("nomusNfeId");
CREATE INDEX "FiscalAllocation_taxType_idx" ON "FiscalAllocation"("taxType");
CREATE INDEX "FiscalAllocation_allocationMethod_idx" ON "FiscalAllocation"("allocationMethod");

CREATE INDEX "FiscalSettlementAuditLog_entityType_entityId_idx" ON "FiscalSettlementAuditLog"("entityType", "entityId");
CREATE INDEX "FiscalSettlementAuditLog_userId_idx" ON "FiscalSettlementAuditLog"("userId");
CREATE INDEX "FiscalSettlementAuditLog_createdAt_idx" ON "FiscalSettlementAuditLog"("createdAt");
CREATE INDEX "FiscalSettlementAuditLog_action_idx" ON "FiscalSettlementAuditLog"("action");

ALTER TABLE "FiscalApurationLine" ADD CONSTRAINT "FiscalApurationLine_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "FiscalApurationPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalPaymentGuide" ADD CONSTRAINT "FiscalPaymentGuide_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "FiscalApurationPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FiscalPaymentProof" ADD CONSTRAINT "FiscalPaymentProof_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "FiscalPaymentGuide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalAllocation" ADD CONSTRAINT "FiscalAllocation_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "FiscalPaymentGuide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
