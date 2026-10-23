-- Rollback técnico de 20261031120000_commission_snapshot_invoice_allocation (manual,
-- com backup). Antes: desligar COMMISSION_INVOICE_ALLOCATION_ENABLED e rematerializar
-- os pedidos afetados, para que nenhum snapshot ACTIVE fique INVOICED_ALLOCATION ou
-- ALLOCATION_PENDING (conferir: SELECT count(*) FROM "CommissionOrderSnapshot"
-- WHERE status = 'ACTIVE' AND "allocationBasis" <> 'FULL_ORDER_LEGACY').
ALTER TABLE "CommissionOrderItemSnapshot" DROP COLUMN IF EXISTS "allocationEvidenceJson",
DROP COLUMN IF EXISTS "cumulativeInvoicedQuantity",
DROP COLUMN IF EXISTS "invoicedQuantity",
DROP COLUMN IF EXISTS "itemFullCommissionAmount",
DROP COLUMN IF EXISTS "itemFullSoldAmount",
DROP COLUMN IF EXISTS "orderedQuantity";
ALTER TABLE "CommissionOrderSnapshot" DROP COLUMN IF EXISTS "allocationBasis";
DROP TYPE IF EXISTS "CommissionOrderSnapshotAllocationBasis";
