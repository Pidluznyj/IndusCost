/**
 * DS-04.2 / DS-04.3 — Loader Prisma read-only do detalhe de Documento de Saída.
 * Documento é encontrado no stage (NomusStockDocument), sem depender do O2C.
 * Sem rawJson por padrão.
 */

import type { PrismaClient } from "@prisma/client";
import { NOMUS_STOCK_DOCUMENT_TIPO_SAIDA } from "@/src/lib/output-documents/auditOutputDocumentsDb.js";
import type { LinkSourceKind } from "@/src/lib/output-documents/auditOutputDocumentsLinks.js";
import {
  loadOutputDocumentByExternalId,
} from "@/src/lib/output-documents/nomusOutputDocumentResolver.server.js";
import {
  allocationLinesFromResolvedO2c,
  projectOutputDocumentAllocation,
} from "@/src/lib/output-documents/outputDocumentAllocationProjection.js";
import { resolveOutputDocumentFinancialStatus } from "@/src/lib/output-documents/outputDocumentFinancialStatusResolver.js";
import {
  buildOutputDocumentDetailPayload,
  collectRelatedNfeExternalIds,
  parseOutputDocumentDetailIdParam,
  type OutputDocumentDetailNfeEnrichment,
  type OutputDocumentDetailOrderEnrichment,
  type OutputDocumentDetailSyncMeta,
} from "@/src/lib/output-documents/outputDocumentsDetail.js";
import type { OutputDocumentDetailPayload } from "@/src/lib/output-documents/outputDocumentsDetailTypes.js";
import type { ResolvedOutputDocument } from "@/src/lib/output-documents/nomusOutputDocumentResolver.js";
import { extractOutputDocumentItemProductIdentity } from "@/src/lib/output-documents/outputDocumentItemProductIdentity.js";

type PrismaLike = Pick<
  PrismaClient,
  | "nomusStockDocument"
  | "nomusStockDocumentItem"
  | "nomusNfe"
  | "salesOrderNfeLink"
  | "salesOrder"
  | "salesOrderItem"
  | "orderToCashAuditFact"
  | "nomusAccountsReceivable"
>;

const DETAIL_LOOKUP_SELECT = {
  id: true,
  externalId: true,
  tipoDocumentoEstoque: true,
  syncedAt: true,
  firstSeenAt: true,
  lastSeenAt: true,
  presentInLastPayload: true,
  cancelledAt: true,
  cancellationReason: true,
  payloadHash: true,
} as const;

export class OutputDocumentDetailNotFoundError extends Error {
  constructor(message = "Documento de Saída não encontrado.") {
    super(message);
    this.name = "OutputDocumentDetailNotFoundError";
  }
}

export class OutputDocumentDetailInvalidIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutputDocumentDetailInvalidIdError";
  }
}

export type LoadOutputDocumentDetailOptions = {
  prisma: PrismaLike;
  /** Quando false, aceita qualquer tipo de stock document. Padrão: só DocumentoSaida. */
  onlySaida?: boolean;
  now?: Date;
  referenceDate?: Date;
  permissions?: {
    canViewFinancial?: boolean;
    canViewAudit?: boolean;
    canViewRaw?: boolean;
  };
  includeRaw?: boolean;
};

async function findStageLookup(
  prisma: PrismaLike,
  idParam: string,
  onlySaida: boolean
): Promise<{
  id: string;
  externalId: number;
  sync: OutputDocumentDetailSyncMeta;
} | null> {
  const parsed = parseOutputDocumentDetailIdParam(idParam);
  if (parsed.kind === "invalid") {
    throw new OutputDocumentDetailInvalidIdError(parsed.message);
  }

  const tipoFilter = onlySaida
    ? { tipoDocumentoEstoque: NOMUS_STOCK_DOCUMENT_TIPO_SAIDA }
    : {};

  const row =
    parsed.kind === "uuid"
      ? await prisma.nomusStockDocument.findFirst({
          where: { id: parsed.value, ...tipoFilter },
          select: DETAIL_LOOKUP_SELECT,
        })
      : await prisma.nomusStockDocument.findFirst({
          where: { externalId: parsed.value, ...tipoFilter },
          select: DETAIL_LOOKUP_SELECT,
        });

  if (!row) return null;

  return {
    id: row.id,
    externalId: row.externalId,
    sync: {
      syncedAt: row.syncedAt,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      presentInLastPayload: row.presentInLastPayload,
      cancelledAt: row.cancelledAt,
      cancellationReason: row.cancellationReason,
      payloadHash: row.payloadHash,
    },
  };
}

async function loadOrderEnrichments(
  prisma: PrismaLike,
  salesOrderIds: string[]
): Promise<OutputDocumentDetailOrderEnrichment[]> {
  if (salesOrderIds.length === 0) return [];
  const rows = await prisma.salesOrder.findMany({
    where: { id: { in: salesOrderIds } },
    select: {
      id: true,
      orderCode: true,
      issueDate: true,
      status: true,
      externalSellerId: true,
      nomusSellerName: true,
      responsible: true,
      totalNetValue: true,
    },
  });
  return rows.map((row) => ({
    salesOrderId: row.id,
    orderCode: row.orderCode,
    issueDate: row.issueDate,
    status: row.status != null ? String(row.status) : null,
    externalSellerId: row.externalSellerId,
    nomusSellerName: row.nomusSellerName,
    responsible: row.responsible,
    totalNetValue: row.totalNetValue,
  }));
}

async function loadRelatedNfeIds(
  prisma: PrismaLike,
  resolved: ResolvedOutputDocument
): Promise<number[]> {
  const o2cRows = await prisma.orderToCashAuditFact.findMany({
    where: { stockDocumentExternalId: resolved.document.externalId },
    select: {
      nfeExternalId: true,
      stockDocumentIdNfe: true,
    },
    take: 5000,
  });

  const linkNfeIds =
    resolved.document.idNfe != null
      ? (
          await prisma.salesOrderNfeLink.findMany({
            where: { nfeExternalId: resolved.document.idNfe },
            select: { nfeExternalId: true },
            take: 500,
          })
        ).map((l) => l.nfeExternalId)
      : [];

  return collectRelatedNfeExternalIds(resolved, [
    ...o2cRows.map((r) => r.nfeExternalId),
    ...o2cRows.map((r) => r.stockDocumentIdNfe),
    ...linkNfeIds,
  ]);
}

async function loadNfeEnrichments(
  prisma: PrismaLike,
  resolved: ResolvedOutputDocument,
  nfeIds: number[]
): Promise<OutputDocumentDetailNfeEnrichment[]> {
  if (nfeIds.length === 0) return [];

  const rows = await prisma.nomusNfe.findMany({
    where: { externalId: { in: nfeIds } },
    select: {
      id: true,
      externalId: true,
      numero: true,
      serie: true,
      status: true,
      chave: true,
      xmlDhEmi: true,
      dataProcessamento: true,
      valorLiquido: true,
      xmlVNF: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.externalId, r]));
  const primaryId = resolved.document.idNfe;

  return nfeIds.map((externalId) => {
    const row = byId.get(externalId);
    const sources: LinkSourceKind[] = [];
    if (primaryId === externalId) sources.push("stock_document_idNfe");
    if (
      resolved.nfe.link.sources.includes("order_to_cash_fact") ||
      primaryId !== externalId
    ) {
      // secondary ids typically from O2C/conflict set
      if (!sources.includes("order_to_cash_fact") && primaryId !== externalId) {
        sources.push("order_to_cash_fact");
      }
    }
    if (sources.length === 0) {
      sources.push(...resolved.nfe.link.sources);
    }

    return {
      externalId,
      id: row?.id ?? null,
      numero: row?.numero ?? null,
      serie: row?.serie ?? null,
      status: row?.status ?? null,
      chave: row?.chave ?? null,
      xmlDhEmi: row?.xmlDhEmi ?? null,
      dataProcessamento: row?.dataProcessamento ?? null,
      valorLiquido: row?.valorLiquido ?? null,
      xmlVNF: row?.xmlVNF ?? null,
      foundLocally: row != null,
      sources,
      isPrimary: primaryId != null ? primaryId === externalId : nfeIds[0] === externalId,
    };
  });
}

async function loadFinancialForDetail(
  prisma: PrismaLike,
  resolved: ResolvedOutputDocument,
  nfeEnrichments: ReadonlyArray<OutputDocumentDetailNfeEnrichment>,
  referenceDate?: Date
) {
  const primary =
    nfeEnrichments.find((n) => n.isPrimary) ??
    nfeEnrichments[0] ??
    null;
  const idNfe = resolved.document.idNfe ?? primary?.externalId ?? null;

  const receivables =
    idNfe != null
      ? await prisma.nomusAccountsReceivable.findMany({
          where: { sourceInvoiceId: idNfe },
          select: {
            id: true,
            externalId: true,
            sourceInvoiceId: true,
            amountReceivable: true,
            amountReceived: true,
            balanceReceivable: true,
            dueDate: true,
            settlementDate: true,
            status: true,
          },
        })
      : [];

  return resolveOutputDocumentFinancialStatus({
    stockDocumentExternalId: resolved.document.externalId,
    idNfe,
    isCancelled: resolved.document.isCancelled,
    paymentTermsRaw: resolved.document.paymentTermsRaw,
    documentTotalValue: resolved.document.totalValue,
    nfeValue: primary?.xmlVNF ?? primary?.valorLiquido ?? null,
    nfeStatus: primary?.status ?? resolved.nfe.record?.status ?? null,
    receivables,
    referenceDate,
  });
}

/**
 * Carrega detalhe completo. Retorna null se não existir no stage.
 * O2C só enriquece relações — não é requisito para achar o documento.
 */
export async function loadOutputDocumentDetail(
  idParam: string,
  options: LoadOutputDocumentDetailOptions
): Promise<OutputDocumentDetailPayload | null> {
  const onlySaida = options.onlySaida !== false;
  const lookup = await findStageLookup(options.prisma, idParam, onlySaida);
  if (!lookup) return null;

  const resolved = await loadOutputDocumentByExternalId(
    options.prisma,
    lookup.externalId,
    { onlySaida }
  );
  if (!resolved) return null;

  const orderItemHints = resolved.orders.orders.flatMap((order) =>
    order.items.map((item) => ({
      salesOrderItemId: item.id,
      salesOrderId: item.salesOrderId,
      orderCode: order.orderCode,
      externalProductId: item.externalProductId,
    }))
  );

  const allocationLines = allocationLinesFromResolvedO2c(
    resolved.o2c.allocationLines,
    resolved.items.map((item) => ({
      stockDocumentItemId: item.id,
      externalProductId: item.externalProductId,
    }))
  );

  const projection = projectOutputDocumentAllocation({
    document: {
      id: resolved.document.id,
      externalId: resolved.document.externalId,
      idNfe: resolved.document.idNfe,
      totalValue: resolved.document.totalValue,
      items: resolved.items.map((item) => ({
        id: item.id,
        externalItemId: item.externalItemId,
        externalProductId: item.externalProductId,
        quantity: item.quantity,
        unitValue: item.unitValue,
        estimatedTotalValue: item.estimatedTotalValue,
      })),
    },
    allocationLines,
    orderItemHints,
  });

  const orderIds = [
    ...new Set([
      ...resolved.orders.orders.map((o) => o.salesOrderId),
      ...projection.linkedOrders.map((o) => o.salesOrderId),
    ]),
  ];

  const nfeIds = await loadRelatedNfeIds(options.prisma, resolved);
  const [orderEnrichments, nfeEnrichments] = await Promise.all([
    loadOrderEnrichments(options.prisma, orderIds),
    loadNfeEnrichments(options.prisma, resolved, nfeIds),
  ]);

  const financial = await loadFinancialForDetail(
    options.prisma,
    resolved,
    nfeEnrichments,
    options.referenceDate ?? options.now
  );

  const canViewRaw = options.permissions?.canViewRaw === true;
  const includeRaw = options.includeRaw === true && canViewRaw;

  const itemRaws = await options.prisma.nomusStockDocumentItem.findMany({
    where: { stockDocumentId: lookup.id },
    select: { id: true, rawJson: true },
    orderBy: { createdAt: "asc" },
  });
  const itemProductHints = new Map(
    itemRaws.map((row) => [
      row.id,
      extractOutputDocumentItemProductIdentity(row.rawJson),
    ])
  );

  let raw: { document: unknown; items: unknown[] } | null = null;
  if (includeRaw) {
    const docRaw = await options.prisma.nomusStockDocument.findUnique({
      where: { id: lookup.id },
      select: { rawJson: true },
    });
    raw = {
      document: docRaw?.rawJson ?? null,
      items: itemRaws.map((row) => ({
        id: row.id,
        rawJson: row.rawJson,
      })),
    };
  }

  return buildOutputDocumentDetailPayload({
    resolved,
    projection,
    sync: lookup.sync,
    orderEnrichments,
    nfeEnrichments,
    financial,
    now: options.now,
    permissions: {
      canViewFinancial: options.permissions?.canViewFinancial === true,
      canViewAudit: options.permissions?.canViewAudit === true,
      canViewRaw,
    },
    raw,
    itemProductHints,
  });
}

/**
 * Wrapper para rotas: null → not found; invalid id → throw tipado.
 */
export async function loadOutputDocumentDetailOrThrow(
  idParam: string,
  options: LoadOutputDocumentDetailOptions
): Promise<OutputDocumentDetailPayload> {
  const payload = await loadOutputDocumentDetail(idParam, options);
  if (!payload) {
    throw new OutputDocumentDetailNotFoundError();
  }
  return payload;
}
