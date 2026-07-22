/**
 * Fluxo de Caixa — agenda efetiva AR (FIN-08 compartilhado com Contas a Receber).
 *
 * Quando há contexto FIN-05 dos pedidos do portfólio, substitui o suppress isolado
 * por `buildFinanceArEffectiveTitles` — mesma regra do grid de Títulos e do Detalhe.
 */

import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { classifyFinanceArTitle, roundMoney } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { deduplicateFinanceArRows } from "@/src/lib/financeAccountsReceivableDeduplication.js";
import type { FinanceCashFlowArRow } from "@/src/lib/financeCashFlowDashboard.js";
import {
  buildFinanceArEffectiveTitles,
  type FinanceArEffectiveOrderContext,
  type FinanceArEffectiveTitleListItem,
} from "./financeAccountsReceivableEffectiveTitles.js";
import {
  extractFinanceArOrderCodeHint,
  suppressInferiorPreNfNomusArRows,
} from "./financeArOperationalPortfolio.js";

export type BuildFinanceCashFlowEffectiveArPortfolioInput = {
  rows: FinanceCashFlowArRow[];
  orderContexts: FinanceArEffectiveOrderContext[];
  referenceDate?: Date;
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

/**
 * Portfólio AR efetivo para Fluxo de Caixa.
 * Com contexts FIN-05 → FIN-08; sem contexts → suppress FIN-02 legado.
 */
export function buildFinanceCashFlowEffectiveArPortfolio(
  input: BuildFinanceCashFlowEffectiveArPortfolioInput
): FinanceCashFlowArRow[] {
  const referenceDate = input.referenceDate ?? new Date();
  const contexts = input.orderContexts ?? [];

  if (contexts.length === 0) {
    return suppressInferiorPreNfNomusArRows(
      deduplicateFinanceArRows(input.rows).rows
    ) as FinanceCashFlowArRow[];
  }

  const { items } = buildFinanceArEffectiveTitles({
    nomusRows: input.rows,
    orderContexts: contexts,
    referenceDate,
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
