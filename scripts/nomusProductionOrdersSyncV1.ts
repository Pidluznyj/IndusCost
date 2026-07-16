/**
 * Sync Nomus `/rest/ordens` → NomusProductionOrder + NomusProductionOrderSalesLink.
 *
 * Isolado: não altera Pedido de Venda, NF-e, AR/AP, Fluxo, Comissões, Formação de Preço, BOM.
 * Idempotente por externalId / (productionOrderExternalId, externalSalesOrderItemId).
 *
 * Uso:
 *   npx tsx scripts/nomusProductionOrdersSyncV1.ts preview --strategy=incremental
 *   npx tsx scripts/nomusProductionOrdersSyncV1.ts apply --strategy=backfill
 *   npx tsx scripts/nomusProductionOrdersSyncV1.ts preview --externalId=30347
 *   npx tsx scripts/nomusProductionOrdersSyncV1.ts preview --name="OP 05800 - 003"
 *   npx tsx scripts/nomusProductionOrdersSyncV1.ts preview --from=2026-01-01 --to=2026-07-16
 *   npx tsx scripts/nomusProductionOrdersSyncV1.ts apply --salesOrderExternalId=2530
 */
import "dotenv/config";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  mapNomusProductionOrderPayload,
  type MappedNomusProductionOrder,
  type JsonObject,
} from "../src/lib/nomusProductionOrdersMapper.ts";
import {
  buildProductionOrdersPageParams,
  buildProductionOrdersSyncQueries,
  hasNextProductionOrdersPage,
  isProductionOrdersAfterSalesSyncEnabled,
  NOMUS_PRODUCTION_ORDERS_DEFAULT_INCREMENTAL_MAX_PAGES,
  NOMUS_PRODUCTION_ORDERS_DEFAULT_PAGE_SIZE,
  NOMUS_PRODUCTION_ORDERS_RESOURCE,
  parseProductionOrdersSyncCli,
  pickProductionOrdersArray,
  planProductionOrderPersist,
  resolveProductionOrdersNextCursor,
  shouldWriteProductionOrders,
  summarizeProductionOrderPersistPlans,
  type ProductionOrdersSyncCliOptions,
} from "../src/lib/nomusProductionOrdersSyncLogic.ts";
import { upsertNomusProductionOrder } from "../src/lib/nomusProductionOrdersRepository.server.ts";
import { reconcilePendingNomusProductionOrderSalesLinks } from "../src/lib/nomusProductionOrdersSalesLinks.server.ts";
import { runNomusProductionOrdersPreviewWithPrisma } from "../src/lib/nomusProductionOrdersPreview.server.ts";
import { PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER } from "../src/lib/nomusProductionOrdersPreview.ts";
import { readSalesOrdersPageCursor } from "../src/lib/nomusSalesOrdersPaginationCursor.ts";
import {
  buildNomusUrl,
  describeNomusCredential,
  fetchNomusJson,
  redactHeadersForLog,
  redactNomusUrlForLog,
} from "../src/lib/nomusRestClient.ts";

const LOG_PREFIX = "[nomus-production-orders]";

export type NomusProductionOrdersSyncSummary = {
  mode: "preview" | "apply";
  strategy: string;
  pagesRead: number;
  recordsRead: number;
  mapped: number;
  mapErrors: number;
  create: number;
  update: number;
  unchanged: number;
  salesLinks: number;
  linksCreated: number;
  linksUpdated: number;
  linksMarkedAbsent: number;
  writeErrors: number;
  durationMs: number;
};

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function resolveStartPage(options: ProductionOrdersSyncCliOptions): number {
  if (options.strategy !== "backfill" || !options.cursorFile) return options.startPage;
  let content: string | null = null;
  try {
    if (existsSync(options.cursorFile)) {
      content = readFileSync(options.cursorFile, "utf8");
    }
  } catch {
    content = null;
  }
  return readSalesOrdersPageCursor({
    cursorFile: options.cursorFile,
    defaultStartPage: options.startPage,
    cursorContent: content,
  });
}

function persistCursor(options: ProductionOrdersSyncCliOptions, nextStart: number, reason: string) {
  if (!options.cursorFile || options.strategy !== "backfill") return;
  if (!shouldWriteProductionOrders(options.mode)) {
    console.warn(`${LOG_PREFIX} cursor preview (não gravado): next=${nextStart} (${reason})`);
    return;
  }
  writeFileSync(options.cursorFile, `${nextStart}\n`, "utf8");
  console.warn(`${LOG_PREFIX} cursor gravado ${options.cursorFile} → ${nextStart} (${reason})`);
}

async function fetchMappedForQuery(
  baseUrl: string,
  query: string | null,
  options: ProductionOrdersSyncCliOptions,
  startPage: number
): Promise<{
  pagesRead: number;
  recordsRead: number;
  rows: MappedNomusProductionOrder[];
  mapErrors: number;
  lastPageFetched: number;
  stoppedBecauseEmpty: boolean;
  completedWindow: boolean;
}> {
  const rows: MappedNomusProductionOrder[] = [];
  let pagesRead = 0;
  let recordsRead = 0;
  let mapErrors = 0;
  let lastPageFetched = startPage - 1;
  let stoppedBecauseEmpty = false;
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  const endPage = startPage + maxPages - 1;

  for (let page = startPage; page <= endPage; page += 1) {
    const url = buildNomusUrl(
      baseUrl,
      NOMUS_PRODUCTION_ORDERS_RESOURCE,
      buildProductionOrdersPageParams(page, options.pageSize, query)
    );
    console.warn(`${LOG_PREFIX} GET ${redactNomusUrlForLog(url)}`);
    const payload = await fetchNomusJson(url, { logPrefix: LOG_PREFIX });
    const items = pickProductionOrdersArray(payload).filter(
      (item): item is JsonObject => !!item && typeof item === "object" && !Array.isArray(item)
    );
    pagesRead += 1;
    recordsRead += items.length;
    lastPageFetched = page;
    console.warn(
      `${LOG_PREFIX} página ${page}: ${items.length} registros${query ? ` (query=${query})` : ""}`
    );

    for (const item of items) {
      const mapped = mapNomusProductionOrderPayload(item);
      if (!mapped.ok) {
        mapErrors += 1;
        continue;
      }
      rows.push(mapped.row);
    }

    if (items.length === 0) {
      stoppedBecauseEmpty = true;
      break;
    }
    if (!hasNextProductionOrdersPage(payload, page, items.length, options.pageSize)) break;
  }

  const completedWindow = pagesRead >= (options.maxPages ?? pagesRead) && !stoppedBecauseEmpty;

  return {
    pagesRead,
    recordsRead,
    rows,
    mapErrors,
    lastPageFetched,
    stoppedBecauseEmpty,
    completedWindow,
  };
}

function dedupeByExternalId(rows: MappedNomusProductionOrder[]): MappedNomusProductionOrder[] {
  const byId = new Map<number, MappedNomusProductionOrder>();
  for (const row of rows) byId.set(row.externalId, row);
  return [...byId.values()];
}

export async function runNomusProductionOrdersSync(args: {
  prisma: PrismaClient;
  argv?: string[];
  baseUrl?: string;
}): Promise<NomusProductionOrdersSyncSummary | Record<string, unknown>> {
  const options = parseProductionOrdersSyncCli(args.argv ?? process.argv.slice(2));

  // OP-07: preview dedicado — consulta API e planeja efeitos sem gravar.
  if (!shouldWriteProductionOrders(options.mode)) {
    const preview = await runNomusProductionOrdersPreviewWithPrisma({
      prisma: args.prisma,
      argv: args.argv ?? process.argv.slice(2),
      baseUrl: args.baseUrl,
    });
    console.warn(`${LOG_PREFIX} ${PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER}`);
    console.log(JSON.stringify({ ok: true, ...preview }, null, 2));
    return preview;
  }

  const startedMs = Date.now();
  const baseUrl = args.baseUrl ?? getRequiredEnv("NOMUS_BASE_URL");
  const startPage = resolveStartPage(options);

  const envForLog = redactHeadersForLog(
    Object.fromEntries(
      Object.entries({
        NOMUS_BASE_URL: baseUrl,
        NOMUS_TOKEN: process.env.NOMUS_TOKEN ?? "",
        NOMUS_AUTH_HEADER_NAME: process.env.NOMUS_AUTH_HEADER_NAME ?? "",
        NOMUS_AUTH_HEADER_VALUE: process.env.NOMUS_AUTH_HEADER_VALUE ?? "",
      })
    )
  );
  console.warn(`${LOG_PREFIX} mode=${options.mode} strategy=${options.strategy}`);
  console.warn(`${LOG_PREFIX} credenciais:`, {
    ...envForLog,
    token: describeNomusCredential(process.env.NOMUS_TOKEN),
  });

  const queries = buildProductionOrdersSyncQueries(options);

  if (options.strategy === "point" && queries.length === 0) {
    throw new Error(
      "Consulta pontual exige --externalId, --name, --salesOrderExternalId e/ou --from/--to."
    );
  }

  let pagesRead = 0;
  let recordsRead = 0;
  let mapErrors = 0;
  const allRows: MappedNomusProductionOrder[] = [];
  let lastMeta = {
    lastPageFetched: startPage - 1,
    stoppedBecauseEmpty: false,
    completedWindow: false,
  };

  for (const query of queries) {
    const fetchResult = await fetchMappedForQuery(
      baseUrl,
      query,
      { ...options, startPage },
      startPage
    );
    pagesRead += fetchResult.pagesRead;
    recordsRead += fetchResult.recordsRead;
    mapErrors += fetchResult.mapErrors;
    allRows.push(...fetchResult.rows);
    lastMeta = {
      lastPageFetched: fetchResult.lastPageFetched,
      stoppedBecauseEmpty: fetchResult.stoppedBecauseEmpty,
      completedWindow: fetchResult.completedWindow,
    };
  }

  const rows = dedupeByExternalId(allRows);
  const existing = await args.prisma.nomusProductionOrder.findMany({
    where: { externalId: { in: rows.map((r) => r.externalId) } },
    select: { externalId: true },
  });
  const existingIds = new Set(existing.map((r) => r.externalId));
  const plans = rows.map((row) => planProductionOrderPersist(row, existingIds));
  const summaryPlans = summarizeProductionOrderPersistPlans(plans);

  console.warn(
    `${LOG_PREFIX} preview: mapped=${rows.length} create=${summaryPlans.create} update=${summaryPlans.update} salesLinks=${summaryPlans.salesLinks} mapErrors=${mapErrors}`
  );

  let linksCreated = 0;
  let linksUpdated = 0;
  let linksMarkedAbsent = 0;
  let writeErrors = 0;
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  if (shouldWriteProductionOrders(options.mode)) {
    const syncedAt = new Date();
    for (const row of rows) {
      try {
        // OP-05/OP-06: cabeçalho + vínculos oficiais itensPedido.
        const result = await args.prisma.$transaction(async (tx) =>
          upsertNomusProductionOrder(tx, row, syncedAt)
        );
        if (result.action === "create") created += 1;
        else if (result.action === "update") updated += 1;
        else unchanged += 1;
        linksCreated += result.linksCreated;
        linksUpdated += result.linksUpdated;
        linksMarkedAbsent += result.linksMarkedAbsent;
      } catch (error) {
        writeErrors += 1;
        console.error(
          `${LOG_PREFIX} erro ao persistir externalId=${row.externalId}:`,
          error instanceof Error ? error.message : error
        );
      }
    }
  } else {
    created = summaryPlans.create;
    updated = summaryPlans.update;
  }

  if (options.strategy === "backfill") {
    const next = resolveProductionOrdersNextCursor({
      startPage,
      maxPages: options.maxPages ?? 1,
      lastPageFetched: lastMeta.lastPageFetched,
      totalPedidos: recordsRead,
      stoppedBecauseEmpty: lastMeta.stoppedBecauseEmpty,
      completedWindow: lastMeta.completedWindow,
    });
    persistCursor(options, next.nextStart, next.reason);
  }

  const summary: NomusProductionOrdersSyncSummary = {
    mode: options.mode,
    strategy: options.strategy,
    pagesRead,
    recordsRead,
    mapped: rows.length,
    mapErrors,
    create: created,
    update: updated,
    unchanged,
    salesLinks: summaryPlans.salesLinks,
    linksCreated,
    linksUpdated,
    linksMarkedAbsent,
    writeErrors,
    durationMs: Date.now() - startedMs,
  };

  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
  return summary;
}

/**
 * Pós-sync de Pedidos de Venda: incremental limitado (soft-fail no chamador).
 * Não consulta Nomus em abertura de tela — só scripts/cron.
 */
export async function runNomusProductionOrdersAfterSalesOrdersSync(
  prisma: PrismaClient,
  options?: { salesOrderExternalIds?: number[]; maxPages?: number }
): Promise<NomusProductionOrdersSyncSummary | null> {
  if (!isProductionOrdersAfterSalesSyncEnabled()) {
    console.warn(`${LOG_PREFIX} pós-sync desabilitado (NOMUS_PRODUCTION_ORDERS_AFTER_SYNC).`);
    return null;
  }

  const salesOrderExternalIds = (options?.salesOrderExternalIds ?? []).filter(
    (id) => Number.isFinite(id) && id > 0
  );

  const argv =
    salesOrderExternalIds.length > 0
      ? [
          "apply",
          `--salesOrderExternalId=${salesOrderExternalIds.join(",")}`,
          `--max-pages=${options?.maxPages ?? 3}`,
          `--page-size=${NOMUS_PRODUCTION_ORDERS_DEFAULT_PAGE_SIZE}`,
        ]
      : [
          "apply",
          "--strategy=incremental",
          `--max-pages=${options?.maxPages ?? NOMUS_PRODUCTION_ORDERS_DEFAULT_INCREMENTAL_MAX_PAGES}`,
          `--page-size=${NOMUS_PRODUCTION_ORDERS_DEFAULT_PAGE_SIZE}`,
        ];

  const summary = await runNomusProductionOrdersSync({ prisma, argv });

  // Após pedidos sincronizados: preenche FKs locais em vínculos ainda pendentes.
  try {
    const reconciled = await reconcilePendingNomusProductionOrderSalesLinks(prisma, {
      externalSalesOrderIds:
        salesOrderExternalIds.length > 0 ? salesOrderExternalIds : undefined,
      limit: 2000,
    });
    console.warn(
      `${LOG_PREFIX} reconcile vínculos pendentes: scanned=${reconciled.scanned} updated=${reconciled.updated} salesOrderResolved=${reconciled.salesOrderResolved} salesOrderItemResolved=${reconciled.salesOrderItemResolved}`
    );
  } catch (error) {
    console.error(
      `${LOG_PREFIX} falha ao reconciliar vínculos pendentes (soft-fail):`,
      error instanceof Error ? error.message : error
    );
  }

  return summary;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await runNomusProductionOrdersSync({ prisma });
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  process.argv[1]?.includes("nomusProductionOrdersSyncV1") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("nomusProductionOrdersSyncV1.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(`${LOG_PREFIX} erro:`, err);
    process.exitCode = 1;
  });
}
