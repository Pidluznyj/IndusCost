-- CreateTable
CREATE TABLE "PortfolioCustomerPaymentRule" (
    "id" TEXT NOT NULL,
    "customerExternalId" INTEGER NOT NULL,
    "customerNameSnapshot" TEXT,
    "allowedDaysJson" JSONB NOT NULL,
    "defaultTermDays" INTEGER NOT NULL DEFAULT 0,
    "moveToNextAllowedDay" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioCustomerPaymentRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioCustomerPaymentRule_customerExternalId_key" ON "PortfolioCustomerPaymentRule"("customerExternalId");

-- CreateIndex
CREATE INDEX "PortfolioCustomerPaymentRule_isActive_idx" ON "PortfolioCustomerPaymentRule"("isActive");

-- CreateIndex
CREATE INDEX "PortfolioCustomerPaymentRule_customerExternalId_idx" ON "PortfolioCustomerPaymentRule"("customerExternalId");
