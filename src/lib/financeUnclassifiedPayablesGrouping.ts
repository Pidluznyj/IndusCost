import type { UnclassifiedCauseUi } from "@/src/lib/financeUnclassifiedPayablesUi";

export type UnclassifiedPayableListItem = {
  externalId: number;
  titleAmount: number;
  companyName: string | null;
  personName: string | null;
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
};

export function groupUnclassifiedPayablesBySupplier(
  items: UnclassifiedPayableListItem[]
): UnclassifiedGroupedBySupplierRow[] {
  const map = new Map<string, UnclassifiedGroupedBySupplierRow>();
  for (const item of items) {
    const key = item.personName ?? `Título ${item.externalId}`;
    const row =
      map.get(key) ??
      ({
        name: key,
        titlesCount: 0,
        amount: 0,
        openAmount: 0,
        cause: null,
        supplierId: null,
        supplierName: null,
      } satisfies UnclassifiedGroupedBySupplierRow);
    row.titlesCount += 1;
    row.amount += item.titleAmount;
    row.openAmount += item.titleAmount;
    if (item.cause) row.cause = item.cause;
    if (!row.supplierId && item.supplierId) row.supplierId = item.supplierId;
    if (!row.supplierName && item.supplierName) row.supplierName = item.supplierName;
    map.set(key, row);
  }
  return [...map.values()];
}
