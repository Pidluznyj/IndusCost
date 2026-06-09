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

  it("FinanceCashFlowPage usa padrão BI executivo", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("FinanceBiDashboardShell"));
    assert.ok(page.includes("FinanceBiExecutiveHeader"));
    assert.ok(page.includes("FinanceBiKpiCard"));
    assert.ok(page.includes("Fluxo de Caixa"));
    assert.ok(page.includes("draftFilters"));
    assert.ok(page.includes("appliedFilters"));
    assert.ok(page.includes("Resumo executivo"));
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
