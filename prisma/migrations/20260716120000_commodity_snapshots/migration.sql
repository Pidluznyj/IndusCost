-- Snapshots de commodities de mercado (Brent) — append-only.

CREATE TYPE "CommodityType" AS ENUM ('BRENT');
CREATE TYPE "CommoditySnapshotStatus" AS ENUM ('SUCCESS', 'FAILED');
CREATE TYPE "CommodityCollectionSlot" AS ENUM ('MORNING', 'AFTERNOON');
CREATE TYPE "CommodityCollectionTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

CREATE TABLE "CommoditySnapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "commodityType" "CommodityType" NOT NULL,
    "priceUSD" DECIMAL(20,6),
    "quoteDate" DATE NOT NULL,
    "scheduledSlot" "CommodityCollectionSlot" NOT NULL,
    "collectedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "status" "CommoditySnapshotStatus" NOT NULL,
    "errorMessage" TEXT,
    "variationFromPrevious" DECIMAL(10,6),
    "trigger" "CommodityCollectionTrigger" NOT NULL DEFAULT 'SCHEDULED',

    CONSTRAINT "CommoditySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommoditySnapshot_commodityType_quoteDate_scheduledSlot_idx"
    ON "CommoditySnapshot"("commodityType", "quoteDate" DESC, "scheduledSlot");

CREATE INDEX "CommoditySnapshot_commodityType_status_collectedAt_idx"
    ON "CommoditySnapshot"("commodityType", "status", "collectedAt" DESC);
