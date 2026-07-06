-- NOMUS-PRODUCT-CATALOG-A: catálogo local de produtos do ERP Nomus (inclui matérias-primas)
CREATE TABLE "NomusProductCatalog" (
    "id" TEXT NOT NULL,
    "externalProductId" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "typeName" TEXT,
    "groupName" TEXT,
    "familyName" TEXT,
    "statusName" TEXT,
    "active" BOOLEAN,
    "rawPayload" JSONB,
    "blockedReasons" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusProductCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NomusProductCatalog_code_key" ON "NomusProductCatalog"("code");

CREATE INDEX "NomusProductCatalog_externalProductId_idx" ON "NomusProductCatalog"("externalProductId");

CREATE INDEX "NomusProductCatalog_active_idx" ON "NomusProductCatalog"("active");

CREATE INDEX "NomusProductCatalog_syncedAt_idx" ON "NomusProductCatalog"("syncedAt");
