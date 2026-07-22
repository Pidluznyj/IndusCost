import { roundMoney } from "./financeAccountsPayableDashboard.js";
import type { FinanceApTitleListItem } from "./financeAccountsPayableTitles.js";

export type FinanceApTitlesPrintSummary = {
  totalTitles: number;
  totalOriginalValue: number;
  totalPaidValue: number;
  totalOpenValue: number;
  totalOverdueValue: number;
  totalDueValue: number;
  averageTicket: number;
};

/** Resumo executivo do PDF a partir da lista completa filtrada. */
export function buildFinanceApTitlesPrintSummary(
  items: ReadonlyArray<FinanceApTitleListItem>
): FinanceApTitlesPrintSummary {
  let totalOriginalValue = 0;
  let totalPaidValue = 0;
  let totalOpenValue = 0;
  let totalOverdueValue = 0;
  let totalDueValue = 0;

  for (const row of items) {
    totalOriginalValue += row.amountPayable;
    totalPaidValue += row.amountPaid;
    totalOpenValue += row.balancePayable;
    if (row.calculatedStatus === "overdue") {
      totalOverdueValue += row.balancePayable;
    } else if (
      row.calculatedStatus === "upcoming" ||
      row.calculatedStatus === "open" ||
      row.calculatedStatus === "dueToday"
    ) {
      totalDueValue += row.balancePayable;
    }
  }

  const totalTitles = items.length;
  return {
    totalTitles,
    totalOriginalValue: roundMoney(totalOriginalValue),
    totalPaidValue: roundMoney(totalPaidValue),
    totalOpenValue: roundMoney(totalOpenValue),
    totalOverdueValue: roundMoney(totalOverdueValue),
    totalDueValue: roundMoney(totalDueValue),
    averageTicket: totalTitles > 0 ? roundMoney(totalOriginalValue / totalTitles) : 0,
  };
}

export function resolveFinanceApTitleDocumentReference(
  row: Pick<FinanceApTitleListItem, "documentNumber" | "sourceInvoiceId" | "description">
): string {
  const doc = row.documentNumber?.trim();
  if (doc) return doc;
  if (row.sourceInvoiceId != null) return String(row.sourceInvoiceId);
  const desc = row.description?.trim();
  return desc || "—";
}

export function financeApTitlesPdfFilename(referenceDate: Date = new Date()): string {
  const y = referenceDate.getFullYear();
  const m = String(referenceDate.getMonth() + 1).padStart(2, "0");
  const d = String(referenceDate.getDate()).padStart(2, "0");
  return `contas-a-pagar-titulos-${y}-${m}-${d}.pdf`;
}

/** Limite alto para montar o PDF com a mesma base filtrada da tela. */
export const FINANCE_AP_TITLES_PRINT_PAGE_SIZE = 50_000;
