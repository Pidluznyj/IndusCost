-- Cobertura de comissão por evento de recebimento + cutover Nomus -> IndusCost.
--
-- Cutover oficial: até 30/09/2026 o Nomus é a fonte oficial de comissão; a partir
-- de 01/10/2026, o IndusCost. A competência natural continua sendo
-- NomusReceivableReceipt.receiptDate — esta migration NÃO reescreve datas.
--
-- ADITIVA: só cria tipos, tabelas, colunas com default e índices. Nenhum
-- UPDATE/DELETE de dados existentes; linhas antigas do ledger ficam com
-- inclusionType = NORMAL e receiptExternalIds = {} (sem retroagir auditoria).
--
-- Anti-duplicidade no banco: índice único PARCIAL (o Prisma não expressa WHERE)
-- garante que um receiptExternalId tenha no máximo UMA cobertura COVERED, seja
-- NOMUS_LEGACY ou INDUSCOST_CLOSING. Corrida entre duas coberturas: uma vence,
-- a outra recebe violação de unicidade (P2002) e a transação inteira é desfeita.

-- CreateEnum
CREATE TYPE "CommissionReceiptCoverageSource" AS ENUM ('NOMUS_LEGACY', 'INDUSCOST_CLOSING', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CommissionReceiptCoverageStatus" AS ENUM ('COVERED', 'PENDING', 'IGNORED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CommissionReceiptCoverageAssociationMethod" AS ENUM ('RECEIPT_ID', 'RECEIVABLE_ID', 'RECEIVABLE_AMOUNT_DATE', 'MANUAL', 'INDUSCOST_LEDGER');

-- CreateEnum
CREATE TYPE "CommissionReceiptLedgerInclusionType" AS ENUM ('NORMAL', 'LATE_CARRYOVER', 'LEGACY_CARRYOVER', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CommissionLegacyCoverageImportSource" AS ENUM ('NOMUS');

-- AlterTable
ALTER TABLE "CommissionReceiptLedgerLine" ADD COLUMN     "inclusionType" "CommissionReceiptLedgerInclusionType" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "naturalMonth" INTEGER,
ADD COLUMN     "naturalYear" INTEGER,
ADD COLUMN     "receiptDate" DATE,
ADD COLUMN     "receiptExternalIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "CommissionReceiptCoverage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receiptExternalId" INTEGER,
    "receivableExternalId" INTEGER NOT NULL,
    "coverageSource" "CommissionReceiptCoverageSource" NOT NULL,
    "coverageStatus" "CommissionReceiptCoverageStatus" NOT NULL DEFAULT 'COVERED',
    "naturalReceiptDate" DATE NOT NULL,
    "naturalYear" INTEGER NOT NULL,
    "naturalMonth" INTEGER NOT NULL,
    "coveredYear" INTEGER,
    "coveredMonth" INTEGER,
    "closingId" UUID,
    "ledgerLineId" UUID,
    "legacyReference" TEXT,
    "legacyImportId" UUID,
    "coveredReceivedAmount" DECIMAL(20,2) NOT NULL,
    "coveredCommissionAmount" DECIMAL(20,2),
    "associationMethod" "CommissionReceiptCoverageAssociationMethod" NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionReceiptCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionLegacyCoverageImport" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" "CommissionLegacyCoverageImportSource" NOT NULL DEFAULT 'NOMUS',
    "referenceYear" INTEGER NOT NULL,
    "referenceMonth" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "importedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedBy" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "ambiguousCount" INTEGER NOT NULL DEFAULT 0,
    "alreadyCoveredCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "resultRowsJson" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionLegacyCoverageImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionReceiptCoverage_receiptExternalId_idx" ON "CommissionReceiptCoverage"("receiptExternalId");

-- CreateIndex
CREATE INDEX "CommissionReceiptCoverage_receivableExternalId_idx" ON "CommissionReceiptCoverage"("receivableExternalId");

-- CreateIndex
CREATE INDEX "CommissionReceiptCoverage_naturalYear_naturalMonth_idx" ON "CommissionReceiptCoverage"("naturalYear", "naturalMonth");

-- CreateIndex
CREATE INDEX "CommissionReceiptCoverage_coveredYear_coveredMonth_idx" ON "CommissionReceiptCoverage"("coveredYear", "coveredMonth");

-- CreateIndex
CREATE INDEX "CommissionReceiptCoverage_coverageSource_idx" ON "CommissionReceiptCoverage"("coverageSource");

-- CreateIndex
CREATE INDEX "CommissionReceiptCoverage_coverageStatus_idx" ON "CommissionReceiptCoverage"("coverageStatus");

-- CreateIndex
CREATE INDEX "CommissionReceiptCoverage_closingId_idx" ON "CommissionReceiptCoverage"("closingId");

-- CreateIndex
CREATE INDEX "CommissionReceiptCoverage_ledgerLineId_idx" ON "CommissionReceiptCoverage"("ledgerLineId");

-- CreateIndex
CREATE INDEX "CommissionReceiptCoverage_legacyImportId_idx" ON "CommissionReceiptCoverage"("legacyImportId");

-- CreateIndex
CREATE INDEX "CommissionLegacyCoverageImport_referenceYear_referenceMonth_idx" ON "CommissionLegacyCoverageImport"("referenceYear", "referenceMonth");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionLegacyCoverageImport_source_fileHash_key" ON "CommissionLegacyCoverageImport"("source", "fileHash");

-- CreateIndex
CREATE INDEX "CommissionReceiptLedgerLine_naturalYear_naturalMonth_idx" ON "CommissionReceiptLedgerLine"("naturalYear", "naturalMonth");

-- CreateIndex
CREATE INDEX "CommissionReceiptLedgerLine_inclusionType_idx" ON "CommissionReceiptLedgerLine"("inclusionType");

-- AddForeignKey
ALTER TABLE "CommissionReceiptCoverage" ADD CONSTRAINT "CommissionReceiptCoverage_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "CommissionMonthlyClosing"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CommissionReceiptCoverage" ADD CONSTRAINT "CommissionReceiptCoverage_ledgerLineId_fkey" FOREIGN KEY ("ledgerLineId") REFERENCES "CommissionReceiptLedgerLine"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CommissionReceiptCoverage" ADD CONSTRAINT "CommissionReceiptCoverage_legacyImportId_fkey" FOREIGN KEY ("legacyImportId") REFERENCES "CommissionLegacyCoverageImport"("id") ON DELETE SET NULL ON UPDATE NO ACTION;


-- Um recebimento só pode estar coberto (pago) por UMA fonte oficial.
CREATE UNIQUE INDEX "CommissionReceiptCoverage_receipt_covered_key"
  ON "CommissionReceiptCoverage"("receiptExternalId")
  WHERE "coverageStatus" = 'COVERED' AND "receiptExternalId" IS NOT NULL;
