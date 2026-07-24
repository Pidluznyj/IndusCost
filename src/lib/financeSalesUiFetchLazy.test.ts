/**
 * Regressão PERFORMANCE 03 — carregamento sob demanda / sem refetch desnecessário.
 * Valida políticas no código-fonte (sem alterar layout ou regras de negócio).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("PERFORMANCE 03 — lazy tabs e fetch seguro (Pedidos + Financeiro)", () => {
  it("1) aba AR overdue carrega no mount da aba (condicional activeTab)", () => {
    const page = read("src/components/finance/FinanceAccountsReceivablePage.tsx");
    assert.match(page, /activeTab === "overdue" \? \(/);
    assert.match(page, /FinanceAccountsReceivableOverdueTab/);
    const overdue = read("src/components/finance/FinanceAccountsReceivableOverdueTab.tsx");
    assert.match(overdue, /fetchUiSessionCachedJson/);
    assert.match(overdue, /AbortController/);
  });

  it("2) Billing NF-e exclusiva da aba Documentos; comparison/audit sob demanda", () => {
    const billing = read("src/components/finance/FinanceBillingPage.tsx");
    assert.match(billing, /executiveTab !== "documents"/);
    assert.match(billing, /if \(nfeList != null\) return/);
    assert.match(billing, /executiveTab !== "comparison"/);
    assert.match(billing, /if \(comparison != null\) return/);
    assert.match(billing, /executiveTab !== "audit"/);
    assert.match(billing, /if \(audit != null\) return/);
  });

  it("3) retornar a aba Billing nao força reload se payload já existe", () => {
    const billing = read("src/components/finance/FinanceBillingPage.tsx");
    assert.match(billing, /if \(nfeList != null\) return/);
    assert.match(billing, /if \(comparison != null\) return/);
    assert.match(billing, /if \(audit != null\) return/);
  });

  it("4) busca textual AR/AP titles e radar mantem debounce; selects nao", () => {
    const arTitles = read("src/components/finance/FinanceAccountsReceivableTitlesTab.tsx");
    assert.match(arTitles, /setTimeout\(\(\) => setDebouncedSearch\(search\), 400\)/);
    const apTitles = read("src/components/finance/FinanceAccountsPayableTitlesTab.tsx");
    assert.match(apTitles, /setTimeout\(\(\) => setDebouncedSearch\(search\), 400\)/);
    const so = read("src/components/SalesOrdersModule.tsx");
    assert.match(so, /setTimeout\(\(\) => setSearch\(searchDraft\.trim\(\)\), 300\)/);
  });

  it("5) paginação AR/AP titles usa page na query build", () => {
    const arTitles = read("src/components/finance/FinanceAccountsReceivableTitlesTab.tsx");
    assert.match(arTitles, /page,/);
    assert.match(arTitles, /buildFinanceArTitlesQuery/);
    const apTitles = read("src/components/finance/FinanceAccountsPayableTitlesTab.tsx");
    assert.match(apTitles, /buildFinanceApTitlesQuery/);
  });

  it("6) troca rapida cancela via AbortController (AR overdue, CF dashboard, charts)", () => {
    assert.match(
      read("src/components/finance/FinanceAccountsReceivableOverdueTab.tsx"),
      /abortRef\.current\?\.abort/
    );
    assert.match(
      read("src/components/finance/FinanceCashFlowPage.tsx"),
      /dashboardAbortRef\.current\?\.abort/
    );
    assert.match(
      read("src/components/sales/SalesOrderListMonthlyCharts.tsx"),
      /controller\.abort/
    );
  });

  it("7) permissões de view/export nao foram removidas das páginas", () => {
    const ar = read("src/components/finance/FinanceAccountsReceivablePage.tsx");
    assert.match(ar, /canExport|canView|canRunSync/);
    const cf = read("src/components/finance/FinanceCashFlowPage.tsx");
    assert.match(cf, /canViewFinanceCashFlow/);
    assert.match(cf, /if \(!canView\)/);
  });

  it("8) invalidação apos sync AR/AP", () => {
    const ar = read("src/components/finance/FinanceAccountsReceivablePage.tsx");
    assert.match(ar, /invalidateUiSessionGetCache\("\/api\/finance\/accounts-receivable\/"\)/);
    const ap = read("src/components/finance/FinanceAccountsPayablePage.tsx");
    assert.match(ap, /invalidateUiSessionGetCache\("\/api\/finance\/accounts-payable\/"\)/);
  });

  it("9) cache keyed por URL+query (nao compartilha escopos)", () => {
    const cache = read("src/lib/uiSessionGetCache.ts");
    assert.match(cache, /cacheKey = url/);
    assert.match(cache, /fetchUiSessionCachedJson/);
  });

  it("10) branding de impressão nao no mount da lista / AP titles / AR analytical", () => {
    const so = read("src/components/SalesOrdersModule.tsx");
    assert.doesNotMatch(
      so,
      /useEffect\(\(\) => \{\s*void fetchJsonOk<BrandingSettingsDTO>\("\/api\/branding-settings"\)/
    );
    assert.match(so, /ensureBranding/);
    const ap = read("src/components/finance/FinanceAccountsPayableTitlesTab.tsx");
    assert.match(ap, /ensureBranding/);
    assert.doesNotMatch(
      ap,
      /useEffect\(\(\) => \{\s*void fetchJsonOk<BrandingSettingsDTO>\("\/api\/branding-settings"\)/
    );
    const arAnalytical = read("src/components/finance/FinanceArAnalyticalTitlesTab.tsx");
    assert.match(arAnalytical, /ensureBranding/);
  });

  it("Cash Flow annual/daily e SO charts usam IntersectionObserver / useSectionVisible", () => {
    assert.match(
      read("src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChart.tsx"),
      /useSectionVisible/
    );
    assert.match(
      read("src/components/finance/cash-flow/FinanceCashFlowDailyRadar.tsx"),
      /useSectionVisible/
    );
    assert.match(
      read("src/components/sales/SalesOrderListMonthlyCharts.tsx"),
      /useSectionVisible/
    );
    assert.match(read("src/hooks/useSectionVisible.ts"), /IntersectionObserver/);
  });

  it("AP titles default tab permanece sob demanda (só quando executiveTab titles)", () => {
    const ap = read("src/components/finance/FinanceAccountsPayablePage.tsx");
    assert.match(ap, /executiveTab === "titles" \? \(/);
    assert.match(ap, /FinanceApTitlesTab/);
  });

  it("AR pageView titles-analytical so monta a aba analitica quando ativa", () => {
    const ar = read("src/components/finance/FinanceAccountsReceivablePage.tsx");
    assert.match(ar, /pageView === "titles-analytical"/);
    assert.match(ar, /FinanceArAnalyticalTitlesTab/);
  });
});
