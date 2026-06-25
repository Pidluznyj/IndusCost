import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { aggregateSalesOrderMarginSummaries } from "./salesOrderMarginDisplay.js";
import {
  buildSalesOrderManagementMarginEconomics,
  countMarginItemStatuses,
  matchesSalesOrderMarginStatusFilter,
} from "./salesOrderManagementMargin.js";
import type {
  SalesOrderMarginItemResult,
  SalesOrderMarginSummaryPayload,
} from "./salesOrderMarginTypes.js";

const ROOT = join(import.meta.dirname, "..");

function summary(
  partial: Partial<SalesOrderMarginSummaryPayload> = {}
): SalesOrderMarginSummaryPayload {
  return {
    netRevenue: 1000,
    totalCost: 400,
    marginValue: 600,
    marginPercent: 60,
    markup: 2.5,
    itemsCount: 1,
    validItemsCount: 1,
    ignoredItemsCount: 0,
    hasMissingCost: false,
    hasMissingProduct: false,
    hasNegativeMargin: false,
    hasInvalidRevenue: false,
    status: "OK",
    statusLabel: "Margem OK",
    statusSeverity: "success",
    ...partial,
  };
}

describe("salesOrderManagementMargin", () => {
  it("aggregateSalesOrderMarginSummaries usa margem % ponderada por receita", () => {
    const a = summary({ netRevenue: 1000, marginValue: 200, marginPercent: 20 });
    const b = summary({ netRevenue: 3000, marginValue: 900, marginPercent: 30 });
    const consolidated = aggregateSalesOrderMarginSummaries([a, b]);
    assert.ok(consolidated);
    assert.equal(consolidated.netRevenue, 4000);
    assert.equal(consolidated.marginValue, 1100);
    assert.ok(Math.abs((consolidated.marginPercent ?? 0) - 27.5) < 0.001);
  });

  it("buildSalesOrderManagementMarginEconomics consolida filtro completo", () => {
    const rows = [
      { marginSummary: summary({ hasNegativeMargin: true, status: "MARGEM_NEGATIVA" }) },
      { marginSummary: summary({ hasMissingCost: true, status: "SEM_CUSTO" }) },
      { marginSummary: summary({ hasMissingProduct: true, status: "SEM_PRODUTO_VINCULADO" }) },
      { marginSummary: null },
    ];
    const economics = buildSalesOrderManagementMarginEconomics(rows);
    assert.equal(economics.ordersWithMarginData, 3);
    assert.equal(economics.ordersWithNegativeMargin, 1);
    assert.equal(economics.ordersWithoutCost, 1);
    assert.equal(economics.ordersWithoutProduct, 1);
    assert.ok(economics.consolidated);
    assert.match(economics.scopeNote, /filtro atual/i);
  });

  it("countMarginItemStatuses conta alertas por item", () => {
    const items = [
      { status: "SEM_CUSTO" },
      { status: "SEM_PRODUTO_VINCULADO" },
      { status: "MARGEM_NEGATIVA" },
      { status: "OK" },
    ] as SalesOrderMarginItemResult[];
    const counts = countMarginItemStatuses(items);
    assert.equal(counts.itemsWithoutCost, 1);
    assert.equal(counts.itemsWithoutProduct, 1);
    assert.equal(counts.itemsWithNegativeMargin, 1);
  });

  it("matchesSalesOrderMarginStatusFilter respeita filtro futuro", () => {
    const ok = summary({ status: "OK" });
    assert.equal(matchesSalesOrderMarginStatusFilter(ok, ""), true);
    assert.equal(matchesSalesOrderMarginStatusFilter(ok, "OK"), true);
    assert.equal(matchesSalesOrderMarginStatusFilter(ok, "MARGEM_NEGATIVA"), false);
    assert.equal(matchesSalesOrderMarginStatusFilter(null, "OK"), false);
  });
});

describe("sales order management margin UI wiring", () => {
  it("Gestão renderiza colunas e seção econômica separada do status logístico", () => {
    const page = readFileSync(join(ROOT, "components/sales/SalesOrderManagementPage.tsx"), "utf8");
    assert.match(page, /sales-order-management-economic-summary/);
    assert.match(page, /sales-order-logistic-status/);
    assert.match(page, /sales-order-management-margin-status/);
    assert.match(page, /Status logístico/);
    assert.match(page, /Status margem/);
    assert.match(page, /Análise econômica/);
    assert.match(page, /data-testid="sales-order-logistic-status"/);
    assert.match(page, /data-testid="sales-order-management-margin-status"/);
  });

  it("Drawer mostra análise econômica sem misturar com logística", () => {
    const drawer = readFileSync(join(ROOT, "components/sales/SalesOrderIntelligenceDrawer.tsx"), "utf8");
    const panel = readFileSync(join(ROOT, "components/sales/SalesOrderEconomicAnalysisPanel.tsx"), "utf8");
    assert.match(drawer, /SalesOrderEconomicAnalysisPanel/);
    assert.match(drawer, /marginSummary/);
    assert.match(panel, /sales-order-economic-analysis/);
    assert.match(drawer, /Status gerencial/);
    assert.doesNotMatch(drawer, /marginSummary\.statusLabel.*logisticStatusLabel/s);
  });

  it("management route retorna marginEconomics do backend", () => {
    const routes = readFileSync(join(ROOT, "lib/salesOrderIntelligenceRoutes.ts"), "utf8");
    assert.match(routes, /marginEconomics/);
    assert.match(routes, /buildSalesOrderManagementMarginEconomics/);
    assert.match(routes, /marginDetail/);
  });

  it("frontend de gestão não importa motor Prisma de margem", () => {
    const page = readFileSync(join(ROOT, "components/sales/SalesOrderManagementPage.tsx"), "utf8");
    assert.doesNotMatch(page, /@prisma\/client|salesOrderMarginService\.server/);
    const panel = readFileSync(join(ROOT, "components/sales/SalesOrderEconomicAnalysisPanel.tsx"), "utf8");
    assert.doesNotMatch(panel, /@prisma\/client|salesOrderMarginService\.server/);
  });
});
