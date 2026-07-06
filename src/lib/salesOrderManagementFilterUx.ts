import { safeTrim } from "./safeTrim.js";
import {
  BILLING_STATUS_FILTER_OPTIONS,
  COMPLETION_STATUS_FILTER_OPTIONS,
  CUT_FILTER_OPTIONS,
  DEADLINE_STATUS_FILTER_OPTIONS,
  FULFILLMENT_FILTER_OPTIONS,
  INVOICE_COVERAGE_FILTER_OPTIONS,
  INVOICE_FILTER_OPTIONS,
  OPERATIONAL_STATUS_FILTER_OPTIONS,
  PRAZO_FILTER_OPTIONS,
  PRODUCTION_ORDER_FILTER_OPTIONS,
  REVIEW_DATA_FILTER_OPTIONS,
} from "./salesOrderManagementUi.js";

export type SalesOrderManagementAdvancedFilterState = {
  customerId: string;
  customerLabel: string | null;
  responsible: string;
  companyIssuer: string;
  operationalStatus: string;
  deadlineStatus: string;
  completionStatus: string;
  billingStatus: string;
  invoiceFilter: string;
  productionFilter: string;
  deliveryYear: string;
  deliveryMonth: string;
  nfeYear: string;
  nfeMonth: string;
  prazoFilter: string;
  fulfillmentFilter: string;
  invoiceCoverage: string;
  reviewDataFilter: string;
  cutFilter: string;
  invoiceNumber: string;
};

export type SalesOrderManagementAdvancedFilterChip = {
  id: keyof SalesOrderManagementAdvancedFilterState;
  label: string;
  value: string;
};

function optionLabel(
  options: Array<{ value: string; label: string }>,
  value: string
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

function monthLabel(value: string): string {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1 || n > 12) return value;
  return String(n).padStart(2, "0");
}

export function countActiveAdvancedFilters(
  state: SalesOrderManagementAdvancedFilterState
): number {
  let count = 0;
  if (state.customerId) count += 1;
  if (safeTrim(state.responsible)) count += 1;
  if (safeTrim(state.companyIssuer)) count += 1;
  if (state.operationalStatus) count += 1;
  if (state.deadlineStatus) count += 1;
  if (state.completionStatus) count += 1;
  if (state.billingStatus) count += 1;
  if (state.invoiceFilter) count += 1;
  if (state.productionFilter) count += 1;
  if (state.deliveryYear) count += 1;
  if (state.deliveryMonth) count += 1;
  if (state.nfeYear) count += 1;
  if (state.nfeMonth) count += 1;
  if (state.prazoFilter) count += 1;
  if (state.fulfillmentFilter) count += 1;
  if (state.invoiceCoverage) count += 1;
  if (state.reviewDataFilter) count += 1;
  if (state.cutFilter) count += 1;
  if (safeTrim(state.invoiceNumber)) count += 1;
  return count;
}

export function buildAdvancedFilterChips(
  state: SalesOrderManagementAdvancedFilterState
): SalesOrderManagementAdvancedFilterChip[] {
  const chips: SalesOrderManagementAdvancedFilterChip[] = [];

  if (state.customerId) {
    chips.push({
      id: "customerId",
      label: "Cliente",
      value: state.customerLabel ?? state.customerId,
    });
  }
  const responsible = safeTrim(state.responsible);
  if (responsible) {
    chips.push({ id: "responsible", label: "Vendedor", value: responsible });
  }
  const company = safeTrim(state.companyIssuer);
  if (company) {
    chips.push({ id: "companyIssuer", label: "Empresa", value: company });
  }
  if (state.operationalStatus) {
    chips.push({
      id: "operationalStatus",
      label: "Status gerencial",
      value: optionLabel(OPERATIONAL_STATUS_FILTER_OPTIONS, state.operationalStatus),
    });
  }
  if (state.deadlineStatus) {
    chips.push({
      id: "deadlineStatus",
      label: "Prazo",
      value: optionLabel(DEADLINE_STATUS_FILTER_OPTIONS, state.deadlineStatus),
    });
  }
  if (state.completionStatus) {
    chips.push({
      id: "completionStatus",
      label: "Completeza",
      value: optionLabel(COMPLETION_STATUS_FILTER_OPTIONS, state.completionStatus),
    });
  }
  if (state.billingStatus) {
    chips.push({
      id: "billingStatus",
      label: "NF",
      value: optionLabel(BILLING_STATUS_FILTER_OPTIONS, state.billingStatus),
    });
  }
  if (state.invoiceFilter) {
    chips.push({
      id: "invoiceFilter",
      label: "Vínculo NF",
      value: optionLabel(INVOICE_FILTER_OPTIONS, state.invoiceFilter),
    });
  }
  if (state.productionFilter) {
    chips.push({
      id: "productionFilter",
      label: "OP",
      value: optionLabel(PRODUCTION_ORDER_FILTER_OPTIONS, state.productionFilter),
    });
  }
  if (state.deliveryYear) {
    chips.push({
      id: "deliveryYear",
      label: "Entrega — ano",
      value: state.deliveryYear,
    });
  }
  if (state.deliveryMonth) {
    chips.push({
      id: "deliveryMonth",
      label: "Entrega — mês",
      value: monthLabel(state.deliveryMonth),
    });
  }
  if (state.nfeYear) {
    chips.push({ id: "nfeYear", label: "NF — ano", value: state.nfeYear });
  }
  if (state.nfeMonth) {
    chips.push({
      id: "nfeMonth",
      label: "NF — mês",
      value: monthLabel(state.nfeMonth),
    });
  }
  if (state.prazoFilter) {
    chips.push({
      id: "prazoFilter",
      label: "Prazo (BI)",
      value: optionLabel(PRAZO_FILTER_OPTIONS, state.prazoFilter),
    });
  }
  if (state.fulfillmentFilter) {
    chips.push({
      id: "fulfillmentFilter",
      label: "Atendimento",
      value: optionLabel(FULFILLMENT_FILTER_OPTIONS, state.fulfillmentFilter),
    });
  }
  if (state.invoiceCoverage) {
    chips.push({
      id: "invoiceCoverage",
      label: "% faturado",
      value: optionLabel(INVOICE_COVERAGE_FILTER_OPTIONS, state.invoiceCoverage),
    });
  }
  if (state.reviewDataFilter) {
    chips.push({
      id: "reviewDataFilter",
      label: "Revisar dados",
      value: optionLabel(REVIEW_DATA_FILTER_OPTIONS, state.reviewDataFilter),
    });
  }
  if (state.cutFilter) {
    chips.push({
      id: "cutFilter",
      label: "Corte",
      value: optionLabel(CUT_FILTER_OPTIONS, state.cutFilter),
    });
  }
  const invoiceNumber = safeTrim(state.invoiceNumber);
  if (invoiceNumber) {
    chips.push({ id: "invoiceNumber", label: "Número NF", value: invoiceNumber });
  }

  return chips;
}

export function advancedFiltersButtonLabel(activeCount: number): string {
  if (activeCount <= 0) return "Filtros avançados";
  return `Filtros avançados (${activeCount})`;
}
