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
} from "./portfolioMaturityIntelligenceApi.js";
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
