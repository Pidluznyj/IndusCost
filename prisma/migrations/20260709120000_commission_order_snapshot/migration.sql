-- Snapshot materializado de comissão calculada na venda (pedido/NF).
-- Reversível: DROP TABLE CommissionOrderItemSnapshot; DROP TABLE CommissionOrderSnapshot;
-- DROP TYPE CommissionOrderItemSnapshotStatus; DROP TYPE CommissionOrderSnapshotStatus;

CREATE TYPE "CommissionOrderSnapshotStatus" AS ENUM (
  'ACTIVE',
  'STALE',
  'SUPERSEDED',
  'ERROR'
);

CREATE TYPE "CommissionOrderItemSnapshotStatus" AS ENUM (
  'COMMISSIONABLE',
  'CUSTOMER_EXCLUDED',
  'NO_RULE',
  'SELLER_UNRESOLVED',
  'NO_COMMERCIAL_PRICE_TABLE',
  'INVALID_COMMERCIAL_PRICE_RANGE',
  'NO_COMMISSION_TABLE_RATE',
  'ERROR'
);

CREATE TABLE "CommissionOrderSnapshot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "salesOrderId" UUID NOT NULL,
  "nfeId" INTEGER,
  "customerId" UUID NOT NULL,
  "customerNameSnapshot" TEXT NOT NULL,
  "rawSellerId" INTEGER,
  "rawSellerName" TEXT,
  "canonicalSellerId" UUID,
  "canonicalSellerName" TEXT,
  "sellerResolutionStatus" TEXT,
  "saleDate" TIMESTAMPTZ(6) NOT NULL,
  "totalSoldAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "totalGrossCommissionAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "totalFinalCommissionAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "sourceHash" TEXT NOT NULL,
  "status" "CommissionOrderSnapshotStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommissionOrderSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionOrderItemSnapshot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderSnapshotId" UUID NOT NULL,
  "salesOrderItemId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "productNameSnapshot" TEXT NOT NULL,
  "soldAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "marginPercent" DECIMAL(10, 4),
  "commissionRatePercent" DECIMAL(10, 4) NOT NULL DEFAULT 0,
  "grossCommissionAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "finalCommissionAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "ruleId" UUID,
  "ruleSnapshotJson" JSONB,
  "exclusionReason" TEXT,
  "sourceHash" TEXT NOT NULL,
  "status" "CommissionOrderItemSnapshotStatus" NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommissionOrderItemSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommissionOrderSnapshot_sourceHash_key" ON "CommissionOrderSnapshot"("sourceHash");

CREATE INDEX "CommissionOrderSnapshot_salesOrderId_idx" ON "CommissionOrderSnapshot"("salesOrderId");
CREATE INDEX "CommissionOrderSnapshot_nfeId_idx" ON "CommissionOrderSnapshot"("nfeId");
CREATE INDEX "CommissionOrderSnapshot_canonicalSellerId_idx" ON "CommissionOrderSnapshot"("canonicalSellerId");
CREATE INDEX "CommissionOrderSnapshot_status_idx" ON "CommissionOrderSnapshot"("status");
CREATE INDEX "CommissionOrderSnapshot_saleDate_idx" ON "CommissionOrderSnapshot"("saleDate");
CREATE INDEX "CommissionOrderSnapshot_customerId_idx" ON "CommissionOrderSnapshot"("customerId");

-- Um snapshot ACTIVE por pedido + NF (NF ausente usa -1 no coalesce).
CREATE UNIQUE INDEX "CommissionOrderSnapshot_salesOrderId_nfeId_active_key"
  ON "CommissionOrderSnapshot"("salesOrderId", COALESCE("nfeId", -1))
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "CommissionOrderItemSnapshot_sourceHash_key" ON "CommissionOrderItemSnapshot"("sourceHash");

CREATE UNIQUE INDEX "CommissionOrderItemSnapshot_orderSnapshotId_salesOrderItemId_key"
  ON "CommissionOrderItemSnapshot"("orderSnapshotId", "salesOrderItemId");

CREATE INDEX "CommissionOrderItemSnapshot_orderSnapshotId_idx" ON "CommissionOrderItemSnapshot"("orderSnapshotId");
CREATE INDEX "CommissionOrderItemSnapshot_salesOrderItemId_idx" ON "CommissionOrderItemSnapshot"("salesOrderItemId");
CREATE INDEX "CommissionOrderItemSnapshot_productId_idx" ON "CommissionOrderItemSnapshot"("productId");
CREATE INDEX "CommissionOrderItemSnapshot_status_idx" ON "CommissionOrderItemSnapshot"("status");
CREATE INDEX "CommissionOrderItemSnapshot_ruleId_idx" ON "CommissionOrderItemSnapshot"("ruleId");

ALTER TABLE "CommissionOrderSnapshot"
  ADD CONSTRAINT "CommissionOrderSnapshot_salesOrderId_fkey"
  FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "CommissionOrderSnapshot"
  ADD CONSTRAINT "CommissionOrderSnapshot_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "CommissionOrderSnapshot"
  ADD CONSTRAINT "CommissionOrderSnapshot_canonicalSellerId_fkey"
  FOREIGN KEY ("canonicalSellerId") REFERENCES "CommissionPerson"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "CommissionOrderItemSnapshot"
  ADD CONSTRAINT "CommissionOrderItemSnapshot_orderSnapshotId_fkey"
  FOREIGN KEY ("orderSnapshotId") REFERENCES "CommissionOrderSnapshot"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "CommissionOrderItemSnapshot"
  ADD CONSTRAINT "CommissionOrderItemSnapshot_salesOrderItemId_fkey"
  FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "CommissionOrderItemSnapshot"
  ADD CONSTRAINT "CommissionOrderItemSnapshot_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "CommissionOrderItemSnapshot"
  ADD CONSTRAINT "CommissionOrderItemSnapshot_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "CommissionRule"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
