import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildOfficialManagementMetricsBundle,
  buildSalesOrderManagementSourceAudit,
} from "./salesOrderManagementMetrics.js";
import type { SalesOrderManagementRow } from "./salesOrderManagementTypes.js";
import type { SalesOrderMarginItemResult } from "./salesOrderMarginTypes.js";
import { buildSalesOrderManagementMarginEconomics } from "./salesOrderManagementMargin.js";
import { OFFICIAL_SM_RULES_SOURCE } from "./salesMarginRulesAdapter.js";

const ROOT = join(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function row(
  partial: Partial<SalesOrderManagementRow> & Pick<SalesOrderManagementRow, "id">
): SalesOrderManagementRow {
  return {
    id: partial.id,
    number: partial.orderCode ?? "PD-1",
    orderCode: partial.orderCode ?? "PD-1",
    customerName: partial.customerName ?? "Cliente",
    issueDate: partial.issueDate ?? "2026-01-15",
    expectedDeliveryDate: null,
    totalNetValue: partial.totalNetValue ?? 10_000,
    responsible: partial.responsible ?? "Vendedor",
    crmCommercialResponsible: null,
    nomusSellerName: partial.nomusSellerName ?? "Vendedor",
    canonicalSellerName: partial.canonicalSellerName ?? null,
    nomusSellerDisplayName: partial.nomusSellerDisplayName ?? "Vendedor",
    nomusSellerResolutionStatus: null,
    nomusSellerHistoricalRule: false,
    externalSellerId: partial.externalSellerId ?? 42,
    legacyResponsibleAudit: null,
    nomusSellerStatus: "RESOLVED",
    nomusSellerStatusLabel: "OK",
    executiveStatusLabel: "Ativo",
    logisticStatusCardId: partial.logisticStatusCardId ?? "onTimePending",
    logisticStatusLabel: partial.logisticStatusLabel ?? "No prazo",
    operationalStatus: partial.operationalStatus ?? "open",
    billingStatus: partial.billingStatus ?? "not_invoiced",
    deadlineStatus: partial.deadlineStatus ?? "on_track",
    completionStatus: partial.completionStatus ?? "open",
    daysOverdue: null,
    hasInvoice: partial.hasInvoice ?? false,
    invoiceNumbers: [],
    invoicedPercent: null,
    invoicedValue: partial.invoicedValue ?? 0,
    nfeProcessingDisplay: "—",
    invoiceCoveragePercent: null,
    nfeCount: 0,
    slaStatus: "pending",
    slaDays: null,
    needsDataReview: false,
    reviewReasons: [],
    hasCut: false,
    hasLinkedProductionOrder: false,
    productionOrderLate: false,
    fulfilledPercent: null,
    itemsCount: 1,
    riskCount: 0,
    highRiskCount: 0,
    riskFlags: [],
    marginSummary: partial.marginSummary,
  };
}

describe("salesOrderManagementMetrics", () => {
  it("valor vendido agrega SalesOrder.totalNetValue", () => {
    const bundle = buildOfficialManagementMetricsBundle(
      [
        row({ id: "a", totalNetValue: 1000 }),
        row({ id: "b", totalNetValue: 2500 }),
      ],
      new Map()
    );
    assert.equal(bundle.officialMetrics.soldAmount, 3500);
    assert.equal(bundle.fulfillmentKpis.totalSoldValue, 3500);
    assert.equal(bundle.sourceAudit.orderValueSource, "SalesOrder.totalNetValue");
  });

  it("valor faturado fiscal usa invoicedValue (NF) sem substituir valor vendido", () => {
    const bundle = buildOfficialManagementMetricsBundle(
      [
        row({ id: "a", totalNetValue: 10_000, invoicedValue: 6_000, hasInvoice: true }),
        row({ id: "b", totalNetValue: 5_000, invoicedValue: 0, hasInvoice: false }),
      ],
      new Map()
    );
    assert.equal(bundle.officialMetrics.invoicedNfeAmount, 6000);
    assert.equal(bundle.officialMetrics.soldAmount, 15_000);
    assert.equal(bundle.sourceAudit.invoicedFiscalSource, "SalesOrderLinkedNfeContext.nfeTotalValue");
  });

  it("carteira aberta e pedidos faturados usam hasInvoice no pedido", () => {
    const bundle = buildOfficialManagementMetricsBundle(
      [
        row({ id: "a", hasInvoice: true, totalNetValue: 1000 }),
        row({ id: "b", hasInvoice: false, totalNetValue: 2000 }),
      ],
      new Map()
    );
    assert.equal(bundle.officialMetrics.invoicedOrdersCount, 1);
    assert.equal(bundle.officialMetrics.openPortfolioCount, 1);
    assert.equal(bundle.officialMetrics.openPortfolioAmount, 2000);
    assert.equal(bundle.officialMetrics.invoicedOrdersAmount, 1000);
  });

  it("ticket médio calculado sobre valor vendido oficial", () => {
    const bundle = buildOfficialManagementMetricsBundle(
      [row({ id: "a", totalNetValue: 1000 }), row({ id: "b", totalNetValue: 3000 })],
      new Map()
    );
    assert.equal(bundle.officialMetrics.averageTicket, 2000);
  });

  it("margem parcial sinaliza itens sem custo na auditoria", () => {
    const marginEconomics = buildSalesOrderManagementMarginEconomics(
      [
        {
          marginSummary: {
            netRevenue: 1000,
            totalCost: 400,
            marginValue: 600,
            marginPercent: 60,
            markup: 2.5,
            itemsCount: 2,
            validItemsCount: 1,
            ignoredItemsCount: 1,
            hasMissingCost: true,
            hasMissingProduct: false,
            hasNegativeMargin: false,
            hasInvalidRevenue: false,
            status: "PARTIAL",
            statusLabel: "Parcial",
            statusSeverity: "warning",
            costCoverageStatus: "PARTIAL",
            marginCoveragePercent: 50,
            totalSalesRevenueInScope: 2000,
            marginRevenueCovered: 1000,
            marginRevenueUncovered: 1000,
            itemsTotal: 2,
            itemsWithCost: 1,
            itemsWithoutCost: 1,
            itemsWithoutProduct: 0,
            itemsWithNegativeMargin: 0,
          },
        },
      ],
      new Map<string, SalesOrderMarginItemResult[]>([
        [
          "a",
          [
            {
              salesOrderItemId: "i1",
              quantity: 1,
              netUnitRevenue: 1000,
              netRevenue: 1000,
              unitCost: 400,
              totalCost: 400,
              marginValue: 600,
              marginPercent: 60,
              markup: 2.5,
              status: "OK",
              statusLabel: "OK",
              statusSeverity: "success",
              costSource: "VERSIONED_PRODUCTION_COST",
              costConfidence: "high",
              notes: [],
            },
            {
              salesOrderItemId: "i2",
              quantity: 1,
              netUnitRevenue: 1000,
              netRevenue: 1000,
              unitCost: 0,
              totalCost: 0,
              marginValue: null,
              marginPercent: null,
              markup: null,
              status: "SEM_CUSTO",
              statusLabel: "Sem custo",
              statusSeverity: "warning",
              costSource: "MISSING_COST",
              costConfidence: "low",
              notes: [],
            },
          ],
        ],
      ])
    );

    const audit = buildSalesOrderManagementSourceAudit({
      activeRows: [row({ id: "a" })],
      marginEconomics,
    });
    assert.equal(audit.marginSource, OFFICIAL_SM_RULES_SOURCE);
    assert.equal(audit.itemsWithoutCost, 1);
    assert.ok(audit.partialCoverageWarning?.includes("Margem parcial"));
  });

  it("cards e fulfillmentKpis usam o mesmo conjunto de linhas (activeRows)", () => {
    const rows = [
      row({ id: "a", totalNetValue: 1000 }),
      row({ id: "b", totalNetValue: 2000 }),
    ];
    const bundle = buildOfficialManagementMetricsBundle(rows, new Map());
    assert.equal(bundle.officialMetrics.totalOrders, 2);
    assert.equal(bundle.fulfillmentKpis.totalOrders, 2);
    assert.equal(bundle.summary.gridFilteredCount, 2);
    assert.equal(bundle.activeRows.length, 2);
  });
});

describe("salesOrderManagementMetrics — integração estática", () => {
  it("service centralizado existe e rota delega", () => {
    const server = read("lib/salesOrderManagementMetrics.server.ts");
    assert.match(server, /loadSalesOrderManagementMetrics/);
    assert.match(server, /buildOfficialManagementMetricsBundle/);
    assert.match(server, /resolveSalesOrderListSellerWhere/);
    assert.match(server, /calculateSalesOrderMarginsForOrders/);
    assert.doesNotMatch(server, /prisma\.proposal/i);

    const routes = read("lib/salesOrderIntelligenceRoutes.ts");
    assert.match(routes, /salesOrderManagementMetrics\.server/);
    assert.doesNotMatch(routes, /officialCore\.fulfillmentKpis/);
  });

  it("filtro vendedor usa resolução oficial por externalSellerId", () => {
    const server = read("lib/salesOrderManagementMetrics.server.ts");
    assert.match(server, /resolveSalesOrderListSellerWhere/);
    const mgmt = read("lib/salesOrderManagement.ts");
    assert.match(mgmt, /sellerWhere/);
  });

  it("UI consome officialMetrics e sourceAudit", () => {
    const page = read("components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /sourceAudit/);
    assert.match(page, /sales-order-management-source-audit/);
    const dash = read("components/sales/SalesOrderManagementKpiDashboard.tsx");
    assert.match(dash, /officialMetrics/);
    assert.doesNotMatch(dash, /Proposal/);
  });

  it("export gestão usa service centralizado", () => {
    const exp = read("lib/salesOrderInternalMarginExport.server.ts");
    assert.match(exp, /loadSalesOrderManagementMetrics/);
    assert.doesNotMatch(exp, /buildManagementRowsFromOrders/);
  });
});
