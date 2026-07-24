/**
 * Regressão PERFORMANCE 07 — renderização React (Pedidos + Financeiro).
 * Valida políticas no código-fonte sem alterar layout ou regras de negócio.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("PERFORMANCE 07 — render React (Pedidos + Financeiro)", () => {
  it("1) tabela SO memoiza tabela e linha; callbacks estáveis no módulo", () => {
    const table = read("src/components/sales/SalesOrderListTable.tsx");
    assert.match(table, /memo\(function SalesOrderListTableRow/);
    assert.match(table, /export const SalesOrderListTable = memo\(/);
    const module = read("src/components/SalesOrdersModule.tsx");
    assert.match(module, /const handleRowOpenSummary = useCallback/);
    assert.match(module, /const handleOpenDetailFromList = useCallback/);
    assert.match(module, /const monthlyChartsFilters = useMemo/);
    assert.match(module, /filters=\{monthlyChartsFilters\}/);
  });

  it("2) tooltip de margem memoiza texto oficial (sem rebuild a cada render pai)", () => {
    const tip = read("src/components/sales/SalesOrderMarginInfoTooltip.tsx");
    assert.match(tip, /memo\(function SalesOrderMarginInfoTooltip/);
    assert.match(tip, /useMemo/);
    assert.match(tip, /buildOfficialSalesOrderMarginTooltipText/);
  });

  it("3) gráficos mensais SO e célula de margem são memo", () => {
    assert.match(
      read("src/components/sales/SalesOrderListMonthlyCharts.tsx"),
      /export const SalesOrderListMonthlyCharts = memo\(/
    );
    assert.match(
      read("src/components/sales/SalesOrderListMarginCell.tsx"),
      /export const SalesOrderListMarginCell = memo\(/
    );
  });

  it("4) modais/drawers fechados nao montam portal pesado", () => {
    const detail = read("src/components/sales/SalesOrderDetailDialog.tsx");
    assert.match(detail, /if \(!open\) return null/);
    const drawer = read("src/components/sales/SalesOrderQuickSummaryDrawer.tsx");
    assert.match(drawer, /if \(!open \|\| !row\) return null/);
    const audit = read("src/components/finance/shared/FinanceDataAuditDrawer.tsx");
    assert.match(audit, /if \(!open\) return null/);
  });

  it("5) AR estabiliza arrays vazios e cardTone; charts memo", () => {
    const page = read("src/components/finance/FinanceAccountsReceivablePage.tsx");
    assert.match(page, /EMPTY_AR_AGING_BUCKETS/);
    assert.match(page, /const agingCardTone = useCallback/);
    assert.match(page, /const agingDrilldownCards = useMemo/);
    assert.match(page, /cardTone=\{agingCardTone\}/);
    const charts = read("src/components/finance/FinanceAccountsReceivableCharts.tsx");
    assert.match(charts, /export const FinanceArAgingChart = memo\(/);
    assert.match(charts, /export const FinanceArTopDebtorsChart = memo\(/);
    assert.match(charts, /export const FinanceArPortfolioMixChart = memo\(/);
  });

  it("6) AP estabiliza arrays vazios e charts memo", () => {
    const page = read("src/components/finance/FinanceAccountsPayablePage.tsx");
    assert.match(page, /EMPTY_AP_AGING_BUCKETS/);
    assert.match(page, /const agingCardTone = useCallback/);
    assert.match(page, /cardTone=\{agingCardTone\}/);
    const charts = read("src/components/finance/FinanceAccountsPayableCharts.tsx");
    assert.match(charts, /export const FinanceApAgingChart = memo\(/);
    assert.match(charts, /export const FinanceApTopDebtorsChart = memo\(/);
    assert.doesNotMatch(charts, /\}\);:/);
  });

  it("7) abas analiticas AR memoizadas; so painel ativo monta (condicional)", () => {
    const panels = read("src/components/finance/FinanceAccountsReceivableTabPanels.tsx");
    assert.match(panels, /export const FinanceArAgingTab = memo\(/);
    assert.match(panels, /export const FinanceArCustomersTab = memo\(/);
    assert.match(panels, /export const FinanceArAuditTab = memo\(/);
    const page = read("src/components/finance/FinanceAccountsReceivablePage.tsx");
    assert.match(page, /activeTab === "aging" \? \(/);
    assert.match(page, /activeTab === "overdue" \? \(/);
  });

  it("8) sem virtualizacao (paginacao existente preservada; layout intacto)", () => {
    const table = read("src/components/sales/SalesOrderListTable.tsx");
    assert.doesNotMatch(table, /react-window|react-virtual|useVirtualizer|VirtualList/);
    const so = read("src/components/SalesOrdersModule.tsx");
    assert.match(so, /SALES_ORDERS_PAGE_SIZE/);
    assert.match(so, /setCurrentPage/);
  });

  it("9) formatação pt-BR / helpers oficiais preservados", () => {
    const table = read("src/components/sales/SalesOrderListTable.tsx");
    assert.match(table, /formatSalesOrderListNetValue/);
    assert.match(table, /formatSalesOrderListIssueDate/);
    const charts = read("src/components/finance/FinanceAccountsReceivableCharts.tsx");
    assert.match(charts, /formatFinanceCurrency/);
    assert.match(charts, /formatFinanceCurrencyCompact/);
  });
});
