/**
 * Utilitários — Inteligência do Cliente (filtros, região, números seguros).
 */

import { isGroupCompanyCustomer } from "@/src/lib/groupCompanyCustomer.js";
import { normalizeBrazilUf } from "@/src/lib/customerIndicators.js";
import {
  isCommercialMetricsSalesOrder,
  isCommercialOpenSalesOrder,
  normalizeCustomerDocument,
  safeCommercialNumber,
} from "@/src/lib/customerCommercialSalesOrderView.js";
import type {
  CustomerIntelligenceCustomerInput,
  CustomerIntelligenceFilters,
  CustomerIntelligenceOrderInput,
  CustomerIntelligenceTopN,
} from "@/src/lib/customerIntelligenceTypes.js";

export class CustomerIntelligenceFilterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerIntelligenceFilterParseError";
  }
}

/** Dias sem compra do produto para classificar como abandonado. */
export const CUSTOMER_INTELLIGENCE_ABANDONED_PRODUCT_DAYS = 180;

/** Primeira compra nos últimos N dias classifica produto como novo no mix. */
export const CUSTOMER_INTELLIGENCE_NEW_PRODUCT_DAYS = 180;

/** @deprecated Use CUSTOMER_INTELLIGENCE_ABANDONED_PRODUCT_DAYS */
export const CUSTOMER_INTELLIGENCE_ABANDONED_PRODUCT_MONTHS = 6;

const MONTH_LABELS_PT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

/** Mapa UF → região macro (Brasil). Documentado para derivar região quando ausente no cadastro. */
export const BRAZIL_UF_TO_REGION: Readonly<Record<string, string>> = {
  AC: "Norte",
  AP: "Norte",
  AM: "Norte",
  PA: "Norte",
  RO: "Norte",
  RR: "Norte",
  TO: "Norte",
  AL: "Nordeste",
  BA: "Nordeste",
  CE: "Nordeste",
  MA: "Nordeste",
  PB: "Nordeste",
  PE: "Nordeste",
  PI: "Nordeste",
  RN: "Nordeste",
  SE: "Nordeste",
  DF: "Centro-Oeste",
  GO: "Centro-Oeste",
  MS: "Centro-Oeste",
  MT: "Centro-Oeste",
  ES: "Sudeste",
  MG: "Sudeste",
  RJ: "Sudeste",
  SP: "Sudeste",
  RS: "Sul",
  PR: "Sul",
  SC: "Sul",
};

export function monthLabelPt(month: number): string {
  if (month < 1 || month > 12) return "—";
  return MONTH_LABELS_PT[month - 1]!;
}

export function parseIsoDateOnly(value: unknown): string | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new CustomerIntelligenceFilterParseError(
      "Data inválida. Use o formato YYYY-MM-DD."
    );
  }
  const d = new Date(`${raw}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new CustomerIntelligenceFilterParseError("Data inválida.");
  }
  return raw;
}

function parseOptionalYear(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1900 || n > 2100) {
    throw new CustomerIntelligenceFilterParseError("Ano inválido.");
  }
  return n;
}

function parseOptionalNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) {
    throw new CustomerIntelligenceFilterParseError("Valor numérico inválido.");
  }
  return n;
}

function parseTopN(value: unknown): CustomerIntelligenceTopN {
  const raw = String(value ?? "10").trim().toLowerCase();
  if (raw === "all" || raw === "todos") return "all";
  const n = Number.parseInt(raw, 10);
  if (n === 10 || n === 20 || n === 50) return n;
  throw new CustomerIntelligenceFilterParseError("topN inválido. Use 10, 20, 50 ou all.");
}

function parseCustomerType(value: unknown): "external" | "all" {
  const raw = String(value ?? "external").trim().toLowerCase();
  if (raw === "all" || raw === "todos") return "all";
  if (raw === "external" || raw === "externo") return "external";
  throw new CustomerIntelligenceFilterParseError('customerType inválido. Use "external" ou "all".');
}

export function createDefaultCustomerIntelligenceFilters(
  referenceDate = new Date()
): CustomerIntelligenceFilters {
  return {
    startDate: null,
    endDate: null,
    year: referenceDate.getFullYear(),
    status: null,
    responsible: null,
    productId: null,
    minNetValue: null,
    maxNetValue: null,
    customerType: "external",
    topN: 10,
  };
}

export function parseCustomerIntelligenceFilters(
  query: Record<string, unknown>,
  referenceDate = new Date()
): CustomerIntelligenceFilters {
  const defaults = createDefaultCustomerIntelligenceFilters(referenceDate);
  const hasYear = query.year != null && String(query.year).trim() !== "";
  const hasStart = query.startDate != null && String(query.startDate).trim() !== "";
  const hasEnd = query.endDate != null && String(query.endDate).trim() !== "";

  return {
    startDate: parseIsoDateOnly(query.startDate),
    endDate: parseIsoDateOnly(query.endDate),
    year: hasStart || hasEnd ? null : hasYear ? parseOptionalYear(query.year) : defaults.year,
    status:
      query.status != null && String(query.status).trim() !== ""
        ? String(query.status).trim()
        : null,
    responsible:
      query.responsible != null && String(query.responsible).trim() !== ""
        ? String(query.responsible).trim()
        : null,
    productId:
      query.productId != null && String(query.productId).trim() !== ""
        ? String(query.productId).trim()
        : null,
    minNetValue: parseOptionalNumber(query.minNetValue),
    maxNetValue: parseOptionalNumber(query.maxNetValue),
    customerType: parseCustomerType(query.customerType),
    topN: parseTopN(query.topN),
  };
}

export function safeFiniteNumber(value: unknown, fallback: number | null = null): number | null {
  const n = safeCommercialNumber(value, NaN);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

export function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

export function roundMoney(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export function orderIssueDateInRange(
  issueDate: Date,
  filters: CustomerIntelligenceFilters
): boolean {
  const t = issueDate.getTime();
  if (filters.startDate) {
    const from = new Date(`${filters.startDate}T00:00:00.000Z`).getTime();
    if (t < from) return false;
  }
  if (filters.endDate) {
    const to = new Date(`${filters.endDate}T23:59:59.999Z`).getTime();
    if (t > to) return false;
  }
  if (filters.year != null && issueDate.getFullYear() !== filters.year) return false;
  return true;
}

export function filterCustomerIntelligenceOrders(
  orders: CustomerIntelligenceOrderInput[],
  filters: CustomerIntelligenceFilters
): CustomerIntelligenceOrderInput[] {
  return orders.filter((order) => {
    if (!orderIssueDateInRange(order.issueDate, filters)) return false;
    if (filters.status && order.status !== filters.status) return false;
    if (filters.responsible && (order.responsible ?? "").trim() !== filters.responsible) return false;
    if (
      filters.productId &&
      !order.items.some((item) => item.productId === filters.productId)
    ) {
      return false;
    }
    const net = safeCommercialNumber(order.totalNetValue);
    if (filters.minNetValue != null && net < filters.minNetValue) return false;
    if (filters.maxNetValue != null && net > filters.maxNetValue) return false;
    return true;
  });
}

/** Pedidos válidos para indicadores comerciais principais (exclui cancelados/erro). */
export function getCustomerIntelligenceMetricsOrders(
  filteredOrders: CustomerIntelligenceOrderInput[]
): CustomerIntelligenceOrderInput[] {
  return filteredOrders.filter((o) => isCommercialMetricsSalesOrder(o.status));
}

export function deriveBrazilRegionFromUf(rawState: string | null | undefined): string | null {
  const uf = normalizeBrazilUf(rawState);
  if (uf === "—" || uf === "OUTROS") return null;
  return BRAZIL_UF_TO_REGION[uf] ?? null;
}

export function resolveCustomerIntelligenceRegion(
  state: string | null | undefined
): string | null {
  return deriveBrazilRegionFromUf(state);
}

export function resolveCustomerDisplayName(customer: CustomerIntelligenceCustomerInput): string {
  const trade = customer.tradeName?.trim();
  if (trade) return trade;
  return customer.companyName.trim();
}

export function isInternalGroupCustomer(customer: CustomerIntelligenceCustomerInput): boolean {
  return isGroupCompanyCustomer({
    taxId: customer.taxId,
    companyName: customer.companyName,
    tradeName: customer.tradeName,
  });
}

export function applyTopNLimit<T>(rows: T[], topN: CustomerIntelligenceTopN): T[] {
  if (topN === "all") return rows;
  return rows.slice(0, topN);
}

export function daysBetweenDates(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

export function toIsoDateOnly(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function cnpjMatchesArRow(
  customerTaxId: string | null | undefined,
  arPersonCnpj: string | null | undefined
): boolean {
  const customerDoc = normalizeCustomerDocument(customerTaxId);
  const arDoc = normalizeCustomerDocument(arPersonCnpj);
  return customerDoc.length > 0 && customerDoc === arDoc;
}

export { isCommercialMetricsSalesOrder, isCommercialOpenSalesOrder, safeCommercialNumber };
