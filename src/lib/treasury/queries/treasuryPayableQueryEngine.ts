/**
 * Motor puro de filtro/ordenação/paginação da listagem CP Tesouraria.
 */

import type { TreasuryPayableListItemDto } from "../contracts/treasuryPayableContracts.js";
import type { TreasuryPayablesListQuery } from "../contracts/treasurySchemas.js";
import { buildTreasuryPaginationMeta } from "../contracts/treasuryPagination.js";
import { matchesTaxIdFilter } from "../domain/treasuryReceivableQueryRules.js";

const PRIORITY_RANK: Record<string, number> = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  URGENT: 4,
};

function includesInsensitive(
  haystack: string | null | undefined,
  needle: string | null
): boolean {
  if (!needle) return true;
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function payableMatchesQuery(
  row: TreasuryPayableListItemDto,
  query: TreasuryPayablesListQuery
): boolean {
  if (
    !includesInsensitive(row.official.counterparty.name, query.supplierName)
  ) {
    return false;
  }
  if (
    query.supplierTaxId &&
    !matchesTaxIdFilter(row.official.counterparty.taxId, query.supplierTaxId)
  ) {
    return false;
  }
  if (query.document) {
    const docHay = [
      row.official.documentNumber,
      row.official.description,
      row.official.invoice.number,
      String(row.externalId),
    ]
      .filter(Boolean)
      .join(" ");
    if (!includesInsensitive(docHay, query.document)) return false;
  }
  if (
    !includesInsensitive(row.classification, query.classification) &&
    !includesInsensitive(row.official.classification, query.classification)
  ) {
    return false;
  }
  if (query.costCenterId && row.costCenterId !== query.costCenterId) {
    return false;
  }
  if (
    query.costCenter &&
    !includesInsensitive(row.costCenterLabel, query.costCenter) &&
    !includesInsensitive(row.costCenterId, query.costCenter)
  ) {
    return false;
  }
  if (query.dueFrom && (!row.official.dueDate || row.official.dueDate < query.dueFrom)) {
    return false;
  }
  if (query.dueTo && (!row.official.dueDate || row.official.dueDate > query.dueTo)) {
    return false;
  }
  if (
    query.scheduledFrom &&
    (!row.scheduledDate || row.scheduledDate < query.scheduledFrom)
  ) {
    return false;
  }
  if (
    query.scheduledTo &&
    (!row.scheduledDate || row.scheduledDate > query.scheduledTo)
  ) {
    return false;
  }
  if (
    query.operationalStatus &&
    row.operationalStatus !== query.operationalStatus
  ) {
    return false;
  }
  if (
    query.complementStatus &&
    row.complement?.status !== query.complementStatus
  ) {
    return false;
  }
  const open = Number(row.openAmount ?? 0);
  if (query.openAmountMin != null && open < Number(query.openAmountMin)) {
    return false;
  }
  if (query.openAmountMax != null && open > Number(query.openAmountMax)) {
    return false;
  }
  if (
    query.plannedAccountId &&
    row.plannedAccountId !== query.plannedAccountId
  ) {
    return false;
  }
  if (query.priority && row.priority !== query.priority) {
    return false;
  }
  if (
    query.responsibleUserId &&
    row.complement?.responsibleUserId !== query.responsibleUserId
  ) {
    return false;
  }
  if (!query.includeCancelled) {
    if (
      row.operationalStatus === "CANCELLED_SOURCE" ||
      row.operationalStatus === "CANCELLED_LOCAL"
    ) {
      return false;
    }
  }
  return true;
}

function comparePayables(
  a: TreasuryPayableListItemDto,
  b: TreasuryPayableListItemDto,
  query: TreasuryPayablesListQuery
): number {
  const dir = query.sortDirection === "desc" ? -1 : 1;
  let cmp = 0;
  switch (query.sortBy) {
    case "personName":
      cmp = (a.official.counterparty.name ?? "").localeCompare(
        b.official.counterparty.name ?? "",
        "pt-BR"
      );
      break;
    case "openAmount":
      cmp = Number(a.openAmount ?? 0) - Number(b.openAmount ?? 0);
      break;
    case "originalAmount":
      cmp =
        Number(a.official.originalAmount ?? 0) -
        Number(b.official.originalAmount ?? 0);
      break;
    case "daysOverdue":
      cmp = a.daysOverdue - b.daysOverdue;
      break;
    case "scheduledDate":
      cmp = (a.scheduledDate ?? "9999-99-99").localeCompare(
        b.scheduledDate ?? "9999-99-99"
      );
      break;
    case "priority":
      cmp =
        (PRIORITY_RANK[a.priority ?? "NORMAL"] ?? 2) -
        (PRIORITY_RANK[b.priority ?? "NORMAL"] ?? 2);
      break;
    case "lastSyncedAt":
      cmp = a.official.lastSyncedAt.localeCompare(b.official.lastSyncedAt);
      break;
    case "documentNumber":
      cmp = (a.official.documentNumber ?? "").localeCompare(
        b.official.documentNumber ?? "",
        "pt-BR"
      );
      break;
    case "externalId":
      cmp = a.externalId - b.externalId;
      break;
    case "dueDate":
    default:
      cmp = (a.official.dueDate ?? "9999-99-99").localeCompare(
        b.official.dueDate ?? "9999-99-99"
      );
      break;
  }
  if (cmp === 0) cmp = a.externalId - b.externalId;
  return cmp * dir;
}

function sumOpenAmount(rows: TreasuryPayableListItemDto[]): string {
  let cents = 0;
  for (const row of rows) {
    const n = Number(row.openAmount ?? 0);
    if (Number.isFinite(n)) cents += Math.round(n * 100);
  }
  return (cents / 100).toFixed(2);
}

export function paginateTreasuryPayables(
  rows: TreasuryPayableListItemDto[],
  query: TreasuryPayablesListQuery
): {
  rows: TreasuryPayableListItemDto[];
  pagination: ReturnType<typeof buildTreasuryPaginationMeta>;
  summary: { titleCount: number; openAmountTotal: string };
  sortBy: TreasuryPayablesListQuery["sortBy"];
  sortDirection: TreasuryPayablesListQuery["sortDirection"];
} {
  const filtered = rows.filter((r) => payableMatchesQuery(r, query));
  filtered.sort((a, b) => comparePayables(a, b, query));
  const totalRows = filtered.length;
  const start = (query.page - 1) * query.pageSize;
  return {
    rows: filtered.slice(start, start + query.pageSize),
    pagination: buildTreasuryPaginationMeta({
      page: query.page,
      pageSize: query.pageSize,
      totalRows,
    }),
    summary: {
      titleCount: totalRows,
      openAmountTotal: sumOpenAmount(filtered),
    },
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  };
}
