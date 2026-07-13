import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { decideOrderToCashAuditRunPolicy } from "./orderToCashAuditApi.js";
import {
  PORTFOLIO_ORDER_STATUS_API_PATH,
  PORTFOLIO_ORDER_STATUS_NO_RUN_MESSAGE,
  PORTFOLIO_ORDER_STATUS_SORT_WHITELIST,
  buildPortfolioOrderStatusListFromFacts,
  buildPortfolioOrderStatusNoRunPayload,
  parsePortfolioOrderStatusFilters,
  resolvePortfolioOrderStatusSort,
  type PortfolioOrderStatusApiFilters,
  type PortfolioOrderStatusRunMeta,
} from "./portfolioOrderStatusApi.js";
import type { PortfolioOrderStatusFact } from "./portfolioOrderStatusService.js";

const GENERAL_RUN_ID = "41c2470a-b685-4765-a954-77110fd8cf5c";
const TITLE_CR = 183_612;

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

function fact(
  partial: Partial<PortfolioOrderStatusFact> & { id: string }
): PortfolioOrderStatusFact {
  return {
    runId: GENERAL_RUN_ID,
    orderCode: "PD X",
    orderIssueDate: new Date(2026, 5, 1),
    orderExpectedDeliveryDate: new Date(2026, 7, 1),
    orderNetValue: 10_000,
    customerId: "cust",
    customerName: "Cliente",
    externalCustomerId: 100,
    sellerName: "Vendedor",
    sellerQualityStatus: "OK",
    productCode: "P1",
    sku: "P1",
    productName: "Produto",
    lineType: "ORDER_ITEM_ALLOCATED",
    orderedQuantity: 10,
    orderUnitPrice: 100,
    orderItemTotalValue: 1000,
    stockDocumentId: "doc-1",
    stockDocumentExternalId: 1,
    stockDocumentDate: new Date(2026, 5, 10),
    stockDocumentItemQuantity: 10,
    quantityUsedForOrder: 10,
    excessQuantity: 0,
    outsideOrderQuantity: 0,
    allocatedValueByOrderPrice: 1000,
    allocatedValueByDocumentPrice: 1000,
    stockDocumentItemUnitValue: 100,
    stockDocumentItemTotalValue: 1000,
    nfeItemQuantity: null,
    nfeItemUnitValue: null,
    nfeItemTotalValue: null,
    nfeNumber: "1000",
    nfeIssueDate: new Date(2026, 5, 11),
    nfeHeaderValue: 1000,
    receivableTotalValue: 1000,
    receivableOpenValue: 1000,
    receivableReceivedValue: 0,
    paymentDueDate: new Date(2026, 6, 1),
    paymentSettlementDate: null,
    paymentStatus: "OPEN",
    operationalStage: "FULLY_FULFILLED",
    financialStage: "CR_OPEN",
    orderToCashStage: "CR_ABERTO",
    temperature: "AMARELO",
    confidenceScore: 0.8,
    confidenceLabel: "ALTA",
    responsibleArea: "Financeiro",
    recommendedAction: "Acompanhar",
    alertsJson: [],
    blockingReasonsJson: [],
    hasDeliveryDelay: false,
    hasMissingStockDocument: false,
    hasPartialFulfillment: false,
    hasFullFulfillment: true,
    hasExcessQuantity: false,
    hasProductOutsideOrder: false,
    hasNfeHeaderGreaterThanOrder: false,
    hasPriceMismatch: false,
    hasDocumentWithoutReceivable: false,
    hasOverdueReceivable: false,
    salesOrderId: "order-x",
    ...partial,
  };
}

function runMeta(
  overrides: Partial<PortfolioOrderStatusRunMeta> = {}
): PortfolioOrderStatusRunMeta {
  return {
    runId: GENERAL_RUN_ID,
    createdAt: "2026-07-10T12:00:00.000Z",
    periodFrom: "2025-06-01T00:00:00.000Z",
    periodTo: "2026-12-31T00:00:00.000Z",
    dataSource: "order_to_cash_audit",
    status: "SUCCESS",
    finishedAt: "2026-07-10T12:05:00.000Z",
    isGeneralRun: true,
    year: null,
    customerFilter: null,
    totalOrders: 1283,
    totalFacts: 5860,
    ...overrides,
  };
}

function filters(
  overrides: Partial<PortfolioOrderStatusApiFilters> = {}
): PortfolioOrderStatusApiFilters {
  return parsePortfolioOrderStatusFilters({
    year: 2026,
    page: 1,
    pageSize: 50,
    ...overrides,
  });
}

function fixtureUniverse(): PortfolioOrderStatusFact[] {
  const esmaltecShared = {
    salesOrderId: "order-pd-02534",
    orderCode: "PD 02534",
    customerName: "Esmaltec",
    externalCustomerId: 500,
    orderNetValue: 120_000,
    receivableTotalValue: TITLE_CR,
    receivableOpenValue: 50_000,
    receivableReceivedValue: 133_612,
    nfeNumber: "7228",
    nfeHeaderValue: TITLE_CR,
    hasPartialFulfillment: true,
    hasFullFulfillment: false,
    operationalStage: "PARTIALLY_FULFILLED",
    financialStage: "CR_OPEN",
    orderToCashStage: "PEDIDO_PARCIALMENTE_ATENDIDO",
    alertsJson: ["DOCUMENTO_PARCIAL", "DOCUMENTO_COM_EXCEDENTE"],
  } as const;

  const britania = [
    fact({
      id: "b1",
      salesOrderId: "order-pd-02339",
      orderCode: "PD 02339",
      customerName: "Britânia",
      externalCustomerId: 200,
      orderNetValue: 158_000,
      productCode: "A",
      allocatedValueByOrderPrice: 80_000,
      quantityUsedForOrder: 1000,
      stockDocumentItemUnitValue: 80,
      orderItemTotalValue: 80_000,
      receivableTotalValue: 158_000,
      receivableOpenValue: 158_000,
      receivableReceivedValue: 0,
      nfeHeaderValue: 250_000,
      hasExcessQuantity: true,
      hasNfeHeaderGreaterThanOrder: true,
      alertsJson: ["DOCUMENTO_COM_EXCEDENTE", "NF_CABECALHO_MAIOR_PEDIDO"],
    }),
    fact({
      id: "b2",
      salesOrderId: "order-pd-02339",
      orderCode: "PD 02339",
      customerName: "Britânia",
      externalCustomerId: 200,
      orderNetValue: 158_000,
      productCode: "B",
      allocatedValueByOrderPrice: 78_000,
      quantityUsedForOrder: 1000,
      stockDocumentItemUnitValue: 78,
      orderItemTotalValue: 78_000,
      receivableTotalValue: 158_000,
      receivableOpenValue: 158_000,
      nfeHeaderValue: 250_000,
      hasExcessQuantity: true,
      hasNfeHeaderGreaterThanOrder: true,
      alertsJson: ["DOCUMENTO_COM_EXCEDENTE", "NF_CABECALHO_MAIOR_PEDIDO"],
    }),
  ];

  const esmaltec = [
    fact({
      id: "e1",
      ...esmaltecShared,
      productCode: "612.03AA",
      quantityUsedForOrder: 12_200,
      stockDocumentItemUnitValue: 3.35,
      allocatedValueByOrderPrice: 12_200 * 3.35,
      allocatedValueByDocumentPrice: 12_200 * 3.35,
      orderItemTotalValue: 12_200 * 3.35,
      hasExcessQuantity: true,
    }),
    fact({
      id: "e2",
      ...esmaltecShared,
      productCode: "612.02AA",
      quantityUsedForOrder: 10_000,
      stockDocumentItemUnitValue: 3.35,
      allocatedValueByOrderPrice: 10_000 * 3.35,
      orderItemTotalValue: 10_000 * 3.35,
    }),
    // CR repetido em várias linhas
    ...Array.from({ length: 15 }, (_, i) =>
      fact({
        id: `e-cr-${i}`,
        ...esmaltecShared,
        productCode: `X${i}`,
        quantityUsedForOrder: 10,
        stockDocumentItemUnitValue: 3.35,
        allocatedValueByOrderPrice: 33.5,
        orderItemTotalValue: 33.5,
      })
    ),
    fact({
      id: "e-pending",
      ...esmaltecShared,
      productCode: "309.86AA",
      lineType: "ORDER_ITEM_PENDING",
      quantityUsedForOrder: null,
      allocatedValueByOrderPrice: null,
      allocatedValueByDocumentPrice: null,
      nfeNumber: null,
      nfeHeaderValue: null,
      receivableTotalValue: null,
      receivableOpenValue: null,
      receivableReceivedValue: null,
      orderItemTotalValue: 1000,
      operationalStage: "NOT_FULFILLED",
      financialStage: "NO_CR",
    }),
  ];

  return [...britania, ...esmaltec];
}

describe("portfolioOrderStatusApi", () => {
  it("1. política encontra run geral SUCCESS", () => {
    const decision = decideOrderToCashAuditRunPolicy({
      runId: null,
      customerExternalId: null,
      year: 2026,
      specificRunId: null,
      generalRunId: GENERAL_RUN_ID,
    });
    assert.equal(decision.kind, "general");
    assert.equal(decision.runId, GENERAL_RUN_ID);

    const payload = buildPortfolioOrderStatusListFromFacts({
      facts: fixtureUniverse(),
      filters: filters({ year: 2026 }),
      runMeta: runMeta(),
    });
    assert.equal(payload.runMeta?.runId, GENERAL_RUN_ID);
    assert.equal(payload.runMeta?.dataSource, "order_to_cash_audit");
    assert.equal(payload.state, "OK");
  });

  it("2. retorna primaryCards e drilldownCards", () => {
    const payload = buildPortfolioOrderStatusListFromFacts({
      facts: fixtureUniverse(),
      filters: filters({ year: 2026 }),
      runMeta: runMeta(),
    });
    assert.ok(payload.primaryCards.length >= 8);
    assert.ok(payload.primaryCards.some((c) => c.id === "total"));
    assert.ok(payload.primaryCards.some((c) => c.id === "parciais"));
    assert.equal(
      payload.primaryCards.find((c) => c.id === "total")?.count,
      payload.pagination.totalRows
    );

    const withCard = buildPortfolioOrderStatusListFromFacts({
      facts: fixtureUniverse(),
      filters: filters({ year: 2026, selectedCard: "parciais" }),
      runMeta: runMeta(),
    });
    assert.ok(withCard.drilldownCards.length > 0);
  });

  it("3. retorna rows por pedido (não por fact)", () => {
    const facts = fixtureUniverse();
    const payload = buildPortfolioOrderStatusListFromFacts({
      facts,
      filters: filters({ year: 2026 }),
      runMeta: runMeta(),
    });
    assert.equal(payload.rows.length, 2);
    assert.ok(payload.rows.every((r) => r.orderCode));
    assert.ok(payload.pagination.totalRows < facts.length);
    assert.equal(payload.sourceInfo.grain, "sales_order");
    assert.equal(payload.sourceInfo.sourceFactGrain, "order_item_evidence");
  });

  it("4. filtra Esmaltec", () => {
    const payload = buildPortfolioOrderStatusListFromFacts({
      facts: fixtureUniverse(),
      filters: filters({ year: 2026, customerName: "Esmaltec" }),
      runMeta: runMeta(),
    });
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0]!.customerName, "Esmaltec");
    assert.equal(payload.rows[0]!.orderCode, "PD 02534");
  });

  it("5. filtra Britânia", () => {
    const payload = buildPortfolioOrderStatusListFromFacts({
      facts: fixtureUniverse(),
      filters: filters({ year: 2026, customerExternalId: 200 }),
      runMeta: runMeta(),
    });
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0]!.orderCode, "PD 02339");
    assert.match(payload.rows[0]!.customerName ?? "", /Brit/);
  });

  it("6. filtra PD 02534 via orderCode", () => {
    const payload = buildPortfolioOrderStatusListFromFacts({
      facts: fixtureUniverse(),
      filters: filters({ year: 2026, orderCode: "02534" }),
      runMeta: runMeta(),
    });
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0]!.orderCode, "PD 02534");
    assert.equal(payload.rows[0]!.consolidatedOrderStatus, "PARCIAL_CR_ABERTO");
  });

  it("7. não duplica CR", () => {
    const payload = buildPortfolioOrderStatusListFromFacts({
      facts: fixtureUniverse(),
      filters: filters({ year: 2026, orderCode: "PD 02534" }),
      runMeta: runMeta(),
    });
    const row = payload.rows[0]!;
    assert.equal(row.receivableTotalValue, TITLE_CR);
    assert.notEqual(row.receivableTotalValue, TITLE_CR * 17);
    assert.equal(payload.summary?.totalReceivableValue, TITLE_CR);
  });

  it("8. pagina server-side", () => {
    const payload = buildPortfolioOrderStatusListFromFacts({
      facts: fixtureUniverse(),
      filters: filters({ year: 2026, page: 1, pageSize: 1 }),
      runMeta: runMeta(),
    });
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.pagination.pageSize, 1);
    assert.equal(payload.pagination.totalRows, 2);
    assert.equal(payload.pagination.totalPages, 2);

    const page2 = buildPortfolioOrderStatusListFromFacts({
      facts: fixtureUniverse(),
      filters: filters({ year: 2026, page: 2, pageSize: 1 }),
      runMeta: runMeta(),
    });
    assert.equal(page2.rows.length, 1);
    assert.notEqual(page2.rows[0]!.orderCode, payload.rows[0]!.orderCode);
  });

  it("9. ordena com whitelist", () => {
    const asc = buildPortfolioOrderStatusListFromFacts({
      facts: fixtureUniverse(),
      filters: filters({
        year: 2026,
        sortBy: "orderCode",
        sortDirection: "asc",
      }),
      runMeta: runMeta(),
    });
    assert.equal(asc.rows[0]!.orderCode, "PD 02339");
    assert.equal(asc.rows[1]!.orderCode, "PD 02534");

    const desc = buildPortfolioOrderStatusListFromFacts({
      facts: fixtureUniverse(),
      filters: filters({
        year: 2026,
        sortBy: "totalOrderValue",
        sortDirection: "desc",
      }),
      runMeta: runMeta(),
    });
    assert.ok(desc.rows[0]!.totalOrderValue >= desc.rows[1]!.totalOrderValue);

    assert.throws(
      () => resolvePortfolioOrderStatusSort("hacked", "asc"),
      /sortBy inválido/
    );
    assert.ok(PORTFOLIO_ORDER_STATUS_SORT_WHITELIST.includes("orderCode"));
  });

  it("10. empty state sem run / filtro vazio não quebra", () => {
    const noRun = buildPortfolioOrderStatusNoRunPayload(filters({ year: 2026 }));
    assert.equal(noRun.state, "NO_RUN");
    assert.equal(noRun.message, PORTFOLIO_ORDER_STATUS_NO_RUN_MESSAGE);
    assert.equal(noRun.runMeta, null);
    assert.equal(noRun.rows.length, 0);
    assert.equal(noRun.ok, true);
    assert.ok(noRun.primaryCards.length >= 8);

    const empty = buildPortfolioOrderStatusListFromFacts({
      facts: fixtureUniverse(),
      filters: filters({ year: 2026, customerName: "Inexistente XYZ" }),
      runMeta: runMeta(),
    });
    assert.equal(empty.state, "FILTERED_EMPTY");
    assert.equal(empty.rows.length, 0);
    assert.equal(empty.pagination.totalRows, 0);
    assert.equal(empty.ok, true);
  });

  it("rota order-status registrada com permissão Status Pedidos", () => {
    const routes = read("src/lib/financePortfolioReconciliationRoutes.ts");
    assert.match(routes, /\/api\/finance\/portfolio-reconciliation\/order-status/);
    assert.match(routes, /loadPortfolioOrderStatusList/);
    assert.match(routes, /FINANCEIRO_CONCILIACAO_TAB_STATUS_PEDIDOS/);
    assert.equal(
      PORTFOLIO_ORDER_STATUS_API_PATH,
      "/api/finance/portfolio-reconciliation/order-status"
    );
  });
});
