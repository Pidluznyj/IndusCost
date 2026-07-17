/**
 * DS-03.7 — Loader Prisma read-only do resolver canônico de Documento de Saída.
 * Não cria vínculos. Não consulta Nomus HTTP.
 */

import type { PrismaClient } from "@prisma/client";
import { NOMUS_STOCK_DOCUMENT_TIPO_SAIDA } from "@/src/lib/output-documents/auditOutputDocumentsDb.js";
import {
  mapStageDocumentHeader,
  mapStageDocumentItem,
  parseReceivableIdsJson,
  resolveOutputDocument,
  type OutputDocumentO2cFactEvidence,
  type OutputDocumentReceivableEvidence,
  type OutputDocumentResolveEvidence,
  type OutputDocumentSalesOrderEvidence,
  type OutputDocumentSalesOrderItemEvidence,
  type OutputDocumentSalesOrderNfeLinkEvidence,
  type ResolvedOutputDocument,
} from "@/src/lib/output-documents/nomusOutputDocumentResolver.js";

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

const DOCUMENT_SELECT = {
  id: true,
  externalId: true,
  idNfe: true,
  tipoDocumentoEstoque: true,
  dataDocumento: true,
  documentNumber: true,
  statusRaw: true,
  isCancelled: true,
  totalValue: true,
  personExternalId: true,
  personName: true,
  companyExternalId: true,
  companyName: true,
  movementDate: true,
  paymentTermsRaw: true,
} as const;

const ITEM_SELECT = {
  id: true,
  externalItemId: true,
  externalProductId: true,
  quantity: true,
  unitValue: true,
  estimatedTotalValue: true,
} as const;

export type LoadOutputDocumentOptions = {
  /** Quando informado, restringe fatos O2C a este run. */
  runId?: string | null;
  /** Inclui apenas tipo DocumentoSaida (padrão true). */
  onlySaida?: boolean;
};

async function loadRelatedEvidence(
  prisma: PrismaLike,
  document: {
    id: string;
    externalId: number;
    idNfe: number | null;
  },
  options: LoadOutputDocumentOptions
): Promise<Omit<OutputDocumentResolveEvidence, "document" | "items">> {
  const runId = options.runId?.trim() || null;
  const idNfe = document.idNfe;

  const [nfeRow, links, o2cRows, receivables] = await Promise.all([
    idNfe != null
      ? prisma.nomusNfe.findUnique({
          where: { externalId: idNfe },
          select: {
            id: true,
            externalId: true,
            numero: true,
            chave: true,
            status: true,
          },
        })
      : Promise.resolve(null),
    idNfe != null
      ? prisma.salesOrderNfeLink.findMany({
          where: { nfeExternalId: idNfe },
          select: {
            id: true,
            salesOrderId: true,
            orderCode: true,
            nfeExternalId: true,
          },
        })
      : Promise.resolve([]),
    prisma.orderToCashAuditFact.findMany({
      where: runId
        ? { stockDocumentExternalId: document.externalId, runId }
        : { stockDocumentExternalId: document.externalId },
      select: {
        runId: true,
        salesOrderId: true,
        orderCode: true,
        salesOrderItemId: true,
        nfeExternalId: true,
        stockDocumentExternalId: true,
        stockDocumentIdNfe: true,
        stockDocumentItemId: true,
        allocatedValueByDocumentPrice: true,
        quantityUsedForOrder: true,
        receivableIdsJson: true,
      },
    }),
    idNfe != null
      ? prisma.nomusAccountsReceivable.findMany({
          where: { sourceInvoiceId: idNfe },
          select: {
            id: true,
            externalId: true,
            sourceInvoiceId: true,
            amountReceivable: true,
            balanceReceivable: true,
            status: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const linkEvidence: OutputDocumentSalesOrderNfeLinkEvidence[] = links.map(
    (link) => ({
      linkId: link.id,
      salesOrderId: link.salesOrderId,
      orderCode: link.orderCode,
      nfeExternalId: link.nfeExternalId,
    })
  );

  const o2cEvidence: OutputDocumentO2cFactEvidence[] = o2cRows.map((row) => ({
    runId: row.runId,
    salesOrderId: row.salesOrderId,
    orderCode: row.orderCode,
    salesOrderItemId: row.salesOrderItemId,
    nfeExternalId: row.nfeExternalId,
    stockDocumentExternalId: row.stockDocumentExternalId,
    stockDocumentIdNfe: row.stockDocumentIdNfe,
    stockDocumentItemId: row.stockDocumentItemId,
    allocatedValueByDocumentPrice:
      row.allocatedValueByDocumentPrice?.toString() ?? null,
    quantityUsedForOrder: row.quantityUsedForOrder?.toString() ?? null,
    receivableIds: parseReceivableIdsJson(row.receivableIdsJson),
  }));

  const orderIds = [
    ...new Set([
      ...linkEvidence.map((l) => l.salesOrderId),
      ...o2cEvidence
        .map((f) => f.salesOrderId)
        .filter((id): id is string => Boolean(id)),
    ]),
  ];

  const [salesOrders, salesOrderItems] = await Promise.all([
    orderIds.length > 0
      ? prisma.salesOrder.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderCode: true, status: true },
        })
      : Promise.resolve([]),
    orderIds.length > 0
      ? prisma.salesOrderItem.findMany({
          where: { salesOrderId: { in: orderIds } },
          select: {
            id: true,
            salesOrderId: true,
            externalProductId: true,
            nomusItemExternalId: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const salesOrderEvidence: OutputDocumentSalesOrderEvidence[] = salesOrders.map(
    (row) => ({
      id: row.id,
      orderCode: row.orderCode,
      status: row.status != null ? String(row.status) : null,
    })
  );

  const salesOrderItemEvidence: OutputDocumentSalesOrderItemEvidence[] =
    salesOrderItems.map((row) => ({
      id: row.id,
      salesOrderId: row.salesOrderId,
      externalProductId: row.externalProductId,
      nomusItemExternalId: row.nomusItemExternalId,
    }));

  const receivableEvidence: OutputDocumentReceivableEvidence[] = receivables.map(
    (row) => ({
      id: row.id,
      externalId: row.externalId,
      sourceInvoiceId: row.sourceInvoiceId,
      amountReceivable: row.amountReceivable?.toString() ?? null,
      balanceReceivable: row.balanceReceivable?.toString() ?? null,
      status: row.status,
    })
  );

  return {
    nfe:
      idNfe != null
        ? {
            externalId: idNfe,
            id: nfeRow?.id ?? null,
            numero: nfeRow?.numero ?? null,
            chave: nfeRow?.chave ?? null,
            status: nfeRow?.status ?? null,
            foundLocally: nfeRow != null,
          }
        : null,
    salesOrderNfeLinks: linkEvidence,
    salesOrders: salesOrderEvidence,
    salesOrderItems: salesOrderItemEvidence,
    o2cFacts: o2cEvidence,
    receivables: receivableEvidence,
  };
}

async function resolveFromStageRow(
  prisma: PrismaLike,
  row: {
    id: string;
    externalId: number;
    idNfe: number | null;
    tipoDocumentoEstoque: string | null;
    dataDocumento: Date | null;
    documentNumber: string | null;
    statusRaw: string | null;
    isCancelled: boolean;
    totalValue: { toString(): string } | string | null;
    personExternalId: number | null;
    personName: string | null;
    companyExternalId: number | null;
    companyName: string | null;
    movementDate: Date | null;
    paymentTermsRaw: string | null;
  },
  options: LoadOutputDocumentOptions
): Promise<ResolvedOutputDocument> {
  const items = await prisma.nomusStockDocumentItem.findMany({
    where: { stockDocumentId: row.id },
    select: ITEM_SELECT,
    orderBy: { createdAt: "asc" },
  });

  const related = await loadRelatedEvidence(
    prisma,
    { id: row.id, externalId: row.externalId, idNfe: row.idNfe },
    options
  );

  return resolveOutputDocument({
    document: mapStageDocumentHeader(row),
    items: items.map(mapStageDocumentItem),
    ...related,
  });
}

/**
 * Localiza um Documento de Saída no stage por externalId e resolve o grafo.
 */
export async function loadOutputDocumentByExternalId(
  prisma: PrismaLike,
  externalId: number,
  options: LoadOutputDocumentOptions = {}
): Promise<ResolvedOutputDocument | null> {
  const onlySaida = options.onlySaida !== false;
  const row = await prisma.nomusStockDocument.findFirst({
    where: {
      externalId,
      ...(onlySaida
        ? { tipoDocumentoEstoque: NOMUS_STOCK_DOCUMENT_TIPO_SAIDA }
        : {}),
    },
    select: DOCUMENT_SELECT,
  });
  if (!row) return null;
  return resolveFromStageRow(prisma, row, options);
}

/**
 * Lista Documentos de Saída do stage com o mesmo idNfe (dedupe por documento).
 */
export async function loadOutputDocumentsByIdNfe(
  prisma: PrismaLike,
  idNfe: number,
  options: LoadOutputDocumentOptions = {}
): Promise<ResolvedOutputDocument[]> {
  const onlySaida = options.onlySaida !== false;
  const rows = await prisma.nomusStockDocument.findMany({
    where: {
      idNfe,
      ...(onlySaida
        ? { tipoDocumentoEstoque: NOMUS_STOCK_DOCUMENT_TIPO_SAIDA }
        : {}),
    },
    select: DOCUMENT_SELECT,
    orderBy: { externalId: "asc" },
  });

  const resolved: ResolvedOutputDocument[] = [];
  for (const row of rows) {
    resolved.push(await resolveFromStageRow(prisma, row, options));
  }
  return resolved;
}

/**
 * Descobre documentos do stage ligados a um pedido via SalesOrderNfeLink → idNfe.
 * O2C entra só como overlay de alocação; documentos sem O2C ainda aparecem.
 */
export async function loadOutputDocumentsForSalesOrder(
  prisma: PrismaLike,
  salesOrderId: string,
  options: LoadOutputDocumentOptions = {}
): Promise<ResolvedOutputDocument[]> {
  const onlySaida = options.onlySaida !== false;
  const runId = options.runId?.trim() || null;

  const links = await prisma.salesOrderNfeLink.findMany({
    where: { salesOrderId },
    select: { nfeExternalId: true },
  });
  const nfeIds = [
    ...new Set(
      links
        .map((l) => l.nfeExternalId)
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];

  const stageRows =
    nfeIds.length > 0
      ? await prisma.nomusStockDocument.findMany({
          where: {
            idNfe: { in: nfeIds },
            ...(onlySaida
              ? { tipoDocumentoEstoque: NOMUS_STOCK_DOCUMENT_TIPO_SAIDA }
              : {}),
          },
          select: DOCUMENT_SELECT,
          orderBy: { externalId: "asc" },
        })
      : [];

  const byExternalId = new Map(stageRows.map((row) => [row.externalId, row]));

  // Overlay: documentos citados em O2C que já estão no stage (não inventa fora do stage).
  const o2cRows = await prisma.orderToCashAuditFact.findMany({
    where: runId ? { salesOrderId, runId } : { salesOrderId },
    select: { stockDocumentExternalId: true },
  });
  const o2cDocIds = [
    ...new Set(
      o2cRows
        .map((r) => r.stockDocumentExternalId)
        .filter((id): id is number => typeof id === "number" && id > 0)
    ),
  ].filter((id) => !byExternalId.has(id));

  if (o2cDocIds.length > 0) {
    const extra = await prisma.nomusStockDocument.findMany({
      where: {
        externalId: { in: o2cDocIds },
        ...(onlySaida
          ? { tipoDocumentoEstoque: NOMUS_STOCK_DOCUMENT_TIPO_SAIDA }
          : {}),
      },
      select: DOCUMENT_SELECT,
    });
    for (const row of extra) {
      byExternalId.set(row.externalId, row);
    }
  }

  const rows = [...byExternalId.values()].sort(
    (a, b) => a.externalId - b.externalId
  );
  const resolved: ResolvedOutputDocument[] = [];
  for (const row of rows) {
    resolved.push(await resolveFromStageRow(prisma, row, options));
  }
  return resolved;
}
