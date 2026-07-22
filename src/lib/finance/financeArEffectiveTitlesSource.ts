/**
 * Fonte canônica de títulos efetivos AR (Contas a Receber).
 *
 * Contas a Receber > Títulos é a UI principal; este módulo é a camada de dados
 * compartilhada por Fluxo de Caixa, radar diário, relatório presidencial e demais
 * consumidores financeiros.
 *
 * Regra: o motor FIN-08 (com FIN-05 / vínculos NF→Pedido) roda sobre o portfólio
 * gerencial **sem recorte de mês/ano**. Recortes de período (mês, YTD, calendário)
 * são aplicados apenas na camada de apresentação de cada tela.
 */

import { classifyFinanceArTitle, roundMoney } from "@/src/lib/financeAccountsReceivableDashboard.js";
import type { FinanceCashFlowArRow } from "@/src/lib/financeCashFlowDashboard.js";
import type { FinanceArEffectiveTitleListItem } from "./financeAccountsReceivableEffectiveTitles.js";
import {
  buildFinanceArEffectiveTitleItemsLikeTitlesGrid,
  type BuildFinanceArEffectivePortfolioInput,
} from "./financeArEffectivePortfolio.js";

export type { BuildFinanceArEffectivePortfolioInput };
export { stripFinanceArEffectiveMotorPeriodFilters } from "./financeArEffectivePortfolio.js";

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

/** Agenda efetiva — mesma saída da grade Contas a Receber > Títulos (antes de paginação UI). */
export function resolveFinanceArCanonicalEffectiveTitles(
  input: BuildFinanceArEffectivePortfolioInput
): FinanceArEffectiveTitleListItem[] {
  return buildFinanceArEffectiveTitleItemsLikeTitlesGrid(input);
}

export function mapFinanceArCanonicalEffectiveTitlesToCashFlowRows(
  items: readonly FinanceArEffectiveTitleListItem[],
  referenceDate: Date
): FinanceCashFlowArRow[] {
  return items.map((item) => mapFinanceArEffectiveTitleToCashFlowRow(item, referenceDate));
}

/** Títulos canônicos → linhas do ledger do Fluxo de Caixa (sem recorte de período). */
export function resolveFinanceArCanonicalEffectiveTitlesAsCashFlowRows(
  input: BuildFinanceArEffectivePortfolioInput
): FinanceCashFlowArRow[] {
  const referenceDate = input.referenceDate ?? new Date();
  return mapFinanceArCanonicalEffectiveTitlesToCashFlowRows(
    resolveFinanceArCanonicalEffectiveTitles(input),
    referenceDate
  );
}
