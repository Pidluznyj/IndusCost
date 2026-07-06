-- Módulo Comissões: base de dados aditiva e isolada.
-- Referências Nomus via IDs externos (sem FK para stage tables existentes).

CREATE TYPE "CommissionPersonType" AS ENUM (
  'SELLER',
  'REPRESENTATIVE',
  'MANAGER',
  'OTHER'
);

CREATE TYPE "CommissionPersonSource" AS ENUM (
  'NOMUS',
  'MANUAL'
);

CREATE TYPE "CommissionRuleBeneficiaryType" AS ENUM (
  'SELLER',
  'REPRESENTATIVE',
  'FIXED_PERSON'
);

CREATE TYPE "CommissionRuleBaseType" AS ENUM (
  'SALES_ORDER_ITEM_NET',
  'OUTPUT_DOCUMENT_ITEM_NET',
  'RECEIVABLE_AMOUNT'
);

CREATE TYPE "CommissionReleaseRule" AS ENUM (
  'SALES_ORDER_CREATED',
  'OUTPUT_DOCUMENT_CREATED',
  'FIRST_RECEIVABLE_PAID',
  'EACH_RECEIVABLE_PAID'
);

CREATE TYPE "CommissionCalculationRunMode" AS ENUM (
  'FORECAST',
  'CONFIRMATION',
  'RELEASE',
  'FULL_RECALC'
);

CREATE TYPE "CommissionCalculationRunStatus" AS ENUM (
  'RUNNING',
  'SUCCESS',
  'FAILED'
);

CREATE TYPE "CommissionRecordSource" AS ENUM (
  'INDUSCOST_CALCULATED'
);

CREATE TYPE "CommissionRecordOriginStage" AS ENUM (
  'SALES_ORDER',
  'OUTPUT_DOCUMENT'
);

CREATE TYPE "CommissionRecordStatus" AS ENUM (
  'FORECAST_FROM_ORDER',
  'WAITING_NFE',
  'SUPERSEDED_BY_OUTPUT_DOCUMENT',
  'CONFIRMED_BY_OUTPUT_DOCUMENT',
  'WAITING_RECEIVABLE',
  'WAITING_PAYMENT',
  'PARTIALLY_RELEASED',
  'RELEASED',
  'PAID_PARTIAL',
  'PAID_TOTAL',
  'CANCELLED',
  'REVERSED',
  'ERROR'
);

CREATE TYPE "CommissionPaymentScheduleSource" AS ENUM (
  'SALES_ORDER_INSTALLMENT',
  'ACCOUNTS_RECEIVABLE'
);

CREATE TYPE "CommissionPaymentScheduleStatus" AS ENUM (
  'FORECAST',
  'ACTIVE',
  'SUPERSEDED',
  'PAID',
  'PARTIALLY_PAID',
  'CANCELLED',
  'REVIEW'
);

CREATE TYPE "CommissionPaymentBatchStatus" AS ENUM (
  'DRAFT',
  'APPROVED',
  'PAID',
  'CANCELLED'
);

CREATE TYPE "CommissionPaymentBatchItemStatus" AS ENUM (
  'DRAFT',
  'APPROVED',
  'PAID',
  'CANCELLED'
);

CREATE TYPE "CommissionAuditIssueSeverity" AS ENUM (
  'INFO',
  'WARNING',
  'CRITICAL'
);

CREATE TYPE "CommissionAuditIssueType" AS ENUM (
  'ORDER_WITHOUT_SELLER',
  'ORDER_WITHOUT_REPRESENTATIVE',
  'NO_COMMISSION_RULE',
  'ORDER_WITHOUT_NFE',
  'NFE_WITHOUT_OUTPUT_DOCUMENT',
  'NFE_WITHOUT_RECEIVABLE',
  'OUTPUT_DOCUMENT_WITHOUT_ORDER_MATCH',
  'RECEIVABLE_WITHOUT_NFE',
  'CANCELLED_NFE_WITH_ACTIVE_COMMISSION',
  'RECEIVED_WITHOUT_RELEASE',
  'PAID_WITHOUT_RELEASE',
  'DIVERGENT_AMOUNT',
  'MANUAL_REVIEW_REQUIRED'
);

CREATE TABLE "CommissionPerson" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nomusPersonId" INTEGER,
  "name" TEXT NOT NULL,
  "type" "CommissionPersonType" NOT NULL,
  "source" "CommissionPersonSource" NOT NULL DEFAULT 'MANUAL',
  "email" TEXT,
  "document" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "CommissionPerson_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionRule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "beneficiaryType" "CommissionRuleBeneficiaryType" NOT NULL,
  "fixedCommissionPersonId" UUID,
  "ratePercent" DECIMAL(10, 4) NOT NULL,
  "baseType" "CommissionRuleBaseType" NOT NULL,
  "releaseRule" "CommissionReleaseRule" NOT NULL,
  "validFrom" TIMESTAMPTZ(6),
  "validTo" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionRuleCondition" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ruleId" UUID NOT NULL,
  "companyExternalId" INTEGER,
  "customerExternalId" INTEGER,
  "customerUf" TEXT,
  "nomusSellerId" INTEGER,
  "nomusRepresentativeId" INTEGER,
  "productExternalId" INTEGER,
  "productGroupExternalId" INTEGER,
  "priceTableExternalId" INTEGER,
  "paymentConditionExternalId" INTEGER,
  "movementTypeExternalId" INTEGER,
  "minOrderAmount" DECIMAL(20, 2),
  "maxOrderAmount" DECIMAL(20, 2),
  "minDiscountPercent" DECIMAL(10, 4),
  "maxDiscountPercent" DECIMAL(10, 4),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "CommissionRuleCondition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionCalculationRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "periodStart" TIMESTAMPTZ(6) NOT NULL,
  "periodEnd" TIMESTAMPTZ(6) NOT NULL,
  "mode" "CommissionCalculationRunMode" NOT NULL,
  "status" "CommissionCalculationRunStatus" NOT NULL DEFAULT 'RUNNING',
  "ordersEvaluated" INTEGER NOT NULL DEFAULT 0,
  "nfeEvaluated" INTEGER NOT NULL DEFAULT 0,
  "outputDocumentsEvaluated" INTEGER NOT NULL DEFAULT 0,
  "receivablesEvaluated" INTEGER NOT NULL DEFAULT 0,
  "commissionsCreated" INTEGER NOT NULL DEFAULT 0,
  "commissionsUpdated" INTEGER NOT NULL DEFAULT 0,
  "commissionsSuperseded" INTEGER NOT NULL DEFAULT 0,
  "errorsCount" INTEGER NOT NULL DEFAULT 0,
  "summaryJson" JSONB,
  "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "CommissionCalculationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionRecord" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "calculationRunId" UUID,
  "source" "CommissionRecordSource" NOT NULL DEFAULT 'INDUSCOST_CALCULATED',
  "originStage" "CommissionRecordOriginStage" NOT NULL,
  "status" "CommissionRecordStatus" NOT NULL,
  "nomusOrderId" INTEGER,
  "orderCode" TEXT,
  "nomusOrderItemId" INTEGER,
  "nomusProductId" INTEGER,
  "productCode" TEXT,
  "productName" TEXT,
  "nomusNfeId" INTEGER,
  "nfeNumber" TEXT,
  "nomusOutputDocumentId" INTEGER,
  "nomusOutputDocumentItemId" INTEGER,
  "commissionPersonId" UUID NOT NULL,
  "nomusSellerId" INTEGER,
  "nomusRepresentativeId" INTEGER,
  "customerExternalId" INTEGER,
  "customerName" TEXT,
  "companyExternalId" INTEGER,
  "baseAmount" DECIMAL(20, 2) NOT NULL,
  "ratePercent" DECIMAL(10, 4) NOT NULL,
  "commissionAmount" DECIMAL(20, 2) NOT NULL,
  "releasedAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "paidAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "balanceAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "releaseRule" "CommissionReleaseRule" NOT NULL,
  "calculationHash" TEXT NOT NULL,
  "metadataJson" JSONB,
  "calculatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMPTZ(6),
  "releasedAt" TIMESTAMPTZ(6),
  "paidAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "CommissionRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionPaymentSchedule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "commissionRecordId" UUID NOT NULL,
  "source" "CommissionPaymentScheduleSource" NOT NULL,
  "status" "CommissionPaymentScheduleStatus" NOT NULL DEFAULT 'FORECAST',
  "nomusOrderId" INTEGER,
  "nomusNfeId" INTEGER,
  "nomusReceivableId" INTEGER,
  "installmentNumber" INTEGER,
  "dueDate" TIMESTAMPTZ(6),
  "expectedAmount" DECIMAL(20, 2),
  "receivableAmount" DECIMAL(20, 2),
  "receivedAmount" DECIMAL(20, 2),
  "openBalance" DECIMAL(20, 2),
  "allocationPercent" DECIMAL(10, 4),
  "commissionExpectedAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "commissionReleasedAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "CommissionPaymentSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionPaymentBatch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "periodStart" TIMESTAMPTZ(6) NOT NULL,
  "periodEnd" TIMESTAMPTZ(6) NOT NULL,
  "commissionPersonId" UUID NOT NULL,
  "status" "CommissionPaymentBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "totalReleased" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "totalSelected" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "totalPaid" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "paymentDate" TIMESTAMPTZ(6),
  "notes" TEXT,
  "createdBy" TEXT,
  "approvedBy" TEXT,
  "paidBy" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "CommissionPaymentBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionPaymentBatchItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batchId" UUID NOT NULL,
  "commissionRecordId" UUID NOT NULL,
  "commissionPaymentScheduleId" UUID,
  "amountToPay" DECIMAL(20, 2) NOT NULL,
  "amountPaid" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "status" "CommissionPaymentBatchItemStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "CommissionPaymentBatchItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionAuditIssue" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "severity" "CommissionAuditIssueSeverity" NOT NULL,
  "type" "CommissionAuditIssueType" NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "message" TEXT NOT NULL,
  "metadataJson" JSONB,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "resolvedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "CommissionAuditIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionSettings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "valueJson" JSONB NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "CommissionSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommissionRecord_calculationHash_key" ON "CommissionRecord"("calculationHash");
CREATE UNIQUE INDEX "CommissionSettings_key_key" ON "CommissionSettings"("key");

CREATE INDEX "CommissionPerson_nomusPersonId_idx" ON "CommissionPerson"("nomusPersonId");
CREATE INDEX "CommissionPerson_type_idx" ON "CommissionPerson"("type");
CREATE INDEX "CommissionPerson_active_idx" ON "CommissionPerson"("active");
CREATE INDEX "CommissionPerson_name_idx" ON "CommissionPerson"("name");

CREATE INDEX "CommissionRule_active_idx" ON "CommissionRule"("active");
CREATE INDEX "CommissionRule_priority_idx" ON "CommissionRule"("priority");
CREATE INDEX "CommissionRule_beneficiaryType_idx" ON "CommissionRule"("beneficiaryType");
CREATE INDEX "CommissionRule_validFrom_validTo_idx" ON "CommissionRule"("validFrom", "validTo");

CREATE INDEX "CommissionRuleCondition_ruleId_idx" ON "CommissionRuleCondition"("ruleId");
CREATE INDEX "CommissionRuleCondition_nomusSellerId_idx" ON "CommissionRuleCondition"("nomusSellerId");
CREATE INDEX "CommissionRuleCondition_customerExternalId_idx" ON "CommissionRuleCondition"("customerExternalId");
CREATE INDEX "CommissionRuleCondition_productExternalId_idx" ON "CommissionRuleCondition"("productExternalId");

CREATE INDEX "CommissionCalculationRun_status_idx" ON "CommissionCalculationRun"("status");
CREATE INDEX "CommissionCalculationRun_mode_idx" ON "CommissionCalculationRun"("mode");
CREATE INDEX "CommissionCalculationRun_periodStart_periodEnd_idx" ON "CommissionCalculationRun"("periodStart", "periodEnd");
CREATE INDEX "CommissionCalculationRun_startedAt_idx" ON "CommissionCalculationRun"("startedAt");

CREATE INDEX "CommissionRecord_orderCode_idx" ON "CommissionRecord"("orderCode");
CREATE INDEX "CommissionRecord_nomusOrderId_idx" ON "CommissionRecord"("nomusOrderId");
CREATE INDEX "CommissionRecord_nomusNfeId_idx" ON "CommissionRecord"("nomusNfeId");
CREATE INDEX "CommissionRecord_commissionPersonId_idx" ON "CommissionRecord"("commissionPersonId");
CREATE INDEX "CommissionRecord_status_idx" ON "CommissionRecord"("status");
CREATE INDEX "CommissionRecord_originStage_idx" ON "CommissionRecord"("originStage");
CREATE INDEX "CommissionRecord_calculatedAt_idx" ON "CommissionRecord"("calculatedAt");
CREATE INDEX "CommissionRecord_nomusSellerId_idx" ON "CommissionRecord"("nomusSellerId");
CREATE INDEX "CommissionRecord_customerExternalId_idx" ON "CommissionRecord"("customerExternalId");

CREATE INDEX "CommissionPaymentSchedule_commissionRecordId_idx" ON "CommissionPaymentSchedule"("commissionRecordId");
CREATE INDEX "CommissionPaymentSchedule_nomusReceivableId_idx" ON "CommissionPaymentSchedule"("nomusReceivableId");
CREATE INDEX "CommissionPaymentSchedule_nomusNfeId_idx" ON "CommissionPaymentSchedule"("nomusNfeId");
CREATE INDEX "CommissionPaymentSchedule_status_idx" ON "CommissionPaymentSchedule"("status");
CREATE INDEX "CommissionPaymentSchedule_dueDate_idx" ON "CommissionPaymentSchedule"("dueDate");

CREATE INDEX "CommissionPaymentBatch_commissionPersonId_idx" ON "CommissionPaymentBatch"("commissionPersonId");
CREATE INDEX "CommissionPaymentBatch_status_idx" ON "CommissionPaymentBatch"("status");
CREATE INDEX "CommissionPaymentBatch_periodStart_periodEnd_idx" ON "CommissionPaymentBatch"("periodStart", "periodEnd");
CREATE INDEX "CommissionPaymentBatch_paymentDate_idx" ON "CommissionPaymentBatch"("paymentDate");

CREATE INDEX "CommissionPaymentBatchItem_batchId_idx" ON "CommissionPaymentBatchItem"("batchId");
CREATE INDEX "CommissionPaymentBatchItem_commissionRecordId_idx" ON "CommissionPaymentBatchItem"("commissionRecordId");
CREATE INDEX "CommissionPaymentBatchItem_commissionPaymentScheduleId_idx" ON "CommissionPaymentBatchItem"("commissionPaymentScheduleId");
CREATE INDEX "CommissionPaymentBatchItem_status_idx" ON "CommissionPaymentBatchItem"("status");

CREATE INDEX "CommissionAuditIssue_resolved_idx" ON "CommissionAuditIssue"("resolved");
CREATE INDEX "CommissionAuditIssue_severity_idx" ON "CommissionAuditIssue"("severity");
CREATE INDEX "CommissionAuditIssue_type_idx" ON "CommissionAuditIssue"("type");
CREATE INDEX "CommissionAuditIssue_entityType_entityId_idx" ON "CommissionAuditIssue"("entityType", "entityId");
CREATE INDEX "CommissionAuditIssue_createdAt_idx" ON "CommissionAuditIssue"("createdAt");

ALTER TABLE "CommissionRule"
  ADD CONSTRAINT "CommissionRule_fixedCommissionPersonId_fkey"
  FOREIGN KEY ("fixedCommissionPersonId") REFERENCES "CommissionPerson"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "CommissionRuleCondition"
  ADD CONSTRAINT "CommissionRuleCondition_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "CommissionRule"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "CommissionRecord"
  ADD CONSTRAINT "CommissionRecord_calculationRunId_fkey"
  FOREIGN KEY ("calculationRunId") REFERENCES "CommissionCalculationRun"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "CommissionRecord"
  ADD CONSTRAINT "CommissionRecord_commissionPersonId_fkey"
  FOREIGN KEY ("commissionPersonId") REFERENCES "CommissionPerson"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "CommissionPaymentSchedule"
  ADD CONSTRAINT "CommissionPaymentSchedule_commissionRecordId_fkey"
  FOREIGN KEY ("commissionRecordId") REFERENCES "CommissionRecord"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "CommissionPaymentBatch"
  ADD CONSTRAINT "CommissionPaymentBatch_commissionPersonId_fkey"
  FOREIGN KEY ("commissionPersonId") REFERENCES "CommissionPerson"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "CommissionPaymentBatchItem"
  ADD CONSTRAINT "CommissionPaymentBatchItem_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "CommissionPaymentBatch"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "CommissionPaymentBatchItem"
  ADD CONSTRAINT "CommissionPaymentBatchItem_commissionRecordId_fkey"
  FOREIGN KEY ("commissionRecordId") REFERENCES "CommissionRecord"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "CommissionPaymentBatchItem"
  ADD CONSTRAINT "CommissionPaymentBatchItem_commissionPaymentScheduleId_fkey"
  FOREIGN KEY ("commissionPaymentScheduleId") REFERENCES "CommissionPaymentSchedule"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

-- Configurações iniciais padrão (idempotente).
INSERT INTO "CommissionSettings" ("id", "key", "valueJson", "description", "updatedAt") VALUES
(
  gen_random_uuid(),
  'release.default_rule',
  '"EACH_RECEIVABLE_PAID"'::jsonb,
  'Regra padrão de liberação de comissão por recebimento',
  CURRENT_TIMESTAMP
),
(
  gen_random_uuid(),
  'forecast.enabled',
  'true'::jsonb,
  'Cálculo previsto por Pedido de Venda ativo',
  CURRENT_TIMESTAMP
),
(
  gen_random_uuid(),
  'output_document.supersedes_forecast',
  'true'::jsonb,
  'Substituição da previsão do pedido pelo Documento de Saída/NF-e',
  CURRENT_TIMESTAMP
),
(
  gen_random_uuid(),
  'paid_commission.block_auto_change',
  'true'::jsonb,
  'Bloquear alteração automática de comissão já paga',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
