/**
 * Lógica pura de CLI / query / paginação / planos de persistência para sync `/rest/ordens`.
 */

import {
  resolveNextSalesOrdersPageCursor,
  type SalesOrdersFetchWindowMeta,
} from "@/src/lib/nomusSalesOrdersPaginationCursor.js";
import type { MappedNomusProductionOrder } from "@/src/lib/nomusProductionOrdersMapper.js";

export type JsonObject = Record<string, unknown>;

export const NOMUS_PRODUCTION_ORDERS_RESOURCE = "ordens";
export const NOMUS_PRODUCTION_ORDERS_DEFAULT_PAGE_SIZE = 50;
export const NOMUS_PRODUCTION_ORDERS_DEFAULT_INCREMENTAL_MAX_PAGES = 20;
export const NOMUS_PRODUCTION_ORDERS_DEFAULT_BACKFILL_MAX_PAGES = 40;

export type ProductionOrdersSyncMode = "preview" | "apply";
export type ProductionOrdersSyncStrategy = "incremental" | "backfill" | "point";

export type ProductionOrdersSyncCliOptions = {
  mode: ProductionOrdersSyncMode;
  strategy: ProductionOrdersSyncStrategy;
  pageSize: number;
  maxPages: number | null;
  startPage: number;
  cursorFile: string | null;
  externalIds: number[];
  names: string[];
  salesOrderExternalIds: number[];
};

export type ProductionOrderPersistPlan = {
  externalId: number;
  action: "create" | "update";
  salesLinkCount: number;
  name: string | null;
  status: string | null;
};

function parsePositiveIntList(raw: string, label: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const n = Number.parseInt(part, 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} inválido: ${part}`);
      return n;
    });
}

export function parseProductionOrdersSyncCli(argv: string[]): ProductionOrdersSyncCliOptions {
  const mode: ProductionOrdersSyncMode =
    argv.includes("apply") || argv.includes("--apply") ? "apply" : "preview";

  let strategy: ProductionOrdersSyncStrategy = "incremental";
  let pageSize = NOMUS_PRODUCTION_ORDERS_DEFAULT_PAGE_SIZE;
  let maxPages: number | null = null;
  let startPage = 1;
  let cursorFile: string | null =
    (process.env.NOMUS_PRODUCTION_ORDERS_PAGE_CURSOR_FILE ?? "").trim() || null;
  const externalIds: number[] = [];
  const names: string[] = [];
  const salesOrderExternalIds: number[] = [];

  for (const arg of argv) {
    if (arg === "preview" || arg === "apply" || arg === "--apply") continue;
    if (arg === "--strategy=incremental" || arg === "incremental") {
      strategy = "incremental";
      continue;
    }
    if (arg === "--strategy=backfill" || arg === "backfill") {
      strategy = "backfill";
      continue;
    }
    if (arg.startsWith("--page-size=")) {
      const parsed = Number.parseInt(arg.slice("--page-size=".length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--page-size inválido: ${arg}`);
      pageSize = parsed;
      continue;
    }
    if (arg.startsWith("--max-pages=")) {
      const parsed = Number.parseInt(arg.slice("--max-pages=".length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--max-pages inválido: ${arg}`);
      maxPages = parsed;
      continue;
    }
    if (arg.startsWith("--start-page=")) {
      const parsed = Number.parseInt(arg.slice("--start-page=".length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--start-page inválido: ${arg}`);
      startPage = parsed;
      continue;
    }
    if (arg.startsWith("--cursor-file=")) {
      cursorFile = arg.slice("--cursor-file=".length).trim() || null;
      continue;
    }
    if (arg.startsWith("--externalId=")) {
      externalIds.push(...parsePositiveIntList(arg.slice("--externalId=".length), "externalId"));
      continue;
    }
    if (arg.startsWith("--name=")) {
      const name = arg.slice("--name=".length).trim();
      if (name) names.push(name);
      continue;
    }
    if (arg.startsWith("--salesOrderExternalId=")) {
      salesOrderExternalIds.push(
        ...parsePositiveIntList(arg.slice("--salesOrderExternalId=".length), "salesOrderExternalId")
      );
      continue;
    }
  }

  if (externalIds.length > 0 || names.length > 0 || salesOrderExternalIds.length > 0) {
    strategy = "point";
  }

  if (maxPages == null) {
    maxPages =
      strategy === "backfill"
        ? NOMUS_PRODUCTION_ORDERS_DEFAULT_BACKFILL_MAX_PAGES
        : strategy === "incremental"
          ? NOMUS_PRODUCTION_ORDERS_DEFAULT_INCREMENTAL_MAX_PAGES
          : 5;
  }

  return {
    mode,
    strategy,
    pageSize,
    maxPages,
    startPage,
    cursorFile: strategy === "backfill" ? cursorFile : null,
    externalIds: [...new Set(externalIds)],
    names: [...new Set(names)],
    salesOrderExternalIds: [...new Set(salesOrderExternalIds)],
  };
}

/** Escape mínimo para valor RSQL entre aspas. */
export function escapeNomusRsqlQuotedValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildProductionOrderPointQueries(options: {
  externalIds: number[];
  names: string[];
  salesOrderExternalIds: number[];
}): string[] {
  const queries: string[] = [];
  for (const id of options.externalIds) {
    queries.push(`id==${id}`);
  }
  for (const name of options.names) {
    queries.push(`nome=="${escapeNomusRsqlQuotedValue(name)}"`);
  }
  for (const idPedido of options.salesOrderExternalIds) {
    // Tentativa oficial por vínculo; se a API não filtrar nested, o fetch pontual pode retornar vazio.
    queries.push(`itensPedido.idPedido==${idPedido}`);
  }
  return queries;
}

export function buildProductionOrdersPageParams(
  page: number,
  pageSize: number,
  query?: string | null
): Record<string, string> {
  const params: Record<string, string> = {
    pagina: String(Math.max(1, Math.trunc(page))),
    tamanhoPagina: String(Math.max(1, Math.trunc(pageSize))),
  };
  if (query?.trim()) params.query = query.trim();
  return params;
}

export function pickProductionOrdersArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const nested = data.data as Record<string, unknown> | undefined;
  const candidates = [
    data.ordens,
    data.ordem,
    data.ordensProducao,
    data.dados,
    data.data,
    data.results,
    data.items,
    data.content,
    nested?.ordens,
    nested?.ordensProducao,
    nested?.dados,
    nested?.items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function shouldStopProductionOrdersPagination(
  pageItemsLength: number,
  pageSize: number
): boolean {
  return pageItemsLength === 0 || pageItemsLength < pageSize;
}

export function hasNextProductionOrdersPage(
  payload: unknown,
  page: number,
  currentLen: number,
  pageSize: number
): boolean {
  if (shouldStopProductionOrdersPagination(currentLen, pageSize)) return false;
  if (!payload || typeof payload !== "object") return currentLen > 0;
  const data = payload as Record<string, unknown>;
  const totalPages =
    Number(data.totalPaginas ?? data.totalPages ?? data.paginas ?? data.total_paginas) || null;
  if (totalPages != null && Number.isFinite(totalPages)) {
    return page < totalPages;
  }
  return currentLen >= pageSize;
}

export function planProductionOrderPersist(
  row: MappedNomusProductionOrder,
  existingExternalIds: ReadonlySet<number>
): ProductionOrderPersistPlan {
  return {
    externalId: row.externalId,
    action: existingExternalIds.has(row.externalId) ? "update" : "create",
    salesLinkCount: row.salesLinks.length,
    name: row.name,
    status: row.status,
  };
}

export function summarizeProductionOrderPersistPlans(plans: ProductionOrderPersistPlan[]): {
  create: number;
  update: number;
  salesLinks: number;
} {
  let create = 0;
  let update = 0;
  let salesLinks = 0;
  for (const plan of plans) {
    if (plan.action === "create") create += 1;
    else update += 1;
    salesLinks += plan.salesLinkCount;
  }
  return { create, update, salesLinks };
}

export function shouldWriteProductionOrders(mode: ProductionOrdersSyncMode): boolean {
  return mode === "apply";
}

export function resolveProductionOrdersNextCursor(meta: SalesOrdersFetchWindowMeta): {
  nextStart: number;
  reason: string;
} {
  return resolveNextSalesOrdersPageCursor(meta);
}

export function isProductionOrdersAfterSalesSyncEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const raw = (env.NOMUS_PRODUCTION_ORDERS_AFTER_SYNC ?? "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}
