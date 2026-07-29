/**
 * OP-49 — Contrato interno estável de evidências do Fluxo de Pedidos.
 *
 * Camada pura: monta o pack a partir de fatias já carregadas.
 * Sem I/O, sem Nomus HTTP, sem escrita.
 *
 * Reutiliza FIN-03 (`classifySalesOrderItemFinancialFulfillment`) e
 * normalização oficial de NF-e (`normalizeNfeStatus`).
 */

import {
  classifySalesOrderItemFinancialFulfillment,
  type ClassifySalesOrderItemFinancialFulfillmentResult,
} from "@/src/lib/finance/salesOrderItemFinancialFulfillmentClassifier.js";
import {
  isNomusNfeCancelled,
  normalizeNfeStatus,
  type NormalizedNfeStatusResult,
} from "@/src/lib/finance/nfeStatus.js";
import { resolveSalesOrderItemProductCommercialClass } from "./salesOrderItemProductCommercialClass.js";
import type { SalesOrderItemProductCommercialClass } from "./salesOrderItemProductionRequirement.js";

export const SALES_ORDER_FLOW_EVIDENCE_NFE_SOURCES = [
  "SALES_ORDER_NFE_LINK",
  "O2C_AUDIT_FACT",
  "STOCK_DOCUMENT_ID_NFE",
] as const;

export type SalesOrderFlowEvidenceNfeSource =
  (typeof SALES_ORDER_FLOW_EVIDENCE_NFE_SOURCES)[number];

export const SALES_ORDER_FLOW_EVIDENCE_LINK_CONFLICT_CODES = [
  "NFE_STATUS_MISMATCH_ACROSS_SOURCES",
  "PRODUCTION_LINK_ITEM_MISMATCH",
  "NFE_LINKED_TO_MULTIPLE_ORDERS_IN_BATCH",
  "DUPLICATE_NFE_EXTERNAL_ID",
] as const;

export type SalesOrderFlowEvidenceLinkConflictCode =
  (typeof SALES_ORDER_FLOW_EVIDENCE_LINK_CONFLICT_CODES)[number];

export type SalesOrderFlowEvidenceCustomer = {
  id: string;
  companyName: string | null;
  tradeName: string | null;
  taxId: string | null;
};

export type SalesOrderFlowEvidenceSeller = {
  externalSellerId: number | null;
  sellerName: string | null;
  source: "SALES_ORDER";
};

export type SalesOrderFlowEvidenceCompany = {
  companyIssuer: string | null;
  externalCompanyId: number | null;
};

export type SalesOrderFlowEvidenceManualMetadata = {
  notes: string | null;
  internalNotes: string | null;
  responsible: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  freightCondition: string | null;
  deliveryLocation: string | null;
};

export type SalesOrderFlowEvidenceOrderHeader = {
  id: string;
  orderCode: string;
  status: string;
  externalSalesOrderId: number | null;
  externalSalesOrderCode: string | null;
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  totalNetValue: number | null;
  totalGrossValue: number | null;
  customerId: string;
  customer: SalesOrderFlowEvidenceCustomer | null;
  seller: SalesOrderFlowEvidenceSeller;
  company: SalesOrderFlowEvidenceCompany;
  manualMetadata: SalesOrderFlowEvidenceManualMetadata;
};

export type SalesOrderFlowEvidenceItem = {
  id: string;
  salesOrderId: string;
  productId: string;
  externalProductId: number | null;
  nomusItemExternalId: number | null;
  nomusItemSequence: string | null;
  skuSnapshot: string;
  productNameSnapshot: string;
  quantity: number | null;
  nomusQuantityFulfilled: number | null;
  nomusQuantityPending: number | null;
  nomusItemStatusRaw: string | null;
  nomusItemStatusNormalized: string | null;
  nomusIsCanceled: boolean;
  nomusIsStale: boolean;
  nomusIsCut: boolean;
  productType: string | null;
  productCostingMode: string | null;
  hasProductRouting: boolean | null;
  hasProductBom: boolean | null;
  productCommercialClass: SalesOrderItemProductCommercialClass | null;
  fulfillment: ClassifySalesOrderItemFinancialFulfillmentResult;
};

export type SalesOrderFlowEvidenceProductionLink = {
  id: string;
  productionOrderId: string;
  productionOrderExternalId: number;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  externalSalesOrderId: number;
  externalSalesOrderItemId: number;
  itemNumber: string | null;
  linkedQuantity: number | null;
  isCurrent: boolean;
  linkKey: string;
};

export type SalesOrderFlowEvidenceProductionOrder = {
  id: string;
  externalId: number;
  status: string | null;
  /** Quantidade planejada oficial da OP (`NomusProductionOrder.quantity`). */
  plannedQuantity: number | null;
  /**
   * Quantidade produzida normalizada — ainda não existe no stage (OP-45).
   * Sempre null até contrato Nomus; não inferir.
   */
  producedQuantity: null;
  productCode: string | null;
  openedAt: string | null;
  closedAt: string | null;
};

export type SalesOrderFlowEvidenceStockDocument = {
  id: string;
  externalId: number;
  idNfe: number | null;
  tipoDocumentoEstoque: string | null;
  dataDocumento: string | null;
  documentNumber: string | null;
  totalValue: number | null;
  statusRaw: string | null;
  isCancelled: boolean;
  cancelledAt: string | null;
  cancellationReason: string | null;
  itemCount: number;
  /** Refs oficiais de cabeçalho (KAN-LINK-04). */
  externalSalesOrderId?: number | null;
  orderCodeNormalized?: string | null;
};

export type SalesOrderFlowEvidenceStockDocumentItem = {
  id: string;
  stockDocumentId: string;
  stockDocumentExternalId: number;
  externalItemId: number | null;
  externalProductId: number | null;
  quantity: number | null;
  /** Refs oficiais extraídas do raw (KAN-LINK-04) — opcionais. */
  externalSalesOrderId?: number | null;
  externalSalesOrderItemId?: number | null;
  orderCodeNormalized?: string | null;
  salesOrderItemSequence?: string | null;
  unitCode?: string | null;
  descriptionHintOrderCode?: string | null;
};

export type SalesOrderFlowEvidenceAllocation = {
  auditKey: string;
  runId: string;
  lineType: string;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  stockDocumentExternalId: number | null;
  stockDocumentItemId: string | null;
  nfeExternalId: number | null;
  quantityUsedForOrder: number | null;
  orderedQuantity: number | null;
  nfeLinkedBy: string | null;
};

export type SalesOrderFlowEvidenceNfe = {
  externalId: number;
  nomusNfeId: string | null;
  numero: string | null;
  serie: string | null;
  chave: string | null;
  statusRaw: number | null;
  issuedAt: string | null;
  statusNormalized: NormalizedNfeStatusResult;
  isCanceled: boolean;
  isValidForBilling: boolean;
  /** Fontes oficiais que apontaram para este externalId (dedupe preserva origem). */
  sources: SalesOrderFlowEvidenceNfeSource[];
  linkedSalesOrderIds: string[];
};

export type SalesOrderFlowEvidenceLinkConflict = {
  code: SalesOrderFlowEvidenceLinkConflictCode;
  detail: string;
  entityIds: string[];
};

export type SalesOrderFlowEvidencePack = {
  orderId: string;
  order: SalesOrderFlowEvidenceOrderHeader;
  items: SalesOrderFlowEvidenceItem[];
  productionLinks: SalesOrderFlowEvidenceProductionLink[];
  productionOrders: SalesOrderFlowEvidenceProductionOrder[];
  stockDocuments: SalesOrderFlowEvidenceStockDocument[];
  stockDocumentItems: SalesOrderFlowEvidenceStockDocumentItem[];
  allocations: SalesOrderFlowEvidenceAllocation[];
  nfes: SalesOrderFlowEvidenceNfe[];
  validNfes: SalesOrderFlowEvidenceNfe[];
  canceledNfes: SalesOrderFlowEvidenceNfe[];
  linkConflicts: SalesOrderFlowEvidenceLinkConflict[];
  meta: {
    loadedAt: string;
    source: "LOCAL_STAGE";
    queryMode: "BATCH";
  };
};

function dec(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : null;
    } catch {
      /* fall through */
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Fatia crua do pedido (pós-Prisma / fixture). */
export type SalesOrderFlowEvidenceOrderRow = {
  id: string;
  orderCode: string;
  status: string;
  externalSalesOrderId?: number | null;
  externalSalesOrderCode?: string | null;
  issueDate?: Date | string | null;
  expectedDeliveryDate?: Date | string | null;
  totalNetValue?: unknown;
  totalGrossValue?: unknown;
  customerId: string;
  externalSellerId?: number | null;
  nomusSellerName?: string | null;
  companyIssuer?: string | null;
  externalCompanyId?: number | null;
  notes?: string | null;
  internalNotes?: string | null;
  responsible?: string | null;
  paymentTerms?: string | null;
  paymentMethod?: string | null;
  freightCondition?: string | null;
  deliveryLocation?: string | null;
  Customer?: {
    id?: string;
    companyName?: string | null;
    tradeName?: string | null;
    taxId?: string | null;
  } | null;
  items?: SalesOrderFlowEvidenceItemRow[];
};

export type SalesOrderFlowEvidenceItemRow = {
  id: string;
  salesOrderId: string;
  productId: string;
  externalProductId?: number | null;
  nomusItemExternalId?: number | null;
  nomusItemSequence?: string | null;
  skuSnapshot: string;
  productNameSnapshot: string;
  quantity?: unknown;
  nomusQuantityFulfilled?: unknown;
  nomusQuantityPending?: unknown;
  nomusItemStatusRaw?: string | null;
  nomusItemStatusNormalized?: string | null;
  nomusIsCanceled?: boolean | null;
  nomusIsStale?: boolean | null;
  nomusIsCut?: boolean | null;
};

export type SalesOrderFlowEvidenceProductRow = {
  id: string;
  type?: string | null;
  costingMode?: string | null;
  hasProductRouting?: boolean | null;
  hasProductBom?: boolean | null;
};

export type SalesOrderFlowEvidenceNfeLinkRow = {
  id: string;
  salesOrderId: string;
  nfeExternalId: number;
  nfeNumber?: string | null;
  nfeKey?: string | null;
  nfeStatus?: number | null;
  nomusNfeId?: string | null;
};

export type SalesOrderFlowEvidenceNomusNfeRow = {
  id: string;
  externalId: number;
  numero?: string | null;
  serie?: string | null;
  chave?: string | null;
  status?: number | null;
  xmlDhEmi?: Date | string | null;
};

export type SalesOrderFlowEvidenceProductionLinkRow = {
  id: string;
  productionOrderId: string;
  productionOrderExternalId: number;
  salesOrderId?: string | null;
  salesOrderItemId?: string | null;
  externalSalesOrderId: number;
  externalSalesOrderItemId: number;
  itemNumber?: string | null;
  linkedQuantity?: unknown;
  isCurrent: boolean;
};

export type SalesOrderFlowEvidenceProductionOrderRow = {
  id: string;
  externalId: number;
  status?: string | null;
  quantity?: unknown;
  productCode?: string | null;
  openedAt?: Date | string | null;
  closedAt?: Date | string | null;
};

export type SalesOrderFlowEvidenceStockDocumentRow = {
  id: string;
  externalId: number;
  idNfe?: number | null;
  tipoDocumentoEstoque?: string | null;
  dataDocumento?: Date | string | null;
  documentNumber?: string | null;
  totalValue?: unknown;
  statusRaw?: string | null;
  isCancelled?: boolean | null;
  cancelledAt?: Date | string | null;
  cancellationReason?: string | null;
  /** Refs oficiais de cabeçalho (KAN-LINK-04). */
  externalSalesOrderId?: number | null;
  orderCodeNormalized?: string | null;
};

export type SalesOrderFlowEvidenceStockDocumentItemRow = {
  id: string;
  stockDocumentId: string;
  externalItemId?: number | null;
  externalProductId?: number | null;
  quantity?: unknown;
  externalSalesOrderId?: number | null;
  externalSalesOrderItemId?: number | null;
  orderCodeNormalized?: string | null;
  salesOrderItemSequence?: string | null;
  unitCode?: string | null;
  descriptionHintOrderCode?: string | null;
};

export type SalesOrderFlowEvidenceAllocationRow = {
  auditKey: string;
  runId: string;
  lineType: string;
  salesOrderId?: string | null;
  salesOrderItemId?: string | null;
  stockDocumentExternalId?: number | null;
  stockDocumentItemId?: string | null;
  nfeExternalId?: number | null;
  quantityUsedForOrder?: unknown;
  orderedQuantity?: unknown;
  nfeLinkedBy?: string | null;
  createdAt?: Date | string | null;
};

export type AssembleSalesOrderFlowEvidenceBatchInput = {
  orders: SalesOrderFlowEvidenceOrderRow[];
  products?: SalesOrderFlowEvidenceProductRow[];
  nfeLinks?: SalesOrderFlowEvidenceNfeLinkRow[];
  nomusNfes?: SalesOrderFlowEvidenceNomusNfeRow[];
  productionLinks?: SalesOrderFlowEvidenceProductionLinkRow[];
  productionOrders?: SalesOrderFlowEvidenceProductionOrderRow[];
  stockDocuments?: SalesOrderFlowEvidenceStockDocumentRow[];
  stockDocumentItems?: SalesOrderFlowEvidenceStockDocumentItemRow[];
  allocations?: SalesOrderFlowEvidenceAllocationRow[];
  loadedAt?: string;
};

type NfeAccumulator = {
  externalId: number;
  nomusNfeId: string | null;
  numero: string | null;
  serie: string | null;
  chave: string | null;
  statusRaw: number | null;
  issuedAt: string | null;
  sources: Set<SalesOrderFlowEvidenceNfeSource>;
  linkedSalesOrderIds: Set<string>;
  statusSamples: Array<{ source: SalesOrderFlowEvidenceNfeSource; status: number | null }>;
};

function buildNfeEvidence(acc: NfeAccumulator): SalesOrderFlowEvidenceNfe {
  // Preferir status canônico de NomusNfe (`statusRaw`); link/O2C só como fallback.
  // Evita SalesOrderNfeLink stale (ex.: cancelada antiga) sobrescrever NF autorizada.
  const preferredStatus =
    acc.statusRaw ??
    acc.statusSamples.find((s) => s.status != null)?.status ??
    null;
  const statusNormalized = normalizeNfeStatus({ status: preferredStatus });
  return {
    externalId: acc.externalId,
    nomusNfeId: acc.nomusNfeId,
    numero: acc.numero,
    serie: acc.serie,
    chave: acc.chave,
    statusRaw: preferredStatus,
    issuedAt: acc.issuedAt,
    statusNormalized,
    isCanceled: statusNormalized.isCanceled || isNomusNfeCancelled(preferredStatus),
    isValidForBilling: statusNormalized.isValidForBilling,
    sources: [...acc.sources],
    linkedSalesOrderIds: [...acc.linkedSalesOrderIds].sort(),
  };
}

function mapItem(
  row: SalesOrderFlowEvidenceItemRow,
  product: SalesOrderFlowEvidenceProductRow | undefined
): SalesOrderFlowEvidenceItem {
  const fulfillment = classifySalesOrderItemFinancialFulfillment({
    status: row.nomusItemStatusRaw,
    statusNormalized: row.nomusItemStatusNormalized,
    statusRaw: row.nomusItemStatusRaw,
    orderedQuantity: dec(row.quantity),
    fulfilledQuantity: dec(row.nomusQuantityFulfilled),
    nomusIsCut: row.nomusIsCut,
    nomusIsCanceled: row.nomusIsCanceled,
  });

  return {
    id: row.id,
    salesOrderId: row.salesOrderId,
    productId: row.productId,
    externalProductId: row.externalProductId ?? null,
    nomusItemExternalId: row.nomusItemExternalId ?? null,
    nomusItemSequence: row.nomusItemSequence ?? null,
    skuSnapshot: row.skuSnapshot,
    productNameSnapshot: row.productNameSnapshot,
    quantity: dec(row.quantity),
    nomusQuantityFulfilled: dec(row.nomusQuantityFulfilled),
    nomusQuantityPending: dec(row.nomusQuantityPending),
    nomusItemStatusRaw: row.nomusItemStatusRaw ?? null,
    nomusItemStatusNormalized: row.nomusItemStatusNormalized ?? null,
    nomusIsCanceled: row.nomusIsCanceled === true,
    nomusIsStale: row.nomusIsStale === true,
    nomusIsCut: row.nomusIsCut === true,
    productType: product?.type ?? null,
    productCostingMode: product?.costingMode ?? null,
    hasProductRouting: product?.hasProductRouting ?? null,
    hasProductBom: product?.hasProductBom ?? null,
    productCommercialClass: resolveSalesOrderItemProductCommercialClass({
      productType: product?.type,
      costingMode: product?.costingMode,
      hasProductRouting: product?.hasProductRouting,
      hasProductBom: product?.hasProductBom,
    }),
    fulfillment,
  };
}

function mapOrderHeader(order: SalesOrderFlowEvidenceOrderRow): SalesOrderFlowEvidenceOrderHeader {
  const customer = order.Customer
    ? {
        id: order.Customer.id ?? order.customerId,
        companyName: order.Customer.companyName ?? null,
        tradeName: order.Customer.tradeName ?? null,
        taxId: order.Customer.taxId ?? null,
      }
    : null;

  return {
    id: order.id,
    orderCode: order.orderCode,
    status: order.status,
    externalSalesOrderId: order.externalSalesOrderId ?? null,
    externalSalesOrderCode: order.externalSalesOrderCode ?? null,
    issueDate: iso(order.issueDate),
    expectedDeliveryDate: iso(order.expectedDeliveryDate),
    totalNetValue: dec(order.totalNetValue),
    totalGrossValue: dec(order.totalGrossValue),
    customerId: order.customerId,
    customer,
    seller: {
      externalSellerId: order.externalSellerId ?? null,
      sellerName: order.nomusSellerName ?? null,
      source: "SALES_ORDER",
    },
    company: {
      companyIssuer: order.companyIssuer ?? null,
      externalCompanyId: order.externalCompanyId ?? null,
    },
    manualMetadata: {
      notes: order.notes ?? null,
      internalNotes: order.internalNotes ?? null,
      responsible: order.responsible ?? null,
      paymentTerms: order.paymentTerms ?? null,
      paymentMethod: order.paymentMethod ?? null,
      freightCondition: order.freightCondition ?? null,
      deliveryLocation: order.deliveryLocation ?? null,
    },
  };
}

/**
 * Monta packs por pedido a partir de fatias já carregadas (sem I/O).
 * Deduplica OP / Documento / NF-e por identificadores oficiais e preserva origem.
 */
export function assembleSalesOrderFlowEvidenceBatch(
  input: AssembleSalesOrderFlowEvidenceBatchInput
): Map<string, SalesOrderFlowEvidencePack> {
  const loadedAt = input.loadedAt ?? new Date().toISOString();
  const productsById = new Map(
    (input.products ?? []).map((p) => [p.id, p] as const)
  );
  const productionOrdersByExternalId = new Map(
    (input.productionOrders ?? []).map((o) => [o.externalId, o] as const)
  );
  const productionOrdersById = new Map(
    (input.productionOrders ?? []).map((o) => [o.id, o] as const)
  );
  const stockDocsById = new Map(
    (input.stockDocuments ?? []).map((d) => [d.id, d] as const)
  );
  const stockDocsByExternalId = new Map(
    (input.stockDocuments ?? []).map((d) => [d.externalId, d] as const)
  );
  const stockItems = input.stockDocumentItems ?? [];
  const nomusNfeByExternalId = new Map(
    (input.nomusNfes ?? []).map((n) => [n.externalId, n] as const)
  );

  const nfeAcc = new Map<number, NfeAccumulator>();
  const ensureNfe = (externalId: number): NfeAccumulator => {
    let acc = nfeAcc.get(externalId);
    if (!acc) {
      const row = nomusNfeByExternalId.get(externalId);
      acc = {
        externalId,
        nomusNfeId: row?.id ?? null,
        numero: row?.numero ?? null,
        serie: row?.serie ?? null,
        chave: row?.chave ?? null,
        statusRaw: row?.status ?? null,
        issuedAt: iso(row?.xmlDhEmi),
        sources: new Set(),
        linkedSalesOrderIds: new Set(),
        statusSamples: [],
      };
      nfeAcc.set(externalId, acc);
    }
    return acc;
  };

  for (const link of input.nfeLinks ?? []) {
    const acc = ensureNfe(link.nfeExternalId);
    acc.sources.add("SALES_ORDER_NFE_LINK");
    acc.linkedSalesOrderIds.add(link.salesOrderId);
    if (link.nomusNfeId) acc.nomusNfeId = link.nomusNfeId;
    if (link.nfeNumber) acc.numero = link.nfeNumber;
    if (link.nfeKey) acc.chave = link.nfeKey;
    acc.statusSamples.push({
      source: "SALES_ORDER_NFE_LINK",
      status: link.nfeStatus ?? null,
    });
  }

  // Preferir run mais recente por pedido nas alocações O2C.
  const allocationsByOrder = new Map<string, SalesOrderFlowEvidenceAllocationRow[]>();
  for (const row of input.allocations ?? []) {
    if (!row.salesOrderId) continue;
    const list = allocationsByOrder.get(row.salesOrderId) ?? [];
    list.push(row);
    allocationsByOrder.set(row.salesOrderId, list);
  }

  const pickLatestRunAllocations = (
    rows: SalesOrderFlowEvidenceAllocationRow[]
  ): SalesOrderFlowEvidenceAllocationRow[] => {
    if (rows.length === 0) return [];
    let bestRunId = rows[0]!.runId;
    let bestTs = 0;
    for (const row of rows) {
      const ts = row.createdAt ? new Date(row.createdAt).getTime() : 0;
      if (ts >= bestTs) {
        bestTs = ts;
        bestRunId = row.runId;
      }
    }
    return rows.filter((r) => r.runId === bestRunId);
  };

  for (const [, rows] of allocationsByOrder) {
    for (const row of pickLatestRunAllocations(rows)) {
      if (row.nfeExternalId != null) {
        const acc = ensureNfe(row.nfeExternalId);
        acc.sources.add("O2C_AUDIT_FACT");
        if (row.salesOrderId) acc.linkedSalesOrderIds.add(row.salesOrderId);
        acc.statusSamples.push({ source: "O2C_AUDIT_FACT", status: null });
      }
    }
  }

  // Índice pedido ↔ refs Nomus para vincular NF descoberta só via DS.
  const orderIdByExternalSalesOrderId = new Map<number, string>();
  const orderIdByCodeNorm = new Map<string, string>();
  for (const order of input.orders) {
    if (order.externalSalesOrderId != null) {
      orderIdByExternalSalesOrderId.set(order.externalSalesOrderId, order.id);
    }
    const raw = (order.orderCode ?? order.externalSalesOrderCode ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    const m = /^PD[-_]?(\d+)$/.exec(raw);
    if (m) orderIdByCodeNorm.set(`PD${m[1]}`, order.id);
  }

  for (const doc of input.stockDocuments ?? []) {
    if (doc.idNfe != null) {
      const acc = ensureNfe(doc.idNfe);
      acc.sources.add("STOCK_DOCUMENT_ID_NFE");
      acc.statusSamples.push({ source: "STOCK_DOCUMENT_ID_NFE", status: null });
      // DS do pedido com idNfe ⇒ NF vinculada ao pedido (paridade Nomus Documentos de Saída).
      if (doc.externalSalesOrderId != null) {
        const oid = orderIdByExternalSalesOrderId.get(doc.externalSalesOrderId);
        if (oid) acc.linkedSalesOrderIds.add(oid);
      }
      if (doc.orderCodeNormalized) {
        const oid = orderIdByCodeNorm.get(doc.orderCodeNormalized);
        if (oid) acc.linkedSalesOrderIds.add(oid);
      }
    }
  }

  const globalConflicts: SalesOrderFlowEvidenceLinkConflict[] = [];

  // NF apontada para múltiplos pedidos no lote.
  for (const [externalId, acc] of nfeAcc) {
    if (acc.linkedSalesOrderIds.size > 1) {
      globalConflicts.push({
        code: "NFE_LINKED_TO_MULTIPLE_ORDERS_IN_BATCH",
        detail: `NF-e externalId=${externalId} vinculada a ${acc.linkedSalesOrderIds.size} pedidos no lote.`,
        entityIds: [`nfe:${externalId}`, ...[...acc.linkedSalesOrderIds].map((id) => `order:${id}`)],
      });
    }
    const statuses = acc.statusSamples
      .map((s) => s.status)
      .filter((s): s is number => s != null);
    if (statuses.length >= 2 && new Set(statuses).size > 1) {
      globalConflicts.push({
        code: "NFE_STATUS_MISMATCH_ACROSS_SOURCES",
        detail: `NF-e externalId=${externalId} com status divergente entre fontes.`,
        entityIds: [`nfe:${externalId}`],
      });
    }
    if (acc.sources.size > 1) {
      // Duplicata por fontes diferentes — esperado e deduplicado; registrar evidência informativa.
      globalConflicts.push({
        code: "DUPLICATE_NFE_EXTERNAL_ID",
        detail: `NF-e externalId=${externalId} deduplicada a partir de fontes: ${[...acc.sources].join(", ")}.`,
        entityIds: [`nfe:${externalId}`],
      });
    }
  }

  const nfeByExternalId = new Map<number, SalesOrderFlowEvidenceNfe>();
  for (const [externalId, acc] of nfeAcc) {
    nfeByExternalId.set(externalId, buildNfeEvidence(acc));
  }

  const result = new Map<string, SalesOrderFlowEvidencePack>();

  for (const order of input.orders) {
    const itemRows = order.items ?? [];
    const items = itemRows.map((row) =>
      mapItem(row, productsById.get(row.productId))
    );
    const itemIds = new Set(items.map((i) => i.id));
    const itemExternalIds = new Set(
      items
        .map((i) => i.nomusItemExternalId)
        .filter((id): id is number => id != null)
    );

    const productionLinks = (input.productionLinks ?? [])
      .filter(
        (l) =>
          l.salesOrderId === order.id ||
          (order.externalSalesOrderId != null &&
            l.externalSalesOrderId === order.externalSalesOrderId)
      )
      .map((l) => ({
        id: l.id,
        productionOrderId: l.productionOrderId,
        productionOrderExternalId: l.productionOrderExternalId,
        salesOrderId: l.salesOrderId ?? null,
        salesOrderItemId: l.salesOrderItemId ?? null,
        externalSalesOrderId: l.externalSalesOrderId,
        externalSalesOrderItemId: l.externalSalesOrderItemId,
        itemNumber: l.itemNumber?.trim() || null,
        linkedQuantity: dec(l.linkedQuantity),
        isCurrent: l.isCurrent,
        linkKey: `${l.productionOrderExternalId}:${l.externalSalesOrderItemId}`,
      }));

    const linkConflicts: SalesOrderFlowEvidenceLinkConflict[] = [
      ...globalConflicts.filter((c) =>
        c.entityIds.some(
          (id) => id === `order:${order.id}` || id.startsWith("nfe:")
        )
      ),
    ];

    for (const link of productionLinks) {
      if (
        link.salesOrderItemId &&
        !itemIds.has(link.salesOrderItemId)
      ) {
        linkConflicts.push({
          code: "PRODUCTION_LINK_ITEM_MISMATCH",
          detail: `Vínculo OP ${link.productionOrderExternalId} aponta salesOrderItemId ausente no pedido.`,
          entityIds: [`oplink:${link.id}`, `item:${link.salesOrderItemId}`],
        });
      } else if (
        !link.salesOrderItemId &&
        !itemExternalIds.has(link.externalSalesOrderItemId)
      ) {
        linkConflicts.push({
          code: "PRODUCTION_LINK_ITEM_MISMATCH",
          detail: `Vínculo OP ${link.productionOrderExternalId} externalSalesOrderItemId=${link.externalSalesOrderItemId} sem item local correspondente.`,
          entityIds: [`oplink:${link.id}`],
        });
      }
    }

    const productionOrderExternalIds = [
      ...new Set(productionLinks.map((l) => l.productionOrderExternalId)),
    ];
    const productionOrders: SalesOrderFlowEvidenceProductionOrder[] = [];
    for (const externalId of productionOrderExternalIds) {
      const row =
        productionOrdersByExternalId.get(externalId) ??
        productionOrdersById.get(
          productionLinks.find((l) => l.productionOrderExternalId === externalId)
            ?.productionOrderId ?? ""
        );
      if (!row) continue;
      productionOrders.push({
        id: row.id,
        externalId: row.externalId,
        status: row.status ?? null,
        plannedQuantity: dec(row.quantity),
        producedQuantity: null,
        productCode: row.productCode ?? null,
        openedAt: iso(row.openedAt),
        closedAt: iso(row.closedAt),
      });
    }

    const orderAllocations = pickLatestRunAllocations(
      allocationsByOrder.get(order.id) ?? []
    ).map((row) => ({
      auditKey: row.auditKey,
      runId: row.runId,
      lineType: row.lineType,
      salesOrderId: row.salesOrderId ?? null,
      salesOrderItemId: row.salesOrderItemId ?? null,
      stockDocumentExternalId: row.stockDocumentExternalId ?? null,
      stockDocumentItemId: row.stockDocumentItemId ?? null,
      nfeExternalId: row.nfeExternalId ?? null,
      quantityUsedForOrder: dec(row.quantityUsedForOrder),
      orderedQuantity: dec(row.orderedQuantity),
      nfeLinkedBy: row.nfeLinkedBy ?? null,
    }));

    const stockExternalIds = new Set<number>();
    for (const a of orderAllocations) {
      if (a.stockDocumentExternalId != null) {
        stockExternalIds.add(a.stockDocumentExternalId);
      }
    }
    // Documentos ligados por NF do pedido.
    for (const nfe of nfeByExternalId.values()) {
      if (!nfe.linkedSalesOrderIds.includes(order.id)) continue;
      for (const doc of stockDocsByExternalId.values()) {
        if (doc.idNfe === nfe.externalId) stockExternalIds.add(doc.externalId);
      }
    }
    // KAN-LINK-04 — refs oficiais pedido/item no DS (sem exigir NF sincronizada).
    const orderCodeNorm = (() => {
      const raw = (order.orderCode ?? order.externalSalesOrderCode ?? "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
      const m = /^PD[-_]?(\d+)$/.exec(raw);
      return m ? `PD${m[1]}` : null;
    })();
    for (const doc of stockDocsByExternalId.values()) {
      if (
        order.externalSalesOrderId != null &&
        doc.externalSalesOrderId === order.externalSalesOrderId
      ) {
        stockExternalIds.add(doc.externalId);
      }
      if (
        orderCodeNorm &&
        doc.orderCodeNormalized &&
        doc.orderCodeNormalized === orderCodeNorm
      ) {
        stockExternalIds.add(doc.externalId);
      }
    }
    for (const si of stockItems) {
      const parent = stockDocsById.get(si.stockDocumentId);
      if (!parent) continue;
      if (
        order.externalSalesOrderId != null &&
        si.externalSalesOrderId === order.externalSalesOrderId
      ) {
        stockExternalIds.add(parent.externalId);
      }
      if (
        si.externalSalesOrderItemId != null &&
        itemExternalIds.has(si.externalSalesOrderItemId)
      ) {
        stockExternalIds.add(parent.externalId);
      }
      if (
        orderCodeNorm &&
        si.orderCodeNormalized &&
        si.orderCodeNormalized === orderCodeNorm
      ) {
        stockExternalIds.add(parent.externalId);
      }
      if (
        orderCodeNorm &&
        si.descriptionHintOrderCode &&
        si.descriptionHintOrderCode === orderCodeNorm
      ) {
        stockExternalIds.add(parent.externalId);
      }
    }

    const stockDocuments: SalesOrderFlowEvidenceStockDocument[] = [];
    for (const externalId of stockExternalIds) {
      const doc = stockDocsByExternalId.get(externalId);
      if (!doc) continue;
      const itemCount = stockItems.filter((i) => i.stockDocumentId === doc.id).length;
      stockDocuments.push({
        id: doc.id,
        externalId: doc.externalId,
        idNfe: doc.idNfe ?? null,
        tipoDocumentoEstoque: doc.tipoDocumentoEstoque ?? null,
        dataDocumento: iso(doc.dataDocumento),
        documentNumber: doc.documentNumber?.trim() || null,
        totalValue: dec(doc.totalValue),
        statusRaw: doc.statusRaw ?? null,
        isCancelled: doc.isCancelled === true,
        cancelledAt: iso(doc.cancelledAt),
        cancellationReason: doc.cancellationReason?.trim() || null,
        itemCount,
        externalSalesOrderId: doc.externalSalesOrderId ?? null,
        orderCodeNormalized: doc.orderCodeNormalized ?? null,
      });
    }

    const stockDocIds = new Set(stockDocuments.map((d) => d.id));
    const stockDocumentItems: SalesOrderFlowEvidenceStockDocumentItem[] = stockItems
      .filter((i) => stockDocIds.has(i.stockDocumentId))
      .map((i) => {
        const parent = stockDocsById.get(i.stockDocumentId);
        return {
          id: i.id,
          stockDocumentId: i.stockDocumentId,
          stockDocumentExternalId: parent?.externalId ?? 0,
          externalItemId: i.externalItemId ?? null,
          externalProductId: i.externalProductId ?? null,
          quantity: dec(i.quantity),
          externalSalesOrderId: i.externalSalesOrderId ?? null,
          externalSalesOrderItemId: i.externalSalesOrderItemId ?? null,
          orderCodeNormalized: i.orderCodeNormalized ?? null,
          salesOrderItemSequence: i.salesOrderItemSequence ?? null,
          unitCode: i.unitCode ?? null,
          descriptionHintOrderCode: i.descriptionHintOrderCode ?? null,
        };
      });

    const orderNfeIds = new Set<number>();
    for (const link of input.nfeLinks ?? []) {
      if (link.salesOrderId === order.id) orderNfeIds.add(link.nfeExternalId);
    }
    for (const a of orderAllocations) {
      if (a.nfeExternalId != null) orderNfeIds.add(a.nfeExternalId);
    }
    for (const doc of stockDocuments) {
      if (doc.idNfe != null) orderNfeIds.add(doc.idNfe);
    }

    const nfes = [...orderNfeIds]
      .map((id) => {
        const n = nfeByExternalId.get(id);
        if (!n) return null;
        // DS do pedido com esta NF: garantir linkedSalesOrderIds (fallback do motor).
        if (!n.linkedSalesOrderIds.includes(order.id)) {
          return {
            ...n,
            linkedSalesOrderIds: [...n.linkedSalesOrderIds, order.id].sort(),
          };
        }
        return n;
      })
      .filter((n): n is SalesOrderFlowEvidenceNfe => n != null)
      .sort((a, b) => a.externalId - b.externalId);

    result.set(order.id, {
      orderId: order.id,
      order: mapOrderHeader(order),
      items,
      productionLinks,
      productionOrders,
      stockDocuments,
      stockDocumentItems,
      allocations: orderAllocations,
      nfes,
      validNfes: nfes.filter((n) => n.isValidForBilling && !n.isCanceled),
      canceledNfes: nfes.filter((n) => n.isCanceled),
      linkConflicts: linkConflicts.filter((c) => {
        if (c.code === "DUPLICATE_NFE_EXTERNAL_ID") {
          return c.entityIds.some((id) => {
            const m = /^nfe:(\d+)$/.exec(id);
            return m ? orderNfeIds.has(Number(m[1])) : false;
          });
        }
        if (c.code === "NFE_LINKED_TO_MULTIPLE_ORDERS_IN_BATCH") {
          return c.entityIds.includes(`order:${order.id}`);
        }
        if (c.code === "NFE_STATUS_MISMATCH_ACROSS_SOURCES") {
          return c.entityIds.some((id) => {
            const m = /^nfe:(\d+)$/.exec(id);
            return m ? orderNfeIds.has(Number(m[1])) : false;
          });
        }
        return true;
      }),
      meta: {
        loadedAt,
        source: "LOCAL_STAGE",
        queryMode: "BATCH",
      },
    });
  }

  return result;
}
