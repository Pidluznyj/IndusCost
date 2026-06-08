-- CreateTable
CREATE TABLE "NomusAccountsReceivable" (
    "id" TEXT NOT NULL,
    "externalId" INTEGER NOT NULL,
    "classification" TEXT,
    "type" INTEGER,
    "status" BOOLEAN,
    "companyId" INTEGER,
    "companyName" TEXT,
    "personId" INTEGER,
    "personName" TEXT,
    "personCnpj" TEXT,
    "personPhone" TEXT,
    "bankAccountId" INTEGER,
    "bankAccountName" TEXT,
    "paymentMethodId" INTEGER,
    "paymentMethodName" TEXT,
    "dueDate" TIMESTAMP(3),
    "competenceDate" TIMESTAMP(3),
    "scheduleDate" TIMESTAMP(3),
    "createdAtNomus" TIMESTAMP(3),
    "modifiedAtNomus" TIMESTAMP(3),
    "settlementDate" TIMESTAMP(3),
    "amountReceivable" DECIMAL(20,2),
    "amountScheduled" DECIMAL(20,2),
    "amountReceived" DECIMAL(20,2),
    "balanceReceivable" DECIMAL(20,2),
    "description" TEXT,
    "comments" TEXT,
    "sourceInvoiceId" INTEGER,
    "sourceInvoiceNumber" TEXT,
    "suspendCollection" BOOLEAN,
    "lateFeePercent" DECIMAL(10,4),
    "monthlyInterestRate" DECIMAL(10,4),
    "lateFeeCalculationType" TEXT,
    "lateInterestType" TEXT,
    "rawPayload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusAccountsReceivable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NomusAccountsReceivable_externalId_key" ON "NomusAccountsReceivable"("externalId");

-- CreateIndex
CREATE INDEX "NomusAccountsReceivable_dueDate_idx" ON "NomusAccountsReceivable"("dueDate");

-- CreateIndex
CREATE INDEX "NomusAccountsReceivable_status_idx" ON "NomusAccountsReceivable"("status");

-- CreateIndex
CREATE INDEX "NomusAccountsReceivable_companyName_idx" ON "NomusAccountsReceivable"("companyName");

-- CreateIndex
CREATE INDEX "NomusAccountsReceivable_personName_idx" ON "NomusAccountsReceivable"("personName");

-- CreateIndex
CREATE INDEX "NomusAccountsReceivable_personCnpj_idx" ON "NomusAccountsReceivable"("personCnpj");

-- CreateIndex
CREATE INDEX "NomusAccountsReceivable_sourceInvoiceId_idx" ON "NomusAccountsReceivable"("sourceInvoiceId");

-- CreateIndex
CREATE INDEX "NomusAccountsReceivable_sourceInvoiceNumber_idx" ON "NomusAccountsReceivable"("sourceInvoiceNumber");

-- CreateIndex
CREATE INDEX "NomusAccountsReceivable_syncedAt_idx" ON "NomusAccountsReceivable"("syncedAt");

-- CreateIndex
CREATE INDEX "NomusAccountsReceivable_payloadHash_idx" ON "NomusAccountsReceivable"("payloadHash");
