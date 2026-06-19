import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildSalesOrderLifecycleSummary } from "./salesOrderLifecycleStatus.js";
import { mapLifecycleToManagementRow } from "./salesOrderIntelligence.js";
import {
  assertManagementResponseShape,
  buildManagementRowsFromOrders,
  buildSalesOrderManagementCards,
  sortManagementRowsByRisk,
} from "./salesOrderManagement.js";
import {
  assertManagementRowFinite,
  cardsToManagementSummary,
} from "./salesOrderManagementTypes.js";
import { MANAGEMENT_KPI_CARD_HINTS, MANAGEMENT_KPI_CARDS } from "./salesOrderManagementUi.js";

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

describe("salesOrderManagementDashboard", () => {
  it("cards existem com hints", () => {
    assert.equal(MANAGEMENT_KPI_CARDS.length, 9);
    for (const card of MANAGEMENT_KPI_CARDS) {
      assert.ok(MANAGEMENT_KPI_CARD_HINTS[card.id]);
    }
    const page = readFileSync(join(process.cwd(), "src/components/sales/SalesOrderManagementPage.tsx"), "utf8");
    assert.match(page, /indus-kpi-grid/);
    assert.match(page, /MANAGEMENT_KPI_CARD_HINTS/);
  });

  it("endpoint de listagem registrado", () => {
    const routes = readFileSync(join(process.cwd(), "src/lib/salesOrderIntelligenceRoutes.ts"), "utf8");
    assert.match(routes, /\/api\/sales-orders\/management/);
    assert.match(routes, /buildManagementRowsFromOrders/);
  });

  it("cards respeitam filtros — atrasado sem NF", () => {
    const overdue = orderBase({
      expectedDeliveryDate: new Date(2026, 4, 1),
      nomusRawResponse: { itensPedido: [], nfes: [] },
    });
    const onTime = orderBase({
      expectedDeliveryDate: new Date(2026, 6, 1),
      nomusRawResponse: {
        itensPedido: [],
        nfes: [{ dataProcessamento: "10/06/2026", numero: "99" }],
      },
    });
    const { cards } = buildManagementRowsFromOrders([overdue, onTime], {}, REF);
    assert.ok(cards.overdueWithoutInvoice >= 1);
    assert.equal(cardsToManagementSummary(cards).overdueWithoutInvoiceCount, cards.overdueWithoutInvoice);
  });

  it("tabela row inclui campos gerenciais", () => {
    const order = orderBase();
    const { lifecycle, items } = buildSalesOrderLifecycleSummary({
      salesOrderId: order.id,
      salesOrderNumber: order.orderCode,
      originalStatus: order.status,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      nomusRawResponse: order.nomusRawResponse,
      items: order.items,
      referenceDate: REF,
    });
    const row = mapLifecycleToManagementRow(
      {
        id: order.id,
        orderCode: order.orderCode,
        issueDate: order.issueDate.toISOString(),
        expectedDeliveryDate: order.expectedDeliveryDate.toISOString(),
        totalNetValue: order.totalNetValue,
        responsible: order.responsible,
        companyIssuer: order.companyIssuer,
        nomusRawResponse: order.nomusRawResponse,
        itemsCount: order.items.length,
        Customer: order.Customer,
      },
      lifecycle,
      { items, referenceDate: REF }
    );
    assert.equal(row.number, "PD 02580");
    assert.equal(row.customerName, "Cliente X");
    assert.ok(row.executiveStatusLabel);
    assert.ok(row.billingStatus);
    assert.ok(row.deadlineStatus);
    assert.ok(row.completionStatus);
    assert.ok(row.suggestedActionLabel != null || row.riskCount === 0);
    assert.ok(assertManagementRowFinite(row));
  });

  it("ordena por risco/prioridade", () => {
    const low = mapLifecycleToManagementRow(
      {
        id: "a",
        orderCode: "A",
        issueDate: new Date().toISOString(),
        expectedDeliveryDate: null,
        totalNetValue: 100,
        responsible: null,
      },
      buildSalesOrderLifecycleSummary({
        salesOrderId: "a",
        salesOrderNumber: "A",
        originalStatus: "OK",
        issueDate: new Date(),
        items: [],
        referenceDate: REF,
      }).lifecycle,
      { items: [], referenceDate: REF }
    );
    const high = { ...low, id: "b", number: "B", orderCode: "B", highRiskCount: 2, riskCount: 3 };
    const sorted = sortManagementRowsByRisk([low, high]);
    assert.equal(sorted[0].id, "b");
  });

  it("NF após prazo aparece como risco", () => {
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
    const { rows } = buildManagementRowsFromOrders([order], {}, REF);
    assert.ok(rows[0].riskFlags.includes("invoice_after_deadline"));
  });

  it("pedido atrasado sem NF aparece como risco", () => {
    const order = orderBase({ expectedDeliveryDate: new Date(2026, 4, 1) });
    const { rows } = buildManagementRowsFromOrders([order], {}, REF);
    assert.ok(rows[0].riskFlags.includes("overdue_without_invoice"));
  });

  it("não retorna NaN/Infinity nos cards", () => {
    const { cards, rows } = buildManagementRowsFromOrders([orderBase()], {}, REF);
    for (const value of Object.values(cards)) {
      assert.ok(Number.isFinite(value));
    }
    for (const row of rows) {
      assert.ok(assertManagementRowFinite(row));
    }
    assert.ok(
      assertManagementResponseShape({
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        cards,
        rows,
      })
    );
  });

  it("buildSalesOrderManagementCards conta categorias", () => {
    const order = orderBase();
    const { lifecycle } = buildSalesOrderLifecycleSummary({
      salesOrderId: order.id,
      salesOrderNumber: order.orderCode,
      originalStatus: order.status,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      nomusRawResponse: order.nomusRawResponse,
      items: order.items,
      referenceDate: REF,
    });
    const cards = buildSalesOrderManagementCards([{ lifecycle }]);
    assert.ok(Number.isFinite(cards.openOrders));
    assert.ok(Number.isFinite(cards.withoutProductionOrder));
  });

  it("PD 02130 — gestão mostra cancelado e não entra em aberto/atrasado/sem OP", () => {
    const cancelled = {
      id: "so-2130",
      orderCode: "PD 02130",
      status: "SENT_TO_NOMUS",
      issueDate: new Date(2026, 0, 23),
      expectedDeliveryDate: new Date(2026, 0, 23),
      totalNetValue: 360,
      responsible: "Vendedor",
      companyIssuer: "Empresa",
      nomusRawResponse: {
        itensPedido: [
          {
            item: 10,
            codigoProduto: "630.01AA",
            descricaoStatus: "Cancelado",
            quantidade: 1,
            quantidadeCancelada: 1,
          },
        ],
        nfes: [],
      },
      Customer: { companyName: "Simone Viana Coelho", tradeName: null, taxId: null },
      items: [
        {
          id: "item-2130",
          externalProductId: 63001,
          skuSnapshot: "630.01AA",
          productNameSnapshot: "Filtro de Água Aqua Vitae CRISTAL",
          quantity: 1,
        },
      ],
    };
    const open = orderBase({
      id: "so-open",
      expectedDeliveryDate: new Date(2026, 4, 1),
      nomusRawResponse: { itensPedido: [], nfes: [] },
    });
    const { rows, cards } = buildManagementRowsFromOrders([cancelled, open], {}, REF);
    const pdRow = rows.find((r) => r.orderCode === "PD 02130");
    assert.ok(pdRow);
    assert.equal(pdRow.executiveStatusLabel, "Cancelado");
    assert.equal(pdRow.operationalStatus, "cancelled");
    assert.equal(pdRow.completionStatus, "cancelled");
    assert.equal(pdRow.suggestedActionLabel, "Nenhuma ação necessária");
    assert.ok(!pdRow.riskFlags.includes("overdue_without_invoice"));
    assert.equal(cards.cancelledOrReturned, 1);
    assert.equal(cards.openOrders, 1);
    assert.equal(cards.overdueWithoutInvoice, 1);
    assert.equal(cards.withoutProductionOrder, 1);
  });
});
