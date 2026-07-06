import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceModuleEyebrow,
  FINANCE_FILTER_PANEL_TITLE,
  FINANCE_HEADER_ACTION_EXPORT_CSV,
  FINANCE_HEADER_ACTION_REFRESH,
  FINANCE_MODULE_TAB_ENDPOINTS,
  FINANCE_MODULE_TAB_LABELS,
} from "./financeModuleUiStandards.js";

const ROOT = process.cwd();

type TabSpec = {
  id: keyof typeof FINANCE_MODULE_TAB_LABELS;
  page: string;
};

const TABS: TabSpec[] = [
  { id: "cash-flow", page: "src/components/finance/FinanceCashFlowPage.tsx" },
  { id: "accounts-receivable", page: "src/components/finance/FinanceAccountsReceivablePage.tsx" },
  { id: "accounts-payable", page: "src/components/finance/FinanceAccountsPayablePage.tsx" },
  { id: "billing", page: "src/components/finance/FinanceBillingPage.tsx" },
  { id: "sales-orders", page: "src/components/finance/FinanceSalesOrdersPage.tsx" },
  { id: "executive-report", page: "src/components/finance/FinanceExecutiveReportPage.tsx" },
];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("financeModuleUiStandards", () => {
  it("buildFinanceModuleEyebrow gera breadcrumb FINANCEIRO · ABA", () => {
    assert.equal(buildFinanceModuleEyebrow("sales-orders"), "FINANCEIRO · PEDIDOS DE VENDA");
    assert.equal(buildFinanceModuleEyebrow("cash-flow"), "FINANCEIRO · FLUXO DE CAIXA");
  });

  it("constantes de ações e filtros", () => {
    assert.equal(FINANCE_FILTER_PANEL_TITLE, "Filtros");
    assert.equal(FINANCE_HEADER_ACTION_REFRESH, "Atualizar");
    assert.equal(FINANCE_HEADER_ACTION_EXPORT_CSV, "Exportar CSV");
  });

  for (const tab of TABS) {
    describe(tab.id, () => {
      it("página existe", () => {
        assert.ok(existsSync(join(ROOT, tab.page)));
      });

      it("tem loading e tratamento de erro", () => {
        const page = read(tab.page);
        assert.match(page, /loading|Loader2|Carregando/i);
        assert.match(page, /setError|setDashboardError|dashboardError|error/i);
      });

      it("tem botão Atualizar", () => {
        const page = read(tab.page);
        const filters =
          tab.id === "executive-report"
            ? read("src/components/finance/executive-report/ExecutiveReportFilters.tsx")
            : "";
        const src = page + filters;
        assert.match(src, /FINANCE_HEADER_ACTION_REFRESH|Atualizar/);
      });
    });
  }

  it("abas BI usam cabeçalho executivo compartilhado", () => {
    const biTabs = TABS.filter((t) => t.id !== "executive-report");
    for (const tab of biTabs) {
      assert.match(read(tab.page), /FinanceExecutivePageHeader/);
    }
  });

  it("abas BI usam painel de filtros compartilhado", () => {
    const biTabs = TABS.filter((t) => t.id !== "executive-report");
    for (const tab of biTabs) {
      assert.match(read(tab.page), /FinanceBiFilterPanel/);
    }
  });

  it("abas BI usam drawer de auditoria", () => {
    const biTabs = TABS.filter((t) => t.id !== "executive-report");
    for (const tab of biTabs) {
      assert.match(read(tab.page), /FinanceDataAuditDrawer/);
      assert.match(read(tab.page), /FinanceDataAuditButton/);
    }
  });

  it("abas com export usam Exportar CSV no header", () => {
    for (const tab of ["accounts-receivable", "accounts-payable", "sales-orders", "cash-flow"] as const) {
      const page = read(TABS.find((t) => t.id === tab)!.page);
      assert.match(page, /FINANCE_HEADER_ACTION_EXPORT_CSV|Exportar CSV/);
    }
  });

  it("estado vazio compartilhado em abas principais", () => {
    assert.match(read("src/components/finance/FinanceSalesOrdersPage.tsx"), /FinanceBiEmptyState|FinanceModuleEmptyState/);
    assert.match(read("src/components/finance/FinanceCashFlowPage.tsx"), /FinanceBiEmptyState|empty/i);
  });

  it("Relatório Presidencial mantém filtros, impressão e auditoria", () => {
    const page = read("src/components/finance/FinanceExecutiveReportPage.tsx");
    const filters = read("src/components/finance/executive-report/ExecutiveReportFilters.tsx");
    assert.match(page, /ExecutiveReportFilters/);
    assert.match(page, /ExecutiveReportDocument/);
    assert.match(page, /FinanceDataAuditDrawer/);
    assert.match(filters, /FINANCE_HEADER_ACTION_EXPORT_PDF|Exportar PDF/);
    assert.match(filters, /Limpar/);
  });

  it("endpoints documentados por aba", () => {
    assert.equal(FINANCE_MODULE_TAB_ENDPOINTS["cash-flow"], "/api/finance/cash-flow/dashboard");
    assert.equal(FINANCE_MODULE_TAB_LABELS.billing, "Faturamento");
  });

  it("FinanceModuleStates exporta componentes padronizados", () => {
    const src = read("src/components/finance/shared/FinanceModuleStates.tsx");
    assert.match(src, /FinanceModuleErrorBanner/);
    assert.match(src, /FinanceModuleLoadingBlock/);
    assert.match(src, /FinanceModuleEmptyState/);
  });
});
