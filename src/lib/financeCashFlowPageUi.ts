import { createDefaultFinanceCashFlowUiFilters, type FinanceCashFlowUiFilters } from "./financeCashFlowDashboardTypes.js";

export function countActiveCashFlowFilters(filters: FinanceCashFlowUiFilters): number {
  const defaults = createDefaultFinanceCashFlowUiFilters(
    filters.year ? Number(filters.year) : new Date().getFullYear()
  );
  let count = 0;
  if (filters.month.trim()) count += 1;
  if (filters.companyName.trim()) count += 1;
  if (filters.viewMode !== defaults.viewMode) count += 1;
  if (filters.dateBase !== defaults.dateBase) count += 1;
  if (filters.status !== defaults.status) count += 1;
  if (filters.customerName.trim()) count += 1;
  if (filters.supplierName.trim()) count += 1;
  if (filters.personCnpj.trim()) count += 1;
  if (filters.paymentMethodName.trim()) count += 1;
  if (filters.bankAccountName.trim()) count += 1;
  if (filters.invoiceIssued !== defaults.invoiceIssued) count += 1;
  return count;
}
