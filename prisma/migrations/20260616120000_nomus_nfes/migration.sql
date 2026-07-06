-- CreateEnum
CREATE TYPE "NomusNfeBillingClassification" AS ENUM ('LOGISTICS_NOT_REVENUE', 'INTERCOMPANY', 'MARKET_REVENUE');

-- CreateTable
CREATE TABLE "NomusNfe" (
    "id" TEXT NOT NULL,
    "externalId" INTEGER NOT NULL,
    "chave" TEXT,
    "numero" TEXT,
    "serie" TEXT,
    "status" INTEGER,
    "tipoOperacao" INTEGER,
    "tipoEmissao" INTEGER,
    "finalidade" INTEGER,
    "isFornecedor" INTEGER,
    "ambiente" INTEGER,
    "cnpjEmitente" TEXT,
    "protocolo" TEXT,
    "recibo" TEXT,
    "dataProcessamento" TIMESTAMP(3),
    "horaProcessamento" TEXT,
    "xmlRaw" TEXT,
    "xmlCancelamento" TEXT,
    "justificativaCancelamento" TEXT,
    "xmlNatOp" TEXT,
    "xmlDhEmi" TIMESTAMP(3),
    "xmlTpNF" INTEGER,
    "xmlDestCnpjCpf" TEXT,
    "xmlVProd" DECIMAL(20,2),
    "xmlVDesc" DECIMAL(20,2),
    "xmlVNF" DECIMAL(20,2),
    "valorLiquido" DECIMAL(20,2),
    "billingClassification" "NomusNfeBillingClassification",
    "isFiscalBilling" BOOLEAN NOT NULL DEFAULT false,
    "isMarketSale" BOOLEAN NOT NULL DEFAULT false,
    "xmlQualityAlert" TEXT,
    "rawPayload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusNfe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NomusNfe_externalId_key" ON "NomusNfe"("externalId");

-- CreateIndex
CREATE INDEX "NomusNfe_dataProcessamento_idx" ON "NomusNfe"("dataProcessamento");

-- CreateIndex
CREATE INDEX "NomusNfe_xmlDhEmi_idx" ON "NomusNfe"("xmlDhEmi");

-- CreateIndex
CREATE INDEX "NomusNfe_status_idx" ON "NomusNfe"("status");

-- CreateIndex
CREATE INDEX "NomusNfe_billingClassification_idx" ON "NomusNfe"("billingClassification");

-- CreateIndex
CREATE INDEX "NomusNfe_isMarketSale_idx" ON "NomusNfe"("isMarketSale");

-- CreateIndex
CREATE INDEX "NomusNfe_numero_idx" ON "NomusNfe"("numero");

-- CreateIndex
CREATE INDEX "NomusNfe_xmlDestCnpjCpf_idx" ON "NomusNfe"("xmlDestCnpjCpf");

-- CreateIndex
CREATE INDEX "NomusNfe_syncedAt_idx" ON "NomusNfe"("syncedAt");

-- CreateIndex
CREATE INDEX "NomusNfe_payloadHash_idx" ON "NomusNfe"("payloadHash");
