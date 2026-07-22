-- OP-16 — Rodadas de negociação imutáveis + campos de ganho comparável (aditivo).
-- Sem DROP/RENAME. Não adjudica vencedor nem cria PO/AP.

ALTER TABLE "PurchaseNegotiationRound" ADD COLUMN IF NOT EXISTS "buyerReport" TEXT;
ALTER TABLE "PurchaseNegotiationRound" ADD COLUMN IF NOT EXISTS "responsibleUserName" TEXT;

ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "nonRecoverableTaxes" DECIMAL(20, 6);
ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "expenses" DECIMAL(20, 6);
ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "discounts" DECIMAL(20, 6);
ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "minOrderQty" DECIMAL(20, 6);
ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "freightIncoterm" TEXT;

ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "previousUnitPrice" DECIMAL(20, 6);
ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "previousQuantity" DECIMAL(20, 6);
ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "previousLeadTimeDays" INTEGER;
ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "previousFreightValue" DECIMAL(20, 6);
ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "previousNonRecoverableTaxes" DECIMAL(20, 6);
ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "previousExpenses" DECIMAL(20, 6);
ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "previousDiscounts" DECIMAL(20, 6);
ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "previousMinOrderQty" DECIMAL(20, 6);
ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "previousPaymentTerms" TEXT;
ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "previousDeliveryTerms" TEXT;
ALTER TABLE "PurchaseNegotiationRoundLine" ADD COLUMN IF NOT EXISTS "previousFreightIncoterm" TEXT;
