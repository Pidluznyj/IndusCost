-- CreateTable
CREATE TABLE "SalesOrderNfeLink" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "salesOrderId" UUID NOT NULL,
    "externalSalesOrderId" INTEGER,
    "externalSalesOrderCode" TEXT,
    "orderCode" TEXT,
    "nfeExternalId" INTEGER NOT NULL,
    "nfeNumber" TEXT,
    "nfeSerie" TEXT,
    "nfeKey" TEXT,
    "nfeStatus" INTEGER,
    "tipoOperacao" INTEGER,
    "tipoEmissao" INTEGER,
    "dataProcessamento" TIMESTAMP(3),
    "horaProcessamento" TEXT,
    "cnpjEmitente" TEXT,
    "protocolo" TEXT,
    "recibo" TEXT,
    "usuario" TEXT,
    "ambiente" INTEGER,
    "finalidade" INTEGER,
    "isFornecedor" INTEGER,
    "nomusNfeId" TEXT,
    "rawPayload" JSONB,
    "presentInLastPayload" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderNfeLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderNfeLink_salesOrderId_nfeExternalId_key" ON "SalesOrderNfeLink"("salesOrderId", "nfeExternalId");

-- CreateIndex
CREATE INDEX "SalesOrderNfeLink_salesOrderId_idx" ON "SalesOrderNfeLink"("salesOrderId");

-- CreateIndex
CREATE INDEX "SalesOrderNfeLink_nfeExternalId_idx" ON "SalesOrderNfeLink"("nfeExternalId");

-- CreateIndex
CREATE INDEX "SalesOrderNfeLink_nfeNumber_idx" ON "SalesOrderNfeLink"("nfeNumber");

-- CreateIndex
CREATE INDEX "SalesOrderNfeLink_nfeKey_idx" ON "SalesOrderNfeLink"("nfeKey");

-- CreateIndex
CREATE INDEX "SalesOrderNfeLink_dataProcessamento_idx" ON "SalesOrderNfeLink"("dataProcessamento");

-- CreateIndex
CREATE INDEX "SalesOrderNfeLink_externalSalesOrderId_idx" ON "SalesOrderNfeLink"("externalSalesOrderId");

-- AddForeignKey
ALTER TABLE "SalesOrderNfeLink" ADD CONSTRAINT "SalesOrderNfeLink_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
