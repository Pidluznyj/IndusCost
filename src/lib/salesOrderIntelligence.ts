import { decimalToNumber } from "./executiveDashboardHelpers.js";
import { formatNfeProcessamentoDisplay } from "./salesOrderDeliveryDelay.js";
import {
  buildSalesOrderLifecycleSummary,
  type EnrichedLifecycleItem,
  type SalesOrderLifecycleInput,
} from "./salesOrderLifecycleStatus.js";
import type { SalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";
import { buildSalesOrderTimeline } from "./salesOrderLifecycleTimeline.js";
import type {
  SalesOrderItemNomusStatus,
  SalesOrderLifecycleSummary,
} from "./salesOrderLifecycleTypes.js";
import type { SalesOrderTimelineEvent } from "./salesOrderLifecycleTypes.js";
import {
  formatSalesOrderNomusSellerStatusLabel,
  resolveCrmCommercialResponsibleName,
  resolveSalesOrderNomusSellerStatus,
} from "./salesOrderNomusSeller.shared.js";
import {
  buildAuditMeta,
  buildIntelligenceInvoices,
  buildLifecycleRuleTrace,
  buildOrderAuditFields,
  buildRawDataPreview,
  enrichIntelligenceItems,
  type SalesOrderAuditRuleTraceEntry,
  type SalesOrderIntelligenceAuditMeta,
  type SalesOrderIntelligenceInvoice,
  type SalesOrderIntelligenceRawData,
} from "./salesOrderStatusAudit.js";
import type { RawItemMatchType } from "./salesOrderNomusRaw.js";
import type { SalesOrderItemStatusSource } from "./salesOrderStatusAudit.js";
import {
  extractNomusProductionOrders,
  extractNomusRawNfes,
  parseNomusBrOrIsoDate,
  safeRatio,
} from "./salesOrderNomusRaw.js";
import {
  buildSalesOrderLogisticStatus,
  compareLogisticToExecutiveStatus,
  type SalesOrderLogisticStatusResult,
} from "./salesOrderLogisticStatus.js";

export type { SalesOrderLogisticStatusResult } from "./salesOrderLogisticStatus.js";

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
    orderCode: string;
    externalSalesOrderId?: string | number | null;
    externalSalesOrderCode?: string | null;
    statusIndusCost: string;
    statusNomusRaw?: string | number | null;
    statusNomusLabel?: string | null;
    customerName: string;
    customerTaxId?: string | null;
    issueDate?: string | null;
    expectedDeliveryDate?: string | null;
    totalNetValue: number;
    sellerName?: string | null;
    companyName?: string | null;
  };
  lifecycle: SalesOrderLifecycleSummary & {
    ruleTrace: SalesOrderAuditRuleTraceEntry[];
    warnings: string[];
    suggestedActionLabel: string;
  };
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
      rawSummary?: Record<string, unknown>;
    }>;
    orders: Array<{
      number?: string | null;
      status?: string | null;
      plannedDate?: string | null;
      finishedDate?: string | null;
      quantity?: number | null;
      rawSummary?: Record<string, unknown>;
    }>;
    warnings: string[];
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
    linkedNfeSource?: "linked" | "raw_fallback" | null;
    isFullyInvoiced?: boolean;
    isPartiallyInvoiced?: boolean;
    slaStatus?: "on_time" | "late" | "pending" | "review" | null;
    slaDays?: number | null;
    daysLate?: number | null;
    needsDataReview?: boolean;
    reviewReasons?: string[];
  };
  invoices: SalesOrderIntelligenceInvoice[];
  items: Array<{
    id: string;
    itemNumber?: string | null;
    externalItemId?: string | number | null;
    productId?: string | null;
    externalProductId?: string | number | null;
    sku?: string | null;
    description?: string | null;
    productCode: string;
    productName: string;
    originalStatus?: string | null;
    normalizedStatus: SalesOrderItemNomusStatus;
    orderedQuantity: number;
    quantityOrdered: number;
    fulfilledQuantity?: number | null;
    quantityFulfilled?: number | null;
    invoicedQuantity?: number | null;
    quantityInvoiced?: number | null;
    quantityCancelled?: number | null;
    quantityReturned?: number | null;
    pendingQuantity?: number | null;
    unit?: string | null;
    hasCut: boolean;
    isCancelled: boolean;
    isReturned: boolean;
    hasLinkedProductionOrder: boolean;
    linkedProductionOrderNumbers: string[];
    statusRaw?: string | number | null;
    statusLabel?: string | null;
    statusNormalized: SalesOrderItemNomusStatus;
    statusSource: SalesOrderItemStatusSource;
    rawMatchedBy: RawItemMatchType;
    alerts: string[];
    rawSummary: Record<string, unknown>;
  }>;
  risks: SalesOrderIntelligenceRisk[];
  suggestedActions: SalesOrderIntelligenceAction[];
  rawData: SalesOrderIntelligenceRawData;
  audit: SalesOrderIntelligenceAuditMeta;
  logisticStatus: SalesOrderLogisticStatusResult;
  logisticVsExecutive: {
    diverges: boolean;
    message: string | null;
  };
  dataQuality: {
    warnings: string[];
    missingLinks: string[];
    sourceNotes: string[];
  };
  /** Status gerencial interno (secundário) para comparação no drawer. */
  managementCard: {
    executiveStatusLabel: string;
    expectedDeliveryDate?: string | null;
    firstInvoiceDate?: string | null;
    invoiceTiming: SalesOrderIntelligencePayload["invoicing"]["invoiceTiming"];
    itemsFulfilled: number;
    itemsCancelled: number;
    itemsWithCut: number;
    statusNomusRaw?: string | number | null;
  };
  linkedNfes: Array<{
    linkId: string;
    nfeExternalId: number;
    number: string | null;
    series: string | null;
    accessKey: string | null;
    status: number | null;
    processingDate: string | null;
    issueDate: string | null;
    totalValue: number;
    tipoOperacao: number | null;
    protocolo: string | null;
    usuario: string | null;
    dataSource: "linked" | "raw_fallback";
    nomusNfeMatched: boolean;
  }>;
  fulfillmentCalculation: {
    expectedDeliveryDate: string | null;
    completionDate: string | null;
    soldValue: number;
    invoicedValue: number;
    invoiceCoveragePercent: number | null;
    calculatedStatus: string;
    daysLate: number | null;
    slaDays: number | null;
    statusReason: string;
    reviewAlerts: string[];
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
  if (
    lifecycle.operationalStatus === "cancelled" ||
    lifecycle.operationalStatus === "fully_returned"
  ) {
    return [];
  }

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
  if (lifecycle.operationalStatus === "cancelled") {
    return [
      {
        priority: 1,
        label: "Nenhuma ação necessária",
        description: "Pedido cancelado.",
        actionType: "none",
      },
    ];
  }
  if (lifecycle.operationalStatus === "fully_returned") {
    return [
      {
        priority: 1,
        label: "Nenhuma ação necessária",
        description: "Pedido devolvido totalmente.",
        actionType: "none",
      },
    ];
  }

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
      rawSummary: {
        status: op.status,
        number: op.number,
        productCode: op.productCode,
      },
    };
  });

  const orders = productionOrders.map((op) => ({
    number: op.number ?? null,
    status: op.status ?? null,
    plannedDate: op.dueDate ?? op.openedAt ?? null,
    finishedDate: op.finishedAt ?? null,
    quantity: op.plannedQuantity ?? null,
    rawSummary: op.rawSummary,
  }));

  return {
    hasLinkedProductionOrder: productionOrders.length > 0,
    productionOrders,
    orders,
    warnings,
    dataQuality: { warnings, source },
  };
}

export function buildSalesOrderIntelligencePayload(input: {
  order: {
    id: string;
    orderCode: string;
    status: string;
    externalSalesOrderId?: number | null;
    externalSalesOrderCode?: string | null;
    issueDate?: Date | string | null;
    expectedDeliveryDate?: Date | string | null;
    totalNetValue: unknown;
    responsible?: string | null;
    nomusSellerName?: string | null;
    externalSellerId?: number | null;
    companyIssuer?: string | null;
    nomusRawResponse?: unknown;
    customer?: { companyName?: string | null; tradeName?: string | null; taxId?: string | null };
    items: Array<{
      id: string;
      productId?: string | null;
      externalProductId?: number | null;
      skuSnapshot?: string | null;
      productNameSnapshot?: string | null;
      quantity: unknown;
      unit?: string | null;
    }>;
  };
  referenceDate?: Date;
  requiresProduction?: boolean;
  linkedNfeContext?: SalesOrderLinkedNfeContext | null;
}): SalesOrderIntelligencePayload {
  const referenceDate = input.referenceDate ?? new Date();
  const lifecycleInput: SalesOrderLifecycleInput = {
    salesOrderId: input.order.id,
    salesOrderNumber: input.order.orderCode,
    originalStatus: input.order.status,
    issueDate: input.order.issueDate,
    expectedDeliveryDate: input.order.expectedDeliveryDate,
    totalNetValue: input.order.totalNetValue,
    nomusRawResponse: input.order.nomusRawResponse,
    linkedNfeContext: input.linkedNfeContext,
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

  const ruleTrace = buildLifecycleRuleTrace({
    lifecycle,
    items,
    hasInvoice: lifecycle.hasInvoice,
  });
  const invoices = buildIntelligenceInvoices(input.order.nomusRawResponse);
  const rawData = buildRawDataPreview(input.order.nomusRawResponse);
  const enrichedItems = enrichIntelligenceItems({
    items,
    dbItems: input.order.items,
    nomusRawResponse: input.order.nomusRawResponse,
  });
  const orderAudit = buildOrderAuditFields({
    statusIndusCost: input.order.status,
    externalSalesOrderId: input.order.externalSalesOrderId,
    externalSalesOrderCode: input.order.externalSalesOrderCode,
    nomusRawResponse: input.order.nomusRawResponse,
    lifecycle,
  });
  const audit = buildAuditMeta({
    nomusRawResponse: input.order.nomusRawResponse,
    lifecycle,
    productionWarnings: production.warnings,
    dataQualityWarnings: warnings,
  });

  const lifecycleWithAudit = {
    ...lifecycle,
    ruleTrace,
    warnings: [...new Set([...lifecycle.riskFlags, ...warnings])],
    suggestedActionLabel: suggestedActions[0]?.label ?? "Nenhuma ação sugerida",
  };

  const logisticStatus = buildSalesOrderLogisticStatus({
    expectedDeliveryDate: input.order.expectedDeliveryDate,
    nomusRawResponse: input.order.nomusRawResponse,
    referenceDate,
    linkedNfeContext: input.linkedNfeContext,
    totalNetValue: decimalToNumber(input.order.totalNetValue),
  });
  const logisticVsExecutive = compareLogisticToExecutiveStatus(
    logisticStatus,
    lifecycle.executiveStatusLabel
  );

  const invoiceTiming = resolveInvoiceTiming(lifecycle);

  const linkedNfeContext = input.linkedNfeContext ?? null;
  const linkedNfes =
    linkedNfeContext?.nfeLinks.map((link, index) => ({
      linkId: link.id,
      nfeExternalId: link.nfeExternalId,
      number: link.nfeNumber,
      series: null,
      accessKey: link.nfeKey,
      status: linkedNfeContext.nfeStatuses[index] ?? null,
      processingDate: linkedNfeContext.lastNfeProcessingDate?.toISOString() ?? null,
      issueDate: linkedNfeContext.lastNfeIssueDate?.toISOString() ?? null,
      totalValue:
        linkedNfeContext.nfeCount > 0
          ? linkedNfeContext.nfeTotalValue / linkedNfeContext.nfeCount
          : 0,
      tipoOperacao: linkedNfeContext.nfeTipoOperacao[index] ?? null,
      protocolo: null,
      usuario: null,
      dataSource: linkedNfeContext.source,
      nomusNfeMatched: !!link.nomusNfeId,
    })) ?? [];

  const fulfillmentCalculation = {
    expectedDeliveryDate: lifecycle.expectedDeliveryDate ?? null,
    completionDate: lifecycle.lastNfeProcessingDate ?? lifecycle.lastInvoiceDate ?? null,
    soldValue: decimalToNumber(input.order.totalNetValue) ?? 0,
    invoicedValue: lifecycle.nfeTotalValue ?? 0,
    invoiceCoveragePercent: lifecycle.invoiceCoveragePercent ?? lifecycle.invoicedPercent,
    calculatedStatus: logisticStatus.label,
    daysLate: lifecycle.daysLate ?? lifecycle.daysOverdue,
    slaDays: lifecycle.slaDays ?? lifecycle.daysToInvoice ?? null,
    statusReason: logisticStatus.ruleExplanation,
    reviewAlerts: lifecycle.reviewReasons ?? [],
  };

  return {
    order: {
      id: input.order.id,
      number: input.order.orderCode,
      ...orderAudit,
      customerName:
        input.order.customer?.tradeName?.trim() ||
        input.order.customer?.companyName?.trim() ||
        "—",
      customerTaxId: input.order.customer?.taxId ?? null,
      issueDate: lifecycle.issueDate,
      expectedDeliveryDate: lifecycle.expectedDeliveryDate,
      totalNetValue: decimalToNumber(input.order.totalNetValue) ?? 0,
      sellerName: input.order.nomusSellerName ?? null,
      companyName: input.order.companyIssuer ?? null,
    },
    lifecycle: lifecycleWithAudit,
    timeline,
    production,
    invoicing: {
      hasInvoice: lifecycle.hasInvoice,
      invoiceCount: lifecycle.nfeCount ?? lifecycle.invoiceNumbers.length,
      invoiceNumbers: lifecycle.nfeNumbers ?? lifecycle.invoiceNumbers,
      firstInvoiceDate: lifecycle.firstInvoiceDate,
      lastInvoiceDate: lifecycle.lastInvoiceDate ?? lifecycle.lastNfeProcessingDate ?? null,
      invoicedAmount: lifecycle.hasInvoice
        ? (lifecycle.nfeTotalValue ?? invoicedAmount ?? null)
        : null,
      invoicedPercent: lifecycle.invoiceCoveragePercent ?? lifecycle.invoicedPercent,
      invoiceTiming: resolveInvoiceTiming(lifecycle),
      linkedNfeSource: lifecycle.linkedNfeSource ?? null,
      isFullyInvoiced: lifecycle.isFullyInvoiced ?? false,
      isPartiallyInvoiced: lifecycle.isPartiallyInvoiced ?? false,
      slaStatus: lifecycle.slaStatus ?? null,
      slaDays: lifecycle.slaDays ?? null,
      daysLate: lifecycle.daysLate ?? lifecycle.daysOverdue,
      needsDataReview: lifecycle.needsDataReview ?? false,
      reviewReasons: lifecycle.reviewReasons ?? [],
    },
    invoices,
    items: enrichedItems.map((item, index) => ({
      ...item,
      unit: input.order.items[index]?.unit ?? null,
      hasLinkedProductionOrder: item.linkedProductionOrderNumbers.length > 0,
    })),
    risks,
    suggestedActions,
    rawData,
    audit,
    logisticStatus,
    logisticVsExecutive,
    managementCard: {
      executiveStatusLabel: lifecycle.executiveStatusLabel,
      expectedDeliveryDate: lifecycle.expectedDeliveryDate,
      firstInvoiceDate: lifecycle.firstInvoiceDate,
      invoiceTiming,
      itemsFulfilled: lifecycle.itemsFullyFulfilled + lifecycle.itemsDelivered + lifecycle.itemsShipped,
      itemsCancelled: lifecycle.itemsCancelled,
      itemsWithCut: lifecycle.itemsFulfilledWithCut,
      statusNomusRaw: orderAudit.statusNomusRaw,
    },
    dataQuality: {
      warnings: [...new Set(warnings)],
      missingLinks,
      sourceNotes,
    },
    linkedNfes,
    fulfillmentCalculation,
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
    nomusSellerName?: string | null;
    externalSellerId?: number | null;
    companyIssuer?: string | null;
    nomusRawResponse?: unknown;
    itemsCount?: number;
    Customer?: {
      companyName?: string | null;
      tradeName?: string | null;
      taxId?: string | null;
      CrmCustomerCommercialOwner?: {
        sellerCanonicalName?: string | null;
        sellerResponsibleName?: string | null;
        isActive?: boolean;
      } | null;
    };
  },
  lifecycle: SalesOrderLifecycleSummary,
  context?: {
    items?: EnrichedLifecycleItem[];
    referenceDate?: Date;
    linkedNfeContext?: SalesOrderLinkedNfeContext | null;
  }
) {
  const referenceDate = context?.referenceDate ?? new Date();
  const items = context?.items ?? [];
  const linkedNfeContext = context?.linkedNfeContext ?? null;
  const { risks, suggestedActions } = buildSalesOrderRisksAndActions({ lifecycle, items });
  const highRiskCount = risks.filter((r) => r.severity === "high").length;
  const productionFields = resolveProductionOrderRowFields(
    order.nomusRawResponse,
    lifecycle,
    referenceDate
  );
  const logistic = buildSalesOrderLogisticStatus({
    expectedDeliveryDate: order.expectedDeliveryDate,
    nomusRawResponse: order.nomusRawResponse,
    referenceDate,
    linkedNfeContext,
    totalNetValue: decimalToNumber(order.totalNetValue),
  });

  const nomusSellerStatus = resolveSalesOrderNomusSellerStatus({
    externalSellerId: order.externalSellerId ?? null,
    nomusSellerName: order.nomusSellerName ?? null,
  });

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
    crmCommercialResponsible: resolveCrmCommercialResponsibleName(
      order.Customer?.CrmCustomerCommercialOwner
    ),
    nomusSellerName: order.nomusSellerName?.trim() || null,
    nomusSellerStatus,
    nomusSellerStatusLabel: formatSalesOrderNomusSellerStatusLabel(nomusSellerStatus),
    sellerName: order.nomusSellerName?.trim() || null,
    companyName: order.companyIssuer ?? null,
    responsible: order.nomusSellerName?.trim() || null,
    executiveStatusLabel: lifecycle.executiveStatusLabel,
    logisticStatusCardId: logistic.cardId,
    logisticStatusLabel: logistic.label,
    operationalStatus: lifecycle.operationalStatus,
    billingStatus: lifecycle.billingStatus,
    deadlineStatus: lifecycle.deadlineStatus,
    daysOverdue: lifecycle.daysOverdue,
    hasInvoice: lifecycle.hasInvoice,
    invoiceNumbers: lifecycle.nfeNumbers ?? lifecycle.invoiceNumbers,
    lastInvoiceDate: lifecycle.lastNfeProcessingDate ?? lifecycle.lastInvoiceDate ?? null,
    nfeProcessingDisplay: formatNfeProcessamentoDisplay(
      lifecycle.lastNfeProcessingDate ?? lifecycle.lastInvoiceDate ?? null,
      (lifecycle.nfeCount ?? 0) > 0 || (lifecycle.nfeNumbers?.length ?? 0) > 0
    ),
    invoicedValue: lifecycle.nfeTotalValue ?? 0,
    invoiceCoveragePercent: lifecycle.invoiceCoveragePercent ?? lifecycle.invoicedPercent,
    nfeCount: lifecycle.nfeCount ?? lifecycle.invoiceNumbers.length,
    linkedNfeSource: lifecycle.linkedNfeSource,
    slaStatus: lifecycle.slaStatus ?? (lifecycle.needsDataReview ? "review" : "pending"),
    slaDays: lifecycle.slaDays ?? lifecycle.daysToInvoice ?? null,
    needsDataReview: lifecycle.needsDataReview ?? false,
    reviewReasons: lifecycle.reviewReasons ?? [],
    hasCut: lifecycle.hasCut ?? lifecycle.completionStatus === "with_cut",
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
