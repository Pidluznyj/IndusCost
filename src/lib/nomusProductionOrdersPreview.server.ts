/**
 * Runner do preview de sync `/rest/ordens` (OP-07).
 * Consulta API + leitura local para planejar efeitos — **nunca grava**.
 */

import type { PrismaClient } from "@prisma/client";
import {
  createNomusProductionOrdersClient,
  type NomusProductionOrdersClient,
} from "@/src/lib/nomusProductionOrdersClient.js";
import { mapNomusProductionOrderForPersist } from "@/src/lib/nomusProductionOrdersMapper.js";
import {
  buildProductionOrdersPreviewFilters,
  buildProductionOrdersPreviewSummary,
  planProductionOrderLinksPreview,
  planProductionOrderPreview,
  PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER,
  type ExistingProductionOrderLinkSnapshot,
  type ExistingProductionOrderSnapshot,
  type ProductionOrderPreviewPlan,
  type ProductionOrdersPreviewSummary,
} from "@/src/lib/nomusProductionOrdersPreview.js";
import {
  buildProductionOrdersSyncQueries,
  parseProductionOrdersSyncCli,
  type ProductionOrdersSyncCliOptions,
} from "@/src/lib/nomusProductionOrdersSyncLogic.js";
import { fetchNomusJson } from "@/src/lib/nomusRestClient.js";

export type ProductionOrdersPreviewReadModel = {
  findExistingOrders: (
    externalIds: number[]
  ) => Promise<ExistingProductionOrderSnapshot[]>;
  findExistingCurrentLinks: (
    productionOrderExternalIds: number[]
  ) => Promise<ExistingProductionOrderLinkSnapshot[]>;
  findLocalSalesOrderExternalIds: (externalIds: number[]) => Promise<Set<number>>;
  findLocalSalesOrderItemExternalIds: (itemIds: number[]) => Promise<Set<number>>;
};

export type RunNomusProductionOrdersPreviewDeps = {
  readModel: ProductionOrdersPreviewReadModel;
  client?: NomusProductionOrdersClient;
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  logger?: (message: string) => void;
  now?: () => number;
};

function createPrismaReadModel(prisma: PrismaClient): ProductionOrdersPreviewReadModel {
  return {
    async findExistingOrders(externalIds) {
      if (externalIds.length === 0) return [];
      return prisma.nomusProductionOrder.findMany({
        where: { externalId: { in: externalIds } },
        select: { externalId: true, payloadHash: true },
      });
    },
    async findExistingCurrentLinks(productionOrderExternalIds) {
      if (productionOrderExternalIds.length === 0) return [];
      return prisma.nomusProductionOrderSalesLink.findMany({
        where: {
          productionOrderExternalId: { in: productionOrderExternalIds },
          isCurrent: true,
        },
        select: {
          productionOrderExternalId: true,
          externalSalesOrderItemId: true,
          isCurrent: true,
        },
      });
    },
    async findLocalSalesOrderExternalIds(externalIds) {
      if (externalIds.length === 0) return new Set();
      const rows = await prisma.salesOrder.findMany({
        where: { externalSalesOrderId: { in: externalIds } },
        select: { externalSalesOrderId: true },
      });
      return new Set(
        rows
          .map((r) => r.externalSalesOrderId)
          .filter((id): id is number => id != null)
      );
    },
    async findLocalSalesOrderItemExternalIds(itemIds) {
      if (itemIds.length === 0) return new Set();
      const rows = await prisma.salesOrderItem.findMany({
        where: { nomusItemExternalId: { in: itemIds } },
        select: { nomusItemExternalId: true },
      });
      return new Set(
        rows
          .map((r) => r.nomusItemExternalId)
          .filter((id): id is number => id != null)
      );
    },
  };
}

/**
 * Prisma read-only proxy: qualquer escrita lança.
 * Usado no preview e nos testes de garantia DRY RUN.
 */
export function createProductionOrdersPreviewReadOnlyPrisma(
  prisma: PrismaClient
): PrismaClient {
  const forbidden = (method: string) => () => {
    throw new Error(
      `Preview DRY RUN: operação proibida (${method}). Nenhuma gravação é permitida.`
    );
  };

  return new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return forbidden("$transaction");
      }
      if (prop === "$executeRaw" || prop === "$executeRawUnsafe") {
        return forbidden(String(prop));
      }
      const value = Reflect.get(target, prop, receiver);
      if (prop === "nomusProductionOrder" || prop === "nomusProductionOrderSalesLink") {
        return new Proxy(value as object, {
          get(model, method, modelReceiver) {
            const name = String(method);
            if (
              name.startsWith("create") ||
              name.startsWith("update") ||
              name.startsWith("upsert") ||
              name.startsWith("delete") ||
              name === "createMany" ||
              name === "updateMany" ||
              name === "deleteMany"
            ) {
              return forbidden(`nomus.${name}`);
            }
            return Reflect.get(model, method, modelReceiver);
          },
        });
      }
      // SyncState / cursores / demais modelos de negócio: bloquear writes genéricos.
      if (
        typeof prop === "string" &&
        value &&
        typeof value === "object" &&
        ("create" in (value as object) || "update" in (value as object))
      ) {
        return new Proxy(value as object, {
          get(model, method, modelReceiver) {
            const name = String(method);
            if (
              name.startsWith("create") ||
              name.startsWith("update") ||
              name.startsWith("upsert") ||
              name.startsWith("delete") ||
              name === "createMany" ||
              name === "updateMany" ||
              name === "deleteMany"
            ) {
              return forbidden(`${String(prop)}.${name}`);
            }
            return Reflect.get(model, method, modelReceiver);
          },
        });
      }
      return value;
    },
  }) as PrismaClient;
}

export async function runNomusProductionOrdersPreview(args: {
  argv?: string[];
  options?: ProductionOrdersSyncCliOptions;
  prisma?: PrismaClient;
  deps: RunNomusProductionOrdersPreviewDeps;
}): Promise<ProductionOrdersPreviewSummary> {
  const started = (args.deps.now ?? Date.now)();
  const log = args.deps.logger ?? ((message: string) => console.warn(message));
  const options =
    args.options ??
    parseProductionOrdersSyncCli([
      "preview",
      ...(args.argv ?? []).filter((a) => a !== "apply" && a !== "--apply"),
    ]);

  // Força preview independentemente do argv.
  const previewOptions: ProductionOrdersSyncCliOptions = { ...options, mode: "preview" };
  const queries = buildProductionOrdersSyncQueries(previewOptions);
  if (previewOptions.strategy === "point" && queries.length === 0) {
    throw new Error(
      "Preview pontual exige --externalId, --name, --salesOrderExternalId e/ou --from/--to."
    );
  }

  log(`[nomus-production-orders-preview] ${PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER}`);
  log(
    `[nomus-production-orders-preview] strategy=${previewOptions.strategy} startPage=${previewOptions.startPage} maxPages=${previewOptions.maxPages} pageSize=${previewOptions.pageSize}`
  );

  let rateLimitCount = 0;
  const client =
    args.deps.client ??
    createNomusProductionOrdersClient({
      baseUrl: args.deps.baseUrl,
      pageSize: previewOptions.pageSize,
      maxPages: previewOptions.maxPages ?? undefined,
      env: args.deps.env,
      logger: log,
      fetchJson: async (url, fetchOptions) =>
        fetchNomusJson(url, {
          ...fetchOptions,
          onRetryableStatus: (info) => {
            if (info.status === 429) rateLimitCount += 1;
            fetchOptions?.onRetryableStatus?.(info);
          },
        }),
    });

  const readModel =
    args.deps.readModel ??
    (args.prisma
      ? createPrismaReadModel(createProductionOrdersPreviewReadOnlyPrisma(args.prisma))
      : null);
  if (!readModel) {
    throw new Error("Preview exige readModel ou prisma.");
  }

  let pagesRead = 0;
  let recordsReceived = 0;
  let errors = 0;
  const rawItems: unknown[] = [];
  const effectiveQueries = queries.length > 0 ? queries : [null];

  for (const query of effectiveQueries) {
    try {
      const traversed = await client.traversePages({
        startPage: previewOptions.startPage,
        pageSize: previewOptions.pageSize,
        maxPages: previewOptions.maxPages ?? undefined,
        query,
      });
      pagesRead += traversed.pagesRead;
      recordsReceived += traversed.recordsRead;
      rawItems.push(...traversed.items);
    } catch (error) {
      errors += 1;
      log(
        `[nomus-production-orders-preview] erro ao consultar query=${query ?? "(none)"}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  // Dedupe por id bruto quando possível.
  const byExternalId = new Map<number, unknown>();
  const withoutId: unknown[] = [];
  for (const item of rawItems) {
    const mappedProbe = mapNomusProductionOrderForPersist(item);
    if (mappedProbe.ok) byExternalId.set(mappedProbe.row.externalId, item);
    else withoutId.push(item);
  }
  const uniquePayloads = [...byExternalId.values(), ...withoutId];

  const mappedRows = uniquePayloads.map((raw) => mapNomusProductionOrderForPersist(raw));
  const validRows = mappedRows.filter((m) => m.ok).map((m) => (m.ok ? m.row : null!));
  const externalIds = validRows.map((r) => r.externalId);

  const existingOrders = await readModel.findExistingOrders(externalIds);
  const existingById = new Map(existingOrders.map((o) => [o.externalId, o]));
  const existingLinks = await readModel.findExistingCurrentLinks(externalIds);
  const linksByOp = new Map<number, number[]>();
  for (const link of existingLinks) {
    const list = linksByOp.get(link.productionOrderExternalId) ?? [];
    list.push(link.externalSalesOrderItemId);
    linksByOp.set(link.productionOrderExternalId, list);
  }

  const allSalesOrderIds = [
    ...new Set(validRows.flatMap((r) => r.salesLinks.map((l) => l.externalSalesOrderId))),
  ];
  const allItemIds = [
    ...new Set(validRows.flatMap((r) => r.salesLinks.map((l) => l.externalSalesOrderItemId))),
  ];
  const localOrders = await readModel.findLocalSalesOrderExternalIds(allSalesOrderIds);
  const localItems = await readModel.findLocalSalesOrderItemExternalIds(allItemIds);

  const plans: ProductionOrderPreviewPlan[] = [];
  for (const mapped of mappedRows) {
    if (!mapped.ok) {
      plans.push(
        planProductionOrderPreview({
          row: null,
          existing: null,
          mapReasons: mapped.reasons,
          links: planProductionOrderLinksPreview({
            incomingItemIds: [],
            existingCurrentItemIds: [],
            resolvedFullyCount: 0,
            unresolvedCount: 0,
          }),
        })
      );
      continue;
    }

    let resolvedFully = 0;
    let unresolved = 0;
    for (const link of mapped.row.salesLinks) {
      const hasOrder = localOrders.has(link.externalSalesOrderId);
      const hasItem = localItems.has(link.externalSalesOrderItemId);
      if (hasOrder && hasItem) resolvedFully += 1;
      else unresolved += 1;
    }

    plans.push(
      planProductionOrderPreview({
        row: mapped.row,
        existing: existingById.get(mapped.row.externalId) ?? null,
        links: planProductionOrderLinksPreview({
          incomingItemIds: mapped.row.salesLinks.map((l) => l.externalSalesOrderItemId),
          existingCurrentItemIds: linksByOp.get(mapped.row.externalId) ?? [],
          resolvedFullyCount: resolvedFully,
          unresolvedCount: unresolved,
        }),
      })
    );
  }

  const summary = buildProductionOrdersPreviewSummary({
    pagesRead,
    recordsReceived,
    plans,
    rateLimitCount,
    errors,
    durationMs: (args.deps.now ?? Date.now)() - started,
    filters: buildProductionOrdersPreviewFilters(previewOptions, effectiveQueries),
  });

  log(`[nomus-production-orders-preview] ${summary.dryRunBanner}`);
  return summary;
}

export async function runNomusProductionOrdersPreviewWithPrisma(args: {
  prisma: PrismaClient;
  argv?: string[];
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ProductionOrdersPreviewSummary> {
  const readOnly = createProductionOrdersPreviewReadOnlyPrisma(args.prisma);
  return runNomusProductionOrdersPreview({
    prisma: readOnly,
    argv: args.argv,
    deps: {
      baseUrl: args.baseUrl,
      env: args.env,
      readModel: createPrismaReadModel(readOnly),
    },
  });
}
