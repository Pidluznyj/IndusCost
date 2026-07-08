CREATE TYPE "CommodityCollectionSlot" AS ENUM ('MORNING', 'AFTERNOON');
CREATE TYPE "CommodityCollectionTrigger" AS ENUM ('SCHEDULED', 'MANUAL');
ALTER TABLE "CommoditySnapshot" ADD COLUMN "scheduledSlot" "CommodityCollectionSlot", ADD COLUMN "trigger" "CommodityCollectionTrigger" NOT NULL DEFAULT 'SCHEDULED';
UPDATE "CommoditySnapshot" SET "scheduledSlot" = 'MORNING' WHERE "scheduledSlot" IS NULL;
ALTER TABLE "CommoditySnapshot" ALTER COLUMN "scheduledSlot" SET NOT NULL;
