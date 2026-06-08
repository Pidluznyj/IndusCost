-- CreateTable
CREATE TABLE "NomusAccountsPayable" (
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
    "paymentDate" TIMESTAMP(3),
    "amountPayable" DECIMAL(20,2),
    "amountScheduled" DECIMAL(20,2),
    "amountPaid" DECIMAL(20,2),
    "balancePayable" DECIMAL(20,2),
    "description" TEXT,
    "comments" TEXT,
    "documentNumber" TEXT,
    "sourceInvoiceId" INTEGER,
    "sourceInvoiceNumber" TEXT,
    "suspendPayment" BOOLEAN,
    "lateFeePercent" DECIMAL(10,4),
    "monthlyInterestRate" DECIMAL(10,4),
    "lateFeeCalculationType" TEXT,
    "lateInterestType" TEXT,
    "rawPayload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusAccountsPayable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NomusAccountsPayable_externalId_key" ON "NomusAccountsPayable"("externalId");

-- CreateIndex
CREATE INDEX "NomusAccountsPayable_dueDate_idx" ON "NomusAccountsPayable"("dueDate");

-- CreateIndex
CREATE INDEX "NomusAccountsPayable_status_idx" ON "NomusAccountsPayable"("status");

-- CreateIndex
CREATE INDEX "NomusAccountsPayable_companyName_idx" ON "NomusAccountsPayable"("companyName");

-- CreateIndex
CREATE INDEX "NomusAccountsPayable_personName_idx" ON "NomusAccountsPayable"("personName");

-- CreateIndex
CREATE INDEX "NomusAccountsPayable_personCnpj_idx" ON "NomusAccountsPayable"("personCnpj");

-- CreateIndex
CREATE INDEX "NomusAccountsPayable_documentNumber_idx" ON "NomusAccountsPayable"("documentNumber");

-- CreateIndex
CREATE INDEX "NomusAccountsPayable_sourceInvoiceId_idx" ON "NomusAccountsPayable"("sourceInvoiceId");

-- CreateIndex
CREATE INDEX "NomusAccountsPayable_sourceInvoiceNumber_idx" ON "NomusAccountsPayable"("sourceInvoiceNumber");

-- CreateIndex
CREATE INDEX "NomusAccountsPayable_syncedAt_idx" ON "NomusAccountsPayable"("syncedAt");

-- CreateIndex
CREATE INDEX "NomusAccountsPayable_payloadHash_idx" ON "NomusAccountsPayable"("payloadHash");
