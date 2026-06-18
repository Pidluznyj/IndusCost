import { decimalToNumber } from "./executiveDashboardHelpers.js";
import {
  buildSalesOrderLifecycleSummary,
  type EnrichedLifecycleItem,
  type SalesOrderLifecycleInput,
} from "./salesOrderLifecycleStatus.js";
import { buildSalesOrderTimeline } from "./salesOrderLifecycleTimeline.js";
import type {
  SalesOrderItemNomusStatus,
  SalesOrderLifecycleSummary,
} from "./salesOrderLifecycleTypes.js";
import type { SalesOrderTimelineEvent } from "./salesOrderLifecycleTypes.js";
import {
  extractNomusProductionOrders,
  extractNomusRawNfes,
  parseNomusBrOrIsoDate,
  safeRatio,
} from "./salesOrderNomusRaw.js";

export type ProductionOrderSource = "model" | "nomus_raw" | "not_available";

export type SalesOrderIntelligenceRisk = {
  severity: "low" | "medium" | "high";
  code: string;
  title: string;
  description: string;
  suggestedAction: string;
};

export type SalesOrderIntelligenceAction = {
  priority: number;
  label: string;
  description: string;
  actionType:
    | "follow_up_customer"
    | "check_production"
    | "check_invoicing"
    | "check_delivery"
    | "review_data"
    | "none";
};

export type SalesOrderIntelligencePayload = {
  order: {
    id: string;
    number: string;
    customerName: string;
    customerTaxId?: string | null;
    issueDate?: string | null;
    expectedDeliveryDate?: string | null;
    totalNetValue: number;
    sellerName?: string | null;
    companyName?: string | null;
  };
  lifecycle: SalesOrderLifecycleSummary;
  timeline: SalesOrderTimelineEvent[];
  production: {
    hasLinkedProductionOrder: boolean;
    productionOrders: Array<{
      id?: string;
      number?: string;
      productCode?: string;
      productName?: string;
      status?: string;
      plannedQuantity?: number | null;
      producedQuantity?: number | null;
      pendingQuantity?: number | null;
      openedAt?: string | null;
      startedAt?: string | null;
      finishedAt?: string | null;
      dueDate?: string | null;
      isLate?: boolean;
      source: "model" | "nomus_raw" | "not_available";
    }>;
    dataQuality: {
      warnings: string[];
      source: "model" | "nomus_raw" | "not_available";
    };
  };
  invoicing: {
    hasInvoice: boolean;
    invoiceCount: number;
    invoiceNumbers: string[];
    firstInvoiceDate?: string | null;
    lastInvoiceDate?: string | null;
    invoicedAmount: number | null;
    invoicedPercent: number | null;
    invoiceTiming:
      | "before_due_date"
      | "on_due_date"
      | "after_due_date"
      | "no_due_date"
      | "not_invoiced"
      | "unknown";
  };
  items: Array<{
    id: string;
    productCode: string;
    productName: string;
    originalStatus?: string | null;
    normalizedStatus: SalesOrderItemNomusStatus;
    orderedQuantity: number;
    fulfilledQuantity?: number | null;
    invoicedQuantity?: number | null;
    pendingQuantity?: number | null;
    unit?: string | null;
    hasCut: boolean;
    isCancelled: boolean;
    isReturned: boolean;
    hasLinkedProductionOrder: boolean;
    linkedProductionOrderNumbers: string[];
  }>;
  risks: SalesOrderIntelligenceRisk[];
  suggestedActions: SalesOrderIntelligenceAction[];
  dataQuality: {
    warnings: string[];
    missingLinks: string[];
    sourceNotes: string[];
  };
};

const RISK_CATALOG: Record<
  string,
  Omit<SalesOrderIntelligenceRisk, "code"> & { severity: SalesOrderIntelligenceRisk["severity"] }
> = {
  overdue_without_invoice: {
    severity: "high",
    title: "Pedido atrasado sem NF",
    description: "O prazo de entrega venceu e ainda não há nota fiscal processada.",
    suggestedAction: "Verificar faturamento ou impedimento operacional.",
  },
  invoice_after_deadline: {
    severity: "high",
    title: "NF emitida após o prazo",
    description: "A nota fiscal foi processada depois da data prevista de entrega.",
    suggestedAction: "Revisar causa do faturamento fora do prazo.",
  },
  partial_fulfillment: {
    severity: "medium",
    title: "Pedido parcial",
    description: "O pedido possui atendimento ou faturamento parcial.",
    suggestedAction: "Acompanhar saldo pendente do pedido.",
  },
  cut_fulfillment: {
    severity: "high",
    title: "Pedido com corte",
    description: "Há itens atendidos com corte em relação ao pedido.",
    suggestedAction: "Validar corte com comercial/cliente.",
  },
  mixed_item_status: {
    severity: "medium",
    title: "Status mistos entre itens",
    description: "Os itens do pedido estão em estágios operacionais diferentes.",
    suggestedAction: "Revisar itens individualmente na aba Itens.",
  },
  returned_items: {
    severity: "medium",
    title: "Itens devolvidos",
    description: "O pedido possui devolução parcial ou total.",
    suggestedAction: "Conferir NF de devolução e impacto financeiro.",
  },
  missing_due_date: {
    severity: "low",
    title: "Sem previsão de entrega",
    description: "O pedido não possui data prevista de entrega.",
    suggestedAction: "Completar previsão no Nomus para monitorar prazo.",
  },
  missing_invoice_link: {
    severity: "high",
    title: "Dado divergente — entrega sem NF",
    description: "Há indício de entrega/envio sem nota fiscal processada.",
    suggestedAction: "Revisar dados do pedido no Nomus.",
  },
  unknown_item_status: {
    severity: "medium",
    title: "Dado divergente — status desconhecido",
    description: "Um ou mais itens possuem status Nomus não reconhecido.",
    suggestedAction: "Revisar dados do pedido no Nomus.",
  },
  missing_production_order: {
    severity: "medium",
    title: "Sem OP vinculada",
    description: "Nenhuma ordem de produção foi encontrada para este pedido.",
    suggestedAction: "Verificar abertura ou sincronização da OP.",
  },
  production_order_late: {
    severity: "high",
    title: "OP atrasada",
    description: "A ordem de produção vinculada está fora do prazo.",
    suggestedAction: "Cobrar produção.",
  },
  invoice_without_item_progress: {
    severity: "medium",
    title: "Dado divergente — NF sem avanço do item",
    description: "Existe NF processada, mas itens ainda aparecem apenas liberados.",
    suggestedAction: "Revisar dados do pedido no Nomus.",
  },
};

function resolveInvoiceTiming(
  lifecycle: SalesOrderLifecycleSummary
): SalesOrderIntelligencePayload["invoicing"]["invoiceTiming"] {
  if (!lifecycle.hasInvoice) return "not_invoiced";
  if (lifecycle.deadlineStatus === "no_due_date") return "no_due_date";
  if (lifecycle.deadlineStatus === "invoiced_early") return "before_due_date";
  if (lifecycle.deadlineStatus === "invoiced_on_time") return "on_due_date";
  if (lifecycle.deadlineStatus === "invoiced_late") return "after_due_date";
  return "unknown";
}

function collectRiskCodes(
  lifecycle: SalesOrderLifecycleSummary,
  items: EnrichedLifecycleItem[]
): string[] {
  const codes = new Set<string>(lifecycle.riskFlags);

  if (
    lifecycle.billingStatus === "partially_invoiced" ||
    lifecycle.completionStatus === "partial" ||
    (lifecycle.invoicedPercent != null && lifecycle.invoicedPercent < 99.5)
  ) {
    codes.add("partial_fulfillment");
  }

  if (
    lifecycle.hasInvoice &&
    items.length > 0 &&
    items.every((i) => i.normalizedStatus === "released")
  ) {
    codes.add("invoice_without_item_progress");
  }

  return [...codes];
}

function buildRisksFromCodes(codes: string[]): SalesOrderIntelligenceRisk[] {
  return codes
    .map((code) => {
      const meta = RISK_CATALOG[code];
      if (!meta) return null;
      return { code, ...meta };
    })
    .filter((r): r is SalesOrderIntelligenceRisk => r != null)
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.severity] - order[b.severity];
    });
}

export function buildSalesOrderRisksAndActions(input: {
  lifecycle: SalesOrderLifecycleSummary;
  items: EnrichedLifecycleItem[];
}): { risks: SalesOrderIntelligenceRisk[]; suggestedActions: SalesOrderIntelligenceAction[] } {
  const risks = buildRisksFromCodes(collectRiskCodes(input.lifecycle, input.items));
  const suggestedActions = buildSuggestedActions(risks, input.lifecycle);
  return { risks, suggestedActions };
}

function buildSuggestedActions(
  risks: SalesOrderIntelligenceRisk[],
  lifecycle: SalesOrderLifecycleSummary
): SalesOrderIntelligenceAction[] {
  const actions: SalesOrderIntelligenceAction[] = [];
  let priority = 1;
  for (const risk of risks) {
    if (risk.code === "partial_fulfillment") {
      actions.push({
        priority: priority++,
        label: "Acompanhar saldo pendente",
        description: risk.suggestedAction,
        actionType: "check_delivery",
      });
    } else if (risk.code.includes("production") || risk.code === "missing_production_order") {
      actions.push({
        priority: priority++,
        label: "Cobrar produção",
        description: risk.suggestedAction,
        actionType: "check_production",
      });
    } else if (
      risk.code.includes("invoice") ||
      risk.code === "overdue_without_invoice" ||
      risk.code === "missing_invoice_link"
    ) {
      actions.push({
        priority: priority++,
        label: "Validar faturamento",
        description: risk.suggestedAction,
        actionType: "check_invoicing",
      });
    } else if (
      risk.code === "missing_due_date" ||
      risk.code === "unknown_item_status" ||
      risk.code === "invoice_without_item_progress" ||
      risk.code === "mixed_item_status"
    ) {
      actions.push({
        priority: priority++,
        label: "Revisar dados do pedido",
        description: risk.suggestedAction,
        actionType: "review_data",
      });
    } else if (risk.code === "returned_items" || risk.code === "cut_fulfillment") {
      actions.push({
        priority: priority++,
        label: "Fazer follow-up com cliente",
        description: risk.suggestedAction,
        actionType: "follow_up_customer",
      });
    } else {
      actions.push({
        priority: priority++,
        label: "Confirmar entrega",
        description: risk.suggestedAction,
        actionType: "check_delivery",
      });
    }
  }
  if (actions.length === 0 && lifecycle.operationalStatus === "released") {
    actions.push({
      priority: 1,
      label: "Monitorar andamento",
      description: "Pedido liberado e dentro do fluxo operacional.",
      actionType: "none",
    });
  }
  return actions;
}

function mapProductionOrders(
  nomusRawResponse: unknown,
  referenceDate: Date
) {
  const rawOrders = extractNomusProductionOrders(nomusRawResponse);
  const source = rawOrders.length > 0 ? "nomus_raw" as const : "not_available" as const;
  const warnings =
    source === "not_available"
      ? ["OP não sincronizada/disponível para este pedido."]
      : [];

  const productionOrders = rawOrders.map((op) => {
    const planned = op.plannedQuantity;
    const produced = op.producedQuantity;
    const pending =
      planned != null && produced != null ? Math.max(0, planned - produced) : null;
    const due = parseNomusBrOrIsoDate(op.dueDate);
    const finished = parseNomusBrOrIsoDate(op.finishedAt);
    const isLate =
      due != null &&
      ((finished != null && finished.getTime() > due.getTime()) ||
        (finished == null && referenceDate.getTime() > due.getTime()));

    return {
      id: op.id,
      number: op.number,
      productCode: op.productCode,
      productName: op.productName,
      status: op.status,
      plannedQuantity: planned,
      producedQuantity: produced,
      pendingQuantity: pending,
      openedAt: op.openedAt,
      startedAt: op.startedAt,
      finishedAt: op.finishedAt,
      dueDate: op.dueDate,
      isLate,
      source: "nomus_raw" as const,
    };
  });

  return {
    hasLinkedProductionOrder: productionOrders.length > 0,
    productionOrders,
    dataQuality: { warnings, source },
  };
}

export function buildSalesOrderIntelligencePayload(input: {
  order: {
    id: string;
    orderCode: string;
    status: string;
    issueDate?: Date | string | null;
    expectedDeliveryDate?: Date | string | null;
    totalNetValue: unknown;
    responsible?: string | null;
    companyIssuer?: string | null;
    nomusRawResponse?: unknown;
    customer?: { companyName?: string | null; tradeName?: string | null; taxId?: string | null };
    items: Array<{
      id: string;
      externalProductId?: number | null;
      skuSnapshot?: string | null;
      productNameSnapshot?: string | null;
      quantity: unknown;
      unit?: string | null;
    }>;
  };
  referenceDate?: Date;
  requiresProduction?: boolean;
}): SalesOrderIntelligencePayload {
  const referenceDate = input.referenceDate ?? new Date();
  const lifecycleInput: SalesOrderLifecycleInput = {
    salesOrderId: input.order.id,
    salesOrderNumber: input.order.orderCode,
    originalStatus: input.order.status,
    issueDate: input.order.issueDate,
    expectedDeliveryDate: input.order.expectedDeliveryDate,
    nomusRawResponse: input.order.nomusRawResponse,
    items: input.order.items,
    referenceDate,
    requiresProduction: input.requiresProduction,
  };

  const { lifecycle, items } = buildSalesOrderLifecycleSummary(lifecycleInput);
  const timeline = buildSalesOrderTimeline({
    lifecycle,
    items,
    nomusRawResponse: input.order.nomusRawResponse,
    referenceDate,
    requiresProduction: input.requiresProduction,
  });
  const production = mapProductionOrders(input.order.nomusRawResponse, referenceDate);
  const nfes = extractNomusRawNfes(input.order.nomusRawResponse);
  const invoicedAmount = nfes.reduce((sum, nfe) => sum + (nfe.valor ?? 0), 0);
  const { risks, suggestedActions } = buildSalesOrderRisksAndActions({ lifecycle, items });

  const missingLinks: string[] = [];
  if (!lifecycle.hasInvoice) missingLinks.push("nota_fiscal");
  if (!production.hasLinkedProductionOrder) missingLinks.push("ordem_producao");

  const sourceNotes = [
    "Status original Nomus preservado; status gerencial é derivado.",
    "Fonte principal: SalesOrder + nomusRawResponse.itensPedido/nfes.",
    "OP extraída do nomusRawResponse quando disponível; sem modelo dedicado.",
  ];

  const warnings = [
    ...lifecycle.dataQuality.warnings,
    ...production.dataQuality.warnings,
  ];

  return {
    order: {
      id: input.order.id,
      number: input.order.orderCode,
      customerName:
        input.order.customer?.tradeName?.trim() ||
        input.order.customer?.companyName?.trim() ||
        "—",
      customerTaxId: input.order.customer?.taxId ?? null,
      issueDate: lifecycle.issueDate,
      expectedDeliveryDate: lifecycle.expectedDeliveryDate,
      totalNetValue: decimalToNumber(input.order.totalNetValue) ?? 0,
      sellerName: input.order.responsible ?? null,
      companyName: input.order.companyIssuer ?? null,
    },
    lifecycle,
    timeline,
    production,
    invoicing: {
      hasInvoice: lifecycle.hasInvoice,
      invoiceCount: lifecycle.invoiceNumbers.length,
      invoiceNumbers: lifecycle.invoiceNumbers,
      firstInvoiceDate: lifecycle.firstInvoiceDate,
      lastInvoiceDate: lifecycle.lastInvoiceDate,
      invoicedAmount: lifecycle.hasInvoice ? invoicedAmount || null : null,
      invoicedPercent: lifecycle.invoicedPercent,
      invoiceTiming: resolveInvoiceTiming(lifecycle),
    },
    items: items.map((item, index) => ({
      ...item,
      unit: input.order.items[index]?.unit ?? null,
      hasLinkedProductionOrder: item.linkedProductionOrderNumbers.length > 0,
    })),
    risks,
    suggestedActions,
    dataQuality: {
      warnings: [...new Set(warnings)],
      missingLinks,
      sourceNotes,
    },
  };
}

function resolveProductionOrderRowFields(
  nomusRawResponse: unknown | undefined,
  lifecycle: SalesOrderLifecycleSummary,
  referenceDate: Date
): { productionOrderStatus: string | null; productionOrderLabel: string | null } {
  if (!lifecycle.hasLinkedProductionOrder) {
    return { productionOrderStatus: null, productionOrderLabel: null };
  }
  const rawOrders = extractNomusProductionOrders(nomusRawResponse);
  const first = rawOrders[0];
  const status = first?.status?.trim() || null;
  if (lifecycle.productionOrderLate) {
    return { productionOrderStatus: status ?? "late", productionOrderLabel: "OP atrasada" };
  }
  const finished = parseNomusBrOrIsoDate(first?.finishedAt ?? null);
  if (finished) {
    return { productionOrderStatus: status ?? "finished", productionOrderLabel: "OP finalizada" };
  }
  const statusLower = (status ?? "").toLowerCase();
  if (statusLower.includes("produ") || statusLower.includes("andamento")) {
    return { productionOrderStatus: status, productionOrderLabel: "OP em produção" };
  }
  const due = parseNomusBrOrIsoDate(first?.dueDate ?? null);
  if (due && referenceDate.getTime() > due.getTime()) {
    return { productionOrderStatus: status, productionOrderLabel: "OP atrasada" };
  }
  return { productionOrderStatus: status, productionOrderLabel: "Com OP" };
}

export function mapLifecycleToManagementRow(
  order: {
    id: string;
    orderCode: string;
    issueDate: string;
    expectedDeliveryDate: string | null;
    totalNetValue: unknown;
    responsible: string | null;
    companyIssuer?: string | null;
    nomusRawResponse?: unknown;
    itemsCount?: number;
    Customer?: {
      companyName?: string | null;
      tradeName?: string | null;
      taxId?: string | null;
    };
  },
  lifecycle: SalesOrderLifecycleSummary,
  context?: {
    items?: EnrichedLifecycleItem[];
    referenceDate?: Date;
  }
) {
  const referenceDate = context?.referenceDate ?? new Date();
  const items = context?.items ?? [];
  const { risks, suggestedActions } = buildSalesOrderRisksAndActions({ lifecycle, items });
  const highRiskCount = risks.filter((r) => r.severity === "high").length;
  const productionFields = resolveProductionOrderRowFields(
    order.nomusRawResponse,
    lifecycle,
    referenceDate
  );

  return {
    id: order.id,
    number: order.orderCode,
    orderCode: order.orderCode,
    customerName:
      order.Customer?.tradeName?.trim() || order.Customer?.companyName?.trim() || "—",
    customerTaxId: order.Customer?.taxId ?? null,
    issueDate: order.issueDate,
    expectedDeliveryDate: order.expectedDeliveryDate,
    totalNetValue: decimalToNumber(order.totalNetValue) ?? 0,
    sellerName: order.responsible,
    companyName: order.companyIssuer ?? null,
    responsible: order.responsible,
    executiveStatusLabel: lifecycle.executiveStatusLabel,
    operationalStatus: lifecycle.operationalStatus,
    billingStatus: lifecycle.billingStatus,
    deadlineStatus: lifecycle.deadlineStatus,
    daysOverdue: lifecycle.daysOverdue,
    hasInvoice: lifecycle.hasInvoice,
    invoiceNumbers: lifecycle.invoiceNumbers,
    hasLinkedProductionOrder: lifecycle.hasLinkedProductionOrder,
    productionOrderLate: lifecycle.productionOrderLate,
    productionOrderStatus: productionFields.productionOrderStatus,
    productionOrderLabel: productionFields.productionOrderLabel,
    completionStatus: lifecycle.completionStatus,
    fulfilledPercent: lifecycle.fulfilledPercent,
    invoicedPercent: lifecycle.invoicedPercent,
    itemsCount: order.itemsCount ?? items.length,
    riskCount: risks.length,
    highRiskCount,
    riskFlags: lifecycle.riskFlags,
    suggestedActionLabel: suggestedActions[0]?.label ?? risks[0]?.title ?? null,
  };
}

export function isIntelligencePayloadFinite(payload: SalesOrderIntelligencePayload): boolean {
  const nums = [
    payload.order.totalNetValue,
    payload.invoicing.invoicedAmount,
    payload.invoicing.invoicedPercent,
    payload.lifecycle.fulfilledPercent,
    payload.lifecycle.invoicedPercent,
    payload.lifecycle.daysUntilDue,
    payload.lifecycle.daysOverdue,
    payload.lifecycle.daysInvoiceEarlyOrLate,
  ];
  return nums.every((n) => n == null || Number.isFinite(n));
}
