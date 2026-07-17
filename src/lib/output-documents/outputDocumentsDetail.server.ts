/**
 * DS-04.2 — Loader Prisma read-only do detalhe geral + itens.
 * Documento é encontrado no stage (NomusStockDocument), sem depender do O2C.
 * Sem rawJson por padrão.
 */

import type { PrismaClient } from "@prisma/client";
import { NOMUS_STOCK_DOCUMENT_TIPO_SAIDA } from "@/src/lib/output-documents/auditOutputDocumentsDb.js";
import {
  loadOutputDocumentByExternalId,
} from "@/src/lib/output-documents/nomusOutputDocumentResolver.server.js";
import {
  allocationLinesFromResolvedO2c,
  projectOutputDocumentAllocation,
} from "@/src/lib/output-documents/outputDocumentAllocationProjection.js";
import {
  buildOutputDocumentDetailPayload,
  parseOutputDocumentDetailIdParam,
  type OutputDocumentDetailSyncMeta,
} from "@/src/lib/output-documents/outputDocumentsDetail.js";
import type { OutputDocumentDetailPayload } from "@/src/lib/output-documents/outputDocumentsDetailTypes.js";

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
    },
  };
}

/**
 * Carrega detalhe geral + itens. Retorna null se não existir no stage.
 * O2C só enriquece resolução/alocação dos itens — não é requisito de listagem.
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

  return buildOutputDocumentDetailPayload({
    resolved,
    projection,
    sync: lookup.sync,
    now: options.now,
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
