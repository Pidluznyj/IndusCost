import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderLifecycleSummary } from "./salesOrderLifecycleStatus.js";
import {
  buildManagementRowsFromOrders,
  buildSalesOrderManagementCards,
} from "./salesOrderManagement.js";
import {
  MANAGEMENT_STATUS_CARDS,
  assertManagementCardsReconciliation,
  buildManagementDashboardCards,
  getManagementCardGridLabel,
  resolveManagementCardFromLifecycle,
  resolveManagementStatusCardId,
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
          status: "Liberado",
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

describe("salesOrderManagementStatus", () => {
  it("mapeia status gerencial para 6 cards exclusivos", () => {
    assert.equal(resolveManagementStatusCardId("Atrasado sem NF"), "overdueWithoutInvoice");
    assert.equal(resolveManagementStatusCardId("Faturado total no prazo"), "invoicedOnTime");
    assert.equal(resolveManagementStatusCardId("Faturado total com atraso"), "invoicedLate");
    assert.equal(resolveManagementStatusCardId("Cancelado"), "cancelledOrReturned");
    assert.equal(resolveManagementStatusCardId("Liberado"), "reviewUnknown");
    assert.equal(resolveManagementStatusCardId("Status desconhecido"), "reviewUnknown");
  });

  it("cards principais cobrem 6 categorias gerenciais + total", () => {
    assert.equal(MANAGEMENT_STATUS_CARDS.length, 6);
    assert.ok(MANAGEMENT_STATUS_CARDS.some((c) => c.label === "Atrasados aguardando NF"));
    assert.ok(MANAGEMENT_STATUS_CARDS.some((c) => c.label === "Faturados no prazo"));
    assert.ok(MANAGEMENT_STATUS_CARDS.some((c) => c.label === "Faturados com atraso"));
    assert.ok(MANAGEMENT_STATUS_CARDS.some((c) => c.label === "Finalizados com corte"));
    assert.ok(MANAGEMENT_STATUS_CARDS.some((c) => c.label === "Canceladas / devolvidas"));
    assert.ok(MANAGEMENT_STATUS_CARDS.some((c) => c.label === "Revisar"));
    assert.ok(!MANAGEMENT_STATUS_CARDS.some((c) => c.label === "Pedidos em aberto"));
    assert.ok(!MANAGEMENT_STATUS_CARDS.some((c) => c.label === "Entregues"));
    assert.ok(!MANAGEMENT_STATUS_CARDS.some((c) => c.label === "Aguardando/em andamento"));
  });

  it("grid label é amigável por card", () => {
    assert.equal(getManagementCardGridLabel("overdueWithoutInvoice"), "Atrasado aguardando NF");
    assert.equal(getManagementCardGridLabel("invoicedOnTime"), "Faturado no prazo");
    assert.equal(getManagementCardGridLabel("cancelledOrReturned"), "Cancelado / devolvido");
  });
});

describe("salesOrderManagementDashboard cards", () => {
  it("pedido atrasado sem NF conta apenas no card correspondente", () => {
    const overdue = orderBase({ expectedDeliveryDate: new Date(2026, 4, 1) });
    const { rows, cards } = buildManagementRowsFromOrders([overdue], {}, REF);
    assert.equal(rows[0].managementStatusCardId, "overdueWithoutInvoice");
    assert.equal(cards.overdueWithoutInvoice, 1);
    assert.equal(cards.cancelledOrReturned, 0);
    assert.equal(cards.invoicedOnTime, 0);
  });

  it("pedido faturado no prazo conta em Faturados no prazo", () => {
    const order = orderBase({
      expectedDeliveryDate: new Date(2026, 5, 20),
      nomusRawResponse: {
        itensPedido: [
          {
            idProduto: 1,
            codigoProduto: "SKU-1",
            status: "Atendido totalmente",
            quantidade: 10,
            quantidadeAtendida: 10,
            quantidadeFaturada: 10,
          },
        ],
        nfes: [{ dataProcessamento: "20/06/2026", numero: "456" }],
      },
    });
    const { rows, cards } = buildManagementRowsFromOrders([order], {}, REF);
    assert.equal(rows[0].managementStatusCardId, "invoicedOnTime");
    assert.equal(cards.invoicedOnTime, 1);
    assert.equal(cards.overdueWithoutInvoice, 0);
  });

  it("pedido faturado com atraso conta em Faturados com atraso", () => {
    const order = orderBase({
      expectedDeliveryDate: new Date(2026, 4, 1),
      nomusRawResponse: {
        itensPedido: [
          {
            idProduto: 1,
            status: "Liberado",
            quantidade: 10,
            quantidadeAtendida: 10,
            quantidadeFaturada: 10,
          },
        ],
        nfes: [{ dataProcessamento: "15/06/2026", numero: "100" }],
      },
    });
    const { rows, cards } = buildManagementRowsFromOrders([order], {}, REF);
    assert.equal(rows[0].managementStatusCardId, "invoicedLate");
    assert.equal(cards.invoicedLate, 1);
  });

  it("pedido atendido parcialmente entra em Finalizados com corte", () => {
    const order = orderBase({
      nomusRawResponse: {
        itensPedido: [
          {
            idProduto: 1,
            status: "Atendido parcialmente",
            quantidade: 10,
            quantidadeAtendida: 5,
            quantidadeFaturada: 5,
          },
        ],
        nfes: [{ dataProcessamento: "10/06/2026", numero: "50" }],
      },
    });
    const { rows, cards } = buildManagementRowsFromOrders([order], {}, REF);
    assert.equal(rows[0].managementStatusCardId, "partialOrCut");
    assert.equal(cards.partialOrCut, 1);
  });

  it("pedido cancelado conta em Canceladas/devolvidas e não em outros cards", () => {
    const cancelled = orderBase({
      nomusRawResponse: {
        itensPedido: [
          {
            item: 10,
            status: 6,
            quantidade: 1,
            quantidadeCancelada: 1,
          },
        ],
        nfes: [],
      },
    });
    const { rows, cards } = buildManagementRowsFromOrders([cancelled], {}, REF);
    assert.equal(rows[0].managementStatusCardId, "cancelledOrReturned");
    assert.equal(cards.cancelledOrReturned, 1);
    assert.equal(cards.overdueWithoutInvoice, 0);
    assert.equal(cards.reviewUnknown, 0);
  });

  it("pedido faturado total não entra em Atrasados aguardando NF", () => {
    const order = orderBase({
      expectedDeliveryDate: new Date(2026, 4, 1),
      nomusRawResponse: {
        itensPedido: [
          {
            idProduto: 1,
            status: "Atendido totalmente",
            quantidade: 10,
            quantidadeAtendida: 10,
            quantidadeFaturada: 10,
          },
        ],
        nfes: [{ dataProcessamento: "15/06/2026", numero: "200" }],
      },
    });
    const { rows, cards } = buildManagementRowsFromOrders([order], {}, REF);
    assert.notEqual(rows[0].managementStatusCardId, "overdueWithoutInvoice");
    assert.equal(cards.overdueWithoutInvoice, 0);
    assert.equal(cards.invoicedLate, 1);
  });

  it("status desconhecido entra em Revisar", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary({
      salesOrderId: "x",
      salesOrderNumber: "X",
      originalStatus: "OK",
      issueDate: new Date(),
      items: [
        {
          id: "i1",
          skuSnapshot: "S",
          productNameSnapshot: "P",
          quantity: 1,
        },
      ],
      nomusRawResponse: { itensPedido: [{ status: "XYZ_INVALIDO", quantidade: 1 }] },
      referenceDate: REF,
    });
    assert.equal(resolveManagementCardFromLifecycle(lifecycle), "reviewUnknown");
  });

  it("filtro managementStatus reduz grid e mantém contagem do card", () => {
    const overdue = orderBase({
      id: "so-overdue",
      expectedDeliveryDate: new Date(2026, 4, 1),
    });
    const onTime = orderBase({
      id: "so-ok",
      orderCode: "PD 99999",
      expectedDeliveryDate: new Date(2026, 6, 1),
      nomusRawResponse: {
        itensPedido: [
          {
            idProduto: 1,
            status: "Liberado",
            quantidade: 10,
            quantidadeAtendida: 10,
            quantidadeFaturada: 10,
          },
        ],
        nfes: [{ dataProcessamento: "10/06/2026", numero: "99" }],
      },
    });
    const base = buildManagementRowsFromOrders([overdue, onTime], {}, REF);
    assert.equal(base.cards.overdueWithoutInvoice, 1);
    assert.equal(base.dashboardCards[0]?.label, "Total no filtro");
    assert.equal(base.dashboardCards[0]?.count, 2);
    assert.equal(base.dashboardCards.length, 7);

    const filtered = buildManagementRowsFromOrders(
      [overdue, onTime],
      { managementStatus: "overdueWithoutInvoice" },
      REF
    );
    assert.equal(filtered.rows.length, 1);
    assert.equal(filtered.cards.overdueWithoutInvoice, 1);
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
    const { lifecycle } = buildSalesOrderLifecycleSummary({
      salesOrderId: "x",
      salesOrderNumber: "X",
      originalStatus: "OK",
      issueDate: new Date(),
      items: [],
      referenceDate: REF,
    });
    const cardId = resolveManagementCardFromLifecycle(lifecycle);
    const cards = buildSalesOrderManagementCards([
      {
        executiveStatusLabel: lifecycle.executiveStatusLabel,
        totalNetValue: 100,
        managementStatusCardId: cardId,
      },
    ]);
    for (const value of Object.values(cards)) {
      assert.ok(Number.isFinite(value));
    }
  });
});
