/**
 * Filtros da UI — Inteligência do Cliente (URL ↔ query API).
 * Não recalcula indicadores; apenas monta query para o endpoint consolidado.
 */

import type { CustomerIntelligenceFilters } from "@/src/lib/customerIntelligenceTypes.js";

export type CustomerIntelligenceUiFilters = {
  startDate: string;
  endDate: string;
  year: string;
  status: string;
  responsible: string;
  productId: string;
  minNetValue: string;
  maxNetValue: string;
  customerType: "external" | "all";
};

export const EMPTY_CUSTOMER_INTELLIGENCE_UI_FILTERS: CustomerIntelligenceUiFilters = {
  startDate: "",
  endDate: "",
  year: "",
  status: "",
  responsible: "",
  productId: "",
  minNetValue: "",
  maxNetValue: "",
  customerType: "external",
};

export function createDefaultCustomerIntelligenceUiFilters(
  referenceDate = new Date()
): CustomerIntelligenceUiFilters {
  return {
    ...EMPTY_CUSTOMER_INTELLIGENCE_UI_FILTERS,
    year: String(referenceDate.getFullYear()),
  };
}

export function customerIntelligenceUiFiltersFromSearchParams(
  params: URLSearchParams,
  referenceDate = new Date()
): CustomerIntelligenceUiFilters {
  const defaults = createDefaultCustomerIntelligenceUiFilters(referenceDate);
  const customerTypeRaw = params.get("customerType")?.trim().toLowerCase();
  return {
    startDate: params.get("startDate")?.trim() ?? defaults.startDate,
    endDate: params.get("endDate")?.trim() ?? defaults.endDate,
    year: params.has("year")
      ? (params.get("year")?.trim() ?? "")
      : params.has("startDate") || params.has("endDate")
        ? ""
        : defaults.year,
    status: params.get("status")?.trim() ?? defaults.status,
    responsible: params.get("responsible")?.trim() ?? defaults.responsible,
    productId: params.get("productId")?.trim() ?? defaults.productId,
    minNetValue: params.get("minNetValue")?.trim() ?? defaults.minNetValue,
    maxNetValue: params.get("maxNetValue")?.trim() ?? defaults.maxNetValue,
    customerType: customerTypeRaw === "all" ? "all" : "external",
  };
}

export function customerIntelligenceUiFiltersToSearchParams(
  filters: CustomerIntelligenceUiFilters
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.year && !filters.startDate && !filters.endDate) params.set("year", filters.year);
  if (filters.status) params.set("status", filters.status);
  if (filters.responsible) params.set("responsible", filters.responsible);
  if (filters.productId) params.set("productId", filters.productId);
  if (filters.minNetValue) params.set("minNetValue", filters.minNetValue);
  if (filters.maxNetValue) params.set("maxNetValue", filters.maxNetValue);
  if (filters.customerType !== "external") params.set("customerType", filters.customerType);
  return params;
}

/** Monta query string para GET /api/crm/customers/:id/intelligence */
export function buildCustomerIntelligenceApiQuery(
  filters: CustomerIntelligenceUiFilters
): string {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.year && !filters.startDate && !filters.endDate) params.set("year", filters.year);
  if (filters.status) params.set("status", filters.status);
  if (filters.responsible) params.set("responsible", filters.responsible);
  if (filters.productId) params.set("productId", filters.productId);
  if (filters.minNetValue) params.set("minNetValue", filters.minNetValue);
  if (filters.maxNetValue) params.set("maxNetValue", filters.maxNetValue);
  params.set("customerType", filters.customerType);
  return params.toString();
}

export function customerIntelligenceFiltersMatchApplied(
  ui: CustomerIntelligenceUiFilters,
  applied: CustomerIntelligenceFilters
): boolean {
  const uiYear = ui.year ? Number.parseInt(ui.year, 10) : null;
  return (
    (ui.startDate || null) === applied.startDate &&
    (ui.endDate || null) === applied.endDate &&
    (Number.isFinite(uiYear!) ? uiYear : null) === applied.year &&
    (ui.status || null) === applied.status &&
    (ui.responsible || null) === applied.responsible &&
    (ui.productId || null) === applied.productId &&
    (ui.minNetValue ? Number(ui.minNetValue) : null) === applied.minNetValue &&
    (ui.maxNetValue ? Number(ui.maxNetValue) : null) === applied.maxNetValue &&
    ui.customerType === applied.customerType
  );
}
