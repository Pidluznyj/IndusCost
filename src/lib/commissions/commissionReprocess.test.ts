import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateCommissionReprocessSummary,
  assertCanPreviewCommissionReprocess,
  assertCanReprocessCommission,
  buildCommissionReprocessCsv,
  buildCommissionReprocessDiff,
  classifyCommissionReprocessLifecycle,
  COMMISSION_REPROCESS_ENGINE,
  defaultCommissionReprocessFilters,
  groupReprocessAffected,
  hashCommissionReprocessFilters,
  resolveReprocessRowDecision,
  roundCommissionMoney,
  type CommissionReprocessDiffRow,
} from "./commissionReprocess.js";

function row(partial: Partial<CommissionReprocessDiffRow>): CommissionReprocessDiffRow {
  return {
    salesOrderId: "order-1",
    orderCode: "PV-1",
    customerName: "Cliente 1",
    customerExternalId: 1,
    sellerName: "Vendedor 1",
    sellerExternalId: 10,
    lifecycle: "forecast",
    currentAmount: 100,
    recalculatedAmount: 100,
    difference: 0,
    changed: false,
    blocked: false,
    blockReason: null,
    blockMessage: null,
    action: "unchanged",
    snapshotAction: null,
    error: null,
    ...partial,
  };
}

describe("commissionReprocess — engine string", () => {
  it("engine identifica o motor oficial exato", () => {
    assert.equal(
      COMMISSION_REPROCESS_ENGINE,
      "materializeCommissionForSalesOrder+rebuildCommissionReceivableSchedule"
    );
  });
});

describe("commissionReprocess — bloqueio de pagas", () => {
  it("lifecycle paid é sempre bloqueada mesmo com diferença", () => {
    const decision = resolveReprocessRowDecision({
      lifecycle: "paid",
      difference: 50,
      includeConfirmedNotPaid: true,
      includeReleasedNotPaid: true,
      includePaid: true,
    });
    assert.equal(decision.blocked, true);
    assert.equal(decision.blockReason, "PAID_CLOSED_LEDGER");
    assert.equal(decision.action, "blocked");
    assert.equal(decision.changed, false);
  });

  it("classifyCommissionReprocessLifecycle prioriza paid sobre demais sinais", () => {
    const lifecycle = classifyCommissionReprocessLifecycle({
      hasNfe: true,
      hasSettledReceivable: true,
      inClosedLedger: true,
      paidRecord: false,
    });
    assert.equal(lifecycle, "paid");
  });

  it("paidRecord isolado também classifica como paid", () => {
    const lifecycle = classifyCommissionReprocessLifecycle({
      hasNfe: false,
      hasSettledReceivable: false,
      inClosedLedger: false,
      paidRecord: true,
    });
    assert.equal(lifecycle, "paid");
  });

  it("erro sempre bloqueia independente do lifecycle", () => {
    const decision = resolveReprocessRowDecision({
      lifecycle: "forecast",
      difference: 0,
      includeConfirmedNotPaid: true,
      includeReleasedNotPaid: true,
      includePaid: true,
      error: "Pedido sem cliente vinculado.",
    });
    assert.equal(decision.blocked, true);
    assert.equal(decision.blockReason, "ERROR");
    assert.equal(decision.action, "error");
  });
});

describe("commissionReprocess — recalculo de previstas (forecast)", () => {
  it("forecast com diferença relevante e flags padrão recalcula", () => {
    const decision = resolveReprocessRowDecision({
      lifecycle: "forecast",
      difference: 12.5,
      includeConfirmedNotPaid: true,
      includeReleasedNotPaid: false,
      includePaid: false,
    });
    assert.equal(decision.blocked, false);
    assert.equal(decision.action, "recalculate");
    assert.equal(decision.changed, true);
  });

  it("forecast sem diferença relevante (< 0.005) fica unchanged", () => {
    const decision = resolveReprocessRowDecision({
      lifecycle: "forecast",
      difference: 0.001,
      includeConfirmedNotPaid: true,
      includeReleasedNotPaid: false,
      includePaid: false,
    });
    assert.equal(decision.blocked, false);
    assert.equal(decision.action, "unchanged");
    assert.equal(decision.changed, false);
  });

  it("confirmed sem includeConfirmedNotPaid é bloqueada", () => {
    const decision = resolveReprocessRowDecision({
      lifecycle: "confirmed",
      difference: 5,
      includeConfirmedNotPaid: false,
      includeReleasedNotPaid: false,
      includePaid: false,
    });
    assert.equal(decision.blocked, true);
    assert.equal(decision.blockReason, "CONFIRMED_FLAG_OFF");
  });

  it("released sem includeReleasedNotPaid é bloqueada; com flag recalcula", () => {
    const blocked = resolveReprocessRowDecision({
      lifecycle: "released",
      difference: 5,
      includeConfirmedNotPaid: true,
      includeReleasedNotPaid: false,
      includePaid: false,
    });
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.blockReason, "RELEASED_FLAG_OFF");

    const allowed = resolveReprocessRowDecision({
      lifecycle: "released",
      difference: 5,
      includeConfirmedNotPaid: true,
      includeReleasedNotPaid: true,
      includePaid: false,
    });
    assert.equal(allowed.blocked, false);
    assert.equal(allowed.action, "recalculate");
  });
});

describe("commissionReprocess — permissões", () => {
  it("ADMIN e SUPER_ADMIN podem aplicar reprocessamento", () => {
    assert.equal(assertCanReprocessCommission({ role: "ADMIN" }).ok, true);
    assert.equal(assertCanReprocessCommission({ role: "SUPER_ADMIN" }).ok, true);
  });

  it("SELLER não pode aplicar reprocessamento", () => {
    const result = assertCanReprocessCommission({ role: "SELLER" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
    }
  });

  it("preview permite ADMIN, e VIEWER com permissão de comissões", () => {
    assert.equal(assertCanPreviewCommissionReprocess({ role: "ADMIN" }).ok, true);
    assert.equal(
      assertCanPreviewCommissionReprocess({ role: "VIEWER", permissions: ["commissions.view"] }).ok,
      true
    );
  });

  it("preview nega quando não há role/permissão elegível", () => {
    const result = assertCanPreviewCommissionReprocess({ role: "VIEWER", permissions: [] });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
    }
  });

  it("preview aceita hasAnyPermission customizado", () => {
    const result = assertCanPreviewCommissionReprocess({
      role: "VIEWER",
      permissions: [],
      hasAnyPermission: (perms) => perms.includes("commissions.audit.view"),
    });
    assert.equal(result.ok, true);
  });
});

describe("commissionReprocess — diff e agregação", () => {
  it("buildCommissionReprocessDiff arredonda para 2 casas", () => {
    assert.equal(buildCommissionReprocessDiff(100, 100.004), 0);
    assert.equal(buildCommissionReprocessDiff(100, 112.505), 12.5);
  });

  it("roundCommissionMoney evita erro de ponto flutuante", () => {
    assert.equal(roundCommissionMoney(10.005), 10.01);
    assert.equal(roundCommissionMoney(0.1 + 0.2), 0.3);
  });

  it("aggregateCommissionReprocessSummary soma totais e contadores corretamente", () => {
    const rows = [
      row({ currentAmount: 100, recalculatedAmount: 120, difference: 20, changed: true, action: "recalculate" }),
      row({ currentAmount: 50, recalculatedAmount: 50, difference: 0, action: "unchanged" }),
      row({ currentAmount: 30, recalculatedAmount: 30, difference: 0, blocked: true, action: "blocked" }),
      row({ currentAmount: 10, recalculatedAmount: 10, difference: 0, action: "error", error: "falhou" }),
    ];
    const summary = aggregateCommissionReprocessSummary(rows);
    assert.equal(summary.analyzedCount, 4);
    assert.equal(summary.changedCount, 1);
    assert.equal(summary.blockedCount, 1);
    assert.equal(summary.errorCount, 1);
    assert.equal(summary.currentTotal, 190);
    assert.equal(summary.recalculatedTotal, 210);
    assert.equal(summary.differenceTotal, 20);
  });

  it("groupReprocessAffected agrupa apenas linhas changed/blocked por vendedor e cliente", () => {
    const rows = [
      row({ salesOrderId: "o1", changed: true, difference: 10, sellerExternalId: 1, sellerName: "A", customerExternalId: 1, customerName: "C1" }),
      row({ salesOrderId: "o2", changed: true, difference: 5, sellerExternalId: 1, sellerName: "A", customerExternalId: 2, customerName: "C2" }),
      row({ salesOrderId: "o3", changed: false, blocked: false, action: "unchanged" }),
    ];
    const grouped = groupReprocessAffected(rows);
    assert.equal(grouped.affectedOrders.length, 2);
    assert.equal(grouped.affectedBySeller.length, 1);
    assert.equal(grouped.affectedBySeller[0]?.count, 2);
    assert.equal(grouped.affectedBySeller[0]?.difference, 15);
    assert.equal(grouped.affectedByCustomer.length, 2);
  });

  it("buildCommissionReprocessCsv gera cabeçalho e linhas separadas por ;", () => {
    const csv = buildCommissionReprocessCsv([row({})]);
    const lines = csv.split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /^pedido;cliente;vendedor;status/);
    assert.match(lines[1]!, /^PV-1;Cliente 1;Vendedor 1;forecast/);
  });
});

describe("commissionReprocess — estabilidade de hash", () => {
  it("mesmos filtros geram o mesmo hash", () => {
    const filters = defaultCommissionReprocessFilters({ customerExternalId: 42, salesOrderCode: "pv-1" });
    const h1 = hashCommissionReprocessFilters(filters);
    const h2 = hashCommissionReprocessFilters({ ...filters });
    assert.equal(h1, h2);
    assert.equal(h1.length, 32);
  });

  it("hash é insensível a maiúsculas/minúsculas em salesOrderCode/productCode", () => {
    const a = hashCommissionReprocessFilters(
      defaultCommissionReprocessFilters({ salesOrderCode: "pv-100", productCode: "sku-1" })
    );
    const b = hashCommissionReprocessFilters(
      defaultCommissionReprocessFilters({ salesOrderCode: "PV-100", productCode: "SKU-1" })
    );
    assert.equal(a, b);
  });

  it("hash é insensível à ordem de statuses", () => {
    const a = hashCommissionReprocessFilters(
      defaultCommissionReprocessFilters({ statuses: ["paid", "forecast"] })
    );
    const b = hashCommissionReprocessFilters(
      defaultCommissionReprocessFilters({ statuses: ["forecast", "paid"] })
    );
    assert.equal(a, b);
  });

  it("hash muda quando um filtro relevante muda", () => {
    const a = hashCommissionReprocessFilters(defaultCommissionReprocessFilters({ customerExternalId: 1 }));
    const b = hashCommissionReprocessFilters(defaultCommissionReprocessFilters({ customerExternalId: 2 }));
    assert.notEqual(a, b);
  });

  it("defaultCommissionReprocessFilters aplica defaults esperados", () => {
    const filters = defaultCommissionReprocessFilters();
    assert.equal(filters.dateAxis, "issue");
    assert.equal(filters.includeConfirmedNotPaid, true);
    assert.equal(filters.includeReleasedNotPaid, false);
    assert.equal(filters.includePaid, false);
    assert.deepEqual(filters.statuses, ["forecast", "confirmed", "released", "paid"]);
  });
});
