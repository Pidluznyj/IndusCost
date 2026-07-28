-- Parametrização de papéis de centro de custo na DRE Gerencial.
CREATE TABLE IF NOT EXISTS "FinancialDreCostCenterMapping" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "costCenterId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SEED',
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinancialDreCostCenterMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FinancialDreCostCenterMapping_costCenterId_key"
  ON "FinancialDreCostCenterMapping"("costCenterId");

CREATE INDEX IF NOT EXISTS "FinancialDreCostCenterMapping_role_idx"
  ON "FinancialDreCostCenterMapping"("role");

CREATE INDEX IF NOT EXISTS "FinancialDreCostCenterMapping_source_idx"
  ON "FinancialDreCostCenterMapping"("source");

ALTER TABLE "FinancialDreCostCenterMapping"
  ADD CONSTRAINT "FinancialDreCostCenterMapping_costCenterId_fkey"
  FOREIGN KEY ("costCenterId") REFERENCES "FinancialCostCenter"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "FinancialDreCostCenterMapping"
  ADD CONSTRAINT "FinancialDreCostCenterMapping_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
