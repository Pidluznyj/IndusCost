/**
 * Serviço de Auditoria Completa do Pedido — composição read-only.
 *
 * Fontes:
 *   - `SalesOrder` + `Customer` + `SalesOrderItem` (grão linha, com flags Nomus)
 *   - `OrderToCashAuditFact` (evidência item × NF × documento × CR)
 *   - `NomusNfe` (deduplicação e cabeçalho oficial)
 *   - `NomusStockDocument` (documentos de saída)
 *   - `NomusAccountsReceivable` (títulos oficiais — não alterar)
 *   - `PortfolioReconciliationRow`-derived (não usado por padrão; a UI usa apenas o Fact)
 *
 * Regras oficiais respeitadas:
 *   - CR real do Nomus prevalece; deduplicado por `externalId`.
 *   - NF cabeçalho **não** infla carteira sem alerta.
 *   - Item cancelado / cortado / stale → separado em buckets próprios; não vira pendente.
 *   - Status do item é por **linha** do pedido, não por SKU (`SalesOrderItem.id`).
 *   - Nada é gravado nem alterado — read-only.
 */
import { prisma } from "@/src/lib/prisma.js";
import type { OrderToCashAuditFactRecord } from "./orderToCashAuditApi.js";
import { enrichFactsWithOrderItemStatus } from "./orderToCashFactItemStatusEnrichment.server.js";
import {
  isFulfilledWithCutSalesOrderItem,
  isInactiveSalesOrderItemNomusFlags,
} from "@/src/lib/sales/nomusSalesOrderItemStatus.js";

const MONEY_TOLERANCE = 0.01;

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && "toNumber" in (value as object)) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* ---------------------------------------------------------------------- */
/*  Types                                                                  */
/* ---------------------------------------------------------------------- */

export type OrderFullAuditItem = {
  salesOrderItemId: string;
  externalSalesOrderItemId: number | null;
  itemSequence: string | null;
  productCode: string | null;
  sku: string | null;
  productName: string | null;
  quantity: number | null;
  unitPrice: number | null;
  totalNetValue: number | null;
  nomusItemStatusRaw: string | null;
  nomusItemStatusNormalized: string | null;
  itemStatus: string | null;
  nomusIsCanceled: boolean;
  nomusIsCut: boolean;
  nomusIsStale: boolean;
  nomusQuantityFulfilled: number | null;
  nomusQuantityPending: number | null;
  matchConfidence: string | null;
};

export type OrderFullAuditReceivable = {
  receivableExternalId: number;
  companyName: string | null;
  personName: string | null;
  personCnpj: string | null;
  description: string | null;
  sourceInvoiceId: number | null;
  sourceInvoiceNumber: string | null;
  dueDate: string | null;
  competenceDate: string | null;
  scheduleDate: string | null;
  settlementDate: string | null;
  amountReceivable: number | null;
  amountReceived: number | null;
  balanceReceivable: number | null;
  paymentMethodName: string | null;
  bankAccountName: string | null;
  status:
    | "RECEIVED"
    | "PARTIALLY_RECEIVED"
    | "OVERDUE"
    | "OPEN"
    | "UNKNOWN";
  linkedNfeExternalIds: number[];
  origin: "NFE" | "SOURCE_INVOICE" | "INFERRED" | "UNKNOWN";
};

export type OrderFullAuditNfe = {
  nfeExternalId: number;
  numero: string | null;
  serie: string | null;
  chave: string | null;
  dataProcessamento: string | null;
  dataEmissao: string | null;
  status: number | null;
  tipoOperacao: number | null;
  valorLiquido: number | null;
  valorTotal: number | null;
  allocatedValueToOrder: number;
  headerGreaterThanOrder: boolean;
  hasReceivable: boolean;
  linkedStockDocumentExternalIds: number[];
};

export type OrderFullAuditStockDocument = {
  stockDocumentExternalId: number;
  tipoDocumentoEstoque: string | null;
  dataDocumento: string | null;
  idNfe: number | null;
  totalValue: number;
  allocatedValue: number;
  outsideOrderValue: number;
  quantityDocument: number;
  quantityUsedForOrder: number;
  excessQuantity: number;
  outsideOrderQuantity: number;
  hasExcess: boolean;
  hasOutside: boolean;
  productLines: number;
};

export type OrderFullAuditTimelinePoint = {
  key:
    | "ORDER_ISSUED"
    | "STOCK_DOCUMENT"
    | "NFE"
    | "RECEIVABLE"
    | "PAYMENT";
  label: string;
  date: string | null;
  detail: string | null;
  active: boolean;
};

export type OrderFullAuditAlert = {
  code: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  origin: string;
  action: string;
  financialImpact: number | null;
};

export type OrderFullAuditPayload = {
  ok: true;
  salesOrderId: string;
  orderCode: string | null;
  runId: string | null;
  summary: {
    orderCode: string | null;
    customerName: string | null;
    externalCustomerId: number | null;
    customerDocument: string | null;
    companyName: string | null;
    orderIssueDate: string | null;
    orderExpectedDeliveryDate: string | null;
    paymentTerms: string | null;
    paymentMethod: string | null;
    freightCondition: string | null;
    commercialResponsibleName: string | null;
    orderSellerName: string | null;
    operationalResponsibleArea: string | null;
    originalOrderValue: number;
    canceledOrderValue: number;
    cutOrderValue: number;
    activeOrderValue: number;
    allocatedOrderValue: number;
    pendingActiveOrderValue: number;
    fulfillmentPercentActive: number;
    receivableTotalValue: number;
    receivableOpenValue: number;
    receivableReceivedValue: number;
    operationalStage: string | null;
    financialStage: string | null;
    orderToCashStage: string | null;
    temperature: string | null;
    consolidatedStatus: string | null;
  };
  timeline: OrderFullAuditTimelinePoint[];
  items: OrderFullAuditItem[];
  itemFacts: OrderToCashAuditFactRecord[];
  receivables: OrderFullAuditReceivable[];
  receivablesTotal: {
    totalAmount: number;
    openAmount: number;
    receivedAmount: number;
    overdueCount: number;
    nextDueDate: string | null;
    maxAmount: number;
    totalCount: number;
  };
  stockDocuments: OrderFullAuditStockDocument[];
  nfes: OrderFullAuditNfe[];
  delivery: {
    expectedDeliveryDate: string | null;
    freightCondition: string | null;
    paymentTerms: string | null;
    paymentMethod: string | null;
    lastStockDocumentDate: string | null;
    lastNfeDate: string | null;
    lastReceivableSettlement: string | null;
  };
  alerts: OrderFullAuditAlert[];
};

/* ---------------------------------------------------------------------- */
/*  Service                                                                */
/* ---------------------------------------------------------------------- */

export type LoadOrderFullAuditInput = {
  salesOrderId: string;
  runId?: string | null;
};

export async function loadOrderFullAudit(
  input: LoadOrderFullAuditInput
): Promise<OrderFullAuditPayload | { ok: false; error: string; status: number }> {
  const salesOrderId = input.salesOrderId?.trim();
  if (!salesOrderId) {
    return { ok: false, status: 400, error: "salesOrderId é obrigatório." };
  }

  const order = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    include: {
      Customer: {
        select: {
          id: true,
          companyName: true,
          tradeName: true,
          taxId: true,
          externalCustomerId: true,
        },
      },
      items: {
        orderBy: { id: "asc" },
      },
      nfeLinks: true,
    },
  });
  if (!order) {
    return { ok: false, status: 404, error: "Pedido não encontrado." };
  }

  // Localiza a run mais recente que contenha esse pedido — se runId veio fixo, respeita.
  let resolvedRunId: string | null = input.runId?.trim() || null;
  if (!resolvedRunId) {
    const latest = await prisma.orderToCashAuditFact.findFirst({
      where: { salesOrderId },
      orderBy: [{ createdAt: "desc" }],
      select: { runId: true },
    });
    resolvedRunId = latest?.runId ?? null;
  }

  let facts: OrderToCashAuditFactRecord[] = [];
  try {
    const rawFacts = await prisma.orderToCashAuditFact.findMany({
      where: resolvedRunId
        ? { salesOrderId, runId: resolvedRunId }
        : { salesOrderId },
      orderBy: [{ orderItemSequence: "asc" }, { id: "asc" }],
    });
    facts = rawFacts.map((r) => normalizeFact(r as unknown as Record<string, unknown>));
    facts = (await enrichFactsWithOrderItemStatus(
      facts as unknown as Parameters<typeof enrichFactsWithOrderItemStatus>[0]
    )) as OrderToCashAuditFactRecord[];
  } catch (error) {
    console.warn(
      "[orderFullAuditService] falha ao carregar OrderToCashAuditFact — seguindo com dados básicos.",
      error
    );
  }

  const runId = facts[0]?.runId ?? resolvedRunId;

  const items: OrderFullAuditItem[] = order.items.map((item, index) => ({
    salesOrderItemId: item.id,
    externalSalesOrderItemId: item.nomusItemExternalId ?? null,
    itemSequence: item.nomusItemSequence ?? String(index + 1),
    productCode: item.skuSnapshot,
    sku: item.skuSnapshot,
    productName: item.productNameSnapshot,
    quantity: decimalToNumber(item.quantity),
    unitPrice: decimalToNumber(item.negotiatedPrice),
    totalNetValue: decimalToNumber(item.totalNetValue),
    nomusItemStatusRaw: item.nomusItemStatusRaw ?? null,
    nomusItemStatusNormalized: item.nomusItemStatusNormalized ?? null,
    itemStatus: item.nomusItemStatusNormalized ?? null,
    nomusIsCanceled: item.nomusIsCanceled === true,
    nomusIsCut: item.nomusIsCut === true,
    nomusIsStale: item.nomusIsStale === true,
    nomusQuantityFulfilled: decimalToNumber(item.nomusQuantityFulfilled),
    nomusQuantityPending: decimalToNumber(item.nomusQuantityPending),
    matchConfidence: item.nomusMatchConfidence ?? null,
  }));

  // Dedup NFes e stockDocs a partir dos facts + nfeLinks.
  const nfeMap = new Map<number, OrderFullAuditNfe>();
  const stockMap = new Map<number, OrderFullAuditStockDocument>();

  for (const link of order.nfeLinks) {
    if (link.nfeExternalId == null) continue;
    if (!nfeMap.has(link.nfeExternalId)) {
      nfeMap.set(link.nfeExternalId, {
        nfeExternalId: link.nfeExternalId,
        numero: link.nfeNumber ?? null,
        serie: link.nfeSerie ?? null,
        chave: link.nfeKey ?? null,
        dataProcessamento: toIso(link.dataProcessamento),
        dataEmissao: null,
        status: link.nfeStatus ?? null,
        tipoOperacao: link.tipoOperacao ?? null,
        valorLiquido: null,
        valorTotal: null,
        allocatedValueToOrder: 0,
        headerGreaterThanOrder: false,
        hasReceivable: false,
        linkedStockDocumentExternalIds: [],
      });
    }
  }

  for (const fact of facts) {
    if (fact.nfeNumber || fact.nfeHeaderValue != null) {
      // O fact traz nfeExternalId (na dsl) via join implícito — usar stockDocumentId como fallback.
    }
    if (fact.stockDocumentExternalId != null) {
      const cur = stockMap.get(fact.stockDocumentExternalId) ?? {
        stockDocumentExternalId: fact.stockDocumentExternalId,
        tipoDocumentoEstoque: null,
        dataDocumento: toIso(fact.stockDocumentDate),
        idNfe: null,
        totalValue: 0,
        allocatedValue: 0,
        outsideOrderValue: 0,
        quantityDocument: 0,
        quantityUsedForOrder: 0,
        excessQuantity: 0,
        outsideOrderQuantity: 0,
        hasExcess: false,
        hasOutside: false,
        productLines: 0,
      };
      cur.quantityDocument += fact.stockDocumentItemQuantity ?? 0;
      cur.quantityUsedForOrder += fact.quantityUsedForOrder ?? 0;
      cur.excessQuantity += fact.excessQuantity ?? 0;
      cur.outsideOrderQuantity += fact.outsideOrderQuantity ?? 0;
      cur.totalValue += fact.stockDocumentItemTotalValue ?? 0;
      cur.allocatedValue += fact.allocatedValueByDocumentPrice ?? 0;
      cur.outsideOrderValue +=
        (fact.outsideOrderQuantity ?? 0) *
        (fact.stockDocumentItemUnitValue ?? 0);
      cur.hasExcess = cur.hasExcess || (fact.excessQuantity ?? 0) > MONEY_TOLERANCE;
      cur.hasOutside = cur.hasOutside || (fact.outsideOrderQuantity ?? 0) > MONEY_TOLERANCE;
      cur.productLines += 1;
      stockMap.set(fact.stockDocumentExternalId, cur);
    }
  }

  // Aggregate NFe header per fact.
  for (const fact of facts) {
    const nfeNumber = fact.nfeNumber?.trim();
    if (!nfeNumber && fact.nfeHeaderValue == null) continue;
    // Try to locate by number in existing nfeMap
    let nfeEntry: OrderFullAuditNfe | undefined;
    if (nfeNumber) {
      for (const v of nfeMap.values()) {
        if (v.numero?.trim() === nfeNumber) {
          nfeEntry = v;
          break;
        }
      }
    }
    if (!nfeEntry && nfeNumber) {
      // Cria placeholder — sem externalId conhecido, usa hash negativo.
      const surrogate = -(nfeMap.size + 1);
      nfeEntry = {
        nfeExternalId: surrogate,
        numero: nfeNumber,
        serie: null,
        chave: null,
        dataProcessamento: null,
        dataEmissao: toIso(fact.nfeIssueDate),
        status: null,
        tipoOperacao: null,
        valorLiquido: fact.nfeHeaderValue ?? null,
        valorTotal: fact.nfeHeaderValue ?? null,
        allocatedValueToOrder: 0,
        headerGreaterThanOrder: false,
        hasReceivable: false,
        linkedStockDocumentExternalIds: [],
      };
      nfeMap.set(surrogate, nfeEntry);
    }
    if (nfeEntry) {
      nfeEntry.valorLiquido =
        nfeEntry.valorLiquido == null
          ? fact.nfeHeaderValue ?? null
          : Math.max(nfeEntry.valorLiquido, fact.nfeHeaderValue ?? 0);
      nfeEntry.valorTotal = nfeEntry.valorLiquido;
      nfeEntry.dataEmissao =
        nfeEntry.dataEmissao ?? toIso(fact.nfeIssueDate) ?? null;
      nfeEntry.allocatedValueToOrder +=
        fact.allocatedValueByOrderPrice ?? 0;
      if (fact.stockDocumentExternalId != null) {
        if (!nfeEntry.linkedStockDocumentExternalIds.includes(fact.stockDocumentExternalId)) {
          nfeEntry.linkedStockDocumentExternalIds.push(fact.stockDocumentExternalId);
        }
      }
      if (fact.hasNfeHeaderGreaterThanOrder) nfeEntry.headerGreaterThanOrder = true;
      if ((fact.receivableTotalValue ?? 0) > MONEY_TOLERANCE) nfeEntry.hasReceivable = true;
    }
  }

  // Complementa NF com dados oficiais (`NomusNfe`) e stock document (`NomusStockDocument`).
  const realNfeIds = [...nfeMap.keys()].filter((id) => id > 0);
  const stockIds = [...stockMap.keys()].filter((id) => id > 0);
  const [nfeRows, stockRows] = await Promise.all([
    realNfeIds.length > 0
      ? prisma.nomusNfe.findMany({
          where: { externalId: { in: realNfeIds } },
          select: {
            externalId: true,
            numero: true,
            serie: true,
            chave: true,
            status: true,
            tipoOperacao: true,
            dataProcessamento: true,
            xmlDhEmi: true,
            valorLiquido: true,
            xmlVNF: true,
          },
        })
      : Promise.resolve([]),
    stockIds.length > 0
      ? prisma.nomusStockDocument.findMany({
          where: { externalId: { in: stockIds } },
          select: {
            externalId: true,
            tipoDocumentoEstoque: true,
            dataDocumento: true,
            idNfe: true,
          },
        })
      : Promise.resolve([]),
  ]);
  for (const n of nfeRows) {
    const entry = nfeMap.get(n.externalId);
    if (!entry) continue;
    entry.numero = entry.numero ?? n.numero ?? null;
    entry.serie = entry.serie ?? n.serie ?? null;
    entry.chave = entry.chave ?? n.chave ?? null;
    entry.status = entry.status ?? n.status ?? null;
    entry.tipoOperacao = entry.tipoOperacao ?? n.tipoOperacao ?? null;
    entry.dataProcessamento = entry.dataProcessamento ?? toIso(n.dataProcessamento);
    entry.dataEmissao = entry.dataEmissao ?? toIso(n.xmlDhEmi);
    const nfeVal =
      decimalToNumber(n.valorLiquido) ?? decimalToNumber(n.xmlVNF);
    if (nfeVal != null) {
      entry.valorLiquido = entry.valorLiquido ?? nfeVal;
      entry.valorTotal = entry.valorTotal ?? nfeVal;
    }
  }
  for (const doc of stockRows) {
    const entry = stockMap.get(doc.externalId);
    if (!entry) continue;
    entry.tipoDocumentoEstoque = doc.tipoDocumentoEstoque ?? null;
    entry.dataDocumento = entry.dataDocumento ?? toIso(doc.dataDocumento);
    entry.idNfe = doc.idNfe ?? null;
  }

  // Recebíveis: por NF vinculada (sourceInvoiceId) — deduplicado por externalId.
  const nfeIdsForReceivables = [...nfeMap.keys()].filter((id) => id > 0);
  const receivables: OrderFullAuditReceivable[] = [];
  if (nfeIdsForReceivables.length > 0) {
    const arRows = await prisma.nomusAccountsReceivable.findMany({
      where: { sourceInvoiceId: { in: nfeIdsForReceivables } },
      select: {
        externalId: true,
        companyName: true,
        personName: true,
        personCnpj: true,
        description: true,
        sourceInvoiceId: true,
        sourceInvoiceNumber: true,
        dueDate: true,
        competenceDate: true,
        scheduleDate: true,
        settlementDate: true,
        amountReceivable: true,
        amountReceived: true,
        balanceReceivable: true,
        paymentMethodName: true,
        bankAccountName: true,
      },
    });
    const referenceDate = new Date();
    for (const r of arRows) {
      const amountReceivable = decimalToNumber(r.amountReceivable) ?? 0;
      const amountReceived = decimalToNumber(r.amountReceived) ?? 0;
      const balance =
        decimalToNumber(r.balanceReceivable) ??
        Math.max(0, amountReceivable - amountReceived);
      const isReceived =
        balance <= MONEY_TOLERANCE && amountReceived > MONEY_TOLERANCE;
      const isPartial =
        amountReceived > MONEY_TOLERANCE && balance > MONEY_TOLERANCE;
      const isOverdue =
        !isReceived &&
        balance > MONEY_TOLERANCE &&
        r.dueDate != null &&
        r.dueDate.getTime() < referenceDate.getTime();
      receivables.push({
        receivableExternalId: r.externalId,
        companyName: r.companyName ?? null,
        personName: r.personName ?? null,
        personCnpj: r.personCnpj ?? null,
        description: r.description ?? null,
        sourceInvoiceId: r.sourceInvoiceId ?? null,
        sourceInvoiceNumber: r.sourceInvoiceNumber ?? null,
        dueDate: toIso(r.dueDate),
        competenceDate: toIso(r.competenceDate),
        scheduleDate: toIso(r.scheduleDate),
        settlementDate: toIso(r.settlementDate),
        amountReceivable,
        amountReceived,
        balanceReceivable: balance,
        paymentMethodName: r.paymentMethodName ?? null,
        bankAccountName: r.bankAccountName ?? null,
        status: isReceived
          ? "RECEIVED"
          : isPartial
            ? "PARTIALLY_RECEIVED"
            : isOverdue
              ? "OVERDUE"
              : balance > MONEY_TOLERANCE
                ? "OPEN"
                : "UNKNOWN",
        linkedNfeExternalIds:
          r.sourceInvoiceId != null ? [r.sourceInvoiceId] : [],
        origin: r.sourceInvoiceId != null ? "SOURCE_INVOICE" : "UNKNOWN",
      });
    }
  }

  // Deduplica receivables por externalId (findMany já garante mas mantemos defesa).
  const dedupReceivables = [
    ...new Map(receivables.map((r) => [r.receivableExternalId, r])).values(),
  ];

  const summary = buildSummary({
    order,
    customer: order.Customer,
    items,
    facts,
    receivables: dedupReceivables,
  });

  const timeline = buildTimeline({
    orderIssueDate: order.issueDate,
    stockDocuments: [...stockMap.values()],
    nfes: [...nfeMap.values()],
    receivables: dedupReceivables,
  });

  const alerts = buildAlerts({
    order,
    items,
    facts,
    summary,
    receivables: dedupReceivables,
    stockDocuments: [...stockMap.values()],
    nfes: [...nfeMap.values()],
  });

  const receivablesTotal = summarizeReceivables(dedupReceivables);

  return {
    ok: true,
    salesOrderId,
    orderCode: order.orderCode ?? null,
    runId,
    summary,
    timeline,
    items,
    itemFacts: facts,
    receivables: dedupReceivables,
    receivablesTotal,
    stockDocuments: [...stockMap.values()].sort(
      (a, b) =>
        (a.dataDocumento ?? "").localeCompare(b.dataDocumento ?? "") ||
        a.stockDocumentExternalId - b.stockDocumentExternalId
    ),
    nfes: [...nfeMap.values()].sort(
      (a, b) =>
        (a.dataEmissao ?? a.dataProcessamento ?? "").localeCompare(
          b.dataEmissao ?? b.dataProcessamento ?? ""
        ) || a.nfeExternalId - b.nfeExternalId
    ),
    delivery: {
      expectedDeliveryDate: toIso(order.expectedDeliveryDate),
      freightCondition: order.freightCondition ?? null,
      paymentTerms: order.paymentTerms ?? null,
      paymentMethod: order.paymentMethod ?? null,
      lastStockDocumentDate: latestIso([...stockMap.values()].map((d) => d.dataDocumento)),
      lastNfeDate: latestIso([...nfeMap.values()].map((n) => n.dataEmissao ?? n.dataProcessamento)),
      lastReceivableSettlement: latestIso(dedupReceivables.map((r) => r.settlementDate)),
    },
    alerts,
  };
}

/* ---------------------------------------------------------------------- */
/*  Helpers                                                                */
/* ---------------------------------------------------------------------- */

function normalizeFact(raw: Record<string, unknown>): OrderToCashAuditFactRecord {
  return {
    id: String(raw.id),
    runId: String(raw.runId),
    orderCode: (raw.orderCode as string | null) ?? null,
    orderIssueDate: (raw.orderIssueDate as Date | string | null) ?? null,
    orderExpectedDeliveryDate: (raw.orderExpectedDeliveryDate as Date | string | null) ?? null,
    orderNetValue: decimalToNumber(raw.orderNetValue),
    customerId: (raw.customerId as string | null) ?? null,
    customerName: (raw.customerName as string | null) ?? null,
    externalCustomerId: (raw.externalCustomerId as number | null) ?? null,
    sellerName: (raw.sellerName as string | null) ?? null,
    sellerQualityStatus: (raw.sellerQualityStatus as string | null) ?? null,
    productCode: (raw.productCode as string | null) ?? null,
    sku: (raw.sku as string | null) ?? null,
    productName: (raw.productName as string | null) ?? null,
    lineType: (raw.lineType as string | null) ?? null,
    orderedQuantity: decimalToNumber(raw.orderedQuantity),
    orderUnitPrice: decimalToNumber(raw.orderUnitPrice),
    orderItemTotalValue: decimalToNumber(raw.orderItemTotalValue),
    stockDocumentId: (raw.stockDocumentId as string | null) ?? null,
    stockDocumentExternalId: (raw.stockDocumentExternalId as number | null) ?? null,
    stockDocumentDate: (raw.stockDocumentDate as Date | string | null) ?? null,
    stockDocumentItemQuantity: decimalToNumber(raw.stockDocumentItemQuantity),
    quantityUsedForOrder: decimalToNumber(raw.quantityUsedForOrder),
    excessQuantity: decimalToNumber(raw.excessQuantity),
    outsideOrderQuantity: decimalToNumber(raw.outsideOrderQuantity),
    allocatedValueByOrderPrice: decimalToNumber(raw.allocatedValueByOrderPrice),
    allocatedValueByDocumentPrice: decimalToNumber(raw.allocatedValueByDocumentPrice),
    stockDocumentItemUnitValue: decimalToNumber(raw.stockDocumentItemUnitValue),
    stockDocumentItemTotalValue: decimalToNumber(raw.stockDocumentItemTotalValue),
    nfeItemQuantity: decimalToNumber(raw.nfeItemQuantity),
    nfeItemUnitValue: decimalToNumber(raw.nfeItemUnitValue),
    nfeItemTotalValue: decimalToNumber(raw.nfeItemTotalValue),
    nfeNumber: (raw.nfeNumber as string | null) ?? null,
    nfeIssueDate: (raw.nfeIssueDate as Date | string | null) ?? null,
    nfeHeaderValue: decimalToNumber(raw.nfeHeaderValue),
    receivableTotalValue: decimalToNumber(raw.receivableTotalValue),
    receivableOpenValue: decimalToNumber(raw.receivableOpenValue),
    receivableReceivedValue: decimalToNumber(raw.receivableReceivedValue),
    paymentDueDate: (raw.paymentDueDate as Date | string | null) ?? null,
    paymentSettlementDate: (raw.paymentSettlementDate as Date | string | null) ?? null,
    paymentStatus: (raw.paymentStatus as string | null) ?? null,
    operationalStage: (raw.operationalStage as string | null) ?? null,
    financialStage: (raw.financialStage as string | null) ?? null,
    orderToCashStage: (raw.orderToCashStage as string | null) ?? null,
    temperature: (raw.temperature as string | null) ?? null,
    confidenceScore: decimalToNumber(raw.confidenceScore),
    confidenceLabel: (raw.confidenceLabel as string | null) ?? null,
    responsibleArea: (raw.responsibleArea as string | null) ?? null,
    recommendedAction: (raw.recommendedAction as string | null) ?? null,
    alertsJson: raw.alertsJson,
    hasDeliveryDelay: Boolean(raw.hasDeliveryDelay),
    hasMissingStockDocument: Boolean(raw.hasMissingStockDocument),
    hasPartialFulfillment: Boolean(raw.hasPartialFulfillment),
    hasFullFulfillment: Boolean(raw.hasFullFulfillment),
    hasExcessQuantity: Boolean(raw.hasExcessQuantity),
    hasProductOutsideOrder: Boolean(raw.hasProductOutsideOrder),
    hasNfeHeaderGreaterThanOrder: Boolean(raw.hasNfeHeaderGreaterThanOrder),
    hasPriceMismatch: Boolean(raw.hasPriceMismatch),
    hasDocumentWithoutReceivable: Boolean(raw.hasDocumentWithoutReceivable),
    hasOverdueReceivable: Boolean(raw.hasOverdueReceivable),
    salesOrderId: (raw.salesOrderId as string | null) ?? null,
    salesOrderItemId: (raw.salesOrderItemId as string | null) ?? null,
    orderItemStatus: (raw.orderItemStatus as string | null) ?? null,
    blockingReasonsJson: raw.blockingReasonsJson,
  };
}

function latestIso(dates: (string | null)[]): string | null {
  const valid = dates.filter((d): d is string => Boolean(d));
  if (valid.length === 0) return null;
  return valid.sort().at(-1) ?? null;
}

function buildSummary(input: {
  order: Awaited<ReturnType<typeof prisma.salesOrder.findUnique>>;
  customer: { companyName: string; tradeName: string | null; taxId: string | null; externalCustomerId: number | null } | null;
  items: OrderFullAuditItem[];
  facts: OrderToCashAuditFactRecord[];
  receivables: OrderFullAuditReceivable[];
}): OrderFullAuditPayload["summary"] {
  const order = input.order;
  const orderNetValue = decimalToNumber(order?.totalNetValue) ?? 0;
  const canceledValue = round2(
    input.items
      .filter((i) => isInactiveSalesOrderItemNomusFlags({
        nomusIsCanceled: i.nomusIsCanceled,
        nomusIsStale: i.nomusIsStale,
        nomusItemStatusNormalized: i.nomusItemStatusNormalized,
      }))
      .reduce((s, i) => s + (i.totalNetValue ?? 0), 0)
  );
  const cutValue = round2(
    input.items
      .filter((i) =>
        isFulfilledWithCutSalesOrderItem({
          nomusIsCut: i.nomusIsCut,
          nomusItemStatusNormalized: i.nomusItemStatusNormalized,
        })
      )
      .reduce((s, i) => s + (i.totalNetValue ?? 0), 0)
  );
  const activeValue = round2(Math.max(0, orderNetValue - canceledValue - cutValue));
  const allocated = round2(
    Math.min(
      activeValue,
      input.facts.reduce(
        (s, f) => s + Math.max(0, f.allocatedValueByOrderPrice ?? 0),
        0
      )
    )
  );
  const pendingActive = round2(Math.max(0, activeValue - allocated));
  const receivableTotal = round2(
    input.receivables.reduce((s, r) => s + r.amountReceivable, 0)
  );
  const receivableOpen = round2(
    input.receivables.reduce((s, r) => s + r.balanceReceivable, 0)
  );
  const receivableReceived = round2(
    input.receivables.reduce((s, r) => s + r.amountReceived, 0)
  );

  const dominant = input.facts.reduce<Record<string, number>>((acc, f) => {
    if (f.orderToCashStage) acc[f.orderToCashStage] = (acc[f.orderToCashStage] ?? 0) + 1;
    return acc;
  }, {});
  const consolidatedStatus =
    Object.entries(dominant).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    orderCode: order?.orderCode ?? null,
    customerName: input.customer?.tradeName ?? input.customer?.companyName ?? null,
    externalCustomerId: input.customer?.externalCustomerId ?? null,
    customerDocument: input.customer?.taxId ?? null,
    companyName: order?.companyIssuer ?? null,
    orderIssueDate: toIso(order?.issueDate),
    orderExpectedDeliveryDate: toIso(order?.expectedDeliveryDate),
    paymentTerms: order?.paymentTerms ?? null,
    paymentMethod: order?.paymentMethod ?? null,
    freightCondition: order?.freightCondition ?? null,
    commercialResponsibleName: null,
    orderSellerName: order?.nomusSellerName ?? null,
    operationalResponsibleArea: order?.responsible ?? null,
    originalOrderValue: round2(orderNetValue),
    canceledOrderValue: canceledValue,
    cutOrderValue: cutValue,
    activeOrderValue: activeValue,
    allocatedOrderValue: allocated,
    pendingActiveOrderValue: pendingActive,
    fulfillmentPercentActive:
      activeValue > MONEY_TOLERANCE
        ? Math.round((allocated / activeValue) * 10000) / 100
        : allocated > MONEY_TOLERANCE
          ? 100
          : 0,
    receivableTotalValue: receivableTotal,
    receivableOpenValue: receivableOpen,
    receivableReceivedValue: receivableReceived,
    operationalStage: input.facts.find((f) => f.operationalStage)?.operationalStage ?? null,
    financialStage: input.facts.find((f) => f.financialStage)?.financialStage ?? null,
    orderToCashStage: input.facts.find((f) => f.orderToCashStage)?.orderToCashStage ?? null,
    temperature: input.facts.find((f) => f.temperature)?.temperature ?? null,
    consolidatedStatus,
  };
}

function summarizeReceivables(
  receivables: OrderFullAuditReceivable[]
): OrderFullAuditPayload["receivablesTotal"] {
  let totalAmount = 0;
  let openAmount = 0;
  let receivedAmount = 0;
  let overdueCount = 0;
  let maxAmount = 0;
  let nextDueDate: string | null = null;
  for (const r of receivables) {
    totalAmount += r.amountReceivable;
    openAmount += r.balanceReceivable;
    receivedAmount += r.amountReceived;
    maxAmount = Math.max(maxAmount, r.amountReceivable);
    if (r.status === "OVERDUE") overdueCount += 1;
    if (r.balanceReceivable > MONEY_TOLERANCE && r.dueDate) {
      if (!nextDueDate || r.dueDate < nextDueDate) nextDueDate = r.dueDate;
    }
  }
  return {
    totalAmount: round2(totalAmount),
    openAmount: round2(openAmount),
    receivedAmount: round2(receivedAmount),
    overdueCount,
    nextDueDate,
    maxAmount: round2(maxAmount),
    totalCount: receivables.length,
  };
}

function buildTimeline(input: {
  orderIssueDate: Date | null | undefined;
  stockDocuments: OrderFullAuditStockDocument[];
  nfes: OrderFullAuditNfe[];
  receivables: OrderFullAuditReceivable[];
}): OrderFullAuditTimelinePoint[] {
  const stockDate = latestIso(
    input.stockDocuments.map((d) => d.dataDocumento).filter((d): d is string => Boolean(d))
  );
  const nfeDate = latestIso(
    input.nfes
      .map((n) => n.dataEmissao ?? n.dataProcessamento)
      .filter((d): d is string => Boolean(d))
  );
  const receivableDate = latestIso(input.receivables.map((r) => r.dueDate));
  const paymentDate = latestIso(input.receivables.map((r) => r.settlementDate));

  return [
    {
      key: "ORDER_ISSUED",
      label: "Pedido emitido",
      date: toIso(input.orderIssueDate ?? null),
      detail: null,
      active: Boolean(input.orderIssueDate),
    },
    {
      key: "STOCK_DOCUMENT",
      label: "Documento de saída",
      date: stockDate,
      detail:
        input.stockDocuments.length > 0
          ? `${input.stockDocuments.length} documento(s)`
          : null,
      active: input.stockDocuments.length > 0,
    },
    {
      key: "NFE",
      label: "NF-e",
      date: nfeDate,
      detail: input.nfes.length > 0 ? `${input.nfes.length} NF(s)` : null,
      active: input.nfes.length > 0,
    },
    {
      key: "RECEIVABLE",
      label: "Contas a Receber",
      date: receivableDate,
      detail:
        input.receivables.length > 0
          ? `${input.receivables.length} título(s)`
          : null,
      active: input.receivables.length > 0,
    },
    {
      key: "PAYMENT",
      label: "Baixa / recebimento",
      date: paymentDate,
      detail: paymentDate ? "Recebido" : null,
      active: Boolean(paymentDate),
    },
  ];
}

function buildAlerts(input: {
  order: Awaited<ReturnType<typeof prisma.salesOrder.findUnique>>;
  items: OrderFullAuditItem[];
  facts: OrderToCashAuditFactRecord[];
  summary: OrderFullAuditPayload["summary"];
  receivables: OrderFullAuditReceivable[];
  stockDocuments: OrderFullAuditStockDocument[];
  nfes: OrderFullAuditNfe[];
}): OrderFullAuditAlert[] {
  const alerts: OrderFullAuditAlert[] = [];

  const seen = new Set<string>();
  const push = (a: OrderFullAuditAlert): void => {
    const key = `${a.code}:${a.description}`;
    if (seen.has(key)) return;
    seen.add(key);
    alerts.push(a);
  };

  for (const doc of input.stockDocuments) {
    if (doc.hasExcess) {
      push({
        code: "DOCUMENTO_COM_EXCEDENTE",
        severity: "warning",
        title: "Documento com excedente",
        description: `Documento ${doc.stockDocumentExternalId} tem quantidade excedente ao pedido.`,
        origin: "Documento de saída",
        action: "Revisar alocação item × documento.",
        financialImpact: doc.outsideOrderValue > 0 ? round2(doc.outsideOrderValue) : null,
      });
    }
    if (doc.hasOutside) {
      push({
        code: "PRODUTO_FORA_DO_PEDIDO",
        severity: "warning",
        title: "Produto fora do pedido",
        description: `Documento ${doc.stockDocumentExternalId} contém produto não pertencente ao pedido.`,
        origin: "Documento de saída",
        action: "Confirmar se o vínculo é intencional.",
        financialImpact: round2(doc.outsideOrderValue),
      });
    }
  }
  for (const nfe of input.nfes) {
    if (nfe.headerGreaterThanOrder) {
      push({
        code: "NF_MAIOR_QUE_PEDIDO",
        severity: "warning",
        title: "NF maior que pedido",
        description: `NF ${nfe.numero ?? nfe.nfeExternalId} tem cabeçalho > valor ativo do pedido.`,
        origin: "NF-e",
        action: "Não inflar carteira; conferir se a NF cobre mais de um pedido.",
        financialImpact:
          nfe.valorTotal != null && input.summary.activeOrderValue > 0
            ? round2(Math.max(0, nfe.valorTotal - input.summary.activeOrderValue))
            : null,
      });
    }
    if (!nfe.hasReceivable) {
      push({
        code: "NF_SEM_CR",
        severity: "warning",
        title: "NF sem CR",
        description: `NF ${nfe.numero ?? nfe.nfeExternalId} não possui título de Contas a Receber vinculado.`,
        origin: "NF-e / CR",
        action: "Verificar geração de CR no Nomus.",
        financialImpact: null,
      });
    }
  }
  for (const receivable of input.receivables) {
    if (receivable.status === "OVERDUE") {
      push({
        code: "CR_VENCIDO",
        severity: "critical",
        title: "CR vencido",
        description: `Título ${receivable.receivableExternalId} vencido em ${receivable.dueDate ?? "?"}.`,
        origin: "Contas a Receber",
        action: "Priorizar cobrança.",
        financialImpact: round2(receivable.balanceReceivable),
      });
    }
  }
  for (const item of input.items) {
    if (item.nomusIsCanceled) {
      push({
        code: "ITEM_CANCELADO",
        severity: "info",
        title: "Item cancelado",
        description: `Item ${item.itemSequence ?? item.productCode ?? ""} está cancelado no Pedido de Venda/Nomus.`,
        origin: "SalesOrderItem",
        action: "Não conta como pendente; exibido apenas para auditoria.",
        financialImpact: item.totalNetValue,
      });
    }
    if (item.nomusIsCut) {
      push({
        code: "ITEM_COM_CORTE",
        severity: "info",
        title: "Item atendido com corte",
        description: `Item ${item.itemSequence ?? item.productCode ?? ""} teve saldo cortado no Nomus.`,
        origin: "SalesOrderItem",
        action: "Saldo cortado encerra pendência; não gera comissão nem NO_MARGIN.",
        financialImpact: item.totalNetValue,
      });
    }
    if (item.nomusIsStale) {
      push({
        code: "ITEM_STALE",
        severity: "warning",
        title: "Item removido do pedido",
        description: `Item ${item.itemSequence ?? item.productCode ?? ""} não veio no último payload Nomus.`,
        origin: "SalesOrderItem",
        action: "Confirmar exclusão intencional; item mantido para histórico.",
        financialImpact: item.totalNetValue,
      });
    }
    if ((item.matchConfidence ?? "").toUpperCase() === "AMBIGUOUS") {
      push({
        code: "MATCH_AMBIGUO",
        severity: "warning",
        title: "Casamento ambíguo com payload",
        description: `Item ${item.itemSequence ?? item.productCode ?? ""}: SKU repetido sem evidência de linha.`,
        origin: "Nomus itensPedido",
        action: "Ajustar id/sequência ou nomus-line tag.",
        financialImpact: null,
      });
    }
  }

  if (input.summary.orderSellerName == null || !input.summary.orderSellerName.trim()) {
    push({
      code: "VENDEDOR_AUSENTE",
      severity: "warning",
      title: "Vendedor Pedido ausente",
      description: "SalesOrder sem `externalSellerId` / `nomusSellerName` do Nomus.",
      origin: "SalesOrder",
      action: "Corrigir cadastro do vendedor no Pedido de Venda no Nomus.",
      financialImpact: null,
    });
  }
  if (
    input.summary.commercialResponsibleName == null ||
    !input.summary.commercialResponsibleName.trim()
  ) {
    push({
      code: "RESPONSAVEL_COMERCIAL_AUSENTE",
      severity: "info",
      title: "Responsável comercial ausente",
      description:
        "Cliente sem responsável comercial cadastrado no CRM (CrmCustomerCommercialOwner).",
      origin: "CRM",
      action: "Atribuir responsável no cadastro do cliente.",
      financialImpact: null,
    });
  }
  if (!input.summary.paymentTerms && !input.summary.paymentMethod) {
    push({
      code: "CONDICAO_PAGAMENTO_AUSENTE",
      severity: "warning",
      title: "Condição de pagamento ausente",
      description: "Pedido sem condição/forma de pagamento explícita.",
      origin: "SalesOrder",
      action: "Preencher no Nomus para gerar cronograma correto.",
      financialImpact: null,
    });
  }

  return alerts;
}
