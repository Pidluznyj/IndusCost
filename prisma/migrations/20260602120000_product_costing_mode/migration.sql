-- Modo de custeio do produto/componente.
-- Default OWN_PROCESS preserva totalmente o comportamento atual de todos os registros.

CREATE TYPE "ProductCostingMode" AS ENUM ('OWN_PROCESS', 'BOM_ONLY', 'FINISHING_SERVICE');

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "costingMode" "ProductCostingMode" NOT NULL DEFAULT 'OWN_PROCESS';

CREATE INDEX IF NOT EXISTS "idx_Product_costingMode" ON "Product"("costingMode");
