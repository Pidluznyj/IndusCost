/**
 * Runner operacional: consulta pontual + reconciliação de vínculos OP (OP-10).
 * Reconciliação nunca consulta a API; lookup usa só queries pontuais (maxPages limitado).
 */

import type { PrismaClient } from "@prisma/client";
import {
  createNomusProductionOrdersClient,
  type NomusProductionOrdersClient,
} from "@/src/lib/nomusProductionOrdersClient.js";
import { mapNomusProductionOrderForPersist } from "@/src/lib/nomusProductionOrdersMapper.js";
import { persistNomusProductionOrder } from "@/src/lib/nomusProductionOrdersPersist.server.js";
import {
  reconcilePendingNomusProductionOrderSalesLinks,
} from "@/src/lib/nomusProductionOrdersSalesLinks.server.js";
import {
  emptyProductionOrdersLookupSummary,
  parseProductionOrdersLookupCli,
  planProductionOrdersLookupQueries,
  resolveProductionOrdersLookupOperation,
  type ProductionOrdersLookupCliOptions,
  type ProductionOrdersLookupLinkAudit,
  type ProductionOrdersLookupOrderAudit,
  type ProductionOrdersLookupSummary,
} from "@/src/lib/nomusProductionOrdersLookup.js";
import { fetchNomusJson } from "@/src/lib/nomusRestClient.js";
import { PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER } from "@/src/lib/nomusProductionOrdersPreview.js";

const LOG_PREFIX = "[nomus-production-orders-lookup]";

export type ProductionOrdersLookupFetchPages = (args: {
  query: string;
  pageSize: number;
  maxPages: number;
}) => Promise<{ pagesRead: number; recordsReceived: number; items: unknown[] }>;

export type ProductionOrdersLookupPersistFn = (raw: unknown) => Promise<{
  outcome: "created" | "updated" | "unchanged" | "invalid" | "error";
  externalId: number | null;
  productionOrderId: string | null;
  links: {
    linksCreated: number;
    linksUpdated: number;
    linksReactivated: number;
    linksMarkedAbsent: number;
    salesOrderResolved: number;
    salesOrderItemResolved: number;
  } | null;
  error: string | null;
  reasons?: string[];
}>;

export type ProductionOrdersLookupLocalResolver = {
  /** OPs locais já vinculadas ao pedido/item externo (evita full scan). */
  findOpExternalIdsBySalesFilters: (args: {
    salesOrderExternalIds: number[];
    salesOrderItemExternalIds: number[];
  }) => Promise<number[]>;
  resolveLinkLocals: (args: {
    externalSalesOrderIds: number[];
    externalSalesOrderItemIds: number[];
  }) => Promise<{
    ordersByExternalId: Map<number, string>;
    itemsByExternalId: Map<number, string>;
  }>;
  listPendingLinks: (args: {
    productionOrderExternalIds?: number[];
    salesOrderExternalIds?: number[];
    salesOrderItemExternalIds?: number[];
    limit: number;
  }) => Promise<
    Array<{
      externalSalesOrderId: number;
      externalSalesOrderItemId: number;
      salesOrderId: string | null;
      salesOrderItemId: string | null;
      isCurrent: boolean;
    }>
  >;
};

export type ProductionOrdersLookupDeps = {
  mode: "preview" | "apply";
  options: ProductionOrdersLookupCliOptions;
  fetchPages?: ProductionOrdersLookupFetchPages;
  persist?: ProductionOrdersLookupPersistFn;
  reconcilePending?: () => Promise<{
    scanned: number;
    salesOrderResolved: number;
    salesOrderItemResolved: number;
    updated: number;
  }>;
  local: ProductionOrdersLookupLocalResolver;
  logger?: (message: string) => void;
  now?: () => number;
};

function auditLink(args: {
  externalSalesOrderId: number;
  externalSalesOrderItemId: number;
  localSalesOrderId: string | null;
  localSalesOrderItemId: string | null;
  isCurrent?: boolean;
}): ProductionOrdersLookupLinkAudit {
  const pending = !args.localSalesOrderId || !args.localSalesOrderItemId;
  return {
    externalSalesOrderId: args.externalSalesOrderId,
    externalSalesOrderItemId: args.externalSalesOrderItemId,
    localSalesOrderId: args.localSalesOrderId,
    localSalesOrderItemId: args.localSalesOrderItemId,
    pending,
    isCurrent: args.isCurrent,
  };
}

export async function runProductionOrdersLookupLoop(
  deps: ProductionOrdersLookupDeps
): Promise<ProductionOrdersLookupSummary> {
  const started = (deps.now ?? Date.now)();
  const log = deps.logger ?? ((m: string) => console.warn(m));
  const options = deps.options;
  const operation = resolveProductionOrdersLookupOperation(options);

  if (options.mode === "preview") {
    log(`${LOG_PREFIX} ${PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER}`);
  }

  const summary = emptyProductionOrdersLookupSummary(options, { operation });

  const localOpIds =
    options.salesOrderExternalIds.length > 0 || options.salesOrderItemExternalIds.length > 0
      ? await deps.local.findOpExternalIdsBySalesFilters({
          salesOrderExternalIds: options.salesOrderExternalIds,
          salesOrderItemExternalIds: options.salesOrderItemExternalIds,
        })
      : [];

  const queryPlan = planProductionOrdersLookupQueries(options, localOpIds);
  summary.queries = queryPlan.queries;

  log(
    `${LOG_PREFIX} operation=${operation} mode=${options.mode} queries=${queryPlan.queries.length} apiRequired=${queryPlan.apiRequired} localOpIds=${localOpIds.length}`
  );

  const rawByExternalId = new Map<number, unknown>();
  const unmapped: unknown[] = [];

  if (queryPlan.apiRequired) {
    if (!deps.fetchPages) {
      summary.errors += 1;
      summary.errorReport.push({
        externalId: null,
        message: "fetchPages não configurado para consulta pontual.",
      });
    } else if (queryPlan.queries.length === 0) {
      summary.errors += 1;
      summary.errorReport.push({
        externalId: null,
        message: "Nenhuma query pontual gerada — abortando (não inicia full scan).",
      });
    } else {
      summary.apiCalled = true;
      for (const query of queryPlan.queries) {
        try {
          const fetched = await deps.fetchPages({
            query,
            pageSize: options.pageSize,
            maxPages: options.maxPages,
          });
          summary.pagesRead += fetched.pagesRead;
          summary.recordsReceived += fetched.recordsReceived;
          for (const raw of fetched.items) {
            const mapped = mapNomusProductionOrderForPersist(raw);
            if (mapped.ok) rawByExternalId.set(mapped.row.externalId, raw);
            else unmapped.push(raw);
          }
        } catch (error) {
          summary.errors += 1;
          summary.errorReport.push({
            externalId: null,
            message: `query=${query}: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }
  } else {
    log(`${LOG_PREFIX} reconcile-only — API não consultada.`);
  }

  const allPayloads = [...rawByExternalId.values(), ...unmapped];
  const orderAudits: ProductionOrdersLookupOrderAudit[] = [];
  const allLinkAudits: ProductionOrdersLookupLinkAudit[] = [];

  for (const raw of allPayloads) {
    const mapped = mapNomusProductionOrderForPersist(raw);
    if (!mapped.ok) {
      summary.invalid += 1;
      summary.errors += 1;
      orderAudits.push({
        externalId: mapped.externalId,
        name: null,
        status: null,
        outcome: "invalid",
        productionOrderId: null,
        links: [],
        pendingCount: 0,
        reasons: mapped.reasons,
        error: mapped.reasons.join(",") || "INVALID_PAYLOAD",
      });
      summary.errorReport.push({
        externalId: mapped.externalId,
        message: mapped.reasons.join(",") || "INVALID_PAYLOAD",
      });
      continue;
    }

    const salesOrderExtIds = mapped.row.salesLinks.map((l) => l.externalSalesOrderId);
    const itemExtIds = mapped.row.salesLinks.map((l) => l.externalSalesOrderItemId);
    const locals = await deps.local.resolveLinkLocals({
      externalSalesOrderIds: salesOrderExtIds,
      externalSalesOrderItemIds: itemExtIds,
    });

    const links: ProductionOrdersLookupLinkAudit[] = mapped.row.salesLinks.map((l) =>
      auditLink({
        externalSalesOrderId: l.externalSalesOrderId,
        externalSalesOrderItemId: l.externalSalesOrderItemId,
        localSalesOrderId: locals.ordersByExternalId.get(l.externalSalesOrderId) ?? null,
        localSalesOrderItemId: locals.itemsByExternalId.get(l.externalSalesOrderItemId) ?? null,
        isCurrent: true,
      })
    );
    allLinkAudits.push(...links);
    const pendingCount = links.filter((l) => l.pending).length;

    if (options.mode === "preview" || !deps.persist) {
      orderAudits.push({
        externalId: mapped.row.externalId,
        name: mapped.row.name,
        status: mapped.row.status,
        outcome: "preview",
        productionOrderId: null,
        links,
        pendingCount,
      });
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

      // Após persist, reavalia FKs (podem ter sido preenchidas no sync de links).
      const afterLocals = await deps.local.resolveLinkLocals({
        externalSalesOrderIds: salesOrderExtIds,
        externalSalesOrderItemIds: itemExtIds,
      });
      const afterLinks = mapped.row.salesLinks.map((l) =>
        auditLink({
          externalSalesOrderId: l.externalSalesOrderId,
          externalSalesOrderItemId: l.externalSalesOrderItemId,
          localSalesOrderId: afterLocals.ordersByExternalId.get(l.externalSalesOrderId) ?? null,
          localSalesOrderItemId:
            afterLocals.itemsByExternalId.get(l.externalSalesOrderItemId) ?? null,
          isCurrent: true,
        })
      );

      orderAudits.push({
        externalId: result.externalId ?? mapped.row.externalId,
        name: mapped.row.name,
        status: mapped.row.status,
        outcome: result.outcome === "error" ? "error" : result.outcome,
        productionOrderId: result.productionOrderId,
        links: afterLinks,
        pendingCount: afterLinks.filter((l) => l.pending).length,
        error: result.error,
        reasons: result.reasons,
      });
    } catch (error) {
      summary.errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      summary.errorReport.push({ externalId: mapped.row.externalId, message });
      orderAudits.push({
        externalId: mapped.row.externalId,
        name: mapped.row.name,
        status: mapped.row.status,
        outcome: "error",
        productionOrderId: null,
        links,
        pendingCount,
        error: message,
      });
    }
  }

  // Pendências explícitas (DB), filtradas pelos critérios quando possível.
  const discoveredOpIds = orderAudits
    .map((o) => o.externalId)
    .filter((id): id is number => id != null);
  const pendingScopeOpIds =
    options.externalIds.length > 0
      ? options.externalIds
      : discoveredOpIds.length > 0
        ? discoveredOpIds
        : undefined;

  const pendingFromDb = await deps.local.listPendingLinks({
    productionOrderExternalIds: pendingScopeOpIds,
    salesOrderExternalIds:
      options.salesOrderExternalIds.length > 0 ? options.salesOrderExternalIds : undefined,
    salesOrderItemExternalIds:
      options.salesOrderItemExternalIds.length > 0
        ? options.salesOrderItemExternalIds
        : undefined,
    limit: options.reconcileLimit,
  });

  const pendingAudits = pendingFromDb.map((row) =>
    auditLink({
      externalSalesOrderId: row.externalSalesOrderId,
      externalSalesOrderItemId: row.externalSalesOrderItemId,
      localSalesOrderId: row.salesOrderId,
      localSalesOrderItemId: row.salesOrderItemId,
      isCurrent: row.isCurrent,
    })
  );

  // União: links do payload + pendências DB ainda não listadas.
  const pendingKey = (l: ProductionOrdersLookupLinkAudit) =>
    `${l.externalSalesOrderId}:${l.externalSalesOrderItemId}`;
  const pendingMap = new Map<string, ProductionOrdersLookupLinkAudit>();
  for (const l of [...allLinkAudits.filter((x) => x.pending), ...pendingAudits]) {
    if (l.pending) pendingMap.set(pendingKey(l), l);
  }
  summary.pendingLinks = [...pendingMap.values()];
  summary.orders = orderAudits;

  if (options.reconcileUnresolved) {
    if (options.mode === "preview") {
      log(`${LOG_PREFIX} reconcile preview — sem escrita de FK.`);
      summary.reconcile = {
        scanned: pendingFromDb.length,
        salesOrderResolved: 0,
        salesOrderItemResolved: 0,
        updated: 0,
      };
    } else if (!deps.reconcilePending) {
      summary.errors += 1;
      summary.errorReport.push({
        externalId: null,
        message: "reconcilePending não configurado.",
      });
    } else {
      try {
        summary.reconcile = await deps.reconcilePending();
        log(
          `${LOG_PREFIX} reconcile updated=${summary.reconcile.updated} scanned=${summary.reconcile.scanned}`
        );
      } catch (error) {
        summary.errors += 1;
        summary.errorReport.push({
          externalId: null,
          message: `reconcile: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  summary.durationMs = (deps.now ?? Date.now)() - started;
  return summary;
}

function createPrismaLocalResolver(prisma: PrismaClient): ProductionOrdersLookupLocalResolver {
  return {
    async findOpExternalIdsBySalesFilters(args) {
      const or: Array<Record<string, unknown>> = [];
      if (args.salesOrderExternalIds.length > 0) {
        or.push({ externalSalesOrderId: { in: args.salesOrderExternalIds } });
      }
      if (args.salesOrderItemExternalIds.length > 0) {
        or.push({ externalSalesOrderItemId: { in: args.salesOrderItemExternalIds } });
      }
      if (or.length === 0) return [];
      const rows = await prisma.nomusProductionOrderSalesLink.findMany({
        where: { OR: or },
        select: { productionOrderExternalId: true },
        distinct: ["productionOrderExternalId"],
        take: 200,
      });
      return [...new Set(rows.map((r) => r.productionOrderExternalId))];
    },

    async resolveLinkLocals(args) {
      const ordersByExternalId = new Map<number, string>();
      const itemsByExternalId = new Map<number, string>();

      if (args.externalSalesOrderIds.length > 0) {
        const orders = await prisma.salesOrder.findMany({
          where: { externalSalesOrderId: { in: args.externalSalesOrderIds } },
          select: { id: true, externalSalesOrderId: true },
          orderBy: { updatedAt: "desc" },
        });
        for (const order of orders) {
          if (order.externalSalesOrderId == null) continue;
          if (!ordersByExternalId.has(order.externalSalesOrderId)) {
            ordersByExternalId.set(order.externalSalesOrderId, order.id);
          }
        }
      }

      if (args.externalSalesOrderItemIds.length > 0) {
        const items = await prisma.salesOrderItem.findMany({
          where: { nomusItemExternalId: { in: args.externalSalesOrderItemIds } },
          select: { id: true, nomusItemExternalId: true },
          orderBy: { updatedAt: "desc" },
        });
        for (const item of items) {
          if (item.nomusItemExternalId == null) continue;
          if (!itemsByExternalId.has(item.nomusItemExternalId)) {
            itemsByExternalId.set(item.nomusItemExternalId, item.id);
          }
        }
      }

      return { ordersByExternalId, itemsByExternalId };
    },

    async listPendingLinks(args) {
      const where: Record<string, unknown> = {
        OR: [{ salesOrderId: null }, { salesOrderItemId: null }],
      };
      if (args.productionOrderExternalIds && args.productionOrderExternalIds.length > 0) {
        where.productionOrderExternalId = { in: args.productionOrderExternalIds };
      }
      if (args.salesOrderExternalIds && args.salesOrderExternalIds.length > 0) {
        where.externalSalesOrderId = { in: args.salesOrderExternalIds };
      }
      if (args.salesOrderItemExternalIds && args.salesOrderItemExternalIds.length > 0) {
        where.externalSalesOrderItemId = { in: args.salesOrderItemExternalIds };
      }

      // Sem filtros de escopo + reconcile global: lista pendências limitadas.
      const hasScope =
        (args.productionOrderExternalIds?.length ?? 0) > 0 ||
        (args.salesOrderExternalIds?.length ?? 0) > 0 ||
        (args.salesOrderItemExternalIds?.length ?? 0) > 0;

      return prisma.nomusProductionOrderSalesLink.findMany({
        where: hasScope
          ? where
          : { OR: [{ salesOrderId: null }, { salesOrderItemId: null }] },
        select: {
          externalSalesOrderId: true,
          externalSalesOrderItemId: true,
          salesOrderId: true,
          salesOrderItemId: true,
          isCurrent: true,
        },
        take: args.limit,
        orderBy: { updatedAt: "asc" },
      });
    },
  };
}

export async function runNomusProductionOrdersLookup(args: {
  prisma: PrismaClient;
  argv?: string[];
  options?: ProductionOrdersLookupCliOptions;
  client?: NomusProductionOrdersClient;
  fetchPages?: ProductionOrdersLookupFetchPages;
  persist?: ProductionOrdersLookupPersistFn;
  reconcilePending?: ProductionOrdersLookupDeps["reconcilePending"];
  local?: ProductionOrdersLookupLocalResolver;
  logger?: (message: string) => void;
  now?: () => number;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ProductionOrdersLookupSummary> {
  const options = args.options ?? parseProductionOrdersLookupCli(args.argv ?? []);
  const env = args.env ?? process.env;
  const local = args.local ?? createPrismaLocalResolver(args.prisma);

  const client =
    args.client ??
    createNomusProductionOrdersClient({
      baseUrl: args.baseUrl,
      env,
      pageSize: options.pageSize,
      maxPages: options.maxPages,
      fetchJson: fetchNomusJson,
      logPrefix: LOG_PREFIX,
      logger: args.logger,
    });

  const fetchPages: ProductionOrdersLookupFetchPages | undefined =
    args.fetchPages ??
    (async ({ query, pageSize, maxPages }) => {
      const result = await client.traversePages({ query, pageSize, maxPages, startPage: 1 });
      return {
        pagesRead: result.pagesRead,
        recordsReceived: result.recordsRead,
        items: result.items,
      };
    });

  const persist: ProductionOrdersLookupPersistFn | undefined =
    options.mode === "apply"
      ? args.persist ??
        (async (raw) => {
          const result = await persistNomusProductionOrder(args.prisma, raw);
          return {
            outcome: result.outcome,
            externalId: result.externalId,
            productionOrderId: result.productionOrderId,
            links: result.links,
            error: result.error,
            reasons: result.reasons,
          };
        })
      : undefined;

  // reconcilePending injetável; default usa filtros CLI (escopo pontual).
  const defaultReconcile = async () =>
    reconcilePendingNomusProductionOrderSalesLinks(args.prisma, {
      limit: options.reconcileLimit,
      productionOrderExternalIds:
        options.externalIds.length > 0 ? options.externalIds : undefined,
      externalSalesOrderIds:
        options.salesOrderExternalIds.length > 0 ? options.salesOrderExternalIds : undefined,
      externalSalesOrderItemIds:
        options.salesOrderItemExternalIds.length > 0
          ? options.salesOrderItemExternalIds
          : undefined,
    });

  return runProductionOrdersLookupLoop({
    mode: options.mode,
    options,
    fetchPages,
    persist,
    reconcilePending: args.reconcilePending ?? defaultReconcile,
    local,
    logger: args.logger,
    now: args.now,
  });
}
