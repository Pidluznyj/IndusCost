-- Idempotência da Conferência de Estoque (header Idempotency-Key).
-- Aditivo: não altera quantity, custos nem histórico existente.

ALTER TABLE "MaterialStockConference"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "MaterialStockConference_idempotencyKey_key"
  ON "MaterialStockConference"("idempotencyKey");
