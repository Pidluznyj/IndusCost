/** Estado de filtros draft vs aplicado — padrão BI Financeiro. */

export type FinanceBiFilterStatus = "none" | "applied" | "pending";

export const FINANCE_BI_FILTER_STATUS_LABELS: Record<FinanceBiFilterStatus, string> = {
  none: "Sem filtros ativos",
  applied: "Filtros aplicados",
  pending: "Alterações pendentes",
};

export function resolveFinanceBiFilterStatus(
  filtersActive: boolean,
  hasPendingChanges: boolean
): FinanceBiFilterStatus {
  if (hasPendingChanges) return "pending";
  if (filtersActive) return "applied";
  return "none";
}
