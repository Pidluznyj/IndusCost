-- Avaliação do Pedido de Compra Nomus (OP-26 extensão).
--
-- Migration ADITIVA.
-- Identidade determinística: NomusPurchaseOrder.id.
-- Não migra avaliações de PurchaseOrder interno.
-- FinancialSupplier não recebe coluna de nota.

CREATE TABLE "NomusPurchaseOrderSupplierEvaluation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nomusPurchaseOrderId" TEXT NOT NULL,
    "financialSupplierId" UUID,
    "supplierMatchMethod" TEXT NOT NULL,
    "supplierMatchConfidence" TEXT NOT NULL,
    "qualityScore" DECIMAL(4,2) NOT NULL,
    "deliveryScore" DECIMAL(4,2) NOT NULL,
    "conformityScore" DECIMAL(4,2) NOT NULL,
    "serviceScore" DECIMAL(4,2) NOT NULL,
    "overallScore" DECIMAL(4,2) NOT NULL,
    "methodologyVersion" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "createdByUserName" TEXT,
    "updatedByUserId" TEXT,
    "updatedByUserName" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NomusPurchaseOrderSupplierEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NomusPurchaseOrderSupplierEvaluation_nomusPurchaseOrderId_key"
  ON "NomusPurchaseOrderSupplierEvaluation"("nomusPurchaseOrderId");

CREATE INDEX "NomusPurchaseOrderSupplierEvaluation_financialSupplierId_idx"
  ON "NomusPurchaseOrderSupplierEvaluation"("financialSupplierId");

CREATE INDEX "NomusPurchaseOrderSupplierEvaluation_createdAt_idx"
  ON "NomusPurchaseOrderSupplierEvaluation"("createdAt");

ALTER TABLE "NomusPurchaseOrderSupplierEvaluation"
  ADD CONSTRAINT "NomusPurchaseOrderSupplierEvaluation_nomusPurchaseOrderId_fkey"
  FOREIGN KEY ("nomusPurchaseOrderId") REFERENCES "NomusPurchaseOrder"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "NomusPurchaseOrderSupplierEvaluation"
  ADD CONSTRAINT "NomusPurchaseOrderSupplierEvaluation_financialSupplierId_fkey"
  FOREIGN KEY ("financialSupplierId") REFERENCES "FinancialSupplier"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "NomusPurchaseOrderSupplierEvaluationHistory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "evaluationId" UUID NOT NULL,
    "nomusPurchaseOrderId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "reason" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NomusPurchaseOrderSupplierEvaluationHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NomusPurchaseOrderSupplierEvaluationHistory_evaluationId_createdAt_idx"
  ON "NomusPurchaseOrderSupplierEvaluationHistory"("evaluationId", "createdAt");

CREATE INDEX "NomusPurchaseOrderSupplierEvaluationHistory_nomusPurchaseOrderId_idx"
  ON "NomusPurchaseOrderSupplierEvaluationHistory"("nomusPurchaseOrderId");

CREATE INDEX "NomusPurchaseOrderSupplierEvaluationHistory_action_idx"
  ON "NomusPurchaseOrderSupplierEvaluationHistory"("action");

ALTER TABLE "NomusPurchaseOrderSupplierEvaluationHistory"
  ADD CONSTRAINT "NomusPurchaseOrderSupplierEvaluationHistory_evaluationId_fkey"
  FOREIGN KEY ("evaluationId") REFERENCES "NomusPurchaseOrderSupplierEvaluation"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
