import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("salesMarginRulesConsumptionAudit", () => {
  it("adapter oficial de margem existe e expõe fonte única", () => {
    const adapter = read("src/lib/salesMarginRulesAdapter.ts");
    assert.match(adapter, /OFFICIAL_SM_RULES_SOURCE/);
    assert.match(adapter, /buildOfficialSalesMarginRulesResult/);
    assert.match(adapter, /calculateOfficialSalesOrderMarginsForOrders/);
    assert.match(adapter, /computeWeightedMarginPercent/);
  });

  it("margin service delega attach* para adapter oficial", () => {
    const service = read("src/lib/salesOrderMarginService.server.ts");
    assert.match(service, /calculateOfficialSalesOrderMarginsForOrders/);
    const attachBlock = service.slice(
      service.indexOf("export async function attachMarginsToSalesOrders"),
      service.indexOf("export async function attachMarginToSalesOrderDetail")
    );
    assert.doesNotMatch(attachBlock, /buildSalesOrderMarginContext\(/);
  });

  it("aba Resultado usa motor oficial de margem", () => {
    const result = read("src/lib/salesOrderResultEngine.server.ts");
    assert.match(result, /buildOfficialSalesMarginRulesResult/);
    assert.match(result, /resolveOfficialSalesMarginTaxContext/);
    assert.match(result, /loadSalesMarginNomusConfig/);
    assert.doesNotMatch(result, /computeSalesOrderResultItem\(/);
  });

  it("inteligência do cliente enriquece margem oficial", () => {
    const routes = read("src/lib/customerIntelligenceRoutes.ts");
    assert.match(routes, /enrichCustomerIntelligenceOrdersWithOfficialMargin/);
    const ci = read("src/lib/customerIntelligence.ts");
    assert.match(ci, /aggregateSalesOrderMarginSummaries/);
    assert.match(ci, /marginCoverage/);
    assert.doesNotMatch(ci, /marginPercSamples\.reduce/);
  });

  it("histórico e produtos CI usam margem ponderada", () => {
    const history = read("src/lib/customerIntelligenceHistory.ts");
    assert.match(history, /computeWeightedMarginPercent/);
    assert.doesNotMatch(history, /averageMarginPercent\(agg\.marginPercSamples\)/);
    const products = read("src/lib/customerIntelligenceProducts.ts");
    assert.match(products, /computeWeightedMarginPercent/);
    assert.doesNotMatch(products, /marginPercSamples/);
  });

  it("Cliente 360 consome margem oficial da API sem fallback Nomus", () => {
    const server = read("server.ts");
    assert.match(server, /loadOfficialCommercial360MarginBundle/);
    const page = read("src/components/customers/CustomerCommercial360.tsx");
    assert.match(page, /marginSummary/);
    assert.match(page, /aggregateSalesOrderMarginSummaries/);
    assert.match(page, /usesOfficialMarginMetrics/);
    assert.doesNotMatch(page, /totalMarginValue\), 0\)/);
    assert.doesNotMatch(page, /totalMarginPerc\), 0\) \/ validCount/);
    assert.doesNotMatch(page, /legacyPercent/);
  });

  it("listagem de pedidos usa apenas marginSummary oficial", () => {
    const table = read("src/components/sales/SalesOrderListTable.tsx");
    const cell = read("src/components/sales/SalesOrderListMarginCell.tsx");
    const display = read("src/lib/salesOrderMarginDisplay.ts");
    assert.match(table, /marginSummary=\{row\.marginSummary\}/);
    assert.doesNotMatch(table, /legacyPercent/);
    assert.doesNotMatch(table, /totalMarginPerc/);
    assert.doesNotMatch(cell, /legacyPercent/);
    assert.doesNotMatch(display, /legacyPercent/);
  });

  it("fluxos operacionais não forçam taxMode none", () => {
    const operational = [
      "src/lib/salesOrderMarginService.server.ts",
      "src/lib/salesMarginRulesAdapter.ts",
    ];
    for (const file of operational) {
      const src = read(file);
      assert.doesNotMatch(src, /buildInput:\s*\{\s*taxMode:\s*["']none["']/);
      assert.doesNotMatch(src, /buildOfficialSalesMarginRulesResult\([^)]*\{\s*taxMode:\s*["']none["']/);
    }
  });

  it("calculateOfficialSalesOrderMarginsForOrders usa config Nomus por padrão", () => {
    const adapter = read("src/lib/salesMarginRulesAdapter.ts");
    assert.match(adapter, /loadSalesMarginNomusConfig/);
    assert.match(adapter, /nomusConfig\.taxMode/);
    assert.match(adapter, /resolveOfficialSalesMarginTaxContext/);
  });

  it("script de auditoria de política oficial de margem existe", () => {
    const script = read("scripts/audit-sales-margin-official-policy.ts");
    assert.match(script, /audit-sales-margin-official-policy/);
    assert.match(script, /BLOQUEANTE/);
    assert.match(script, /taxMode.*none/);
    assert.match(script, /buildOfficialSalesOrderMarginTooltipText/);
    assert.match(script, /OPERATIONAL_NEVER_TAX_MODE_NONE/);
  });

  it("script de auditoria de consumo de margem existe", () => {
    const script = read("scripts/audit-sales-margin-rules-consumption.ts");
    assert.match(script, /OFFICIAL_SM_RULES_SOURCE/);
    assert.match(script, /buildOfficialSalesMarginRulesResult/);
    assert.match(script, /salesOrdersLoaded/);
    assert.match(script, /itemsWithUnitCostSnapshot/);
    assert.match(script, /costCoverageStatus/);
    assert.match(script, /marginRevenueCovered/);
    assert.match(script, /buildSalesOrderListWhere/);
    assert.match(script, /Auditoria por tela/);
    assert.match(script, /loadSalesMarginNomusConfig/);
    assert.match(script, /taxModeEffective/);
    assert.match(script, /OPERATIONAL_MARGIN_SOURCE_FILES/);
    assert.match(script, /operationalFileForcesTaxModeNone/);
  });

  it("relatórios expõem margem oficial com cobertura", () => {
    const reports = read("src/lib/reportsDataService.ts");
    assert.match(reports, /calculateOfficialSalesOrderMarginsForOrders/);
    assert.match(reports, /officialMarginValue/);
    assert.match(reports, /marginPortfolio/);
    const ui = read("src/components/ReportsModule.tsx");
    assert.match(ui, /resolveSalesOrderMarginMoneyLabel/);
  });

  it("motor expõe cobertura de margem parcial", () => {
    const types = read("src/lib/salesOrderMarginTypes.ts");
    assert.match(types, /costCoverageStatus/);
    assert.match(types, /totalSalesRevenueInScope/);
    const coverage = read("src/lib/salesOrderMarginCoverage.ts");
    assert.match(coverage, /resolveSalesOrderMarginMoneyLabel/);
    assert.match(read("src/lib/salesOrderRulesAdapter.ts"), /officialMarginValue/);
  });

  it("listagem Pedidos exibe margem geral ponderada do motor oficial", () => {
    const cards = read("src/components/sales/SalesOrderListSummaryCards.tsx");
    const server = read("server.ts");
    assert.match(cards, /Margem comercial/);
    assert.match(cards, /SalesOrderMarginInfoTooltip/);
    assert.match(
      read("src/lib/salesOrderListMarginSummary.server.ts"),
      /buildOfficialSalesOrderListMarginSummary/
    );
    assert.doesNotMatch(cards, /naiveAverageMarginPercent/);
  });
});
