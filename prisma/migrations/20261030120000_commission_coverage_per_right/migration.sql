-- B4 (N:N de comissões): cobertura por DIREITO (pedido) dentro do evento de recebimento.
--
-- Evento financeiro (NomusReceivableReceipt) continua único. Um recebimento pode ser
-- coberto de duas formas, nunca as duas ao mesmo tempo:
--   * por EVENTO (salesOrderId NULL): cobre todos os direitos do recebimento — é a
--     forma de TODO registro existente (legado Nomus, ajustes, fechamentos IndusCost
--     anteriores a esta migration) e de linhas sem pedido ("sem vínculo de venda");
--   * por DIREITO (salesOrderId preenchido): cobre só aquele pedido; os demais
--     pedidos do mesmo recebimento continuam pendentes.
--
-- Compatibilidade: nenhuma linha existente muda (todas ficam como cobertura do evento,
-- exatamente a semântica que tinham). Sem backfill. Fechamentos CLOSED intocados.
-- Rollback: docs/commissions/rollback/20261030120000_commission_coverage_per_right.rollback.sql (seguro enquanto não houver cobertura por direito).

-- Ledger: pedido e schedule do direito (sem FK: linha de fechamento CLOSED é imutável).
ALTER TABLE "CommissionReceiptLedgerLine" ADD COLUMN     "commissionReceivableScheduleId" UUID,
ADD COLUMN     "salesOrderId" UUID;

-- Cobertura: direito coberto.
ALTER TABLE "CommissionReceiptCoverage" ADD COLUMN     "commissionReceivableScheduleId" UUID,
ADD COLUMN     "salesOrderId" UUID;

CREATE INDEX "CommissionReceiptLedgerLine_salesOrderId_idx" ON "CommissionReceiptLedgerLine"("salesOrderId");
CREATE INDEX "CommissionReceiptCoverage_salesOrderId_idx" ON "CommissionReceiptCoverage"("salesOrderId");

-- Unicidade: o índice único por evento passa a valer só para cobertura do evento;
-- cobertura por direito é única por (evento, pedido).
DROP INDEX IF EXISTS "CommissionReceiptCoverage_receipt_covered_key";

CREATE UNIQUE INDEX "CommissionReceiptCoverage_receipt_event_covered_key"
  ON "CommissionReceiptCoverage" ("receiptExternalId")
  WHERE "coverageStatus" = 'COVERED' AND "receiptExternalId" IS NOT NULL AND "salesOrderId" IS NULL;

CREATE UNIQUE INDEX "CommissionReceiptCoverage_receipt_right_covered_key"
  ON "CommissionReceiptCoverage" ("receiptExternalId", "salesOrderId")
  WHERE "coverageStatus" = 'COVERED' AND "receiptExternalId" IS NOT NULL AND "salesOrderId" IS NOT NULL;

-- Exclusão mútua evento × direito (não cabe num índice): trigger com lock por
-- recebimento — duas transações concorrentes sobre o mesmo evento serializam.
CREATE OR REPLACE FUNCTION "commission_receipt_coverage_scope_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."coverageStatus" <> 'COVERED' OR NEW."receiptExternalId" IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('CommissionReceiptCoverage'), NEW."receiptExternalId");
  IF NEW."salesOrderId" IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM "CommissionReceiptCoverage" c
      WHERE c."receiptExternalId" = NEW."receiptExternalId"
        AND c."coverageStatus" = 'COVERED'
        AND c."salesOrderId" IS NOT NULL
        AND c."id" <> NEW."id"
    ) THEN
      RAISE EXCEPTION 'Recebimento % já tem cobertura por direito; cobertura do evento inteiro recusada.', NEW."receiptExternalId"
        USING ERRCODE = 'unique_violation', CONSTRAINT = 'CommissionReceiptCoverage_receipt_scope_key';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM "CommissionReceiptCoverage" c
      WHERE c."receiptExternalId" = NEW."receiptExternalId"
        AND c."coverageStatus" = 'COVERED'
        AND c."salesOrderId" IS NULL
        AND c."id" <> NEW."id"
    ) THEN
      RAISE EXCEPTION 'Recebimento % já coberto como evento inteiro; cobertura do direito % recusada.', NEW."receiptExternalId", NEW."salesOrderId"
        USING ERRCODE = 'unique_violation', CONSTRAINT = 'CommissionReceiptCoverage_receipt_scope_key';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CommissionReceiptCoverage_scope_guard"
  BEFORE INSERT OR UPDATE OF "coverageStatus", "salesOrderId", "receiptExternalId"
  ON "CommissionReceiptCoverage"
  FOR EACH ROW EXECUTE FUNCTION "commission_receipt_coverage_scope_guard"();
