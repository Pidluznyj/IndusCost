import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildManagementRowsFromOrders,
  buildSalesOrderManagementCards,
} from "./salesOrderManagement.js";
import {
  BI_LOGISTIC_STATUS_CARDS,
  assertManagementCardsReconciliation,
  buildManagementDashboardCards,
  sumManagementStatusCardAmounts,
  sumManagementStatusCardCounts,
} from "./salesOrderManagementStatus.js";

const REF = new Date(2026, 5, 15);

function orderBase(overrides: Record<string, unknown> = {}) {
  return {
    id: "so-1",
    orderCode: "PD 02580",
    status: "SENT_TO_NOMUS",
    issueDate: new Date(2026, 4, 10),
    expectedDeliveryDate: new Date(2026, 5, 1),
    totalNetValue: 10000,
    responsible: "Vendedor A",
    companyIssuer: "Empresa 1",
    nomusRawResponse: {
      itensPedido: [
        {
          idProduto: 1,
          codigoProduto: "SKU-1",
          status: 2,
          quantidade: 10,
          quantidadeAtendida: 0,
          quantidadeFaturada: 0,
        },
      ],
      nfes: [],
    },
    Customer: { companyName: "Cliente X", tradeName: null, taxId: "12.345.678/0001-99" },
    items: [
      {
        id: "item-1",
        externalProductId: 1,
        skuSnapshot: "SKU-1",
        productNameSnapshot: "Produto A",
        quantity: 10,
      },
    ],
    ...overrides,
  };
}

describe("salesOrderManagementDashboard — Status Logístico BI", () => {
  it("cards cobrem 6 categorias BI + total", () => {
    assert.equal(BI_LOGISTIC_STATUS_CARDS.length, 6);
    assert.ok(BI_LOGISTIC_STATUS_CARDS.some((c) => c.label === "Entregue no Prazo"));
    assert.ok(BI_LOGISTIC_STATUS_CARDS.some((c) => c.label === "Entregue com Atraso"));
    assert.ok(BI_LOGISTIC_STATUS_CARDS.some((c) => c.label === "Atrasado (Pendente)"));
    assert.ok(BI_LOGISTIC_STATUS_CARDS.some((c) => c.label === "No Prazo (Pendente)"));
    assert.ok(BI_LOGISTIC_STATUS_CARDS.some((c) => c.label === "Finalizado/Cancelado"));
    assert.ok(BI_LOGISTIC_STATUS_CARDS.some((c) => c.label === "Revisar dados"));
  });

  it("pedido com NF no prazo → Entregue no Prazo", () => {
    const order = orderBase({
      expectedDeliveryDate: new Date(2026, 5, 20),
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: 2, quantidade: 10 }],
        nfes: [{ dataProcessamento: "15/06/2026", numero: "456" }],
      },
    });
    const { rows, cards } = buildManagementRowsFromOrders([order], {}, REF);
    assert.equal(rows[0].logisticStatusLabel, "Entregue no Prazo");
    assert.equal(cards.deliveredOnTime, 1);
    assert.equal(cards.overduePending, 0);
  });

  it("pedido com NF após prazo → Entregue com Atraso", () => {
    const order = orderBase({
      expectedDeliveryDate: new Date(2026, 4, 1),
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: 2, quantidade: 10 }],
        nfes: [{ dataProcessamento: "15/06/2026", numero: "100" }],
      },
    });
    const { rows, cards } = buildManagementRowsFromOrders([order], {}, REF);
    assert.equal(rows[0].logisticStatusLabel, "Entregue com Atraso");
    assert.equal(cards.deliveredLate, 1);
  });

  it("sem NF, status 2 e prazo vencido → Atrasado (Pendente)", () => {
    const overdue = orderBase({ expectedDeliveryDate: new Date(2026, 4, 1) });
    const { rows, cards } = buildManagementRowsFromOrders([overdue], {}, REF);
    assert.equal(rows[0].logisticStatusLabel, "Atrasado (Pendente)");
    assert.equal(cards.overduePending, 1);
  });

  it("sem NF, status 1 e prazo futuro → No Prazo (Pendente)", () => {
    const order = orderBase({
      expectedDeliveryDate: new Date(2026, 6, 1),
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: 1, quantidade: 10 }],
        nfes: [],
      },
    });
    const { rows, cards } = buildManagementRowsFromOrders([order], {}, REF);
    assert.equal(rows[0].logisticStatusLabel, "No Prazo (Pendente)");
    assert.equal(cards.onTimePending, 1);
  });

  it("sem NF, status 6 → Finalizado/Cancelado", () => {
    const cancelled = orderBase({
      nomusRawResponse: {
        itensPedido: [{ item: 10, status: 6, quantidade: 1, quantidadeCancelada: 1 }],
        nfes: [],
      },
    });
    const { rows, cards } = buildManagementRowsFromOrders([cancelled], {}, REF);
    assert.equal(rows[0].logisticStatusLabel, "Finalizado/Cancelado");
    assert.equal(cards.finishedOrCancelled, 1);
    assert.equal(cards.overduePending, 0);
  });

  it("pedido com NF não entra em Atrasado (Pendente)", () => {
    const order = orderBase({
      expectedDeliveryDate: new Date(2026, 4, 1),
      nomusRawResponse: {
        itensPedido: [{ status: 2, quantidade: 10 }],
        nfes: [{ dataProcessamento: "15/06/2026", numero: "200" }],
      },
    });
    const { rows, cards } = buildManagementRowsFromOrders([order], {}, REF);
    assert.notEqual(rows[0].logisticStatusLabel, "Atrasado (Pendente)");
    assert.equal(cards.overduePending, 0);
    assert.equal(cards.deliveredLate, 1);
  });

  it("filtro logisticStatus reduz grid e mantém contagem do card", () => {
    const overdue = orderBase({
      id: "so-overdue",
      expectedDeliveryDate: new Date(2026, 4, 1),
    });
    const onTime = orderBase({
      id: "so-ok",
      orderCode: "PD 99999",
      expectedDeliveryDate: new Date(2026, 6, 1),
      nomusRawResponse: {
        itensPedido: [{ status: 1, quantidade: 10 }],
        nfes: [],
      },
    });
    const base = buildManagementRowsFromOrders([overdue, onTime], {}, REF);
    assert.equal(base.cards.overduePending, 1);
    assert.equal(base.dashboardCards[0]?.label, "Total no filtro");
    assert.equal(base.dashboardCards[0]?.count, 2);
    assert.equal(base.dashboardCards.length, 7);

    const filtered = buildManagementRowsFromOrders(
      [overdue, onTime],
      { logisticStatus: "overduePending" },
      REF
    );
    assert.equal(filtered.rows.length, 1);
    assert.equal(filtered.cards.overduePending, 1);
    assert.equal(filtered.summary.gridFilteredCount, 1);
    assert.equal(filtered.summary.totalOrdersCount, 2);
  });

  it("soma dos cards bate com total do filtro (quantidade e valor)", () => {
    const orders = [
      orderBase({ totalNetValue: 10000 }),
      orderBase({ id: "so-2", orderCode: "PD 2", totalNetValue: 5000 }),
    ];
    const { rows, cards, cardAmounts, summary, dashboardCards } = buildManagementRowsFromOrders(
      orders,
      {},
      REF
    );
    assert.equal(sumManagementStatusCardCounts(cards), rows.length);
    assert.equal(summary.reconciliation.countMatches, true);
    assert.equal(summary.reconciliation.valueMatches, true);
    assert.equal(summary.totalOrdersCount, 2);
    assert.equal(summary.totalNetValue, 15000);
    assert.equal(sumManagementStatusCardAmounts(cardAmounts), 15000);
    assert.equal(dashboardCards[0]?.isTotal, true);
    assert.equal(dashboardCards[0]?.totalNetValue, 15000);
    assertManagementCardsReconciliation(summary.reconciliation);
  });

  it("buildSalesOrderManagementCards não retorna NaN/Infinity", () => {
    const cards = buildSalesOrderManagementCards([
      { logisticStatusCardId: "onTimePending", totalNetValue: 100 },
    ]);
    for (const value of Object.values(cards)) {
      assert.ok(Number.isFinite(value));
    }
  });
});
