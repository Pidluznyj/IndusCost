/**
 * Auditoria read-only de rastreabilidade de venda/pedido — tipos e helpers puros.
 */
import { SALES_ORDER_ITEM_UNIT_COST_IS_SALE_PRICE } from "./salesOrderCostSemantics.js";
import type {
  SalesOrderCostSource,
  SalesOrderItemMarginPayload,
  SalesOrderMarginItemResult,
  SalesOrderMarginSummaryPayload,
} from "./salesOrderMarginTypes.js";

export type SalesOrderTraceAuditStatus = "PASS" | "FAIL";

export type SalesOrderTraceAuditQuery = {
  salesOrderId?: string | null;
  orderNumber?: string | null;
  nfeNumber?: string | null;
  customer?: string | null;
  year?: number | null;
  month?: number | null;
  includeItems?: boolean;
};

export type SalesOrderTraceDataSource = {
  field: string;
  source: string;
  note?: string | null;
};

export type SalesOrderTraceNfe = {
  nfeExternalId: number;
  nfeNumber: string | null;
  nfeSerie: string | null;
  nfeStatus: number | null;
  dataProcessamento: string | null;
  nfeKey: string | null;
};

export type SalesOrderTraceItem = {
  salesOrderItemId: string;
  sku: string | null;
  productName: string | null;
  productId: string | null;
  quantity: number;
  soldUnitPrice: number | null;
  soldAmount: number;
  officialUnitCost: number | null;
  officialTotalCost: number | null;
  costSource: SalesOrderCostSource | null;
  costVersionCode: string | null;
  costVersionRevision: number | null;
  costEffectiveDate: string | null;
  marginAmount: number | null;
  marginPercent: number | null;
  publishedCommercialUnitPrice: number | null;
  publishedCommercialTableCode: string | null;
  nomusStoredUnitCost: number | null;
  marginStatus: string;
  notes: string[];
};

export type SalesOrderTraceAlert = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  context?: string | null;
};

export type SalesOrderTraceCommissionSnapshot = {
  snapshotId: string;
  sourceHash: string;
  saleDate: string;
  totalSoldAmount: number;
  canonicalSellerName: string | null;
  itemCount: number;
};

export type SalesOrderTraceAuditReport = {
  status: SalesOrderTraceAuditStatus;
  auditedAt: string;
  errorMessage?: string | null;
  order: {
    salesOrderId: string;
    orderNumber: string;
    customerId: string;
    customerName: string;
    rawSellerId: number | null;
    rawSellerName: string | null;
    canonicalSellerId: string | null;
    canonicalSellerName: string | null;
    sellerResolutionStatus: string | null;
    issueDate: string;
    totalNetValue: number;
    orderStatus: string;
  } | null;
  nfes: SalesOrderTraceNfe[];
  items: SalesOrderTraceItem[];
  totals: {
    totalSold: number;
    totalOfficialCost: number;
    totalMarginAmount: number;
    totalMarginPercent: number | null;
  };
  commissionSnapshot: SalesOrderTraceCommissionSnapshot | null;
  customerExcludedFromCommission: boolean;
  customerExclusionReason: string | null;
  alerts: SalesOrderTraceAlert[];
  dataSources: SalesOrderTraceDataSource[];
  checklist: Record<string, boolean | string>;
  costPolicyNote: string;
};

export function buildEmptySalesOrderTraceReport(errorMessage: string): SalesOrderTraceAuditReport {
  return {
    status: "FAIL",
    auditedAt: new Date().toISOString(),
    errorMessage,
    order: null,
    nfes: [],
    items: [],
    totals: {
      totalSold: 0,
      totalOfficialCost: 0,
      totalMarginAmount: 0,
      totalMarginPercent: null,
    },
    commissionSnapshot: null,
    customerExcludedFromCommission: false,
    customerExclusionReason: null,
    alerts: [],
    dataSources: [],
    checklist: {},
    costPolicyNote: SALES_ORDER_ITEM_UNIT_COST_IS_SALE_PRICE,
  };
}

export function roundMoney(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export function isForbiddenNomusCostSource(costSource: SalesOrderCostSource | null | undefined): boolean {
  return costSource === "SALES_ORDER_ITEM_SNAPSHOT";
}

export function isOfficialIndusCostSource(costSource: SalesOrderCostSource | null | undefined): boolean {
  return costSource === "VERSIONED_PRODUCTION_COST";
}

export function mapMarginPayloadToTraceItem(
  item: SalesOrderMarginItemResult,
  marginPayload: SalesOrderItemMarginPayload | undefined,
  nomusStoredUnitCost: number | null
): SalesOrderTraceItem {
  const commercial = marginPayload?.commercialReference ?? null;
  return {
    salesOrderItemId: item.salesOrderItemId ?? "",
    sku: item.productSku ?? null,
    productName: item.productName ?? null,
    productId: item.productId ?? null,
    quantity: item.quantity,
    soldUnitPrice: roundMoney(item.netUnitRevenue),
    soldAmount: roundMoney(item.netRevenue) ?? 0,
    officialUnitCost: roundMoney(item.unitCost),
    officialTotalCost: roundMoney(item.totalCost),
    costSource: item.costSource ?? null,
    costVersionCode: item.productionCost?.versionCode ?? null,
    costVersionRevision: item.productionCost?.revision ?? null,
    costEffectiveDate: item.productionCost?.effectiveDate ?? null,
    marginAmount: roundMoney(item.marginValue),
    marginPercent: item.marginPercent != null ? roundMoney(item.marginPercent) : null,
    publishedCommercialUnitPrice: roundMoney(commercial?.officialUnitPrice ?? null),
    publishedCommercialTableCode: commercial?.officialPrice?.priceTableCode ?? null,
    nomusStoredUnitCost,
    marginStatus: item.status,
    notes: [...(marginPayload?.notes ?? []), ...item.notes],
  };
}

export function buildSalesOrderTraceAlerts(input: {
  items: SalesOrderTraceItem[];
  sellerResolved: boolean;
  customerExcluded: boolean;
  customerExclusionReason: string | null;
}): SalesOrderTraceAlert[] {
  const alerts: SalesOrderTraceAlert[] = [];

  for (const item of input.items) {
    if (!item.productId || item.marginStatus === "SEM_PRODUTO_VINCULADO") {
      alerts.push({
        code: "ITEM_WITHOUT_PRODUCT_LINK",
        severity: "error",
        message: `Item sem vínculo de produto: ${item.sku ?? item.salesOrderItemId}`,
        context: "ITEM",
      });
    }

    if (item.marginStatus === "SEM_CUSTO" || item.officialUnitCost == null) {
      alerts.push({
        code: "MISSING_OFFICIAL_COST",
        severity: "warning",
        message: `Produto sem custo oficial vigente: ${item.sku ?? item.productId ?? "—"}`,
        context: "COST",
      });
    }

    if (isForbiddenNomusCostSource(item.costSource)) {
      alerts.push({
        code: "NOMUS_UNIT_COST_USED",
        severity: "error",
        message: `Custo industrial indevido via SalesOrderItem.unitCost (Nomus): ${item.sku ?? "—"}`,
        context: "COST",
      });
    }

    if (
      item.officialUnitCost != null &&
      item.soldUnitPrice != null &&
      item.soldUnitPrice < item.officialUnitCost
    ) {
      alerts.push({
        code: "SOLD_BELOW_COST",
        severity: "warning",
        message: `Preço vendido abaixo do custo oficial: ${item.sku ?? "—"}`,
        context: "PRICE",
      });
    }

    if (item.marginStatus === "MARGEM_NEGATIVA") {
      alerts.push({
        code: "NEGATIVE_MARGIN",
        severity: "warning",
        message: `Margem negativa no item: ${item.sku ?? "—"}`,
        context: "MARGIN",
      });
    }

    if (
      item.publishedCommercialUnitPrice != null &&
      item.soldUnitPrice != null &&
      item.soldUnitPrice < item.publishedCommercialUnitPrice - 0.0001
    ) {
      alerts.push({
        code: "SOLD_OUTSIDE_COMMERCIAL_TABLE",
        severity: "info",
        message: `Preço vendido abaixo da tabela comercial publicada: ${item.sku ?? "—"}`,
        context: "COMMERCIAL_PRICE",
      });
    }
  }

  if (!input.sellerResolved) {
    alerts.push({
      code: "SELLER_UNRESOLVED",
      severity: "warning",
      message: "Vendedor não resolvido para identidade canônica.",
      context: "SELLER",
    });
  }

  if (input.customerExcluded) {
    alerts.push({
      code: "CUSTOMER_COMMISSION_EXCLUDED",
      severity: "info",
      message:
        input.customerExclusionReason ??
        "Cliente excluído de comissão conforme regra vigente.",
      context: "COMMISSION",
    });
  }

  return alerts;
}

export function computeSalesOrderTraceTotals(
  items: SalesOrderTraceItem[],
  summary: SalesOrderMarginSummaryPayload | null
): SalesOrderTraceAuditReport["totals"] {
  if (summary) {
    return {
      totalSold: roundMoney(summary.netRevenue) ?? 0,
      totalOfficialCost: roundMoney(summary.totalCost) ?? 0,
      totalMarginAmount: roundMoney(summary.marginValue) ?? 0,
      totalMarginPercent: summary.marginPercent != null ? roundMoney(summary.marginPercent) : null,
    };
  }

  const totalSold = items.reduce((sum, row) => sum + (row.soldAmount ?? 0), 0);
  const totalOfficialCost = items.reduce((sum, row) => sum + (row.officialTotalCost ?? 0), 0);
  const totalMarginAmount = totalSold - totalOfficialCost;
  const totalMarginPercent =
    totalSold > 0 ? roundMoney((totalMarginAmount / totalSold) * 100) : null;

  return {
    totalSold: roundMoney(totalSold) ?? 0,
    totalOfficialCost: roundMoney(totalOfficialCost) ?? 0,
    totalMarginAmount: roundMoney(totalMarginAmount) ?? 0,
    totalMarginPercent,
  };
}

function escapeCsv(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cols: unknown[]): string {
  return cols.map(escapeCsv).join(",");
}

export function buildSalesOrderTraceCsv(report: SalesOrderTraceAuditReport): string {
  const lines: string[] = [];
  lines.push(csvLine(["section", "field", "value"]));
  lines.push(csvLine(["meta", "status", report.status]));
  lines.push(csvLine(["meta", "auditedAt", report.auditedAt]));

  if (report.order) {
    for (const [key, value] of Object.entries(report.order)) {
      lines.push(csvLine(["order", key, value]));
    }
  }

  for (const nfe of report.nfes) {
    lines.push(
      csvLine(["nfe", nfe.nfeNumber, nfe.nfeExternalId, nfe.nfeStatus, nfe.dataProcessamento])
    );
  }

  for (const item of report.items) {
    lines.push(
      csvLine([
        "item",
        item.sku,
        item.productName,
        item.quantity,
        item.soldUnitPrice,
        item.soldAmount,
        item.officialUnitCost,
        item.costVersionCode,
        item.marginAmount,
        item.marginPercent,
        item.publishedCommercialUnitPrice,
        item.costSource,
      ])
    );
  }

  for (const [key, value] of Object.entries(report.totals)) {
    lines.push(csvLine(["totals", key, value]));
  }

  for (const alert of report.alerts) {
    lines.push(csvLine(["alert", alert.code, alert.severity, alert.message]));
  }

  return `${lines.join("\n")}\n`;
}

export function formatSalesOrderTraceText(report: SalesOrderTraceAuditReport): string {
  const out: string[] = [];
  out.push("=== Auditoria — Rastreabilidade de venda / pedido Nomus ===\n");
  out.push(`Status: ${report.status}`);
  out.push(`Auditado em: ${report.auditedAt}`);
  out.push(`Política: ${report.costPolicyNote}`);

  if (report.errorMessage) {
    out.push(`\nErro: ${report.errorMessage}`);
    return out.join("\n");
  }

  if (report.order) {
    out.push(`\n--- Pedido ---`);
    out.push(`Número: ${report.order.orderNumber}`);
    out.push(`ID: ${report.order.salesOrderId}`);
    out.push(`Cliente: ${report.order.customerName}`);
    out.push(
      `Vendedor: raw=${report.order.rawSellerName ?? report.order.rawSellerId ?? "—"} | canônico=${report.order.canonicalSellerName ?? "—"}`
    );
    out.push(`Data: ${report.order.issueDate}`);
    out.push(`Valor total líquido: ${report.order.totalNetValue}`);
  }

  if (report.nfes.length > 0) {
    out.push(`\n--- NF (${report.nfes.length}) ---`);
    for (const nfe of report.nfes) {
      out.push(
        `  ${nfe.nfeNumber ?? "—"} | status=${nfe.nfeStatus ?? "—"} | data=${nfe.dataProcessamento ?? "—"}`
      );
    }
  }

  if (report.items.length > 0) {
    out.push(`\n--- Itens (${report.items.length}) ---`);
    for (const item of report.items) {
      out.push(
        `  ${item.sku ?? "—"} | qty=${item.quantity} | vendido=${item.soldUnitPrice} | custo=${item.officialUnitCost} (${item.costSource}) | margem=${item.marginAmount} (${item.marginPercent ?? "—"}%)`
      );
      if (item.costVersionCode) {
        out.push(`    versão custo: ${item.costVersionCode} rev.${item.costVersionRevision}`);
      }
      if (item.publishedCommercialUnitPrice != null) {
        out.push(
          `    preço tabela: ${item.publishedCommercialUnitPrice} (${item.publishedCommercialTableCode ?? "—"})`
        );
      }
    }
  }

  out.push(`\n--- Totais ---`);
  out.push(`Vendido: ${report.totals.totalSold}`);
  out.push(`Custo oficial: ${report.totals.totalOfficialCost}`);
  out.push(`Margem: ${report.totals.totalMarginAmount} (${report.totals.totalMarginPercent ?? "—"}%)`);

  if (report.commissionSnapshot) {
    out.push(`\n--- CommissionOrderSnapshot ---`);
    out.push(`ID: ${report.commissionSnapshot.snapshotId}`);
    out.push(`Hash: ${report.commissionSnapshot.sourceHash}`);
    out.push(`Itens materializados: ${report.commissionSnapshot.itemCount}`);
  }

  if (report.alerts.length > 0) {
    out.push(`\n--- Alertas (${report.alerts.length}) ---`);
    for (const alert of report.alerts) {
      out.push(`  [${alert.severity}] ${alert.code}: ${alert.message}`);
    }
  }

  out.push(`\n--- Fontes ---`);
  for (const ds of report.dataSources) {
    out.push(`  ${ds.field}: ${ds.source}${ds.note ? ` — ${ds.note}` : ""}`);
  }

  return out.join("\n");
}
