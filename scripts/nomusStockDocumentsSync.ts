/**
 * Sync manual Nomus documentosEstoque → NomusStockDocument / NomusStockDocumentItem.
 *
 * Isolado: não altera AR, Faturamento, Fluxo de Caixa, Comissões, SalesOrder, NomusNfe.
 * Sem cron / sem rotina automática.
 *
 * Regra de itens (DS-03.2):
 * - payload completo com itens → substitui itens (deleteMany + createMany)
 * - payload completo sem itens (array explícito vazio) → substitui (fica sem itens)
 * - payload parcial / array ausente / itens não mapeáveis → preserva itens existentes
 *
 * Uso:
 *   npx tsx scripts/nomusStockDocumentsSync.ts preview --from=2025-07-01 --to=2026-07-10
 *   npx tsx scripts/nomusStockDocumentsSync.ts apply --from=2025-07-01 --to=2026-07-10 --tipo=DocumentoSaida
 *   npx tsx scripts/nomusStockDocumentsSync.ts preview --idNfe=6937,7188,7377
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  mapNomusStockDocumentPayload,
  type MappedNomusStockDocument,
  type JsonObject,
} from "../src/lib/nomusStockDocumentsMapper.ts";
import {
  buildStockDocumentsPageParams,
  buildStockDocumentsQuery,
  emptyStockDocumentsSyncCounters,
  hasNextStockDocumentsPage,
  NOMUS_STOCK_DOCUMENTS_RESOURCE,
  parseStockDocumentsSyncCli,
  pickStockDocumentsArray,
  planStockDocumentPersist,
  resolveStockDocumentsSyncExitCode,
  shouldWriteStockDocuments,
  summarizeStockDocumentPersistPlans,
  type StockDocumentsSyncCliOptions,
  type StockDocumentsSyncCounters,
} from "../src/lib/nomusStockDocumentsSyncLogic.ts";
import {
  buildNomusUrl,
  describeNomusCredential,
  fetchNomusJson,
  redactHeadersForLog,
  redactNomusUrlForLog,
} from "../src/lib/nomusRestClient.ts";

const prisma = new PrismaClient();
const LOG_PREFIX = "[nomus-stock-documents]";

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function buildQueries(options: StockDocumentsSyncCliOptions): string[] {
  if (options.idNfes.length > 0) {
    return options.idNfes.map((idNfe) =>
      buildStockDocumentsQuery({
        tipo: options.tipo,
        from: options.from,
        to: options.to,
        idNfe,
      })
    );
  }
  return [
    buildStockDocumentsQuery({
      tipo: options.tipo,
      from: options.from,
      to: options.to,
    }),
  ];
}

async function fetchAllForQuery(
  baseUrl: string,
  query: string,
  options: StockDocumentsSyncCliOptions
): Promise<{
  pagesRead: number;
  recordsRead: number;
  rows: MappedNomusStockDocument[];
  invalidPayloads: number;
  itemsDiscardedByMapper: number;
  duplicateItemsCollapsed: number;
}> {
  const rows: MappedNomusStockDocument[] = [];
  let pagesRead = 0;
  let recordsRead = 0;
  let invalidPayloads = 0;
  let itemsDiscardedByMapper = 0;
  let duplicateItemsCollapsed = 0;
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;

  for (let page = 1; page <= maxPages; page += 1) {
    const url = buildNomusUrl(
      baseUrl,
      NOMUS_STOCK_DOCUMENTS_RESOURCE,
      buildStockDocumentsPageParams(page, options.pageSize, query)
    );
    console.warn(`${LOG_PREFIX} GET ${redactNomusUrlForLog(url)}`);
    const payload = await fetchNomusJson(url, { logPrefix: LOG_PREFIX });
    const items = pickStockDocumentsArray(payload).filter(
      (item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item)
    );
    pagesRead += 1;
    recordsRead += items.length;
    console.warn(`${LOG_PREFIX} página ${page}: ${items.length} registros (query=${query})`);

    for (const item of items) {
      const mapped = mapNomusStockDocumentPayload(item);
      if (!mapped.ok) {
        invalidPayloads += 1;
        continue;
      }
      itemsDiscardedByMapper += mapped.row.itemsDiscardedCount;
      duplicateItemsCollapsed += mapped.row.itemsDuplicateCollapsedCount;
      rows.push(mapped.row);
    }

    if (!hasNextStockDocumentsPage(payload, page, items.length, options.pageSize)) break;
  }

  return {
    pagesRead,
    recordsRead,
    rows,
    invalidPayloads,
    itemsDiscardedByMapper,
    duplicateItemsCollapsed,
  };
}

function dedupeByExternalId(rows: MappedNomusStockDocument[]): MappedNomusStockDocument[] {
  const byId = new Map<number, MappedNomusStockDocument>();
  for (const row of rows) byId.set(row.externalId, row);
  return [...byId.values()];
}

async function runApply(
  rows: MappedNomusStockDocument[],
  syncedAt: Date
): Promise<StockDocumentsSyncCounters> {
  const counters = emptyStockDocumentsSyncCounters();
  counters.documentsReceived = rows.length;

  for (const row of rows) {
    if (row.itemsReliability === "complete_empty") counters.emptyPayloads += 1;
    if (
      row.itemsReliability === "partial_absent_array" ||
      row.itemsReliability === "partial_unmapped"
    ) {
      counters.partialPayloads += 1;
    }

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

        if (row.totalValueSource === "items_sum") {
          console.warn(
            `${LOG_PREFIX} totalValue derivado da soma dos itens externalId=${row.externalId} total=${row.totalValue?.toString() ?? "null"}`
          );
        }

        if (livePlan.itemsAction === "preserve") {
          counters.itemsPreservedDueToPartialPayload += liveExistingItemCount;
          console.warn(
            `${LOG_PREFIX} preservando ${liveExistingItemCount} item(ns) externalId=${row.externalId} reason=${livePlan.itemsReason} reliability=${row.itemsReliability}`
          );
          return;
        }

        if (livePlan.itemsAction === "ignore") {
          return;
        }

        await tx.nomusStockDocumentItem.deleteMany({
          where: { stockDocumentId: document.id },
        });

        if (row.items.length === 0) {
          return;
        }

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
    } catch (error) {
      counters.errors += 1;
      console.error(
        `${LOG_PREFIX} erro ao persistir externalId=${row.externalId}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return counters;
}

async function main(): Promise<void> {
  const startedMs = Date.now();
  const options = parseStockDocumentsSyncCli(process.argv.slice(2));
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");

  const envForLog = redactHeadersForLog(
    Object.fromEntries(
      Object.entries(process.env)
        .filter(([key]) => key.startsWith("NOMUS_"))
        .map(([key, value]) => [key, value ?? ""])
    )
  );

  console.warn(
    `${LOG_PREFIX} modo=${options.mode} from=${options.from ?? "-"} to=${options.to ?? "-"} tipo=${options.tipo} pageSize=${options.pageSize} maxPages=${options.maxPages ?? "∞"} idNfes=${options.idNfes.join(",") || "-"}`
  );
  console.warn(`${LOG_PREFIX} env Nomus (redigido): ${JSON.stringify(envForLog)}`);
  console.warn(
    `${LOG_PREFIX} credencial: ${JSON.stringify(
      describeNomusCredential(
        process.env.NOMUS_AUTH_HEADER_VALUE || process.env.NOMUS_TOKEN || process.env.NOMUS_AUTH
      )
    )}`
  );

  const queries = buildQueries(options);
  let pagesRead = 0;
  let recordsRead = 0;
  let invalidPayloads = 0;
  let itemsDiscardedByMapper = 0;
  let duplicateItemsCollapsed = 0;
  const allRows: MappedNomusStockDocument[] = [];

  for (const query of queries) {
    const fetched = await fetchAllForQuery(baseUrl, query, options);
    pagesRead += fetched.pagesRead;
    recordsRead += fetched.recordsRead;
    invalidPayloads += fetched.invalidPayloads;
    itemsDiscardedByMapper += fetched.itemsDiscardedByMapper;
    duplicateItemsCollapsed += fetched.duplicateItemsCollapsed;
    allRows.push(...fetched.rows);
  }

  const rows = dedupeByExternalId(allRows);
  const existing = await prisma.nomusStockDocument.findMany({
    where: { externalId: { in: rows.map((row) => row.externalId) } },
    select: {
      externalId: true,
      payloadHash: true,
      _count: { select: { items: true } },
    },
  });
  const existingByExternalId = new Map(
    existing.map((row) => [
      row.externalId,
      {
        externalId: row.externalId,
        payloadHash: row.payloadHash,
        itemCount: row._count.items,
      },
    ] as const)
  );
  const plans = rows.map((row) =>
    planStockDocumentPersist(row, existingByExternalId.get(row.externalId) ?? null)
  );
  const planSummary = summarizeStockDocumentPersistPlans(plans);

  let applied: StockDocumentsSyncCounters | null = null;
  if (shouldWriteStockDocuments(options.mode)) {
    applied = await runApply(rows, new Date());
    applied.invalidPayloads = invalidPayloads;
    applied.itemsDiscardedByMapper = itemsDiscardedByMapper;
    applied.duplicateItemsCollapsed = duplicateItemsCollapsed;
  } else {
    console.warn(`${LOG_PREFIX} preview — nenhuma escrita no banco`);
  }

  const durationMs = Date.now() - startedMs;
  const counters: StockDocumentsSyncCounters = applied ?? {
    ...emptyStockDocumentsSyncCounters(),
    documentsReceived: rows.length,
    documentsCreated: planSummary.documentsToCreate,
    documentsUpdated: planSummary.documentsToUpdate,
    documentsUnchanged: planSummary.documentsUnchanged,
    itemsReplaced: planSummary.itemsToWrite,
    itemsPreservedDueToPartialPayload: planSummary.itemsToPreserve,
    emptyPayloads: planSummary.emptyPayloads,
    invalidPayloads,
    partialPayloads: planSummary.partialPayloads,
    itemsDiscardedByMapper,
    duplicateItemsCollapsed,
    errors: 0,
  };

  const summary = {
    mode: options.mode,
    pagesRead,
    recordsRead,
    mapped: rows.length,
    ...counters,
    plannedCreates: planSummary.documentsToCreate,
    plannedUpdates: planSummary.documentsToUpdate,
    plannedUnchanged: planSummary.documentsUnchanged,
    plannedItemsReplace: planSummary.itemsToWrite,
    plannedItemsPreserve: planSummary.itemsToPreserve,
    durationMs,
  };

  const exitCode = resolveStockDocumentsSyncExitCode(counters);
  if (exitCode !== 0) process.exitCode = exitCode;

  console.warn(
    `${LOG_PREFIX} concluído em ${(durationMs / 1000).toFixed(1)}s — recebidos=${summary.documentsReceived} criados=${summary.documentsCreated} atualizados=${summary.documentsUpdated} inalterados=${summary.documentsUnchanged} itensSubstituidos=${summary.itemsReplaced} itensPreservados=${summary.itemsPreservedDueToPartialPayload} vazios=${summary.emptyPayloads} parciais=${summary.partialPayloads} invalidos=${summary.invalidPayloads} erros=${summary.errors}`
  );

  console.log(
    JSON.stringify(
      {
        mode: options.mode,
        summary,
        preview: rows.slice(0, 5).map((row) => ({
          externalId: row.externalId,
          documentNumber: row.documentNumber,
          idNfe: row.idNfe,
          tipoDocumentoEstoque: row.tipoDocumentoEstoque,
          dataDocumento: row.dataDocumento?.toISOString() ?? null,
          movementDate: row.movementDate?.toISOString() ?? null,
          statusRaw: row.statusRaw,
          isCancelled: row.isCancelled,
          totalValue: row.totalValue?.toString() ?? null,
          totalValueSource: row.totalValueSource,
          personExternalId: row.personExternalId,
          companyExternalId: row.companyExternalId,
          payloadHash: row.payloadHash.slice(0, 12),
          itemsReliability: row.itemsReliability,
          items: row.items.length,
          itemSample: row.items.slice(0, 3).map((item) => ({
            externalProductId: item.externalProductId,
            quantity: item.quantity.toString(),
            unitValue: item.unitValue.toString(),
            estimatedTotalValue: item.estimatedTotalValue.toString(),
          })),
        })),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(`${LOG_PREFIX} falha`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
