/**
 * Sync Nomus documentosEstoque → NomusStockDocument / NomusStockDocumentItem.
 *
 * Incremental (orquestrado): NOMUS_STOCK_DOCUMENTS_INCREMENTAL=1 resolve janela
 * a partir do checkpoint (overlap) ou lookback inicial — sem backfill automático.
 * Backfill amplo permanece manual com --from/--to explícitos.
 *
 * Isolado: não altera AR, Faturamento, Fluxo de Caixa, Comissões, SalesOrder, NomusNfe.
 *
 * Uso:
 *   npx tsx scripts/nomusStockDocumentsSync.ts preview --from=2025-07-01 --to=2026-07-10
 *   npx tsx scripts/nomusStockDocumentsSync.ts apply --from=2025-07-01 --to=2026-07-10 --tipo=DocumentoSaida
 *   npx tsx scripts/nomusStockDocumentsSync.ts preview --idNfe=6937,7188,7377
 *   NOMUS_STOCK_DOCUMENTS_INCREMENTAL=1 npx tsx scripts/nomusStockDocumentsSync.ts apply
 *
 * `--from` / `--to` são dias-calendário inclusivos para o operador (America/Sao_Paulo).
 * Na API Nomus, o limite superior efetivo de dataEmissao é o próximo dia civil (DS-SYNC-03).
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import { markFinanceDreSnapshotsDirtySafe } from "@/src/lib/financeDreSnapshot.server.js";
import {
  buildSalesOrderFlowRecomputeAfterSyncTrigger,
  runSalesOrderFlowRecomputeAfterNomusSync,
} from "../src/lib/sales/salesOrderFlowRecomputeAfterNomusSync.server.ts";
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
  resolveStockDocumentsNomusEmissionWindow,
  shouldWriteStockDocuments,
  summarizeStockDocumentPersistPlans,
  type StockDocumentsSyncCliOptions,
  type StockDocumentsSyncCounters,
} from "../src/lib/nomusStockDocumentsSyncLogic.ts";
import {
  isStockDocumentsIncrementalEnabled,
  NOMUS_STOCK_DOCUMENTS_LOG_PREFIX,
  resolveStockDocumentsSyncCheckpointFile,
} from "../src/lib/nomusStockDocumentsSyncConstants.ts";
import {
  acquireStockDocumentsSyncLock,
  releaseStockDocumentsSyncLock,
} from "../src/lib/nomusStockDocumentsSyncLock.ts";
import {
  buildStockDocumentsCheckpoint,
  buildStockDocumentsSyncAuditRecord,
  classifyStockDocumentsSyncCompleteness,
  computeStockDocumentsIncrementalWindow,
  parseStockDocumentsCheckpoint,
  resolveStockDocumentsLifecycleExitCode,
  serializeStockDocumentsCheckpoint,
  shouldAdvanceStockDocumentsCheckpoint,
  shouldMarkStockDocumentsAbsent,
} from "../src/lib/nomusStockDocumentsSyncLifecycle.ts";
import {
  disconnectStockDocumentsIntegrationPrisma,
  persistStockDocumentsIntegrationRun,
} from "../src/lib/nomusStockDocumentsIntegrationRun.ts";
import {
  buildNomusUrl,
  describeNomusCredential,
  fetchNomusJson,
  redactHeadersForLog,
  redactNomusUrlForLog,
} from "../src/lib/nomusRestClient.ts";

const prisma = new PrismaClient();
const LOG_PREFIX = NOMUS_STOCK_DOCUMENTS_LOG_PREFIX;

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
  options: StockDocumentsSyncCliOptions,
  onRetryableStatus?: (info: { status: number; attempt: number }) => void
): Promise<{
  pagesRead: number;
  recordsRead: number;
  rows: MappedNomusStockDocument[];
  invalidPayloads: number;
  itemsDiscardedByMapper: number;
  duplicateItemsCollapsed: number;
  fetchComplete: boolean;
}> {
  const rows: MappedNomusStockDocument[] = [];
  let pagesRead = 0;
  let recordsRead = 0;
  let invalidPayloads = 0;
  let itemsDiscardedByMapper = 0;
  let duplicateItemsCollapsed = 0;
  let fetchComplete = false;
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;

  for (let page = 1; page <= maxPages; page += 1) {
    const url = buildNomusUrl(
      baseUrl,
      NOMUS_STOCK_DOCUMENTS_RESOURCE,
      buildStockDocumentsPageParams(page, options.pageSize, query)
    );
    console.warn(`${LOG_PREFIX} GET ${redactNomusUrlForLog(url)}`);
    const payload = await fetchNomusJson(url, {
      logPrefix: LOG_PREFIX,
      onRetryableStatus,
    });
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

    if (!hasNextStockDocumentsPage(payload, page, items.length, options.pageSize)) {
      fetchComplete = true;
      break;
    }
  }

  return {
    pagesRead,
    recordsRead,
    rows,
    invalidPayloads,
    itemsDiscardedByMapper,
    duplicateItemsCollapsed,
    fetchComplete,
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

        counters.affectedStockDocumentExternalIds.push(row.externalId);
        if (row.idNfe != null && Number.isFinite(row.idNfe) && row.idNfe > 0) {
          counters.affectedNfeIds.push(row.idNfe);
        }

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
  const startedAt = new Date();
  let options = parseStockDocumentsSyncCli(process.argv.slice(2));

  if (
    options.idNfes.length === 0 &&
    (!options.from || !options.to) &&
    isStockDocumentsIncrementalEnabled()
  ) {
    const checkpointPath = resolveStockDocumentsSyncCheckpointFile();
    let checkpointTo: string | null = null;
    try {
      if (existsSync(checkpointPath)) {
        checkpointTo =
          parseStockDocumentsCheckpoint(readFileSync(checkpointPath, "utf8"))?.to ??
          null;
      }
    } catch {
      checkpointTo = null;
    }
    const window = computeStockDocumentsIncrementalWindow({
      checkpointTo,
      now: startedAt,
    });
    options = { ...options, from: window.from, to: window.to };
    console.warn(
      `${LOG_PREFIX} janela incremental (${window.source}): from=${window.from} to=${window.to}`
    );
  }

  if (options.idNfes.length === 0 && (!options.from || !options.to)) {
    throw new Error(
      "Informe --from/--to, --idNfe=... ou NOMUS_STOCK_DOCUMENTS_INCREMENTAL=1."
    );
  }

  let lockToken: string | null = null;
  let lockFile: string | null = null;
  let rateLimit429 = 0;
  let fetchComplete = true;
  let fatalError: string | null = null;
  let rows: MappedNomusStockDocument[] = [];
  let pagesRead = 0;
  let recordsRead = 0;
  let invalidPayloads = 0;
  let itemsDiscardedByMapper = 0;
  let duplicateItemsCollapsed = 0;
  let applied: StockDocumentsSyncCounters | null = null;
  let planSummary = summarizeStockDocumentPersistPlans([]);

  const lock = acquireStockDocumentsSyncLock({ mode: options.mode });
  if (!lock.ok) {
    console.warn(lock.message);
    const finishedAt = new Date();
    const audit = buildStockDocumentsSyncAuditRecord({
      mode: options.mode,
      options,
      startedAt,
      finishedAt,
      exitCode: 0,
      completeness: "lock_skipped",
      lockAcquired: false,
      lockSkipped: true,
      checkpointAdvanced: false,
      rateLimit429: 0,
      counters: emptyStockDocumentsSyncCounters(),
      errorMessage: lock.message,
    });
    await persistStockDocumentsIntegrationRun({ audit });
    console.log(JSON.stringify({ mode: options.mode, audit }, null, 2));
    process.exitCode = 0;
    return;
  }
  lockToken = lock.token;
  lockFile = lock.lockFile;
  console.warn(`${LOG_PREFIX} lock adquirido: ${lockFile}`);

  try {
    try {
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
      if (options.from || options.to) {
        const emissionWindow = resolveStockDocumentsNomusEmissionWindow({
          from: options.from,
          to: options.to,
        });
        console.warn(
          `${LOG_PREFIX} intervalo solicitado (inclusivo): from=${emissionWindow.requestedFrom ?? "-"} to=${emissionWindow.requestedToInclusive ?? "-"}`
        );
        console.warn(
          `${LOG_PREFIX} limite superior efetivo Nomus (dataEmissao<=, dia exclusivo): ${emissionWindow.nomusToBoundExclusive ?? "-"}`
        );
      }
      console.warn(`${LOG_PREFIX} env Nomus (redigido): ${JSON.stringify(envForLog)}`);
      console.warn(
        `${LOG_PREFIX} credencial: ${JSON.stringify(
          describeNomusCredential(
            process.env.NOMUS_AUTH_HEADER_VALUE || process.env.NOMUS_TOKEN || process.env.NOMUS_AUTH
          )
        )}`
      );

      const onRetryableStatus = (info: { status: number }) => {
        if (info.status === 429) rateLimit429 += 1;
      };

      const queries = buildQueries(options);
      const allRows: MappedNomusStockDocument[] = [];
      fetchComplete = true;

      for (const query of queries) {
        const fetched = await fetchAllForQuery(baseUrl, query, options, onRetryableStatus);
        pagesRead += fetched.pagesRead;
        recordsRead += fetched.recordsRead;
        invalidPayloads += fetched.invalidPayloads;
        itemsDiscardedByMapper += fetched.itemsDiscardedByMapper;
        duplicateItemsCollapsed += fetched.duplicateItemsCollapsed;
        allRows.push(...fetched.rows);
        if (!fetched.fetchComplete) fetchComplete = false;
      }

      rows = dedupeByExternalId(allRows);
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
      planSummary = summarizeStockDocumentPersistPlans(plans);

      if (shouldWriteStockDocuments(options.mode)) {
        applied = await runApply(rows, new Date());
        applied.invalidPayloads = invalidPayloads;
        applied.itemsDiscardedByMapper = itemsDiscardedByMapper;
        applied.duplicateItemsCollapsed = duplicateItemsCollapsed;
        applied.rateLimit429 = rateLimit429;
      } else {
        console.warn(`${LOG_PREFIX} preview — nenhuma escrita no banco`);
      }
    } catch (error) {
      fatalError = error instanceof Error ? error.message : String(error);
      console.error(`${LOG_PREFIX} falha`, fatalError);
    }

    const finishedAt = new Date();
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
    rateLimit429,
    errors: fatalError ? 1 : 0,
  };
  if (applied) counters.rateLimit429 = rateLimit429;

  const completeness = classifyStockDocumentsSyncCompleteness({
    fetchComplete: fetchComplete && !fatalError,
    errors: counters.errors,
    fatalError: Boolean(fatalError),
  });
  const exitCode = resolveStockDocumentsLifecycleExitCode({
    lockSkipped: false,
    completeness,
    errors: counters.errors,
    invalidPayloads: counters.invalidPayloads,
  });
  process.exitCode = exitCode;

  const checkpointAdvanced = shouldAdvanceStockDocumentsCheckpoint({
    mode: options.mode,
    completeness,
    exitCode,
  });
  if (checkpointAdvanced) {
    const checkpoint = buildStockDocumentsCheckpoint({
      mode: options.mode,
      options,
      counters,
      completedAt: finishedAt,
    });
    const checkpointFile = resolveStockDocumentsSyncCheckpointFile();
    try {
      writeFileSync(checkpointFile, serializeStockDocumentsCheckpoint(checkpoint), "utf8");
      console.warn(`${LOG_PREFIX} checkpoint avançado: ${checkpointFile}`);
    } catch (error) {
      console.error(
        `${LOG_PREFIX} falha ao gravar checkpoint:`,
        error instanceof Error ? error.message : error
      );
    }
  } else {
    console.warn(
      `${LOG_PREFIX} checkpoint NÃO avançado (completeness=${completeness} mode=${options.mode} exit=${exitCode})`
    );
  }

  const markAbsent = shouldMarkStockDocumentsAbsent({
    mode: options.mode,
    completeness,
  });
  if (markAbsent) {
    console.warn(`${LOG_PREFIX} mark-absent não aplicável a sync por janela`);
  }

  const audit = buildStockDocumentsSyncAuditRecord({
    mode: options.mode,
    options,
    startedAt,
    finishedAt,
    exitCode,
    completeness,
    lockAcquired: true,
    lockSkipped: false,
    checkpointAdvanced,
    rateLimit429,
    counters,
    errorMessage: fatalError,
  });
  await persistStockDocumentsIntegrationRun({ audit });

  if (
    options.mode === "apply" &&
    (counters.affectedStockDocumentExternalIds.length > 0 ||
      counters.affectedNfeIds.length > 0)
  ) {
    try {
      await runSalesOrderFlowRecomputeAfterNomusSync(
        prisma,
        buildSalesOrderFlowRecomputeAfterSyncTrigger({
          source: "stock-documents",
          syncMode: "apply",
          stockDocumentExternalIds: [
            ...new Set(counters.affectedStockDocumentExternalIds),
          ],
          nfeIds: [...new Set(counters.affectedNfeIds)],
        })
      );
    } catch (err) {
      console.error(
        `${LOG_PREFIX} sales-order-flow recompute falhou (sync de documentos segue):`,
        err instanceof Error ? err.message : err
      );
    }

    // Snapshot da DRE: Documento de Saída é fallback de itens do CMV. Mapear
    // idNfe→ano/empresa aqui seria caro — invalidação conservadora dos
    // snapshots existentes (barato, soft-fail; refresh acontece fora do sync).
    await markFinanceDreSnapshotsDirtySafe(prisma, { reason: "stock-documents-sync" });
  }

  const durationMs = audit.durationMs;
  console.warn(
    `${LOG_PREFIX} concluído em ${(durationMs / 1000).toFixed(1)}s — recebidos=${counters.documentsReceived} criados=${counters.documentsCreated} atualizados=${counters.documentsUpdated} inalterados=${counters.documentsUnchanged} 429=${rateLimit429} completeness=${completeness} exit=${exitCode}`
  );

  console.log(
    JSON.stringify(
      {
        mode: options.mode,
        audit,
        summary: {
          pagesRead,
          recordsRead,
          mapped: rows.length,
          ...counters,
          plannedCreates: planSummary.documentsToCreate,
          plannedUpdates: planSummary.documentsToUpdate,
          plannedUnchanged: planSummary.documentsUnchanged,
          durationMs,
        },
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
  } finally {
    if (lockFile && lockToken) {
      releaseStockDocumentsSyncLock({ lockFile, token: lockToken });
    }
  }
}

main()
  .catch((error) => {
    console.error(`${LOG_PREFIX} falha`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await disconnectStockDocumentsIntegrationPrisma();
  });
