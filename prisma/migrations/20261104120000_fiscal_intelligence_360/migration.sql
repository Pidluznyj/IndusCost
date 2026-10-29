-- Inteligência Fiscal 360° — migration ADITIVA (nenhuma coluna/tabela existente alterada ou removida).
-- 15 tabelas derivadas Fiscal* + índices updatedAt em tabelas de origem (descoberta incremental).
-- Nada é populado aqui: o backfill é manual e controlado (scripts/fiscal360Process.ts --backfill).
-- Índices em tabelas existentes: CREATE INDEX comum (lock de escrita breve durante a criação).

-- CreateTable
CREATE TABLE "FiscalDocumentFact" (
    "id" TEXT NOT NULL,
    "documentKind" TEXT NOT NULL DEFAULT 'NFE',
    "nomusNfeId" TEXT NOT NULL,
    "nomusExternalId" INTEGER NOT NULL,
    "chave" TEXT,
    "numero" TEXT,
    "serie" TEXT,
    "companyCnpj" TEXT NOT NULL,
    "issuerCnpj" TEXT,
    "recipientCnpj" TEXT,
    "recipientGroupCnpj" TEXT,
    "issueDate" DATE,
    "competenceMonth" TEXT NOT NULL,
    "natOp" TEXT,
    "tpNF" INTEGER,
    "finalidade" INTEGER,
    "nomusStatus" INTEGER,
    "fiscalStatus" TEXT NOT NULL,
    "operationClass" TEXT NOT NULL,
    "billingClassification" TEXT,
    "isMarketSale" BOOLEAN NOT NULL DEFAULT false,
    "isOfficialBilling" BOOLEAN NOT NULL DEFAULT false,
    "officialRevenueAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "valorLiquido" DECIMAL(20,2),
    "vProd" DECIMAL(20,2),
    "vDesc" DECIMAL(20,2),
    "vNF" DECIMAL(20,2),
    "highlightedTaxTotal" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "xmlStatus" TEXT NOT NULL,
    "parserVersion" TEXT,
    "qualityFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceHash" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "materializedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalDocumentFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalDocumentTaxFact" (
    "id" TEXT NOT NULL,
    "documentFactId" TEXT NOT NULL,
    "nomusNfeId" TEXT NOT NULL,
    "companyCnpj" TEXT NOT NULL,
    "competenceMonth" TEXT NOT NULL,
    "taxType" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "baseAmount" DECIMAL(20,2),
    "amount" DECIMAL(20,2) NOT NULL,
    "fiscalStatus" TEXT NOT NULL,
    "operationClass" TEXT NOT NULL,
    "sourcePath" TEXT,

    CONSTRAINT "FiscalDocumentTaxFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalApTitleFact" (
    "id" TEXT NOT NULL,
    "apExternalId" INTEGER NOT NULL,
    "apId" TEXT NOT NULL,
    "companyCnpj" TEXT NOT NULL,
    "companyName" TEXT,
    "personName" TEXT,
    "personCnpj" TEXT,
    "description" TEXT,
    "nomusClassification" TEXT,
    "documentNumber" TEXT,
    "dueDate" DATE,
    "competenceDate" DATE,
    "competenceMonth" TEXT NOT NULL,
    "amountOriginal" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "effectiveStatus" TEXT NOT NULL,
    "apPaymentDate" DATE,
    "treasuryPaidDate" DATE,
    "treasuryMatchedAmount" DECIMAL(20,2),
    "treasuryMatchCount" INTEGER NOT NULL DEFAULT 0,
    "classificationStatus" TEXT NOT NULL,
    "taxType" TEXT,
    "suggestedTaxType" TEXT,
    "revenueCode" TEXT,
    "classificationConfidence" TEXT NOT NULL,
    "classificationRule" TEXT,
    "classificationEvidence" JSONB,
    "classifierVersion" TEXT NOT NULL,
    "manualDecisionId" TEXT,
    "claimedByGuideId" TEXT,
    "isIntercompany" BOOLEAN NOT NULL DEFAULT false,
    "intercompanyCounterpartyCnpj" TEXT,
    "sourceHash" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "materializedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalApTitleFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalPaymentFact" (
    "id" TEXT NOT NULL,
    "anchorKey" TEXT NOT NULL,
    "anchorType" TEXT NOT NULL,
    "guideId" TEXT,
    "apExternalId" INTEGER,
    "companyCnpj" TEXT NOT NULL,
    "companyResolution" TEXT NOT NULL,
    "taxType" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "revenueCode" TEXT,
    "guideType" TEXT,
    "guideNumber" TEXT,
    "competenceMonth" TEXT NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "dueDate" DATE,
    "amountOriginal" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "creditsAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "compensationsAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "interestAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "fineAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "amountDue" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "openBalance" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "paidAt" DATE,
    "paidAtSource" TEXT,
    "paidMonth" TEXT,
    "paymentAccount" TEXT,
    "proofCount" INTEGER NOT NULL DEFAULT 0,
    "hasBankMatch" BOOLEAN NOT NULL DEFAULT false,
    "linkState" TEXT NOT NULL,
    "apLinkSource" TEXT NOT NULL,
    "paidSource" TEXT NOT NULL,
    "evidenceLevel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "countsInPaidTotals" BOOLEAN NOT NULL DEFAULT true,
    "reviewReason" TEXT,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceHash" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "materializedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalPaymentFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalReconciliationItem" (
    "id" TEXT NOT NULL,
    "companyCnpj" TEXT NOT NULL,
    "competenceMonth" TEXT NOT NULL,
    "taxType" TEXT,
    "checkType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "expectedAmount" DECIMAL(20,2),
    "actualAmount" DECIMAL(20,2),
    "difference" DECIMAL(20,2),
    "message" TEXT NOT NULL,
    "details" JSONB,
    "itemKey" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalReconciliationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalReconciliationDecision" (
    "id" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL,
    "apExternalId" INTEGER,
    "guideId" TEXT,
    "itemKey" TEXT,
    "payload" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedByName" TEXT,
    "revokeReason" TEXT,

    CONSTRAINT "FiscalReconciliationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalMonthlySnapshot" (
    "id" TEXT NOT NULL,
    "companyCnpj" TEXT NOT NULL,
    "competenceMonth" TEXT NOT NULL,
    "taxType" TEXT NOT NULL,
    "highlightedAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "highlightedMarketAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "highlightedIntercompanyAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "highlightedOtherAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "stAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "desoneratedAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "informativeAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "documentaryCreditAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "assessedAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "creditsAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "retentionAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "compensationAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "apurationAmountDue" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "apurationStatus" TEXT NOT NULL DEFAULT 'NONE',
    "obligationAmountDue" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "paidProvenAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "paidUnprovenAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "paidDeclaredAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "reviewAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "paidByCashDateAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "paidWithoutCashDateAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "openBalance" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "officialRevenue" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "intercompanyRevenue" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "documentaryMovement" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "officialDocumentCount" INTEGER NOT NULL DEFAULT 0,
    "cancelledDocumentCount" INTEGER NOT NULL DEFAULT 0,
    "missingXmlCount" INTEGER NOT NULL DEFAULT 0,
    "paymentFactCount" INTEGER NOT NULL DEFAULT 0,
    "pendingClassificationCount" INTEGER NOT NULL DEFAULT 0,
    "pendingClassificationAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "reconciliationOkCount" INTEGER NOT NULL DEFAULT 0,
    "reconciliationItemCount" INTEGER NOT NULL DEFAULT 0,
    "openIssueCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotVersion" INTEGER NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalMonthlySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalIntercompanySnapshot" (
    "id" TEXT NOT NULL,
    "issuerCnpj" TEXT NOT NULL,
    "recipientCnpj" TEXT NOT NULL,
    "competenceMonth" TEXT NOT NULL,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "documentValue" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "highlightedTaxAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "apTitleCount" INTEGER NOT NULL DEFAULT 0,
    "apAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "apPaidAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "apOpenAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "divergenceAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "snapshotVersion" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalIntercompanySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalForecastScenario" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "systemKey" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "assumptions" JSONB NOT NULL,
    "horizonMonths" INTEGER NOT NULL DEFAULT 6,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "methodologyVersion" TEXT NOT NULL,
    "inputVersion" TEXT,
    "computedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalForecastScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalForecastSnapshot" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "companyCnpj" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "taxType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "availability" TEXT NOT NULL,
    "unavailableReason" TEXT,
    "amount" DECIMAL(20,2),
    "lowAmount" DECIMAL(20,2),
    "highAmount" DECIMAL(20,2),
    "revenueBase" DECIMAL(20,2),
    "ratioUsed" DECIMAL(12,6),
    "cashMonth" TEXT,
    "methodology" TEXT NOT NULL,
    "details" JSONB,
    "forecastVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalProcessingJob" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "sourceEntity" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceHash" TEXT,
    "ruleVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leasedBy" TEXT,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "affectedPeriods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "auditMeta" JSONB,
    "requestedByUserId" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalProcessingCheckpoint" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "cursorUpdatedAt" TIMESTAMP(3),
    "cursorId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalProcessingCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalProcessingRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "discovered" JSONB,
    "jobsSucceeded" INTEGER NOT NULL DEFAULT 0,
    "jobsFailed" INTEGER NOT NULL DEFAULT 0,
    "documentsNew" INTEGER NOT NULL DEFAULT 0,
    "documentsChanged" INTEGER NOT NULL DEFAULT 0,
    "apTitlesChanged" INTEGER NOT NULL DEFAULT 0,
    "guidesChanged" INTEGER NOT NULL DEFAULT 0,
    "partitionsRebuilt" INTEGER NOT NULL DEFAULT 0,
    "monthsAffected" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ruleVersions" JSONB,
    "error" TEXT,

    CONSTRAINT "FiscalProcessingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalDataQualityIssue" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "companyCnpj" TEXT,
    "competenceMonth" TEXT,
    "taxType" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "firstDetectedAt" TIMESTAMP(3) NOT NULL,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "ruleVersion" TEXT NOT NULL,

    CONSTRAINT "FiscalDataQualityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalRuleVersion" (
    "id" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "normativeSource" TEXT,
    "description" TEXT,
    "parameters" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "FiscalRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocumentFact_nomusNfeId_key" ON "FiscalDocumentFact"("nomusNfeId");

-- CreateIndex
CREATE INDEX "FiscalDocumentFact_companyCnpj_competenceMonth_idx" ON "FiscalDocumentFact"("companyCnpj", "competenceMonth");

-- CreateIndex
CREATE INDEX "FiscalDocumentFact_competenceMonth_operationClass_idx" ON "FiscalDocumentFact"("competenceMonth", "operationClass");

-- CreateIndex
CREATE INDEX "FiscalDocumentFact_isOfficialBilling_competenceMonth_idx" ON "FiscalDocumentFact"("isOfficialBilling", "competenceMonth");

-- CreateIndex
CREATE INDEX "FiscalDocumentFact_recipientGroupCnpj_competenceMonth_idx" ON "FiscalDocumentFact"("recipientGroupCnpj", "competenceMonth");

-- CreateIndex
CREATE INDEX "FiscalDocumentFact_nomusExternalId_idx" ON "FiscalDocumentFact"("nomusExternalId");

-- CreateIndex
CREATE INDEX "FiscalDocumentFact_numero_idx" ON "FiscalDocumentFact"("numero");

-- CreateIndex
CREATE INDEX "FiscalDocumentTaxFact_companyCnpj_competenceMonth_taxType_idx" ON "FiscalDocumentTaxFact"("companyCnpj", "competenceMonth", "taxType");

-- CreateIndex
CREATE INDEX "FiscalDocumentTaxFact_nomusNfeId_idx" ON "FiscalDocumentTaxFact"("nomusNfeId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocumentTaxFact_documentFactId_taxType_key" ON "FiscalDocumentTaxFact"("documentFactId", "taxType");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalApTitleFact_apExternalId_key" ON "FiscalApTitleFact"("apExternalId");

-- CreateIndex
CREATE INDEX "FiscalApTitleFact_classificationStatus_competenceMonth_idx" ON "FiscalApTitleFact"("classificationStatus", "competenceMonth");

-- CreateIndex
CREATE INDEX "FiscalApTitleFact_companyCnpj_competenceMonth_idx" ON "FiscalApTitleFact"("companyCnpj", "competenceMonth");

-- CreateIndex
CREATE INDEX "FiscalApTitleFact_taxType_idx" ON "FiscalApTitleFact"("taxType");

-- CreateIndex
CREATE INDEX "FiscalApTitleFact_isIntercompany_intercompanyCounterpartyCn_idx" ON "FiscalApTitleFact"("isIntercompany", "intercompanyCounterpartyCnpj", "competenceMonth");

-- CreateIndex
CREATE INDEX "FiscalApTitleFact_claimedByGuideId_idx" ON "FiscalApTitleFact"("claimedByGuideId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalPaymentFact_anchorKey_key" ON "FiscalPaymentFact"("anchorKey");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalPaymentFact_guideId_key" ON "FiscalPaymentFact"("guideId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalPaymentFact_apExternalId_key" ON "FiscalPaymentFact"("apExternalId");

-- CreateIndex
CREATE INDEX "FiscalPaymentFact_companyCnpj_competenceMonth_idx" ON "FiscalPaymentFact"("companyCnpj", "competenceMonth");

-- CreateIndex
CREATE INDEX "FiscalPaymentFact_companyCnpj_paidMonth_idx" ON "FiscalPaymentFact"("companyCnpj", "paidMonth");

-- CreateIndex
CREATE INDEX "FiscalPaymentFact_status_idx" ON "FiscalPaymentFact"("status");

-- CreateIndex
CREATE INDEX "FiscalPaymentFact_taxType_competenceMonth_idx" ON "FiscalPaymentFact"("taxType", "competenceMonth");

-- CreateIndex
CREATE INDEX "FiscalPaymentFact_dueDate_idx" ON "FiscalPaymentFact"("dueDate");

-- CreateIndex
CREATE INDEX "FiscalReconciliationItem_companyCnpj_competenceMonth_idx" ON "FiscalReconciliationItem"("companyCnpj", "competenceMonth");

-- CreateIndex
CREATE INDEX "FiscalReconciliationItem_checkType_status_idx" ON "FiscalReconciliationItem"("checkType", "status");

-- CreateIndex
CREATE INDEX "FiscalReconciliationItem_subjectType_subjectId_idx" ON "FiscalReconciliationItem"("subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalReconciliationItem_itemKey_key" ON "FiscalReconciliationItem"("itemKey");

-- CreateIndex
CREATE INDEX "FiscalReconciliationDecision_apExternalId_active_idx" ON "FiscalReconciliationDecision"("apExternalId", "active");

-- CreateIndex
CREATE INDEX "FiscalReconciliationDecision_guideId_active_idx" ON "FiscalReconciliationDecision"("guideId", "active");

-- CreateIndex
CREATE INDEX "FiscalReconciliationDecision_itemKey_active_idx" ON "FiscalReconciliationDecision"("itemKey", "active");

-- CreateIndex
CREATE INDEX "FiscalReconciliationDecision_decisionType_active_idx" ON "FiscalReconciliationDecision"("decisionType", "active");

-- CreateIndex
CREATE INDEX "FiscalReconciliationDecision_createdAt_idx" ON "FiscalReconciliationDecision"("createdAt");

-- CreateIndex
CREATE INDEX "FiscalReconciliationDecision_revokedAt_idx" ON "FiscalReconciliationDecision"("revokedAt");

-- CreateIndex
CREATE INDEX "FiscalMonthlySnapshot_competenceMonth_taxType_idx" ON "FiscalMonthlySnapshot"("competenceMonth", "taxType");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalMonthlySnapshot_companyCnpj_competenceMonth_taxType_key" ON "FiscalMonthlySnapshot"("companyCnpj", "competenceMonth", "taxType");

-- CreateIndex
CREATE INDEX "FiscalIntercompanySnapshot_competenceMonth_idx" ON "FiscalIntercompanySnapshot"("competenceMonth");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalIntercompanySnapshot_issuerCnpj_recipientCnpj_compete_key" ON "FiscalIntercompanySnapshot"("issuerCnpj", "recipientCnpj", "competenceMonth");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalForecastScenario_systemKey_key" ON "FiscalForecastScenario"("systemKey");

-- CreateIndex
CREATE INDEX "FiscalForecastScenario_kind_status_idx" ON "FiscalForecastScenario"("kind", "status");

-- CreateIndex
CREATE INDEX "FiscalForecastSnapshot_scenarioId_month_idx" ON "FiscalForecastSnapshot"("scenarioId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalForecastSnapshot_scenarioId_companyCnpj_month_taxType_key" ON "FiscalForecastSnapshot"("scenarioId", "companyCnpj", "month", "taxType", "kind");

-- CreateIndex
CREATE INDEX "FiscalProcessingJob_status_priority_availableAt_idx" ON "FiscalProcessingJob"("status", "priority", "availableAt");

-- CreateIndex
CREATE INDEX "FiscalProcessingJob_jobType_status_idx" ON "FiscalProcessingJob"("jobType", "status");

-- CreateIndex
CREATE INDEX "FiscalProcessingJob_sourceEntity_sourceId_idx" ON "FiscalProcessingJob"("sourceEntity", "sourceId");

-- CreateIndex
CREATE INDEX "FiscalProcessingJob_dedupeKey_idx" ON "FiscalProcessingJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "FiscalProcessingJob_createdAt_idx" ON "FiscalProcessingJob"("createdAt");

-- CreateIndex
CREATE INDEX "FiscalProcessingJob_runId_idx" ON "FiscalProcessingJob"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalProcessingCheckpoint_key_key" ON "FiscalProcessingCheckpoint"("key");

-- CreateIndex
CREATE INDEX "FiscalProcessingRun_startedAt_idx" ON "FiscalProcessingRun"("startedAt");

-- CreateIndex
CREATE INDEX "FiscalProcessingRun_status_idx" ON "FiscalProcessingRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDataQualityIssue_dedupeKey_key" ON "FiscalDataQualityIssue"("dedupeKey");

-- CreateIndex
CREATE INDEX "FiscalDataQualityIssue_status_issueType_idx" ON "FiscalDataQualityIssue"("status", "issueType");

-- CreateIndex
CREATE INDEX "FiscalDataQualityIssue_scopeKey_status_idx" ON "FiscalDataQualityIssue"("scopeKey", "status");

-- CreateIndex
CREATE INDEX "FiscalDataQualityIssue_companyCnpj_competenceMonth_idx" ON "FiscalDataQualityIssue"("companyCnpj", "competenceMonth");

-- CreateIndex
CREATE INDEX "FiscalRuleVersion_ruleKey_status_idx" ON "FiscalRuleVersion"("ruleKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalRuleVersion_ruleKey_version_key" ON "FiscalRuleVersion"("ruleKey", "version");

-- CreateIndex
CREATE INDEX "NomusAccountsPayable_updatedAt_idx" ON "NomusAccountsPayable"("updatedAt");

-- CreateIndex
CREATE INDEX "NomusNfe_updatedAt_idx" ON "NomusNfe"("updatedAt");

-- CreateIndex
CREATE INDEX "NomusNfeFiscalSummary_updatedAt_idx" ON "NomusNfeFiscalSummary"("updatedAt");

-- CreateIndex
CREATE INDEX "FiscalApurationPeriod_updatedAt_idx" ON "FiscalApurationPeriod"("updatedAt");

-- CreateIndex
CREATE INDEX "FiscalApurationLine_updatedAt_idx" ON "FiscalApurationLine"("updatedAt");

-- CreateIndex
CREATE INDEX "FiscalPaymentGuide_updatedAt_idx" ON "FiscalPaymentGuide"("updatedAt");

-- CreateIndex
CREATE INDEX "FiscalPaymentProof_uploadedAt_idx" ON "FiscalPaymentProof"("uploadedAt");

-- AddForeignKey
ALTER TABLE "FiscalDocumentTaxFact" ADD CONSTRAINT "FiscalDocumentTaxFact_documentFactId_fkey" FOREIGN KEY ("documentFactId") REFERENCES "FiscalDocumentFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalForecastSnapshot" ADD CONSTRAINT "FiscalForecastSnapshot_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "FiscalForecastScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Índice único PARCIAL (Prisma não expressa): no máximo um job PENDING por dedupeKey.
-- Garante idempotência do enfileiramento sob concorrência (INSERT ... ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX "FiscalProcessingJob_pending_dedupe_key" ON "FiscalProcessingJob"("dedupeKey") WHERE "status" = 'PENDING';
