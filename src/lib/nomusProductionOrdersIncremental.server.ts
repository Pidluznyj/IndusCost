/**
 * Runner do sync incremental de Ordens de Produção Nomus (OP-09).
 * Estado de último sucesso só avança após apply bem-sucedido.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import {
  createNomusProductionOrdersClient,
  type NomusProductionOrdersClient,
} from "@/src/lib/nomusProductionOrdersClient.js";
import { persistNomusProductionOrder } from "@/src/lib/nomusProductionOrdersPersist.server.js";
import { mapNomusProductionOrderForPersist } from "@/src/lib/nomusProductionOrdersMapper.js";
import { reconcilePendingNomusProductionOrderSalesLinks } from "@/src/lib/nomusProductionOrdersSalesLinks.server.js";
import {
  buildProductionOrdersIncrementalSuccessState,
  parseProductionOrdersIncrementalCli,
  parseProductionOrdersIncrementalState,
  planProductionOrdersIncremental,
  rebuildIncrementalPlanAfterSelectorRejection,
  serializeProductionOrdersIncrementalState,
  type ProductionOrdersIncrementalCliOptions,
  type ProductionOrdersIncrementalPlan,
  type ProductionOrdersIncrementalState,
  type ProductionOrdersIncrementalSummary,
} from "@/src/lib/nomusProductionOrdersIncremental.js";
import { isNomusRsqlSelectorRejectionError } from "@/src/lib/nomusProductionOrdersSelectorProbe.js";
import { fetchNomusJson } from "@/src/lib/nomusRestClient.js";
import { PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER } from "@/src/lib/nomusProductionOrdersPreview.js";
import {
  auditFromIncrementalSummary,
  withProductionOrdersSyncGuard,
} from "@/src/lib/nomusProductionOrdersSyncGuard.server.js";
import type { ProductionOrdersSyncAuditRecord } from "@/src/lib/nomusProductionOrdersSyncAudit.js";

const LOG_PREFIX = "[nomus-production-orders-incremental]";

export type ProductionOrdersIncrementalFetchPages = (args: {
  query: string | null;
  pageSize: number;
  maxPages: number;
}) => Promise<{ pagesRead: number; recordsReceived: number; items: unknown[] }>;

export type ProductionOrdersIncrementalPersistFn = (raw: unknown) => Promise<{
  outcome: "created" | "updated" | "unchanged" | "invalid" | "error";
  externalId: number | null;
  links: {
    linksCreated: number;
    linksUpdated: number;
    linksReactivated: number;
    linksMarkedAbsent: number;
  } | null;
  error: string | null;
}>;

export type ProductionOrdersIncrementalDeps = {
  mode: "preview" | "apply";
  plan: ProductionOrdersIncrementalPlan;
  stateFile: string | null;
  fetchPages: ProductionOrdersIncrementalFetchPages;
  persist?: ProductionOrdersIncrementalPersistFn;
  reconcilePending?: () => Promise<number>;
  readState?: () => string | null;
  writeState?: (content: string) => void;
  logger?: (message: string) => void;
  now?: () => number;
};

function readStateFile(path: string | null): string | null {
  if (!path) return null;
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export async function runProductionOrdersIncrementalLoop(
  deps: ProductionOrdersIncrementalDeps
): Promise<ProductionOrdersIncrementalSummary> {
  const started = (deps.now ?? Date.now)();
  const log = deps.logger ?? ((m: string) => console.warn(m));
  const finishedAt = new Date((deps.now ?? Date.now)());

  if (deps.mode === "preview") {
    log(`${LOG_PREFIX} ${PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER}`);
  }

  if (!deps.plan.selectorDecision.ok) {
    log(
      `${LOG_PREFIX} FALLBACK AUDITADO: seletor rejeitado=${deps.plan.selectorDecision.requested} reason=${deps.plan.selectorDecision.reason} strategy=${deps.plan.strategy} maxPages=${deps.plan.maxPages}`
    );
  } else {
    log(
      `${LOG_PREFIX} selector=${deps.plan.selectorDecision.selector} cutoff=${deps.plan.cutoffIso} filter=${deps.plan.filterRsql} overlapHours=${deps.plan.overlapHours} bootstrap=${deps.plan.bootstrap}`
    );
  }

  const summary: ProductionOrdersIncrementalSummary = {
    mode: deps.mode,
    strategy: "incremental",
    plan: deps.plan,
    pagesRead: 0,
    recordsReceived: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    invalid: 0,
    linkedRows: 0,
    linksCreated: 0,
    linksUpdated: 0,
    linksReactivated: 0,
    linksMarkedAbsent: 0,
    errors: 0,
    errorReport: [],
    stateAdvanced: false,
    stateFile: deps.stateFile,
    filterUsed: deps.plan.filterRsql,
    cutoffUsed: deps.plan.cutoffIso,
    duration: 0,
  };

  let fetchFailed = false;
  let items: unknown[] = [];
  let activePlan = deps.plan;
  summary.selectorRejectedAtRuntime = false;
  summary.selectorRejectionMessage = null;

  try {
    const fetched = await deps.fetchPages({
      query: activePlan.filterRsql,
      pageSize: activePlan.pageSize,
      maxPages: activePlan.maxPages,
    });
    summary.pagesRead = fetched.pagesRead;
    summary.recordsReceived = fetched.recordsReceived;
    items = fetched.items;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      activePlan.strategy === "date_filter" &&
      activePlan.filterRsql &&
      isNomusRsqlSelectorRejectionError(error)
    ) {
      summary.selectorRejectedAtRuntime = true;
      summary.selectorRejectionMessage = message;
      activePlan = rebuildIncrementalPlanAfterSelectorRejection({
        plan: activePlan,
        message,
      });
      summary.plan = activePlan;
      summary.filterUsed = null;
      log(
        `${LOG_PREFIX} SELECTOR REJECTED em runtime — fallback limited_page_window maxPages=${activePlan.maxPages} reason=${message}`
      );
      try {
        const fetched = await deps.fetchPages({
          query: null,
          pageSize: activePlan.pageSize,
          maxPages: activePlan.maxPages,
        });
        summary.pagesRead = fetched.pagesRead;
        summary.recordsReceived = fetched.recordsReceived;
        items = fetched.items;
      } catch (fallbackError) {
        fetchFailed = true;
        summary.errors += 1;
        summary.errorReport.push({
          externalId: null,
          message:
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    } else {
      fetchFailed = true;
      summary.errors += 1;
      summary.errorReport.push({
        externalId: null,
        message,
      });
    }
  }

  if (!fetchFailed) {
    for (const raw of items) {
      const mapped = mapNomusProductionOrderForPersist(raw);
      if (!mapped.ok) {
        summary.invalid += 1;
        summary.errors += 1;
        summary.errorReport.push({
          externalId: mapped.externalId,
          message: mapped.reasons.join(",") || "INVALID_PAYLOAD",
        });
        continue;
      }
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
          summary.errors += 1;
        } else {
          summary.errors += 1;
          summary.errorReport.push({
            externalId: result.externalId,
            message: result.error ?? "persist error",
          });
        }
        if (result.links) {
          summary.linksCreated += result.links.linksCreated;
          summary.linksUpdated += result.links.linksUpdated;
          summary.linksReactivated += result.links.linksReactivated;
          summary.linksMarkedAbsent += result.links.linksMarkedAbsent;
        }
      } catch (error) {
        summary.errors += 1;
        summary.errorReport.push({
          externalId: mapped.row.externalId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (deps.mode === "apply" && deps.reconcilePending) {
      try {
        await deps.reconcilePending();
      } catch (error) {
        summary.errors += 1;
        summary.errorReport.push({
          externalId: null,
          message: `reconcilePending: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  const success = !fetchFailed && summary.errors === 0;
  if (deps.mode === "apply" && success) {
    const nextState = buildProductionOrdersIncrementalSuccessState({
      plan: activePlan,
      finishedAt,
      pagesRead: summary.pagesRead,
      recordsReceived: summary.recordsReceived,
    });
    if (deps.writeState) {
      deps.writeState(serializeProductionOrdersIncrementalState(nextState));
      summary.stateAdvanced = true;
      log(
        `${LOG_PREFIX} estado de sucesso avançado strategy=${nextState.strategy} cutoff=${nextState.cutoffUsed} filter=${nextState.filterRsql}`
      );
    }
  } else if (deps.mode === "apply" && !success) {
    log(`${LOG_PREFIX} falha — estado de último sucesso NÃO avançado.`);
  } else if (deps.mode === "preview") {
    log(`${LOG_PREFIX} preview — estado NÃO gravado.`);
  }

  summary.duration = (deps.now ?? Date.now)() - started;
  return summary;
}

export async function runNomusProductionOrdersIncremental(args: {
  prisma?: PrismaClient;
  argv?: string[];
  options?: ProductionOrdersIncrementalCliOptions;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  client?: NomusProductionOrdersClient;
  now?: Date;
  logger?: (message: string) => void;
  fetchPages?: ProductionOrdersIncrementalFetchPages;
  persist?: ProductionOrdersIncrementalPersistFn;
  readState?: () => string | null;
  writeState?: (content: string) => void;
  reconcilePending?: () => Promise<number>;
  /** OP-11: pula lock (testes). Default true se fetchPages injetado. */
  skipLock?: boolean;
  respectGlobalLock?: boolean;
  probeGlobalLock?: () => boolean;
  lockFile?: string;
  persistAudit?: (audit: ProductionOrdersSyncAuditRecord) => Promise<void> | void;
}): Promise<ProductionOrdersIncrementalSummary> {
  const env = args.env ?? process.env;
  const options =
    args.options ?? parseProductionOrdersIncrementalCli(args.argv ?? process.argv.slice(2), env);
  const log = args.logger ?? ((m: string) => console.warn(m));
  const now = args.now ?? new Date();
  const skipLock = args.skipLock ?? args.fetchPages != null;

  const runInner = async (): Promise<ProductionOrdersIncrementalSummary> => {
    const stateRaw =
      args.readState?.() ?? (options.stateFile ? readStateFile(options.stateFile) : null);
    const priorState = parseProductionOrdersIncrementalState(stateRaw);
    const plan = planProductionOrdersIncremental({ options, priorState, now });

    const client =
      args.client ??
      (args.fetchPages
        ? null
        : createNomusProductionOrdersClient({
            baseUrl: args.baseUrl,
            pageSize: plan.pageSize,
            maxPages: plan.maxPages,
            env,
            logger: log,
            fetchJson: async (url, fetchOptions) => fetchNomusJson(url, fetchOptions),
          }));

    const fetchPages: ProductionOrdersIncrementalFetchPages =
      args.fetchPages ??
      (async ({ query, pageSize, maxPages }) => {
        if (!client) throw new Error("Cliente Nomus ausente para incremental.");
        const traversed = await client.traversePages({
          startPage: 1,
          pageSize,
          maxPages,
          query,
        });
        return {
          pagesRead: traversed.pagesRead,
          recordsReceived: traversed.recordsRead,
          items: traversed.items,
        };
      });

    const persist: ProductionOrdersIncrementalPersistFn | undefined =
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
                links: result.links
                  ? {
                      linksCreated: result.links.linksCreated,
                      linksUpdated: result.links.linksUpdated,
                      linksReactivated: result.links.linksReactivated,
                      linksMarkedAbsent: result.links.linksMarkedAbsent,
                    }
                  : null,
                error: result.error,
              };
            }
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
            return {
              outcome,
              externalId: mapped.row.externalId,
              links: {
                linksCreated: existing ? 0 : mapped.row.salesLinks.length,
                linksUpdated: existing ? mapped.row.salesLinks.length : 0,
                linksReactivated: 0,
                linksMarkedAbsent: 0,
              },
              error: null,
            };
          }
        : undefined);

    const writeState =
      args.writeState ??
      (options.mode === "apply" && options.stateFile
        ? (content: string) => {
            writeFileSync(options.stateFile!, content, "utf8");
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

    return runProductionOrdersIncrementalLoop({
      mode: options.mode,
      plan,
      stateFile: options.stateFile,
      fetchPages,
      persist,
      reconcilePending,
      readState: () => stateRaw,
      writeState,
      logger: log,
      now: () => now.getTime(),
    });
  };

  const guarded = await withProductionOrdersSyncGuard(
    {
      type: "incremental",
      mode: options.mode,
      skipLock,
      lockFile: args.lockFile,
      env,
      respectGlobalLock: args.respectGlobalLock,
      probeGlobalLock: args.probeGlobalLock,
      prisma: args.prisma,
      persistAudit: args.persistAudit,
      logger: log,
    },
    runInner,
    (summary, ctx) =>
      auditFromIncrementalSummary({
        mode: options.mode,
        startedAt: ctx.startedAt,
        finishedAt: ctx.finishedAt,
        summary,
        lockFile: ctx.lockFile,
      })
  );

  if (guarded.blocked) {
    const plan = planProductionOrdersIncremental({
      options,
      priorState: null,
      now,
    });
    return {
      mode: options.mode,
      strategy: "incremental",
      plan,
      pagesRead: 0,
      recordsReceived: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      invalid: 0,
      linkedRows: 0,
      linksCreated: 0,
      linksUpdated: 0,
      linksReactivated: 0,
      linksMarkedAbsent: 0,
      errors: 0,
      errorReport: [{ externalId: null, message: guarded.audit.finalMessage }],
      stateAdvanced: false,
      stateFile: options.stateFile,
      filterUsed: null,
      cutoffUsed: plan.cutoffIso,
      duration: guarded.audit.durationMs,
      rateLimitCount: 0,
      lockBlocked: true,
      audit: guarded.audit,
      exitCode: 0,
    };
  }

  const summary = guarded.result!;
  summary.lockBlocked = false;
  summary.audit = guarded.audit;
  summary.exitCode = guarded.exitCode;
  return summary;
}

export type { ProductionOrdersIncrementalState };
