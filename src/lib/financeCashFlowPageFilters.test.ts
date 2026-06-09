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
import { CONTROL_ROOM_COLORS } from "./financeControlRoomTheme.js";
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

  it("FinanceCashFlowPage usa Control Room e data-testid principais", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPage.tsx"),
      "utf8"
    );
    const shell = readFileSync(
      join(process.cwd(), "src", "components", "finance", "cash-flow", "FinanceCashFlowShell.tsx"),
      "utf8"
    );
    const filters = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "cash-flow",
        "FinanceCashFlowFilterPanel.tsx"
      ),
      "utf8"
    );
    assert.ok(page.includes("FinanceCashFlowShell"));
    assert.ok(page.includes("FinanceCashFlowHeader"));
    assert.ok(page.includes("FinanceCashFlowKpiCard"));
    assert.ok(page.includes("financeControlRoomTheme"));
    assert.ok(page.includes("Fluxo de Caixa"));
    assert.ok(page.includes("draftFilters"));
    assert.ok(page.includes("appliedFilters"));
    assert.ok(shell.includes('data-testid="cash-flow-page"'));
    assert.ok(filters.includes('data-testid="cash-flow-filters"'));
    assert.ok(page.includes('testId="kpi-net-balance"'));
    assert.ok(page.includes("FinanceCashFlowCalendar"));
    assert.ok(page.includes("Resumo executivo"));
  });

  it("tokens Control Room seguem paleta earthy swiss", () => {
    assert.equal(CONTROL_ROOM_COLORS.background, "#FDFDFC");
    assert.equal(CONTROL_ROOM_COLORS.inflow, "#2C5530");
    assert.equal(CONTROL_ROOM_COLORS.outflow, "#B64230");
    assert.equal(CONTROL_ROOM_COLORS.ink, "#1C1917");
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
