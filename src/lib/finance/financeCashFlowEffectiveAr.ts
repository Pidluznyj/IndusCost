/**
 * Fluxo de Caixa — agenda efetiva AR (motor compartilhado com Contas a Receber).
 */

import type {
  FinanceArDashboardFilters,
  FinanceArDashboardRow,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import { classifyFinanceArTitle, roundMoney } from "@/src/lib/financeAccountsReceivableDashboard.js";
import type { FinanceCashFlowArRow } from "@/src/lib/financeCashFlowDashboard.js";
import type {
  FinanceArEffectiveOrderContext,
  FinanceArEffectiveTitleListItem,
} from "./financeAccountsReceivableEffectiveTitles.js";
import {
  buildFinanceArEffectivePortfolioItems,
  type FinanceArNfeOrderLink,
} from "./financeArEffectivePortfolio.js";
import {
  filterFinanceArOperationalPortfolioRows,
  suppressInferiorPreNfNomusArRows,
  extractFinanceArOrderCodeHint,
} from "./financeArOperationalPortfolio.js";
import { deduplicateFinanceArRows } from "@/src/lib/financeAccountsReceivableDeduplication.js";
import type { NomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";

export type BuildFinanceCashFlowEffectiveArPortfolioInput = {
  rows: FinanceCashFlowArRow[];
  filters: FinanceArDashboardFilters;
  orderContexts: FinanceArEffectiveOrderContext[];
  nfeOrderLinks?: FinanceArNfeOrderLink[];
  referenceDate?: Date;
  syncCutoff?: NomusArReportSyncCutoff | null;
};

function parseIsoDateLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

/** Mapeia linha FIN-08 de volta ao shape Nomus usado pelo ledger do Fluxo de Caixa. */
export function mapFinanceArEffectiveTitleToCashFlowRow(
  item: FinanceArEffectiveTitleListItem,
  referenceDate: Date
): FinanceCashFlowArRow {
  const dueDate = parseIsoDateLocal(item.dueDate);
  const settlementDate = parseIsoDateLocal(item.settlementDate);
  const syncedAt = item.syncedAt ? new Date(item.syncedAt) : referenceDate;
  const row: FinanceCashFlowArRow = {
    externalId: item.externalId,
    companyName: item.companyName,
    personId: item.personId,
    personName: item.personName,
    personCnpj: item.personCnpj,
    description: item.description,
    comments: item.comments,
    dueDate,
    competenceDate: parseIsoDateLocal(item.competenceDate),
    settlementDate,
    amountReceivable: roundMoney(item.amountReceivable),
    amountReceived: roundMoney(item.amountReceived),
    balanceReceivable: roundMoney(item.balanceReceivable),
    paymentMethodName: item.paymentMethodName,
    bankAccountName: item.bankAccountName,
    sourceInvoiceId: item.sourceInvoiceId,
    sourceInvoiceNumber: item.sourceInvoiceNumber,
    suspendCollection: item.suspendCollection,
    nomusStatus: item.nomusStatus,
    syncedAt,
  };
  classifyFinanceArTitle(row, referenceDate);
  return row;
}

/** Portfólio AR efetivo para Fluxo de Caixa — mesmo motor da grade de Títulos. */
export function buildFinanceCashFlowEffectiveArPortfolio(
  input: BuildFinanceCashFlowEffectiveArPortfolioInput
): FinanceCashFlowArRow[] {
  return buildFinanceCashFlowArRowsAlignedWithTitles(input);
}

/**
 * Mesma cadeia de Títulos: portfolio operacional → FIN-08 / legado NF→Pedido → mapa FC.
 */
export function buildFinanceCashFlowArRowsAlignedWithTitles(
  input: BuildFinanceCashFlowEffectiveArPortfolioInput
): FinanceCashFlowArRow[] {
  const referenceDate = input.referenceDate ?? new Date();
  const orderContexts = input.orderContexts ?? [];
  const nfeOrderLinks = input.nfeOrderLinks ?? [];

  const operational = filterFinanceArOperationalPortfolioRows(
    input.rows,
    input.filters,
    referenceDate,
    input.syncCutoff
  );

  if (orderContexts.length === 0 && nfeOrderLinks.length === 0) {
    return suppressInferiorPreNfNomusArRows(
      deduplicateFinanceArRows(operational).rows
    ) as FinanceCashFlowArRow[];
  }

  const items = buildFinanceArEffectivePortfolioItems({
    rows: operational,
    filters: input.filters,
    orderContexts,
    nfeOrderLinks,
    customerName: input.filters.personName,
    customerCnpj: input.filters.personCnpj,
    referenceDate,
    syncCutoff: input.syncCutoff,
    applyOperationalPortfolioFilter: false,
  });
  return items.map((item) => mapFinanceArEffectiveTitleToCashFlowRow(item, referenceDate));
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
