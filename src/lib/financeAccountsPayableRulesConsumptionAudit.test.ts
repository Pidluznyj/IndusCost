import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("financeAccountsPayableRulesConsumptionAudit", () => {
  it("adapter oficial expõe fonte única, nomus e due-radar", () => {
    const adapter = read("src/lib/financeAccountsPayableRulesAdapter.ts");
    assert.match(adapter, /OFFICIAL_AP_RULES_SOURCE/);
    assert.match(adapter, /buildOfficialAccountsPayableRulesResult/);
    assert.match(adapter, /buildOfficialNomusAccountsPayableSummaryResponse/);
    assert.match(adapter, /buildOfficialApDueRadarPayload/);
    assert.match(adapter, /sumOfficialApOpenDueInPeriod/);
    assert.match(adapter, /filterOfficialApTitlesForCostCenter/);
  });

  it("motor oficial concentra management filter e open-due-in-period", () => {
    const engine = read("src/lib/financeAccountsPayableRulesEngine.ts");
    assert.match(engine, /filterOfficialApManagementTitles/);
    assert.match(engine, /sumOfficialApOpenDueInPeriod/);
  });

  it("GET /api/nomus/accounts-payable/summary usa motor oficial", () => {
    const routes = read("src/lib/nomusAccountsPayableRoutes.ts");
    assert.match(routes, /buildOfficialNomusAccountsPayableSummaryResponse/);
    assert.match(routes, /loadFinanceApManagementRowsFromPrisma/);
    assert.doesNotMatch(routes, /buildAccountsPayableSummary/);
    assert.doesNotMatch(routes, /prisma\.nomusAccountsPayable\.findMany/);
  });

  it("due-radar AP e exports usam adapter oficial", () => {
    const routes = read("src/lib/financeDueRadarRoutes.ts");
    assert.match(routes, /buildOfficialApDueRadarPayload/);
    assert.match(routes, /filterOfficialApManagementTitles/);
    assert.doesNotMatch(routes, /buildFinanceApDueRadar/);
    assert.doesNotMatch(routes, /filterFinanceApRows/);
  });

  it("timeline Fluxo de Caixa delega sumApOpenDueInPeriod ao motor", () => {
    const summary = read("src/lib/financeCashFlowExecutiveSummary.ts");
    assert.match(summary, /sumOfficialApOpenDueInPeriod/);
  });

  it("dashboard Fluxo passa totais AP oficiais ao dataset", () => {
    const dashboard = read("src/lib/financeCashFlowDashboard.ts");
    assert.match(dashboard, /buildOfficialAccountsPayableRulesResult/);
    assert.match(dashboard, /officialApBlockTotals/);
  });

  it("Centro de Custo consome base AP oficial antes de classificar", () => {
    const cc = read("src/lib/financeAccountsPayableCostCenterIntegration.ts");
    assert.match(cc, /filterOfficialApTitlesForCostCenter/);
    assert.doesNotMatch(cc, /filterFinanceApRows/);
    const ccDash = read("src/lib/financeCostCenterDashboard.ts");
    assert.match(ccDash, /filterOfficialApTitlesForCostCenter/);
    const ccDetail = read("src/lib/financeCostCenterDetail.ts");
    assert.match(ccDetail, /filterOfficialApTitlesForCostCenter/);
    assert.doesNotMatch(ccDetail, /filterFinanceApRows/);
  });

  it("script de auditoria AP existe", () => {
    const script = read("scripts/audit-accounts-payable-rules-consumption.ts");
    assert.match(script, /OFFICIAL_AP_RULES_SOURCE/);
    assert.match(script, /buildOfficialAccountsPayableRulesResult/);
  });
});
