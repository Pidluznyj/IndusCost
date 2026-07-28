export type ProductEngineeringListStatusFilter = "" | "ACTIVE" | "INACTIVE";

/** Filtro do badge/status do CIU atual na grade (coluna CIU atual). */
export type ProductEngineeringListCiuFilter = "" | "PARTIAL" | "COMPLETE";

export type ProductEngineeringListFilterInput = {
  search: string;
  status: ProductEngineeringListStatusFilter;
  ciu?: ProductEngineeringListCiuFilter;
};

export type ProductEngineeringListItem = {
  name: string;
  sku: string;
  status?: string | null;
  costSummary?:
    | { na: true; label?: string }
    | { unavailable: true; reason?: string }
    | { error: true; message?: string; code?: string }
    | { totalIndustrialCost: number; partial?: boolean }
    | null;
};

export function isProductEngineeringCiuPartial(
  costSummary: ProductEngineeringListItem["costSummary"]
): boolean {
  return Boolean(
    costSummary &&
      "totalIndustrialCost" in costSummary &&
      typeof costSummary.totalIndustrialCost === "number" &&
      costSummary.partial === true
  );
}

export function isProductEngineeringCiuComplete(
  costSummary: ProductEngineeringListItem["costSummary"]
): boolean {
  return Boolean(
    costSummary &&
      "totalIndustrialCost" in costSummary &&
      typeof costSummary.totalIndustrialCost === "number" &&
      costSummary.partial !== true
  );
}

/** Filtro client-side da lista Engenharia > Produtos (SKU, nome, status, CIU). */
export function filterProductEngineeringListItems<T extends ProductEngineeringListItem>(
  items: T[],
  filters: ProductEngineeringListFilterInput
): T[] {
  const q = filters.search.trim().toLowerCase();
  const ciu = filters.ciu ?? "";
  return items.filter((item) => {
    if (filters.status && item.status !== filters.status) return false;
    if (ciu === "PARTIAL" && !isProductEngineeringCiuPartial(item.costSummary)) return false;
    if (ciu === "COMPLETE" && !isProductEngineeringCiuComplete(item.costSummary)) return false;
    if (!q) return true;
    return item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q);
  });
}

export function hasProductEngineeringListFilters(input: {
  draftSearch: string;
  appliedSearch: string;
  draftStatus: ProductEngineeringListStatusFilter;
  appliedStatus: ProductEngineeringListStatusFilter;
  draftCiu?: ProductEngineeringListCiuFilter;
  appliedCiu?: ProductEngineeringListCiuFilter;
}): boolean {
  return Boolean(
    input.draftSearch.trim() ||
      input.appliedSearch.trim() ||
      input.draftStatus ||
      input.appliedStatus ||
      input.draftCiu ||
      input.appliedCiu
  );
}
