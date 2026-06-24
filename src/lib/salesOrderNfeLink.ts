import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import {
  extractSalesOrderNfesFromNomusPayload,
  parseNomusNfeProcessingDate,
  type ExtractedSalesOrderNfe,
} from "./salesOrderNomusNfeExtract.js";

export type { ExtractedSalesOrderNfe } from "./salesOrderNomusNfeExtract.js";
export { extractSalesOrderNfesFromNomusPayload, parseNomusNfeProcessingDate };

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

/**
 * Backfill em lote (sem N+1).
 *
 * Estratégia: 1 query para pedidos, 1 (em chunks) para NomusNfe via `IN`,
 * 1 para vínculos existentes. Todo o cruzamento acontece em memória. O mesmo
 * planejamento (`planSalesOrderNfeLinkBackfill`) é usado pelo dry-run e pelo
 * apply, garantindo paridade total entre prévia e execução.
 */

const NOMUS_LOOKUP_CHUNK = 1000;
const DEFAULT_BACKFILL_CHUNK = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

type BackfillOrderRow = {
  id: string;
  orderCode: string;
  externalSalesOrderId: number | null;
  externalSalesOrderCode: string | null;
  nomusRawResponse: unknown;
};

type ExistingLinkRow = {
  id: string;
  salesOrderId: string;
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
  nomusNfeId: string | null;
  externalSalesOrderId: number | null;
  externalSalesOrderCode: string | null;
  orderCode: string | null;
  presentInLastPayload: boolean;
};

export type SalesOrderNfeLinkPlanItem = {
  order: BackfillOrderRow;
  nfe: ExtractedSalesOrderNfe;
  nomusNfeId: string | null;
};

export type SalesOrderNfeLinkBackfillPlan = {
  ordersAnalyzed: number;
  ordersWithNfes: number;
  ordersWithoutNfes: number;
  totalNfesFound: number;
  uniqueNfes: number;
  existingLinks: number;
  matchedNomusNfe: number;
  unmatchedNomusNfe: number;
  ordersWithMultipleNfes: number;
  toCreate: SalesOrderNfeLinkPlanItem[];
  toUpdate: Array<{ existingId: string; item: SalesOrderNfeLinkPlanItem }>;
  unchanged: number;
  absentLinkIds: string[];
  examples: {
    multiNfe: Array<{ orderCode: string; nfeCount: number; nfeIds: number[] }>;
    create: Array<{ orderCode: string; nfeExternalId: number; nfeNumber: string | null }>;
    update: Array<{ orderCode: string; nfeExternalId: number; nfeNumber: string | null }>;
    unmatched: Array<{ orderCode: string; nfeExternalId: number; nfeNumber: string | null }>;
  };
};

export type SalesOrderNfeLinkBackfillPreview = {
  ordersAnalyzed: number;
  ordersWithNfes: number;
  ordersWithoutNfes: number;
  totalNfesFound: number;
  uniqueNfes: number;
  existingLinks: number;
  linksToCreate: number;
  linksToUpdate: number;
  linksUnchanged: number;
  linksToMarkAbsent: number;
  matchedNomusNfe: number;
  unmatchedNomusNfe: number;
  ordersWithMultipleNfes: number;
  examples: {
    multiNfe: Array<{ orderCode: string; nfeCount: number; nfeIds: number[] }>;
    create: Array<{ orderCode: string; nfeExternalId: number; nfeNumber: string | null }>;
    update: Array<{ orderCode: string; nfeExternalId: number; nfeNumber: string | null }>;
    unmatched: Array<{ orderCode: string; nfeExternalId: number; nfeNumber: string | null }>;
  };
};

function toUpsertInput(order: BackfillOrderRow): SalesOrderNfeLinkUpsertInput {
  return {
    id: order.id,
    externalSalesOrderId: order.externalSalesOrderId ?? null,
    externalSalesOrderCode: order.externalSalesOrderCode ?? null,
    orderCode: order.orderCode,
  };
}

function timeOrNull(value: Date | null): number | null {
  return value ? value.getTime() : null;
}

function linkNeedsUpdate(existing: ExistingLinkRow, item: SalesOrderNfeLinkPlanItem): boolean {
  const { nfe, order, nomusNfeId } = item;
  return (
    existing.presentInLastPayload !== true ||
    existing.nomusNfeId !== nomusNfeId ||
    existing.nfeNumber !== nfe.nfeNumber ||
    existing.nfeSerie !== nfe.nfeSerie ||
    existing.nfeKey !== nfe.nfeKey ||
    existing.nfeStatus !== nfe.nfeStatus ||
    existing.tipoOperacao !== nfe.tipoOperacao ||
    existing.tipoEmissao !== nfe.tipoEmissao ||
    existing.horaProcessamento !== nfe.horaProcessamento ||
    existing.cnpjEmitente !== nfe.cnpjEmitente ||
    existing.protocolo !== nfe.protocolo ||
    existing.recibo !== nfe.recibo ||
    existing.usuario !== nfe.usuario ||
    existing.ambiente !== nfe.ambiente ||
    existing.finalidade !== nfe.finalidade ||
    existing.isFornecedor !== nfe.isFornecedor ||
    (existing.externalSalesOrderId ?? null) !== (order.externalSalesOrderId ?? null) ||
    (existing.externalSalesOrderCode ?? null) !== (order.externalSalesOrderCode ?? null) ||
    (existing.orderCode ?? null) !== order.orderCode ||
    timeOrNull(existing.dataProcessamento) !== timeOrNull(nfe.dataProcessamento)
  );
}

async function loadNomusNfeIdMap(
  db: DbClient,
  externalIds: number[]
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  for (const ids of chunk(externalIds, NOMUS_LOOKUP_CHUNK)) {
    if (ids.length === 0) continue;
    const rows = await db.nomusNfe.findMany({
      where: { externalId: { in: ids } },
      select: { id: true, externalId: true },
    });
    for (const row of rows) map.set(row.externalId, row.id);
  }
  return map;
}

export async function planSalesOrderNfeLinkBackfill(
  db: DbClient = prisma
): Promise<SalesOrderNfeLinkBackfillPlan> {
  const orders = (await db.salesOrder.findMany({
    select: {
      id: true,
      orderCode: true,
      externalSalesOrderId: true,
      externalSalesOrderCode: true,
      nomusRawResponse: true,
    },
  })) as BackfillOrderRow[];

  const perOrderNfes = new Map<string, ExtractedSalesOrderNfe[]>();
  const uniqueExternalIds = new Set<number>();
  const payloadKeys = new Set<string>();

  let ordersWithNfes = 0;
  let ordersWithoutNfes = 0;
  let totalNfesFound = 0;
  let ordersWithMultipleNfes = 0;
  const multiNfeExamples: SalesOrderNfeLinkBackfillPlan["examples"]["multiNfe"] = [];

  for (const order of orders) {
    const nfes = extractSalesOrderNfesFromNomusPayload(order.nomusRawResponse);
    if (nfes.length === 0) {
      ordersWithoutNfes += 1;
      continue;
    }
    ordersWithNfes += 1;
    totalNfesFound += nfes.length;
    perOrderNfes.set(order.id, nfes);
    for (const nfe of nfes) {
      uniqueExternalIds.add(nfe.nfeExternalId);
      payloadKeys.add(`${order.id}:${nfe.nfeExternalId}`);
    }
    if (nfes.length > 1) {
      ordersWithMultipleNfes += 1;
      if (multiNfeExamples.length < 10) {
        multiNfeExamples.push({
          orderCode: order.orderCode,
          nfeCount: nfes.length,
          nfeIds: nfes.map((nfe) => nfe.nfeExternalId),
        });
      }
    }
  }

  const nomusNfeIdByExternalId = await loadNomusNfeIdMap(db, [...uniqueExternalIds]);

  const existing = (await db.salesOrderNfeLink.findMany({
    select: {
      id: true,
      salesOrderId: true,
      nfeExternalId: true,
      nfeNumber: true,
      nfeSerie: true,
      nfeKey: true,
      nfeStatus: true,
      tipoOperacao: true,
      tipoEmissao: true,
      dataProcessamento: true,
      horaProcessamento: true,
      cnpjEmitente: true,
      protocolo: true,
      recibo: true,
      usuario: true,
      ambiente: true,
      finalidade: true,
      isFornecedor: true,
      nomusNfeId: true,
      externalSalesOrderId: true,
      externalSalesOrderCode: true,
      orderCode: true,
      presentInLastPayload: true,
    },
  })) as ExistingLinkRow[];

  const existingByKey = new Map<string, ExistingLinkRow>();
  for (const row of existing) {
    existingByKey.set(`${row.salesOrderId}:${row.nfeExternalId}`, row);
  }

  const toCreate: SalesOrderNfeLinkPlanItem[] = [];
  const toUpdate: SalesOrderNfeLinkBackfillPlan["toUpdate"] = [];
  const createExamples: SalesOrderNfeLinkBackfillPlan["examples"]["create"] = [];
  const updateExamples: SalesOrderNfeLinkBackfillPlan["examples"]["update"] = [];
  const unmatchedExamples: SalesOrderNfeLinkBackfillPlan["examples"]["unmatched"] = [];

  let matchedNomusNfe = 0;
  let unmatchedNomusNfe = 0;
  let unchanged = 0;

  for (const order of orders) {
    const nfes = perOrderNfes.get(order.id);
    if (!nfes) continue;
    for (const nfe of nfes) {
      const nomusNfeId = nomusNfeIdByExternalId.get(nfe.nfeExternalId) ?? null;
      if (nomusNfeId) {
        matchedNomusNfe += 1;
      } else {
        unmatchedNomusNfe += 1;
        if (unmatchedExamples.length < 10) {
          unmatchedExamples.push({
            orderCode: order.orderCode,
            nfeExternalId: nfe.nfeExternalId,
            nfeNumber: nfe.nfeNumber,
          });
        }
      }

      const item: SalesOrderNfeLinkPlanItem = { order, nfe, nomusNfeId };
      const existingRow = existingByKey.get(`${order.id}:${nfe.nfeExternalId}`);
      if (existingRow) {
        if (linkNeedsUpdate(existingRow, item)) {
          toUpdate.push({ existingId: existingRow.id, item });
          if (updateExamples.length < 10) {
            updateExamples.push({
              orderCode: order.orderCode,
              nfeExternalId: nfe.nfeExternalId,
              nfeNumber: nfe.nfeNumber,
            });
          }
        } else {
          unchanged += 1;
        }
      } else {
        toCreate.push(item);
        if (createExamples.length < 10) {
          createExamples.push({
            orderCode: order.orderCode,
            nfeExternalId: nfe.nfeExternalId,
            nfeNumber: nfe.nfeNumber,
          });
        }
      }
    }
  }

  const absentLinkIds: string[] = [];
  for (const row of existing) {
    const key = `${row.salesOrderId}:${row.nfeExternalId}`;
    if (!payloadKeys.has(key) && row.presentInLastPayload) {
      absentLinkIds.push(row.id);
    }
  }

  return {
    ordersAnalyzed: orders.length,
    ordersWithNfes,
    ordersWithoutNfes,
    totalNfesFound,
    uniqueNfes: uniqueExternalIds.size,
    existingLinks: existing.length,
    matchedNomusNfe,
    unmatchedNomusNfe,
    ordersWithMultipleNfes,
    toCreate,
    toUpdate,
    unchanged,
    absentLinkIds,
    examples: {
      multiNfe: multiNfeExamples,
      create: createExamples,
      update: updateExamples,
      unmatched: unmatchedExamples,
    },
  };
}

function planToPreview(plan: SalesOrderNfeLinkBackfillPlan): SalesOrderNfeLinkBackfillPreview {
  return {
    ordersAnalyzed: plan.ordersAnalyzed,
    ordersWithNfes: plan.ordersWithNfes,
    ordersWithoutNfes: plan.ordersWithoutNfes,
    totalNfesFound: plan.totalNfesFound,
    uniqueNfes: plan.uniqueNfes,
    existingLinks: plan.existingLinks,
    linksToCreate: plan.toCreate.length,
    linksToUpdate: plan.toUpdate.length,
    linksUnchanged: plan.unchanged,
    linksToMarkAbsent: plan.absentLinkIds.length,
    matchedNomusNfe: plan.matchedNomusNfe,
    unmatchedNomusNfe: plan.unmatchedNomusNfe,
    ordersWithMultipleNfes: plan.ordersWithMultipleNfes,
    examples: plan.examples,
  };
}

export async function previewSalesOrderNfeLinkBackfill(
  db: DbClient = prisma
): Promise<SalesOrderNfeLinkBackfillPreview> {
  const plan = await planSalesOrderNfeLinkBackfill(db);
  return planToPreview(plan);
}

export type SalesOrderNfeLinkBackfillResult = {
  ordersProcessed: number;
  created: number;
  updated: number;
  unchanged: number;
  markedAbsent: number;
};

export async function applySalesOrderNfeLinkBackfill(
  db: PrismaClient = prisma,
  options: { chunkSize?: number; plan?: SalesOrderNfeLinkBackfillPlan } = {}
): Promise<SalesOrderNfeLinkBackfillResult> {
  const chunkSize = options.chunkSize ?? DEFAULT_BACKFILL_CHUNK;
  const plan = options.plan ?? (await planSalesOrderNfeLinkBackfill(db));
  const now = new Date();

  let created = 0;
  for (const batch of chunk(plan.toCreate, chunkSize)) {
    if (batch.length === 0) continue;
    const data = batch.map((item) => ({
      ...buildSalesOrderNfeLinkWriteData(
        toUpsertInput(item.order),
        item.nfe,
        item.nomusNfeId,
        now
      ),
      firstSeenAt: now,
    }));
    const res = await db.salesOrderNfeLink.createMany({ data, skipDuplicates: true });
    created += res.count;
  }

  let updated = 0;
  for (const batch of chunk(plan.toUpdate, chunkSize)) {
    if (batch.length === 0) continue;
    await db.$transaction(
      batch.map(({ existingId, item }) =>
        db.salesOrderNfeLink.update({
          where: { id: existingId },
          data: buildSalesOrderNfeLinkWriteData(
            toUpsertInput(item.order),
            item.nfe,
            item.nomusNfeId,
            now
          ),
        })
      )
    );
    updated += batch.length;
  }

  let markedAbsent = 0;
  for (const ids of chunk(plan.absentLinkIds, chunkSize)) {
    if (ids.length === 0) continue;
    const res = await db.salesOrderNfeLink.updateMany({
      where: { id: { in: ids } },
      data: { presentInLastPayload: false, lastSeenAt: now },
    });
    markedAbsent += res.count;
  }

  return {
    ordersProcessed: plan.ordersAnalyzed,
    created,
    updated,
    unchanged: plan.unchanged,
    markedAbsent,
  };
}
