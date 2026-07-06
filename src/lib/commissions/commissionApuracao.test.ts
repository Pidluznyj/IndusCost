import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildApuracaoLine,
  buildApuracaoLines,
  computeApuracaoTotals,
  isApuracaoLinePayable,
  resolveApuracaoLineStatus,
} from "./commissionApuracao.js";

describe("commissionApuracao", () => {
  const baseRecord = {
    id: "rec-1",
    status: "WAITING_PAYMENT" as const,
    orderCode: "PV-100",
    nfeNumber: "12345",
    nomusNfeId: 999,
    customerName: "Cliente A",
    productCode: "P1",
    productName: "Produto",
    baseAmount: 1000,
    ratePercent: 2.5,
    commissionAmount: 25,
    releasedAmount: 0,
    paidAmount: 0,
    balanceAmount: 25,
    calculatedAt: "2026-06-15T12:00:00.000Z",
    confirmedAt: "2026-06-10T12:00:00.000Z",
    commissionPersonId: "person-1",
    commissionPersonName: "GISLENE LIMA",
    metadataJson: {
      tierCode: "VAREJO_1",
      tierName: "Varejo 1",
      ruleName: "Regra faixa comercial",
      calculationType: "COMMERCIAL_PRICE_TIER",
    },
    hasOpenAuditIssue: false,
    auditIssueTypes: [],
  };

  it("resolveApuracaoLineStatus — pendente recebimento", () => {
    assert.equal(
      resolveApuracaoLineStatus("WAITING_PAYMENT", 0, 0, 25, false),
      "PENDENTE_RECEBIMENTO"
    );
  });

  it("linha com recebimento parcial libera comissão proporcional", () => {
    const line = buildApuracaoLine({
      ...baseRecord,
      schedule: {
        id: "sch-1",
        nomusReceivableId: 464001,
        installmentNumber: 1,
        dueDate: "2026-07-01T00:00:00.000Z",
        receivableAmount: 1000,
        receivedAmount: 500,
        commissionExpectedAmount: 12.5,
        commissionReleasedAmount: 6.25,
      },
    });
    assert.equal(line.calculationBase, 500);
    assert.equal(line.commissionCalculated, 12.5);
    assert.equal(line.commissionReleased, 6.25);
    assert.equal(line.duplicateAmount, 1000);
    assert.equal(line.commercialTierName, "Varejo 1");
  });

  it("linha bloqueada por auditoria", () => {
    const line = buildApuracaoLine({
      ...baseRecord,
      hasOpenAuditIssue: true,
      auditIssueTypes: ["NO_COMMERCIAL_PRICE_TABLE"],
      schedule: null,
    });
    assert.equal(line.apuracaoStatus, "DIVERGENTE");
    assert.equal(line.blockReason, "Sem tabela comercial");
    assert.equal(isApuracaoLinePayable(line), false);
  });

  it("totalização por vendedor", () => {
    const lines = buildApuracaoLines([
      { ...baseRecord, schedule: null },
      {
        ...baseRecord,
        id: "rec-2",
        commissionAmount: 15,
        baseAmount: 600,
        schedule: null,
      },
    ]);
    const totals = computeApuracaoTotals(lines, {
      base: 808107.32,
      commission: 20926.56,
    });
    assert.equal(totals.commissionCalculatedTotal, 40);
    assert.equal(totals.nomusReferenceCommission, 20926.56);
    assert.ok(totals.nomusDiffAmount != null);
  });

  it("não gera NaN em percentual zero", () => {
    const line = buildApuracaoLine({
      ...baseRecord,
      ratePercent: 0,
      commissionAmount: 0,
      schedule: null,
    });
    assert.ok(Number.isFinite(line.ratePercent));
    assert.ok(Number.isFinite(line.commissionCalculated));
  });
});

describe("buildCommissionRecordPeriodWhere confirmedAt", () => {
  it("módulo de query exporta periodBasis confirmedAt para confirmadas", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const q = readFileSync(join(process.cwd(), "src/lib/commissions/commissionQuery.ts"), "utf8");
    assert.match(q, /periodBasis.*confirmedAt/);
    const confirmed = readFileSync(
      join(process.cwd(), "src/lib/commissions/commissionConfirmed.server.ts"),
      "utf8"
    );
    assert.match(confirmed, /periodBasis: "confirmedAt"/);
  });
});
