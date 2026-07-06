/**
 * Escopo COST_TO_CASH — relatório analisável end-to-end (MP → comissão liberada).
 * Read-only; reutiliza buildCostToCashTrace e traces existentes — sem recálculo indevido.
 */
import type { PrismaClient } from "@prisma/client";
import { startOfCivilDate } from "../financeCivilDate.js";
import {
  assembleCostToCashTrace,
  buildCostToCashTrace,
  buildCommissionTrace,
  buildSalesOrderTrace,
  type CostToCashTrace,
  type CostToCashTraceQuery,
} from "../audit/costToCashTrace.server.js";
import { resolvePublishedPriceItemIdForTrace } from "../audit/costToCashTraceResolve.server.js";
import type { TraceCalculationMode } from "../audit/traceCommon.js";
import type {
  DiagnosticEvidence,
  DiagnosticFinding,
  DiagnosticFindingSeverity,
  DiagnosticScopeContext,
  DiagnosticSourceRef,
} from "./chatgptDiagnosticTypes.js";
import {
  type BuildDiagnosticBundleInput,
  type BuildDiagnosticBundleResult,
  buildAndWriteDiagnosticBundle,
} from "./diagnosticBundleBuilder.server.js";
import {
  createDiagnosticSourceRef,
  createSourcedValue,
} from "./diagnosticSourceRefs.server.js";
import {
  sanitizeDiagnosticLogLines,
  sanitizeDiagnosticText,
} from "./sanitizeDiagnosticPayload.server.js";

export type CostToCashDiagnosticContext = {
  sku?: string | null;
  productId?: string | null;
  tableCode?: string | null;
  priceItemId?: string | null;
  salesOrderId?: string | null;
  orderNumber?: string | null;
  nfeNumber?: string | null;
  receivableCode?: string | null;
  year?: number | null;
  month?: number | null;
  seller?: string | null;
  customer?: string | null;
  referenceDate?: Date;
  errorMessage?: string | null;
  screenRoute?: string | null;
  screenTitle?: string | null;
  userId?: string | null;
  userEmail?: string | null;
};

export type CostToCashDiagnosticRequest = {
  scope: "COST_TO_CASH";
  context: CostToCashDiagnosticContext;
};

export type CostToCashAutoDiagnostic = {
  code: string;
  severity: DiagnosticFindingSeverity;
  title: string;
  message: string;
  hypothesis?: string | null;
};

export class CostToCashDiagnosticValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostToCashDiagnosticValidationError";
  }
}

const COST_TO_CASH_SCREEN_ROUTE = "/reports/cost-to-cash-trace";
const READ_ONLY_NOTE =
  "Valores lidos de snapshots publicados/materializados — modo PUBLISHED tem precedência sobre DIAGNOSTIC.";

export type CostToCashTimelineStepId =
  | "MATERIAL_COST"
  | "PRODUCT_COMPOSITION"
  | "OFFICIAL_COST"
  | "COMMERCIAL_PRICE"
  | "NOMUS_ORDER"
  | "SOLD_ITEM"
  | "REAL_MARGIN"
  | "COMMISSION_FORECAST"
  | "AR_RECEIVABLE"
  | "RECEIPT"
  | "COMMISSION_RELEASED"
  | "CLOSING";

export type CostToCashTimelineStepStatus = "FOUND" | "MISSING" | "PARTIAL" | "FAIL";

export type CostToCashTimelineStep = {
  order: number;
  id: CostToCashTimelineStepId;
  label: string;
  status: CostToCashTimelineStepStatus;
  summary: string | null;
  calculationMode: TraceCalculationMode | null;
  sourceRefs: DiagnosticSourceRef[];
};

export type CostToCashTimeline = {
  generatedAt: string;
  calculationMode: TraceCalculationMode;
  chainBreakDescription: string;
  completedSteps: number;
  totalSteps: number;
  steps: CostToCashTimelineStep[];
};

export function parseCostToCashDiagnosticRequest(body: unknown): CostToCashDiagnosticRequest {
  if (!body || typeof body !== "object") {
    throw new CostToCashDiagnosticValidationError("Corpo JSON inválido.");
  }
  const raw = body as Record<string, unknown>;
  const scope = String(raw.scope ?? "").trim().toUpperCase();
  if (scope !== "COST_TO_CASH") {
    throw new CostToCashDiagnosticValidationError('scope deve ser "COST_TO_CASH".');
  }
  const ctxRaw = raw.context;
  if (!ctxRaw || typeof ctxRaw !== "object") {
    throw new CostToCashDiagnosticValidationError("context é obrigatório.");
  }
  const ctx = ctxRaw as Record<string, unknown>;

  const yearRaw = ctx.year;
  const monthRaw = ctx.month;
  const year =
    yearRaw != null && yearRaw !== "" ? Number(yearRaw) : null;
  const month =
    monthRaw != null && monthRaw !== "" ? Number(monthRaw) : null;

  if (year != null && (!Number.isInteger(year) || year < 2000 || year > 2100)) {
    throw new CostToCashDiagnosticValidationError("context.year inválido.");
  }
  if (month != null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    throw new CostToCashDiagnosticValidationError("context.month inválido.");
  }

  const parsed: CostToCashDiagnosticContext = {
    sku: typeof ctx.sku === "string" ? ctx.sku.trim() || null : null,
    productId: typeof ctx.productId === "string" ? ctx.productId.trim() || null : null,
    tableCode: typeof ctx.tableCode === "string" ? ctx.tableCode.trim() || null : null,
    priceItemId: typeof ctx.priceItemId === "string" ? ctx.priceItemId.trim() || null : null,
    salesOrderId: typeof ctx.salesOrderId === "string" ? ctx.salesOrderId.trim() || null : null,
    orderNumber: typeof ctx.orderNumber === "string" ? ctx.orderNumber.trim() || null : null,
    nfeNumber: typeof ctx.nfeNumber === "string" ? ctx.nfeNumber.trim() || null : null,
    receivableCode:
      typeof ctx.receivableCode === "string" ? ctx.receivableCode.trim() || null : null,
    year,
    month,
    seller: typeof ctx.seller === "string" ? ctx.seller.trim() || null : null,
    customer: typeof ctx.customer === "string" ? ctx.customer.trim() || null : null,
    referenceDate:
      typeof ctx.referenceDate === "string" && ctx.referenceDate.trim()
        ? startOfCivilDate(new Date(ctx.referenceDate))
        : undefined,
    errorMessage:
      typeof ctx.errorMessage === "string" ? ctx.errorMessage.trim() || null : null,
    screenRoute:
      typeof ctx.screenRoute === "string" ? ctx.screenRoute.trim() || null : null,
    screenTitle:
      typeof ctx.screenTitle === "string" ? ctx.screenTitle.trim() || null : null,
    userId: typeof ctx.userId === "string" ? ctx.userId.trim() || null : null,
    userEmail: typeof ctx.userEmail === "string" ? ctx.userEmail.trim() || null : null,
  };

  if (!hasCostToCashDiagnosticQueryKey(parsed)) {
    throw new CostToCashDiagnosticValidationError(
      "Informe ao menos um identificador: sku, productId, priceItemId, salesOrderId, orderNumber, nfeNumber, receivableCode ou customer+year."
    );
  }

  return { scope: "COST_TO_CASH", context: parsed };
}

export function hasCostToCashDiagnosticQueryKey(ctx: CostToCashDiagnosticContext): boolean {
  return Boolean(
    ctx.sku?.trim() ||
      ctx.productId?.trim() ||
      ctx.priceItemId?.trim() ||
      ctx.salesOrderId?.trim() ||
      ctx.orderNumber?.trim() ||
      ctx.nfeNumber?.trim() ||
      ctx.receivableCode?.trim() ||
      (ctx.customer?.trim() && ctx.year != null)
  );
}

function sourceRef(
  input: Omit<DiagnosticSourceRef, "path"> & { path: string }
): DiagnosticSourceRef {
  return createDiagnosticSourceRef(input);
}

function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(6);
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(4)}%`;
}

function resolveSkuFilter(ctx: CostToCashDiagnosticContext, trace: CostToCashTrace): string | null {
  return (
    ctx.sku?.trim().toUpperCase() ??
    trace.product?.product?.sku?.trim().toUpperCase() ??
    trace.publishedPrice?.product.sku?.trim().toUpperCase() ??
    null
  );
}

function pickSalesItem(trace: CostToCashTrace, skuFilter: string | null) {
  const items = trace.salesOrder?.items ?? [];
  if (!items.length) return null;
  if (!skuFilter) return items[0] ?? null;
  return items.find((i) => i.sku?.trim().toUpperCase() === skuFilter) ?? items[0] ?? null;
}

function pickCommissionItem(trace: CostToCashTrace, skuFilter: string | null) {
  const items = trace.commission?.items ?? [];
  if (!items.length) return null;
  if (!skuFilter) return items[0] ?? null;
  return items.find((i) => i.sku?.trim().toUpperCase() === skuFilter) ?? items[0] ?? null;
}

export function describeCostToCashChainBreak(
  trace: CostToCashTrace,
  timeline: CostToCashTimelineStep[],
  context: CostToCashDiagnosticContext
): string {
  const missing = timeline.filter((s) => s.status === "MISSING" || s.status === "FAIL");
  if (missing.length === 0) {
    return "Trace completo: cadeia MP → produto → preço → venda → AR → recebimento → comissão liberada.";
  }

  const foundLabels: string[] = [];
  if (trace.product?.status === "PASS") foundLabels.push("produto");
  if (trace.publishedPrice) foundLabels.push("preço publicado");
  if (trace.salesOrder?.status === "PASS") foundLabels.push("pedido Nomus");
  if (trace.commission?.status === "PASS") foundLabels.push("comissão");
  if (trace.commission?.receipts?.length) foundLabels.push("recebimento");

  const firstMissing = missing[0];
  const period =
    context.year != null && context.month != null
      ? ` no período ${context.month}/${context.year}`
      : "";

  if (foundLabels.length === 0) {
    return `Trace parcial: nenhuma etapa principal encontrada${period}. Primeira lacuna: ${firstMissing?.label ?? "—"}.`;
  }

  const skuNote = context.sku?.trim()
    ? ` vinculada ao SKU ${context.sku.trim()}${period}`
    : period;

  if (
    trace.product?.status === "PASS" &&
    trace.publishedPrice &&
    !trace.salesOrder?.order
  ) {
    return `Trace parcial: produto e preço encontrados, mas nenhuma venda Nomus vinculada${skuNote}. Lacuna: ${firstMissing?.label ?? "pedido Nomus"}.`;
  }

  if (trace.salesOrder?.order && !trace.commission?.orderSnapshot.snapshotId) {
    return `Trace parcial: pedido encontrado (${trace.salesOrder.order.orderNumber}), mas snapshot de comissão ausente. Lacuna: ${firstMissing?.label ?? "comissão prevista"}.`;
  }

  return `Trace parcial: ${foundLabels.join(", ")} encontrados; lacuna em ${missing.map((m) => m.label).join(", ")}.`;
}

export function buildCostToCashTimeline(
  trace: CostToCashTrace,
  context: CostToCashDiagnosticContext
): CostToCashTimeline {
  const skuFilter = resolveSkuFilter(context, trace);
  const product = trace.product;
  const price = trace.publishedPrice;
  const sales = trace.salesOrder;
  const commission = trace.commission;
  const soldItem = pickSalesItem(trace, skuFilter);
  const commissionItem = pickCommissionItem(trace, skuFilter);
  const receivable = commission?.receivables?.[0] ?? null;
  const receipt = commission?.receipts?.[0] ?? null;

  const steps: CostToCashTimelineStep[] = [
    {
      order: 1,
      id: "MATERIAL_COST",
      label: "Custo de MP vigente",
      status:
        product?.officialVersion?.materialCostTableVersionId != null
          ? "FOUND"
          : product?.status === "PASS"
            ? "PARTIAL"
            : product
              ? "MISSING"
              : "MISSING",
      summary: product?.officialVersion?.materialCostTableVersionCode
        ? `${product.officialVersion.materialCostTableVersionCode} rev.${product.officialVersion.materialCostRevision ?? "—"} — MP ${fmtMoney(product.costBreakdown.materialCost)}`
        : null,
      calculationMode: product?.currentCost.officialPublishedCost != null ? "PUBLISHED" : "DIAGNOSTIC",
      sourceRefs: [
        sourceRef({
          type: "service",
          name: "buildProductCostTrace",
          path: "evidence/product-cost-trace.json#/officialVersion",
          table: "MaterialCostTableVersion",
          recordId: product?.officialVersion?.materialCostTableVersionId ?? null,
        }),
      ],
    },
    {
      order: 2,
      id: "PRODUCT_COMPOSITION",
      label: "Composição do produto (BOM)",
      status:
        product?.status === "PASS" &&
        (product.bom.componentCount > 0 || product.materials.materialCount > 0)
          ? "FOUND"
          : product?.status === "PASS"
            ? "PARTIAL"
            : "MISSING",
      summary: product
        ? `${product.bom.componentCount} componentes, ${product.materials.materialCount} materiais`
        : null,
      calculationMode: "DIAGNOSTIC",
      sourceRefs: [
        sourceRef({
          type: "service",
          name: "buildProductCostTrace",
          path: "evidence/product-cost-trace.json#/bom",
          recordId: product?.product?.productId ?? null,
        }),
      ],
    },
    {
      order: 3,
      id: "OFFICIAL_COST",
      label: "Custo oficial publicado",
      status:
        product?.currentCost.officialPublishedCost != null
          ? "FOUND"
          : product?.status === "PASS"
            ? "MISSING"
            : "MISSING",
      summary: product?.currentCost.officialPublishedCost != null
        ? `${fmtMoney(product.currentCost.officialPublishedCost)} (${product.officialVersion.versionCode ?? "—"} rev.${product.officialVersion.revision ?? "—"})`
        : product?.currentCost.engineeringCost != null
          ? `Somente diagnóstico engenharia: ${fmtMoney(product.currentCost.engineeringCost)}`
          : null,
      calculationMode:
        product?.currentCost.officialPublishedCost != null ? "PUBLISHED" : "DIAGNOSTIC",
      sourceRefs: [
        sourceRef({
          type: "service",
          name: "buildProductCostTrace",
          path: "evidence/product-cost-trace.json#/currentCost/officialPublishedCost",
          table: "ProductionCostTableVersion",
          recordId: product?.officialVersion.versionId ?? null,
        }),
      ],
    },
    {
      order: 4,
      id: "COMMERCIAL_PRICE",
      label: "Preço comercial publicado",
      status: price ? "FOUND" : "MISSING",
      summary: price
        ? `${price.commercialPrice.tableCode} v${price.commercialPrice.versionNumber} — ${fmtMoney(price.commercialPrice.salePrice)}`
        : null,
      calculationMode: "PUBLISHED",
      sourceRefs: [
        sourceRef({
          type: "service",
          name: "buildPublishedPriceTrace",
          path: "evidence/published-price-trace.json#/commercialPrice",
          table: "PriceTableItem",
          recordId: price?.commercialPrice.priceItemId ?? null,
        }),
      ],
    },
    {
      order: 5,
      id: "NOMUS_ORDER",
      label: "Pedido Nomus",
      status: sales?.order ? "FOUND" : sales?.status === "FAIL" ? "FAIL" : "MISSING",
      summary: sales?.order
        ? `${sales.order.orderNumber} — ${sales.order.customerName} (${sales.order.issueDate})`
        : sales?.errorMessage ?? null,
      calculationMode: "PUBLISHED",
      sourceRefs: [
        sourceRef({
          type: "service",
          name: "buildSalesOrderTrace",
          path: "evidence/sales-order-trace.json#/order",
          table: "SalesOrder",
          recordId: sales?.order?.salesOrderId ?? null,
        }),
      ],
    },
    {
      order: 6,
      id: "SOLD_ITEM",
      label: "Item vendido",
      status: soldItem ? "FOUND" : sales?.order ? "MISSING" : "MISSING",
      summary: soldItem
        ? `${soldItem.sku ?? "—"} qty ${soldItem.quantity} — vendido ${fmtMoney(soldItem.soldAmount)}`
        : null,
      calculationMode: "PUBLISHED",
      sourceRefs: [
        sourceRef({
          type: "service",
          name: "buildSalesOrderTrace",
          path: "evidence/sales-order-trace.json#/items",
          table: "SalesOrderItem",
          recordId: soldItem?.salesOrderItemId ?? null,
        }),
      ],
    },
    {
      order: 7,
      id: "REAL_MARGIN",
      label: "Margem real",
      status:
        soldItem?.marginPercent != null && soldItem.officialUnitCost != null
          ? "FOUND"
          : soldItem
            ? "PARTIAL"
            : "MISSING",
      summary: soldItem
        ? `${fmtPct(soldItem.marginPercent)} — custo Indus ${fmtMoney(soldItem.officialUnitCost)} (${soldItem.costSource ?? "—"})`
        : null,
      calculationMode: "PUBLISHED",
      sourceRefs: [
        sourceRef({
          type: "service",
          name: "buildSalesOrderTrace",
          path: "evidence/sales-order-trace.json#/items/marginPercent",
          recordId: soldItem?.salesOrderItemId ?? null,
          field: "marginPercent",
        }),
      ],
    },
    {
      order: 8,
      id: "COMMISSION_FORECAST",
      label: "Comissão prevista",
      status:
        commission?.orderSnapshot.snapshotId != null
          ? "FOUND"
          : commission?.status === "FAIL"
            ? "FAIL"
            : "MISSING",
      summary: commissionItem
        ? `${fmtMoney(commissionItem.finalCommissionAmount)} (${commissionItem.commissionRatePercent}%) — ${commissionItem.ruleName ?? commissionItem.ruleId ?? "—"}`
        : commission?.orderSnapshot.snapshotId
          ? `Total final ${fmtMoney(commission.orderSnapshot.totalFinalCommissionAmount)}`
          : commission?.errorMessage ?? null,
      calculationMode: commission?.orderSnapshot.snapshotId ? "PUBLISHED" : "DIAGNOSTIC",
      sourceRefs: [
        sourceRef({
          type: "service",
          name: "buildCommissionTrace",
          path: "evidence/commission-trace.json#/orderSnapshot",
          table: "CommissionOrderSnapshot",
          recordId: commission?.orderSnapshot.snapshotId ?? null,
        }),
      ],
    },
    {
      order: 9,
      id: "AR_RECEIVABLE",
      label: "Título AR (schedule)",
      status:
        receivable?.scheduleId != null
          ? "FOUND"
          : commission?.receivables?.length
            ? "PARTIAL"
            : commission?.orderSnapshot.snapshotId
              ? "MISSING"
              : "MISSING",
      summary: receivable
        ? `${receivable.receivableCode ?? receivable.receivableId ?? "—"} parcela ${receivable.installmentNumber ?? "—"} — ${fmtMoney(receivable.scheduledCommissionAmount)}`
        : null,
      calculationMode: "PUBLISHED",
      sourceRefs: [
        sourceRef({
          type: "service",
          name: "buildCommissionTrace",
          path: "evidence/commission-trace.json#/receivables",
          table: "CommissionReceivableSchedule",
          recordId: receivable?.scheduleId ?? null,
        }),
      ],
    },
    {
      order: 10,
      id: "RECEIPT",
      label: "Recebimento",
      status: receipt?.amountReceived != null && receipt.amountReceived > 0 ? "FOUND" : "MISSING",
      summary: receipt
        ? `${receivable?.receivableCode ?? receipt.receivableCode ?? "—"} — recebido ${fmtMoney(receipt.amountReceived)} em ${receipt.settlementDate ?? "—"}`
        : null,
      calculationMode: "PUBLISHED",
      sourceRefs: [
        sourceRef({
          type: "service",
          name: "buildCommissionTrace",
          path: "evidence/commission-trace.json#/receipts",
          table: "NomusReceivable",
          recordId: receipt?.receivableId != null ? String(receipt.receivableId) : null,
        }),
      ],
    },
    {
      order: 11,
      id: "COMMISSION_RELEASED",
      label: "Comissão liberada",
      status:
        (commission?.totals.totalReleasedCommission ?? 0) > 0
          ? "FOUND"
          : receipt?.amountReceived != null && receipt.amountReceived > 0
            ? "PARTIAL"
            : "MISSING",
      summary:
        commission != null
          ? `Liberada ${fmtMoney(commission.totals.totalReleasedCommission)} | Pendente ${fmtMoney(commission.totals.totalPendingCommission)}`
          : null,
      calculationMode: "PUBLISHED",
      sourceRefs: [
        sourceRef({
          type: "service",
          name: "buildCommissionTrace",
          path: "evidence/commission-trace.json#/totals/totalReleasedCommission",
        }),
      ],
    },
    {
      order: 12,
      id: "CLOSING",
      label: "Fechamento",
      status: commission?.closing ? "FOUND" : "MISSING",
      summary: commission?.closing
        ? `${commission.closing.year}/${commission.closing.month} — ${commission.closing.status}${commission.closing.isImmutable ? " (imutável)" : ""}`
        : "Sem fechamento materializado para o contexto.",
      calculationMode: "PUBLISHED",
      sourceRefs: [
        sourceRef({
          type: "service",
          name: "buildCommissionTrace",
          path: "evidence/commission-trace.json#/closing",
          table: "CommissionReceiptClosing",
          recordId: commission?.closing?.closingId ?? null,
        }),
      ],
    },
  ];

  const completedSteps = steps.filter((s) => s.status === "FOUND").length;
  const chainBreakDescription = describeCostToCashChainBreak(trace, steps, context);

  return {
    generatedAt: new Date().toISOString(),
    calculationMode: trace.calculationMode,
    chainBreakDescription,
    completedSteps,
    totalSteps: steps.length,
    steps,
  };
}

export function evaluateCostToCashAutoDiagnostics(
  trace: CostToCashTrace,
  timeline: CostToCashTimeline,
  priceResolveNote: string | null
): CostToCashAutoDiagnostic[] {
  const diagnostics: CostToCashAutoDiagnostic[] = [];
  const push = (diag: CostToCashAutoDiagnostic) => {
    if (!diagnostics.some((d) => d.code === diag.code)) diagnostics.push(diag);
  };

  const product = trace.product;
  const price = trace.publishedPrice;
  const sales = trace.salesOrder;
  const commission = trace.commission;

  if (
    !product?.officialVersion.versionId &&
    product?.status === "PASS"
  ) {
    push({
      code: "COST_SOURCE_MISSING",
      severity: "error",
      title: "Fonte de custo oficial ausente",
      message: "Produto sem ProductionCostTableVersion vigente publicada.",
    });
  }

  if (
    product?.status === "PASS" &&
    !product.officialVersion.materialCostTableVersionId
  ) {
    push({
      code: "MATERIAL_COST_MISSING",
      severity: "warning",
      title: "Tabela de MP não vinculada",
      message: "Custo de matéria-prima vigente não encontrado na versão oficial do produto.",
    });
  }

  for (const alert of product?.alerts ?? []) {
    if (alert.code === "COMPONENT_WITHOUT_COST") {
      push({
        code: "BOM_COMPONENT_MISSING_COST",
        severity: "warning",
        title: "Componente BOM sem custo",
        message: alert.message,
      });
    }
    if (alert.code === "MISSING_OFFICIAL_COST") {
      push({
        code: "COST_SOURCE_MISSING",
        severity: "error",
        title: "Custo oficial ausente",
        message: alert.message,
      });
    }
  }

  if (!price) {
    push({
      code: "PRICE_SOURCE_MISSING",
      severity: "warning",
      title: "Preço publicado não encontrado",
      message:
        priceResolveNote ??
        "Nenhum PriceTableItem vigente resolvido para o SKU/tabela informados.",
    });
  } else if (
    price.costSource.newerPublishedVersionWarning ||
    trace.diagnostics.some((d) => d.code === "NEWER_COST_VERSION" || d.code === "STALE_PUBLISHED_COST")
  ) {
    push({
      code: "NEWER_COST_THAN_PRICE",
      severity: "warning",
      title: "Custo mais recente que o congelado no preço",
      message:
        price.costSource.newerPublishedVersionWarning ??
        "Existe revisão de custo publicada posterior ao snapshot do preço.",
    });
  }

  for (const alert of sales?.alerts ?? []) {
    if (alert.code === "ITEM_WITHOUT_PRODUCT_LINK") {
      push({
        code: "SALES_ITEM_WITHOUT_PRODUCT_LINK",
        severity: "error",
        title: "Item de venda sem produto",
        message: alert.message,
      });
    }
    if (alert.code === "MISSING_OFFICIAL_COST") {
      push({
        code: "SALES_ITEM_WITHOUT_OFFICIAL_COST",
        severity: "error",
        title: "Item de venda sem custo oficial Indus",
        message: alert.message,
      });
    }
    if (alert.code === "NOMUS_UNIT_COST_USED") {
      push({
        code: "NOMUS_UNITCOST_NOT_USED_AS_INDUSTRIAL_COST",
        severity: "error",
        title: "Violação: unitCost Nomus usado como custo industrial",
        message:
          "SalesOrderItem.unitCost da Nomus foi usado como custo — deve usar custo oficial IndusCost.",
        hypothesis: alert.message,
      });
    }
  }

  if (
    sales?.items.some(
      (item) =>
        item.officialUnitCost != null &&
        item.costSource != null &&
        item.costSource !== "SALES_ORDER_ITEM_SNAPSHOT"
    ) &&
    !sales.alerts.some((a) => a.code === "NOMUS_UNIT_COST_USED")
  ) {
    push({
      code: "NOMUS_UNITCOST_NOT_USED_AS_INDUSTRIAL_COST",
      severity: "info",
      title: "Custo industrial correto",
      message:
        "Margem de venda usa custo oficial IndusCost — SalesOrderItem.unitCost Nomus não é custo industrial.",
    });
  }

  if (sales?.order && !commission?.orderSnapshot.snapshotId) {
    push({
      code: "COMMISSION_SNAPSHOT_MISSING",
      severity: "error",
      title: "Snapshot de comissão ausente",
      message: `Pedido ${sales.order.orderNumber} sem CommissionOrderSnapshot ACTIVE.`,
    });
  }

  for (const alert of commission?.alerts ?? []) {
    if (alert.code === "NO_ORDER_SNAPSHOT") {
      push({
        code: "COMMISSION_SNAPSHOT_MISSING",
        severity: "error",
        title: "Snapshot de comissão ausente",
        message: alert.message,
      });
    }
    if (alert.code === "NO_SCHEDULE") {
      push({
        code: "RECEIVABLE_SCHEDULE_MISSING",
        severity: "warning",
        title: "Schedule AR ausente",
        message: alert.message,
      });
    }
  }

  if (
    commission?.receipts.some(
      (r) => r.amountReceived > 0 && r.releasedCommissionAmount <= 0 && r.status !== "NO_SCHEDULE"
    )
  ) {
    push({
      code: "RECEIPT_WITHOUT_COMMISSION_RELEASE",
      severity: "warning",
      title: "Recebimento sem liberação de comissão",
      message: "Título recebido mas comissão liberada permanece zero.",
    });
  }

  if (commission?.closing?.isImmutable) {
    push({
      code: "CLOSED_COMMISSION_IMMUTABLE",
      severity: "info",
      title: "Fechamento imutável",
      message: `Fechamento ${commission.closing.year}/${commission.closing.month} congelado — alterações exigem estorno formal.`,
    });
  }

  const coreFound =
    timeline.steps.filter((s) =>
      ["MATERIAL_COST", "OFFICIAL_COST", "COMMERCIAL_PRICE", "NOMUS_ORDER", "COMMISSION_FORECAST"].includes(
        s.id
      )
    ).every((s) => s.status === "FOUND" || s.status === "PARTIAL") &&
    timeline.completedSteps >= 8;

  const hasErrors = diagnostics.some((d) => d.severity === "error");

  if (!hasErrors && timeline.completedSteps === timeline.totalSteps) {
    push({
      code: "TRACE_COMPLETE",
      severity: "info",
      title: "Rastreabilidade completa",
      message: timeline.chainBreakDescription,
    });
  } else if (coreFound && !hasErrors) {
    push({
      code: "TRACE_PARTIAL",
      severity: "info",
      title: "Rastreabilidade parcial",
      message: timeline.chainBreakDescription,
    });
  } else {
    push({
      code: "TRACE_PARTIAL",
      severity: timeline.completedSteps >= 4 ? "warning" : "error",
      title: "Cadeia quebrada",
      message: timeline.chainBreakDescription,
    });
  }

  return diagnostics;
}

export function buildCostToCashFindings(
  autoDiagnostics: CostToCashAutoDiagnostic[],
  timeline: CostToCashTimeline
): DiagnosticFinding[] {
  return autoDiagnostics.map((diag, index) => ({
    id: `ctc_finding_${String(index + 1).padStart(3, "0")}`,
    severity: diag.severity,
    code: diag.code,
    title: diag.title,
    message: diag.message,
    businessImpact:
      diag.code === "TRACE_COMPLETE"
        ? "Cadeia custo→caixa auditável de ponta a ponta."
        : diag.code === "TRACE_PARTIAL"
          ? "Diagnóstico limitado — verificar onde a cadeia quebrou antes de concluir margem/comissão."
          : diag.code === "NOMUS_UNITCOST_NOT_USED_AS_INDUSTRIAL_COST" && diag.severity === "error"
            ? "Margem e comissão podem estar calculadas sobre custo Nomus incorreto."
            : "Impacto na rastreabilidade financeira e comercial.",
    technicalImpact: diag.hypothesis ?? diag.message,
    evidenceRefs: [
      "evidence/cost-to-cash-timeline.json",
      "evidence/product-cost-trace.json",
      "evidence/published-price-trace.json",
      "evidence/sales-order-trace.json",
      "evidence/commission-trace.json",
      "10_CALCULATION_TRACE.json",
    ],
    sourceRefs: [
      sourceRef({
        type: "service",
        name: "buildCostToCashTrace",
        path: "evidence/cost-to-cash-timeline.json",
        field: diag.code,
      }),
    ],
    suggestedNextSteps: buildCostToCashSuggestedSteps(diag.code, timeline),
  }));
}

function buildCostToCashSuggestedSteps(code: string, timeline: CostToCashTimeline): string[] {
  switch (code) {
    case "PRICE_SOURCE_MISSING":
      return [
        "Informar tableCode ou publicar preço na tabela comercial vigente",
        "Regenerar bundle com --table-code=ATACADO ou equivalente",
      ];
    case "COMMISSION_SNAPSHOT_MISSING":
      return [
        "Materializar CommissionOrderSnapshot para o pedido",
        "Conferir sync Nomus e reprocessamento de comissão",
      ];
    case "RECEIVABLE_SCHEDULE_MISSING":
      return ["Verificar vínculo AR Nomus → CommissionReceivableSchedule"];
    case "NOMUS_UNITCOST_NOT_USED_AS_INDUSTRIAL_COST":
      return [
        "Conferir costPolicy em salesOrderMargin — deve usar VERSIONED_PRODUCTION_COST",
        "Republicar custo oficial se MISSING_OFFICIAL_COST",
      ];
    case "TRACE_PARTIAL":
      return [
        timeline.chainBreakDescription,
        "npx tsx scripts/generate-diagnostic-bundle.ts --scope=COST_TO_CASH --sku=...",
      ];
    default:
      return ["Anexar ZIP ao ChatGPT com CHATGPT_ANALYSIS_PROMPT.md"];
  }
}

export function buildCostToCashExecutiveSummaryMarkdown(
  trace: CostToCashTrace,
  timeline: CostToCashTimeline,
  context: CostToCashDiagnosticContext,
  autoDiagnostics: CostToCashAutoDiagnostic[]
): string {
  const sku =
    context.sku ??
    trace.product?.product?.sku ??
    trace.publishedPrice?.product.sku ??
    "—";

  return `# Resumo Executivo — Cost to Cash

## Identificação

| Campo | Valor |
| --- | --- |
| SKU | ${sku} |
| Modo de cálculo | **${trace.calculationMode}** |
| Etapas encontradas | ${timeline.completedSteps}/${timeline.totalSteps} |
| Status trace | ${trace.status} |

## Cadeia

${timeline.chainBreakDescription}

## Timeline (12 passos)

${timeline.steps.map((s) => `${s.order}. **${s.label}** — ${s.status}${s.summary ? `: ${s.summary}` : ""}`).join("\n")}

## Checklist de serviços

| Serviço | Presente |
| --- | --- |
| buildProductCostTrace | ${trace.product ? "sim" : "não"} |
| buildPublishedPriceTrace | ${trace.publishedPrice ? "sim" : "não"} |
| buildSalesOrderTrace | ${trace.salesOrder?.order ? "sim" : "não"} |
| buildCommissionTrace | ${trace.commission?.orderSnapshot.snapshotId ? "sim" : "não"} |
| buildCostToCashTrace | sim |

## Regra read-only

${READ_ONLY_NOTE}

## Diagnósticos automáticos

${
  autoDiagnostics.length
    ? autoDiagnostics.map((d) => `- **${d.code}** (${d.severity}): ${d.message}`).join("\n")
    : "- Nenhum"
}
`;
}

export function buildCostToCashProblemContextMarkdown(
  context: CostToCashDiagnosticContext,
  trace: CostToCashTrace,
  priceResolveNote: string | null
): string {
  return `# Contexto do Problema — Cost to Cash

## Filtros

\`\`\`json
${JSON.stringify(
  {
    sku: context.sku,
    productId: context.productId,
    tableCode: context.tableCode,
    salesOrderId: context.salesOrderId,
    orderNumber: context.orderNumber,
    nfeNumber: context.nfeNumber,
    receivableCode: context.receivableCode,
    year: context.year,
    month: context.month,
    seller: context.seller,
    customer: context.customer,
  },
  null,
  2
)}
\`\`\`

## Resolução de preço

${priceResolveNote ?? (trace.publishedPrice ? "priceItemId resolvido com sucesso." : "Preço não carregado.")}

## Erro reportado na tela

${context.errorMessage ?? trace.errorMessage ?? "Nenhum."}

## Modo

${READ_ONLY_NOTE}
`;
}

export function buildCostToCashCalculationTrace(
  trace: CostToCashTrace,
  timeline: CostToCashTimeline
): Record<string, unknown> {
  return {
    mode: "read-only",
    recalculatedInFrontend: false,
    publishedPriceRecalculated: false,
    commissionRecalculated: false,
    note: READ_ONLY_NOTE,
    calculationMode: trace.calculationMode,
    checklist: trace.checklist,
    chain: trace.chain,
    traceDiagnostics: trace.diagnostics,
    timeline: {
      completedSteps: timeline.completedSteps,
      totalSteps: timeline.totalSteps,
      chainBreakDescription: timeline.chainBreakDescription,
      steps: timeline.steps.map((s) => ({
        order: s.order,
        id: s.id,
        label: s.label,
        status: s.status,
        summary: s.summary,
        calculationMode: s.calculationMode,
      })),
    },
    services: [
      { name: "buildProductCostTrace", loaded: Boolean(trace.product) },
      { name: "buildPublishedPriceTrace", loaded: Boolean(trace.publishedPrice) },
      { name: "buildSalesOrderTrace", loaded: Boolean(trace.salesOrder?.order) },
      { name: "buildCommissionTrace", loaded: Boolean(trace.commission) },
      { name: "buildCostToCashTrace", loaded: true },
    ],
    industrialCostPolicy: {
      usesNomusUnitCostAsIndustrialCost: trace.salesOrder?.alerts.some(
        (a) => a.code === "NOMUS_UNIT_COST_USED"
      )
        ? true
        : false,
      note: "SalesOrderItem.unitCost Nomus NÃO é custo industrial — margem usa custo oficial IndusCost.",
    },
  };
}

export function buildCostToCashDatabaseEvidence(
  trace: CostToCashTrace,
  context: CostToCashDiagnosticContext
): Record<string, unknown> {
  const sku =
    context.sku ??
    trace.product?.product?.sku ??
    trace.publishedPrice?.product.sku ??
    null;

  return {
    scope: "COST_TO_CASH",
    readOnly: true,
    recalculated: false,
    sku: createSourcedValue(sku, {
      type: "database",
      name: "Product",
      path: "09_DATABASE_EVIDENCE.json#/sku",
      table: "Product",
      field: "sku",
    }),
    product: trace.product?.product ?? null,
    officialCost: trace.product?.currentCost.officialPublishedCost ?? null,
    publishedPrice: trace.publishedPrice?.commercialPrice ?? null,
    salesOrder: trace.salesOrder?.order ?? null,
    commissionSnapshot: trace.commission?.orderSnapshot ?? null,
    receivableCount: trace.commission?.receivables.length ?? 0,
    receiptCount: trace.commission?.receipts.length ?? 0,
    totalReleasedCommission: trace.commission?.totals.totalReleasedCommission ?? null,
    closing: trace.commission?.closing ?? null,
  };
}

export function buildCostToCashBusinessRulesMarkdown(): string {
  return `# Regras de Negócio — Cost to Cash

- Escopo: **COST_TO_CASH** — rastreabilidade MP → componente → BOM → produto → custo → preço → venda → NF → AR → comissão → recebimento → fechamento.
- **PUBLISHED** tem precedência: preço publicado, custo oficial publicado, snapshot de comissão materializado.
- **DIAGNOSTIC** apenas para comparação (engenharia ao vivo) — nunca substitui valores publicados.
- \`SalesOrderItem.unitCost\` da Nomus **não** é custo industrial.
- Comissão: snapshot → schedule por título → recebimento → ledger → fechamento imutável.

## Códigos de diagnóstico

| Código | Significado |
| --- | --- |
| TRACE_COMPLETE | Cadeia completa encontrada |
| TRACE_PARTIAL | Lacuna identificada — ver chainBreakDescription |
| COST_SOURCE_MISSING | Sem custo oficial publicado |
| MATERIAL_COST_MISSING | Tabela MP não vinculada |
| BOM_COMPONENT_MISSING_COST | Componente sem custo na BOM |
| PRICE_SOURCE_MISSING | Preço comercial não resolvido |
| NEWER_COST_THAN_PRICE | Custo mais novo que o congelado no preço |
| SALES_ITEM_WITHOUT_PRODUCT_LINK | Item de venda órfão |
| SALES_ITEM_WITHOUT_OFFICIAL_COST | Margem sem custo Indus |
| NOMUS_UNITCOST_NOT_USED_AS_INDUSTRIAL_COST | Confirma política correta ou violação |
| COMMISSION_SNAPSHOT_MISSING | Sem CommissionOrderSnapshot |
| RECEIVABLE_SCHEDULE_MISSING | Sem schedule AR |
| RECEIPT_WITHOUT_COMMISSION_RELEASE | Recebido sem liberar comissão |
| CLOSED_COMMISSION_IMMUTABLE | Fechamento congelado |
`;
}

export async function buildCostToCashTraceForDiagnostic(
  db: PrismaClient,
  context: CostToCashDiagnosticContext
): Promise<{ trace: CostToCashTrace; priceResolveNote: string | null }> {
  const referenceDate = context.referenceDate ?? startOfCivilDate(new Date());

  let priceItemId = context.priceItemId?.trim() ?? null;
  let priceResolveNote: string | null = null;

  if (!priceItemId && (context.sku?.trim() || context.productId?.trim())) {
    const resolved = await resolvePublishedPriceItemIdForTrace(db, {
      priceItemId: context.priceItemId,
      sku: context.sku,
      productId: context.productId,
      tableCode: context.tableCode,
      referenceDate,
    });
    priceItemId = resolved.priceItemId;
    priceResolveNote = resolved.errorMessage;
  }

  const query: CostToCashTraceQuery = {
    sku: context.sku,
    productId: context.productId,
    referenceDate,
    priceItemId,
    salesOrderId: context.salesOrderId,
    orderNumber: context.orderNumber,
    nfeNumber: context.nfeNumber,
    receivableCode: context.receivableCode,
    customer: context.customer,
    year: context.year,
    month: context.month,
    seller: context.seller,
  };

  let trace = await buildCostToCashTrace(db, query);

  const wantsCommissionByPeriod =
    !trace.commission?.orderSnapshot.snapshotId &&
    context.sku?.trim() &&
    context.year != null &&
    context.month != null;

  if (wantsCommissionByPeriod) {
    const commission = await buildCommissionTrace(db, {
      sku: context.sku!.trim(),
      year: context.year,
      month: context.month,
      seller: context.seller ?? null,
      salesOrderId: trace.salesOrder?.order?.salesOrderId ?? context.salesOrderId ?? null,
      orderNumber: trace.salesOrder?.order?.orderNumber ?? context.orderNumber ?? null,
      nfeNumber: context.nfeNumber ?? null,
      receivableCode: context.receivableCode ?? null,
      customer: context.customer ?? null,
      includeLines: true,
    });

    let salesOrder = trace.salesOrder;
    if (!salesOrder?.order && commission.sale?.salesOrderId) {
      salesOrder = await buildSalesOrderTrace(db, {
        salesOrderId: commission.sale.salesOrderId,
        includeItems: true,
      });
    }

    trace = assembleCostToCashTrace({
      product: trace.product,
      publishedPrice: trace.publishedPrice,
      salesOrder,
      commission,
      errorMessage: trace.errorMessage,
    });
  }

  return { trace, priceResolveNote };
}

export async function buildCostToCashDiagnosticBundleInput(
  db: PrismaClient,
  context: CostToCashDiagnosticContext
): Promise<BuildDiagnosticBundleInput> {
  const { trace, priceResolveNote } = await buildCostToCashTraceForDiagnostic(db, context);
  const timeline = buildCostToCashTimeline(trace, context);
  const autoDiagnostics = evaluateCostToCashAutoDiagnostics(trace, timeline, priceResolveNote);
  const findings = buildCostToCashFindings(autoDiagnostics, timeline);

  const sku =
    context.sku ??
    trace.product?.product?.sku ??
    trace.publishedPrice?.product.sku ??
    null;

  const scopeContext: DiagnosticScopeContext = {
    scope: "COST_TO_CASH",
    screenRoute: context.screenRoute ?? COST_TO_CASH_SCREEN_ROUTE,
    screenTitle: context.screenTitle ?? "Rastreabilidade Custo → Caixa",
    filters: {
      sku,
      productId: context.productId ?? trace.product?.product?.productId ?? null,
      tableCode: context.tableCode ?? trace.publishedPrice?.commercialPrice.tableCode ?? null,
      salesOrderId: context.salesOrderId ?? trace.salesOrder?.order?.salesOrderId ?? null,
      orderNumber: context.orderNumber ?? trace.salesOrder?.order?.orderNumber ?? null,
      nfeNumber: context.nfeNumber ?? null,
      receivableCode: context.receivableCode ?? null,
      year: context.year ?? null,
      month: context.month ?? null,
      seller: context.seller ?? null,
      customer: context.customer ?? null,
    },
    userId: context.userId ?? null,
    userEmail: context.userEmail ?? null,
    errorMessage: context.errorMessage ?? trace.errorMessage ?? null,
    notes: "Bundle COST_TO_CASH — traces read-only, sem recálculo indevido.",
  };

  const evidence: DiagnosticEvidence[] = [
    {
      id: "evidence_product_cost_trace",
      scope: "COST_TO_CASH",
      label: "Rastreabilidade de custo de produto",
      bundlePath: "evidence/product-cost-trace.json",
      payload: {
        scope: "COST_TO_CASH",
        readOnly: true,
        trace: trace.product,
        sourceRefs: [
          sourceRef({
            type: "service",
            name: "buildProductCostTrace",
            path: "evidence/product-cost-trace.json",
          }),
        ],
      },
    },
    {
      id: "evidence_published_price_trace",
      scope: "COST_TO_CASH",
      label: "Rastreabilidade de preço publicado",
      bundlePath: "evidence/published-price-trace.json",
      payload: {
        scope: "COST_TO_CASH",
        readOnly: true,
        trace: trace.publishedPrice,
        priceResolveNote,
        sourceRefs: [
          sourceRef({
            type: "service",
            name: "buildPublishedPriceTrace",
            path: "evidence/published-price-trace.json",
            recordId: trace.publishedPrice?.commercialPrice.priceItemId ?? null,
          }),
        ],
      },
    },
    {
      id: "evidence_sales_order_trace",
      scope: "COST_TO_CASH",
      label: "Rastreabilidade de pedido / venda Nomus",
      bundlePath: "evidence/sales-order-trace.json",
      payload: {
        scope: "COST_TO_CASH",
        readOnly: true,
        trace: trace.salesOrder,
        sourceRefs: [
          sourceRef({
            type: "service",
            name: "buildSalesOrderTrace",
            path: "evidence/sales-order-trace.json",
            recordId: trace.salesOrder?.order?.salesOrderId ?? null,
          }),
        ],
      },
    },
    {
      id: "evidence_commission_trace",
      scope: "COST_TO_CASH",
      label: "Rastreabilidade de comissão",
      bundlePath: "evidence/commission-trace.json",
      payload: {
        scope: "COST_TO_CASH",
        readOnly: true,
        trace: trace.commission,
        sourceRefs: [
          sourceRef({
            type: "service",
            name: "buildCommissionTrace",
            path: "evidence/commission-trace.json",
            recordId: trace.commission?.orderSnapshot.snapshotId ?? null,
          }),
        ],
      },
    },
    {
      id: "evidence_cost_to_cash_timeline",
      scope: "COST_TO_CASH",
      label: "Timeline Cost-to-Cash (12 passos)",
      bundlePath: "evidence/cost-to-cash-timeline.json",
      payload: {
        scope: "COST_TO_CASH",
        readOnly: true,
        timeline,
        autoDiagnostics,
        chainBreakDescription: timeline.chainBreakDescription,
        sourceRefs: [
          sourceRef({
            type: "service",
            name: "buildCostToCashTrace",
            path: "evidence/cost-to-cash-timeline.json",
          }),
        ],
      },
    },
  ];

  const logs = sanitizeDiagnosticLogLines([
    `[cost-to-cash] sku=${sku ?? "—"} mode=${trace.calculationMode}`,
    `[cost-to-cash] timeline=${timeline.completedSteps}/${timeline.totalSteps}`,
    `[cost-to-cash] chain=${sanitizeDiagnosticText(timeline.chainBreakDescription)}`,
    `[cost-to-cash] diagnostics=${autoDiagnostics.map((d) => d.code).join(",")}`,
    trace.errorMessage ? `[cost-to-cash] error=${sanitizeDiagnosticText(trace.errorMessage)}` : "",
  ].filter(Boolean));

  return {
    scope: "COST_TO_CASH",
    context: scopeContext,
    findings,
    evidence,
    executiveSummaryMarkdown: buildCostToCashExecutiveSummaryMarkdown(
      trace,
      timeline,
      context,
      autoDiagnostics
    ),
    problemContextMarkdown: buildCostToCashProblemContextMarkdown(context, trace, priceResolveNote),
    databaseEvidence: buildCostToCashDatabaseEvidence(trace, context),
    calculationTrace: buildCostToCashCalculationTrace(trace, timeline),
    businessRulesMarkdown: buildCostToCashBusinessRulesMarkdown(),
    logs,
    rawLimitedEvidence: {
      sku,
      calculationMode: trace.calculationMode,
      completedSteps: timeline.completedSteps,
      totalSteps: timeline.totalSteps,
      chainBreakDescription: timeline.chainBreakDescription,
      diagnosticCodes: autoDiagnostics.map((d) => d.code),
      hasProduct: Boolean(trace.product?.status === "PASS"),
      hasPrice: Boolean(trace.publishedPrice),
      hasSales: Boolean(trace.salesOrder?.order),
      hasCommission: Boolean(trace.commission?.orderSnapshot.snapshotId),
    },
    reproductionCommands: [
      {
        label: "Gerar bundle COST_TO_CASH",
        command: sku
          ? `npx tsx scripts/generate-diagnostic-bundle.ts --scope=COST_TO_CASH --sku=${sku}${context.tableCode ? ` --table-code=${context.tableCode}` : ""}`
          : "npx tsx scripts/generate-diagnostic-bundle.ts --scope=COST_TO_CASH --order-number=...",
        note: "Read-only; grava em tmp/diagnostic-bundles/",
      },
      {
        label: "Auditoria cost-to-cash (JSON)",
        command: sku
          ? `npx tsx scripts/audit-cost-to-cash-trace.ts --sku=${sku} --json`
          : "npx tsx scripts/audit-cost-to-cash-trace.ts --order-number=... --json",
      },
    ],
    systemSnapshot: {
      scope: "COST_TO_CASH",
      auditServicesUsed: [
        "buildCostToCashTrace",
        "buildProductCostTrace",
        "buildPublishedPriceTrace",
        "buildSalesOrderTrace",
        "buildCommissionTrace",
        "resolvePublishedPriceItemIdForTrace",
      ],
      readOnly: true,
      recalculated: false,
      calculationMode: trace.calculationMode,
      checklist: trace.checklist,
    },
  };
}

export async function buildAndWriteCostToCashDiagnosticBundle(
  db: PrismaClient,
  context: CostToCashDiagnosticContext
): Promise<BuildDiagnosticBundleResult> {
  const input = await buildCostToCashDiagnosticBundleInput(db, context);
  return buildAndWriteDiagnosticBundle(input);
}
