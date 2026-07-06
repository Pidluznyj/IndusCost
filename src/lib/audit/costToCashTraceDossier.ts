/**
 * Dossiê auditável — export JSON/CSV a partir do mesmo payload da tela (read-only).
 */
import type { CostToCashTraceSearchFilters } from "./costToCashTraceClient.js";
import { TRACE_PAGE_UNAVAILABLE } from "./costToCashTracePageView.js";
import type { CostToCashTraceApiPayloadInput } from "./costToCashTraceDossierMapper.js";
import { appendTraceCsvSection, traceCsvLine } from "./traceCommon.js";
import type { ProductCostTrace } from "./productCostTrace.js";
import type { PublishedPriceTrace } from "./publishedPriceTrace.js";
import type { SalesOrderTrace } from "./salesOrderTrace.js";
import type { CommissionTrace } from "./commissionTrace.js";
import type { CostToCashChainLink } from "./costToCashTrace.js";
import type { TraceDiagnostic } from "./traceDiagnostic.js";

export class CostToCashTraceDossierError extends Error {
  readonly code = "DOSSIER_EXPORT_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "CostToCashTraceDossierError";
  }
}

export type CostToCashTraceDossierJson = {
  dossierVersion: "1";
  exportedAt: string;
  filters: CostToCashTraceSearchFilters | null;
  status: CostToCashTraceApiPayloadInput["status"];
  summary: CostToCashTraceApiPayloadInput["summary"];
  product: ProductCostTrace | null;
  cost: {
    currentCost: ProductCostTrace["currentCost"] | null;
    officialVersion: ProductCostTrace["officialVersion"] | null;
    costBreakdown: ProductCostTrace["costBreakdown"] | null;
  } | null;
  bom: ProductCostTrace["bom"] | null;
  materials: ProductCostTrace["materials"] | null;
  process: ProductCostTrace["process"] | null;
  publishedPrices: ProductCostTrace["commercialPrices"] | null;
  publishedPrice: PublishedPriceTrace | null;
  salesOrder: SalesOrderTrace | null;
  commission: CommissionTrace | null;
  chain: CostToCashChainLink[];
  diagnostics: {
    items: TraceDiagnostic[];
    warnings: CostToCashTraceApiPayloadInput["warnings"];
    errors: CostToCashTraceApiPayloadInput["errors"];
  };
};

export function assertExportableDossier(
  payload: CostToCashTraceApiPayloadInput | null | undefined
): asserts payload is CostToCashTraceApiPayloadInput {
  if (!payload) {
    throw new CostToCashTraceDossierError(
      "Realize uma consulta antes de exportar o dossiê."
    );
  }
}

export function resolveDossierFilenamePrefix(
  payload: CostToCashTraceApiPayloadInput,
  filters: CostToCashTraceSearchFilters | null
): string {
  const sku =
    payload.sections.product?.product?.sku ??
    filters?.sku?.trim() ??
    payload.sections.publishedPrice?.product.sku ??
    null;
  const order =
    payload.sections.salesOrder?.order?.orderNumber ??
    filters?.orderNumber?.trim() ??
    payload.sections.commission?.sale?.orderNumber ??
    null;
  const slug = (sku ?? order ?? "dossier").replace(/[^\w.-]+/g, "_");
  return `cost-to-cash-dossier-${slug}`;
}

export function buildCostToCashTraceDossierJson(
  payload: CostToCashTraceApiPayloadInput,
  filters: CostToCashTraceSearchFilters | null = null
): CostToCashTraceDossierJson {
  const product = payload.sections.product;

  return {
    dossierVersion: "1",
    exportedAt: new Date().toISOString(),
    filters,
    status: payload.status,
    summary: payload.summary,
    product: product ?? null,
    cost: product
      ? {
          currentCost: product.currentCost,
          officialVersion: product.officialVersion,
          costBreakdown: product.costBreakdown,
        }
      : null,
    bom: product?.bom ?? null,
    materials: product?.materials ?? null,
    process: product?.process ?? null,
    publishedPrices: product?.commercialPrices ?? null,
    publishedPrice: payload.sections.publishedPrice ?? null,
    salesOrder: payload.sections.salesOrder ?? null,
    commission: payload.sections.commission ?? null,
    chain: payload.sections.chain ?? [],
    diagnostics: {
      items: payload.diagnostics,
      warnings: payload.warnings,
      errors: payload.errors,
    },
  };
}

export function buildCostToCashTraceDossierCsv(
  payload: CostToCashTraceApiPayloadInput
): string {
  const lines: string[] = [];
  lines.push(traceCsvLine(["section", "field", "value"]));
  lines.push(traceCsvLine(["meta", "status", payload.status]));
  lines.push(traceCsvLine(["meta", "auditedAt", payload.summary.auditedAt]));
  lines.push(traceCsvLine(["meta", "calculationMode", payload.summary.calculationMode]));

  appendTraceCsvSection(
    lines,
    "summary",
    [
      ["title", payload.summary.title],
      ["message", payload.summary.message ?? TRACE_PAGE_UNAVAILABLE],
    ]
  );

  appendTraceCsvSection(
    lines,
    "chain",
    (payload.sections.chain ?? []).map((link) => [
      link.stage,
      link.label,
      link.status,
      link.summary ?? TRACE_PAGE_UNAVAILABLE,
      link.calculationMode,
    ])
  );

  const product = payload.sections.product;
  if (product?.product) {
    appendTraceCsvSection(lines, "product", [
      ["sku", product.product.sku],
      ["name", product.product.name],
      ["engineeringCost", product.currentCost.engineeringCost],
      ["officialPublishedCost", product.currentCost.officialPublishedCost],
      ["versionCode", product.officialVersion.versionCode],
      ["effectiveDate", product.officialVersion.effectiveDate],
    ]);
    appendTraceCsvSection(lines, "cost", [
      ["materialCost", product.costBreakdown.materialCost],
      ["laborCost", product.costBreakdown.laborCost],
      ["machineCost", product.costBreakdown.machineCost],
      ["totalCost", product.costBreakdown.totalCost],
      ["source", product.costBreakdown.source],
    ]);
    for (const row of product.bom.components.slice(0, 100)) {
      lines.push(
        traceCsvLine([
          "bom",
          row.sku,
          row.name,
          row.quantity,
          row.unitCost,
          row.totalCost,
          row.sharePercent,
        ])
      );
    }
    for (const row of product.materials.topCostRanking.slice(0, 50)) {
      lines.push(
        traceCsvLine([
          "material",
          row.rank,
          row.sku,
          row.name,
          row.quantity,
          row.unitCost,
          row.totalCost,
        ])
      );
    }
    if (product.process.included) {
      appendTraceCsvSection(lines, "process", [
        ["cycleTimeSeconds", product.process.cycleTimeSeconds],
        ["laborCost", product.process.laborCost],
        ["machineCost", product.process.machineCost],
        ["source", product.process.source],
      ]);
    }
  } else {
    lines.push(traceCsvLine(["product", "status", TRACE_PAGE_UNAVAILABLE]));
  }

  const publishedPrice = payload.sections.publishedPrice;
  if (publishedPrice) {
    appendTraceCsvSection(lines, "publishedPrice", [
      ["tableCode", publishedPrice.commercialPrice.tableCode],
      ["versionNumber", publishedPrice.commercialPrice.versionNumber],
      ["salePrice", publishedPrice.commercialPrice.salePrice],
      ["industrialCost", publishedPrice.costSource.industrialCost],
      ["publishedAt", publishedPrice.commercialPrice.publishedAt],
    ]);
  } else {
    lines.push(traceCsvLine(["publishedPrice", "status", TRACE_PAGE_UNAVAILABLE]));
  }

  const salesOrder = payload.sections.salesOrder;
  if (salesOrder?.order) {
    appendTraceCsvSection(lines, "salesOrder", [
      ["orderNumber", salesOrder.order.orderNumber],
      ["customerName", salesOrder.order.customerName],
      ["totalSold", salesOrder.totals.totalSold],
      ["totalMarginPercent", salesOrder.totals.totalMarginPercent],
    ]);
    for (const item of salesOrder.items.slice(0, 100)) {
      lines.push(
        traceCsvLine([
          "salesItem",
          item.sku,
          item.productName,
          item.soldAmount,
          item.officialTotalCost,
          item.marginPercent,
          item.costSource,
        ])
      );
    }
  } else {
    lines.push(traceCsvLine(["salesOrder", "status", TRACE_PAGE_UNAVAILABLE]));
  }

  const commission = payload.sections.commission;
  if (commission?.sale) {
    appendTraceCsvSection(lines, "commission", [
      ["orderNumber", commission.sale.orderNumber],
      ["totalGrossCommission", commission.totals.totalGrossCommission],
      ["totalFinalCommission", commission.totals.totalFinalCommission],
      ["totalReleasedCommission", commission.totals.totalReleasedCommission],
      ["totalPendingCommission", commission.totals.totalPendingCommission],
    ]);
    for (const item of commission.items.slice(0, 100)) {
      lines.push(
        traceCsvLine([
          "commissionItem",
          item.sku,
          item.productName,
          item.soldAmount,
          item.commissionRatePercent,
          item.finalCommissionAmount,
          item.status,
        ])
      );
    }
    for (const receipt of commission.receipts.slice(0, 100)) {
      lines.push(
        traceCsvLine([
          "receipt",
          receipt.receivableCode,
          receipt.settlementDate,
          receipt.amountReceived,
          receipt.releasedCommissionAmount,
          receipt.pendingCommissionAmount,
          receipt.status,
        ])
      );
    }
  } else {
    lines.push(traceCsvLine(["commission", "status", TRACE_PAGE_UNAVAILABLE]));
  }

  for (const diag of payload.diagnostics) {
    lines.push(
      traceCsvLine(["diagnostic", diag.code, diag.severity, diag.source, diag.message])
    );
  }
  for (const warn of payload.warnings) {
    lines.push(traceCsvLine(["warning", warn.code, warn.source, warn.message]));
  }
  for (const err of payload.errors) {
    lines.push(traceCsvLine(["error", err.code, err.source, err.message]));
  }

  return `${lines.join("\n")}\n`;
}

export function formatDiagnosticsForClipboard(
  payload: CostToCashTraceApiPayloadInput
): string {
  const lines: string[] = [];
  lines.push(`Rastreabilidade — diagnósticos (${payload.summary.auditedAt})`);
  lines.push(`Status: ${payload.status}`);
  if (payload.summary.message) lines.push(`Mensagem: ${payload.summary.message}`);

  if (
    payload.errors.length === 0 &&
    payload.warnings.length === 0 &&
    payload.diagnostics.length === 0
  ) {
    lines.push("Sem diagnósticos registrados.");
    return lines.join("\n");
  }

  for (const item of payload.errors) {
    lines.push(`[ERRO] ${item.source ?? "—"}/${item.code}: ${item.message}`);
  }
  for (const item of payload.warnings) {
    lines.push(`[AVISO] ${item.source ?? "—"}/${item.code}: ${item.message}`);
  }
  for (const item of payload.diagnostics) {
    lines.push(
      `[${item.severity.toUpperCase()}] ${item.source}/${item.code} (${item.status}): ${item.message}`
    );
  }
  return lines.join("\n");
}
