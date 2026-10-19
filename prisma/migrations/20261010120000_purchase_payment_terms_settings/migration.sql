-- Compras: meta gerencial de PMP (prazo médio ponderado desde a emissão do pedido) + histórico.
-- Aditivo. Sem meta configurada (linha ausente ou targetPmpDays NULL) os indicadores funcionam
-- sem classificar atendimento. Não altera pedidos, vencimentos nem Contas a Pagar.

-- CreateTable
CREATE TABLE "PurchasePaymentTermsSettings" (
    "id" TEXT NOT NULL DEFAULT 'GLOBAL',
    "targetPmpDays" INTEGER,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByUserId" UUID,
    "updatedByUserName" TEXT,
    CONSTRAINT "PurchasePaymentTermsSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchasePaymentTermsSettingsHistory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "previousTargetDays" INTEGER,
    "targetDays" INTEGER,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByUserId" UUID,
    "changedByUserName" TEXT NOT NULL,
    CONSTRAINT "PurchasePaymentTermsSettingsHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchasePaymentTermsSettingsHistory_changedAt_idx" ON "PurchasePaymentTermsSettingsHistory"("changedAt");

-- Singleton e faixa válida da meta (0 a 365 dias).
ALTER TABLE "PurchasePaymentTermsSettings"
  ADD CONSTRAINT "PurchasePaymentTermsSettings_singleton_check" CHECK ("id" = 'GLOBAL'),
  ADD CONSTRAINT "PurchasePaymentTermsSettings_target_check" CHECK ("targetPmpDays" IS NULL OR ("targetPmpDays" >= 0 AND "targetPmpDays" <= 365));
ALTER TABLE "PurchasePaymentTermsSettingsHistory"
  ADD CONSTRAINT "PurchasePaymentTermsSettingsHistory_target_check" CHECK ("targetDays" IS NULL OR ("targetDays" >= 0 AND "targetDays" <= 365));
