-- Vínculo cotação de mercado → compra real (manual; sem FK a módulo PurchaseOrder).
-- Economia estimada: (preçoReferênciaBRL - preçoNegociado) × quantidade.

DO $$ BEGIN
  ALTER TYPE "MaterialMarketAuditEntityType" ADD VALUE IF NOT EXISTS 'PURCHASE_LINK';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "MaterialMarketAuditEventType" ADD VALUE IF NOT EXISTS 'PURCHASE_LINKED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "MaterialMarketPurchaseLink" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "materialId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "purchaseOrderId" UUID,
    "purchaseOrderNumber" TEXT,
    "supplierName" TEXT NOT NULL,
    "quantityPurchased" DECIMAL(20,6) NOT NULL,
    "negotiatedPrice" DECIMAL(20,6) NOT NULL,
    "purchaseDate" DATE NOT NULL,
    "choiceReason" TEXT,
    "estimatedSavings" DECIMAL(20,6) NOT NULL,
    "referenceUnitPriceBrl" DECIMAL(20,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaterialMarketPurchaseLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MaterialMarketPurchaseLink_materialId_purchaseDate_idx" ON "MaterialMarketPurchaseLink"("materialId", "purchaseDate" DESC);
CREATE INDEX IF NOT EXISTS "MaterialMarketPurchaseLink_quoteId_idx" ON "MaterialMarketPurchaseLink"("quoteId");
CREATE INDEX IF NOT EXISTS "MaterialMarketPurchaseLink_purchaseOrderId_idx" ON "MaterialMarketPurchaseLink"("purchaseOrderId");

DO $$ BEGIN
  ALTER TABLE "MaterialMarketPurchaseLink" ADD CONSTRAINT "MaterialMarketPurchaseLink_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "MaterialMarketPurchaseLink" ADD CONSTRAINT "MaterialMarketPurchaseLink_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "MaterialMarketQuote"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null; END $$;
