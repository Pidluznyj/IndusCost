import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { naiveAverageMarginPercent } from "./salesOrderMarginMath.js";
import { computeWeightedMarginPercent } from "./salesMarginRulesAdapter.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("salesOrderListMarginSummary", () => {
  it("card Margem geral na Visão Geral da listagem", () => {
    const cards = read("src/components/sales/SalesOrderListSummaryCards.tsx");
    const module = read("src/components/SalesOrdersModule.tsx");
    assert.match(cards, /Margem geral/);
    assert.match(cards, /sales-order-list-general-margin-card/);
    assert.match(cards, /SalesOrderMarginInfoTooltip/);
    assert.match(cards, /Margem geral ponderada/);
    assert.match(cards, /Imposto a pagar/);
    assert.match(cards, /sales-order-list-tax-payable-card/);
    assert.match(cards, /marginSummary\?\.taxAmount/);
    assert.match(module, /marginSummary/);
    assert.match(module, /showMarginCard=\{showMarginEconomics\}/);
  });

  it("API lista não bloqueia na margem geral; endpoint dedicado usa motor oficial", () => {
    const server = read("server.ts");
    const routes = read("src/lib/salesOrderListReportExportRoutes.ts");
    const loader = read("src/lib/salesOrderListMarginSummary.server.ts");
    const adapter = read("src/lib/salesMarginRulesAdapter.ts");
    const module = read("src/components/SalesOrdersModule.tsx");
    assert.match(server, /marginSummary:\s*undefined/);
    assert.doesNotMatch(server, /buildOfficialSalesOrderListMarginSummary/);
    assert.match(routes, /SALES_ORDER_LIST_MARGIN_SUMMARY_PATH/);
    assert.match(routes, /loadSalesOrderListMarginSummary/);
    assert.match(
      read("src/lib/salesOrderListMarginSummaryApi.ts"),
      /\/api\/sales-orders\/margin-summary/
    );
    assert.match(loader, /buildOfficialSalesOrderListMarginSummary/);
    assert.match(loader, /SALES_ORDER_LIST_MARGIN_PRISMA_SELECT/);
    assert.match(module, /getSalesOrderListMarginSummaryUrl/);
    assert.match(adapter, /export async function buildOfficialSalesOrderListMarginSummary/);
    assert.match(adapter, /aggregateSalesOrderMarginSummaries/);
  });

  it("margem geral é ponderada — não média simples", () => {
    const weighted = computeWeightedMarginPercent(93.14, 286.63);
    const naive = naiveAverageMarginPercent([
      { marginPercent: 40, netRevenue: 100 },
      { marginPercent: 10, netRevenue: 100 },
    ]);
    assert.ok(Math.abs(weighted - 32.5) < 0.1);
    assert.notEqual(naive, weighted);
    const adapter = read("src/lib/salesMarginRulesAdapter.ts");
    assert.doesNotMatch(adapter, /naiveAverageMarginPercent/);
  });

  it("UI não calcula margem final no React", () => {
    const cards = read("src/components/sales/SalesOrderListSummaryCards.tsx");
    assert.doesNotMatch(cards, /marginPercent\s*=/);
    assert.doesNotMatch(cards, /totalMarginValue\s*\/\s*totalManagerialNetRevenue/);
    assert.doesNotMatch(cards, /naiveAverageMarginPercent/);
    assert.doesNotMatch(cards, /computeWeightedMarginPercent/);
  });

  it("cobertura PARTIAL exibe badge", () => {
    const cards = read("src/components/sales/SalesOrderListSummaryCards.tsx");
    assert.match(cards, /Margem parcial/);
    assert.match(cards, /marginCoverage === "PARTIAL"/);
  });

  it("cobertura NONE exibe indisponível", () => {
    const cards = read("src/components/sales/SalesOrderListSummaryCards.tsx");
    assert.match(cards, /Indisponível/);
    assert.match(cards, /Sem custo suficiente para calcular/);
    assert.match(cards, /!marginSummary\?\.available/);
  });

  it("considera todos os pedidos filtrados — query no endpoint de margem, fora da listagem", () => {
    const loader = read("src/lib/salesOrderListMarginSummary.server.ts");
    assert.match(loader, /SALES_ORDER_LIST_MARGIN_PRISMA_SELECT/);
    assert.match(loader, /resolveSalesOrderListWhere/);
    assert.doesNotMatch(
      read("src/components/SalesOrdersModule.tsx"),
      /rows\.map[\s\S]*marginSummary/
    );
  });
});
