-- NomusNfe fiscal summary (1:1) + tax lines (HEADER/ITEM) — T02
-- Não executa em produção neste prompt; migration versionada apenas.

CREATE TABLE "NomusNfeFiscalSummary" (
    "id" TEXT NOT NULL,
    "nomusNfeId" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "xmlHash" TEXT,
    "parsedAt" TIMESTAMP(3) NOT NULL,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "finalidade" INTEGER,
    "tpNF" INTEGER,
    "vProd" DECIMAL(20,2),
    "vDesc" DECIMAL(20,2),
    "vFrete" DECIMAL(20,2),
    "vSeg" DECIMAL(20,2),
    "vOutro" DECIMAL(20,2),
    "vII" DECIMAL(20,2),
    "vIPI" DECIMAL(20,2),
    "vIPIDevol" DECIMAL(20,2),
    "vBC" DECIMAL(20,2),
    "vICMS" DECIMAL(20,2),
    "vICMSDeson" DECIMAL(20,2),
    "vBCST" DECIMAL(20,2),
    "vST" DECIMAL(20,2),
    "vFCP" DECIMAL(20,2),
    "vFCPST" DECIMAL(20,2),
    "vFCPSTRet" DECIMAL(20,2),
    "vPIS" DECIMAL(20,2),
    "vCOFINS" DECIMAL(20,2),
    "vISS" DECIMAL(20,2),
    "vTotTrib" DECIMAL(20,2),
    "vNF" DECIMAL(20,2),
    "extensibleTotals" JSONB,
    "highlightedResidual" DECIMAL(20,2),
    "qualityAlert" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusNfeFiscalSummary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NomusNfeTaxLine" (
    "id" TEXT NOT NULL,
    "nomusNfeId" TEXT NOT NULL,
    "summaryId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "taxType" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "itemNumber" INTEGER,
    "baseAmount" DECIMAL(20,4),
    "rate" DECIMAL(12,6),
    "amount" DECIMAL(20,4),
    "cst" TEXT,
    "csosn" TEXT,
    "cfop" TEXT,
    "ncm" TEXT,
    "metadata" JSONB,
    "source" TEXT NOT NULL,
    "sourcePath" TEXT,
    "parsedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusNfeTaxLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NomusNfeFiscalSummary_nomusNfeId_key" ON "NomusNfeFiscalSummary"("nomusNfeId");

CREATE INDEX "NomusNfeFiscalSummary_parserVersion_idx" ON "NomusNfeFiscalSummary"("parserVersion");

CREATE INDEX "NomusNfeFiscalSummary_parsedAt_idx" ON "NomusNfeFiscalSummary"("parsedAt");

CREATE INDEX "NomusNfeFiscalSummary_isCancelled_idx" ON "NomusNfeFiscalSummary"("isCancelled");

CREATE UNIQUE INDEX "NomusNfeTaxLine_nomusNfeId_lineKey_key" ON "NomusNfeTaxLine"("nomusNfeId", "lineKey");

CREATE INDEX "NomusNfeTaxLine_nomusNfeId_scope_taxType_idx" ON "NomusNfeTaxLine"("nomusNfeId", "scope", "taxType");

CREATE INDEX "NomusNfeTaxLine_summaryId_idx" ON "NomusNfeTaxLine"("summaryId");

CREATE INDEX "NomusNfeTaxLine_taxType_idx" ON "NomusNfeTaxLine"("taxType");

ALTER TABLE "NomusNfeFiscalSummary" ADD CONSTRAINT "NomusNfeFiscalSummary_nomusNfeId_fkey" FOREIGN KEY ("nomusNfeId") REFERENCES "NomusNfe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NomusNfeTaxLine" ADD CONSTRAINT "NomusNfeTaxLine_nomusNfeId_fkey" FOREIGN KEY ("nomusNfeId") REFERENCES "NomusNfe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NomusNfeTaxLine" ADD CONSTRAINT "NomusNfeTaxLine_summaryId_fkey" FOREIGN KEY ("summaryId") REFERENCES "NomusNfeFiscalSummary"("id") ON DELETE CASCADE ON UPDATE CASCADE;
