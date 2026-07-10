-- CreateTable
CREATE TABLE "NomusStockDocument" (
    "id" TEXT NOT NULL,
    "externalId" INTEGER NOT NULL,
    "idNfe" INTEGER,
    "tipoDocumentoEstoque" TEXT,
    "dataDocumento" TIMESTAMP(3),
    "rawJson" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusStockDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NomusStockDocumentItem" (
    "id" TEXT NOT NULL,
    "stockDocumentId" TEXT NOT NULL,
    "externalItemId" INTEGER,
    "externalProductId" INTEGER,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unitValue" DECIMAL(20,6) NOT NULL,
    "estimatedTotalValue" DECIMAL(20,6) NOT NULL,
    "rawJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusStockDocumentItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NomusStockDocument_externalId_key" ON "NomusStockDocument"("externalId");

-- CreateIndex
CREATE INDEX "NomusStockDocument_idNfe_idx" ON "NomusStockDocument"("idNfe");

-- CreateIndex
CREATE INDEX "NomusStockDocument_tipoDocumentoEstoque_idx" ON "NomusStockDocument"("tipoDocumentoEstoque");

-- CreateIndex
CREATE INDEX "NomusStockDocument_dataDocumento_idx" ON "NomusStockDocument"("dataDocumento");

-- CreateIndex
CREATE INDEX "NomusStockDocument_syncedAt_idx" ON "NomusStockDocument"("syncedAt");

-- CreateIndex
CREATE INDEX "NomusStockDocumentItem_stockDocumentId_idx" ON "NomusStockDocumentItem"("stockDocumentId");

-- CreateIndex
CREATE INDEX "NomusStockDocumentItem_externalProductId_idx" ON "NomusStockDocumentItem"("externalProductId");

-- CreateIndex
CREATE INDEX "NomusStockDocumentItem_externalItemId_idx" ON "NomusStockDocumentItem"("externalItemId");

-- AddForeignKey
ALTER TABLE "NomusStockDocumentItem" ADD CONSTRAINT "NomusStockDocumentItem_stockDocumentId_fkey" FOREIGN KEY ("stockDocumentId") REFERENCES "NomusStockDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
