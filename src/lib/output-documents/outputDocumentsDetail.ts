/**
 * DS-04.2 / DS-04.3 — Mapper puro do detalhe de Documento de Saída.
 * Sem rawJson. Item sem vínculo permanece visível.
 */

import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import {
  moneyCentsToNumber,
} from "@/src/lib/output-documents/auditOutputDocumentsFinancial.js";
import { maskNfeChave } from "@/src/lib/output-documents/auditOutputDocumentsExamples.js";
import {
  isNomusNfeCancelledStatus,
  type LinkSourceKind,
} from "@/src/lib/output-documents/auditOutputDocumentsLinks.js";
import type { ResolvedOutputDocument } from "@/src/lib/output-documents/nomusOutputDocumentResolver.js";
import type { OutputDocumentAllocationProjection } from "@/src/lib/output-documents/outputDocumentAllocationProjection.js";
import type { OutputDocumentFinancialStatusResult } from "@/src/lib/output-documents/outputDocumentFinancialStatusResolver.js";
import type {
  OutputDocumentDetailAllocations,
  OutputDocumentDetailAudit,
  OutputDocumentDetailFinancial,
  OutputDocumentDetailInconsistency,
  OutputDocumentDetailItem,
  OutputDocumentDetailLinkedOrder,
  OutputDocumentDetailNfe,
  OutputDocumentDetailPayload,
  OutputDocumentDetailResolution,
} from "@/src/lib/output-documents/outputDocumentsDetailTypes.js";

export type OutputDocumentDetailSyncMeta = {
  syncedAt: Date;
  firstSeenAt: Date;
  lastSeenAt: Date;
  presentInLastPayload: boolean;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  payloadHash: string | null;
};

export type OutputDocumentDetailOrderEnrichment = {
  salesOrderId: string;
  orderCode: string | null;
  issueDate: Date | null;
  status: string | null;
  externalSellerId: number | null;
  nomusSellerName: string | null;
  responsible: string | null;
  totalNetValue: unknown;
};

export type OutputDocumentDetailNfeEnrichment = {
  externalId: number;
  id: string | null;
  numero: string | null;
  serie: string | null;
  status: number | null;
  chave: string | null;
  xmlDhEmi: Date | null;
  dataProcessamento: Date | null;
  valorLiquido: unknown;
  xmlVNF: unknown;
  foundLocally: boolean;
  sources: LinkSourceKind[];
  isPrimary: boolean;
};

function toIso(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function toIsoRequired(value: Date): string {
  if (Number.isNaN(value.getTime())) return new Date(0).toISOString();
  return value.toISOString();
}

function moneyOrNull(value: unknown): number | null {
  return decimalToNumber(value);
}

function moneyOrZero(value: unknown): number {
  return decimalToNumber(value) ?? 0;
}

/**
 * Monta o payload completo de detalhe (geral + relações).
 */
export function buildOutputDocumentDetailPayload(input: {
  resolved: ResolvedOutputDocument;
  projection: OutputDocumentAllocationProjection;
  sync: OutputDocumentDetailSyncMeta;
  orderEnrichments?: ReadonlyArray<OutputDocumentDetailOrderEnrichment>;
  nfeEnrichments?: ReadonlyArray<OutputDocumentDetailNfeEnrichment>;
  financial?: OutputDocumentFinancialStatusResult | null;
  now?: Date;
  permissions?: {
    canViewFinancial?: boolean;
    canViewAudit?: boolean;
    canViewRaw?: boolean;
  };
  raw?: { document: unknown; items: unknown[] } | null;
  /**
   * Identidade comercial do produto (SKU/descrição/unidade) por item stage.
   * Extraída do rawJson do item — nunca inventada.
   */
  itemProductHints?: ReadonlyMap<
    string,
    {
      sku: string | null;
      productName: string | null;
      unitCode: string | null;
    }
  >;
}): OutputDocumentDetailPayload {
  const { resolved, projection, sync } = input;
  const doc = resolved.document;
  const generatedAt = (input.now ?? new Date()).toISOString();
  const orderById = new Map(
    (input.orderEnrichments ?? []).map((o) => [o.salesOrderId, o])
  );
  const canViewFinancial = input.permissions?.canViewFinancial === true;
  const canViewAudit = input.permissions?.canViewAudit === true;
  const canViewRaw = input.permissions?.canViewRaw === true;

  const items: OutputDocumentDetailItem[] = projection.items.map((item) => {
    const hint = input.itemProductHints?.get(item.stockDocumentItemId);
    return {
      id: item.stockDocumentItemId,
      externalItemId: item.externalItemId,
      externalProductId: item.externalProductId,
      sku: hint?.sku ?? null,
      productName: hint?.productName ?? null,
      unitCode: hint?.unitCode ?? null,
      quantity: item.quantityDocument,
      unitValue: item.unitValue,
      totalValue: item.totalValue,
      allocatedValue: item.allocatedValue,
      unallocatedBalance: moneyCentsToNumber(item.unallocatedBalanceCents),
      linkStatus: item.linkStatus,
      linkOrigin: item.linkOrigin,
      productLink: {
        externalProductId: item.externalProductId,
        hasProductId:
          item.externalProductId != null && item.externalProductId > 0,
      },
      links: item.links.map((link) => ({
        salesOrderId: link.salesOrderId,
        salesOrderItemId: link.salesOrderItemId,
        orderCode: link.orderCode,
        allocatedValue: moneyCentsToNumber(link.allocatedValueCents),
        quantityUsedForOrder: link.quantityUsedForOrder,
        source: link.source,
      })),
      alerts: [...item.alerts],
    };
  });

  const resolution = summarizeItemResolution(items);
  const itemsSum = items.reduce((s, i) => s + i.totalValue, 0);

  const orders = buildLinkedOrders(resolved, projection, orderById);
  const allocations = buildAllocationsSection(projection);
  const nfes = buildNfeSection(resolved, input.nfeEnrichments ?? []);
  const financial = canViewFinancial
    ? mapFinancialSection(input.financial ?? null)
    : null;
  const audit = canViewAudit ? buildAuditSection(resolved, sync) : null;
  const inconsistencies = collectInconsistencies({
    resolved,
    projection,
    financial: canViewFinancial ? input.financial ?? null : null,
    nfes,
  });

  return {
    document: {
      id: doc.id,
      externalId: doc.externalId,
      documentNumber: doc.documentNumber,
      tipoDocumentoEstoque: doc.tipoDocumentoEstoque,
      statusRaw: doc.statusRaw,
      cancellation: {
        isCancelled: doc.isCancelled,
        cancelledAt: toIso(sync.cancelledAt),
        reason: sync.cancellationReason,
      },
      company: {
        externalId: doc.companyExternalId,
        name: doc.companyName,
      },
      customer: {
        externalId: doc.personExternalId,
        name: doc.personName,
      },
      dataDocumento: toIso(doc.dataDocumento),
      movementDate: toIso(doc.movementDate),
      idNfe: doc.idNfe,
      paymentTermsRaw: doc.paymentTermsRaw,
      totalValue: moneyOrNull(doc.totalValue),
      sync: {
        syncedAt: toIsoRequired(sync.syncedAt),
        firstSeenAt: toIsoRequired(sync.firstSeenAt),
        lastSeenAt: toIsoRequired(sync.lastSeenAt),
        presentInLastPayload: sync.presentInLastPayload === true,
      },
    },
    items,
    values: {
      totalValue:
        projection.document.totalValueSource === "zero" &&
        moneyOrNull(doc.totalValue) == null
          ? null
          : projection.document.totalValue,
      totalValueSource: projection.document.totalValueSource,
      itemsSum: Math.round(itemsSum * 100) / 100,
      allocatedToOrders: projection.document.allocatedToAllOrders,
      unallocatedBalance: projection.document.unallocatedBalance,
      overAllocation: projection.document.overAllocation,
      coverageStatus: projection.document.coverageStatus,
    },
    resolution,
    orders,
    allocations,
    nfes,
    financial,
    audit,
    inconsistencies,
    raw: canViewRaw ? input.raw ?? null : null,
    permissions: {
      canViewFinancial,
      canViewAudit,
      canViewRaw,
    },
    generatedAt,
  };
}

export function buildLinkedOrders(
  resolved: ResolvedOutputDocument,
  projection: OutputDocumentAllocationProjection,
  orderById: Map<string, OutputDocumentDetailOrderEnrichment>
): OutputDocumentDetailLinkedOrder[] {
  const sourcesByOrder = new Map(
    resolved.orders.orders.map((o) => [o.salesOrderId, o.sources] as const)
  );
  const docTotal = projection.document.totalValue;

  const fromProjection = projection.linkedOrders.map((linked) => {
    const enrich = orderById.get(linked.salesOrderId);
    const sellerName =
      enrich?.nomusSellerName?.trim() ||
      enrich?.responsible?.trim() ||
      null;
    const coveragePercent =
      docTotal > 0
        ? Math.round((linked.allocatedValue / docTotal) * 10000) / 100
        : linked.allocatedValue > 0
          ? 100
          : null;

    return {
      salesOrderId: linked.salesOrderId,
      orderCode: linked.orderCode ?? enrich?.orderCode ?? null,
      issueDate: toIso(enrich?.issueDate ?? null),
      status: enrich?.status ?? null,
      officialSeller: {
        externalSellerId: enrich?.externalSellerId ?? null,
        name: sellerName,
      },
      orderValue: moneyOrNull(enrich?.totalNetValue),
      allocatedValue: linked.allocatedValue,
      coveragePercent,
      sources: sourcesByOrder.get(linked.salesOrderId) ?? ["order_to_cash_fact"],
    } satisfies OutputDocumentDetailLinkedOrder;
  });

  // Pedidos resolvidos sem alocação O2C ainda aparecem (valor alocado 0).
  for (const order of resolved.orders.orders) {
    if (fromProjection.some((o) => o.salesOrderId === order.salesOrderId)) {
      continue;
    }
    const enrich = orderById.get(order.salesOrderId);
    const sellerName =
      enrich?.nomusSellerName?.trim() ||
      enrich?.responsible?.trim() ||
      null;
    fromProjection.push({
      salesOrderId: order.salesOrderId,
      orderCode: order.orderCode ?? enrich?.orderCode ?? null,
      issueDate: toIso(enrich?.issueDate ?? null),
      status: enrich?.status ?? order.status,
      officialSeller: {
        externalSellerId: enrich?.externalSellerId ?? null,
        name: sellerName,
      },
      orderValue: moneyOrNull(enrich?.totalNetValue),
      allocatedValue: 0,
      coveragePercent: docTotal > 0 ? 0 : null,
      sources: order.sources,
    });
  }

  return fromProjection.sort((a, b) =>
    (a.orderCode ?? a.salesOrderId).localeCompare(
      b.orderCode ?? b.salesOrderId,
      "pt-BR",
      { numeric: true }
    )
  );
}

export function buildAllocationsSection(
  projection: OutputDocumentAllocationProjection
): OutputDocumentDetailAllocations {
  return {
    documentTotalValue: projection.document.totalValue,
    allocatedToOrders: projection.document.allocatedToAllOrders,
    unallocatedBalance: projection.document.unallocatedBalance,
    overAllocation: projection.document.overAllocation,
    coveragePercent: projection.document.coveragePercent,
    coverageStatus: projection.document.coverageStatus,
    orderShares: projection.orderShares.map((share) => ({
      salesOrderId: share.salesOrderId,
      orderCode: share.orderCode,
      allocatedValue: share.allocatedValue,
      shareOfDocumentPercent: share.shareOfDocumentPercent,
    })),
  };
}

export function buildNfeSection(
  resolved: ResolvedOutputDocument,
  enrichments: ReadonlyArray<OutputDocumentDetailNfeEnrichment>
): OutputDocumentDetailNfe[] {
  if (enrichments.length > 0) {
    return enrichments
      .map((nfe) => ({
        externalId: nfe.externalId,
        numero: nfe.numero,
        serie: nfe.serie,
        status: nfe.status,
        isCancelled: isNomusNfeCancelledStatus(nfe.status),
        dataEmissao: toIso(nfe.xmlDhEmi),
        dataProcessamento: toIso(nfe.dataProcessamento),
        totalValue: moneyOrNull(nfe.xmlVNF ?? nfe.valorLiquido),
        chaveMasked: maskNfeChave(nfe.chave),
        foundLocally: nfe.foundLocally,
        isPrimary: nfe.isPrimary,
        sources: [...nfe.sources],
      }))
      .sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        return a.externalId - b.externalId;
      });
  }

  // Fallback a partir do resolver (sem enrich completo).
  const primaryId = resolved.document.idNfe ?? resolved.nfe.externalId;
  if (primaryId == null && !resolved.nfe.record) return [];

  const record = resolved.nfe.record;
  const externalId = primaryId ?? record?.externalId;
  if (externalId == null) return [];

  return [
    {
      externalId,
      numero: record?.numero ?? null,
      serie: null,
      status: record?.status ?? null,
      isCancelled: isNomusNfeCancelledStatus(record?.status ?? null),
      dataEmissao: null,
      dataProcessamento: null,
      totalValue: null,
      chaveMasked: maskNfeChave(record?.chave),
      foundLocally: record?.foundLocally === true,
      isPrimary: true,
      sources: [...resolved.nfe.link.sources],
    },
  ];
}

export function mapFinancialSection(
  financial: OutputDocumentFinancialStatusResult | null
): OutputDocumentDetailFinancial | null {
  if (!financial) return null;
  return {
    status: financial.status,
    statusReasons: [...financial.statusReasons],
    financialOrigin: financial.financialOrigin,
    financialOriginReasons: [...financial.financialOriginReasons],
    receivableTotal: financial.receivableTotal,
    open: financial.open,
    received: financial.received,
    nextDueDate: financial.nextDueDate,
    installmentCount: financial.installmentCount,
    titles: financial.titles.map((t) => ({ ...t, alerts: [...t.alerts] })),
    documentPaymentTermsRaw: financial.documentPaymentTermsRaw,
    alerts: [...financial.alerts],
  };
}

export function buildAuditSection(
  resolved: ResolvedOutputDocument,
  sync: OutputDocumentDetailSyncMeta
): OutputDocumentDetailAudit {
  const conflicts: string[] = [];
  if (resolved.nfe.link.classification === "conflitante") {
    conflicts.push(...resolved.nfe.link.reasons);
  }
  if (resolved.orders.link.classification === "conflitante") {
    conflicts.push(...resolved.orders.link.reasons);
  }
  if (resolved.receivables.link.classification === "conflitante") {
    conflicts.push(...resolved.receivables.link.reasons);
  }

  return {
    stockDocumentId: resolved.document.id,
    stockDocumentExternalId: resolved.document.externalId,
    idNfe: resolved.document.idNfe,
    payloadHash: sync.payloadHash,
    firstSeenAt: toIsoRequired(sync.firstSeenAt),
    lastSeenAt: toIsoRequired(sync.lastSeenAt),
    presentInLastPayload: sync.presentInLastPayload === true,
    syncedAt: toIsoRequired(sync.syncedAt),
    nfeLink: {
      classification: resolved.nfe.link.classification,
      sources: [...resolved.nfe.link.sources],
      reasons: [...resolved.nfe.link.reasons],
    },
    ordersLink: {
      classification: resolved.orders.link.classification,
      sources: [...resolved.orders.link.sources],
      reasons: [...resolved.orders.link.reasons],
    },
    receivablesLink: {
      classification: resolved.receivables.link.classification,
      sources: [...resolved.receivables.link.sources],
      reasons: [...resolved.receivables.link.reasons],
    },
    o2cPresent: resolved.o2c.present,
    o2cRunIds: [...resolved.o2c.runIds],
    conflicts,
  };
}

export function collectInconsistencies(input: {
  resolved: ResolvedOutputDocument;
  projection: OutputDocumentAllocationProjection;
  financial: OutputDocumentFinancialStatusResult | null;
  nfes: ReadonlyArray<OutputDocumentDetailNfe>;
}): OutputDocumentDetailInconsistency[] {
  const list: OutputDocumentDetailInconsistency[] = [];
  const { resolved, projection, financial, nfes } = input;

  if (resolved.nfe.link.classification === "conflitante") {
    list.push({
      code: "NFE_LINK_CONFLICT",
      severity: "error",
      message:
        resolved.nfe.link.reasons[0] ??
        "Vínculo Documento → NF-e conflitante.",
    });
  }
  if (resolved.orders.link.classification === "conflitante") {
    list.push({
      code: "ORDER_LINK_CONFLICT",
      severity: "error",
      message:
        resolved.orders.link.reasons[0] ??
        "Vínculo Documento → Pedido(s) conflitante.",
    });
  }
  if (resolved.nfe.link.classification === "nao_resolvido") {
    list.push({
      code: "NFE_UNRESOLVED",
      severity: "warning",
      message: "Documento sem NF-e resolvida por evidência oficial.",
    });
  }
  if (resolved.orders.link.classification === "nao_resolvido") {
    list.push({
      code: "ORDER_UNRESOLVED",
      severity: "info",
      message: "Nenhum pedido vinculado por evidência oficial.",
    });
  }
  if (projection.document.coverageStatus === "superalocado") {
    list.push({
      code: "OVER_ALLOCATION",
      severity: "warning",
      message: "Alocações a pedidos excedem o total do documento.",
    });
  }
  for (const item of projection.items) {
    if (item.linkStatus === "conflict") {
      list.push({
        code: "ITEM_LINK_CONFLICT",
        severity: "error",
        message: `Item ${item.stockDocumentItemId} com vínculo conflitante.`,
      });
    }
  }
  for (const nfe of nfes) {
    if (nfe.isCancelled) {
      list.push({
        code: "NFE_CANCELLED",
        severity: "warning",
        message: `NF-e ${nfe.numero ?? nfe.externalId} cancelada.`,
      });
    }
    if (!nfe.foundLocally) {
      list.push({
        code: "NFE_MISSING_LOCAL",
        severity: "warning",
        message: `NF-e ${nfe.externalId} referenciada, mas ausente no stage local.`,
      });
    }
  }
  if (resolved.document.isCancelled) {
    list.push({
      code: "DOCUMENT_CANCELLED",
      severity: "info",
      message: "Documento de Saída marcado como cancelado no stage.",
    });
  }
  if (financial?.status === "aguardando_cr") {
    list.push({
      code: "AWAITING_RECEIVABLE",
      severity: "info",
      message: "NF presente sem Contas a Receber correspondente.",
    });
  }
  if (nfes.length > 1) {
    list.push({
      code: "MULTIPLE_NFES",
      severity: "warning",
      message: `Múltiplas NF-es observadas para o documento (${nfes.length}).`,
    });
  }

  // Dedup por code+message
  const seen = new Set<string>();
  return list.filter((row) => {
    const key = `${row.code}:${row.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function summarizeItemResolution(
  items: ReadonlyArray<Pick<OutputDocumentDetailItem, "linkStatus">>
): OutputDocumentDetailResolution {
  let itemsResolved = 0;
  let itemsUnresolved = 0;
  let itemsPartial = 0;
  let itemsConflict = 0;

  for (const item of items) {
    switch (item.linkStatus) {
      case "resolved":
        itemsResolved += 1;
        break;
      case "partial":
        itemsPartial += 1;
        break;
      case "conflict":
        itemsConflict += 1;
        break;
      default:
        itemsUnresolved += 1;
        break;
    }
  }

  return {
    listedFromStage: true,
    dependsOnO2cForListing: false,
    itemCount: items.length,
    itemsResolved,
    itemsUnresolved,
    itemsPartial,
    itemsConflict,
  };
}

/** Aceita UUID interno ou externalId numérico. */
export function parseOutputDocumentDetailIdParam(
  raw: string | undefined | null
):
  | { kind: "uuid"; value: string }
  | { kind: "externalId"; value: number }
  | { kind: "invalid"; message: string } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return { kind: "invalid", message: "Identificador do documento ausente." };
  }

  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRe.test(value)) {
    return { kind: "uuid", value: value.toLowerCase() };
  }

  if (/^\d+$/.test(value)) {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n) && n > 0) {
      return { kind: "externalId", value: n };
    }
  }

  return {
    kind: "invalid",
    message: "Identificador do documento inválido.",
  };
}

export function safeMoneyOrZero(value: unknown): number {
  return moneyOrZero(value);
}

/**
 * Coleta IDs de NF candidatos a partir do resolved + extras do stage/O2C.
 */
export function collectRelatedNfeExternalIds(
  resolved: ResolvedOutputDocument,
  extraIds: ReadonlyArray<number | null | undefined> = []
): number[] {
  const ids = new Set<number>();
  const push = (value: number | null | undefined) => {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      ids.add(Math.trunc(value));
    }
  };
  push(resolved.document.idNfe);
  push(resolved.nfe.externalId);
  for (const extra of extraIds) push(extra);
  return [...ids].sort((a, b) => a - b);
}
