import {
  hasFinanceArSourceInvoice,
  isFinanceArOpen,
  resolveFinanceArCustomerKey,
  roundMoney,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";

export type FinanceArReceivableOrigin = "WITH_NFE" | "WITHOUT_NFE";

export function classifyFinanceArReceivableOrigin(
  row: Pick<FinanceArDashboardRow, "sourceInvoiceId" | "sourceInvoiceNumber">
): FinanceArReceivableOrigin {
  return hasFinanceArSourceInvoice(row) ? "WITH_NFE" : "WITHOUT_NFE";
}

function dateKey(date: Date | null | undefined): string {
  if (!date) return "";
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Chave de consolidação: mesmo cliente, vencimento e valor em aberto. */
export function buildFinanceArDeduplicationKey(row: FinanceArDashboardRow): string {
  const customer = resolveFinanceArCustomerKey(row);
  const due = dateKey(row.dueDate);
  const openBalance = roundMoney(row.balanceReceivable);
  const nominal = roundMoney(row.amountReceivable);
  const amountKey = openBalance > 0 ? `open:${openBalance}` : `nom:${nominal}`;
  return `${customer}|${due}|${amountKey}`;
}

export type FinanceArDeduplicationResult = {
  rows: FinanceArDashboardRow[];
  supersededPreInvoiceCount: number;
  supersededPreInvoiceAmount: number;
};

/**
 * Evita contar duas vezes o mesmo recebível quando existe versão sem NF e com NF
 * (mesmo cliente, vencimento e valor). Mantém a versão com NF.
 */
export function deduplicateFinanceArRows(rows: FinanceArDashboardRow[]): FinanceArDeduplicationResult {
  const groups = new Map<string, FinanceArDashboardRow[]>();
  for (const row of rows) {
    const key = buildFinanceArDeduplicationKey(row);
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const kept = new Set<number>();
  let supersededPreInvoiceCount = 0;
  let supersededPreInvoiceAmount = 0;

  for (const group of groups.values()) {
    const withNfe = group.filter((r) => classifyFinanceArReceivableOrigin(r) === "WITH_NFE");
    const withoutNfe = group.filter((r) => classifyFinanceArReceivableOrigin(r) === "WITHOUT_NFE");

    if (withNfe.length > 0 && withoutNfe.length > 0) {
      for (const row of withNfe) kept.add(row.externalId);
      for (const row of withoutNfe) {
        supersededPreInvoiceCount += 1;
        supersededPreInvoiceAmount += isFinanceArOpen(row)
          ? row.balanceReceivable
          : row.amountReceivable;
      }
      continue;
    }

    for (const row of group) kept.add(row.externalId);
  }

  return {
    rows: rows.filter((r) => kept.has(r.externalId)),
    supersededPreInvoiceCount,
    supersededPreInvoiceAmount: roundMoney(supersededPreInvoiceAmount),
  };
}
