/**
 * Sync manual Nomus documentosEstoque → NomusStockDocument / NomusStockDocumentItem.
 *
 * Isolado: não altera AR, Faturamento, Fluxo de Caixa, Comissões, SalesOrder, NomusNfe.
 * Sem cron / sem rotina automática.
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
  hasNextStockDocumentsPage,
  NOMUS_STOCK_DOCUMENTS_RESOURCE,
  parseStockDocumentsSyncCli,
  pickStockDocumentsArray,
  planStockDocumentPersist,
  shouldWriteStockDocuments,
  summarizeStockDocumentPersistPlans,
  type StockDocumentsSyncCliOptions,
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
  mapErrors: number;
}> {
  const rows: MappedNomusStockDocument[] = [];
  let pagesRead = 0;
  let recordsRead = 0;
  let mapErrors = 0;
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
        mapErrors += 1;
        continue;
      }
      rows.push(mapped.row);
    }

    if (!hasNextStockDocumentsPage(payload, page, items.length, options.pageSize)) break;
  }

  return { pagesRead, recordsRead, rows, mapErrors };
}

function dedupeByExternalId(rows: MappedNomusStockDocument[]): MappedNomusStockDocument[] {
  const byId = new Map<number, MappedNomusStockDocument>();
  for (const row of rows) byId.set(row.externalId, row);
  return [...byId.values()];
}

async function runApply(rows: MappedNomusStockDocument[], syncedAt: Date) {
  let created = 0;
  let updated = 0;
  let itemsWritten = 0;
  let documentsWithoutItems = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.nomusStockDocument.findUnique({
          where: { externalId: row.externalId },
          select: { id: true },
        });

        const headerData = {
          idNfe: row.idNfe,
          tipoDocumentoEstoque: row.tipoDocumentoEstoque,
          dataDocumento: row.dataDocumento,
          rawJson: row.rawJson as Prisma.InputJsonValue,
          syncedAt,
        };

        const document =
          existing == null
            ? await tx.nomusStockDocument.create({
                data: {
                  externalId: row.externalId,
                  ...headerData,
                },
                select: { id: true },
              })
            : await tx.nomusStockDocument.update({
                where: { externalId: row.externalId },
                data: headerData,
                select: { id: true },
              });

        if (existing == null) created += 1;
        else updated += 1;

        await tx.nomusStockDocumentItem.deleteMany({
          where: { stockDocumentId: document.id },
        });

        if (row.items.length === 0) {
          documentsWithoutItems += 1;
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
        itemsWritten += row.items.length;
      });
    } catch (error) {
      errors += 1;
      console.error(
        `${LOG_PREFIX} erro ao persistir externalId=${row.externalId}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return { created, updated, itemsWritten, documentsWithoutItems, errors };
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
  let mapErrors = 0;
  const allRows: MappedNomusStockDocument[] = [];

  for (const query of queries) {
    const fetched = await fetchAllForQuery(baseUrl, query, options);
    pagesRead += fetched.pagesRead;
    recordsRead += fetched.recordsRead;
    mapErrors += fetched.mapErrors;
    allRows.push(...fetched.rows);
  }

  const rows = dedupeByExternalId(allRows);
  const existing = await prisma.nomusStockDocument.findMany({
    where: { externalId: { in: rows.map((row) => row.externalId) } },
    select: { externalId: true },
  });
  const existingIds = new Set(existing.map((row) => row.externalId));
  const plans = rows.map((row) => planStockDocumentPersist(row, existingIds));
  const planSummary = summarizeStockDocumentPersistPlans(plans);

  let applied: Awaited<ReturnType<typeof runApply>> | null = null;
  if (shouldWriteStockDocuments(options.mode)) {
    applied = await runApply(rows, new Date());
  } else {
    console.warn(`${LOG_PREFIX} preview — nenhuma escrita no banco`);
  }

  const durationMs = Date.now() - startedMs;
  const summary = {
    mode: options.mode,
    pagesRead,
    recordsRead,
    mapped: rows.length,
    mapErrors,
    documentsWithoutItems:
      applied?.documentsWithoutItems ?? planSummary.documentsWithoutItems,
    plannedCreates: planSummary.documentsToCreate,
    plannedUpdates: planSummary.documentsToUpdate,
    plannedItems: planSummary.itemsToWrite,
    created: applied?.created ?? 0,
    updated: applied?.updated ?? 0,
    itemsWritten: applied?.itemsWritten ?? 0,
    errors: applied?.errors ?? 0,
    durationMs,
  };

  console.warn(
    `${LOG_PREFIX} concluído em ${(durationMs / 1000).toFixed(1)}s — lidos=${summary.recordsRead} mapeados=${summary.mapped} criados=${summary.created} atualizados=${summary.updated} itens=${summary.itemsWritten} semItens=${summary.documentsWithoutItems} erros=${summary.errors + summary.mapErrors}`
  );

  console.log(
    JSON.stringify(
      {
        mode: options.mode,
        summary,
        preview: rows.slice(0, 5).map((row) => ({
          externalId: row.externalId,
          idNfe: row.idNfe,
          tipoDocumentoEstoque: row.tipoDocumentoEstoque,
          dataDocumento: row.dataDocumento?.toISOString() ?? null,
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
