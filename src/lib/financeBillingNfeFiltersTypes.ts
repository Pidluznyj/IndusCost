import type {
  FinanceBillingNfeClassificationFilter,
  FinanceBillingNfeStatusFilter,
} from "@/src/lib/financeBillingNfeList.js";

export type FinanceBillingNfeDraftFilters = {
  year: string;
  month: string;
  customerCnpj: string;
  documentNumber: string;
  classification: FinanceBillingNfeClassificationFilter;
  status: FinanceBillingNfeStatusFilter;
};

export function createDefaultFinanceBillingNfeFilters(year: string): FinanceBillingNfeDraftFilters {
  return {
    year,
    month: "",
    customerCnpj: "",
    documentNumber: "",
    classification: "all",
    status: "all",
  };
}

export function hasPendingFinanceBillingNfeFilterChanges(
  draft: FinanceBillingNfeDraftFilters,
  applied: FinanceBillingNfeDraftFilters
): boolean {
  return (
    draft.year !== applied.year ||
    draft.month !== applied.month ||
    draft.customerCnpj !== applied.customerCnpj ||
    draft.documentNumber !== applied.documentNumber ||
    draft.classification !== applied.classification ||
    draft.status !== applied.status
  );
}

export function buildFinanceBillingNfeQuery(filters: FinanceBillingNfeDraftFilters): string {
  const params = new URLSearchParams();
  if (filters.year.trim()) params.set("year", filters.year.trim());
  if (filters.month.trim()) params.set("month", filters.month.trim());
  if (filters.customerCnpj.trim()) params.set("customerCnpj", filters.customerCnpj.trim());
  if (filters.documentNumber.trim()) params.set("documentNumber", filters.documentNumber.trim());
  if (filters.classification !== "all") params.set("classification", filters.classification);
  if (filters.status !== "all") params.set("status", filters.status);
  return params.toString();
}

export function buildFinanceBillingExportQuery(filters: FinanceBillingNfeDraftFilters): string {
  const qs = buildFinanceBillingNfeQuery(filters);
  return qs ? `${qs}&format=csv&limit=10000` : "format=csv&limit=10000";
}

export const FINANCE_BILLING_MONTH_OPTIONS = [
  { value: "", label: "Todos os meses" },
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
] as const;
