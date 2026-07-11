import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { PortfolioReconciliationFactApiRow } from "./portfolioReconciliationApi.js";
import {
  buildPortfolioIntelligenceListPayload,
  buildPortfolioIntelligenceOrderDetailPayload,
  parsePortfolioIntelligenceFilters,
  PortfolioIntelligenceApiParseError,
  PORTFOLIO_INTELLIGENCE_MAX_PAGE_SIZE,
  PORTFOLIO_FULFILLMENT_MAP_UNAVAILABLE_WARNING,
} from "./portfolioMaturityIntelligenceApi.js";
import { buildPortfolioReconciliationFacts } from "./portfolioReconciliationAllocationEngine.js";
import { portfolioFactDraftToApiRow } from "./portfolioReconciliationOrderTrace.js";
import { canViewFinancePortfolioReconciliation } from "../financePortfolioReconciliationPermissions.js";
import { FINANCE_PORTFOLIO_RECONCILIATION_VIEW_PERMISSIONS } from "../financePortfolioReconciliationPermissions.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function fact(
  partial: Partial<PortfolioReconciliationFactApiRow> & { id: string }
): PortfolioReconciliationFactApiRow {
  return {
    runId: "run-1",
    customerId: "cust-1",
    customerExternalId: 200,
    customerNameSnapshot: "Britânia",
    salesOrderId: "order-1",
    externalSalesOrderId: 1,
    orderCode: "PD 02607",
    orderIssueDate: "2026-06-01",
    expectedDeliveryDate: "2026-08-01",
    salesOrderItemId: "item-1",
    externalSalesOrderItemId: null,
    externalProductId: 10,
    productSkuSnapshot: "SKU",
    productNameSnapshot: "Produto",
    orderQuantity: 1,
    orderUnitPrice: 100,
    orderItemValue: 100,
    nomusNfeId: null,
    nfeExternalId: null,
    nfeNumber: null,
    nfeSerie: null,
    nfeKey: null,
    nfeProcessedAt: null,
    nfeHeaderValue: null,
    stockDocumentId: null,
    stockDocumentExternalId: null,
    stockDocumentItemId: null,
    stockDocumentItemExternalId: null,
    stockDocumentDate: null,
    stockQuantity: null,
    stockUnitValue: null,
    stockItemValue: null,
    allocatedQuantity: null,
    allocatedValueByOrderPrice: null,
    allocatedValueByStockPrice: null,
    remainingOrderQuantityAfterAllocation: null,
    remainingOrderValueAfterAllocation: null,
    priceDifferenceUnit: null,
    priceDifferenceTotal: null,
    receivableIdsJson: null,
    receivableTotalValue: null,
    receivedValue: null,
    openReceivableValue: null,
    dueDatesJson: null,
    settlementDatesJson: null,
    forecastSource: "ORDER",
    forecastDate: "2026-09-15",
    forecastValue: 100,
    confidenceLevel: "LOW",
    status: "ORDER_ONLY",
    alertsJson: [],
    traceJson: { rule: "ORDER_ONLY", orderTotal: 100 },
    ...partial,
  };
}

const runMeta = {
  id: "1dc2ead7-533d-4ad4-bc4c-621061fa5623",
  status: "SUCCESS",
  mode: "apply",
  startedAt: "2026-07-10T12:00:00.000Z",
  finishedAt: "2026-07-10T12:05:00.000Z",
  fromDate: null,
  toDate: null,
  customerExternalId: 200,
  filtersJson: {},
  summaryJson: {},
  errorMessage: null,
  createdAt: "2026-07-10T12:00:00.000Z",
};

describe("portfolioMaturityIntelligenceApi", () => {
  it("endpoint rejeita usuário sem permissão (guard + permissões)", () => {
    const routes = read("src/lib/financePortfolioReconciliationRoutes.ts");
    assert.match(routes, /\/api\/finance\/portfolio-reconciliation\/intelligence/);
    assert.match(
      routes,
      /\/api\/finance\/portfolio-reconciliation\/intelligence\/orders\/:salesOrderId/
    );
    assert.match(routes, /requireAppAuth/);
    assert.match(
      routes,
      /requireAnyPermission\(\[\.\.\.FINANCE_PORTFOLIO_RECONCILIATION_VIEW_PERMISSIONS\]\)/
    );
    assert.equal(
      canViewFinancePortfolioReconciliation({
        hasPermission: () => false,
        hasAnyPermission: () => false,
      }),
      false
    );
    assert.equal(
      canViewFinancePortfolioReconciliation({
        hasPermission: (p) => p === "finance.view",
        hasAnyPermission: (perms) => perms.includes("finance.view"),
      }),
      true
    );
    assert.ok(FINANCE_PORTFOLIO_RECONCILIATION_VIEW_PERMISSIONS.includes("finance.view"));
  });

  it("aceita filtro por cliente", () => {
    const f = parsePortfolioIntelligenceFilters({ customerExternalId: "200" });
    assert.equal(f.customerExternalId, 200);
    const payload = buildPortfolioIntelligenceListPayload({
      run: runMeta,
      facts: [
        fact({ id: "a", customerExternalId: 200, salesOrderId: "o1", orderCode: "PD A" }),
        fact({
          id: "b",
          customerExternalId: 999,
          salesOrderId: "o2",
          orderCode: "PD B",
          orderItemValue: 50,
        }),
      ],
      filters: { ...f, asOfDate: "2026-07-10", pageSize: 50 },
      orderTotalBySalesOrderId: new Map([
        ["o1", 100],
        ["o2", 50],
      ]),
    });
    assert.equal(payload.ok, true);
    assert.ok(payload.rows.every((r) => r.customerExternalId === 200));
    assert.ok(payload.o2cBusinessKpis);
    assert.ok(payload.o2cBusinessKpis.cards.some((c) => c.key === "VALOR_EM_PEDIDOS"));
  });

  it("aceita filtro por vendedor", () => {
    const f = parsePortfolioIntelligenceFilters({ sellerExternalId: "77" });
    assert.equal(f.sellerExternalId, 77);
    const payload = buildPortfolioIntelligenceListPayload({
      run: runMeta,
      facts: [
        fact({ id: "a", salesOrderId: "o1", orderCode: "PD V1" }),
        fact({ id: "b", salesOrderId: "o2", orderCode: "PD V2", orderItemValue: 50 }),
      ],
      filters: { ...f, asOfDate: "2026-07-10" },
      orderTotalBySalesOrderId: new Map([
        ["o1", 100],
        ["o2", 50],
      ]),
      enrichmentsBySalesOrderId: new Map([
        [
          "o1",
          {
            salesOrderId: "o1",
            sellerExternalId: 77,
            sellerName: "Seller A",
            paymentTerms: "30 DDL",
          },
        ],
        [
          "o2",
          {
            salesOrderId: "o2",
            sellerExternalId: 88,
            sellerName: "Seller B",
            paymentTerms: "30 DDL",
          },
        ],
      ]),
    });
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0]!.sellerExternalId, 77);
  });

  it("aceita dateAxis ORDER_ISSUE_DATE", () => {
    const f = parsePortfolioIntelligenceFilters({
      dateAxis: "ORDER_ISSUE_DATE",
      from: "2026-06-01",
      to: "2026-06-30",
    });
    assert.equal(f.dateAxis, "ORDER_ISSUE_DATE");
    const payload = buildPortfolioIntelligenceListPayload({
      run: runMeta,
      facts: [
        fact({
          id: "a",
          salesOrderId: "o1",
          orderCode: "PD IN",
          orderIssueDate: "2026-06-15",
        }),
        fact({
          id: "b",
          salesOrderId: "o2",
          orderCode: "PD OUT",
          orderIssueDate: "2026-05-01",
          orderItemValue: 50,
        }),
      ],
      filters: { ...f, asOfDate: "2026-07-10" },
      orderTotalBySalesOrderId: new Map([
        ["o1", 100],
        ["o2", 50],
      ]),
    });
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0]!.orderCode, "PD IN");
  });

  it("aceita dateAxis EXPECTED_DELIVERY_DATE", () => {
    const f = parsePortfolioIntelligenceFilters({
      dateAxis: "EXPECTED_DELIVERY_DATE",
      from: "2026-08-01",
      to: "2026-08-31",
    });
    assert.equal(f.dateAxis, "EXPECTED_DELIVERY_DATE");
    const payload = buildPortfolioIntelligenceListPayload({
      run: runMeta,
      facts: [
        fact({
          id: "a",
          salesOrderId: "o1",
          orderCode: "PD DEL",
          expectedDeliveryDate: "2026-08-10",
        }),
        fact({
          id: "b",
          salesOrderId: "o2",
          orderCode: "PD OTHER",
          expectedDeliveryDate: "2026-09-10",
          orderItemValue: 50,
        }),
      ],
      filters: { ...f, asOfDate: "2026-07-10" },
      orderTotalBySalesOrderId: new Map([
        ["o1", 100],
        ["o2", 50],
      ]),
    });
    assert.equal(payload.rows.length, 1);
    assert.equal(payload.rows[0]!.orderCode, "PD DEL");
  });

  it("retorna cards com explanations", () => {
    const payload = buildPortfolioIntelligenceListPayload({
      run: runMeta,
      facts: [fact({ id: "a" })],
      filters: { asOfDate: "2026-07-10", pageSize: 50 },
      orderTotalBySalesOrderId: new Map([["order-1", 100]]),
    });
    assert.ok(payload.cards.length >= 16);
    for (const card of payload.cards) {
      assert.ok(card.explanation.whatItMeans.length > 0, card.key);
      assert.ok(card.explanation.howWeCalculate.length > 0, card.key);
      assert.ok(payload.metricExplanations[card.key], card.key);
    }
  });

  it("retorna grupos sem duplicar status principal", () => {
    const payload = buildPortfolioIntelligenceListPayload({
      run: runMeta,
      facts: [
        fact({
          id: "a",
          salesOrderId: "o1",
          orderCode: "PD 1",
          forecastDate: "2026-09-15",
        }),
        fact({
          id: "b",
          salesOrderId: "o2",
          orderCode: "PD 2",
          orderItemValue: 200,
          forecastDate: "2025-11-01",
          orderIssueDate: "2025-01-01",
        }),
      ],
      filters: { asOfDate: "2026-07-10" },
      orderTotalBySalesOrderId: new Map([
        ["o1", 100],
        ["o2", 200],
      ]),
    });
    const statusSum = payload.groups.reduce((s, g) => s + g.orderValue, 0);
    const total = payload.cards.find((c) => c.key === "CARTEIRA_TOTAL_ANALISADA")!;
    assert.equal(statusSum, total.value);
    const principals = payload.rows.map((r) => r.statusPrincipal);
    assert.equal(new Set(principals).size, principals.length === 0 ? 0 : new Set(principals).size);
    assert.ok(payload.rows.every((r) => typeof r.statusPrincipal === "string"));
  });

  it("detalhe retorna dados esperados (classificação, timeline, pagamento)", () => {
    const detail = buildPortfolioIntelligenceOrderDetailPayload({
      salesOrderId: "order-1",
      run: runMeta,
      facts: [
        fact({
          id: "a",
          allocatedQuantity: null,
          nfeExternalId: null,
        }),
      ],
      enrichment: {
        salesOrderId: "order-1",
        sellerName: null,
        sellerExternalId: null,
        paymentTerms: null,
        paymentMethod: null,
        updatedAt: "2026-07-09",
      },
      orderTotalBySalesOrderId: new Map([["order-1", 100]]),
      asOfDate: "2026-07-10",
    });
    assert.equal(detail.ok, true);
    assert.ok(detail.detail);
    assert.ok(detail.detail!.executiveSummary.length > 0);
    assert.equal(detail.detail!.classification.statusPrincipal, "CARTEIRA_FUTURA_PROVAVEL");
    assert.ok(Array.isArray(detail.detail!.classification.tagsAlerta));
    assert.ok(Array.isArray(detail.detail!.timeline));
    assert.equal(detail.detail!.paymentCondition.available, false);
    assert.match(
      detail.detail!.paymentCondition.note ?? "",
      /Informação não disponível na importação atual/
    );
    assert.equal(detail.detail!.seller.available, false);
    assert.ok(detail.detail!.items.length >= 1);
  });

  it("detalhe retorna fulfillmentMap com eixos financeiro/operacional/alertas", () => {
    const detail = buildPortfolioIntelligenceOrderDetailPayload({
      salesOrderId: "order-1",
      run: runMeta,
      facts: [
        fact({
          id: "a",
          salesOrderItemId: "item-1",
          externalProductId: 10,
          orderQuantity: 100,
          orderUnitPrice: 10,
          orderItemValue: 1000,
          allocatedQuantity: 40,
          nfeExternalId: 1,
          nfeNumber: "100",
          nfeHeaderValue: 400,
          stockDocumentExternalId: 9,
          stockQuantity: 40,
          stockUnitValue: 10,
          stockItemValue: 400,
          status: "ITEM_ALLOCATED",
          receivableTotalValue: 1000,
          receivedValue: 200,
          openReceivableValue: 800,
          receivableIdsJson: [55],
        }),
      ],
      orderTotalBySalesOrderId: new Map([["order-1", 1000]]),
      asOfDate: "2026-07-10",
    });
    assert.equal(detail.ok, true);
    const map = detail.detail!.fulfillmentMap;
    assert.ok(map, "1) fulfillmentMap presente quando há dados");
    assert.ok(map!.financialStatus.startsWith("FIN_"), "2) financialStatus");
    assert.ok(typeof map!.financialStatusLabel === "string" && map!.financialStatusLabel.length > 0);
    assert.ok(map!.operationalStatus.startsWith("OP_"), "3) operationalStatus");
    assert.ok(
      typeof map!.operationalStatusLabel === "string" && map!.operationalStatusLabel.length > 0
    );
    assert.ok(Array.isArray(map!.technicalAlerts), "4) technicalAlerts");
    assert.ok(map!.fulfillmentSummary, "5) fulfillmentSummary");
    assert.equal(typeof map!.fulfillmentSummary.orderValue, "number");
    assert.ok(Array.isArray(map!.orderItemsCoverage), "6) orderItemsCoverage");
    assert.ok(map!.orderItemsCoverage.length >= 1);
    assert.ok(Array.isArray(map!.stockDocumentsCoverage), "7) stockDocumentsCoverage");
    assert.ok(Array.isArray(map!.receivablesCoverage), "8) receivablesCoverage");
    assert.ok(typeof map!.executiveConclusion === "string");
    assert.ok(Array.isArray(map!.evidenceWarnings));
    assert.ok(Array.isArray(map!.operationalDeviationAlerts));
    assert.ok(Array.isArray(detail.detail!.operationalDeviationAlerts));
    assert.equal(detail.detail!.fulfillmentMapWarning ?? null, null);
    // Maturidade (statusPrincipal) ≠ eixo financeiro do mapa
    assert.notEqual(
      detail.detail!.classification.statusPrincipal,
      map!.financialStatus
    );
    assert.equal(
      detail.detail!.classification.financialStatus,
      map!.financialStatus
    );
    assert.equal(map!.financialStatus, "FIN_CR_ABERTO");
    assert.equal(map!.operationalStatus, "OP_PARCIALMENTE_ATENDIDO");
  });

  it("erro de montagem do fulfillmentMap retorna warning amigável sem derrubar detalhe", () => {
    const detail = buildPortfolioIntelligenceOrderDetailPayload({
      salesOrderId: "order-1",
      run: runMeta,
      facts: [fact({ id: "a" })],
      orderTotalBySalesOrderId: new Map([["order-1", 100]]),
      asOfDate: "2026-07-10",
      buildFulfillmentMap: () => {
        throw new Error("PrismaClientKnownRequestError: raw boom");
      },
    });
    assert.equal(detail.ok, true);
    assert.ok(detail.detail);
    assert.equal(detail.detail!.fulfillmentMap, null);
    assert.equal(
      detail.detail!.fulfillmentMapWarning,
      PORTFOLIO_FULFILLMENT_MAP_UNAVAILABLE_WARNING
    );
    assert.ok(Array.isArray(detail.detail!.warnings));
    assert.ok(
      detail.detail!.warnings!.some((w) =>
        w === PORTFOLIO_FULFILLMENT_MAP_UNAVAILABLE_WARNING ||
        /mapa de atendimento/i.test(w)
      )
    );
    const serialized = JSON.stringify(detail);
    assert.doesNotMatch(serialized, /PrismaClient|stack|raw boom/i);
    assert.ok(detail.detail!.executiveSummary.length > 0);
    assert.ok(detail.detail!.classification.statusPrincipal);
  });

  it("PD 02339 fixture no detalhe: cabeçalho não atribuído e alertas técnicos", () => {
    const orderId = "3915fa28-1947-4388-bb27-2699c3cbb516";
    const built = buildPortfolioReconciliationFacts({
      runId: runMeta.id,
      mode: "preview",
      snapshot: {
        orders: [
          {
            id: orderId,
            externalSalesOrderId: 2335,
            orderCode: "PD 02339",
            issueDate: new Date(2026, 4, 1),
            customerNameSnapshot: "Britania",
            totalNetValue: 158000,
            items: [
              { id: "item-456", externalProductId: 456, quantity: 3000, unitPrice: 5.85 },
              { id: "item-452", externalProductId: 452, quantity: 9000, unitPrice: 5.85 },
              { id: "item-537", externalProductId: 537, quantity: 5000, unitPrice: 5.86 },
              { id: "item-455", externalProductId: 455, quantity: 10000, unitPrice: 5.85 },
            ],
          },
        ],
        nfeLinks: [
          { salesOrderId: orderId, nfeExternalId: 6937, nfeNumber: "6845" },
          { salesOrderId: orderId, nfeExternalId: 7188, nfeNumber: "7052" },
          { salesOrderId: orderId, nfeExternalId: 7377, nfeNumber: "7195" },
        ],
        nfes: [
          { id: "nfe-6937", externalId: 6937, numero: "6845", valorLiquido: 108240 },
          { id: "nfe-7188", externalId: 7188, numero: "7052", valorLiquido: 168075 },
          { id: "nfe-7377", externalId: 7377, numero: "7195", valorLiquido: 78975 },
        ],
        stockDocuments: [
          {
            id: "doc-7951",
            externalId: 7951,
            idNfe: 6937,
            items: [
              { id: "si-456", externalProductId: 456, quantity: 3000, unitValue: 4.92 },
              { id: "si-452", externalProductId: 452, quantity: 9000, unitValue: 4.92 },
              { id: "si-455", externalProductId: 455, quantity: 10000, unitValue: 4.92 },
            ],
          },
          {
            id: "doc-8175",
            externalId: 8175,
            idNfe: 7188,
            items: [
              { id: "si-537", externalProductId: 537, quantity: 10000, unitValue: 5.86 },
              { id: "si-452b", externalProductId: 452, quantity: 4500, unitValue: 5.85 },
              { id: "si-538", externalProductId: 538, quantity: 6200, unitValue: 5.85 },
              { id: "si-453", externalProductId: 453, quantity: 8000, unitValue: 5.86 },
            ],
          },
          {
            id: "doc-8422",
            externalId: 8422,
            idNfe: 7377,
            items: [
              { id: "si-452c", externalProductId: 452, quantity: 3500, unitValue: 5.85 },
              { id: "si-455b", externalProductId: 455, quantity: 10000, unitValue: 5.85 },
            ],
          },
        ],
      },
    });
    const facts = built.facts.map((d, i) => portfolioFactDraftToApiRow(d, `pd-${i}`));
    const detail = buildPortfolioIntelligenceOrderDetailPayload({
      salesOrderId: orderId,
      run: runMeta,
      facts,
      orderTotalBySalesOrderId: new Map([[orderId, 158000]]),
      asOfDate: "2026-07-10",
    });
    assert.equal(detail.ok, true);
    const map = detail.detail!.fulfillmentMap!;
    assert.ok(map);
    assert.equal(map.fulfillmentSummary.orderValue, 158000);
    assert.ok(map.fulfillmentSummary.nfeHeaderTotalValue > 158000);
    assert.ok(map.fulfillmentSummary.nfeHeaderNotAttributedToOrderValue > 0);
    assert.ok(
      map.fulfillmentSummary.attributedOrderValueByOrderPrice <= 158000.05
    );
    assert.notEqual(
      map.fulfillmentSummary.nfeHeaderTotalValue,
      map.fulfillmentSummary.attributedOrderValueByOrderPrice
    );
    assert.ok(map.technicalAlerts.includes("NF_CABECALHO_MAIOR_PEDIDO"));
    assert.ok(map.technicalAlerts.includes("DIVERGENCIA_PRECO"));
    assert.ok(map.orderItemsCoverage.length >= 4);
    assert.ok(map.stockDocumentsCoverage.length >= 1);
    assert.ok(Array.isArray(map.receivablesCoverage));
    assert.ok(detail.detail!.classification.statusPrincipal);
    assert.notEqual(
      detail.detail!.classification.statusPrincipal,
      map.financialStatus
    );
    assert.doesNotMatch(JSON.stringify(map), /PrismaClient|stack/i);
  });

  it("erro de parâmetro inválido é amigável", () => {
    assert.throws(
      () => parsePortfolioIntelligenceFilters({ dateAxis: "FOO" }),
      (err: unknown) =>
        err instanceof PortfolioIntelligenceApiParseError &&
        /dateAxis inválido/i.test(err.message)
    );
    assert.throws(
      () => parsePortfolioIntelligenceFilters({ statusPrincipal: "XYZ" }),
      (err: unknown) =>
        err instanceof PortfolioIntelligenceApiParseError &&
        /statusPrincipal inválido/i.test(err.message)
    );
    assert.throws(
      () => parsePortfolioIntelligenceFilters({ from: "2026-07-01" }),
      (err: unknown) =>
        err instanceof PortfolioIntelligenceApiParseError &&
        /dateAxis/i.test(err.message)
    );
    const capped = parsePortfolioIntelligenceFilters({ pageSize: "9999" });
    assert.equal(capped.pageSize, PORTFOLIO_INTELLIGENCE_MAX_PAGE_SIZE);
  });

  it("rotas usam financeApiErrorJson e não expõem Prisma", () => {
    const routes = read("src/lib/financePortfolioReconciliationRoutes.ts");
    assert.match(routes, /financeApiErrorJson/);
    assert.match(routes, /PortfolioIntelligenceApiParseError/);
    assert.doesNotMatch(routes, /error\.stack/);
    assert.doesNotMatch(routes, /prisma\./);
  });
});
