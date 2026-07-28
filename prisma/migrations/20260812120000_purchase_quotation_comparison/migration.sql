-- OP-18 — Comparação de cotações / escolha humana justificada (aditivo).
-- Sem DROP/RENAME. Sem PO/AP.

ALTER TABLE "PurchaseQuotationOffer" ADD COLUMN IF NOT EXISTS "selectionJustification" TEXT;
ALTER TABLE "PurchaseQuotationOffer" ADD COLUMN IF NOT EXISTS "selectedAt" TIMESTAMPTZ(6);
ALTER TABLE "PurchaseQuotationOffer" ADD COLUMN IF NOT EXISTS "selectedByUserId" TEXT;
ALTER TABLE "PurchaseQuotationOffer" ADD COLUMN IF NOT EXISTS "selectedByUserName" TEXT;
