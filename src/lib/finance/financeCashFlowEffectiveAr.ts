/**
 * Fluxo de Caixa — agenda efetiva AR (motor compartilhado com Contas a Receber).
 */

import type {
  FinanceArDashboardFilters,
  FinanceArDashboardRow,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import { roundMoney } from "@/src/lib/financeAccountsReceivableDashboard.js";
import type { FinanceCashFlowArRow } from "@/src/lib/financeCashFlowDashboard.js";
import type {
  FinanceArEffectiveOrderContext,
} from "./financeAccountsReceivableEffectiveTitles.js";
import { type FinanceArNfeOrderLink } from "./financeArOperationalPortfolio.js";
import {
  mapFinanceArEffectiveTitleToCashFlowRow,
  resolveFinanceArCanonicalEffectiveTitlesAsCashFlowRows,
} from "./financeArEffectiveTitlesSource.js";
import { extractFinanceArOrderCodeHint } from "./financeArOperationalPortfolio.js";
import type { NomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";

export type { FinanceArNfeOrderLink };
export { mapFinanceArEffectiveTitleToCashFlowRow } from "./financeArEffectiveTitlesSource.js";

export type BuildFinanceCashFlowEffectiveArPortfolioInput = {
  rows: FinanceCashFlowArRow[];
  filters: FinanceArDashboardFilters;
  orderContexts: FinanceArEffectiveOrderContext[];
  nfeOrderLinks?: FinanceArNfeOrderLink[];
  referenceDate?: Date;
  syncCutoff?: NomusArReportSyncCutoff | null;
};

/** Portfólio AR efetivo para Fluxo de Caixa — mesmo motor da grade de Títulos. */
export function buildFinanceCashFlowEffectiveArPortfolio(
  input: BuildFinanceCashFlowEffectiveArPortfolioInput
): FinanceCashFlowArRow[] {
  return buildFinanceCashFlowArRowsAlignedWithTitles(input);
}

/**
 * Portfólio AR efetivo — delega à fonte canônica de Títulos.
 * Recorte de mês/ano do Fluxo de Caixa: `filterCashFlowArRowsScoped`.
 */
export function buildFinanceCashFlowArRowsAlignedWithTitles(
  input: BuildFinanceCashFlowEffectiveArPortfolioInput
): FinanceCashFlowArRow[] {
  const referenceDate = input.referenceDate ?? new Date();
  return resolveFinanceArCanonicalEffectiveTitlesAsCashFlowRows({
    rows: input.rows,
    filters: input.filters,
    orderContexts: input.orderContexts ?? [],
    nfeOrderLinks: input.nfeOrderLinks,
    customerName: input.filters.personName,
    customerCnpj: input.filters.personCnpj,
    referenceDate,
    syncCutoff: input.syncCutoff,
    applyOperationalPortfolioFilter: true,
  });
}

/** Soma em aberto por pedido (hint na descrição ou orderCode FIN-08). */
export function sumFinanceCashFlowOpenByOrderCode(
  rows: readonly Pick<FinanceArDashboardRow, "description" | "balanceReceivable">[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!(row.balanceReceivable > 0)) continue;
    const code = extractFinanceArOrderCodeHint(row.description);
    if (!code) continue;
    const key = code.trim().toUpperCase();
    totals.set(key, roundMoney((totals.get(key) ?? 0) + row.balanceReceivable));
  }
  return totals;
}
