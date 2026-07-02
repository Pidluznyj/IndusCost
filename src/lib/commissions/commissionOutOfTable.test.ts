import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildApuracaoLine,
  isApuracaoLinePayable,
} from "./commissionApuracao.js";
import {
  hasBlockingCommissionAuditTypes,
  isNonBlockingCommissionAuditType,
  OUT_OF_TABLE_COMMISSION_PERCENT,
  OUT_OF_TABLE_PRICE_AUDIT_TYPE,
  OUT_OF_TABLE_TIER_CODE,
} from "./commissionOutOfTable.js";

describe("commissionOutOfTable", () => {
  it("OUT_OF_TABLE_PRICE_COMMISSION não é bloqueante", () => {
    assert.equal(isNonBlockingCommissionAuditType(OUT_OF_TABLE_PRICE_AUDIT_TYPE), true);
    assert.equal(hasBlockingCommissionAuditTypes([OUT_OF_TABLE_PRICE_AUDIT_TYPE]), false);
  });

  it("NO_COMMERCIAL_PRICE_TABLE continua bloqueante", () => {
    assert.equal(hasBlockingCommissionAuditTypes(["NO_COMMERCIAL_PRICE_TABLE"]), true);
  });

  it("apuração com alerta fora da tabela permanece pagável quando liberada", () => {
    const line = buildApuracaoLine({
      id: "rec-o",
      status: "RELEASED",
      orderCode: "PV-1",
      nfeNumber: "100",
      nomusNfeId: 1,
      customerName: "Cliente",
      productCode: "P1",
      productName: "Produto",
      baseAmount: 1000,
      ratePercent: OUT_OF_TABLE_COMMISSION_PERCENT,
      commissionAmount: 10,
      releasedAmount: 10,
      paidAmount: 0,
      balanceAmount: 0,
      calculatedAt: "2026-06-01T00:00:00.000Z",
      confirmedAt: "2026-06-01T00:00:00.000Z",
      commissionPersonId: "p1",
      commissionPersonName: "Vendedor",
      metadataJson: {
        tierCode: OUT_OF_TABLE_TIER_CODE,
        tierName: "Preço fora da tabela",
        outOfTablePrice: true,
      },
      auditIssueTypes: [OUT_OF_TABLE_PRICE_AUDIT_TYPE],
      hasBlockingAuditIssue: false,
      outOfTablePrice: true,
      schedule: null,
    });
    assert.equal(line.outOfTablePrice, true);
    assert.equal(line.apuracaoStatus, "LIBERADA");
    assert.equal(line.blockReason, null);
    assert.equal(isApuracaoLinePayable(line), true);
  });
});
