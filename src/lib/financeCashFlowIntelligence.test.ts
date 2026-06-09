import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCashFlowExecutiveReading,
  buildNetCashPositionMetrics,
  resolveMonthlyNetStatus,
} from "./financeCashFlowIntelligence.js";

describe("financeCashFlowIntelligence", () => {
  it("netCashPosition = receber − pagar", () => {
    const m = buildNetCashPositionMetrics(1_000_000, 250_000);
    assert.equal(m.netCashPosition, 750_000);
    assert.equal(m.netCashPositionStatus, "surplus");
    assert.equal(m.netCashPositionAbs, 750_000);
    assert.equal(m.netCashPositionLabel, "Superávit projetado");
    assert.equal(m.cashNeedAmount, 0);
    assert.equal(m.cashNeedLabel, "Folga projetada");
  });

  it("déficit calcula necessidade de caixa", () => {
    const m = buildNetCashPositionMetrics(100_000, 500_000);
    assert.equal(m.netCashPosition, -400_000);
    assert.equal(m.netCashPositionStatus, "deficit");
    assert.equal(m.netCashPositionLabel, "Déficit projetado");
    assert.equal(m.cashNeedAmount, 400_000);
    assert.equal(m.cashNeedLabel, "Necessidade de caixa");
  });

  it("cashCoverageRatio evita NaN quando pagar = 0", () => {
    assert.equal(buildNetCashPositionMetrics(0, 0).cashCoverageRatio, null);
    assert.equal(buildNetCashPositionMetrics(500, 0).cashCoverageRatio, null);
    const ratio = buildNetCashPositionMetrics(1_000, 500).cashCoverageRatio;
    assert.ok(ratio != null && Number.isFinite(ratio));
    assert.equal(ratio, 2);
  });

  it("status mensal positivo e negativo", () => {
    assert.equal(resolveMonthlyNetStatus(10), "positive");
    assert.equal(resolveMonthlyNetStatus(-1), "negative");
    assert.equal(resolveMonthlyNetStatus(0), "positive");
    assert.equal(resolveMonthlyNetStatus(null), null);
  });

  it("leitura executiva — déficit e vencidos", () => {
    const lines = buildCashFlowExecutiveReading({
      cards: {
        netCashPosition: -50_000,
        netCashPositionAbs: 50_000,
        netCashPositionStatus: "deficit",
        overdueReceivableAmount: 10_000,
        overduePayableAmount: 5_000,
        negativeBalanceMonthsCount: 2,
      },
    });
    assert.ok(lines.some((l) => l.includes("déficit")));
    assert.ok(lines.some((l) => l.includes("vencidos a receber")));
    assert.ok(lines.some((l) => l.includes("pagamentos vencidos")));
    assert.ok(lines.some((l) => l.includes("2 meses")));
  });

  it("leitura executiva — superávit e concentração", () => {
    const lines = buildCashFlowExecutiveReading({
      cards: {
        netCashPosition: 80_000,
        netCashPositionAbs: 80_000,
        netCashPositionStatus: "surplus",
        overdueReceivableAmount: 0,
        overduePayableAmount: 0,
        negativeBalanceMonthsCount: 0,
      },
      topCustomer: {
        personName: "Cliente Alpha",
        personCnpj: null,
        amount: 900,
        titlesCount: 1,
        percentOfTotal: 45,
      },
    });
    assert.ok(lines.some((l) => l.includes("folga")));
    assert.ok(lines.some((l) => l.includes("Cliente Alpha")));
  });
});
