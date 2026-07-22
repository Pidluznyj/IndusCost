-- OP-11 — Reservas, bloqueios e quarentena (aditivo).
-- Sem integração automática com OP/pedido de venda.

ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'QUARANTINE_IN';
ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'QUARANTINE_OUT';

ALTER TABLE "InventoryReservation" ADD COLUMN IF NOT EXISTS "responsibleUserId" TEXT;
ALTER TABLE "InventoryReservation" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMPTZ(6);

ALTER TABLE "InventoryBlock" ADD COLUMN IF NOT EXISTS "responsibleUserId" TEXT;

CREATE INDEX IF NOT EXISTS "InventoryReservation_responsibleUserId_idx"
  ON "InventoryReservation"("responsibleUserId");
CREATE INDEX IF NOT EXISTS "InventoryReservation_expiresAt_idx"
  ON "InventoryReservation"("expiresAt");
CREATE INDEX IF NOT EXISTS "InventoryBlock_responsibleUserId_idx"
  ON "InventoryBlock"("responsibleUserId");
