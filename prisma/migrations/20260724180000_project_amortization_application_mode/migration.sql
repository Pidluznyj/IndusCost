-- Per-item amortization application mode: COST (legacy default) vs FINAL_PRICE (pass-through after margin).

CREATE TYPE "ProjectAmortizationApplicationMode" AS ENUM ('COST', 'FINAL_PRICE');

ALTER TABLE "ProjectCostAmortizationAllocation"
ADD COLUMN "applicationMode" "ProjectAmortizationApplicationMode" NOT NULL DEFAULT 'COST',
ADD COLUMN "costComponentUnit" DECIMAL(20, 6) NOT NULL DEFAULT 0,
ADD COLUMN "priceAddOnUnit" DECIMAL(20, 6) NOT NULL DEFAULT 0;

-- Backfill existing rows: preserve COST behavior (amortization entered unit cost).
UPDATE "ProjectCostAmortizationAllocation"
SET
  "applicationMode" = 'COST',
  "costComponentUnit" = "unitAmortizedCost",
  "priceAddOnUnit" = 0;
