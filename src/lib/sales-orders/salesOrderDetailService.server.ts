/**
 * Service oficial do Detalhe do Pedido de Venda.
 *
 * Orquestra os motores oficiais e produz um DTO único
 * (`SalesOrderDetailPayload`) consumido por:
 *   - Modal `SalesOrderDetailDialog` (visão executiva parecida com o PDF).
 *   - Componente compartilhado `SalesOrderDetailView`.
 *   - PDF/impressão do detalhe (mesma composição de dados).
 *
 * Estratégia: reaproveita `getOrderFullAudit` (que já consome TODOS os
 * motores oficiais e é o orquestrador canônico da Auditoria 360º) e
 * projeta um DTO enxuto focado em "detalhe executivo do pedido".
 *
 * Motores oficiais consumidos (via `getOrderFullAudit`):
 *   - `SalesOrder` + `SalesOrderItem` (Prisma)
 *   - `salesOrderNomusSellerDisplay.buildSalesOrderNomusSellerDto`
 *   - `crmCustomerCommercialOwner.loadManualCommercialOwnersForCustomers`
 *   - `salesOrderLinkedNfe.loadSalesOrderLinkedNfeContextMap`
 *   - `salesOrderMarginService.calculateSalesOrderMarginsForOrders`
 *   - `NomusStockDocument` / `NomusStockDocumentItem`
 *   - `nomusSalesOrderItemStatus.parseNomusSalesOrderItemStatusFromRawItem`
 *
 * Motores oficiais consumidos diretamente:
 *   - `buildSalesOrderDetailFinancialFromAudit` → FIN-05
 *     (`salesOrderEffectiveFinancialSchedule`) — agenda financeira efetiva.
 *   - `resolveSalesOrderBillingStatus` (fonte única do status de faturamento).
 *   - `salesOrderBillingStatusLabel`.
 *   - `formatNomusItemStatusNormalized` (label PT-BR do status do item).
 *
 * Regras:
 *   - Read-only.
 *   - Não recalcula margem, NF ou billing — apenas compõe.
 *   - Financeiro do detalhe = motor canônico FIN-05 (não Pedido−CR).
 *   - Item cancelado nunca é reportado como pendente.
 *   - Status de faturamento sempre vem do `linkedNfe`, nunca do
 *     `SalesOrder.status` bruto.
 */
import type { PrismaClient } from "@prisma/client";
import {
  resolveSalesOrderBillingStatus,
  salesOrderBillingStatusLabel,
  type SalesOrderBillingStatus,
} from "../sales/salesOrderListBillingStatus.js";
import { formatNomusItemStatusNormalized } from "../finance/orderToCashAuditLabels.js";
import { getOrderFullAudit } from "../finance/orderFullAuditService.js";
import type {
  OrderFullAuditPayload,
  OrderFullAuditItem,
  OrderFullAuditNfe,
  OrderFullAuditStockDocument,
} from "../finance/orderFullAuditClient.js";
import { prisma as defaultPrisma } from "@/src/lib/prisma.js";
import { buildSalesOrderFiscalTaxesPayload } from "./salesOrderFiscalTaxes.server.js";
import { buildSalesOrderFiscalTaxesErrorPayload } from "./salesOrderFiscalTaxesContract.js";
import { canViewSalesOrderFiscalTaxesFromAuth } from "./salesOrderFiscalTaxesPermissions.js";
import { buildSalesOrderDetailFinancialFromAudit } from "./salesOrderDetailEffectiveFinancial.js";
import { loadSalesOrderDetailIndustrialResult } from "./salesOrderDetailIndustrialResult.server.js";
import { buildSalesOrderDetailIndustrialResultBlock } from "./salesOrderDetailIndustrialResult.js";
import type {
  SalesOrderDetailAlert,
  SalesOrderDetailFinancial,
  SalesOrderDetailHeader,
  SalesOrderDetailInvoice,
  SalesOrderDetailItem,
  SalesOrderDetailItemNfeLink,
  SalesOrderDetailPayload,
  SalesOrderDetailPricingMargin,
  SalesOrderDetailResponse,
  SalesOrderDetailStockDocument,
  SalesOrderDetailSummary,
} from "./salesOrderDetailClient.js";

const OPERATIONAL_STATUS_LABELS_PTBR: Record<string, string> = {
  DRAFT: "Rascunho",
  READY_TO_SEND: "Pronto para envio",
  SENT_TO_NOMUS: "Enviado ao Nomus",
  CANCELLED: "Cancelado",
  ERROR: "Erro",
};

function formatOperationalStatus(status: string | null | undefined): string {
  const trimmed = (status ?? "").trim();
  if (!trimmed) return "—";
  return OPERATIONAL_STATUS_LABELS_PTBR[trimmed] ?? trimmed;
}

function round2(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function safeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Mapeamentos (audit payload → detail DTO)
// ---------------------------------------------------------------------------

function mapHeader(audit: OrderFullAuditPayload): SalesOrderDetailHeader {
  const summary = audit.summary;
  const salesOrder = audit.salesOrder;
  const status = salesOrder.status ?? "";
  const billingStatus: SalesOrderBillingStatus = resolveSalesOrderBillingStatus({
    status,
    hasNfe: audit.nfes.length > 0,
    isPartiallyInvoiced: undefined,
    isFullyInvoiced: undefined,
  });
  const billingStatusLabel = salesOrderBillingStatusLabel(billingStatus);
  return {
    orderCode: salesOrder.orderCode ?? audit.orderCode ?? "",
    externalSalesOrderCode: salesOrder.identifiers.externalSalesOrderCode ?? null,
    status,
    statusLabel: formatOperationalStatus(status),
    billingStatus,
    billingStatusLabel,
    customerId: salesOrder.customer.id ?? null,
    customerName: summary.customerName ?? salesOrder.customer.name ?? "—",
    customerCnpj: salesOrder.customer.document ?? null,
    companyName: salesOrder.companyName ?? null,
    issueDate: summary.orderIssueDate ?? salesOrder.issueDate ?? null,
    expectedDeliveryDate:
      summary.orderExpectedDeliveryDate ?? salesOrder.expectedDeliveryDate ?? null,
    sellerName: summary.orderSellerName ?? salesOrder.orderSellerName ?? "—",
    sellerExternalId: salesOrder.orderSellerExternalId ?? null,
    commercialResponsibleName:
      summary.commercialResponsibleName ??
      salesOrder.commercialResponsibleName ??
      null,
    operationalResponsibleName: salesOrder.operationalResponsibleName ?? null,
    paymentConditionLabel:
      safeText(salesOrder.paymentTermsText) ?? safeText(salesOrder.paymentTerms) ?? "—",
    paymentMethodLabel: safeText(salesOrder.paymentMethod) ?? "—",
    freightCondition: salesOrder.freightCondition ?? null,
    deliveryLocation: salesOrder.deliveryLocation ?? null,
    notes: safeText(salesOrder.notes),
    internalNotes: safeText(salesOrder.internalNotes),
    sentToNomusAt: salesOrder.sentToNomusAt ?? null,
  };
}

function mapSummary(audit: OrderFullAuditPayload): SalesOrderDetailSummary {
  const s = audit.summary;
  const itemCounts = audit.salesOrder.itemCounts ?? {
    total: audit.items.length,
    active: 0,
    canceled: 0,
    cut: 0,
    stale: 0,
    fulfilled: 0,
    pendingActive: 0,
    fulfillmentPercentActive: 0,
  };
  const invoicedValue = round2(
    audit.nfes.reduce((sum, nfe) => sum + (nfe.allocatedValueToOrder ?? 0), 0)
  );
  const pendingBalance = Math.max(0, round2(s.activeOrderValue - invoicedValue));
  const nfeSorted = [...audit.nfes].sort((a, b) => {
    const da = a.dataProcessamento ?? a.dataEmissao ?? "";
    const db = b.dataProcessamento ?? b.dataEmissao ?? "";
    return db.localeCompare(da);
  });
  const lastNfeDate = nfeSorted[0]?.dataProcessamento ?? nfeSorted[0]?.dataEmissao ?? null;
  const activeValue = round2(s.activeOrderValue);
  const ticket =
    itemCounts.active > 0 ? round2(activeValue / itemCounts.active) : 0;
  const marginTotals = audit.marginPricing.totals;
  return {
    originalValue: round2(s.originalOrderValue),
    activeValue,
    canceledValue: round2(s.canceledOrderValue),
    cutValue: round2(s.cutOrderValue),
    invoicedValue,
    pendingBalance,
    itemsCount: itemCounts.total,
    activeItemsCount: itemCounts.active,
    canceledItemsCount: itemCounts.canceled,
    cutItemsCount: itemCounts.cut,
    ticket,
    hasInvoice: audit.nfes.length > 0,
    nfeCount: audit.nfes.length,
    lastNfeDate,
    marginValue: marginTotals.marginValue,
    marginPercent: marginTotals.marginPerc,
    invoiceCoveragePercent:
      s.activeOrderValue > 0 ? round2((invoicedValue / s.activeOrderValue) * 100) : null,
  };
}

function mapItem(
  item: OrderFullAuditItem,
  invoices: SalesOrderDetailInvoice[],
  marginByItemId: Map<
    string,
    { marginValue: number | null; marginPerc: number | null; status: string | null; totalCost: number | null; costSource: string | null }
  >,
  itemsByLinkedNfe: Map<string, number[]>
): SalesOrderDetailItem {
  const isCanceled = Boolean(item.nomusIsCanceled);
  const isCut = Boolean(item.nomusIsCut);
  const isStale = Boolean(item.nomusIsStale);
  const margin = marginByItemId.get(item.salesOrderItemId);
  const linkedNfeIds = item.linkedNfeExternalIds ?? [];
  const linkedNfes: SalesOrderDetailItemNfeLink[] = linkedNfeIds.length
    ? invoices
        .filter((inv) => linkedNfeIds.includes(inv.nfeExternalId))
        .map((inv) => ({
          nfeNumber: inv.numero,
          nfeExternalId: inv.nfeExternalId,
          documentNumber: inv.numero,
        }))
    : [];
  void itemsByLinkedNfe;

  const quantityOrdered = round2(item.quantity ?? 0);
  const totalValue = round2(item.totalNetValue ?? 0);
  const unitPrice = round2(
    item.unitPrice ??
      (quantityOrdered > 0 ? totalValue / quantityOrdered : 0)
  );
  const unitCost =
    margin?.totalCost != null && quantityOrdered > 0
      ? round2(margin.totalCost / quantityOrdered)
      : null;

  return {
    salesOrderItemId: item.salesOrderItemId,
    itemSequence: item.itemSequence != null ? Number(item.itemSequence) : null,
    sku: item.productCode ?? item.sku ?? "—",
    productName: item.productName ?? "—",
    unit: item.unit ?? null,
    quantityOrdered,
    quantityFulfilled: round2(item.nomusQuantityFulfilled ?? 0),
    quantityPending: round2(item.nomusQuantityPending ?? 0),
    quantityCanceled: round2(item.canceledQuantity ?? 0),
    quantityCut: round2(item.cutQuantity ?? 0),
    statusRaw: item.nomusItemStatusRaw ?? null,
    statusNormalized: item.nomusItemStatusNormalized ?? "UNKNOWN",
    statusLabel: formatNomusItemStatusNormalized(item.nomusItemStatusNormalized),
    isCanceled,
    isCut,
    isStale,
    unitPrice,
    totalValue,
    activeValue: round2(item.activeValue ?? 0),
    canceledValue: round2(item.canceledValue ?? 0),
    unitCost,
    marginValue: margin?.marginValue != null ? round2(margin.marginValue) : null,
    marginPercent: margin?.marginPerc != null ? round2(margin.marginPerc) : null,
    marginStatus: margin?.status ?? null,
    expectedDeliveryDate: item.expectedDeliveryDate ?? null,
    linkedNfes,
  };
}

function mapInvoices(nfes: OrderFullAuditNfe[]): SalesOrderDetailInvoice[] {
  return nfes.map((nfe) => ({
    nfeExternalId: nfe.nfeExternalId,
    numero: nfe.numero ?? null,
    serie: nfe.serie ?? null,
    chave: nfe.chave ?? null,
    dataProcessamento: nfe.dataProcessamento ?? null,
    dataEmissao: nfe.dataEmissao ?? null,
    valorTotal: nfe.valorTotal ?? null,
    valorLiquido: nfe.valorLiquido ?? null,
    allocatedValueToOrder: round2(nfe.allocatedValueToOrder),
    headerGreaterThanOrder: Boolean(nfe.headerGreaterThanOrder),
    hasExtraItems: Boolean(nfe.hasExtraItems),
    linkedStockDocumentExternalIds: nfe.linkedStockDocumentExternalIds ?? [],
  }));
}

function mapStockDocuments(
  docs: OrderFullAuditStockDocument[]
): SalesOrderDetailStockDocument[] {
  return docs.map((doc) => ({
    stockDocumentExternalId: doc.stockDocumentExternalId,
    numero:
      doc.documentNumber?.trim() || String(doc.stockDocumentExternalId),
    dataDocumento: doc.dataDocumento ?? null,
    valorTotal: doc.totalValue ?? null,
    allocatedValueToOrder: round2(doc.allocatedValue),
    hasExcess: Boolean(doc.hasExcess),
    hasOutside: Boolean(doc.hasOutside),
    idNfe: doc.idNfe ?? null,
  }));
}

function mapFinancial(audit: OrderFullAuditPayload): SalesOrderDetailFinancial {
  return buildSalesOrderDetailFinancialFromAudit(audit);
}

function mapPricingMargin(
  audit: OrderFullAuditPayload
): SalesOrderDetailPricingMargin {
  const totals = audit.marginPricing.totals;
  const counts = audit.marginPricing.counts;
  return {
    valueSold: round2(audit.summary.originalOrderValue),
    valueActive: round2(totals.totalNetRevenue ?? audit.summary.activeOrderValue),
    totalCost: totals.totalCost != null ? round2(totals.totalCost) : null,
    marginValue: totals.marginValue != null ? round2(totals.marginValue) : null,
    marginPercent: totals.marginPerc != null ? round2(totals.marginPerc) : null,
    itemsWithoutMargin: counts.noMarginItems ?? 0,
    itemsIgnored:
      (counts.canceledItems ?? 0) +
      (counts.cutItems ?? 0) +
      (counts.staleItems ?? 0),
    priceTableDiff:
      totals.priceOrderVsTableDelta != null
        ? round2(totals.priceOrderVsTableDelta)
        : null,
    orderVsDocumentDiff:
      totals.priceOrderVsDocumentDelta != null
        ? round2(totals.priceOrderVsDocumentDelta)
        : null,
    source: `salesOrderMarginService (${audit.marginPricing.source})`,
  };
}

function mapAlerts(audit: OrderFullAuditPayload): SalesOrderDetailAlert[] {
  // Detalhe do pedido mostra as divergências mais executivas primeiro
  // (financeiro + faturamento + itens); a lista completa por aba fica no
  // modal Auditoria 360º.
  const priority = new Set([
    "PLANNED_RECEIVABLE_WITHOUT_REAL_CR",
    "PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR",
    "PLANNED_RECEIVABLE_REPLACED_BY_REAL_CR",
    "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE",
    "ITEM_CLASSIFICATION_PENDING",
    "PLANNED_VS_CR_DUE_DATE_DIVERGENCE",
    "RECEIVABLE_OVERDUE",
    "RECEIVABLE_OPEN",
    "RECEIVABLE_WITHOUT_NFE",
    "NFE_HEADER_GREATER_THAN_ORDER",
    "NFE_WITHOUT_CR",
    "DOCUMENT_WITH_EXCESS",
    "DOCUMENT_EXTRA_ITEM",
    "DOCUMENT_PRICE_MISMATCH",
    "PROPOSAL_PRICE_MISMATCH",
    "ORDER_ITEM_CANCELED",
    "ORDER_ITEM_CUT",
    "ORDER_ITEM_STALE",
    "SELLER_NOT_INFORMED",
    "COMMERCIAL_RESPONSIBLE_MISSING",
    "OPERATIONAL_RESPONSIBLE_USED_AS_COMMERCIAL_RESPONSIBLE",
  ]);
  const filtered = audit.alerts.filter((a) => priority.has(a.code));
  return filtered.length > 0 ? filtered : audit.alerts.slice(0, 20);
}

// ---------------------------------------------------------------------------
// Loader público
// ---------------------------------------------------------------------------

export type GetSalesOrderDetailInput = {
  salesOrderId: string;
  orderCode?: string | null;
  userContext?: {
    userId?: string | null;
    permissions?: readonly string[] | null;
    effectivePermissions?: readonly string[] | null;
    role?: string | null;
  } | null;
};

/**
 * Retorna o DTO oficial do Detalhe do Pedido de Venda.
 *
 * Compatível com `PrismaClient` opcional (a passagem é para permitir mocks
 * em testes; internamente delega para `getOrderFullAudit`).
 */
export async function getSalesOrderDetail(
  input: GetSalesOrderDetailInput,
  prismaClient: PrismaClient = defaultPrisma
): Promise<SalesOrderDetailResponse> {
  const salesOrderId = input.salesOrderId?.trim();
  if (!salesOrderId) {
    return { ok: false, status: 400, error: "salesOrderId é obrigatório." };
  }

  const audit = await getOrderFullAudit({
    salesOrderId,
    orderCode: input.orderCode ?? null,
    userContext: input.userContext ?? null,
  });

  if (!("ok" in audit) || audit.ok !== true) {
    return {
      ok: false,
      status: audit.status ?? 500,
      error: audit.error ?? "Falha ao carregar detalhe do pedido.",
    };
  }

  const header = mapHeader(audit);
  const summary = mapSummary(audit);
  const invoices = mapInvoices(audit.nfes);
  const marginByItemId = new Map<
    string,
    {
      marginValue: number | null;
      marginPerc: number | null;
      status: string | null;
      totalCost: number | null;
      costSource: string | null;
    }
  >();
  for (const m of audit.marginPricing.itemMargins ?? []) {
    marginByItemId.set(m.salesOrderItemId, {
      marginValue: m.marginValue,
      marginPerc: m.marginPerc,
      status: m.status ?? null,
      totalCost: m.totalCost ?? null,
      costSource: m.costSource ?? null,
    });
  }
  const itemsByLinkedNfe = new Map<string, number[]>();
  const items = audit.items.map((item) =>
    mapItem(item, invoices, marginByItemId, itemsByLinkedNfe)
  );
  const stockDocuments = mapStockDocuments(audit.stockDocuments);
  const financial = mapFinancial(audit);
  const pricingMargin = mapPricingMargin(audit);
  const alerts = mapAlerts(audit);

  const allowFiscal = canViewSalesOrderFiscalTaxesFromAuth({
    permissions: input.userContext?.permissions ?? null,
    effectivePermissions: input.userContext?.effectivePermissions ?? null,
    role: input.userContext?.role ?? null,
  });
  let fiscalTaxes = allowFiscal ? (audit.fiscalTaxes ?? null) : null;
  if (allowFiscal && !fiscalTaxes) {
    try {
      fiscalTaxes = await buildSalesOrderFiscalTaxesPayload(prismaClient, audit);
    } catch (err) {
      console.error("getSalesOrderDetail fiscalTaxes", err);
      fiscalTaxes = buildSalesOrderFiscalTaxesErrorPayload(
        "Falha técnica ao montar tributos documentais.",
        { orderActiveValue: audit.summary.activeOrderValue ?? 0 }
      );
    }
  }

  let industrialResult = buildSalesOrderDetailIndustrialResultBlock({
    row: null,
    materials: [],
    extraWarnings: ["Custo/resultado industrial não carregado."],
  });
  try {
    industrialResult = await loadSalesOrderDetailIndustrialResult(
      prismaClient,
      salesOrderId
    );
  } catch (err) {
    console.error("getSalesOrderDetail industrialResult", err);
    industrialResult = buildSalesOrderDetailIndustrialResultBlock({
      row: null,
      materials: [],
      extraWarnings: [
        "Falha técnica ao montar custos industriais e resultado do pedido.",
      ],
    });
  }

  const now = new Date().toISOString();
  const payload: SalesOrderDetailPayload = {
    ok: true,
    salesOrderId: audit.salesOrderId,
    orderCode: audit.orderCode ?? header.orderCode,
    generatedAt: now,
    header,
    summary,
    items,
    invoices,
    stockDocuments,
    financial,
    pricingMargin,
    alerts,
    fiscalTaxes,
    fiscalTaxesAccess: allowFiscal ? "allowed" : "denied",
    industrialResult,
    technicalInfo: {
      sources: [
        "SalesOrder + SalesOrderItem (Prisma)",
        "salesOrderNomusSellerDisplay.buildSalesOrderNomusSellerDto",
        "crmCustomerCommercialOwner.loadManualCommercialOwnersForCustomers",
        "salesOrderLinkedNfe.loadSalesOrderLinkedNfeContextMap",
        "salesOrderListBillingStatus.resolveSalesOrderBillingStatus",
        "salesOrderMarginService.calculateSalesOrderMarginsForOrders",
        "salesOrderEffectiveFinancialSchedule (FIN-05) via salesOrderDetailEffectiveFinancial",
        "NomusAccountsReceivable (CR real)",
        "nomusSalesOrderItemStatus.parseNomusSalesOrderItemStatusFromRawItem",
        "NomusNfeFiscalSummary + NomusNfeTaxLine (aba Tributos)",
        "salesOrderIndustrialResultReport + productionCost calculationSnapshot (abas Custos/Resultado)",
      ],
      sourceTables: audit.technicalAudit.sourceTables ?? [],
      salesOrderId: audit.salesOrderId,
      orderCode: audit.orderCode ?? header.orderCode,
      generatedAt: now,
      runId: audit.runId ?? null,
    },
  };
  return payload;
}
