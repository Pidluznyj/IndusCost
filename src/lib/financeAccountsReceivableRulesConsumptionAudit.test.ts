import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("financeAccountsReceivableRulesConsumptionAudit", () => {
  it("adapter oficial expõe fonte única e overdue/nomus", () => {
    const adapter = read("src/lib/financeAccountsReceivableRulesAdapter.ts");
    assert.match(adapter, /OFFICIAL_AR_RULES_SOURCE/);
    assert.match(adapter, /buildOfficialAccountsReceivableRulesResult/);
    assert.match(adapter, /buildOfficialNomusAccountsReceivableSummaryResponse/);
    assert.match(adapter, /buildOfficialAccountsReceivableOverduePayload/);
    assert.match(adapter, /sumOfficialArOpenDueInPeriod/);
  });

  it("motor oficial concentra overdue e open-due-in-period", () => {
    const engine = read("src/lib/financeAccountsReceivableRulesEngine.ts");
    assert.match(engine, /isOfficialArOverdueTitle/);
    assert.match(engine, /sumOfficialArOverdueAmount/);
    assert.match(engine, /sumOfficialArOpenDueInPeriod/);
  });

  it("GET /api/nomus/accounts-receivable/summary usa motor oficial", () => {
    const routes = read("src/lib/nomusAccountsReceivableRoutes.ts");
    assert.match(routes, /buildOfficialNomusAccountsReceivableSummaryResponse/);
    assert.match(routes, /loadFinanceArManagementRowsFromPrisma/);
    assert.doesNotMatch(routes, /buildAccountsReceivableSummary/);
    assert.doesNotMatch(routes, /prisma\.nomusAccountsReceivable\.findMany/);
  });

  it("overdue API e export usam adapter oficial", () => {
    const routes = read("src/lib/financeAccountsReceivableOverdueRoutes.ts");
    assert.match(routes, /buildOfficialAccountsReceivableOverduePayload/);
    assert.doesNotMatch(routes, /buildFinanceArOverduePayload/);
  });

  it("overdue helper delega classificação ao motor", () => {
    const overdue = read("src/lib/financeAccountsReceivableOverdue.ts");
    assert.match(overdue, /isOfficialArOverdueTitle/);
    assert.match(overdue, /filterOfficialArOverdueTitles/);
    assert.match(overdue, /sumOfficialArOverdueAmount/);
  });

  it("timeline Fluxo de Caixa delega sumArOpenDueInPeriod ao motor", () => {
    const summary = read("src/lib/financeCashFlowExecutiveSummary.ts");
    assert.match(summary, /sumOfficialArOpenDueInPeriod/);
  });

  it("dashboard Fluxo passa totais AR oficiais ao dataset", () => {
    const dashboard = read("src/lib/financeCashFlowDashboard.ts");
    assert.match(dashboard, /buildOfficialAccountsReceivableRulesResult/);
    assert.match(dashboard, /officialArBlockTotals/);
  });

  it("dataset aceita totais AR oficiais sem recalcular regra", () => {
    const dataset = read("src/lib/financeCashFlowDataset.ts");
    assert.match(dataset, /officialArBlockTotals/);
    assert.match(dataset, /officialArTotals\?\.totalReceivableOpen/);
  });

  it("script de auditoria AR existe", () => {
    const script = read("scripts/audit-accounts-receivable-rules-consumption.ts");
    assert.match(script, /OFFICIAL_AR_RULES_SOURCE/);
    assert.match(script, /buildOfficialAccountsReceivableRulesResult/);
  });
});
