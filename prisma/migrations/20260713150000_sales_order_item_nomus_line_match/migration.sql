-- Status é aplicado por LINHA do item do Pedido de Venda, não por SKU/produto.
-- Adiciona flag de corte + rastreio do casamento raw x local por linha.

ALTER TABLE "SalesOrderItem"
  ADD COLUMN IF NOT EXISTS "nomusIsCut" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "nomusMatchConfidence" TEXT,
  ADD COLUMN IF NOT EXISTS "nomusMatchReason" TEXT;

CREATE INDEX IF NOT EXISTS "SalesOrderItem_nomusIsCut_idx"
  ON "SalesOrderItem"("nomusIsCut");

CREATE INDEX IF NOT EXISTS "SalesOrderItem_nomusMatchConfidence_idx"
  ON "SalesOrderItem"("nomusMatchConfidence");
