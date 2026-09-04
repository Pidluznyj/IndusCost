/**
 * PURCH-MIRROR-01 — Cliente HTTP read-only do Pedido de Compra Nomus.
 *
 * Reutiliza autenticação/retry/timeout oficiais de `nomusRestClient.ts` —
 * nenhum segundo HTTP client, nenhum POST/PUT/PATCH/DELETE.
 *
 * Endpoint: escolhido como `GET {NOMUS_BASE_URL}/rest/pedidoscompra`
 * (list) e `GET {NOMUS_BASE_URL}/rest/pedidoscompra/{id}` (detail) — mesma
 * família REST usada por `/rest/pedidos` (Pedidos de Venda) e demais
 * coletores do repositório. Este caminho NÃO foi validado contra a conta
 * real do Nomus nesta entrega (ver docs/NOMUS_PURCHASE_ORDERS_MIRROR.md,
 * seção "Incertezas") — pode ser sobrescrito via
 * `NOMUS_PURCHASE_ORDERS_LIST_PATH` / `NOMUS_PURCHASE_ORDERS_DETAIL_PATH`
 * sem precisar editar código, caso o probe real confirme um caminho
 * diferente (ex.: `/v1/pedidos-compras`).
 */

import {
  buildNomusUrl,
  fetchNomusJson,
  type FetchNomusJsonOptions,
} from "../nomusRestClient.js";

export type JsonObject = Record<string, unknown>;

const DEFAULT_LIST_PATH = "rest/pedidoscompra";
const DEFAULT_DETAIL_PATH = "rest/pedidoscompra";

export function resolveNomusPurchaseOrdersListPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return (env.NOMUS_PURCHASE_ORDERS_LIST_PATH ?? "").trim() || DEFAULT_LIST_PATH;
}

export function resolveNomusPurchaseOrdersDetailPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  return (
    (env.NOMUS_PURCHASE_ORDERS_DETAIL_PATH ?? "").trim() || DEFAULT_DETAIL_PATH
  );
}

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

/** Localiza o array de pedidos dentro de possíveis envelopes de resposta. */
export function pickPurchaseOrdersArrayFromUnknown(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const nested = data.data as Record<string, unknown> | undefined;
  const candidates = [
    data.pedidosCompra,
    data.pedidos,
    data.data,
    nested?.pedidosCompra,
    nested?.pedidos,
    data.results,
    data.items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

/** true se a paginação (metadata ou heurística de página não-vazia) indica mais páginas. */
export function hasNomusPurchaseOrdersNextPage(
  payload: unknown,
  page: number,
  currentLen: number
): boolean {
  if (!payload || typeof payload !== "object") return currentLen > 0;
  if (Array.isArray(payload)) return currentLen > 0;
  const data = payload as Record<string, unknown>;
  const totalPages =
    toInt(data.totalPaginas) ?? toInt(data.totalPages) ?? toInt(data.paginas);
  if (totalPages != null) return page < totalPages;
  if (typeof data.hasMore === "boolean") return data.hasMore;
  return currentLen > 0;
}

export type FetchNomusPurchaseOrdersPageArgs = {
  baseUrl: string;
  page: number;
  pageSize: number;
  extraQuery?: Record<string, string>;
  fetchJson?: typeof fetchNomusJson;
  env?: NodeJS.ProcessEnv;
  fetchOptions?: FetchNomusJsonOptions;
};

export async function fetchNomusPurchaseOrdersPage(
  args: FetchNomusPurchaseOrdersPageArgs
): Promise<{ raw: unknown; rows: unknown[]; hasNext: boolean }> {
  const fetchJson = args.fetchJson ?? fetchNomusJson;
  const env = args.env ?? process.env;
  const url = buildNomusUrl(args.baseUrl, resolveNomusPurchaseOrdersListPath(env), {
    pagina: String(args.page),
    tamanhoPagina: String(args.pageSize),
    ...(args.extraQuery ?? {}),
  });
  const raw = await fetchJson(url, {
    logPrefix: "[nomus-purchase-orders]",
    logContext: { page: args.page },
    ...args.fetchOptions,
  });
  const rows = pickPurchaseOrdersArrayFromUnknown(raw);
  return { raw, rows, hasNext: hasNomusPurchaseOrdersNextPage(raw, args.page, rows.length) };
}

export type FetchNomusPurchaseOrderDetailArgs = {
  baseUrl: string;
  externalId: number;
  fetchJson?: typeof fetchNomusJson;
  env?: NodeJS.ProcessEnv;
  fetchOptions?: FetchNomusJsonOptions;
};

export async function fetchNomusPurchaseOrderDetail(
  args: FetchNomusPurchaseOrderDetailArgs
): Promise<unknown> {
  const fetchJson = args.fetchJson ?? fetchNomusJson;
  const env = args.env ?? process.env;
  const url = buildNomusUrl(
    args.baseUrl,
    `${resolveNomusPurchaseOrdersDetailPath(env)}/${args.externalId}`
  );
  return fetchJson(url, {
    logPrefix: "[nomus-purchase-orders-detail]",
    logContext: { externalId: args.externalId },
    ...args.fetchOptions,
  });
}

// ---------------------------------------------------------------------------
// Paginação multi-página com proteção contra loop / página repetida
// ---------------------------------------------------------------------------

export type NomusPurchaseOrdersFetchStopReason =
  | "empty_page"
  | "no_next"
  | "max_pages"
  | "repeated_page"
  | "http_error"
  | "invalid_payload";

export type NomusPurchaseOrdersFetchResult = {
  rows: unknown[];
  pagesRead: number;
  stopReason: NomusPurchaseOrdersFetchStopReason;
  http429Count: number;
  errors: string[];
};

export type FetchAllNomusPurchaseOrdersArgs = {
  baseUrl: string;
  startPage?: number;
  maxPages: number;
  pageSize?: number;
  extraQuery?: Record<string, string>;
  fetchJson?: typeof fetchNomusJson;
  env?: NodeJS.ProcessEnv;
};

/**
 * Pagina o endpoint de listagem até esgotar (página vazia / sem próxima) ou
 * atingir `maxPages` (erro explícito — nunca silencioso). Deduplica por
 * fingerprint de página crua para detectar loop de paginação (o Nomus
 * devolvendo a mesma página duas vezes) sem assumir ordenação não
 * comprovada da resposta.
 */
export async function fetchAllNomusPurchaseOrders(
  args: FetchAllNomusPurchaseOrdersArgs
): Promise<NomusPurchaseOrdersFetchResult> {
  const pageSize = args.pageSize ?? 50;
  const startPage = args.startPage ?? 1;
  const rows: unknown[] = [];
  const errors: string[] = [];
  let http429Count = 0;
  const seenPageFingerprints = new Set<string>();
  let page = startPage;
  let pagesRead = 0;
  let stopReason: NomusPurchaseOrdersFetchStopReason = "no_next";

  for (; pagesRead < args.maxPages; pagesRead += 1, page += 1) {
    let result: { raw: unknown; rows: unknown[]; hasNext: boolean };
    try {
      result = await fetchNomusPurchaseOrdersPage({
        baseUrl: args.baseUrl,
        page,
        pageSize,
        extraQuery: args.extraQuery,
        fetchJson: args.fetchJson,
        env: args.env,
        fetchOptions: {
          onRetryableStatus: (info) => {
            if (info.status === 429) http429Count += 1;
          },
        },
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      stopReason = "http_error";
      break;
    }

    if (result.rows.length === 0) {
      stopReason = "empty_page";
      break;
    }

    const fingerprint = JSON.stringify(
      result.rows.map((r) =>
        r && typeof r === "object" ? (r as JsonObject).id ?? (r as JsonObject).codigoPedido : r
      )
    );
    if (seenPageFingerprints.has(fingerprint)) {
      stopReason = "repeated_page";
      break;
    }
    seenPageFingerprints.add(fingerprint);

    rows.push(...result.rows);

    if (!result.hasNext) {
      stopReason = "no_next";
      pagesRead += 1;
      break;
    }
  }

  if (pagesRead >= args.maxPages && stopReason === "no_next" && rows.length > 0) {
    // Loop terminou por exaustão do maxPages sem prova de fim — erro
    // explícito é responsabilidade do chamador (backfill runner), aqui só
    // sinalizamos a razão para o chamador decidir.
    stopReason = "max_pages";
  }

  return { rows, pagesRead, stopReason, http429Count, errors };
}
