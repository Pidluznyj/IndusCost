import { FINANCE_AR_STATUS_OPTIONS } from "@/src/lib/financeAccountsReceivableDashboardTypes";

export type FinanceCostCentersTabId =
  | "overview"
  | "centers"
  | "suppliers"
  | "rules"
  | "unclassified"
  | "audit";

export const FINANCE_COST_CENTERS_TABS: ReadonlyArray<{
  id: FinanceCostCentersTabId;
  label: string;
}> = [
  { id: "overview", label: "Visão Geral" },
  { id: "centers", label: "Centros de Custo" },
  { id: "suppliers", label: "Fornecedores" },
  { id: "rules", label: "Regras de Classificação" },
  { id: "unclassified", label: "Títulos sem Classificação" },
  { id: "audit", label: "Auditoria" },
] as const;

export const FINANCE_COST_CENTERS_EXECUTIVE_SUBTITLE =
  "Classifique contas a pagar por centro de custo com regras por fornecedor, sem alterar o módulo de Contas a Pagar.";

export type FinanceCostCentersUiFilters = {
  year?: number;
  month?: number;
  status: string;
  companyName: string;
  costCenterId: string;
  supplierId: string;
  classification: string;
};

export const FINANCE_COST_CENTERS_CLASSIFICATION_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "classified", label: "Classificados" },
  { value: "unclassified", label: "Sem classificação" },
] as const;

export const FINANCE_COST_CENTERS_STATUS_OPTIONS = FINANCE_AR_STATUS_OPTIONS;

export function createDefaultFinanceCostCentersUiFilters(): FinanceCostCentersUiFilters {
  return {
    year: new Date().getFullYear(),
    status: "all",
    companyName: "",
    costCenterId: "",
    supplierId: "",
    classification: "all",
  };
}

export function buildFinanceCostCentersDashboardQuery(filters: FinanceCostCentersUiFilters): string {
  const q = new URLSearchParams();
  if (filters.year) q.set("year", String(filters.year));
  if (filters.month) q.set("month", String(filters.month));
  if (filters.status && filters.status !== "all") q.set("status", filters.status);
  if (filters.companyName.trim()) q.set("companyName", filters.companyName.trim());
  if (filters.costCenterId.trim()) q.set("costCenterId", filters.costCenterId.trim());
  if (filters.supplierId.trim()) q.set("supplierId", filters.supplierId.trim());
  if (filters.classification && filters.classification !== "all") {
    q.set("classification", filters.classification);
  }
  return q.toString();
}

export function buildFinanceCostCentersYearOptions(): number[] {
  const current = new Date().getFullYear();
  const years: number[] = [];
  for (let y = current; y >= current - 5; y -= 1) years.push(y);
  return years;
}

export const FINANCE_COST_CENTERS_MONTH_OPTIONS = [
  { value: "", label: "Todos" },
  ...Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1).padStart(2, "0"),
  })),
];
