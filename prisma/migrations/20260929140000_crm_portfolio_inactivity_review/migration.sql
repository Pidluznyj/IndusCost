-- POL-COM-001 §11: revisão de carteira por 90 dias sem PV aprovado.
-- Aditivo: não altera SalesOrder, comissão nem responsável histórico além dos campos novos.

ALTER TABLE "CrmCustomerCommercialOwner"
  ADD COLUMN "blockAutoAssignUntilManual" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "endedAt" TIMESTAMP(6),
  ADD COLUMN "endReason" TEXT;

CREATE INDEX "CrmCustomerCommercialOwner_blockAutoAssignUntilManual_idx"
  ON "CrmCustomerCommercialOwner"("blockAutoAssignUntilManual");

CREATE TABLE "CrmCustomerPortfolioReview" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" TEXT NOT NULL,
  "customerId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "previousOwnerIdentityKey" TEXT,
  "previousOwnerName" TEXT,
  "ownerStartedAt" TIMESTAMP(6),
  "ownerEndedAt" TIMESTAMP(6),
  "lastApprovedSalesOrderId" UUID,
  "lastApprovedSalesOrderCode" TEXT,
  "lastApprovedIssueDate" TIMESTAMP(6),
  "daysSinceLastApprovedOrder" INTEGER,
  "crmValid" BOOLEAN NOT NULL DEFAULT false,
  "evidenceType" TEXT,
  "evidenceId" TEXT,
  "evidenceDate" TIMESTAMP(6),
  "nextReviewDate" TIMESTAMP(6),
  "payload" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CrmCustomerPortfolioReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrmCustomerPortfolioReview_runId_idx" ON "CrmCustomerPortfolioReview"("runId");
CREATE INDEX "CrmCustomerPortfolioReview_customerId_createdAt_idx" ON "CrmCustomerPortfolioReview"("customerId", "createdAt");
CREATE INDEX "CrmCustomerPortfolioReview_action_idx" ON "CrmCustomerPortfolioReview"("action");
CREATE INDEX "CrmCustomerPortfolioReview_reasonCode_idx" ON "CrmCustomerPortfolioReview"("reasonCode");

ALTER TABLE "CrmCustomerPortfolioReview"
  ADD CONSTRAINT "CrmCustomerPortfolioReview_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
