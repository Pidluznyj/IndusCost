import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCriticalOrders,
  buildExtendedMetricsFromOrders,
  buildLogisticStatusBreakdown,
  buildManufacturingStatusBreakdown,
  buildOpenPortfolioEvolution,
  buildTopSellersFromOrders,
  enrichOrdersWithLogisticStatus,
  filterOrdersByLogisticStatus,
  financeSalesOrdersExtendedMetricsAreFinite,
  type FinanceSalesOrdersDashboardOrderRow,
} from "./financeSalesOrdersExtendedMetrics.js";
import {
  MANUFACTURING_STATUS_LABELS,
  resolveItemManufacturingStatusCode,
  resolveOrderManufacturingStatusCode,
} from "./financeSalesOrdersManufacturingStatus.js";
import { buildSalesOrderBiLogisticStatus } from "./salesOrderLogisticStatus.js";

const REF = new Date(2026, 5, 15);

function baseOrder(
  partial: Partial<FinanceSalesOrdersDashboardOrderRow> = {}
): FinanceSalesOrdersDashboardOrderRow {
  return {
    id: "o1",
    orderCode: "PD-001",
    issueDate: new Date(2026, 2, 10),
    expectedDeliveryDate: new Date(2026, 2, 20),
    totalNetValue: 10_000,
    responsible: "Ana",
    customerId: "c1",
    customerName: "Cliente A",
    nomusRawResponse: {
      itensPedido: [{ status: 2, quantidade: 5 }],
    },
    updatedAt: new Date(2026, 2, 11),
    sentToNomusAt: new Date(2026, 2, 11),
    ...partial,
  };
}

describe("financeSalesOrdersManufacturingStatus", () => {
  it("mapeia códigos Nomus 1–6", () => {
    assert.equal(resolveItemManufacturingStatusCode(1), "1");
    assert.equal(resolveItemManufacturingStatusCode("2"), "2");
    assert.equal(resolveItemManufacturingStatusCode("Liberado"), "2");
    assert.equal(resolveItemManufacturingStatusCode(6), "6");
    assert.equal(MANUFACTURING_STATUS_LABELS["3"], "Atendido parcialmente");
  });

  it("pedido usa item mais pendente", () => {
    const code = resolveOrderManufacturingStatusCode({
      itensPedido: [{ status: 4 }, { status: 2 }],
    });
    assert.equal(code, "2");
  });
});

describe("financeSalesOrdersExtendedMetrics", () => {
  it("KPIs e agregações sem NaN", () => {
    const orders = [
      baseOrder({ id: "o1", totalNetValue: 10_000, responsible: "Ana" }),
      baseOrder({
        id: "o2",
        orderCode: "PD-002",
        totalNetValue: 5_000,
        responsible: "Bruno",
        nomusRawResponse: {
          itensPedido: [{ status: 1, quantidade: 1 }],
          nfes: [{ dataProcessamento: "10/03/2026" }],
        },
        expectedDeliveryDate: new Date(2026, 2, 15),
      }),
    ];
    const metrics = buildExtendedMetricsFromOrders({
      orders,
      filters: {
        year: 2026,
        month: null,
        company: null,
        customerId: null,
        customerSearch: null,
        sellerName: null,
        status: null,
        invoiceStatus: "all",
        logisticStatus: null,
      },
      referenceDate: REF,
    });
    assert.ok(financeSalesOrdersExtendedMetricsAreFinite(metrics));
    assert.equal(metrics.topSellers.length, 2);
    assert.equal(metrics.manufacturingStatusBreakdown.some((r) => r.orderCount > 0), true);
    assert.equal(metrics.logisticStatusBreakdown.length, 6);
  });

  it("filtro por status logístico BI", () => {
    const enriched = enrichOrdersWithLogisticStatus(
      [
        baseOrder({
          id: "late",
          expectedDeliveryDate: new Date(2026, 0, 1),
          nomusRawResponse: { itensPedido: [{ status: 2 }] },
        }),
        baseOrder({
          id: "ok",
          nomusRawResponse: {
            itensPedido: [{ status: 4 }],
            nfes: [{ dataProcessamento: "05/03/2026" }],
          },
          expectedDeliveryDate: new Date(2026, 2, 20),
        }),
      ],
      REF
    );
    const overdue = filterOrdersByLogisticStatus(enriched, "overduePending");
    assert.equal(overdue.length, 1);
    assert.equal(overdue[0]?.id, "late");
  });

  it("status logístico BI — NF no prazo vs atraso", () => {
    const onTime = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 2, 20),
      nomusRawResponse: { nfes: [{ dataProcessamento: "15/03/2026" }] },
      referenceDate: REF,
    });
    assert.equal(onTime.label, "Entregue no Prazo");

    const late = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 2, 10),
      nomusRawResponse: { nfes: [{ dataProcessamento: "15/03/2026" }] },
      referenceDate: REF,
    });
    assert.equal(late.label, "Entregue com Atraso");
  });

  it("top clientes/vendedores por valor", () => {
    const rows = [
      baseOrder({ responsible: "Ana", totalNetValue: 30_000 }),
      baseOrder({ id: "o2", responsible: "Ana", totalNetValue: 20_000 }),
      baseOrder({ id: "o3", responsible: "Bruno", totalNetValue: 10_000 }),
    ];
    const sellers = buildTopSellersFromOrders(rows);
    assert.equal(sellers[0]?.sellerName, "Ana");
    assert.equal(sellers[0]?.amount, 50_000);
    assert.equal(sellers[0]?.orderCount, 2);
    assert.ok((sellers[0]?.sharePercent ?? 0) > 80);
  });

  it("comparativo / evolução carteira por mês de emissão", () => {
    const rows = [
      baseOrder({ issueDate: new Date(2026, 0, 5), totalNetValue: 1_000 }),
      baseOrder({
        id: "o2",
        issueDate: new Date(2026, 0, 8),
        totalNetValue: 2_000,
        nomusRawResponse: { nfes: [{ dataProcessamento: "10/01/2026" }] },
      }),
    ];
    const evolution = buildOpenPortfolioEvolution(rows, 2026);
    assert.equal(evolution[0]?.month, 1);
    assert.equal(evolution[0]?.openAmount, 1_000);
    assert.equal(evolution[0]?.issuedAmount, 3_000);
  });

  it("pedidos críticos inclui atrasado e revisar dados", () => {
    const enriched = enrichOrdersWithLogisticStatus(
      [
        baseOrder({
          id: "crit",
          expectedDeliveryDate: new Date(2026, 0, 1),
          nomusRawResponse: { itensPedido: [{ status: 2 }] },
        }),
        baseOrder({
          id: "review",
          expectedDeliveryDate: null,
          nomusRawResponse: { itensPedido: [{ status: 2 }] },
        }),
      ],
      REF
    );
    const critical = buildCriticalOrders(enriched);
    assert.ok(critical.some((c) => c.reasons.includes("overdue_pending")));
    assert.ok(critical.some((c) => c.reasons.includes("review_data")));
  });

  it("estado vazio retorna zeros", () => {
    const metrics = buildExtendedMetricsFromOrders({
      orders: [],
      filters: {
        year: 2026,
        month: null,
        company: null,
        customerId: null,
        customerSearch: null,
        sellerName: null,
        status: null,
        invoiceStatus: "all",
        logisticStatus: null,
      },
    });
    assert.equal(metrics.topSellers.length, 0);
    assert.equal(metrics.criticalOrders.length, 0);
    assert.equal(
      metrics.manufacturingStatusBreakdown.every((r) => r.amount === 0 && r.orderCount === 0),
      true
    );
    assert.equal(
      metrics.logisticStatusBreakdown.every((r) => r.amount === 0 && r.orderCount === 0),
      true
    );
  });

  it("manufacturing breakdown por código", () => {
    const breakdown = buildManufacturingStatusBreakdown([
      baseOrder({ nomusRawResponse: { itensPedido: [{ status: 1 }] } }),
      baseOrder({
        id: "o2",
        nomusRawResponse: { itensPedido: [{ status: "Liberado" }] },
      }),
    ]);
    const awaiting = breakdown.find((r) => r.code === "1");
    const released = breakdown.find((r) => r.code === "2");
    assert.equal(awaiting?.orderCount, 1);
    assert.equal(released?.orderCount, 1);
  });

  it("logistic breakdown soma pedidos", () => {
    const enriched = enrichOrdersWithLogisticStatus([baseOrder()], REF);
    const breakdown = buildLogisticStatusBreakdown(enriched);
    const totalCount = breakdown.reduce((s, r) => s + r.orderCount, 0);
    assert.equal(totalCount, 1);
  });
});
