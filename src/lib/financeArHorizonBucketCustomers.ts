import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceArTitlesPayload,
  isFinanceArHorizonTitlesQuery,
  type FinanceArTitlesQuery,
} from "./financeAccountsReceivableTitles.js";
import type { FinanceAgingBucketParam } from "./financeDashboardAgingBuckets.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

export type FinanceArHorizonBucketCustomer = {
  personId: number;
  personName: string;
  personCnpj: string | null;
  titlesCount: number;
  openBalanceAmount: number;
};

function customerKey(row: Pick<FinanceArDashboardRow, "personId" | "personName" | "personCnpj">): string {
  if (row.personId != null && row.personId > 0) return `id:${row.personId}`;
  const name = row.personName?.trim() || "Sem cliente";
  const cnpj = row.personCnpj?.trim() || "";
  return `name:${name}|${cnpj}`;
}

export function listFinanceArHorizonBucketCustomers(
  rows: FinanceArDashboardRow[],
  agingBucket: FinanceAgingBucketParam,
  referenceDate: Date,
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceArHorizonBucketCustomer[] {
  const query: FinanceArTitlesQuery = {
    page: 1,
    limit: 50_000,
    sortBy: "personName",
    sortDirection: "asc",
    filters: { status: "all" },
    extended: {},
    localFilter: "all",
    agingBucket,
  };
  if (!isFinanceArHorizonTitlesQuery(query)) return [];

  const payload = buildFinanceArTitlesPayload(rows, query, referenceDate, syncCutoff);
  const map = new Map<string, FinanceArHorizonBucketCustomer>();

  for (const item of payload.items) {
    const key = customerKey(item);
    const personId = item.personId ?? 0;
    const existing = map.get(key);
    if (existing) {
      existing.titlesCount += 1;
      existing.openBalanceAmount += item.balanceReceivable;
      continue;
    }
    map.set(key, {
      personId: personId > 0 ? personId : -map.size,
      personName: item.personName?.trim() || "Sem cliente",
      personCnpj: item.personCnpj?.trim() || null,
      titlesCount: 1,
      openBalanceAmount: item.balanceReceivable,
    });
  }

  return [...map.values()].sort((a, b) =>
    a.personName.localeCompare(b.personName, "pt-BR", { sensitivity: "base" })
  );
}
