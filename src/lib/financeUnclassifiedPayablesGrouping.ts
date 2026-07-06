import type { UnclassifiedCauseUi } from "@/src/lib/financeUnclassifiedPayablesUi";
import {
  buildSupplierIdentityKey,
  extractSupplierFromAccountsPayable,
} from "@/src/lib/financeSupplierIdentity";

export type UnclassifiedPayableListItem = {
  externalId: number;
  titleAmount: number;
  companyName: string | null;
  personName: string | null;
  personDocument?: string | null;
  identityKey?: string | null;
  cause?: UnclassifiedCauseUi;
  supplierId?: string | null;
  supplierName?: string | null;
};

export type UnclassifiedGroupedBySupplierRow = {
  name: string;
  titlesCount: number;
  amount: number;
  openAmount: number;
  cause: UnclassifiedCauseUi | null;
  supplierId: string | null;
  supplierName: string | null;
  identityKey: string;
  /** Chave de agrupamento usada na tabela (fs:{supplierId} ou identityKey). */
  groupKey: string;
  personDocument: string | null;
  sampleExternalId: number;
};

export function resolveUnclassifiedGroupedRowKey(
  row: Pick<UnclassifiedGroupedBySupplierRow, "supplierId" | "identityKey">
): string {
  if (row.supplierId) return `fs:${row.supplierId}`;
  return row.identityKey;
}

export function resolveUnclassifiedPayableGroupKey(item: UnclassifiedPayableListItem): string {
  if (item.supplierId) return `fs:${item.supplierId}`;
  if (item.identityKey?.trim()) return item.identityKey.trim();
  const extracted = extractSupplierFromAccountsPayable({
    externalId: item.externalId,
    personName: item.personName,
    personCnpj: item.personDocument ?? null,
  });
  return buildSupplierIdentityKey(extracted, item.externalId);
}

function resolveGroupedDisplayName(item: UnclassifiedPayableListItem): string {
  return (
    item.supplierName?.trim() ||
    item.personName?.trim() ||
    `Título ${item.externalId}`
  );
}

export function groupUnclassifiedPayablesBySupplier(
  items: UnclassifiedPayableListItem[]
): UnclassifiedGroupedBySupplierRow[] {
  const map = new Map<string, UnclassifiedGroupedBySupplierRow>();
  for (const item of items) {
    const extracted = extractSupplierFromAccountsPayable({
      externalId: item.externalId,
      personName: item.personName,
      personCnpj: item.personDocument ?? null,
    });
    const apIdentityKey =
      item.identityKey?.trim() ||
      buildSupplierIdentityKey(extracted, item.externalId);
    const key = item.supplierId ? `fs:${item.supplierId}` : apIdentityKey;
    const displayName = resolveGroupedDisplayName(item);
    const row =
      map.get(key) ??
      ({
        name: displayName,
        titlesCount: 0,
        amount: 0,
        openAmount: 0,
        cause: null,
        supplierId: null,
        supplierName: null,
        identityKey: apIdentityKey,
        groupKey: key,
        personDocument: item.personDocument ?? null,
        sampleExternalId: item.externalId,
      } satisfies UnclassifiedGroupedBySupplierRow);
    row.titlesCount += 1;
    row.amount += item.titleAmount;
    row.openAmount += item.titleAmount;
    if (item.cause) row.cause = item.cause;
    if (!row.supplierId && item.supplierId) row.supplierId = item.supplierId;
    if (!row.supplierName && item.supplierName) row.supplierName = item.supplierName;
    if (!row.personDocument && item.personDocument) row.personDocument = item.personDocument;
    if (!row.supplierName && item.supplierName) {
      row.name = item.supplierName;
    } else if (!row.supplierId && displayName.length > row.name.length) {
      row.name = displayName;
    }
    map.set(key, row);
  }
  return [...map.values()];
}
