-- Cotações manuais de mercado por matéria-prima (append-only).

CREATE TYPE "MaterialMarketQuoteStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED');

CREATE TABLE "MaterialMarketQuote" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "materialId" UUID NOT NULL,
    "supplierId" UUID,
    "supplierName" TEXT,
    "quoteDate" DATE NOT NULL,
    "price" DECIMAL(20,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "unit" TEXT NOT NULL,
    "origin" TEXT,
    "manufacturer" TEXT,
    "freightValue" DECIMAL(20,6),
    "taxValue" DECIMAL(20,6),
    "netPrice" DECIMAL(20,6) NOT NULL,
    "paymentTerms" TEXT,
    "proposalValidityDate" DATE,
    "notes" TEXT,
    "status" "MaterialMarketQuoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialMarketQuote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialMarketQuote_materialId_quoteDate_idx" ON "MaterialMarketQuote"("materialId", "quoteDate" DESC);
CREATE INDEX "MaterialMarketQuote_supplierId_idx" ON "MaterialMarketQuote"("supplierId");

ALTER TABLE "MaterialMarketQuote" ADD CONSTRAINT "MaterialMarketQuote_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "MaterialMarketQuote" ADD CONSTRAINT "MaterialMarketQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "FinancialSupplier"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
