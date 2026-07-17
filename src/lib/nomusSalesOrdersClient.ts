/**
 * Cliente read-only de `/pedidos` Nomus para auditorias e sync.
 * Reutiliza autenticação/retry oficiais (`nomusRestClient`) — sem segundo HTTP client.
 */

import {
  buildNomusUrl,
  fetchNomusJson,
  type FetchNomusJsonOptions,
} from "@/src/lib/nomusRestClient.js";
import { canonicalNomusOrderCodeKey } from "@/src/lib/salesOrderNomusSync.server.js";
import {
  extractPedidoDataEmissao,
  filterPedidosByEmissaoWindow,
  formatNomusPedidoDateBr,
} from "@/src/lib/nomusSalesOrdersSyncWindow.js";

export type JsonObject = Record<string, unknown>;

export type NomusPedidosFetchStopReason =
  | "empty_page"
  | "no_next"
  | "max_pages"
  | "http_error"
  | "invalid_payload"
  | "interrupted"
  | "date_window";

export type NomusPedidosFetchCompleteness = {
  complete: boolean;
  status: "COMPLETE" | "INCONCLUSIVE_FETCH";
  strategy: string;
  periodFrom: string;
  periodTo: string;
  startPage: number;
  lastPageFetched: number;
  pageSize: number;
  totalRead: number;
  stoppedBecauseEmpty: boolean;
  stoppedBecauseNoNext: boolean;
  stoppedBecauseMaxPages: boolean;
  stoppedBecauseDate: boolean;
  http429Count: number;
  retries: number;
  errors: string[];
  stopReason: NomusPedidosFetchStopReason;
};

export type NomusPedidoIdentity = {
  externalSalesOrderId: number | null;
  orderCode: string | null;
  orderCodeKey: string | null;
  issueDateIso: string | null;
  raw: JsonObject;
};

export type FetchNomusPedidosForAuditArgs = {
  baseUrl: string;
  from: Date;
  to: Date;
  /** Deve ser 1 para prova de snapshot completo do período. */
  startPage?: number;
  maxPages?: number;
  pageSize?: number;
  strategyLabel?: string;
  fetchJson?: typeof fetchNomusJson;
  env?: NodeJS.ProcessEnv;
};

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d-]/g, "");
    if (!normalized) return null;
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function pickPedidosArrayFromUnknown(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const candidates = [
    data.pedidos,
    data.data,
    (data.data as Record<string, unknown> | undefined)?.pedidos,
    data.results,
    data.items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function hasNomusPedidosNextPage(
  payload: unknown,
  page: number,
  currentLen: number
): boolean {
  if (!payload || typeof payload !== "object") return currentLen > 0;
  if (Array.isArray(payload)) return currentLen > 0;
  const data = payload as Record<string, unknown>;
  const totalPages = toInt(data.totalPaginas) ?? toInt(data.totalPages) ?? toInt(data.paginas);
  if (totalPages != null) return page < totalPages;
  if (typeof data.hasMore === "boolean") return data.hasMore;
  return currentLen > 0;
}

export function extractNomusPedidoIdentity(pedido: JsonObject): NomusPedidoIdentity {
  const orderCode =
    typeof pedido.codigoPedido === "string" && pedido.codigoPedido.trim()
      ? pedido.codigoPedido.trim()
      : null;
  const issue = extractPedidoDataEmissao(pedido);
  return {
    externalSalesOrderId: toInt(pedido.id),
    orderCode,
    orderCodeKey: canonicalNomusOrderCodeKey(orderCode),
    issueDateIso: issue ? issue.toISOString().slice(0, 10) : null,
    raw: pedido,
  };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)
  );
}

/**
 * Coleta `/pedidos` no período. Completo somente se:
 * - startPage === 1;
 * - parada por página vazia ou metadata sem próxima página;
 * - sem erro HTTP / payload inválido / maxPages.
 */
export async function fetchNomusPedidosForAudit(
  args: FetchNomusPedidosForAuditArgs
): Promise<{ pedidos: NomusPedidoIdentity[]; completeness: NomusPedidosFetchCompleteness }> {
  const env = args.env ?? process.env;
  const fetchJson = args.fetchJson ?? fetchNomusJson;
  const startPage = Math.max(1, args.startPage ?? 1);
  const maxPages = Math.max(1, args.maxPages ?? toInt(env.NOMUS_SALES_ORDERS_AUDIT_MAX_PAGES) ?? 500);
  const pageSize = Math.max(1, args.pageSize ?? toInt(env.NOMUS_PAGE_SIZE) ?? 500);
  const from = startOfUtcDay(args.from);
  const to = endOfUtcDay(args.to);
  const periodFrom = formatNomusPedidoDateBr(from);
  const periodTo = formatNomusPedidoDateBr(to);
  const lastAllowedPage = startPage + maxPages - 1;

  const completeness: NomusPedidosFetchCompleteness = {
    complete: false,
    status: "INCONCLUSIVE_FETCH",
    strategy: args.strategyLabel ?? "period-full-reconciliation",
    periodFrom,
    periodTo,
    startPage,
    lastPageFetched: startPage - 1,
    pageSize,
    totalRead: 0,
    stoppedBecauseEmpty: false,
    stoppedBecauseNoNext: false,
    stoppedBecauseMaxPages: false,
    stoppedBecauseDate: false,
    http429Count: 0,
    retries: 0,
    errors: [],
    stopReason: "interrupted",
  };

  if (startPage !== 1) {
    completeness.errors.push(
      "startPage != 1: snapshot incompleto para classificação de órfãos."
    );
    completeness.stopReason = "interrupted";
    return { pedidos: [], completeness };
  }

  const pedidos: NomusPedidoIdentity[] = [];
  let page = startPage;

  const fetchOpts: FetchNomusJsonOptions = {
    logPrefix: "[nomus-sales-orders-orphan-audit]",
    onRetryableStatus: ({ status }) => {
      completeness.retries += 1;
      if (status === 429) completeness.http429Count += 1;
    },
  };

  try {
    while (true) {
      completeness.lastPageFetched = page;
      const url = buildNomusUrl(args.baseUrl, "pedidos", {
        pagina: String(page),
        tamanhoPagina: String(pageSize),
        dataEmissaoInicial: periodFrom,
        dataEmissaoFinal: periodTo,
        dataVencimentoInicial: "01/01/2023",
        dataVencimentoFinal: "31/12/2030",
      });

      let payload: unknown;
      try {
        payload = await fetchJson(url, fetchOpts);
      } catch (error) {
        completeness.errors.push(error instanceof Error ? error.message : String(error));
        completeness.stopReason = "http_error";
        return { pedidos, completeness };
      }

      const arrRaw = pickPedidosArrayFromUnknown(payload);
      if (
        payload != null &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        arrRaw.length === 0 &&
        !("pedidos" in (payload as object)) &&
        !("data" in (payload as object)) &&
        !("results" in (payload as object)) &&
        !("items" in (payload as object))
      ) {
        // Payload objeto sem lista reconhecível e sem chaves esperadas → inválido.
        const keys = Object.keys(payload as object);
        if (keys.length > 0 && !keys.some((k) => /pedido|data|result|item|page/i.test(k))) {
          completeness.errors.push("Payload Nomus sem lista de pedidos reconhecível.");
          completeness.stopReason = "invalid_payload";
          return { pedidos, completeness };
        }
      }

      const arr = arrRaw.filter(
        (entry): entry is JsonObject => !!entry && typeof entry === "object" && !Array.isArray(entry)
      );

      if (arr.length === 0) {
        completeness.stoppedBecauseEmpty = true;
        completeness.stopReason = "empty_page";
        break;
      }

      const filtered = filterPedidosByEmissaoWindow(arr, from);
      const hasOlder = arr.some((row) => {
        const d = extractPedidoDataEmissao(row);
        return d != null && d.getTime() < from.getTime();
      });
      if (hasOlder) {
        completeness.stoppedBecauseDate = true;
        completeness.stopReason = "date_window";
      }

      for (const row of filtered.kept) {
        const identity = extractNomusPedidoIdentity(row);
        if (identity.issueDateIso) {
          const iso = identity.issueDateIso;
          const toIso = to.toISOString().slice(0, 10);
          const fromIso = from.toISOString().slice(0, 10);
          if (iso < fromIso || iso > toIso) continue;
        }
        pedidos.push(identity);
      }

      if (completeness.stoppedBecauseDate) break;

      if (page >= lastAllowedPage) {
        completeness.stoppedBecauseMaxPages = true;
        completeness.stopReason = "max_pages";
        break;
      }

      if (!hasNomusPedidosNextPage(payload, page, arr.length)) {
        completeness.stoppedBecauseNoNext = true;
        completeness.stopReason = "no_next";
        break;
      }

      page += 1;
    }
  } catch (error) {
    completeness.errors.push(error instanceof Error ? error.message : String(error));
    completeness.stopReason = "interrupted";
    completeness.totalRead = pedidos.length;
    return { pedidos, completeness };
  }

  completeness.totalRead = pedidos.length;
  const complete =
    startPage === 1 &&
    completeness.errors.length === 0 &&
    !completeness.stoppedBecauseMaxPages &&
    (completeness.stoppedBecauseEmpty || completeness.stoppedBecauseNoNext);

  completeness.complete = complete;
  completeness.status = complete ? "COMPLETE" : "INCONCLUSIVE_FETCH";
  return { pedidos, completeness };
}

export type DirectedPedidoLookupResult =
  | { status: "found"; pedido: NomusPedidoIdentity }
  | { status: "not_found" }
  | { status: "inconclusive"; reason: string };

/**
 * Consulta direcionada por código (scan paginado no período).
 * Read-only; não confirma ausência se maxPages for atingido sem encontrar.
 */
export async function lookupNomusPedidoByOrderCode(args: {
  baseUrl: string;
  orderCode: string;
  from: Date;
  to: Date;
  maxPages?: number;
  pageSize?: number;
  fetchJson?: typeof fetchNomusJson;
  env?: NodeJS.ProcessEnv;
}): Promise<DirectedPedidoLookupResult> {
  const targetKey = canonicalNomusOrderCodeKey(args.orderCode);
  if (!targetKey) {
    return { status: "inconclusive", reason: "orderCode inválido" };
  }

  const env = args.env ?? process.env;
  const fetchJson = args.fetchJson ?? fetchNomusJson;
  const maxPages =
    Math.max(1, args.maxPages ?? toInt(env.NOMUS_SALES_ORDERS_TARGET_MAX_PAGES) ?? 100);
  const pageSize = Math.max(1, args.pageSize ?? toInt(env.NOMUS_PAGE_SIZE) ?? 500);
  const from = startOfUtcDay(args.from);
  const to = endOfUtcDay(args.to);
  const periodFrom = formatNomusPedidoDateBr(from);
  const periodTo = formatNomusPedidoDateBr(to);

  try {
    for (let page = 1; page <= maxPages; page += 1) {
      const url = buildNomusUrl(args.baseUrl, "pedidos", {
        pagina: String(page),
        tamanhoPagina: String(pageSize),
        dataEmissaoInicial: periodFrom,
        dataEmissaoFinal: periodTo,
        dataVencimentoInicial: "01/01/2023",
        dataVencimentoFinal: "31/12/2030",
      });
      const payload = await fetchJson(url, {
        logPrefix: "[nomus-sales-orders-orphan-lookup]",
      });
      const arr = pickPedidosArrayFromUnknown(payload).filter(
        (entry): entry is JsonObject =>
          !!entry && typeof entry === "object" && !Array.isArray(entry)
      );

      for (const pedido of arr) {
        const identity = extractNomusPedidoIdentity(pedido);
        if (identity.orderCodeKey === targetKey) {
          return { status: "found", pedido: identity };
        }
        if (
          identity.externalSalesOrderId != null &&
          String(identity.externalSalesOrderId) === args.orderCode.trim()
        ) {
          return { status: "found", pedido: identity };
        }
      }

      if (arr.length === 0 || arr.length < pageSize) {
        return { status: "not_found" };
      }
      if (!hasNomusPedidosNextPage(payload, page, arr.length)) {
        return { status: "not_found" };
      }
    }
    return {
      status: "inconclusive",
      reason: `Limite de páginas atingido (${maxPages}) sem localizar o pedido.`,
    };
  } catch (error) {
    return {
      status: "inconclusive",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
