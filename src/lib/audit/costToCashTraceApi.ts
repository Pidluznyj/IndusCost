/**
 * Query parsers e envelope de resposta — Cost-to-Cash Trace API (read-only).
 */
import { civilDateToLocalDate } from "../financeCivilDate.js";
import type { CommissionTrace } from "./commissionTrace.js";
import type { CostToCashTrace } from "./costToCashTrace.js";
import type { ProductCostTrace } from "./productCostTrace.js";
import type { PublishedPriceTrace } from "./publishedPriceTrace.js";
import type { SalesOrderTrace } from "./salesOrderTrace.js";
import type { TraceCalculationMode } from "./traceCommon.js";
import type { TraceDiagnostic } from "./traceDiagnostic.js";

export class CostToCashTraceApiValidationError extends Error {
  readonly code = "VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "CostToCashTraceApiValidationError";
  }
}

export const COST_TO_CASH_TRACE_VIEW_PERMISSIONS = [
  "pricing.view",
  "costs.view",
  "products.tab.cost",
  "settings.price_tables.view",
  "sales_orders.view",
  "sales_orders.detail.view",
  "commissions.view",
  "commissions.audit.view",
  "settings.view",
] as const;

export type CostToCashTraceApiQueryBase = {
  sku?: string | null;
  productId?: string | null;
  priceItemId?: string | null;
  tableCode?: string | null;
  tableId?: string | null;
  salesOrderId?: string | null;
  orderNumber?: string | null;
  nfeNumber?: string | null;
  receivableCode?: string | null;
  year?: number | null;
  month?: number | null;
  seller?: string | null;
  customer?: string | null;
  referenceDate?: Date;
};

export type CostToCashTraceApiResponse<TSections = Record<string, unknown>> = {
  status: "PASS" | "FAIL" | "EMPTY";
  summary: {
    title: string;
    message: string | null;
    auditedAt: string;
    calculationMode: TraceCalculationMode | null;
  };
  sections: TSections;
  diagnostics: TraceDiagnostic[];
  warnings: Array<{ code: string; message: string; source?: string | null }>;
  errors: Array<{ code: string; message: string; source?: string | null }>;
};

function readQueryString(query: Record<string, unknown>, key: string): string | undefined {
  const raw = query[key];
  if (raw == null) return undefined;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

function parseOptionalInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseReferenceDate(raw: string | undefined): Date {
  if (!raw) return new Date();
  const parsed = civilDateToLocalDate(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new CostToCashTraceApiValidationError("Parâmetro date inválido — use YYYY-MM-DD.");
  }
  return parsed;
}

function parseSharedQuery(query: Record<string, unknown>): CostToCashTraceApiQueryBase {
  const year = parseOptionalInt(readQueryString(query, "year"));
  const month = parseOptionalInt(readQueryString(query, "month"));
  if (month != null && (month < 1 || month > 12)) {
    throw new CostToCashTraceApiValidationError("Parâmetro month inválido — use 1 a 12.");
  }
  if (year != null && (year < 2000 || year > 2100)) {
    throw new CostToCashTraceApiValidationError("Parâmetro year inválido.");
  }

  return {
    sku: readQueryString(query, "sku") ?? null,
    productId: readQueryString(query, "productId") ?? readQueryString(query, "product-id") ?? null,
    priceItemId: readQueryString(query, "priceItemId") ?? readQueryString(query, "price-item-id") ?? null,
    tableCode: readQueryString(query, "tableCode") ?? readQueryString(query, "table-code") ?? null,
    tableId: readQueryString(query, "tableId") ?? readQueryString(query, "table-id") ?? null,
    salesOrderId: readQueryString(query, "salesOrderId") ?? readQueryString(query, "sales-order-id") ?? null,
    orderNumber: readQueryString(query, "orderNumber") ?? readQueryString(query, "order-number") ?? null,
    nfeNumber: readQueryString(query, "nfeNumber") ?? readQueryString(query, "nfe-number") ?? null,
    receivableCode:
      readQueryString(query, "receivableCode") ?? readQueryString(query, "receivable-code") ?? null,
    year,
    month,
    seller: readQueryString(query, "seller") ?? null,
    customer: readQueryString(query, "customer") ?? null,
    referenceDate: parseReferenceDate(readQueryString(query, "date") ?? readQueryString(query, "referenceDate")),
  };
}

export function parseProductCostTraceApiQuery(
  query: Record<string, unknown>
): CostToCashTraceApiQueryBase {
  const parsed = parseSharedQuery(query);
  if (!parsed.sku?.trim() && !parsed.productId?.trim()) {
    throw new CostToCashTraceApiValidationError("Informe sku ou productId.");
  }
  return parsed;
}

export function parsePublishedPriceTraceApiQuery(
  query: Record<string, unknown>
): CostToCashTraceApiQueryBase {
  const parsed = parseSharedQuery(query);
  if (!parsed.priceItemId?.trim() && !parsed.sku?.trim()) {
    throw new CostToCashTraceApiValidationError("Informe priceItemId ou sku (com tableCode opcional).");
  }
  return parsed;
}

export function parseSalesOrderTraceApiQuery(
  query: Record<string, unknown>
): CostToCashTraceApiQueryBase {
  const parsed = parseSharedQuery(query);
  if (parsed.customer?.trim() && parsed.year == null) {
    throw new CostToCashTraceApiValidationError("Filtro customer exige year.");
  }
  const hasOrderKey = Boolean(
    parsed.salesOrderId?.trim() ||
      parsed.orderNumber?.trim() ||
      parsed.nfeNumber?.trim() ||
      (parsed.customer?.trim() && parsed.year != null)
  );
  if (!hasOrderKey) {
    throw new CostToCashTraceApiValidationError(
      "Informe salesOrderId, orderNumber, nfeNumber ou customer com year (e opcional month)."
    );
  }
  return parsed;
}

export function parseCommissionTraceApiQuery(
  query: Record<string, unknown>
): CostToCashTraceApiQueryBase {
  const parsed = parseSharedQuery(query);
  if (parsed.customer?.trim() && parsed.year == null) {
    throw new CostToCashTraceApiValidationError("Filtro customer exige year.");
  }
  const hasKey = Boolean(
    parsed.salesOrderId?.trim() ||
      parsed.orderNumber?.trim() ||
      parsed.nfeNumber?.trim() ||
      parsed.receivableCode?.trim() ||
      (parsed.customer?.trim() && parsed.year != null)
  );
  if (!hasKey) {
    throw new CostToCashTraceApiValidationError(
      "Informe salesOrderId, orderNumber, nfeNumber, receivableCode ou customer com year."
    );
  }
  return parsed;
}

export function parseCostToCashTraceApiQuery(
  query: Record<string, unknown>
): CostToCashTraceApiQueryBase {
  const parsed = parseSharedQuery(query);
  if (parsed.customer?.trim() && parsed.year == null) {
    throw new CostToCashTraceApiValidationError("Filtro customer exige year.");
  }
  const hasKey = Boolean(
    parsed.sku?.trim() ||
      parsed.productId?.trim() ||
      parsed.priceItemId?.trim() ||
      parsed.salesOrderId?.trim() ||
      parsed.orderNumber?.trim() ||
      parsed.nfeNumber?.trim() ||
      parsed.receivableCode?.trim() ||
      (parsed.customer?.trim() && parsed.year != null)
  );
  if (!hasKey) {
    throw new CostToCashTraceApiValidationError(
      "Informe sku, priceItemId ou identificador de pedido/título."
    );
  }
  return parsed;
}

function splitDiagnostics(diagnostics: TraceDiagnostic[]): {
  warnings: CostToCashTraceApiResponse["warnings"];
  errors: CostToCashTraceApiResponse["errors"];
} {
  const warnings: CostToCashTraceApiResponse["warnings"] = [];
  const errors: CostToCashTraceApiResponse["errors"] = [];
  for (const item of diagnostics) {
    const row = { code: item.code, message: item.message, source: item.source };
    if (item.severity === "error") errors.push(row);
    else warnings.push(row);
  }
  return { warnings, errors };
}

function resolveApiStatus(
  traceStatus: "PASS" | "FAIL",
  errorMessage: string | null | undefined,
  hasSections: boolean
): "PASS" | "FAIL" | "EMPTY" {
  if (!hasSections && errorMessage) return "EMPTY";
  if (traceStatus === "FAIL" && !hasSections) return "EMPTY";
  return traceStatus;
}

export function buildProductCostTraceApiResponse(
  trace: ProductCostTrace
): CostToCashTraceApiResponse<{ product: ProductCostTrace }> {
  const diagnostics = trace.alerts.map((alert) => ({
    code: alert.code,
    severity: alert.severity,
    status: alert.code,
    message: alert.message,
    source: "PRODUCT_COST",
    context: alert.context ?? null,
  }));
  const { warnings, errors } = splitDiagnostics(diagnostics);
  if (trace.errorMessage) {
    errors.push({ code: "TRACE_FAIL", message: trace.errorMessage, source: "PRODUCT_COST" });
  }

  return {
    status: resolveApiStatus(trace.status, trace.errorMessage, trace.product != null),
    summary: {
      title: "Rastreabilidade de custo do produto",
      message: trace.errorMessage ?? null,
      auditedAt: trace.auditedAt,
      calculationMode:
        trace.currentCost.officialPublishedCost != null ? "PUBLISHED" : "DIAGNOSTIC",
    },
    sections: { product: trace },
    diagnostics,
    warnings,
    errors,
  };
}

export function buildPublishedPriceTraceApiResponse(
  trace: PublishedPriceTrace
): CostToCashTraceApiResponse<{ publishedPrice: PublishedPriceTrace }> {
  const diagnostics: TraceDiagnostic[] = [];
  if (trace.costSource.newerPublishedVersionWarning) {
    diagnostics.push({
      code: "NEWER_COST_VERSION",
      severity: "warning",
      status: "STALE_PUBLISHED_COST",
      message: trace.costSource.newerPublishedVersionWarning,
      source: "PUBLISHED_PRICE",
    });
  }
  const { warnings, errors } = splitDiagnostics(diagnostics);

  return {
    status: "PASS",
    summary: {
      title: "Rastreabilidade de preço publicado",
      message: null,
      auditedAt: new Date().toISOString(),
      calculationMode: "PUBLISHED",
    },
    sections: { publishedPrice: trace },
    diagnostics,
    warnings,
    errors,
  };
}

export function buildPublishedPriceTraceEmptyApiResponse(
  message: string
): CostToCashTraceApiResponse<{ publishedPrice: null }> {
  return {
    status: "EMPTY",
    summary: {
      title: "Rastreabilidade de preço publicado",
      message,
      auditedAt: new Date().toISOString(),
      calculationMode: null,
    },
    sections: { publishedPrice: null },
    diagnostics: [],
    warnings: [],
    errors: [{ code: "NOT_FOUND", message, source: "PUBLISHED_PRICE" }],
  };
}

export function buildSalesOrderTraceApiResponse(
  trace: SalesOrderTrace
): CostToCashTraceApiResponse<{ salesOrder: SalesOrderTrace }> {
  const diagnostics = trace.alerts.map((alert) => ({
    code: alert.code,
    severity: alert.severity,
    status: alert.code,
    message: alert.message,
    source: "SALES_ORDER",
    context: alert.context ?? null,
  }));
  const { warnings, errors } = splitDiagnostics(diagnostics);
  if (trace.errorMessage) {
    errors.push({ code: "TRACE_FAIL", message: trace.errorMessage, source: "SALES_ORDER" });
  }

  return {
    status: resolveApiStatus(trace.status, trace.errorMessage, trace.order != null),
    summary: {
      title: "Rastreabilidade de venda/pedido",
      message: trace.errorMessage ?? null,
      auditedAt: trace.auditedAt,
      calculationMode: "PUBLISHED",
    },
    sections: { salesOrder: trace },
    diagnostics,
    warnings,
    errors,
  };
}

export function buildCommissionTraceApiResponse(
  trace: CommissionTrace
): CostToCashTraceApiResponse<{ commission: CommissionTrace }> {
  const diagnostics = trace.alerts.map((alert) => ({
    code: alert.code,
    severity: alert.severity === "error" ? "error" as const : alert.severity === "info" ? "info" as const : "warning" as const,
    status: alert.code,
    message: alert.message,
    source: "COMMISSION",
    context: null,
  }));
  const { warnings, errors } = splitDiagnostics(diagnostics);
  if (trace.errorMessage) {
    errors.push({ code: "TRACE_FAIL", message: trace.errorMessage, source: "COMMISSION" });
  }

  return {
    status: resolveApiStatus(trace.status, trace.errorMessage, trace.sale != null),
    summary: {
      title: "Rastreabilidade de comissão",
      message: trace.errorMessage ?? null,
      auditedAt: trace.auditedAt,
      calculationMode: trace.orderSnapshot.snapshotId ? "PUBLISHED" : "DIAGNOSTIC",
    },
    sections: { commission: trace },
    diagnostics,
    warnings,
    errors,
  };
}

export function buildCostToCashTraceApiResponse(
  trace: CostToCashTrace
): CostToCashTraceApiResponse<{
  product: ProductCostTrace | null;
  publishedPrice: PublishedPriceTrace | null;
  salesOrder: SalesOrderTrace | null;
  commission: CommissionTrace | null;
  chain: CostToCashTrace["chain"];
}> {
  const { warnings, errors } = splitDiagnostics(trace.diagnostics);
  if (trace.errorMessage) {
    errors.push({ code: "TRACE_FAIL", message: trace.errorMessage, source: "COST_TO_CASH" });
  }

  const hasSections = trace.chain.length > 0;

  return {
    status: resolveApiStatus(trace.status, trace.errorMessage, hasSections),
    summary: {
      title: "Cost-to-Cash Trace",
      message: trace.errorMessage ?? null,
      auditedAt: trace.auditedAt,
      calculationMode: trace.calculationMode,
    },
    sections: {
      product: trace.product,
      publishedPrice: trace.publishedPrice,
      salesOrder: trace.salesOrder,
      commission: trace.commission,
      chain: trace.chain,
    },
    diagnostics: trace.diagnostics,
    warnings,
    errors,
  };
}

export function costToCashTraceApiError(message: string, code = "INTERNAL_ERROR") {
  return { error: code, message };
}
