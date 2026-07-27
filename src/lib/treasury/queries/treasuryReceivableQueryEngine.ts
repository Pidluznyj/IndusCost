/**
 * Motor puro de filtro/ordenação/paginação da listagem CR Tesouraria.
 */

import type { TreasuryReceivableListItemDto } from "../contracts/treasuryReceivableContracts.js";
import type { TreasuryReceivablesListQuery } from "../contracts/treasurySchemas.js";
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

export function receivableMatchesQuery(
  row: TreasuryReceivableListItemDto,
  query: TreasuryReceivablesListQuery
): boolean {
  if (
    !includesInsensitive(row.official.counterparty.name, query.customerName)
  ) {
    return false;
  }
  if (
    query.customerTaxId &&
    !matchesTaxIdFilter(row.official.counterparty.taxId, query.customerTaxId)
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
  if (query.salesOrder) {
    const orderHay = [
      row.official.salesOrderCode,
      row.official.salesOrderExternalId != null
        ? String(row.official.salesOrderExternalId)
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    if (!includesInsensitive(orderHay, query.salesOrder)) return false;
  }
  if (query.invoice) {
    const invHay = [
      row.official.invoice.number,
      row.official.invoice.externalId != null
        ? String(row.official.invoice.externalId)
        : null,
    ]
      .filter(Boolean)
      .join(" ");
    if (!includesInsensitive(invHay, query.invoice)) return false;
  }
  if (!includesInsensitive(row.sellerName, query.sellerName)) return false;
  if (
    !includesInsensitive(row.commercialOwnerName, query.commercialOwnerName)
  ) {
    return false;
  }
  if (
    query.collectionOwnerUserId &&
    row.complement?.responsibleUserId !== query.collectionOwnerUserId
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
    query.expectedFrom &&
    (!row.complement?.expectedDate ||
      row.complement.expectedDate < query.expectedFrom)
  ) {
    return false;
  }
  if (
    query.expectedTo &&
    (!row.complement?.expectedDate ||
      row.complement.expectedDate > query.expectedTo)
  ) {
    return false;
  }
  if (query.hasPromise === true) {
    if (!row.complement?.confirmedDate && !row.complement?.confirmedAmount) {
      return false;
    }
  }
  if (query.hasPromise === false) {
    if (row.complement?.confirmedDate || row.complement?.confirmedAmount) {
      return false;
    }
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
  if (
    query.daysOverdueMin != null &&
    row.daysOverdue < query.daysOverdueMin
  ) {
    return false;
  }
  if (
    query.daysOverdueMax != null &&
    row.daysOverdue > query.daysOverdueMax
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
    row.complement?.plannedAccountId !== query.plannedAccountId
  ) {
    return false;
  }
  if (query.priority && row.complement?.priority !== query.priority) {
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

function compareReceivables(
  a: TreasuryReceivableListItemDto,
  b: TreasuryReceivableListItemDto,
  query: TreasuryReceivablesListQuery
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
    case "expectedDate":
      cmp = (a.complement?.expectedDate ?? "9999-99-99").localeCompare(
        b.complement?.expectedDate ?? "9999-99-99"
      );
      break;
    case "priority":
      cmp =
        (PRIORITY_RANK[a.complement?.priority ?? "NORMAL"] ?? 2) -
        (PRIORITY_RANK[b.complement?.priority ?? "NORMAL"] ?? 2);
      break;
    case "lastSyncedAt":
      cmp = a.official.lastSyncedAt.localeCompare(b.official.lastSyncedAt);
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

export function paginateTreasuryReceivables(
  rows: TreasuryReceivableListItemDto[],
  query: TreasuryReceivablesListQuery
): {
  rows: TreasuryReceivableListItemDto[];
  pagination: ReturnType<typeof buildTreasuryPaginationMeta>;
  sortBy: TreasuryReceivablesListQuery["sortBy"];
  sortDirection: TreasuryReceivablesListQuery["sortDirection"];
} {
  const filtered = rows.filter((r) => receivableMatchesQuery(r, query));
  filtered.sort((a, b) => compareReceivables(a, b, query));
  const totalRows = filtered.length;
  const start = (query.page - 1) * query.pageSize;
  return {
    rows: filtered.slice(start, start + query.pageSize),
    pagination: buildTreasuryPaginationMeta({
      page: query.page,
      pageSize: query.pageSize,
      totalRows,
    }),
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
  };
}
