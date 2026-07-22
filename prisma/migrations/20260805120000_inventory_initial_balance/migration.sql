-- OP-10 — Saldo inicial auditável + evidência referenciada.
-- Aditivo. Sem preenchimento direto de InventoryBalance.

ALTER TYPE "InventoryMovementType" ADD VALUE IF NOT EXISTS 'INITIAL_BALANCE';

ALTER TABLE "InventoryMovement" ADD COLUMN IF NOT EXISTS "evidenceRef" TEXT;
