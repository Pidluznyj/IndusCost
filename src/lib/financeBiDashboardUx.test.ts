import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FINANCE_BI_COLORS } from "./financeBiDashboardTheme.js";
import {
  FINANCE_BI_FILTER_STATUS_LABELS,
  resolveFinanceBiFilterStatus,
} from "./financeBiFilterState.js";
import { buildFinanceArFilterChips } from "./financeBiFilterChips.js";
import { EMPTY_FINANCE_AR_UI_FILTERS } from "./financeAccountsReceivableDashboardTypes.js";

function readPage(rel: string): string {
  return readFileSync(join(process.cwd(), "src", "components", "finance", rel), "utf8");
}

describe("financeBiDashboardUx", () => {
  it("tokens visuais BI seguem paleta executiva", () => {
    assert.equal(FINANCE_BI_COLORS.background, "#F9FAFB");
    assert.equal(FINANCE_BI_COLORS.card, "#FFFFFF");
    assert.equal(FINANCE_BI_COLORS.border, "#E5E7EB");
    assert.equal(FINANCE_BI_COLORS.primary, "#2563EB");
  });

  it("resolveFinanceBiFilterStatus prioriza alterações pendentes", () => {
    assert.equal(resolveFinanceBiFilterStatus(false, false), "none");
    assert.equal(resolveFinanceBiFilterStatus(true, false), "applied");
    assert.equal(resolveFinanceBiFilterStatus(true, true), "pending");
    assert.equal(FINANCE_BI_FILTER_STATUS_LABELS.pending, "Alterações pendentes");
  });

  it("buildFinanceArFilterChips gera chips removíveis para filtros aplicados", () => {
    const chips = buildFinanceArFilterChips(
      { ...EMPTY_FINANCE_AR_UI_FILTERS, status: "overdue", personName: "Cliente X" },
      () => undefined
    );
    assert.ok(chips.some((c) => c.label.includes("Status")));
    assert.ok(chips.some((c) => c.label.includes("Cliente X")));
    assert.equal(chips.every((c) => typeof c.onRemove === "function"), true);
  });

  it("telas financeiras usam shell e header BI", () => {
    for (const page of [
      "FinanceAccountsReceivablePage.tsx",
      "FinanceAccountsPayablePage.tsx",
      "FinanceBillingPage.tsx",
    ]) {
      const src = readPage(page);
      assert.ok(src.includes("FinanceBiDashboardShell"), page);
      assert.ok(src.includes("FinanceBiExecutiveHeader"), page);
      assert.ok(src.includes("FinanceBiFilterPanel"), page);
      assert.ok(src.includes("resolveFinanceBiFilterStatus"), page);
    }
  });

  it("componentes BI foundation existem", () => {
    const biDir = join(process.cwd(), "src", "components", "finance", "bi");
    for (const file of [
      "FinanceBiDashboardShell.tsx",
      "FinanceBiExecutiveHeader.tsx",
      "FinanceBiFilterPanel.tsx",
      "FinanceBiFilterChips.tsx",
      "FinanceBiKpiCard.tsx",
      "FinanceBiEmptyState.tsx",
      "FinanceBiCalcTooltip.tsx",
    ]) {
      readFileSync(join(biDir, file), "utf8");
    }
    assert.ok(readFileSync(join(process.cwd(), "docs", "generated", "finance-bi-dashboard-ux-guidelines.md"), "utf8").includes("F9FAFB"));
  });
});
