import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";

type JsonObject = Record<string, unknown>;

export type ExtractedSalesOrderNfe = {
  nfeExternalId: number;
  nfeNumber: string | null;
  nfeSerie: string | null;
  nfeKey: string | null;
  nfeStatus: number | null;
  tipoOperacao: number | null;
  tipoEmissao: number | null;
  dataProcessamento: Date | null;
  horaProcessamento: string | null;
  cnpjEmitente: string | null;
  protocolo: string | null;
  recibo: string | null;
  usuario: string | null;
  ambiente: number | null;
  finalidade: number | null;
  isFornecedor: number | null;
  rawPayload: JsonObject;
};

export type SalesOrderNfeLinkUpsertInput = {
  id: string;
  externalSalesOrderId?: number | null;
  externalSalesOrderCode?: string | null;
  orderCode?: string | null;
  nomusRawResponse?: unknown;
};

export type SalesOrderNfeLinkUpsertResult = {
  created: number;
  updated: number;
  markedAbsent: number;
  matchedNomusNfe: number;
  unmatchedNomusNfe: number;
};

export type SalesOrderNfeLinkDiagnostic = {
  totalOrders: number;
  ordersWithNfesInPayload: number;
  ordersWithoutNfesInPayload: number;
  totalLinks: number;
  linksWithNomusNfeMatch: number;
  linksWithoutNomusNfeMatch: number;
  ordersWithMultipleNfes: number;
  ordersWithNfesInPayloadButNoLinks: number;
  linksPresentInLastPayload: number;
  linksAbsentFromLastPayload: number;
  examples: {
    multiNfeOrders: Array<{ orderCode: string | null; nfeCount: number }>;
    payloadWithoutLinks: Array<{ orderCode: string | null; salesOrderId: string; nfeCount: number }>;
    unmatchedLinks: Array<{ orderCode: string | null; nfeExternalId: number; nfeNumber: string | null }>;
  };
};

type DbClient = Prisma.TransactionClient | PrismaClient;

function asObject(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d-]/g, "");
    if (!normalized) return null;
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseNomusNfeProcessingDate(input: unknown): Date | null {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input;
  if (typeof input !== "string") return null;

  const raw = input.trim();
  if (!raw) return null;

  const br = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (br) {
    const dd = Number.parseInt(br[1], 10);
    const mm = Number.parseInt(br[2], 10);
    const yearRaw = Number.parseInt(br[3], 10);
    const yyyy = br[3].length === 2 ? 2000 + yearRaw : yearRaw;
    const hh = Number.parseInt(br[4] ?? "0", 10);
    const mi = Number.parseInt(br[5] ?? "0", 10);
    const ss = Number.parseInt(br[6] ?? "0", 10);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const parsed = new Date(yyyy, mm - 1, dd, hh, mi, ss);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const iso = new Date(raw);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function mapNomusNfeRecord(raw: JsonObject): ExtractedSalesOrderNfe | null {
  const nfeExternalId = toInt(raw.id);
  if (nfeExternalId == null) return null;

  return {
    nfeExternalId,
    nfeNumber:
      asString(raw.numero) ?? (raw.numero != null && raw.numero !== "" ? String(raw.numero) : null),
    nfeSerie: asString(raw.serie) ?? (raw.serie != null && raw.serie !== "" ? String(raw.serie) : null),
    nfeKey: asString(raw.chave) ?? asString(raw.chaveAcesso) ?? asString(raw.chNFe),
    nfeStatus: toInt(raw.status),
    tipoOperacao: toInt(raw.tipoOperacao),
    tipoEmissao: toInt(raw.tipoEmissao),
    dataProcessamento: parseNomusNfeProcessingDate(raw.dataProcessamento),
    horaProcessamento: asString(raw.horaProcessamento),
    cnpjEmitente: asString(raw.cnpjEmitente),
    protocolo: asString(raw.protocolo),
    recibo: asString(raw.recibo),
    usuario: asString(raw.usuario),
    ambiente: toInt(raw.ambiente),
    finalidade: toInt(raw.finalidade),
    isFornecedor: toInt(raw.isFornecedor),
    rawPayload: raw,
  };
}

export function extractSalesOrderNfesFromNomusPayload(payload: unknown): ExtractedSalesOrderNfe[] {
  const root = asObject(payload);
  if (!root || !Array.isArray(root.nfes)) return [];

  const byId = new Map<number, ExtractedSalesOrderNfe>();
  for (const entry of root.nfes) {
    const obj = asObject(entry);
    if (!obj) continue;
    const mapped = mapNomusNfeRecord(obj);
    if (!mapped) continue;
    byId.set(mapped.nfeExternalId, mapped);
  }
  return [...byId.values()];
}

export function buildSalesOrderNfeLinkWriteData(
  salesOrder: SalesOrderNfeLinkUpsertInput,
  nfe: ExtractedSalesOrderNfe,
  nomusNfeId: string | null,
  now: Date
): Prisma.SalesOrderNfeLinkUncheckedCreateInput {
  return {
    salesOrderId: salesOrder.id,
    externalSalesOrderId: salesOrder.externalSalesOrderId ?? null,
    externalSalesOrderCode: salesOrder.externalSalesOrderCode ?? null,
    orderCode: salesOrder.orderCode ?? null,
    nfeExternalId: nfe.nfeExternalId,
    nfeNumber: nfe.nfeNumber,
    nfeSerie: nfe.nfeSerie,
    nfeKey: nfe.nfeKey,
    nfeStatus: nfe.nfeStatus,
    tipoOperacao: nfe.tipoOperacao,
    tipoEmissao: nfe.tipoEmissao,
    dataProcessamento: nfe.dataProcessamento,
    horaProcessamento: nfe.horaProcessamento,
    cnpjEmitente: nfe.cnpjEmitente,
    protocolo: nfe.protocolo,
    recibo: nfe.recibo,
    usuario: nfe.usuario,
    ambiente: nfe.ambiente,
    finalidade: nfe.finalidade,
    isFornecedor: nfe.isFornecedor,
    nomusNfeId,
    rawPayload: nfe.rawPayload as Prisma.InputJsonValue,
    presentInLastPayload: true,
    lastSeenAt: now,
  };
}

export async function upsertSalesOrderNfeLinksForOrder(
  salesOrder: SalesOrderNfeLinkUpsertInput,
  db: DbClient = prisma
): Promise<SalesOrderNfeLinkUpsertResult> {
  const now = new Date();
  const extracted = extractSalesOrderNfesFromNomusPayload(salesOrder.nomusRawResponse);
  const payloadIds = extracted.map((nfe) => nfe.nfeExternalId);

  let created = 0;
  let updated = 0;
  let matchedNomusNfe = 0;
  let unmatchedNomusNfe = 0;

  for (const nfe of extracted) {
    const nomusNfe = await db.nomusNfe.findUnique({
      where: { externalId: nfe.nfeExternalId },
      select: { id: true },
    });
    if (nomusNfe) matchedNomusNfe += 1;
    else unmatchedNomusNfe += 1;

    const data = buildSalesOrderNfeLinkWriteData(salesOrder, nfe, nomusNfe?.id ?? null, now);
    const existing = await db.salesOrderNfeLink.findUnique({
      where: {
        salesOrderId_nfeExternalId: {
          salesOrderId: salesOrder.id,
          nfeExternalId: nfe.nfeExternalId,
        },
      },
      select: { id: true },
    });

    if (existing) {
      await db.salesOrderNfeLink.update({
        where: { id: existing.id },
        data,
      });
      updated += 1;
    } else {
      await db.salesOrderNfeLink.create({
        data: {
          ...data,
          firstSeenAt: now,
        },
      });
      created += 1;
    }
  }

  const markedAbsent =
    payloadIds.length === 0
      ? (
          await db.salesOrderNfeLink.updateMany({
            where: {
              salesOrderId: salesOrder.id,
              presentInLastPayload: true,
            },
            data: { presentInLastPayload: false, lastSeenAt: now },
          })
        ).count
      : (
          await db.salesOrderNfeLink.updateMany({
            where: {
              salesOrderId: salesOrder.id,
              nfeExternalId: { notIn: payloadIds },
              presentInLastPayload: true,
            },
            data: { presentInLastPayload: false, lastSeenAt: now },
          })
        ).count;

  return {
    created,
    updated,
    markedAbsent,
    matchedNomusNfe,
    unmatchedNomusNfe,
  };
}

export async function buildSalesOrderNfeLinkDiagnostic(
  db: DbClient = prisma
): Promise<SalesOrderNfeLinkDiagnostic> {
  const [
    totalOrders,
    ordersWithNfesInPayloadRows,
    totalLinks,
    linksWithNomusNfeMatch,
    linksPresentInLastPayload,
    multiNfeOrders,
    payloadWithoutLinks,
    unmatchedLinks,
  ] = await Promise.all([
    db.salesOrder.count(),
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "SalesOrder"
      WHERE "nomusRawResponse" IS NOT NULL
        AND jsonb_typeof("nomusRawResponse"->'nfes') = 'array'
        AND jsonb_array_length("nomusRawResponse"->'nfes') > 0
    `,
    db.salesOrderNfeLink.count(),
    db.salesOrderNfeLink.count({ where: { nomusNfeId: { not: null } } }),
    db.salesOrderNfeLink.count({ where: { presentInLastPayload: true } }),
    db.$queryRaw<Array<{ orderCode: string | null; nfeCount: bigint }>>`
      SELECT so."orderCode" AS "orderCode", COUNT(l.id)::bigint AS "nfeCount"
      FROM "SalesOrderNfeLink" l
      JOIN "SalesOrder" so ON so.id = l."salesOrderId"
      GROUP BY so."orderCode"
      HAVING COUNT(l.id) > 1
      ORDER BY COUNT(l.id) DESC
      LIMIT 5
    `,
    db.$queryRaw<
      Array<{ salesOrderId: string; orderCode: string | null; nfeCount: bigint }>
    >`
      SELECT so.id AS "salesOrderId", so."orderCode" AS "orderCode",
             jsonb_array_length(so."nomusRawResponse"->'nfes')::bigint AS "nfeCount"
      FROM "SalesOrder" so
      LEFT JOIN "SalesOrderNfeLink" l ON l."salesOrderId" = so.id
      WHERE so."nomusRawResponse" IS NOT NULL
        AND jsonb_typeof(so."nomusRawResponse"->'nfes') = 'array'
        AND jsonb_array_length(so."nomusRawResponse"->'nfes') > 0
      GROUP BY so.id, so."orderCode", so."nomusRawResponse"
      HAVING COUNT(l.id) = 0
      ORDER BY jsonb_array_length(so."nomusRawResponse"->'nfes') DESC
      LIMIT 5
    `,
    db.salesOrderNfeLink.findMany({
      where: { nomusNfeId: null },
      select: { nfeExternalId: true, nfeNumber: true, orderCode: true },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
  ]);

  const ordersWithNfesInPayload = Number(ordersWithNfesInPayloadRows[0]?.count ?? 0);

  return {
    totalOrders,
    ordersWithNfesInPayload,
    ordersWithoutNfesInPayload: Math.max(0, totalOrders - ordersWithNfesInPayload),
    totalLinks,
    linksWithNomusNfeMatch,
    linksWithoutNomusNfeMatch: Math.max(0, totalLinks - linksWithNomusNfeMatch),
    ordersWithMultipleNfes: multiNfeOrders.length,
    ordersWithNfesInPayloadButNoLinks: payloadWithoutLinks.length,
    linksPresentInLastPayload,
    linksAbsentFromLastPayload: Math.max(0, totalLinks - linksPresentInLastPayload),
    examples: {
      multiNfeOrders: multiNfeOrders.map((row) => ({
        orderCode: row.orderCode,
        nfeCount: Number(row.nfeCount),
      })),
      payloadWithoutLinks: payloadWithoutLinks.map((row) => ({
        salesOrderId: row.salesOrderId,
        orderCode: row.orderCode,
        nfeCount: Number(row.nfeCount),
      })),
      unmatchedLinks: unmatchedLinks.map((row) => ({
        orderCode: row.orderCode,
        nfeExternalId: row.nfeExternalId,
        nfeNumber: row.nfeNumber,
      })),
    },
  };
}

export type SalesOrderNfeLinkBackfillPreview = {
  ordersAnalyzed: number;
  ordersWithNfes: number;
  ordersWithoutNfes: number;
  totalNfesFound: number;
  existingLinks: number;
  linksToCreate: number;
  linksToUpdate: number;
  matchedNomusNfe: number;
  unmatchedNomusNfe: number;
  ordersWithMultipleNfes: number;
  examples: {
    multiNfe: Array<{ orderCode: string; nfeCount: number; nfeIds: number[] }>;
    create: Array<{ orderCode: string; nfeExternalId: number; nfeNumber: string | null }>;
    update: Array<{ orderCode: string; nfeExternalId: number; nfeNumber: string | null }>;
  };
};

export async function previewSalesOrderNfeLinkBackfill(
  db: DbClient = prisma
): Promise<SalesOrderNfeLinkBackfillPreview> {
  const orders = await db.salesOrder.findMany({
    select: {
      id: true,
      orderCode: true,
      externalSalesOrderId: true,
      externalSalesOrderCode: true,
      nomusRawResponse: true,
    },
  });

  const existingLinks = await db.salesOrderNfeLink.findMany({
    select: { salesOrderId: true, nfeExternalId: true },
  });
  const existingKey = new Set(
    existingLinks.map((link) => `${link.salesOrderId}:${link.nfeExternalId}`)
  );

  let ordersWithNfes = 0;
  let ordersWithoutNfes = 0;
  let totalNfesFound = 0;
  let linksToCreate = 0;
  let linksToUpdate = 0;
  let matchedNomusNfe = 0;
  let unmatchedNomusNfe = 0;
  let ordersWithMultipleNfes = 0;

  const multiNfeExamples: SalesOrderNfeLinkBackfillPreview["examples"]["multiNfe"] = [];
  const createExamples: SalesOrderNfeLinkBackfillPreview["examples"]["create"] = [];
  const updateExamples: SalesOrderNfeLinkBackfillPreview["examples"]["update"] = [];

  for (const order of orders) {
    const nfes = extractSalesOrderNfesFromNomusPayload(order.nomusRawResponse);
    if (nfes.length === 0) {
      ordersWithoutNfes += 1;
      continue;
    }
    ordersWithNfes += 1;
    totalNfesFound += nfes.length;
    if (nfes.length > 1) {
      ordersWithMultipleNfes += 1;
      if (multiNfeExamples.length < 5) {
        multiNfeExamples.push({
          orderCode: order.orderCode,
          nfeCount: nfes.length,
          nfeIds: nfes.map((nfe) => nfe.nfeExternalId),
        });
      }
    }

    for (const nfe of nfes) {
      const nomusNfe = await db.nomusNfe.findUnique({
        where: { externalId: nfe.nfeExternalId },
        select: { id: true },
      });
      if (nomusNfe) matchedNomusNfe += 1;
      else unmatchedNomusNfe += 1;

      const key = `${order.id}:${nfe.nfeExternalId}`;
      if (existingKey.has(key)) {
        linksToUpdate += 1;
        if (updateExamples.length < 5) {
          updateExamples.push({
            orderCode: order.orderCode,
            nfeExternalId: nfe.nfeExternalId,
            nfeNumber: nfe.nfeNumber,
          });
        }
      } else {
        linksToCreate += 1;
        if (createExamples.length < 5) {
          createExamples.push({
            orderCode: order.orderCode,
            nfeExternalId: nfe.nfeExternalId,
            nfeNumber: nfe.nfeNumber,
          });
        }
      }
    }
  }

  return {
    ordersAnalyzed: orders.length,
    ordersWithNfes,
    ordersWithoutNfes,
    totalNfesFound,
    existingLinks: existingLinks.length,
    linksToCreate,
    linksToUpdate,
    matchedNomusNfe,
    unmatchedNomusNfe,
    ordersWithMultipleNfes,
    examples: {
      multiNfe: multiNfeExamples,
      create: createExamples,
      update: updateExamples,
    },
  };
}

export async function applySalesOrderNfeLinkBackfill(
  db: DbClient = prisma
): Promise<{ ordersProcessed: number; created: number; updated: number; markedAbsent: number }> {
  const orders = await db.salesOrder.findMany({
    select: {
      id: true,
      orderCode: true,
      externalSalesOrderId: true,
      externalSalesOrderCode: true,
      nomusRawResponse: true,
    },
  });

  let created = 0;
  let updated = 0;
  let markedAbsent = 0;

  for (const order of orders) {
    const result = await upsertSalesOrderNfeLinksForOrder(order, db);
    created += result.created;
    updated += result.updated;
    markedAbsent += result.markedAbsent;
  }

  return {
    ordersProcessed: orders.length,
    created,
    updated,
    markedAbsent,
  };
}
