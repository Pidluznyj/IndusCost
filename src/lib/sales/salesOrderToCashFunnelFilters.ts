/**
 * Filtros UI + chips + atalhos de período — Funil Pedido → Caixa.
 * Não recalcula estágio: só monta estado/query para a API read-only.
 */

import type { FinanceBiFilterChip } from "@/src/lib/financeBiFilterChips";
import {
  ORDER_TO_CASH_ALERT_OPTIONS,
  ORDER_TO_CASH_CONFIDENCE_OPTIONS,
  ORDER_TO_CASH_DATE_AXIS_OPTIONS,
  ORDER_TO_CASH_PERIOD_PRESETS,
  ORDER_TO_CASH_RESPONSIBLE_OPTIONS,
  ORDER_TO_CASH_STAGE_FILTER_OPTIONS,
  ORDER_TO_CASH_STAGE_GROUP_OPTIONS,
  ORDER_TO_CASH_TEMPERATURE_OPTIONS,
} from "@/src/lib/sales/salesOrderToCashFunnelUiCopy";

export type OrderToCashFunnelDateAxis =
  | "ORDER_ISSUE_DATE"
  | "EXPECTED_DELIVERY_DATE"
  | "STOCK_DOCUMENT_DATE"
  | "NFE_DATE"
  | "RECEIVABLE_DUE_DATE"
  | "RECEIVABLE_SETTLEMENT_DATE"
  | "FORECAST_DATE"
  | "UPDATED_AT";

export type OrderToCashFunnelPeriodPreset =
  | "this_month"
  | "last_month"
  | "next_30"
  | "next_60"
  | "next_90"
  | "overdue"
  | "current_year"
  | "last_12_months"
  | "custom"
  | "";

export type OrderToCashFunnelUiFilters = {
  customerName: string;
  sellerName: string;
  companyName: string;
  orderCode: string;
  productSku: string;
  funnelStage: string;
  stageGroup: string;
  temperature: string;
  confidenceLabel: string;
  alert: string;
  responsibleArea: string;
  minValue: string;
  maxValue: string;
  dateAxis: OrderToCashFunnelDateAxis;
  periodPreset: OrderToCashFunnelPeriodPreset;
  dateFrom: string;
  dateTo: string;
  page: number;
  pageSize: number;
};

function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function optionLabel(
  options: readonly { value: string; label: string }[],
  value: string
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export function resolveOrderToCashFunnelPeriodPreset(
  preset: OrderToCashFunnelPeriodPreset,
  today = startOfToday()
): { from: string; to: string } | null {
  if (!preset || preset === "custom") return null;

  const todayYmd = formatYmdLocal(today);

  if (preset === "this_month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: formatYmdLocal(start), to: formatYmdLocal(end) };
  }
  if (preset === "last_month") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: formatYmdLocal(start), to: formatYmdLocal(end) };
  }
  if (preset === "next_30" || preset === "next_60" || preset === "next_90") {
    const days = preset === "next_30" ? 30 : preset === "next_60" ? 60 : 90;
    const end = new Date(today);
    end.setDate(end.getDate() + days);
    return { from: todayYmd, to: formatYmdLocal(end) };
  }
  if (preset === "overdue") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { from: "", to: formatYmdLocal(yesterday) };
  }
  if (preset === "current_year") {
    return {
      from: formatYmdLocal(new Date(today.getFullYear(), 0, 1)),
      to: formatYmdLocal(new Date(today.getFullYear(), 11, 31)),
    };
  }
  if (preset === "last_12_months") {
    const start = new Date(today);
    start.setFullYear(start.getFullYear() - 1);
    return { from: formatYmdLocal(start), to: todayYmd };
  }
  return null;
}

export function applyOrderToCashFunnelPeriodPreset(
  filters: OrderToCashFunnelUiFilters,
  preset: OrderToCashFunnelPeriodPreset,
  today = startOfToday()
): OrderToCashFunnelUiFilters {
  if (preset === "custom") {
    return { ...filters, periodPreset: "custom" };
  }
  if (!preset) {
    return { ...filters, periodPreset: "", dateFrom: "", dateTo: "" };
  }
  const range = resolveOrderToCashFunnelPeriodPreset(preset, today);
  if (!range) return { ...filters, periodPreset: preset };

  let dateAxis = filters.dateAxis;
  if (
    (preset === "next_30" ||
      preset === "next_60" ||
      preset === "next_90" ||
      preset === "overdue") &&
    (dateAxis === "ORDER_ISSUE_DATE" || dateAxis === "UPDATED_AT")
  ) {
    dateAxis = "FORECAST_DATE";
  }

  return {
    ...filters,
    periodPreset: preset,
    dateAxis,
    dateFrom: range.from,
    dateTo: range.to,
  };
}

export function createDefaultOrderToCashFunnelUiFilters(
  today = startOfToday()
): OrderToCashFunnelUiFilters {
  const base: OrderToCashFunnelUiFilters = {
    customerName: "",
    sellerName: "",
    companyName: "",
    orderCode: "",
    productSku: "",
    funnelStage: "",
    stageGroup: "",
    temperature: "",
    confidenceLabel: "",
    alert: "",
    responsibleArea: "",
    minValue: "",
    maxValue: "",
    dateAxis: "ORDER_ISSUE_DATE",
    periodPreset: "current_year",
    dateFrom: "",
    dateTo: "",
    page: 1,
    pageSize: 50,
  };
  return applyOrderToCashFunnelPeriodPreset(base, "current_year", today);
}

export function dateAxisLabel(axis: OrderToCashFunnelDateAxis): string {
  return (
    ORDER_TO_CASH_DATE_AXIS_OPTIONS.find((o) => o.value === axis)?.label ?? axis
  );
}

export function buildOrderToCashFunnelFilterChips(
  filters: OrderToCashFunnelUiFilters,
  onRemoveField?: (field: keyof OrderToCashFunnelUiFilters) => void
): FinanceBiFilterChip[] {
  const chips: FinanceBiFilterChip[] = [];
  const push = (id: keyof OrderToCashFunnelUiFilters, label: string) => {
    chips.push({
      id,
      label,
      onRemove: onRemoveField ? () => onRemoveField(id) : undefined,
    });
  };

  if (filters.customerName.trim()) {
    push("customerName", `Cliente: ${filters.customerName.trim()}`);
  }
  if (filters.sellerName.trim()) {
    push("sellerName", `Vendedor: ${filters.sellerName.trim()}`);
  }
  if (filters.companyName.trim()) {
    push("companyName", `Empresa: ${filters.companyName.trim()}`);
  }
  if (filters.orderCode.trim()) {
    push("orderCode", `Pedido: ${filters.orderCode.trim()}`);
  }
  if (filters.productSku.trim()) {
    push("productSku", `Produto/SKU: ${filters.productSku.trim()}`);
  }
  if (filters.funnelStage) {
    push(
      "funnelStage",
      `Estágio: ${optionLabel([...ORDER_TO_CASH_STAGE_FILTER_OPTIONS], filters.funnelStage)}`
    );
  }
  if (filters.stageGroup) {
    push(
      "stageGroup",
      `Grupo: ${optionLabel([...ORDER_TO_CASH_STAGE_GROUP_OPTIONS], filters.stageGroup)}`
    );
  }
  if (filters.temperature) {
    push(
      "temperature",
      `Temperatura: ${optionLabel([...ORDER_TO_CASH_TEMPERATURE_OPTIONS], filters.temperature)}`
    );
  }
  if (filters.confidenceLabel) {
    push(
      "confidenceLabel",
      `Confiança: ${optionLabel([...ORDER_TO_CASH_CONFIDENCE_OPTIONS], filters.confidenceLabel)}`
    );
  }
  if (filters.alert) {
    push(
      "alert",
      `Alerta: ${optionLabel([...ORDER_TO_CASH_ALERT_OPTIONS], filters.alert)}`
    );
  }
  if (filters.responsibleArea) {
    push(
      "responsibleArea",
      `Responsável: ${optionLabel(
        [...ORDER_TO_CASH_RESPONSIBLE_OPTIONS],
        filters.responsibleArea
      )}`
    );
  }
  if (filters.minValue.trim()) {
    push("minValue", `Valor mín.: ${filters.minValue.trim()}`);
  }
  if (filters.maxValue.trim()) {
    push("maxValue", `Valor máx.: ${filters.maxValue.trim()}`);
  }
  if (filters.periodPreset && filters.periodPreset !== "custom") {
    push(
      "periodPreset",
      `Período: ${optionLabel([...ORDER_TO_CASH_PERIOD_PRESETS], filters.periodPreset)}`
    );
  } else {
    if (filters.dateFrom.trim()) push("dateFrom", `De: ${filters.dateFrom}`);
    if (filters.dateTo.trim()) push("dateTo", `Até: ${filters.dateTo}`);
  }
  if (filters.dateAxis && filters.dateAxis !== "ORDER_ISSUE_DATE") {
    push("dateAxis", `Eixo: ${dateAxisLabel(filters.dateAxis)}`);
  }

  return chips;
}

export function countActiveOrderToCashFunnelFilters(
  filters: OrderToCashFunnelUiFilters
): number {
  let n = 0;
  if (filters.customerName.trim()) n += 1;
  if (filters.sellerName.trim()) n += 1;
  if (filters.companyName.trim()) n += 1;
  if (filters.orderCode.trim()) n += 1;
  if (filters.productSku.trim()) n += 1;
  if (filters.funnelStage) n += 1;
  if (filters.stageGroup) n += 1;
  if (filters.temperature) n += 1;
  if (filters.confidenceLabel) n += 1;
  if (filters.alert) n += 1;
  if (filters.responsibleArea) n += 1;
  if (filters.minValue.trim()) n += 1;
  if (filters.maxValue.trim()) n += 1;
  if (filters.periodPreset && filters.periodPreset !== "current_year") n += 1;
  else if (
    filters.periodPreset === "custom" ||
    (!filters.periodPreset && (filters.dateFrom.trim() || filters.dateTo.trim()))
  ) {
    n += 1;
  }
  if (filters.dateAxis !== "ORDER_ISSUE_DATE") n += 1;
  return n;
}

/** Params de query enviados ao endpoint (sem page). */
export function buildOrderToCashFunnelQueryParams(
  filters: OrderToCashFunnelUiFilters
): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: string, value: string | number | null | undefined) => {
    if (value == null) return;
    const s = String(value).trim();
    if (!s) return;
    out[key] = s;
  };

  put("page", filters.page);
  put("pageSize", filters.pageSize);
  put("dateAxis", filters.dateAxis);
  put("dateFrom", filters.dateFrom);
  put("dateTo", filters.dateTo);
  put("cliente", filters.customerName);
  put("vendedor", filters.sellerName);
  put("empresa", filters.companyName);
  put("pedido", filters.orderCode);
  put("produto", filters.productSku);
  put("estagio", filters.funnelStage);
  put("grupo", filters.stageGroup);
  put("temperatura", filters.temperature);
  put("confianca", filters.confidenceLabel);
  put("alerta", filters.alert);
  put("responsavel", filters.responsibleArea);
  put("valorMinimo", filters.minValue);
  put("valorMaximo", filters.maxValue);
  return out;
}
