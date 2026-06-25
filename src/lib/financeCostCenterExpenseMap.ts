import type { FinanceCostCenterDashboardByCostCenterRow } from "./financeCostCenterDashboard.js";
import type { FinanceCostCenterDto } from "./financeCostCenters.js";
import type { FinanceCostCentersUiFilters } from "./financeCostCentersPageTypes.js";
import { buildFinanceCostCentersDashboardQuery } from "./financeCostCentersPageTypes.js";
import type { CostCenterDetailSortField } from "./financeCostCenterDetailShared.js";

export type CostCenterExpenseMapCategoryFilter =
  | "all"
  | "withValue"
  | "activeOnly"
  | "administrative"
  | "manufacturing"
  | "exclude";

export type CostCenterExpenseMapCategory =
  | "administrative"
  | "manufacturing"
  | "exclude"
  | "other";

export type CostCenterExpenseMapCard = {
  costCenterId: string;
  code: string;
  name: string;
  parentId: string | null;
  parentCode: string | null;
  parentName: string | null;
  status: "ACTIVE" | "INACTIVE";
  category: CostCenterExpenseMapCategory;
  amount: number;
  openAmount: number;
  overdueAmount: number;
  upcomingAmount: number;
  paidAmount: number;
  titlesCount: number;
  sharePercentage: number;
};

export type CostCenterExpenseMapDrilldownFilters = {
  search: string;
  companyName: string;
  supplierName: string;
  classification: string;
  status: string;
  timing: "all" | "overdue" | "upcoming" | "paid";
  allocationSource: string;
  lockedOnly: boolean;
  minAmount: string;
  maxAmount: string;
  dueDateFrom: string;
  dueDateTo: string;
  competenceDateFrom: string;
  competenceDateTo: string;
  paymentDateFrom: string;
  paymentDateTo: string;
  page: number;
  pageSize: number;
  sortBy: CostCenterDetailSortField;
  sortDirection: "asc" | "desc";
};

export const DEFAULT_COST_CENTER_EXPENSE_MAP_DRILLDOWN_FILTERS: CostCenterExpenseMapDrilldownFilters =
  {
    search: "",
    companyName: "",
    supplierName: "",
    classification: "",
    status: "all",
    timing: "all",
    allocationSource: "all",
    lockedOnly: false,
    minAmount: "",
    maxAmount: "",
    dueDateFrom: "",
    dueDateTo: "",
    competenceDateFrom: "",
    competenceDateTo: "",
    paymentDateFrom: "",
    paymentDateTo: "",
    page: 1,
    pageSize: 25,
    sortBy: "allocatedAmount",
    sortDirection: "desc",
  };

function normalizeCategoryToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .trim();
}

export function inferCostCenterExpenseMapCategory(input: {
  code: string;
  name: string;
  parentCode: string | null;
  parentName: string | null;
}): CostCenterExpenseMapCategory {
  const haystack = normalizeCategoryToken(
    `${input.parentName ?? ""} ${input.parentCode ?? ""} ${input.name} ${input.code}`
  );
  if (
    haystack.includes("NAO CONSIDER") ||
    haystack.includes("IGNORAR") ||
    haystack.includes("EXCLUIR")
  ) {
    return "exclude";
  }
  if (haystack.includes("FABRIC") || haystack.includes("INDUSTRI") || haystack.includes("PRODUC")) {
    return "manufacturing";
  }
  if (haystack.includes("ADMIN")) {
    return "administrative";
  }
  return "other";
}

export function buildCostCenterExpenseMapCards(
  byCostCenter: FinanceCostCenterDashboardByCostCenterRow[],
  centers: FinanceCostCenterDto[]
): CostCenterExpenseMapCard[] {
  const metricsById = new Map(byCostCenter.map((row) => [row.costCenterId, row]));
  const parentById = new Map(centers.map((center) => [center.id, center]));

  const cards = centers.map((center) => {
    const metrics = metricsById.get(center.id);
    const parent = center.parentId ? parentById.get(center.parentId) : null;
    const openAmount = metrics?.openAmount ?? 0;
    const overdueAmount = metrics?.overdueAmount ?? 0;
    return {
      costCenterId: center.id,
      code: center.code,
      name: center.name,
      parentId: center.parentId,
      parentCode: parent?.code ?? null,
      parentName: parent?.name ?? null,
      status: center.status,
      category: inferCostCenterExpenseMapCategory({
        code: center.code,
        name: center.name,
        parentCode: parent?.code ?? null,
        parentName: parent?.name ?? null,
      }),
      amount: metrics?.amount ?? 0,
      openAmount,
      overdueAmount,
      upcomingAmount: Math.max(0, openAmount - overdueAmount),
      paidAmount: metrics?.paidAmount ?? 0,
      titlesCount: metrics?.titlesCount ?? 0,
      sharePercentage: metrics?.sharePercentage ?? 0,
    } satisfies CostCenterExpenseMapCard;
  });

  return sortCostCenterExpenseMapCards(cards);
}

export function sortCostCenterExpenseMapCards(
  cards: CostCenterExpenseMapCard[]
): CostCenterExpenseMapCard[] {
  return [...cards].sort((a, b) => {
    if (b.amount !== a.amount) return b.amount - a.amount;
    return a.code.localeCompare(b.code, "pt-BR");
  });
}

export function filterCostCenterExpenseMapCards(
  cards: CostCenterExpenseMapCard[],
  filter: CostCenterExpenseMapCategoryFilter
): CostCenterExpenseMapCard[] {
  switch (filter) {
    case "withValue":
      return cards.filter((card) => card.amount > 0);
    case "activeOnly":
      return cards.filter((card) => card.status === "ACTIVE");
    case "administrative":
      return cards.filter((card) => card.category === "administrative");
    case "manufacturing":
      return cards.filter((card) => card.category === "manufacturing");
    case "exclude":
      return cards.filter((card) => card.category === "exclude");
    default:
      return cards;
  }
}

function appendIfPresent(qs: URLSearchParams, key: string, value: string | number | undefined | null) {
  if (value == null) return;
  const raw = String(value).trim();
  if (!raw) return;
  qs.set(key, raw);
}

export function buildCostCenterExpenseMapAllocationsQuery(
  pageFilters: FinanceCostCentersUiFilters,
  drilldown: CostCenterExpenseMapDrilldownFilters
): string {
  const qs = new URLSearchParams(buildFinanceCostCentersDashboardQuery(pageFilters));

  appendIfPresent(qs, "search", drilldown.search);
  appendIfPresent(qs, "companyName", drilldown.companyName);
  appendIfPresent(qs, "personName", drilldown.supplierName);
  appendIfPresent(qs, "nomusClassification", drilldown.classification);
  if (drilldown.status !== "all") qs.set("status", drilldown.status);
  if (drilldown.timing !== "all") qs.set("timing", drilldown.timing);
  if (drilldown.allocationSource !== "all") qs.set("allocationSource", drilldown.allocationSource);
  if (drilldown.lockedOnly) qs.set("lockedOnly", "true");
  appendIfPresent(qs, "minAmount", drilldown.minAmount);
  appendIfPresent(qs, "maxAmount", drilldown.maxAmount);
  appendIfPresent(qs, "dueDateFrom", drilldown.dueDateFrom);
  appendIfPresent(qs, "dueDateTo", drilldown.dueDateTo);
  appendIfPresent(qs, "competenceDateFrom", drilldown.competenceDateFrom);
  appendIfPresent(qs, "competenceDateTo", drilldown.competenceDateTo);
  appendIfPresent(qs, "paymentDateFrom", drilldown.paymentDateFrom);
  appendIfPresent(qs, "paymentDateTo", drilldown.paymentDateTo);

  qs.set("page", String(drilldown.page));
  qs.set("limit", String(drilldown.pageSize));
  qs.set("sortBy", drilldown.sortBy);
  qs.set("sortDirection", drilldown.sortDirection);
  return qs.toString();
}

/** Query para exportação — mesmos filtros do grid, sem paginação. */
export function buildCostCenterExpenseMapExportQuery(
  pageFilters: FinanceCostCentersUiFilters,
  drilldown: CostCenterExpenseMapDrilldownFilters
): string {
  const qs = new URLSearchParams(buildFinanceCostCentersDashboardQuery(pageFilters));

  appendIfPresent(qs, "search", drilldown.search);
  appendIfPresent(qs, "companyName", drilldown.companyName);
  appendIfPresent(qs, "personName", drilldown.supplierName);
  appendIfPresent(qs, "nomusClassification", drilldown.classification);
  if (drilldown.status !== "all") qs.set("status", drilldown.status);
  if (drilldown.timing !== "all") qs.set("timing", drilldown.timing);
  if (drilldown.allocationSource !== "all") qs.set("allocationSource", drilldown.allocationSource);
  if (drilldown.lockedOnly) qs.set("lockedOnly", "true");
  appendIfPresent(qs, "minAmount", drilldown.minAmount);
  appendIfPresent(qs, "maxAmount", drilldown.maxAmount);
  appendIfPresent(qs, "dueDateFrom", drilldown.dueDateFrom);
  appendIfPresent(qs, "dueDateTo", drilldown.dueDateTo);
  appendIfPresent(qs, "competenceDateFrom", drilldown.competenceDateFrom);
  appendIfPresent(qs, "competenceDateTo", drilldown.competenceDateTo);
  appendIfPresent(qs, "paymentDateFrom", drilldown.paymentDateFrom);
  appendIfPresent(qs, "paymentDateTo", drilldown.paymentDateTo);

  qs.set("sortBy", drilldown.sortBy);
  qs.set("sortDirection", drilldown.sortDirection);
  return qs.toString();
}

export function expenseMapCategoryLabel(category: CostCenterExpenseMapCategory): string {
  switch (category) {
    case "administrative":
      return "Administrativo";
    case "manufacturing":
      return "Fabricação";
    case "exclude":
      return "Não considerar";
    default:
      return "Outros";
  }
}
