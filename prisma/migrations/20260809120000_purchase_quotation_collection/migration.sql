-- OP-15 — Coleta de cotações por fornecedor (aditivo).
-- Sem DROP/RENAME. Não adjudica vencedor nem cria PO/AP.

ALTER TABLE "PurchaseQuotationOffer" ADD COLUMN IF NOT EXISTS "initialNonRecoverableTaxes" DECIMAL(20, 6);
ALTER TABLE "PurchaseQuotationOffer" ADD COLUMN IF NOT EXISTS "initialExpenses" DECIMAL(20, 6);
ALTER TABLE "PurchaseQuotationOffer" ADD COLUMN IF NOT EXISTS "initialDiscounts" DECIMAL(20, 6);
ALTER TABLE "PurchaseQuotationOffer" ADD COLUMN IF NOT EXISTS "initialMinOrderQty" DECIMAL(20, 6);
ALTER TABLE "PurchaseQuotationOffer" ADD COLUMN IF NOT EXISTS "proposalReceived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PurchaseQuotationOffer" ADD COLUMN IF NOT EXISTS "proposalReceivedAt" TIMESTAMPTZ(6);
ALTER TABLE "PurchaseQuotationOffer" ADD COLUMN IF NOT EXISTS "proposalReceivedNotes" TEXT;

ALTER TABLE "PurchaseQuotationOfferItem" ADD COLUMN IF NOT EXISTS "initialNonRecoverableTaxes" DECIMAL(20, 6);
ALTER TABLE "PurchaseQuotationOfferItem" ADD COLUMN IF NOT EXISTS "initialExpenses" DECIMAL(20, 6);
ALTER TABLE "PurchaseQuotationOfferItem" ADD COLUMN IF NOT EXISTS "initialDiscounts" DECIMAL(20, 6);
ALTER TABLE "PurchaseQuotationOfferItem" ADD COLUMN IF NOT EXISTS "initialMinOrderQty" DECIMAL(20, 6);
