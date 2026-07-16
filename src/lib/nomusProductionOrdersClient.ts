/**
 * Cliente de leitura Nomus `GET /rest/ordens` (OP-04).
 * Sem persistência — só HTTP + paginação defensiva.
 * Reutiliza autenticação/retry/timeout/redaction de `nomusRestClient`.
 */

import {
  buildNomusUrl,
  fetchNomusJson,
  redactNomusUrlForLog,
  type FetchNomusJsonOptions,
} from "@/src/lib/nomusRestClient.js";
import {
  buildProductionOrdersPageParams,
  escapeNomusRsqlQuotedValue,
  hasNextProductionOrdersPage,
  NOMUS_PRODUCTION_ORDERS_DEFAULT_PAGE_SIZE,
  NOMUS_PRODUCTION_ORDERS_RESOURCE,
  pickProductionOrdersArray,
} from "@/src/lib/nomusProductionOrdersSyncLogic.js";

export type JsonObject = Record<string, unknown>;

export const NOMUS_PRODUCTION_ORDERS_CLIENT_LOG_PREFIX = "[nomus-production-orders-client]";
/** Teto defensivo absoluto de páginas por travessia (mesmo se o caller pedir mais). */
export const NOMUS_PRODUCTION_ORDERS_CLIENT_HARD_MAX_PAGES = 500;
export const NOMUS_PRODUCTION_ORDERS_CLIENT_DEFAULT_TIMEOUT_MS = 60_000;

export type NomusProductionOrdersClientCode =
  | "UNEXPECTED_PAYLOAD_SHAPE"
  | "REPEATED_PAGE"
  | "REPEATED_IDS"
  | "MAX_PAGES"
  | "HTTP_ERROR"
  | "MISSING_BASE_URL"
  | "INVALID_ARGUMENT";

export class NomusProductionOrdersClientError extends Error {
  readonly code: NomusProductionOrdersClientCode;
  readonly status: number | null;

  constructor(
    code: NomusProductionOrdersClientCode,
    message: string,
    options?: { status?: number | null; cause?: unknown }
  ) {
    super(message, options?.cause != null ? { cause: options.cause } : undefined);
    this.name = "NomusProductionOrdersClientError";
    this.code = code;
    this.status = options?.status ?? null;
  }
}

export type NomusProductionOrdersFetchJson = (
  url: URL,
  options?: FetchNomusJsonOptions
) => Promise<unknown>;

export type NomusProductionOrdersClientConfig = {
  baseUrl?: string;
  pageSize?: number;
  /** Limite de páginas por travessia (capado pelo hard max). */
  maxPages?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  timeoutMs?: number;
  logPrefix?: string;
  fetchJson?: NomusProductionOrdersFetchJson;
  sleepFn?: (ms: number) => Promise<void>;
  logger?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
};

export type ProductionOrdersPageResult = {
  page: number;
  pageSize: number;
  query: string | null;
  items: JsonObject[];
  rawPayload: unknown;
  hasNext: boolean;
  urlForLog: string;
};

export type ProductionOrdersTraverseStopReason =
  | "empty_page"
  | "no_next"
  | "max_pages"
  | "repeated_page"
  | "repeated_ids"
  | "completed";

export type ProductionOrdersTraverseResult = {
  pagesRead: number;
  recordsRead: number;
  items: JsonObject[];
  queries: Array<string | null>;
  stoppedReason: ProductionOrdersTraverseStopReason;
  lastPage: number | null;
};

function resolveBaseUrl(config: NomusProductionOrdersClientConfig): string {
  const env = config.env ?? process.env;
  const raw = (config.baseUrl ?? env.NOMUS_BASE_URL ?? "").trim();
  if (!raw) {
    throw new NomusProductionOrdersClientError(
      "MISSING_BASE_URL",
      "NOMUS_BASE_URL ausente para cliente de Ordens de Produção."
    );
  }
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function resolveTimeoutMs(config: NomusProductionOrdersClientConfig): number {
  if (config.timeoutMs != null && Number.isFinite(config.timeoutMs)) {
    return Math.max(0, Math.trunc(config.timeoutMs));
  }
  const env = config.env ?? process.env;
  const fromEnv = Number.parseInt((env.NOMUS_HTTP_TIMEOUT_MS ?? "").trim(), 10);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv;
  return NOMUS_PRODUCTION_ORDERS_CLIENT_DEFAULT_TIMEOUT_MS;
}

function resolveMaxPages(config: NomusProductionOrdersClientConfig): number {
  const requested =
    config.maxPages != null && Number.isFinite(config.maxPages) && config.maxPages > 0
      ? Math.trunc(config.maxPages)
      : NOMUS_PRODUCTION_ORDERS_CLIENT_HARD_MAX_PAGES;
  return Math.min(requested, NOMUS_PRODUCTION_ORDERS_CLIENT_HARD_MAX_PAGES);
}

function asJsonObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function pickExternalId(item: JsonObject): number | null {
  const candidates = [item.id, item.idOrdem, item.idOrdemProducao];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return Math.trunc(candidate);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const n = Number.parseInt(candidate.trim(), 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

/** Fingerprint estável da página (IDs ordenados) para detectar laço de paginação. */
export function fingerprintProductionOrdersPage(items: JsonObject[]): string {
  const ids = items
    .map((item) => pickExternalId(item))
    .filter((id): id is number => id != null)
    .sort((a, b) => a - b);
  if (ids.length > 0) return `ids:${ids.join(",")}`;
  // Sem IDs: fingerprint pelo tamanho + hash simples de chaves top-level.
  return `raw:${items.length}:${items
    .map((item) => Object.keys(item).sort().join("|"))
    .join(";")}`;
}

/**
 * Valida formato mínimo: array ou objeto envelope.
 * String/number/null → erro controlado (não quebra silenciosamente).
 */
export function assertProductionOrdersPayloadShape(payload: unknown): void {
  if (Array.isArray(payload)) return;
  if (payload && typeof payload === "object") return;
  throw new NomusProductionOrdersClientError(
    "UNEXPECTED_PAYLOAD_SHAPE",
    `Resposta /rest/ordens fora do formato esperado (tipo=${payload === null ? "null" : typeof payload}).`
  );
}

export function buildProductionOrderNameQuery(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new NomusProductionOrdersClientError(
      "INVALID_ARGUMENT",
      "Nome da OP vazio para consulta RSQL."
    );
  }
  return `nome=="${escapeNomusRsqlQuotedValue(trimmed)}"`;
}

function toPageItems(payload: unknown): JsonObject[] {
  assertProductionOrdersPayloadShape(payload);
  return pickProductionOrdersArray(payload)
    .map(asJsonObject)
    .filter((item): item is JsonObject => item != null);
}

function wrapHttpError(error: unknown): never {
  if (error instanceof NomusProductionOrdersClientError) throw error;
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = message.match(/Falha HTTP (\d+)/);
  const status = statusMatch ? Number.parseInt(statusMatch[1]!, 10) : null;
  throw new NomusProductionOrdersClientError("HTTP_ERROR", message, {
    status: Number.isFinite(status) ? status : null,
    cause: error,
  });
}

export class NomusProductionOrdersClient {
  private readonly baseUrl: string;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly maxRetries: number | undefined;
  private readonly retryBaseMs: number | undefined;
  private readonly timeoutMs: number;
  private readonly logPrefix: string;
  private readonly fetchJson: NomusProductionOrdersFetchJson;
  private readonly sleepFn: ((ms: number) => Promise<void>) | undefined;
  private readonly logger: (message: string) => void;

  constructor(config: NomusProductionOrdersClientConfig = {}) {
    this.baseUrl = resolveBaseUrl(config);
    this.pageSize = Math.max(
      1,
      Math.trunc(config.pageSize ?? NOMUS_PRODUCTION_ORDERS_DEFAULT_PAGE_SIZE)
    );
    this.maxPages = resolveMaxPages(config);
    this.maxRetries = config.maxRetries;
    this.retryBaseMs = config.retryBaseMs;
    this.timeoutMs = resolveTimeoutMs(config);
    this.logPrefix = config.logPrefix ?? NOMUS_PRODUCTION_ORDERS_CLIENT_LOG_PREFIX;
    this.fetchJson = config.fetchJson ?? fetchNomusJson;
    this.sleepFn = config.sleepFn;
    this.logger = config.logger ?? ((message) => console.warn(message));
  }

  private httpOptions(): FetchNomusJsonOptions {
    return {
      maxRetries: this.maxRetries,
      retryBaseMs: this.retryBaseMs,
      timeoutMs: this.timeoutMs,
      logPrefix: this.logPrefix,
      sleepFn: this.sleepFn,
    };
  }

  /** Lista uma única página (`pagina` + `tamanhoPagina` + RSQL opcional). */
  async listPage(args: {
    page?: number;
    pageSize?: number;
    query?: string | null;
  } = {}): Promise<ProductionOrdersPageResult> {
    const page = Math.max(1, Math.trunc(args.page ?? 1));
    const pageSize = Math.max(1, Math.trunc(args.pageSize ?? this.pageSize));
    const query = args.query?.trim() ? args.query.trim() : null;
    const url = buildNomusUrl(
      this.baseUrl,
      NOMUS_PRODUCTION_ORDERS_RESOURCE,
      buildProductionOrdersPageParams(page, pageSize, query)
    );
    const urlForLog = redactNomusUrlForLog(url);
    this.logger(`${this.logPrefix} GET ${urlForLog}`);

    let rawPayload: unknown;
    try {
      rawPayload = await this.fetchJson(url, this.httpOptions());
    } catch (error) {
      wrapHttpError(error);
    }

    const items = toPageItems(rawPayload);
    const hasNext = hasNextProductionOrdersPage(rawPayload, page, items.length, pageSize);
    this.logger(
      `${this.logPrefix} página ${page}: ${items.length} registro(s)${query ? ` query=${query}` : ""}`
    );

    return {
      page,
      pageSize,
      query,
      items,
      rawPayload,
      hasNext,
      urlForLog,
    };
  }

  /**
   * Percorre múltiplas páginas até página vazia / fim / limite / laço detectado.
   * Não persiste — só agrega itens brutos.
   */
  async traversePages(args: {
    startPage?: number;
    pageSize?: number;
    query?: string | null;
    maxPages?: number;
  } = {}): Promise<ProductionOrdersTraverseResult> {
    const startPage = Math.max(1, Math.trunc(args.startPage ?? 1));
    const pageSize = Math.max(1, Math.trunc(args.pageSize ?? this.pageSize));
    const query = args.query?.trim() ? args.query.trim() : null;
    const maxPages = Math.min(
      resolveMaxPages({ maxPages: args.maxPages ?? this.maxPages }),
      this.maxPages
    );

    const items: JsonObject[] = [];
    const seenIds = new Set<number>();
    let pagesRead = 0;
    let recordsRead = 0;
    let lastPage: number | null = null;
    let previousFingerprint: string | null = null;
    let stoppedReason: ProductionOrdersTraverseStopReason = "completed";

    for (let offset = 0; offset < maxPages; offset += 1) {
      const page = startPage + offset;
      const pageResult = await this.listPage({ page, pageSize, query });
      pagesRead += 1;
      lastPage = page;
      recordsRead += pageResult.items.length;

      if (pageResult.items.length === 0) {
        stoppedReason = "empty_page";
        break;
      }

      const fingerprint = fingerprintProductionOrdersPage(pageResult.items);
      if (previousFingerprint != null && fingerprint === previousFingerprint) {
        throw new NomusProductionOrdersClientError(
          "REPEATED_PAGE",
          `Página repetida detectada em pagina=${page} (fingerprint idêntico à anterior).`
        );
      }
      previousFingerprint = fingerprint;

      for (const item of pageResult.items) {
        const id = pickExternalId(item);
        if (id != null && seenIds.has(id)) {
          throw new NomusProductionOrdersClientError(
            "REPEATED_IDS",
            `ID externo repetido entre páginas: ${id} (pagina=${page}).`
          );
        }
        if (id != null) seenIds.add(id);
        items.push(item);
      }

      if (!pageResult.hasNext) {
        stoppedReason = "no_next";
        break;
      }

      if (offset + 1 >= maxPages) {
        stoppedReason = "max_pages";
        break;
      }
    }

    if (pagesRead >= maxPages && stoppedReason === "completed") {
      stoppedReason = "max_pages";
    }

    return {
      pagesRead,
      recordsRead,
      items,
      queries: [query],
      stoppedReason,
      lastPage,
    };
  }

  /** Consulta por nome oficial (`nome=="..."`) com paginação. */
  async fetchByName(
    name: string,
    args: { pageSize?: number; maxPages?: number; startPage?: number } = {}
  ): Promise<ProductionOrdersTraverseResult> {
    return this.traversePages({
      ...args,
      query: buildProductionOrderNameQuery(name),
    });
  }

  /**
   * Leitura incremental: sem RSQL, a partir de `startPage`, com limite defensivo de páginas.
   */
  async fetchIncremental(
    args: { startPage?: number; pageSize?: number; maxPages?: number } = {}
  ): Promise<ProductionOrdersTraverseResult> {
    return this.traversePages({
      startPage: args.startPage ?? 1,
      pageSize: args.pageSize,
      maxPages: args.maxPages,
      query: null,
    });
  }
}

/** Factory conveniente (mesma config do sync). */
export function createNomusProductionOrdersClient(
  config: NomusProductionOrdersClientConfig = {}
): NomusProductionOrdersClient {
  return new NomusProductionOrdersClient(config);
}
