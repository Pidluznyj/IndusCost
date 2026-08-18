import {
  matchesEngineeringHealthFilter,
  type EngineeringHealthFilter,
  type EngineeringHealthSummary,
} from "./productBomHealth.js";

export type ProductEngineeringListStatusFilter = "" | "ACTIVE" | "INACTIVE";

/**
 * Estado inicial da tela Engenharia > Produtos.
 *
 * A grade abre mostrando só os itens ativos: inativo é exceção, e listá-los
 * junto por padrão fazia o usuário conferir item a item. Para ver inativos
 * (ou todos), basta trocar no seletor de status.
 */
export const DEFAULT_PRODUCT_ENGINEERING_STATUS_FILTER: ProductEngineeringListStatusFilter =
  "ACTIVE";

/** Filtro do badge/status do CIU atual na grade (coluna CIU atual). */
export type ProductEngineeringListCiuFilter = "" | "PARTIAL" | "COMPLETE";

export type ProductEngineeringListFilterInput = {
  search: string;
  status: ProductEngineeringListStatusFilter;
  ciu?: ProductEngineeringListCiuFilter;
  /** Filtro de saúde da engenharia (resumo resolvido pelo backend). */
  engineering?: EngineeringHealthFilter;
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
  /** Resumo de saúde vindo do backend; ausente = não disponível (≠ OK). */
  engineeringHealth?: EngineeringHealthSummary | null;
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
  const engineering = filters.engineering ?? "";
  return items.filter((item) => {
    if (filters.status && item.status !== filters.status) return false;
    if (ciu === "PARTIAL" && !isProductEngineeringCiuPartial(item.costSummary)) return false;
    if (ciu === "COMPLETE" && !isProductEngineeringCiuComplete(item.costSummary)) return false;
    if (!matchesEngineeringHealthFilter(item.engineeringHealth, engineering)) return false;
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
  draftEngineering?: EngineeringHealthFilter;
  appliedEngineering?: EngineeringHealthFilter;
}): boolean {
  return Boolean(
    input.draftSearch.trim() ||
      input.appliedSearch.trim() ||
      input.draftStatus ||
      input.appliedStatus ||
      input.draftCiu ||
      input.appliedCiu ||
      input.draftEngineering ||
      input.appliedEngineering
  );
}
