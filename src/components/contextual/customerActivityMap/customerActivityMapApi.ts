/**
 * Cliente HTTP do Mapa de Atuação. Os números chegam prontos do backend —
 * esta camada não agrega nem recalcula nada.
 */

import { fetchJsonOk } from "@/src/lib/http";
import type { MapCounts } from "./customerActivityMapVisual";

export type MapCity = MapCounts & {
  ibgeCode: number;
  city: string;
  uf: string;
  lat: number;
  lng: number;
};

export type MapState = MapCounts & {
  uf: string;
  name: string;
  lat: number;
  lng: number;
  cities: number;
  stateOnlyCustomers: number;
};

export type MapOverview = {
  summary: MapCounts & {
    mappedCustomers: number;
    stateOnlyCustomers: number;
    unmappedCustomers: number;
    states: number;
    cities: number;
    unresolvedByReason: Array<{ reason: string; label: string; count: number }>;
  };
  states: MapState[];
  cities: MapCity[];
  semantics: {
    activeRule: string;
    ordersRule: string;
    newCustomersRule: string;
    locationRule: string;
  };
  filters: {
    owners: Array<{ key: string; name: string; customers: number }>;
  };
  generatedAt: string;
};

export type MapCustomer = {
  id: string;
  companyName: string;
  tradeName: string | null;
  city: string | null;
  state: string | null;
  precision: "EXACT" | "CITY" | "STATE" | "UNKNOWN";
  lat: number | null;
  lng: number | null;
  reason: string | null;
  status: string;
  ownerName: string | null;
  orderCount: number;
  lastOrderAt: string | null;
};

export type MapCustomerDetail = { customers: MapCustomer[]; total: number; truncated: boolean };

export type MapFilters = {
  status: "" | "ACTIVE" | "INACTIVE";
  ownerKey: string;
  orderPeriod: "all" | "12m" | "90d" | "30d";
};

export const DEFAULT_MAP_FILTERS: MapFilters = { status: "", ownerKey: "", orderPeriod: "all" };

/** Mesmo valor usado pelo backend para "sem responsável". */
export const MAP_NO_OWNER_KEY = "__none__";

export const MAP_ORDER_PERIOD_LABELS: Record<MapFilters["orderPeriod"], string> = {
  all: "Todo o histórico",
  "12m": "Últimos 12 meses",
  "90d": "Últimos 90 dias",
  "30d": "Últimos 30 dias",
};

const BASE = "/api/customers/indicators/map";

export function mapFiltersQuery(filters: MapFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.ownerKey) params.set("ownerKey", filters.ownerKey);
  if (filters.orderPeriod !== "all") params.set("orderPeriod", filters.orderPeriod);
  return params;
}

export const customerActivityMapApi = {
  overview(filters: MapFilters, signal?: AbortSignal) {
    const query = mapFiltersQuery(filters).toString();
    return fetchJsonOk<MapOverview>(query ? `${BASE}?${query}` : BASE, { signal });
  },

  customers(
    filters: MapFilters,
    scope: { bbox: string } | { ibgeCode: number } | { unresolved: true },
    signal?: AbortSignal
  ) {
    const params = mapFiltersQuery(filters);
    if ("bbox" in scope) params.set("bbox", scope.bbox);
    else if ("ibgeCode" in scope) params.set("ibgeCode", String(scope.ibgeCode));
    else params.set("unresolved", "true");
    return fetchJsonOk<MapCustomerDetail>(`${BASE}/customers?${params.toString()}`, { signal });
  },
};

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
