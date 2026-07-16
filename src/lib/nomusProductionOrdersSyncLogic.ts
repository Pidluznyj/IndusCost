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
  /** ISO YYYY-MM-DD — filtro RSQL por data (opcional). */
  from: string | null;
  /** ISO YYYY-MM-DD — filtro RSQL por data (opcional). */
  to: string | null;
  /** Campo Nomus usado no intervalo (default dataAlteracao). */
  dateField: "dataAlteracao" | "dataAbertura";
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

function parseIsoDateArg(raw: string, label: string): string {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`${label} inválida: "${raw}". Use YYYY-MM-DD.`);
  }
  const [y, m, d] = trimmed.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(y!, m! - 1, d!);
  if (date.getFullYear() !== y || date.getMonth() !== m! - 1 || date.getDate() !== d) {
    throw new Error(`${label} inválida: "${raw}".`);
  }
  return trimmed;
}

/** YYYY-MM-DD → dd/MM/yyyy (filtro RSQL Nomus). */
export function isoDateToNomusBrDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
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
  let from: string | null = null;
  let to: string | null = null;
  let dateField: "dataAlteracao" | "dataAbertura" = "dataAlteracao";

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
    if (arg.startsWith("--from=")) {
      from = parseIsoDateArg(arg.slice("--from=".length), "--from");
      continue;
    }
    if (arg.startsWith("--to=")) {
      to = parseIsoDateArg(arg.slice("--to=".length), "--to");
      continue;
    }
    if (arg.startsWith("--date-field=")) {
      const raw = arg.slice("--date-field=".length).trim();
      if (raw !== "dataAlteracao" && raw !== "dataAbertura") {
        throw new Error(`--date-field inválido: ${raw}. Use dataAlteracao|dataAbertura.`);
      }
      dateField = raw;
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

  if ((from && !to) || (!from && to)) {
    throw new Error("Informe --from=YYYY-MM-DD e --to=YYYY-MM-DD juntos (intervalo completo).");
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
    from,
    to,
    dateField,
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

/** Intervalo de datas RSQL (dd/MM/yyyy). Combinável com filtros pontuais via `;`. */
export function buildProductionOrdersDateRangeRsql(options: {
  from: string;
  to: string;
  dateField?: "dataAlteracao" | "dataAbertura";
}): string {
  const field = options.dateField ?? "dataAlteracao";
  return `${field}>=${isoDateToNomusBrDate(options.from)};${field}<=${isoDateToNomusBrDate(options.to)}`;
}

/**
 * Monta queries efetivas do sync/preview:
 * - point: id / nome / idPedido (+ intervalo se informado)
 * - incremental/backfill: null ou só intervalo
 */
export function buildProductionOrdersSyncQueries(
  options: Pick<
    ProductionOrdersSyncCliOptions,
    | "strategy"
    | "externalIds"
    | "names"
    | "salesOrderExternalIds"
    | "from"
    | "to"
    | "dateField"
  >
): Array<string | null> {
  const dateRsql =
    options.from && options.to
      ? buildProductionOrdersDateRangeRsql({
          from: options.from,
          to: options.to,
          dateField: options.dateField,
        })
      : null;

  if (options.strategy === "point") {
    const point = buildProductionOrderPointQueries(options);
    if (point.length === 0) return dateRsql ? [dateRsql] : [];
    if (!dateRsql) return point;
    return point.map((q) => `${q};${dateRsql}`);
  }

  return [dateRsql];
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
