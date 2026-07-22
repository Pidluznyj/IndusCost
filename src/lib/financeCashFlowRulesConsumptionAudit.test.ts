import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computeCashFlowAccumulatedFromMonthlySeries,
  computeCashFlowNetBalance,
} from "./financeCashFlowRulesAdapter.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("financeCashFlowRulesConsumptionAudit", () => {
  it("adapter de Fluxo de Caixa orquestra motores AR/AP oficiais", () => {
    const adapter = read("src/lib/financeCashFlowRulesAdapter.ts");
    assert.match(adapter, /OFFICIAL_CF_RULES_SOURCE/);
    assert.match(adapter, /buildOfficialCashFlowArApDashboardBundle/);
    assert.match(adapter, /computeCashFlowNetBalance/);
    assert.match(adapter, /OFFICIAL_AR_RULES_SOURCE/);
    assert.match(adapter, /OFFICIAL_AP_RULES_SOURCE/);
  });

  it("dashboard usa adapter e fontes oficiais", () => {
    const dashboard = read("src/lib/financeCashFlowDashboard.ts");
    assert.match(dashboard, /buildOfficialCashFlowArApDashboardBundle/);
    assert.match(dashboard, /resolveOfficialCashFlowSources/);
    assert.match(dashboard, /buildOfficialAccountsReceivableRulesResult/);
    assert.match(dashboard, /buildOfficialAccountsPayableRulesResult/);
    assert.match(dashboard, /officialArBlockTotals/);
    assert.match(dashboard, /officialApBlockTotals/);
    assert.doesNotMatch(dashboard, /NomusAccountsReceivable/);
  });

  it("resumo executivo usa métricas oficiais AR/AP", () => {
    const summary = read("src/lib/financeCashFlowExecutiveSummary.ts");
    assert.match(summary, /resolveOfficialArCashFlowExecutiveMetrics/);
    assert.match(summary, /resolveOfficialApCashFlowExecutiveMetrics/);
    assert.match(summary, /sumOfficialArOpenDueInPeriod/);
    assert.match(summary, /sumOfficialApOpenDueInPeriod/);
  });

  it("radar diário usa ledger oficial AR/AP", () => {
    const radar = read("src/lib/financeCashFlowDailyRadar.ts");
    assert.match(radar, /resolveCashFlowArAmount/);
    assert.match(radar, /resolveCashFlowApAmount/);
    assert.match(radar, /shouldIncludeCashFlowArMovement/);
    assert.match(radar, /shouldIncludeCashFlowApMovement/);
  });

  it("página Fluxo de Caixa preserva componentes principais", () => {
    const page = read("src/components/finance/FinanceCashFlowPage.tsx");
    assert.match(page, /FinanceCashFlowDailyRadar/);
    assert.match(page, /FinanceCashFlowMonthlyPlannedChart/);
    assert.match(page, /FinanceCashFlowExecutiveSummaryPanel/);
    assert.match(page, /FinanceCashFlowAnnualComparisonChart/);
    assert.doesNotMatch(page, /FinanceCashFlowCalendar/);
    assert.doesNotMatch(page, /FinanceCashFlowRiskTab/);
  });

  it("rotas de exportação e radar existem", () => {
    const routes = read("src/lib/financeCashFlowRoutes.ts");
    assert.match(routes, /\/api\/finance\/cash-flow\/dashboard/);
    assert.match(routes, /\/api\/finance\/cash-flow\/daily-radar/);
    assert.match(routes, /\/api\/finance\/cash-flow\/export/);
    assert.match(routes, /daily-radar\/export/);
  });

  it("script de auditoria unificado existe", () => {
    const script = read("scripts/audit-cash-flow-rules-engine-consumption.ts");
    assert.match(script, /OFFICIAL_CF_RULES_SOURCE/);
    assert.match(script, /buildFinanceCashFlowDashboard/);
    assert.match(script, /buildOfficialAccountsReceivableRulesResult/);
    assert.match(script, /buildOfficialAccountsPayableRulesResult/);
  });

  it("saldo líquido = entradas − saídas", () => {
    assert.equal(computeCashFlowNetBalance(1000, 400), 600);
    assert.equal(computeCashFlowNetBalance(500, 800), -300);
  });

  it("saldo acumulado soma saldos mensais", () => {
    const accumulated = computeCashFlowAccumulatedFromMonthlySeries([
      {
        year: 2026,
        month: 1,
        monthLabel: "Jan",
        inflowAmount: 100,
        outflowAmount: 40,
        netFlowAmount: 60,
        accumulatedBalance: 60,
        status: "surplus",
        inflowCount: 1,
        outflowCount: 1,
      },
      {
        year: 2026,
        month: 2,
        monthLabel: "Fev",
        inflowAmount: 50,
        outflowAmount: 80,
        netFlowAmount: -30,
        accumulatedBalance: 30,
        status: "deficit",
        inflowCount: 1,
        outflowCount: 1,
      },
    ]);
    assert.equal(accumulated, 30);
  });
});
