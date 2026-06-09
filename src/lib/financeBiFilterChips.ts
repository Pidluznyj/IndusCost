import {
  FINANCE_AR_INVOICE_ISSUED_OPTIONS,
  FINANCE_AR_MONTH_OPTIONS,
  FINANCE_AR_STATUS_OPTIONS,
  type FinanceArUiFilters,
} from "./financeAccountsReceivableDashboardTypes.js";
import {
  FINANCE_AP_MONTH_OPTIONS,
  FINANCE_AP_STATUS_OPTIONS,
  FINANCE_AP_SUSPEND_PAYMENT_OPTIONS,
  type FinanceApUiFilters,
} from "./financeAccountsPayableDashboardTypes.js";
import type { FinanceBillingNfeDraftFilters } from "./financeBillingNfeFiltersTypes.js";
import {
  FINANCE_CASH_FLOW_DATE_BASE_OPTIONS,
  FINANCE_CASH_FLOW_INVOICE_OPTIONS,
  FINANCE_CASH_FLOW_MONTH_OPTIONS,
  FINANCE_CASH_FLOW_STATUS_OPTIONS,
  FINANCE_CASH_FLOW_VIEW_OPTIONS,
  type FinanceCashFlowUiFilters,
} from "./financeCashFlowDashboardTypes.js";

export type FinanceBiFilterChip = {
  id: string;
  label: string;
  onRemove?: () => void;
};

function optionLabel<T extends { value: string; label: string }>(
  options: readonly T[],
  value: string
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export function buildFinanceArFilterChips(
  filters: FinanceArUiFilters,
  onRemoveField?: (field: keyof FinanceArUiFilters) => void
): FinanceBiFilterChip[] {
  const chips: FinanceBiFilterChip[] = [];
  const push = (id: keyof FinanceArUiFilters, label: string) => {
    chips.push({
      id,
      label,
      onRemove: onRemoveField ? () => onRemoveField(id) : undefined,
    });
  };

  if (filters.year.trim()) push("year", `Ano venc.: ${filters.year}`);
  if (filters.month.trim()) {
    push("month", `Mês: ${optionLabel(FINANCE_AR_MONTH_OPTIONS, filters.month)}`);
  }
  if (filters.dueDateFrom.trim()) push("dueDateFrom", `De: ${filters.dueDateFrom}`);
  if (filters.dueDateTo.trim()) push("dueDateTo", `Até: ${filters.dueDateTo}`);
  if (filters.status !== "all") {
    push("status", `Status: ${optionLabel(FINANCE_AR_STATUS_OPTIONS, filters.status)}`);
  }
  if (filters.invoiceIssued !== "all") {
    push(
      "invoiceIssued",
      `NF: ${optionLabel(FINANCE_AR_INVOICE_ISSUED_OPTIONS, filters.invoiceIssued)}`
    );
  }
  if (filters.companyName.trim()) push("companyName", `Empresa: ${filters.companyName.trim()}`);
  if (filters.personName.trim()) push("personName", `Cliente: ${filters.personName.trim()}`);
  if (filters.personCnpj.trim()) push("personCnpj", `CNPJ: ${filters.personCnpj.trim()}`);
  if (filters.paymentMethodName.trim()) {
    push("paymentMethodName", `Pagamento: ${filters.paymentMethodName.trim()}`);
  }
  if (filters.bankAccountName.trim()) {
    push("bankAccountName", `Conta: ${filters.bankAccountName.trim()}`);
  }

  return chips;
}

export function buildFinanceApFilterChips(
  filters: FinanceApUiFilters,
  onRemoveField?: (field: keyof FinanceApUiFilters) => void
): FinanceBiFilterChip[] {
  const chips: FinanceBiFilterChip[] = [];
  const push = (id: keyof FinanceApUiFilters, label: string) => {
    chips.push({
      id,
      label,
      onRemove: onRemoveField ? () => onRemoveField(id) : undefined,
    });
  };

  if (filters.year.trim()) push("year", `Ano venc.: ${filters.year}`);
  if (filters.month.trim()) {
    push("month", `Mês: ${optionLabel(FINANCE_AP_MONTH_OPTIONS, filters.month)}`);
  }
  if (filters.dueDateFrom.trim()) push("dueDateFrom", `De: ${filters.dueDateFrom}`);
  if (filters.dueDateTo.trim()) push("dueDateTo", `Até: ${filters.dueDateTo}`);
  if (filters.status !== "all") {
    push("status", `Status: ${optionLabel(FINANCE_AP_STATUS_OPTIONS, filters.status)}`);
  }
  if (filters.suspendPayment !== "all") {
    push(
      "suspendPayment",
      `Suspenso: ${optionLabel(FINANCE_AP_SUSPEND_PAYMENT_OPTIONS, filters.suspendPayment)}`
    );
  }
  if (filters.companyName.trim()) push("companyName", `Empresa: ${filters.companyName.trim()}`);
  if (filters.personName.trim()) push("personName", `Fornecedor: ${filters.personName.trim()}`);
  if (filters.personCnpj.trim()) push("personCnpj", `CNPJ: ${filters.personCnpj.trim()}`);
  if (filters.documentQuery.trim()) push("documentQuery", `Doc/NF: ${filters.documentQuery.trim()}`);
  if (filters.paymentMethodName.trim()) {
    push("paymentMethodName", `Pagamento: ${filters.paymentMethodName.trim()}`);
  }
  if (filters.bankAccountName.trim()) {
    push("bankAccountName", `Conta: ${filters.bankAccountName.trim()}`);
  }

  return chips;
}

export function buildFinanceBillingFilterChips(
  year: string,
  nfeFilters: FinanceBillingNfeDraftFilters,
  onRemove?: (id: string) => void
): FinanceBiFilterChip[] {
  const chips: FinanceBiFilterChip[] = [];
  const push = (id: string, label: string) => {
    chips.push({ id, label, onRemove: onRemove ? () => onRemove(id) : undefined });
  };

  if (year.trim()) push("year", `Ano executivo: ${year}`);
  if (nfeFilters.month.trim()) push("month", `NF-e mês: ${nfeFilters.month}`);
  if (nfeFilters.customerCnpj.trim()) push("customerCnpj", `CNPJ: ${nfeFilters.customerCnpj}`);
  if (nfeFilters.documentNumber.trim()) push("documentNumber", `NF: ${nfeFilters.documentNumber}`);
  if (nfeFilters.classification !== "all") {
    push("classification", `Classif.: ${nfeFilters.classification}`);
  }
  if (nfeFilters.status !== "all") push("status", `Status NF-e: ${nfeFilters.status}`);

  return chips;
}

export function buildFinanceCashFlowFilterChips(
  filters: FinanceCashFlowUiFilters,
  onRemoveField?: (field: keyof FinanceCashFlowUiFilters) => void
): FinanceBiFilterChip[] {
  const chips: FinanceBiFilterChip[] = [];
  const push = (id: keyof FinanceCashFlowUiFilters, label: string) => {
    chips.push({
      id,
      label,
      onRemove: onRemoveField ? () => onRemoveField(id) : undefined,
    });
  };

  if (filters.year.trim()) push("year", `Ano: ${filters.year}`);
  if (filters.month.trim()) {
    push("month", `Mês: ${optionLabel(FINANCE_CASH_FLOW_MONTH_OPTIONS, filters.month)}`);
  }
  if (filters.companyName.trim()) push("companyName", `Empresa: ${filters.companyName.trim()}`);
  if (filters.viewMode !== "projected") {
    push("viewMode", `Visão: ${optionLabel(FINANCE_CASH_FLOW_VIEW_OPTIONS, filters.viewMode)}`);
  }
  if (filters.dateBase !== "due") {
    push(
      "dateBase",
      `Data: ${optionLabel(FINANCE_CASH_FLOW_DATE_BASE_OPTIONS, filters.dateBase)}`
    );
  }
  if (filters.status !== "all") {
    push("status", `Status: ${optionLabel(FINANCE_CASH_FLOW_STATUS_OPTIONS, filters.status)}`);
  }
  if (filters.customerName.trim()) push("customerName", `Cliente: ${filters.customerName.trim()}`);
  if (filters.supplierName.trim()) {
    push("supplierName", `Fornecedor: ${filters.supplierName.trim()}`);
  }
  if (filters.personCnpj.trim()) push("personCnpj", `CNPJ: ${filters.personCnpj.trim()}`);
  if (filters.paymentMethodName.trim()) {
    push("paymentMethodName", `Pagamento: ${filters.paymentMethodName.trim()}`);
  }
  if (filters.bankAccountName.trim()) {
    push("bankAccountName", `Conta: ${filters.bankAccountName.trim()}`);
  }
  if (filters.invoiceIssued !== "all") {
    push(
      "invoiceIssued",
      `NF: ${optionLabel(FINANCE_CASH_FLOW_INVOICE_OPTIONS, filters.invoiceIssued)}`
    );
  }

  return chips;
}
