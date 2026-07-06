-- Pedidos de venda internos (gerados a partir de propostas; sem envio Nomus nesta etapa)

CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'READY_TO_SEND', 'SENT_TO_NOMUS', 'CANCELLED', 'ERROR');

CREATE TABLE "SalesOrder" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "proposalId" UUID NOT NULL,
    "sourceSystem" TEXT,
    "externalSalesOrderId" INTEGER,
    "externalSalesOrderCode" TEXT,
    "orderCode" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "externalCustomerId" INTEGER,
    "responsible" TEXT,
    "externalSellerId" INTEGER,
    "companyIssuer" TEXT,
    "externalCompanyId" INTEGER,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'READY_TO_SEND',
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDeliveryDate" TIMESTAMP(3),
    "paymentTerms" TEXT,
    "paymentMethod" TEXT,
    "freightCondition" TEXT,
    "deliveryLocation" TEXT,
    "notes" TEXT,
    "internalNotes" TEXT,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "totalGrossValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalDiscount" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalNetValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalMarginValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalMarginPerc" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "totalTaxes" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "totalFreight" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentToNomusAt" TIMESTAMP(3),
    "nomusRawResponse" JSONB,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesOrder_proposalId_key" ON "SalesOrder"("proposalId");
CREATE UNIQUE INDEX "SalesOrder_orderCode_key" ON "SalesOrder"("orderCode");
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");
CREATE INDEX "SalesOrder_status_idx" ON "SalesOrder"("status");
CREATE INDEX "SalesOrder_issueDate_idx" ON "SalesOrder"("issueDate");

ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_proposalId_fkey"
  FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TABLE "SalesOrderItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salesOrderId" UUID NOT NULL,
    "proposalItemId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "externalProductId" INTEGER,
    "skuSnapshot" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" TEXT,
    "unitCost" DECIMAL(20,6) NOT NULL,
    "negotiatedPrice" DECIMAL(20,6) NOT NULL,
    "totalNetValue" DECIMAL(20,6) NOT NULL,
    "totalCost" DECIMAL(20,6) NOT NULL,
    "marginValue" DECIMAL(20,6) NOT NULL,
    "marginPerc" DECIMAL(10,6) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesOrderItem_salesOrderId_idx" ON "SalesOrderItem"("salesOrderId");
CREATE INDEX "SalesOrderItem_proposalItemId_idx" ON "SalesOrderItem"("proposalItemId");
CREATE INDEX "SalesOrderItem_productId_idx" ON "SalesOrderItem"("productId");

ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_salesOrderId_fkey"
  FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_proposalItemId_fkey"
  FOREIGN KEY ("proposalItemId") REFERENCES "ProposalItem"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
