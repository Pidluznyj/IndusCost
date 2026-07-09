import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildOfficialManagementMetricsBundle,
  buildSalesOrderManagementSourceAudit,
} from "./salesOrderManagementMetrics.js";
import type { SalesOrderManagementRow } from "./salesOrderManagementTypes.js";
import type {
  SalesOrderMarginItemResult,
  SalesOrderMarginSummaryPayload,
} from "./salesOrderMarginTypes.js";
import { aggregateSalesOrderMarginSummaries } from "./salesOrderMarginDisplay.js";
import { buildSalesOrderManagementMarginEconomics } from "./salesOrderManagementMargin.js";
import { OFFICIAL_SO_RULES_SOURCE } from "./salesOrderRulesAdapter.js";
import { OFFICIAL_SM_RULES_SOURCE } from "./salesMarginRulesAdapter.js";

const ROOT = join(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function marginSummary(
  partial: Partial<SalesOrderMarginSummaryPayload> &
    Pick<SalesOrderMarginSummaryPayload, "marginValue" | "marginPercent" | "netRevenue" | "totalCost">
): SalesOrderMarginSummaryPayload {
  return {
    netRevenue: partial.netRevenue,
    totalCost: partial.totalCost,
    marginValue: partial.marginValue,
    marginPercent: partial.marginPercent,
    markup: partial.markup ?? (partial.totalCost > 0 ? partial.netRevenue / partial.totalCost : null),
    itemsCount: partial.itemsCount ?? 1,
    validItemsCount: partial.validItemsCount ?? 1,
    ignoredItemsCount: partial.ignoredItemsCount ?? 0,
    hasMissingCost: partial.hasMissingCost ?? false,
    hasMissingProduct: partial.hasMissingProduct ?? false,
    hasNegativeMargin: partial.hasNegativeMargin ?? false,
    hasInvalidRevenue: partial.hasInvalidRevenue ?? false,
    status: partial.status ?? "OK",
    statusLabel: partial.statusLabel ?? "OK",
    statusSeverity: partial.statusSeverity ?? "success",
    costCoverageStatus: partial.costCoverageStatus ?? "FULL",
    marginCoveragePercent: partial.marginCoveragePercent ?? 100,
    totalSalesRevenueInScope: partial.totalSalesRevenueInScope ?? partial.netRevenue,
    marginRevenueCovered: partial.marginRevenueCovered ?? partial.netRevenue,
    marginRevenueUncovered: partial.marginRevenueUncovered ?? 0,
    itemsTotal: partial.itemsTotal ?? 1,
    itemsWithCost: partial.itemsWithCost ?? 1,
    itemsWithoutCost: partial.itemsWithoutCost ?? 0,
    itemsWithoutProduct: partial.itemsWithoutProduct ?? 0,
    itemsWithNegativeMargin: partial.itemsWithNegativeMargin ?? 0,
    taxMode: partial.taxMode ?? "OFFICIAL",
  };
}

function row(
  partial: Partial<SalesOrderManagementRow> & Pick<SalesOrderManagementRow, "id">
): SalesOrderManagementRow {
  return {
    id: partial.id,
    number: partial.orderCode ?? "PD-1",
    orderCode: partial.orderCode ?? "PD-1",
    customerName: partial.customerName ?? "Cliente",
    issueDate: partial.issueDate ?? "2026-07-10",
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

describe("gestão pedidos — validação cruzada cards × tabela", () => {
  it("total de pedidos e valor vendido batem com soma das linhas filtradas", () => {
    const rows = [
      row({ id: "a", totalNetValue: 1_000_000 }),
      row({ id: "b", totalNetValue: 2_500_000 }),
      row({ id: "c", totalNetValue: 3_700_000 }),
    ];
    const bundle = buildOfficialManagementMetricsBundle(rows, new Map());

    const tableCount = rows.length;
    const tableSold = rows.reduce((sum, r) => sum + r.totalNetValue, 0);

    assert.equal(bundle.officialMetrics.totalOrders, tableCount);
    assert.equal(bundle.fulfillmentKpis.totalOrders, tableCount);
    assert.equal(bundle.summary.gridFilteredCount, tableCount);
    assert.equal(bundle.activeRows.length, tableCount);
    assert.equal(bundle.officialMetrics.soldAmount, tableSold);
    assert.equal(bundle.fulfillmentKpis.totalSoldValue, tableSold);
  });

  it("ticket médio = valor vendido ÷ pedidos", () => {
    const rows = [
      row({ id: "a", totalNetValue: 1000 }),
      row({ id: "b", totalNetValue: 3000 }),
    ];
    const bundle = buildOfficialManagementMetricsBundle(rows, new Map());
    assert.equal(bundle.officialMetrics.averageTicket, 2000);
    assert.equal(
      bundle.officialMetrics.averageTicket,
      bundle.officialMetrics.soldAmount / bundle.officialMetrics.totalOrders
    );
  });

  it("margem R$ e % seguem agregação oficial sobre summaries", () => {
    const summaries = [
      marginSummary({
        netRevenue: 1000,
        totalCost: 400,
        marginValue: 600,
        marginPercent: 60,
      }),
      marginSummary({
        netRevenue: 2000,
        totalCost: 1000,
        marginValue: 1000,
        marginPercent: 50,
      }),
    ];
    const rows = [
      row({ id: "a", marginSummary: summaries[0] }),
      row({ id: "b", marginSummary: summaries[1] }),
    ];
    const bundle = buildOfficialManagementMetricsBundle(rows, new Map());
    const expected = aggregateSalesOrderMarginSummaries(summaries)!;

    assert.equal(bundle.marginEconomics.consolidated?.marginValue, expected.marginValue);
    assert.equal(bundle.marginEconomics.consolidated?.marginPercent, expected.marginPercent);
    assert.equal(bundle.marginEconomics.consolidated?.netRevenue, expected.netRevenue);
    assert.equal(bundle.marginEconomics.consolidated?.totalCost, expected.totalCost);
  });

  it("itens sem custo e margem negativa batem entre alertas, marginEconomics e sourceAudit", () => {
    const itemResults = new Map<string, SalesOrderMarginItemResult[]>([
      [
        "a",
        [
          {
            salesOrderItemId: "i1",
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
          {
            salesOrderItemId: "i2",
            quantity: 1,
            netUnitRevenue: 500,
            netRevenue: 500,
            unitCost: 800,
            totalCost: 800,
            marginValue: -300,
            marginPercent: -60,
            markup: 0.625,
            status: "MARGEM_NEGATIVA",
            statusLabel: "Margem negativa",
            statusSeverity: "danger",
            costSource: "VERSIONED_PRODUCTION_COST",
            costConfidence: "high",
            notes: [],
          },
        ],
      ],
    ]);

    const summary = marginSummary({
      netRevenue: 1000,
      totalCost: 800,
      marginValue: 200,
      marginPercent: 20,
      hasMissingCost: true,
      hasNegativeMargin: true,
      status: "PARTIAL",
      statusLabel: "Parcial",
      statusSeverity: "warning",
      costCoverageStatus: "PARTIAL",
      marginCoveragePercent: 66.7,
      itemsWithoutCost: 1,
      itemsWithNegativeMargin: 1,
    });

    const rows = [row({ id: "a", marginSummary: summary })];
    const bundle = buildOfficialManagementMetricsBundle(rows, itemResults);

    assert.equal(bundle.marginEconomics.itemCounts.itemsWithoutCost, 1);
    assert.equal(bundle.marginEconomics.itemCounts.itemsWithNegativeMargin, 1);
    assert.equal(bundle.marginEconomics.ordersWithoutCost, 1);
    assert.equal(bundle.marginEconomics.ordersWithNegativeMargin, 1);
    assert.equal(bundle.sourceAudit.itemsWithoutCost, 1);
    assert.equal(bundle.sourceAudit.itemsWithNegativeMargin, 1);
  });

  it("marginStatus filtra cards e tabela no mesmo activeRows (service)", () => {
    const server = read("lib/salesOrderManagementMetrics.server.ts");
    assert.match(server, /const activeRows = filters\.marginStatus/);
    assert.match(server, /buildOfficialManagementMetricsBundle\(\s*activeRows/);
    assert.match(server, /rows: activeRows/);
  });

  it("filtro vendedor e cliente passam pelo mesmo WHERE antes do bundle", () => {
    const server = read("lib/salesOrderManagementMetrics.server.ts");
    assert.match(server, /resolveSalesOrderManagementWhere/);
    assert.match(server, /resolveSalesOrderListSellerWhere/);
    const mgmt = read("lib/salesOrderManagement.ts");
    assert.match(mgmt, /customerId/);
    assert.match(mgmt, /sellerWhere/);
  });
});

describe("gestão pedidos — Comercial × Financeiro", () => {
  it("ambos usam SalesOrder.totalNetValue e motor oficial de regras", () => {
    const finance = read("lib/financeSalesOrdersDashboard.ts");
    const mgmt = read("lib/salesOrderManagementMetrics.ts");
    assert.match(finance, /buildOfficialSalesOrderRulesResult/);
    assert.match(finance, /SALES_ORDER_RULES_PRISMA_SELECT/);
    assert.match(mgmt, /SalesOrder\.totalNetValue/);
    assert.match(mgmt, /OFFICIAL_SO_RULES_SOURCE/);
    assert.match(finance, /mapOfficialFinancePortfolioFromManagementRows/);
  });

  it("valor faturado diverge por definição documentada (NF vs header pedido)", () => {
    const mgmt = read("lib/salesOrderManagementMetrics.ts");
    const financeTypes = read("lib/financeSalesOrdersDashboardTypes.ts");
    assert.match(mgmt, /invoicedNfeAmount/);
    assert.match(mgmt, /SalesOrderLinkedNfeContext\.nfeTotalValue/);
    assert.match(financeTypes, /invoicedOrdersAmount/);
    assert.match(financeTypes, /notInvoicedOrdersAmount/);
  });

  it("documento de fontes e layout descreve divergências legítimas", () => {
    const doc = "docs/gestao-pedidos-venda-fontes-e-layout.md";
    assert.ok(existsSync(join(ROOT, doc)));
    const text = read(doc);
    assert.match(text, /Financeiro/);
    assert.match(text, /invoicedNfeAmount|nfeTotalValue/);
    assert.match(text, /invoicedOrdersAmount/);
  });
});

describe("gestão pedidos — fontes proibidas", () => {
  const MANAGEMENT_FILES = [
    "lib/salesOrderManagementMetrics.server.ts",
    "lib/salesOrderManagementMetrics.ts",
    "lib/salesOrderManagement.ts",
    "lib/salesOrderIntelligenceRoutes.ts",
    "components/sales/SalesOrderManagementPage.tsx",
    "components/sales/SalesOrderManagementKpiDashboard.tsx",
    "components/sales/SalesOrderManagementMarginOverview.tsx",
    "components/sales/SalesOrderManagementKpiSecondaryPanel.tsx",
  ];

  for (const file of MANAGEMENT_FILES) {
    it(`${file} não usa Proposal/AR como fonte de valor`, () => {
      const src = read(file);
      assert.doesNotMatch(src, /prisma\.proposal/i);
      assert.doesNotMatch(src, /AccountsReceivable/);
      assert.doesNotMatch(src, /proposalId.*totalNetValue/si);
    });
  }

  it("vendedor na gestão usa resolução oficial, não responsible como filtro Prisma direto", () => {
    const server = read("lib/salesOrderManagementMetrics.server.ts");
    assert.match(server, /resolveSalesOrderListSellerWhere/);
    assert.doesNotMatch(server, /responsible:\s*\{\s*contains/s);
  });
});

describe("gestão pedidos — layout padrão", () => {
  it("cards usam SystemTotalizerCard sem textos longos de cobertura no card", () => {
    for (const file of [
      "components/sales/SalesOrderManagementKpiDashboard.tsx",
      "components/sales/SalesOrderManagementMarginOverview.tsx",
      "components/sales/SalesOrderManagementKpiSecondaryPanel.tsx",
    ]) {
      const src = read(file);
      assert.match(src, /SystemTotalizerCard/, `${file}`);
      assert.match(src, /SYSTEM_TOTALIZER_GRID_CLASS/, `${file}`);
      assert.doesNotMatch(src, /buildSalesOrderMarginCoverageHint/, `${file}`);
      assert.doesNotMatch(src, /<MetricCard[\s\n/>]/, `${file}`);
    }
  });

  it("valores monetários usam amountFormat compacto via SystemTotalizerCard", () => {
    const dash = read("components/sales/SalesOrderManagementKpiDashboard.tsx");
    assert.match(dash, /amountFormat="currency"/);
    const totalizer = read("components/ui/SystemTotalizerCard.tsx");
    assert.match(totalizer, /formatKpiCompactCurrency/);
  });

  it("margem parcial usa tooltip e subtítulo curto", () => {
    const margin = read("components/sales/SalesOrderManagementMarginOverview.tsx");
    assert.match(margin, /SalesOrderMarginInfoTooltip/);
    assert.match(margin, /resolveMarginCardShortSubtitle/);
  });

  it("auditoria de fonte visível na página", () => {
    const page = read("components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /sales-order-management-source-audit/);
    assert.match(page, /sourceAudit\.orderValueSource/);
    assert.match(page, /sourceAudit\.marginSource/);
    assert.equal(
      read("lib/salesOrderManagementMetrics.ts").includes(OFFICIAL_SM_RULES_SOURCE),
      true
    );
    assert.equal(
      read("lib/salesOrderManagementMetrics.ts").includes(OFFICIAL_SO_RULES_SOURCE),
      true
    );
  });
});
