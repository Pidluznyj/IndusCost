-- OP-09 — Ledger imutável: custo informativo + idempotência por origem.
-- Aditivo. Não conecta recebimento de compra.

ALTER TABLE "InventoryMovement" ADD COLUMN "unitCost" DECIMAL(20,6);
ALTER TABLE "InventoryMovement" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "InventoryMovement_idempotencyKey_key"
  ON "InventoryMovement"("idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

-- Idempotência quando há chave de origem (originType + originId).
CREATE UNIQUE INDEX "InventoryMovement_originType_originId_key"
  ON "InventoryMovement"("originType", "originId")
  WHERE "originId" IS NOT NULL;
