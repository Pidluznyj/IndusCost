/**
 * Sync pontual documentosEstoque por idNfe (pós Pedidos de Venda).
 * Reutiliza mapper + plano de persistência oficiais — sem janela incremental.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  mapNomusStockDocumentPayload,
  type MappedNomusStockDocument,
  type JsonObject,
} from "@/src/lib/nomusStockDocumentsMapper.js";
import {
  buildStockDocumentsPageParams,
  buildStockDocumentsQuery,
  emptyStockDocumentsSyncCounters,
  hasNextStockDocumentsPage,
  NOMUS_STOCK_DOCUMENTS_DEFAULT_PAGE_SIZE,
  NOMUS_STOCK_DOCUMENTS_DEFAULT_TIPO,
  NOMUS_STOCK_DOCUMENTS_RESOURCE,
  pickStockDocumentsArray,
  planStockDocumentPersist,
  type StockDocumentsSyncCounters,
} from "@/src/lib/nomusStockDocumentsSyncLogic.js";
import { NOMUS_STOCK_DOCUMENTS_LOG_PREFIX } from "@/src/lib/nomusStockDocumentsSyncConstants.js";
import {
  acquireStockDocumentsSyncLock,
  releaseStockDocumentsSyncLock,
} from "@/src/lib/nomusStockDocumentsSyncLock.js";
import {
  buildNomusUrl,
  fetchNomusJson,
} from "@/src/lib/nomusRestClient.js";

const LOG_PREFIX = NOMUS_STOCK_DOCUMENTS_LOG_PREFIX;
const MAX_ID_NFES = 40;

export type SyncStockDocumentsByIdNfeResult = {
  skipped: boolean;
  skipReason: string | null;
  lockBlocked: boolean;
  idNfes: number[];
  counters: StockDocumentsSyncCounters;
  errors: number;
};

function getRequiredEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = (env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

async function fetchRowsForIdNfe(args: {
  baseUrl: string;
  idNfe: number;
  tipo: string;
  pageSize: number;
}): Promise<MappedNomusStockDocument[]> {
  const rows: MappedNomusStockDocument[] = [];
  const query = buildStockDocumentsQuery({
    tipo: args.tipo,
    idNfe: args.idNfe,
  });
  for (let page = 1; page <= 20; page += 1) {
    const url = buildNomusUrl(
      args.baseUrl,
      NOMUS_STOCK_DOCUMENTS_RESOURCE,
      buildStockDocumentsPageParams(page, args.pageSize, query)
    );
    const payload = await fetchNomusJson(url, { logPrefix: LOG_PREFIX });
    const items = pickStockDocumentsArray(payload).filter(
      (item): item is JsonObject =>
        !!item && typeof item === "object" && !Array.isArray(item)
    );
    for (const item of items) {
      const mapped = mapNomusStockDocumentPayload(item);
      if (mapped.ok) rows.push(mapped.row);
    }
    if (!hasNextStockDocumentsPage(payload, page, items.length, args.pageSize)) {
      break;
    }
  }
  return rows;
}

async function persistRows(
  prisma: PrismaClient,
  rows: MappedNomusStockDocument[],
  syncedAt: Date
): Promise<StockDocumentsSyncCounters> {
  const counters = emptyStockDocumentsSyncCounters();
  counters.documentsReceived = rows.length;
  const byId = new Map<number, MappedNomusStockDocument>();
  for (const row of rows) byId.set(row.externalId, row);

  for (const row of byId.values()) {
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.nomusStockDocument.findUnique({
          where: { externalId: row.externalId },
          select: {
            id: true,
            payloadHash: true,
            _count: { select: { items: true } },
          },
        });
        const liveExistingItemCount = existing?._count.items ?? 0;
        const livePlan = planStockDocumentPersist(
          row,
          existing == null
            ? null
            : {
                externalId: row.externalId,
                payloadHash: existing.payloadHash,
                itemCount: liveExistingItemCount,
              }
        );

        if (livePlan.headerAction === "unchanged" && existing != null) {
          await tx.nomusStockDocument.update({
            where: { externalId: row.externalId },
            data: {
              syncedAt,
              lastSeenAt: syncedAt,
              presentInLastPayload: true,
            },
            select: { id: true },
          });
          counters.documentsUnchanged += 1;
          return;
        }

        const headerData = {
          idNfe: row.idNfe,
          tipoDocumentoEstoque: row.tipoDocumentoEstoque,
          dataDocumento: row.dataDocumento,
          documentNumber: row.documentNumber,
          statusRaw: row.statusRaw,
          isCancelled: row.isCancelled,
          cancelledAt: row.cancelledAt,
          cancellationReason: row.cancellationReason,
          totalValue: row.totalValue,
          personExternalId: row.personExternalId,
          personName: row.personName,
          companyExternalId: row.companyExternalId,
          companyName: row.companyName,
          movementDate: row.movementDate,
          paymentTermsRaw: row.paymentTermsRaw,
          payloadHash: row.payloadHash,
          lastSeenAt: syncedAt,
          presentInLastPayload: true,
          rawJson: row.rawJson as Prisma.InputJsonValue,
          syncedAt,
        };

        const document =
          existing == null
            ? await tx.nomusStockDocument.create({
                data: {
                  externalId: row.externalId,
                  firstSeenAt: syncedAt,
                  ...headerData,
                },
                select: { id: true },
              })
            : await tx.nomusStockDocument.update({
                where: { externalId: row.externalId },
                data: headerData,
                select: { id: true },
              });

        if (existing == null) counters.documentsCreated += 1;
        else counters.documentsUpdated += 1;

        counters.affectedStockDocumentExternalIds.push(row.externalId);
        if (row.idNfe != null && Number.isFinite(row.idNfe) && row.idNfe > 0) {
          counters.affectedNfeIds.push(row.idNfe);
        }

        if (livePlan.itemsAction === "preserve" || livePlan.itemsAction === "ignore") {
          if (livePlan.itemsAction === "preserve") {
            counters.itemsPreservedDueToPartialPayload += liveExistingItemCount;
          }
          return;
        }

        await tx.nomusStockDocumentItem.deleteMany({
          where: { stockDocumentId: document.id },
        });
        if (row.items.length === 0) return;

        await tx.nomusStockDocumentItem.createMany({
          data: row.items.map((item) => ({
            stockDocumentId: document.id,
            externalItemId: item.externalItemId,
            externalProductId: item.externalProductId,
            quantity: item.quantity,
            unitValue: item.unitValue,
            estimatedTotalValue: item.estimatedTotalValue,
            rawJson: item.rawJson as Prisma.InputJsonValue,
          })),
        });
        counters.itemsReplaced += row.items.length;
      });
    } catch {
      counters.errors += 1;
    }
  }

  return counters;
}

/**
 * Busca e persiste Documentos de Saída para a lista de idNfe.
 * `respectGlobalLock=false` quando já sob o flock dos pedidos.
 */
export async function syncNomusStockDocumentsByIdNfes(args: {
  prisma: PrismaClient;
  idNfes: number[];
  env?: NodeJS.ProcessEnv;
  respectGlobalLock?: boolean;
  logger?: (message: string) => void;
}): Promise<SyncStockDocumentsByIdNfeResult> {
  const env = args.env ?? process.env;
  const log = args.logger ?? ((m: string) => console.warn(m));
  const idNfes = [...new Set(args.idNfes)]
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, MAX_ID_NFES);

  if (idNfes.length === 0) {
    return {
      skipped: true,
      skipReason: "no-idNfes",
      lockBlocked: false,
      idNfes: [],
      counters: emptyStockDocumentsSyncCounters(),
      errors: 0,
    };
  }

  let lockFile: string | null = null;
  let lockToken: string | null = null;
  if (args.respectGlobalLock !== false) {
    const lock = acquireStockDocumentsSyncLock({ mode: "apply", env });
    if (!lock.ok) {
      log(`${LOG_PREFIX} by-idNfe BLOCKED: ${lock.message}`);
      return {
        skipped: false,
        skipReason: null,
        lockBlocked: true,
        idNfes,
        counters: emptyStockDocumentsSyncCounters(),
        errors: 0,
      };
    }
    lockFile = lock.lockFile;
    lockToken = lock.token;
  }

  try {
    const baseUrl = getRequiredEnv("NOMUS_BASE_URL", env);
    const allRows: MappedNomusStockDocument[] = [];
    for (const idNfe of idNfes) {
      log(`${LOG_PREFIX} by-idNfe fetch idNfe=${idNfe}`);
      const rows = await fetchRowsForIdNfe({
        baseUrl,
        idNfe,
        tipo: NOMUS_STOCK_DOCUMENTS_DEFAULT_TIPO,
        pageSize: NOMUS_STOCK_DOCUMENTS_DEFAULT_PAGE_SIZE,
      });
      allRows.push(...rows);
    }
    const counters = await persistRows(args.prisma, allRows, new Date());
    log(
      `${LOG_PREFIX} by-idNfe ok idNfes=${idNfes.length} received=${counters.documentsReceived} created=${counters.documentsCreated} updated=${counters.documentsUpdated} unchanged=${counters.documentsUnchanged} errors=${counters.errors}`
    );
    return {
      skipped: false,
      skipReason: null,
      lockBlocked: false,
      idNfes,
      counters,
      errors: counters.errors,
    };
  } finally {
    if (lockFile && lockToken) {
      releaseStockDocumentsSyncLock({ lockFile, token: lockToken });
    }
  }
}
