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

  it("margin service delega para adapter oficial", () => {
    const service = read("src/lib/salesOrderMarginService.server.ts");
    assert.match(service, /calculateOfficialSalesOrderMarginsForOrders/);
  });

  it("aba Resultado usa motor oficial de margem", () => {
    const result = read("src/lib/salesOrderResultEngine.server.ts");
    assert.match(result, /buildOfficialSalesMarginRulesResult/);
    assert.match(result, /buildOfficialSalesOrderResultMarginPayload/);
    assert.doesNotMatch(result, /computeSalesOrderResultItem\(/);
  });

  it("inteligência do cliente enriquece margem oficial", () => {
    const routes = read("src/lib/customerIntelligenceRoutes.ts");
    assert.match(routes, /enrichCustomerIntelligenceOrdersWithOfficialMargin/);
    const ci = read("src/lib/customerIntelligence.ts");
    assert.match(ci, /computeWeightedMarginPercent/);
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

  it("Cliente 360 consome officialMarginMetrics da API", () => {
    const server = read("server.ts");
    assert.match(server, /resolveOfficialCommercial360MarginMetrics/);
    const page = read("src/components/customers/CustomerCommercial360.tsx");
    assert.match(page, /officialMarginMetrics/);
    assert.match(page, /usesOfficialMarginMetrics/);
    assert.doesNotMatch(page, /totalMarginPerc\), 0\) \/ validCount/);
  });

  it("script de auditoria de consumo de margem existe", () => {
    const script = read("scripts/audit-sales-margin-rules-consumption.ts");
    assert.match(script, /OFFICIAL_SM_RULES_SOURCE/);
    assert.match(script, /buildOfficialSalesMarginRulesResult/);
  });
});
