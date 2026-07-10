import { formatFinanceCurrency } from "./financeAccountsReceivableFormat.js";
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

function appendCostCenterIds(qs: URLSearchParams, costCenterIds?: string[]) {
  if (!costCenterIds || costCenterIds.length < 2) return;
  qs.set("costCenterIds", costCenterIds.join(","));
}

export function formatExpenseMapSelectedCenterNames(
  cards: CostCenterExpenseMapCard[],
  selectedIds: string[],
  maxVisible = 4
): string {
  const names = selectedIds
    .map((id) => cards.find((card) => card.costCenterId === id)?.name)
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) return "";
  if (names.length <= maxVisible) return names.join(", ");
  const visible = names.slice(0, maxVisible).join(", ");
  return `${visible} + ${names.length - maxVisible} centros`;
}

export function buildExpenseMapDetailTitle(
  cards: CostCenterExpenseMapCard[],
  detailCenterIds: string[]
): string {
  if (detailCenterIds.length > 1) {
    return `Detalhamento dos centros selecionados (${detailCenterIds.length})`;
  }
  const card = cards.find((item) => item.costCenterId === detailCenterIds[0]);
  return `Detalhamento do centro — ${card?.name ?? "Centro"}`;
}

export function buildCostCenterExpenseMapAllocationsQuery(
  pageFilters: FinanceCostCentersUiFilters,
  drilldown: CostCenterExpenseMapDrilldownFilters,
  costCenterIds?: string[]
): string {
  const qs = new URLSearchParams(buildFinanceCostCentersDashboardQuery(pageFilters));

  appendCostCenterIds(qs, costCenterIds);

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
  drilldown: CostCenterExpenseMapDrilldownFilters,
  costCenterIds?: string[]
): string {
  const qs = new URLSearchParams(buildFinanceCostCentersDashboardQuery(pageFilters));

  appendCostCenterIds(qs, costCenterIds);

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

export type CostCenterExpenseMapAggregateTotals = {
  centersCount: number;
  amount: number;
  overdueAmount: number;
  upcomingAmount: number;
  paidAmount: number;
  titlesCount: number;
  /** Percentual sobre o total filtrado (100% quando nenhum centro selecionado). */
  participationPercent: number;
  totalFilteredCentersCount: number;
  totalFilteredAmount: number;
};

function safeAmount(value: number | null | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0;
}

/** Soma métricas dos cards visíveis — opcionalmente restrito à seleção do usuário. */
export function aggregateCostCenterExpenseMapTotals(
  filteredCards: CostCenterExpenseMapCard[],
  selectedCenterIds?: ReadonlySet<string> | readonly string[] | null
): CostCenterExpenseMapAggregateTotals {
  const selectedSet =
    selectedCenterIds instanceof Set
      ? selectedCenterIds
      : selectedCenterIds?.length
        ? new Set(selectedCenterIds)
        : null;
  const hasSelection = Boolean(selectedSet && selectedSet.size > 0);
  const considered = hasSelection
    ? filteredCards.filter((card) => selectedSet!.has(card.costCenterId))
    : filteredCards;

  const totalFilteredAmount = filteredCards.reduce((sum, card) => sum + safeAmount(card.amount), 0);
  const amount = considered.reduce((sum, card) => sum + safeAmount(card.amount), 0);
  const overdueAmount = considered.reduce((sum, card) => sum + safeAmount(card.overdueAmount), 0);
  const upcomingAmount = considered.reduce((sum, card) => sum + safeAmount(card.upcomingAmount), 0);
  const paidAmount = considered.reduce((sum, card) => sum + safeAmount(card.paidAmount), 0);
  const titlesCount = considered.reduce((sum, card) => sum + safeAmount(card.titlesCount), 0);

  const participationPercent = hasSelection
    ? totalFilteredAmount > 0
      ? Math.round((amount / totalFilteredAmount) * 10000) / 100
      : 0
    : 100;

  return {
    centersCount: considered.length,
    amount,
    overdueAmount,
    upcomingAmount,
    paidAmount,
    titlesCount,
    participationPercent,
    totalFilteredCentersCount: filteredCards.length,
    totalFilteredAmount,
  };
}

/** Moeda compacta para cards estreitos do totalizador (≥ R$ 1 mil usa mil/Mi). */
export function formatCostCenterExpenseMapSummaryCurrency(value: number | null | undefined): {
  display: string;
  fullValue: string;
} {
  if (value == null || !Number.isFinite(value)) {
    return { display: "—", fullValue: "—" };
  }
  const fullValue = formatFinanceCurrency(value);
  const abs = Math.abs(value);
  const compact = (scaled: number, decimals: number) =>
    new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(scaled);
  if (abs >= 1_000_000) {
    return { display: `R$ ${compact(value / 1_000_000, 2)} Mi`, fullValue };
  }
  if (abs >= 10_000) {
    return { display: `R$ ${compact(value / 1_000, 1)} mil`, fullValue };
  }
  if (abs >= 1_000) {
    return { display: `R$ ${compact(value / 1_000, 2)} mil`, fullValue };
  }
  return { display: fullValue, fullValue };
}
