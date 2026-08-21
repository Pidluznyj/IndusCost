-- Additive: capacidades autônomas do Stock Collector (DEVICE).
-- DEFAULT true preserva devices existentes já autorizados no registry.

ALTER TABLE "InventoryCollectorDevice"
  ADD COLUMN "canManageCountSessions" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "InventoryCollectorDevice"
  ADD COLUMN "canApplyCountAdjustments" BOOLEAN NOT NULL DEFAULT true;
