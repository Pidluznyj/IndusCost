/**
 * Motor central Cost-to-Cash Trace — Produto → Custo → Preço → Venda → Comissão.
 */
import type { CommissionTrace } from "./commissionTrace.js";
import type { ProductCostTrace } from "./productCostTrace.js";
import type { PublishedPriceTrace } from "./publishedPriceTrace.js";
import type { SalesOrderTrace } from "./salesOrderTrace.js";
import {
  appendTraceCsvSection,
  type TraceAuditStatus,
  type TraceCalculationMode,
  type TraceChecklist,
  type TraceDataSource,
  traceCsvLine,
} from "./traceCommon.js";
import {
  mergeTraceDiagnostics,
  mapAlertToDiagnostic,
  type TraceDiagnostic,
} from "./traceDiagnostic.js";
import { buildProductCostTraceCsv } from "./productCostTrace.js";
import { buildSalesOrderTraceCsv } from "./salesOrderTrace.js";
import { buildCommissionTraceCsv } from "./commissionTrace.js";

export type CostToCashTraceStage =
  | "PRODUCT_COST"
  | "PUBLISHED_PRICE"
  | "SALES_ORDER"
  | "COMMISSION";

export type CostToCashChainLink = {
  stage: CostToCashTraceStage;
  label: string;
  status: TraceAuditStatus;
  summary: string | null;
  calculationMode: TraceCalculationMode;
};

export type CostToCashTraceQuery = {
  sku?: string | null;
  productId?: string | null;
  referenceDate?: Date;
  priceItemId?: string | null;
  salesOrderId?: string | null;
  orderNumber?: string | null;
  nfeNumber?: string | null;
  receivableCode?: string | null;
  customer?: string | null;
  year?: number | null;
  month?: number | null;
  seller?: string | null;
  includeProductCost?: boolean;
  includePublishedPrice?: boolean;
  includeSalesOrder?: boolean;
  includeCommission?: boolean;
  nomusBase?: number | null;
  nomusCommission?: number | null;
};

export type CostToCashTrace = {
  status: TraceAuditStatus;
  auditedAt: string;
  errorMessage?: string | null;
  calculationMode: TraceCalculationMode;
  product: ProductCostTrace | null;
  publishedPrice: PublishedPriceTrace | null;
  salesOrder: SalesOrderTrace | null;
  commission: CommissionTrace | null;
  chain: CostToCashChainLink[];
  diagnostics: TraceDiagnostic[];
  dataSources: TraceDataSource[];
  checklist: TraceChecklist;
};

export function buildEmptyCostToCashTrace(errorMessage: string): CostToCashTrace {
  return {
    status: "FAIL",
    auditedAt: new Date().toISOString(),
    errorMessage,
    calculationMode: "PUBLISHED",
    product: null,
    publishedPrice: null,
    salesOrder: null,
    commission: null,
    chain: [],
    diagnostics: [],
    dataSources: [],
    checklist: {},
  };
}

export function resolveCostToCashCalculationMode(input: {
  hasPublishedPrice: boolean;
  hasMaterializedCommission: boolean;
  hasLiveProductRecalc: boolean;
}): TraceCalculationMode {
  if (input.hasPublishedPrice || input.hasMaterializedCommission) return "PUBLISHED";
  if (input.hasLiveProductRecalc) return "DIAGNOSTIC";
  return "PUBLISHED";
}

export function buildCostToCashChain(input: {
  product: ProductCostTrace | null;
  publishedPrice: PublishedPriceTrace | null;
  salesOrder: SalesOrderTrace | null;
  commission: CommissionTrace | null;
}): CostToCashChainLink[] {
  const chain: CostToCashChainLink[] = [];

  if (input.product) {
    chain.push({
      stage: "PRODUCT_COST",
      label: input.product.product?.sku ?? "Produto",
      status: input.product.status,
      summary:
        input.product.currentCost.officialPublishedCost != null
          ? `Custo oficial: ${input.product.currentCost.officialPublishedCost}`
          : input.product.currentCost.engineeringCost != null
            ? `Custo engenharia (diagnóstico): ${input.product.currentCost.engineeringCost}`
            : null,
      calculationMode:
        input.product.currentCost.officialPublishedCost != null ? "PUBLISHED" : "DIAGNOSTIC",
    });
  }

  if (input.publishedPrice) {
    chain.push({
      stage: "PUBLISHED_PRICE",
      label: `${input.publishedPrice.commercialPrice.tableCode} v${input.publishedPrice.commercialPrice.versionNumber}`,
      status: "PASS",
      summary:
        input.publishedPrice.commercialPrice.salePrice != null
          ? `Preço publicado: ${input.publishedPrice.commercialPrice.salePrice}`
          : null,
      calculationMode: "PUBLISHED",
    });
  }

  if (input.salesOrder) {
    chain.push({
      stage: "SALES_ORDER",
      label: input.salesOrder.order?.orderNumber ?? "Pedido",
      status: input.salesOrder.status,
      summary:
        input.salesOrder.totals.totalMarginPercent != null
          ? `Margem: ${input.salesOrder.totals.totalMarginPercent}%`
          : `Vendido: ${input.salesOrder.totals.totalSold}`,
      calculationMode: "PUBLISHED",
    });
  }

  if (input.commission) {
    chain.push({
      stage: "COMMISSION",
      label: input.commission.sale?.orderNumber ?? "Comissão",
      status: input.commission.status,
      summary: `Liberada: ${input.commission.totals.totalReleasedCommission} | Final: ${input.commission.totals.totalFinalCommission}`,
      calculationMode: input.commission.orderSnapshot.snapshotId ? "PUBLISHED" : "DIAGNOSTIC",
    });
  }

  return chain;
}

export function collectCostToCashDiagnostics(input: {
  product: ProductCostTrace | null;
  publishedPrice: PublishedPriceTrace | null;
  salesOrder: SalesOrderTrace | null;
  commission: CommissionTrace | null;
}): TraceDiagnostic[] {
  const productAlerts =
    input.product?.alerts.map((a) => mapAlertToDiagnostic(a, "PRODUCT_COST")) ?? [];
  const salesAlerts =
    input.salesOrder?.alerts.map((a) => mapAlertToDiagnostic(a, "SALES_ORDER")) ?? [];
  const commissionAlerts =
    input.commission?.alerts.map((a) =>
      mapAlertToDiagnostic(
        { ...a, severity: a.severity, context: null },
        "COMMISSION",
        a.code
      )
    ) ?? [];

  const priceDiagnostics: TraceDiagnostic[] = [];
  if (input.publishedPrice?.costSource.newerPublishedVersionWarning) {
    priceDiagnostics.push(
      mapAlertToDiagnostic(
        {
          code: "NEWER_COST_VERSION",
          severity: "warning",
          message: input.publishedPrice.costSource.newerPublishedVersionWarning,
        },
        "PUBLISHED_PRICE",
        "STALE_PUBLISHED_COST"
      )
    );
  }

  return mergeTraceDiagnostics(productAlerts, priceDiagnostics, salesAlerts, commissionAlerts);
}

export function mergeCostToCashChecklists(
  ...lists: Array<TraceChecklist | undefined | null>
): TraceChecklist {
  return Object.assign({}, ...lists.filter(Boolean));
}

export function mergeCostToCashDataSources(
  ...lists: Array<TraceDataSource[] | undefined | null>
): TraceDataSource[] {
  const seen = new Set<string>();
  const out: TraceDataSource[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const row of list) {
      const key = `${row.field}|${row.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

export function resolveCostToCashStatus(
  chain: CostToCashChainLink[],
  errorMessage?: string | null
): TraceAuditStatus {
  if (errorMessage) return "FAIL";
  if (chain.length === 0) return "FAIL";
  return chain.some((link) => link.status === "FAIL") ? "FAIL" : "PASS";
}

export function assembleCostToCashTrace(input: {
  product: ProductCostTrace | null;
  publishedPrice: PublishedPriceTrace | null;
  salesOrder: SalesOrderTrace | null;
  commission: CommissionTrace | null;
  errorMessage?: string | null;
}): CostToCashTrace {
  const chain = buildCostToCashChain(input);
  const diagnostics = collectCostToCashDiagnostics(input);
  const calculationMode = resolveCostToCashCalculationMode({
    hasPublishedPrice: input.publishedPrice != null,
    hasMaterializedCommission: Boolean(input.commission?.orderSnapshot.snapshotId),
    hasLiveProductRecalc:
      input.product != null &&
      input.product.currentCost.officialPublishedCost == null &&
      input.product.currentCost.engineeringCost != null,
  });

  return {
    status: resolveCostToCashStatus(chain, input.errorMessage),
    auditedAt: new Date().toISOString(),
    errorMessage: input.errorMessage ?? null,
    calculationMode,
    product: input.product,
    publishedPrice: input.publishedPrice,
    salesOrder: input.salesOrder,
    commission: input.commission,
    chain,
    diagnostics,
    dataSources: mergeCostToCashDataSources(
      input.product?.dataSources,
      input.salesOrder?.dataSources,
      input.commission?.dataSources
    ),
    checklist: mergeCostToCashChecklists(
      input.product?.checklist,
      input.salesOrder?.checklist,
      input.commission?.checklist,
      {
        usesMaterializedCommissionSnapshot: Boolean(input.commission?.orderSnapshot.snapshotId),
        usesOfficialProductCost: Boolean(input.product?.currentCost.officialPublishedCost),
        usesPublishedPriceSnapshot: Boolean(input.publishedPrice),
        usesOfficialSalesMarginCost: input.salesOrder?.checklist?.usesOfficialIndusCost ?? false,
      }
    ),
  };
}

export function buildCostToCashTraceCsv(trace: CostToCashTrace): string {
  const lines: string[] = [];
  lines.push(traceCsvLine(["section", "field", "value"]));
  lines.push(traceCsvLine(["meta", "status", trace.status]));
  lines.push(traceCsvLine(["meta", "calculationMode", trace.calculationMode]));
  lines.push(traceCsvLine(["meta", "auditedAt", trace.auditedAt]));

  appendTraceCsvSection(
    lines,
    "chain",
    trace.chain.map((link) => [link.stage, link.label, link.status, link.summary, link.calculationMode])
  );

  for (const diag of trace.diagnostics) {
    lines.push(
      traceCsvLine(["diagnostic", diag.code, diag.severity, diag.status, diag.source, diag.message])
    );
  }

  if (trace.product?.status === "PASS") {
    lines.push("");
    lines.push(buildProductCostTraceCsv(trace.product).trimEnd());
  }
  if (trace.salesOrder?.status === "PASS") {
    lines.push("");
    lines.push(buildSalesOrderTraceCsv(trace.salesOrder).trimEnd());
  }
  if (trace.commission?.status === "PASS") {
    lines.push("");
    lines.push(buildCommissionTraceCsv(trace.commission).trimEnd());
  }

  return `${lines.join("\n")}\n`;
}

export function formatCostToCashTraceText(trace: CostToCashTrace): string {
  const out: string[] = [];
  out.push("=== Cost-to-Cash Trace — Produto → Custo → Preço → Venda → Comissão ===\n");
  out.push(`Status: ${trace.status}`);
  out.push(`Modo: ${trace.calculationMode}`);
  out.push(`Auditado em: ${trace.auditedAt}`);

  if (trace.errorMessage) {
    out.push(`\nErro: ${trace.errorMessage}`);
    return out.join("\n");
  }

  if (trace.chain.length > 0) {
    out.push("\n--- Cadeia ---");
    for (const link of trace.chain) {
      out.push(
        `  ${link.stage}: ${link.label} [${link.status}] (${link.calculationMode}) — ${link.summary ?? "—"}`
      );
    }
  }

  if (trace.diagnostics.length > 0) {
    out.push(`\n--- Diagnósticos (${trace.diagnostics.length}) ---`);
    for (const diag of trace.diagnostics) {
      out.push(`  [${diag.severity}] ${diag.source}/${diag.code}: ${diag.message}`);
    }
  }

  return out.join("\n");
}

export type { TraceDiagnostic } from "./traceDiagnostic.js";
export type { TraceAuditStatus, TraceCalculationMode, TraceDataSource } from "./traceCommon.js";
