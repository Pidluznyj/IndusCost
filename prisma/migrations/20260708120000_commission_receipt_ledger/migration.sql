-- Ledger auditável de comissão por recebimento (fechamento mensal persistido)
-- Reversível: DROP TABLE CommissionReceiptLedgerLine; DROP TABLE CommissionMonthlyClosing; DROP TYPE ...

CREATE TYPE "CommissionMonthlyClosingStatus" AS ENUM (
  'DRAFT',
  'PREVIEWED',
  'CLOSED',
  'CANCELLED',
  'REPROCESSED'
);

CREATE TYPE "CommissionMonthlyClosingSource" AS ENUM ('RECEIPT_BASED');

CREATE TYPE "CommissionReceiptLedgerLineStatus" AS ENUM (
  'COMMISSIONABLE',
  'CUSTOMER_EXCLUDED',
  'NO_SALES_LINK',
  'NO_SELLER',
  'SELLER_UNRESOLVED',
  'NO_RULE',
  'ZERO_AMOUNT',
  'ERROR'
);

CREATE TABLE "CommissionMonthlyClosing" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "status" "CommissionMonthlyClosingStatus" NOT NULL DEFAULT 'DRAFT',
  "source" "CommissionMonthlyClosingSource" NOT NULL DEFAULT 'RECEIPT_BASED',
  "totalReceivedAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "totalCommissionableBase" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "totalExpectedCommission" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "totalReleasedCommission" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "totalExcludedAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "totalExceptionAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "lineCount" INTEGER NOT NULL DEFAULT 0,
  "calculationHash" TEXT,
  "notes" TEXT,
  "createdBy" TEXT,
  "closedBy" TEXT,
  "supersededByClosingId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMPTZ(6),

  CONSTRAINT "CommissionMonthlyClosing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionReceiptLedgerLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "closingId" UUID,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "ledgerLineKey" TEXT NOT NULL,
  "nomusReceivableId" INTEGER,
  "receivableNumber" TEXT,
  "installmentNumber" INTEGER,
  "settlementDate" TIMESTAMPTZ(6),
  "dueDate" TIMESTAMPTZ(6),
  "customerId" UUID,
  "customerExternalId" INTEGER,
  "customerNameSnapshot" TEXT,
  "customerDocumentSnapshot" TEXT,
  "nomusOrderId" INTEGER,
  "orderCode" TEXT,
  "nomusNfeId" INTEGER,
  "nfeNumber" TEXT,
  "nomusOrderItemId" INTEGER,
  "nomusProductId" INTEGER,
  "productCode" TEXT,
  "productNameSnapshot" TEXT,
  "rawSellerId" INTEGER,
  "rawSellerName" TEXT,
  "canonicalSellerId" UUID,
  "canonicalSellerName" TEXT,
  "sellerResolutionStatus" TEXT,
  "receivedAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "receivableNominalAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "allocatedReceivedAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "allocatedCommercialBase" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "commissionRatePercent" DECIMAL(10, 4) NOT NULL DEFAULT 0,
  "expectedCommissionAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "releasedCommissionAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "commissionRecordId" UUID,
  "commissionPaymentScheduleId" UUID,
  "ruleId" UUID,
  "ruleNameSnapshot" TEXT,
  "ruleSnapshotJson" JSONB,
  "customerExclusionRuleId" UUID,
  "exclusionReason" TEXT,
  "status" "CommissionReceiptLedgerLineStatus" NOT NULL,
  "exceptionReason" TEXT,
  "calculationHash" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommissionReceiptLedgerLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommissionReceiptLedgerLine_ledgerLineKey_key"
  ON "CommissionReceiptLedgerLine"("ledgerLineKey");

CREATE UNIQUE INDEX "CommissionMonthlyClosing_year_month_source_closed_key"
  ON "CommissionMonthlyClosing"("year", "month", "source")
  WHERE "status" = 'CLOSED';

CREATE INDEX "CommissionMonthlyClosing_year_month_idx"
  ON "CommissionMonthlyClosing"("year", "month");
CREATE INDEX "CommissionMonthlyClosing_status_idx"
  ON "CommissionMonthlyClosing"("status");
CREATE INDEX "CommissionMonthlyClosing_source_idx"
  ON "CommissionMonthlyClosing"("source");
CREATE INDEX "CommissionMonthlyClosing_createdAt_idx"
  ON "CommissionMonthlyClosing"("createdAt");
CREATE INDEX "CommissionMonthlyClosing_supersededByClosingId_idx"
  ON "CommissionMonthlyClosing"("supersededByClosingId");

CREATE INDEX "CommissionReceiptLedgerLine_year_month_idx"
  ON "CommissionReceiptLedgerLine"("year", "month");
CREATE INDEX "CommissionReceiptLedgerLine_closingId_idx"
  ON "CommissionReceiptLedgerLine"("closingId");
CREATE INDEX "CommissionReceiptLedgerLine_nomusReceivableId_idx"
  ON "CommissionReceiptLedgerLine"("nomusReceivableId");
CREATE INDEX "CommissionReceiptLedgerLine_canonicalSellerId_idx"
  ON "CommissionReceiptLedgerLine"("canonicalSellerId");
CREATE INDEX "CommissionReceiptLedgerLine_customerExternalId_idx"
  ON "CommissionReceiptLedgerLine"("customerExternalId");
CREATE INDEX "CommissionReceiptLedgerLine_customerId_idx"
  ON "CommissionReceiptLedgerLine"("customerId");
CREATE INDEX "CommissionReceiptLedgerLine_status_idx"
  ON "CommissionReceiptLedgerLine"("status");
CREATE INDEX "CommissionReceiptLedgerLine_commissionRecordId_idx"
  ON "CommissionReceiptLedgerLine"("commissionRecordId");
CREATE INDEX "CommissionReceiptLedgerLine_commissionPaymentScheduleId_idx"
  ON "CommissionReceiptLedgerLine"("commissionPaymentScheduleId");
CREATE INDEX "CommissionReceiptLedgerLine_settlementDate_idx"
  ON "CommissionReceiptLedgerLine"("settlementDate");

ALTER TABLE "CommissionMonthlyClosing"
  ADD CONSTRAINT "CommissionMonthlyClosing_supersededByClosingId_fkey"
  FOREIGN KEY ("supersededByClosingId") REFERENCES "CommissionMonthlyClosing"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "CommissionReceiptLedgerLine"
  ADD CONSTRAINT "CommissionReceiptLedgerLine_closingId_fkey"
  FOREIGN KEY ("closingId") REFERENCES "CommissionMonthlyClosing"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "CommissionReceiptLedgerLine"
  ADD CONSTRAINT "CommissionReceiptLedgerLine_commissionRecordId_fkey"
  FOREIGN KEY ("commissionRecordId") REFERENCES "CommissionRecord"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "CommissionReceiptLedgerLine"
  ADD CONSTRAINT "CommissionReceiptLedgerLine_commissionPaymentScheduleId_fkey"
  FOREIGN KEY ("commissionPaymentScheduleId") REFERENCES "CommissionPaymentSchedule"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "CommissionReceiptLedgerLine"
  ADD CONSTRAINT "CommissionReceiptLedgerLine_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "CommissionRule"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "CommissionReceiptLedgerLine"
  ADD CONSTRAINT "CommissionReceiptLedgerLine_canonicalSellerId_fkey"
  FOREIGN KEY ("canonicalSellerId") REFERENCES "CommissionPerson"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "CommissionReceiptLedgerLine"
  ADD CONSTRAINT "CommissionReceiptLedgerLine_customerExclusionRuleId_fkey"
  FOREIGN KEY ("customerExclusionRuleId") REFERENCES "CommissionCustomerExclusionRule"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "CommissionReceiptLedgerLine"
  ADD CONSTRAINT "CommissionReceiptLedgerLine_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
