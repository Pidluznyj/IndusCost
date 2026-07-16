/**
 * Runner do backfill de Ordens de Produção Nomus (OP-08).
 * Página a página, idempotente, com checkpoint/retomada e interrupção segura.
 * Preview não grava; apply persiste OP + vínculos em transações pequenas.
 * Manual only — não entra em cron/orquestrador.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import {
  createNomusProductionOrdersClient,
  NomusProductionOrdersClientError,
  type NomusProductionOrdersClient,
} from "@/src/lib/nomusProductionOrdersClient.js";
import { mapNomusProductionOrderForPersist } from "@/src/lib/nomusProductionOrdersMapper.js";
import { persistNomusProductionOrder } from "@/src/lib/nomusProductionOrdersPersist.server.js";
import { reconcilePendingNomusProductionOrderSalesLinks } from "@/src/lib/nomusProductionOrdersSalesLinks.server.js";
import {
  buildEmptyProductionOrdersBackfillSummary,
  parseProductionOrdersBackfillCli,
  resolveProductionOrdersBackfillStartPage,
  serializeProductionOrdersBackfillCheckpoint,
  shouldStopProductionOrdersBackfill,
  type ProductionOrdersBackfillCheckpoint,
  type ProductionOrdersBackfillCliOptions,
  type ProductionOrdersBackfillErrorItem,
  type ProductionOrdersBackfillSummary,
} from "@/src/lib/nomusProductionOrdersBackfill.js";
import { fetchNomusJson } from "@/src/lib/nomusRestClient.js";
import { PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER } from "@/src/lib/nomusProductionOrdersPreview.js";

const LOG_PREFIX = "[nomus-production-orders-backfill]";

export type ProductionOrdersBackfillPageFetcher = (args: {
  page: number;
  pageSize: number;
}) => Promise<{ items: unknown[]; fingerprint: string }>;

export type ProductionOrdersBackfillPersistFn = (raw: unknown) => Promise<{
  outcome: "created" | "updated" | "unchanged" | "invalid" | "error";
  externalId: number | null;
  links: {
    linksCreated: number;
    linksUpdated: number;
    linksReactivated: number;
    linksMarkedAbsent: number;
    salesOrderResolved: number;
    salesOrderItemResolved: number;
  } | null;
  error: string | null;
}>;

export type ProductionOrdersBackfillDeps = {
  mode: "preview" | "apply";
  options: ProductionOrdersBackfillCliOptions;
  startPage: number;
  fetchPage: ProductionOrdersBackfillPageFetcher;
  persist?: ProductionOrdersBackfillPersistFn;
  reconcilePending?: () => Promise<number>;
  readCheckpoint?: () => string | null;
  writeCheckpoint?: (content: string) => void;
  shouldContinue?: () => boolean;
  logger?: (message: string) => void;
  now?: () => number;
  syncedAt?: Date;
};

function fingerprintItems(items: unknown[]): string {
  const ids = items
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const id = (item as { id?: unknown }).id;
      if (typeof id === "number" && Number.isFinite(id)) return Math.trunc(id);
      if (typeof id === "string" && id.trim()) {
        const n = Number.parseInt(id.trim(), 10);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    })
    .filter((id): id is number => id != null)
    .sort((a, b) => a - b);
  return ids.length > 0 ? `ids:${ids.join(",")}` : `len:${items.length}`;
}

export async function runProductionOrdersBackfillLoop(
  deps: ProductionOrdersBackfillDeps
): Promise<ProductionOrdersBackfillSummary> {
  const started = (deps.now ?? Date.now)();
  const log = deps.logger ?? ((m: string) => console.warn(m));
  const summary = buildEmptyProductionOrdersBackfillSummary(deps.options, deps.startPage);
  summary.mode = deps.mode;

  if (deps.mode === "preview") {
    log(`${LOG_PREFIX} ${PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER}`);
  }

  let page = deps.startPage;
  let previousFingerprint: string | null = null;
  let lastExternalId: number | null = null;
  let interrupted = false;
  let completedCatalog = false;

  const pushError = (item: ProductionOrdersBackfillErrorItem) => {
    summary.errors += 1;
    summary.errorReport.push(item);
  };

  const saveCheckpoint = (nextPage: number, pagesCompleted: number) => {
    const checkpoint: ProductionOrdersBackfillCheckpoint = {
      nextPage,
      pagesCompleted,
      lastExternalId,
      updatedAt: new Date((deps.now ?? Date.now)()).toISOString(),
    };
    summary.checkpoint = checkpoint;
    if (deps.mode === "apply" && deps.writeCheckpoint) {
      try {
        deps.writeCheckpoint(serializeProductionOrdersBackfillCheckpoint(checkpoint));
      } catch (error) {
        pushError({
          page,
          externalId: null,
          stage: "checkpoint",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (deps.mode === "preview") {
      log(
        `${LOG_PREFIX} checkpoint preview (não gravado): nextPage=${nextPage} pagesCompleted=${pagesCompleted}`
      );
    }
  };

  while (
    !shouldStopProductionOrdersBackfill({
      pagesRead: summary.pagesRead,
      maxPages: deps.options.maxPages,
      hardMaxPages: deps.options.hardMaxPages,
      interrupted,
      completedCatalog,
    })
  ) {
    if (deps.shouldContinue && !deps.shouldContinue()) {
      interrupted = true;
      pushError({
        page,
        externalId: null,
        stage: "interrupt",
        message: "Interrupção segura solicitada; checkpoint preservado.",
      });
      saveCheckpoint(page, summary.pagesRead);
      break;
    }

    let pageItems: unknown[] = [];
    let fingerprint = "";
    try {
      const fetched = await deps.fetchPage({
        page,
        pageSize: deps.options.pageSize,
      });
      pageItems = fetched.items;
      fingerprint = fetched.fingerprint || fingerprintItems(fetched.items);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushError({ page, externalId: null, stage: "fetch", message });
      if (
        error instanceof NomusProductionOrdersClientError &&
        error.code === "REPEATED_PAGE"
      ) {
        log(`${LOG_PREFIX} página repetida em pagina=${page}; encerrando com segurança.`);
        saveCheckpoint(page, summary.pagesRead);
        break;
      }
      // Falha de fetch: não avança página (retomada reprocessa a mesma).
      saveCheckpoint(page, summary.pagesRead);
      break;
    }

    if (previousFingerprint != null && fingerprint === previousFingerprint) {
      pushError({
        page,
        externalId: null,
        stage: "fetch",
        message: `Página repetida detectada em pagina=${page}.`,
      });
      saveCheckpoint(page, summary.pagesRead);
      break;
    }
    previousFingerprint = fingerprint;

    summary.pagesRead += 1;
    summary.recordsReceived += pageItems.length;

    if (pageItems.length === 0) {
      completedCatalog = true;
      saveCheckpoint(1, summary.pagesRead);
      break;
    }

    for (const raw of pageItems) {
      const mapped = mapNomusProductionOrderForPersist(raw);
      if (!mapped.ok) {
        summary.invalid += 1;
        pushError({
          page,
          externalId: mapped.externalId,
          stage: "map",
          message: mapped.reasons.join(",") || "INVALID_PAYLOAD",
        });
        continue;
      }

      lastExternalId = mapped.row.externalId;
      summary.linkedRows += mapped.row.salesLinks.length;

      if (!deps.persist) {
        summary.created += 1;
        continue;
      }

      try {
        const result = await deps.persist(raw);
        if (result.outcome === "created") summary.created += 1;
        else if (result.outcome === "updated") summary.updated += 1;
        else if (result.outcome === "unchanged") summary.unchanged += 1;
        else if (result.outcome === "invalid") {
          summary.invalid += 1;
          pushError({
            page,
            externalId: result.externalId,
            stage: "map",
            message: "invalid",
          });
        } else {
          pushError({
            page,
            externalId: result.externalId,
            stage: "persist",
            message: result.error ?? "persist error",
          });
        }
        if (result.links) {
          summary.linksCreated += result.links.linksCreated;
          summary.linksUpdated += result.links.linksUpdated;
          summary.linksReactivated += result.links.linksReactivated;
          summary.linksMarkedAbsent += result.links.linksMarkedAbsent;
          const linkCount = mapped.row.salesLinks.length;
          const resolvedPairs = Math.min(
            result.links.salesOrderResolved,
            result.links.salesOrderItemResolved
          );
          summary.locallyResolved += resolvedPairs;
          summary.unresolved += Math.max(0, linkCount - resolvedPairs);
        }
      } catch (error) {
        pushError({
          page,
          externalId: mapped.row.externalId,
          stage: "persist",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Checkpoint aponta para a próxima página após sucesso da atual.
    const nextPage = page + 1;
    saveCheckpoint(nextPage, summary.pagesRead);
    page = nextPage;
  }

  if (deps.mode === "apply" && deps.reconcilePending) {
    try {
      summary.pendingLinksReconciled = await deps.reconcilePending();
    } catch (error) {
      pushError({
        page: null,
        externalId: null,
        stage: "persist",
        message: `reconcilePending: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  summary.interrupted = interrupted;
  summary.completedCatalog = completedCatalog;
  summary.duration = (deps.now ?? Date.now)() - started;
  return summary;
}

function readCursorFile(path: string | null): string | null {
  if (!path) return null;
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export async function runNomusProductionOrdersBackfill(args: {
  prisma?: PrismaClient;
  argv?: string[];
  options?: ProductionOrdersBackfillCliOptions;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  client?: NomusProductionOrdersClient;
  signal?: AbortSignal;
  logger?: (message: string) => void;
  /** Injetável em testes. */
  fetchPage?: ProductionOrdersBackfillPageFetcher;
  persist?: ProductionOrdersBackfillPersistFn;
  reconcilePending?: () => Promise<number>;
  readCheckpoint?: () => string | null;
  writeCheckpoint?: (content: string) => void;
  rateLimitCounter?: { count: number };
}): Promise<ProductionOrdersBackfillSummary> {
  const env = args.env ?? process.env;
  const options =
    args.options ?? parseProductionOrdersBackfillCli(args.argv ?? process.argv.slice(2), env);
  const log = args.logger ?? ((m: string) => console.warn(m));

  const cursorContent =
    args.readCheckpoint?.() ??
    (options.cursorFile ? readCursorFile(options.cursorFile) : null);
  const startPage = resolveProductionOrdersBackfillStartPage({
    options,
    cursorContent,
  });

  log(
    `${LOG_PREFIX} mode=${options.mode} startPage=${startPage} maxPages=${options.maxPages} hardMax=${options.hardMaxPages} cursor=${options.cursorFile ?? "(none)"} reprocess=${options.reprocess}`
  );

  const rateLimitCounter = args.rateLimitCounter ?? { count: 0 };

  const fetchPage: ProductionOrdersBackfillPageFetcher =
    args.fetchPage ??
    (() => {
      const client =
        args.client ??
        createNomusProductionOrdersClient({
          baseUrl: args.baseUrl,
          pageSize: options.pageSize,
          maxPages: 1,
          env,
          logger: log,
          fetchJson: async (url, fetchOptions) =>
            fetchNomusJson(url, {
              ...fetchOptions,
              onRetryableStatus: (info) => {
                if (info.status === 429) rateLimitCounter.count += 1;
                fetchOptions?.onRetryableStatus?.(info);
              },
            }),
        });
      return async ({ page, pageSize }) => {
        const result = await client.listPage({ page, pageSize, query: null });
        return {
          items: result.items,
          fingerprint: fingerprintItems(result.items),
        };
      };
    })();

  const persist: ProductionOrdersBackfillPersistFn | undefined =
    args.persist ??
    (args.prisma
      ? async (raw) => {
          if (options.mode === "apply") {
            const result = await persistNomusProductionOrder(args.prisma!, raw, {
              useTransaction: true,
            });
            return {
              outcome: result.outcome,
              externalId: result.externalId,
              links: result.links,
              error: result.error,
            };
          }

          // Preview: somente leitura — classifica sem gravar.
          const mapped = mapNomusProductionOrderForPersist(raw);
          if (!mapped.ok) {
            return {
              outcome: "invalid",
              externalId: mapped.externalId,
              links: null,
              error: mapped.reasons.join(","),
            };
          }
          const existing = await args.prisma!.nomusProductionOrder.findUnique({
            where: { externalId: mapped.row.externalId },
            select: { payloadHash: true },
          });
          let outcome: "created" | "updated" | "unchanged" = "created";
          if (existing) {
            outcome =
              existing.payloadHash === mapped.row.payloadHash ? "unchanged" : "updated";
          }
          let salesOrderResolved = 0;
          let salesOrderItemResolved = 0;
          for (const link of mapped.row.salesLinks) {
            const so = await args.prisma!.salesOrder.findFirst({
              where: { externalSalesOrderId: link.externalSalesOrderId },
              select: { id: true },
            });
            const soi = await args.prisma!.salesOrderItem.findFirst({
              where: { nomusItemExternalId: link.externalSalesOrderItemId },
              select: { id: true },
            });
            if (so) salesOrderResolved += 1;
            if (soi) salesOrderItemResolved += 1;
          }
          return {
            outcome,
            externalId: mapped.row.externalId,
            links: {
              linksCreated: existing ? 0 : mapped.row.salesLinks.length,
              linksUpdated: existing ? mapped.row.salesLinks.length : 0,
              linksReactivated: 0,
              linksMarkedAbsent: 0,
              salesOrderResolved,
              salesOrderItemResolved,
            },
            error: null,
          };
        }
      : undefined);

  const reconcilePending =
    args.reconcilePending ??
    (options.mode === "apply" && args.prisma
      ? async () => {
          const result = await reconcilePendingNomusProductionOrderSalesLinks(args.prisma!, {
            limit: 2000,
          });
          return result.updated;
        }
      : undefined);

  const writeCheckpoint =
    args.writeCheckpoint ??
    (options.mode === "apply" && options.cursorFile
      ? (content: string) => {
          writeFileSync(options.cursorFile!, content, "utf8");
          log(`${LOG_PREFIX} checkpoint gravado ${options.cursorFile}`);
        }
      : undefined);

  const summary = await runProductionOrdersBackfillLoop({
    mode: options.mode,
    options,
    startPage,
    fetchPage,
    persist,
    reconcilePending,
    readCheckpoint: () => cursorContent,
    writeCheckpoint,
    shouldContinue: () => !(args.signal?.aborted ?? false),
    logger: log,
  });

  summary.rateLimitCount = rateLimitCounter.count;
  return summary;
}
