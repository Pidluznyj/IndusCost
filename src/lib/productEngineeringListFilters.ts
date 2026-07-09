export type ProductEngineeringListStatusFilter = "" | "ACTIVE" | "INACTIVE";

export type ProductEngineeringListFilterInput = {
  search: string;
  status: ProductEngineeringListStatusFilter;
};

export type ProductEngineeringListItem = {
  name: string;
  sku: string;
  status?: string | null;
};

/** Filtro client-side da lista Engenharia > Produtos (SKU, nome, status). */
export function filterProductEngineeringListItems<T extends ProductEngineeringListItem>(
  items: T[],
  filters: ProductEngineeringListFilterInput
): T[] {
  const q = filters.search.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.status && item.status !== filters.status) return false;
    if (!q) return true;
    return item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q);
  });
}

export function hasProductEngineeringListFilters(input: {
  draftSearch: string;
  appliedSearch: string;
  draftStatus: ProductEngineeringListStatusFilter;
  appliedStatus: ProductEngineeringListStatusFilter;
}): boolean {
  return Boolean(
    input.draftSearch.trim() ||
      input.appliedSearch.trim() ||
      input.draftStatus ||
      input.appliedStatus
  );
}
