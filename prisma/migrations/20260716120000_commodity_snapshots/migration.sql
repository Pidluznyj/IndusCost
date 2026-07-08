-- Snapshots de commodities de mercado (Brent) — append-only.

CREATE TYPE "CommodityType" AS ENUM ('BRENT');
CREATE TYPE "CommoditySnapshotStatus" AS ENUM ('SUCCESS', 'FAILED');

CREATE TABLE "CommoditySnapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "commodityType" "CommodityType" NOT NULL,
    "priceUSD" DECIMAL(20,6),
    "quoteDate" DATE NOT NULL,
    "collectedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "status" "CommoditySnapshotStatus" NOT NULL,
    "errorMessage" TEXT,
    "variationFromPrevious" DECIMAL(10,6),

    CONSTRAINT "CommoditySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommoditySnapshot_commodityType_quoteDate_idx"
    ON "CommoditySnapshot"("commodityType", "quoteDate" DESC);

CREATE INDEX "CommoditySnapshot_commodityType_status_collectedAt_idx"
    ON "CommoditySnapshot"("commodityType", "status", "collectedAt" DESC);
