-- Fluxo simplificado de compras: orcamentos diretos do comprador.
-- Aditiva: tabela nova + colunas nullable. Sem DROP, sem backfill.

ALTER TABLE "PurchaseRequest"
  ADD COLUMN "buyerUserId" TEXT,
  ADD COLUMN "buyerName" TEXT,
  ADD COLUMN "buyerValidatedAt" TIMESTAMPTZ(6);

CREATE TABLE "PurchaseRequestQuote" (
  "id"                       UUID           NOT NULL DEFAULT gen_random_uuid(),
  "purchaseRequestId"        UUID           NOT NULL,
  "supplierId"               UUID,
  "supplierNameSnapshot"     TEXT           NOT NULL,
  "supplierDocumentSnapshot" TEXT,
  "totalValue"               DECIMAL(20,2)  NOT NULL,
  "paymentTerms"             TEXT,
  "deliveryDays"             INTEGER,
  "validUntil"               TIMESTAMPTZ(6),
  "notes"                    TEXT,
  "isWinner"                 BOOLEAN        NOT NULL DEFAULT false,
  "winnerReason"             TEXT,
  "createdByUserId"          TEXT,
  "createdByName"            TEXT,
  "createdAt"                TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt"                TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "PurchaseRequestQuote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseRequestQuote_purchaseRequestId_idx" ON "PurchaseRequestQuote"("purchaseRequestId");
CREATE INDEX "PurchaseRequestQuote_supplierId_idx" ON "PurchaseRequestQuote"("supplierId");

ALTER TABLE "PurchaseRequestQuote"
  ADD CONSTRAINT "PurchaseRequestQuote_purchaseRequestId_fkey"
    FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "PurchaseRequestQuote_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "FinancialSupplier"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
