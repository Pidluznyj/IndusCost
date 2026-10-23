-- Rollback técnico de 20261030120000_commission_coverage_per_right (NÃO é aplicado pelo
-- Prisma; executar manualmente, com backup, só se a migration precisar ser desfeita).
--
-- Pré-condição: nenhum evento com mais de um registro COVERED. Conferir antes:
--   SELECT "receiptExternalId", count(*) FROM "CommissionReceiptCoverage"
--   WHERE "coverageStatus" = 'COVERED' AND "receiptExternalId" IS NOT NULL
--   GROUP BY 1 HAVING count(*) > 1;
-- Se houver linhas, o rollback recriaria o índice antigo com conflito: decidir antes
-- (cancelar o fechamento que gerou a cobertura por direito, pelo fluxo oficial).

DROP TRIGGER IF EXISTS "CommissionReceiptCoverage_scope_guard" ON "CommissionReceiptCoverage";
DROP FUNCTION IF EXISTS "commission_receipt_coverage_scope_guard"();
DROP INDEX IF EXISTS "CommissionReceiptCoverage_receipt_right_covered_key";
DROP INDEX IF EXISTS "CommissionReceiptCoverage_receipt_event_covered_key";
CREATE UNIQUE INDEX "CommissionReceiptCoverage_receipt_covered_key"
  ON "CommissionReceiptCoverage" ("receiptExternalId")
  WHERE "coverageStatus" = 'COVERED' AND "receiptExternalId" IS NOT NULL;
DROP INDEX IF EXISTS "CommissionReceiptCoverage_salesOrderId_idx";
DROP INDEX IF EXISTS "CommissionReceiptLedgerLine_salesOrderId_idx";
ALTER TABLE "CommissionReceiptCoverage" DROP COLUMN IF EXISTS "salesOrderId", DROP COLUMN IF EXISTS "commissionReceivableScheduleId";
ALTER TABLE "CommissionReceiptLedgerLine" DROP COLUMN IF EXISTS "salesOrderId", DROP COLUMN IF EXISTS "commissionReceivableScheduleId";
