import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceCashFlowDashboardQuery,
  buildFinanceCashFlowExportQuery,
  createDefaultFinanceCashFlowUiFilters,
  FINANCE_CASH_FLOW_TABS,
  PHASE1_FINANCE_CASH_FLOW_TABS,
} from "./financeCashFlowDashboardTypes.js";
import { FINANCE_BI_COLORS } from "./financeBiDashboardTheme.js";
import { countActiveCashFlowFilters } from "./financeCashFlowPageUi.js";

describe("financeCashFlowPageFilters", () => {
  it("query padrão inclui ano corrente", () => {
    const defaults = createDefaultFinanceCashFlowUiFilters(2026);
    const q = buildFinanceCashFlowDashboardQuery(defaults);
    assert.ok(q.includes("year=2026"));
  });

  it("export append format=csv", () => {
    const q = buildFinanceCashFlowExportQuery({ year: "2026" });
    assert.ok(q.includes("format=csv"));
    assert.ok(q.includes("year=2026"));
  });

  it("fase 1 só ativa aba Visão Geral", () => {
    assert.deepEqual(PHASE1_FINANCE_CASH_FLOW_TABS, ["overview"]);
    assert.ok(FINANCE_CASH_FLOW_TABS.some((t) => t.id === "calendar"));
  });

  it("FinanceCashFlowPage usa padrão BI executivo e posição líquida", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPage.tsx"),
      "utf8"
    );
    const hero = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "cash-flow",
        "FinanceCashFlowNetPositionHero.tsx"
      ),
      "utf8"
    );
    const charts = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowCharts.tsx"),
      "utf8"
    );
    assert.ok(page.includes("FinanceBiDashboardShell"));
    assert.ok(page.includes("FinanceBiExecutiveHeader"));
    assert.ok(page.includes("FinanceCashFlowKpiCard"));
    assert.ok(page.includes("FinanceCashFlowNetPositionHero"));
    assert.ok(page.includes("computeCashFlowNetPosition"));
    assert.ok(page.includes("Fluxo de Caixa"));
    assert.ok(page.includes("draftFilters"));
    assert.ok(page.includes("appliedFilters"));
    assert.ok(page.includes('data-testid="cash-flow-page"'));
    assert.ok(page.includes('data-testid="cash-flow-filters"'));
    assert.ok(page.includes('testId="kpi-net-balance"'));
    assert.ok(hero.includes('data-testid="kpi-net-position"'));
    assert.ok(page.includes("Resumo executivo"));
    assert.ok(charts.includes("FINANCE_CASH_FLOW_CHART_HEIGHT"));
    assert.ok(charts.includes("cash-flow-main-chart"));
    assert.ok(!page.includes("financeControlRoomTheme"));
  });

  it("tokens BI seguem paleta executiva no fluxo de caixa", () => {
    assert.equal(FINANCE_BI_COLORS.background, "#F9FAFB");
    assert.equal(FINANCE_BI_COLORS.success, "#059669");
    assert.equal(FINANCE_BI_COLORS.risk, "#DC2626");
  });

  it("conta filtros ativos além do padrão", () => {
    const defaults = createDefaultFinanceCashFlowUiFilters(2026);
    assert.equal(countActiveCashFlowFilters(defaults), 0);
    assert.equal(
      countActiveCashFlowFilters({ ...defaults, month: "6", companyName: "Lazarios" }),
      2
    );
  });

  it("navegação inclui cash-flow", () => {
    const nav = readFileSync(
      join(process.cwd(), "src", "lib", "financeNavigation.ts"),
      "utf8"
    );
    assert.ok(nav.includes('"cash-flow"'));
    assert.ok(nav.includes("/finance/cash-flow"));
  });
});
