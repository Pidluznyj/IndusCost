-- Comissões → competência mensal pela DATA REAL DO RECEBIMENTO (`GET /rest/recebimentos`).
--
-- Migration ADITIVA. Auditoria:
--   0 DROP, 0 RENAME, 0 DELETE, 0 TRUNCATE, 0 ALTER em tabela existente.
--   1 CREATE TABLE, 1 índice único, 6 índices de consulta, 0 FOREIGN KEY.
--
-- `NomusAccountsReceivable.settlementDate` (dataBaixa) é PRESERVADA integralmente:
-- continua sendo a baixa administrativa/auditável. Nada nela é tocado aqui.
--
-- Vínculo determinístico (NUNCA aproximado por cliente/valor/data/NF/descrição):
--   NomusReceivableReceipt.receivableExternalId = NomusAccountsReceivable.externalId
-- A FK NÃO é declarada de propósito: recebimentos podem chegar da origem antes do
-- CR correspondente estar sincronizado (ver relatório dos eventos sem CR local).
--
-- `receiptDate` é DATE (dia civil) — 31/07 nunca pode virar 01/08 por fuso horário.

-- CreateTable
CREATE TABLE "NomusReceivableReceipt" (
    "id" TEXT NOT NULL,
    "externalId" INTEGER NOT NULL,
    "receivableExternalId" INTEGER NOT NULL,
    "receiptDate" DATE NOT NULL,
    "competenceDate" DATE,
    "closesReceivable" BOOLEAN,
    "receivedAmount" DECIMAL(20,2) NOT NULL,
    "bankFeeAmount" DECIMAL(20,2),
    "lateFeeInterestAmount" DECIMAL(20,2),
    "discountAmount" DECIMAL(20,2),
    "code" TEXT,
    "description" TEXT,
    "comments" TEXT,
    "companyId" INTEGER,
    "companyName" TEXT,
    "personId" INTEGER,
    "personName" TEXT,
    "bankAccountId" INTEGER,
    "bankAccountName" TEXT,
    "paymentMethodId" INTEGER,
    "paymentMethodName" TEXT,
    "financialClassificationId" INTEGER,
    "financialClassificationName" TEXT,
    "createdByUserId" INTEGER,
    "createdByUserName" TEXT,
    "createdAtNomus" TIMESTAMP(3),
    "modifiedAtNomus" TIMESTAMP(3),
    "rawPayload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusReceivableReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NomusReceivableReceipt_externalId_key" ON "NomusReceivableReceipt"("externalId");

-- CreateIndex
CREATE INDEX "NomusReceivableReceipt_receiptDate_idx" ON "NomusReceivableReceipt"("receiptDate");

-- CreateIndex
CREATE INDEX "NomusReceivableReceipt_receivableExternalId_idx" ON "NomusReceivableReceipt"("receivableExternalId");

-- CreateIndex
CREATE INDEX "NomusReceivableReceipt_receivableExternalId_receiptDate_idx" ON "NomusReceivableReceipt"("receivableExternalId", "receiptDate");

-- CreateIndex
CREATE INDEX "NomusReceivableReceipt_modifiedAtNomus_idx" ON "NomusReceivableReceipt"("modifiedAtNomus");

-- CreateIndex
CREATE INDEX "NomusReceivableReceipt_payloadHash_idx" ON "NomusReceivableReceipt"("payloadHash");

-- CreateIndex
CREATE INDEX "NomusReceivableReceipt_syncedAt_idx" ON "NomusReceivableReceipt"("syncedAt");
