import { NomusNfeBillingClassification } from "@/src/lib/nomusNfeBillingClassification.js";
import {
  NOMUS_NFE_STATUS_AUTHORIZED,
  NOMUS_NFE_STATUS_CANCELLED,
} from "@/src/lib/nomusNfeClassification.js";
import type { FinanceBillingNfeListItem } from "./financeBillingNfeList.js";

export type FinanceBillingNfeLocalFilter =
  | "all"
  | "authorized"
  | "cancelled"
  | "included"
  | "excluded"
  | "outOfPeriod"
  | "internalGroup"
  | "logistics";

export const FINANCE_BILLING_NFE_LOCAL_FILTER_OPTIONS: Array<{
  value: FinanceBillingNfeLocalFilter;
  label: string;
}> = [
  { value: "all", label: "Todas" },
  { value: "authorized", label: "Autorizadas" },
  { value: "cancelled", label: "Canceladas" },
  { value: "included", label: "Incluídas no dashboard" },
  { value: "excluded", label: "Excluídas" },
  { value: "outOfPeriod", label: "Fora do período" },
  { value: "internalGroup", label: "Grupo / intercompany" },
  { value: "logistics", label: "Logística (não receita)" },
];

export function parseFinanceBillingNfeLocalFilter(
  value: unknown,
  fallback: FinanceBillingNfeLocalFilter = "all"
): FinanceBillingNfeLocalFilter {
  const raw = String(value ?? "").trim();
  return FINANCE_BILLING_NFE_LOCAL_FILTER_OPTIONS.some((o) => o.value === raw)
    ? (raw as FinanceBillingNfeLocalFilter)
    : fallback;
}

export function isBillingNfeIncludedInDashboard(row: FinanceBillingNfeListItem): boolean {
  return (
    row.status === NOMUS_NFE_STATUS_AUTHORIZED &&
    row.isMarketSale === true &&
    row.billingClassification === NomusNfeBillingClassification.MARKET_REVENUE
  );
}

function resolveNfeCompetenceDate(row: FinanceBillingNfeListItem): Date | null {
  const raw = row.fiscalDate ?? row.dataProcessamento;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isNfeInAppliedPeriod(
  row: FinanceBillingNfeListItem,
  period: { year: number; month: number | null }
): boolean {
  const date = resolveNfeCompetenceDate(row);
  if (!date) return false;
  if (date.getFullYear() !== period.year) return false;
  if (period.month == null) return true;
  return date.getMonth() + 1 === period.month;
}

/** Filtro local do grid — não altera filtros globais aplicados. */
export function filterBillingNfeRowsByLocalFilter(
  rows: FinanceBillingNfeListItem[],
  localFilter: FinanceBillingNfeLocalFilter,
  period?: { year: number; month: number | null }
): FinanceBillingNfeListItem[] {
  if (localFilter === "all") return rows;

  return rows.filter((row) => {
    const included = isBillingNfeIncludedInDashboard(row);
    const inPeriod = period ? isNfeInAppliedPeriod(row, period) : true;

    switch (localFilter) {
      case "authorized":
        return row.status === NOMUS_NFE_STATUS_AUTHORIZED;
      case "cancelled":
        return row.status === NOMUS_NFE_STATUS_CANCELLED;
      case "included":
        return included;
      case "excluded":
        return !included;
      case "outOfPeriod":
        return period != null && !inPeriod;
      case "internalGroup":
        return row.billingClassification === NomusNfeBillingClassification.INTERCOMPANY;
      case "logistics":
        return row.billingClassification === NomusNfeBillingClassification.LOGISTICS_NOT_REVENUE;
      default:
        return true;
    }
  });
}
