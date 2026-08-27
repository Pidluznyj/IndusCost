import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import { normalizeTaxId, parseNomusPtBrNumber } from "./nomusNumberParser.ts";
import { upsertSalesOrderNfeLinksForOrder } from "../src/lib/salesOrderNfeLink.ts";
import {
  buildNomusSyncItemWritePlan,
  buildNomusSyncUpdatePreview,
  extractNomusLineExternalId,
  canonicalNomusOrderCodeKey,
  expandNomusOrderCodeLookupVariants,
  findExistingSalesOrderForNomusSync,
  indexExistingSalesOrdersByNomusKey,
  mergeNomusSyncHeaderPreservingHistoricalCosts,
  normalizeNomusOrderCodeForStorage,
  NOMUS_SALES_ORDER_SOURCE,
  type NomusSyncExistingSalesOrder,
  type NomusSyncItemWriteRow,
  type NomusSyncUpdatePreview,
} from "../src/lib/salesOrderNomusSync.server.ts";
import { parseNomusSalesOrderItemStatus } from "../src/lib/sales/nomusSalesOrderItemStatus.ts";
import { buildNomusSyncMaterializationTrigger } from "../src/lib/commissions/commissionMaterializationAfterNomusSync.ts";
import { runCommissionMaterializationAfterNomusSync } from "../src/lib/commissions/commissionMaterializationAfterNomusSync.server.ts";
import { autoAssignCommercialOwnersAfterNomusSync } from "../src/lib/commercial/crmCommercialOwnerAutoAssign.ts";
import {
  formatProductionOrdersAfterSalesOrdersLogLine,
  runNomusProductionOrdersAfterSalesOrdersSync,
} from "../src/lib/nomusProductionOrdersAfterSalesOrders.server.ts";
import {
  formatStockDocumentsAfterSalesOrdersLogLine,
  runNomusStockDocumentsAfterSalesOrdersSync,
} from "../src/lib/nomusStockDocumentsAfterSalesOrders.server.ts";
import {
  buildSalesOrderFlowRecomputeAfterSyncTrigger,
  runSalesOrderFlowRecomputeAfterNomusSync,
} from "../src/lib/sales/salesOrderFlowRecomputeAfterNomusSync.server.ts";
import {
  formatSalesOrderResultChartsCacheAfterSyncLog,
  refreshSalesOrderResultChartsCacheAfterNomusSync,
} from "../src/lib/sales/salesOrderResultChartsCache.server.ts";
import { extractNomusSellerFromPedido } from "../src/lib/salesOrderNomusSeller.ts";
import {
  formatSalesOrdersPaginationNote,
  readSalesOrdersPageCursor,
  resolveNextSalesOrdersPageCursor,
  type SalesOrdersFetchWindowMeta,
  type SalesOrdersPaginationWindow,
} from "../src/lib/nomusSalesOrdersPaginationCursor.ts";
import {
  describeNomusSalesOrdersSyncMode,
  extractPedidoDataEmissao,
  filterPedidosByEmissaoWindow,
  formatNomusPedidoDateBr,
  parseNomusSalesOrdersSyncStrategy,
  resolveNomusSalesOrdersEmissaoWindow,
  type NomusSalesOrdersEmissaoWindow,
  type NomusSalesOrdersSyncStrategy,
} from "../src/lib/nomusSalesOrdersSyncWindow.ts";
import {
  assessSalesOrderSyncPayloadCompleteness,
  buildPresentLifecycleWriteData,
  buildSalesOrderSourceReconciliationPlan,
  buildSalesOrderSyncReconciliationScope,
  planDirectedSalesOrderAbsenceConfirmation,
  SALES_ORDER_PILOT_ABSENCE,
  stableNomusSalesOrderPayloadHash,
  summarizeSalesOrderReconciliationPreview,
  type SalesOrderLifecycleLocalSnapshot,
} from "../src/lib/nomus/nomusSalesOrderSourceReconciliation.ts";
import {
  acquireSalesOrderReconcileLock,
  applySalesOrderLifecyclePatches,
  createSalesOrderSourceSyncRun,
  finishSalesOrderSourceSyncRun,
  isSalesOrderAbsenceReconcileEnabled,
  loadSalesOrderLifecycleLocals,
} from "../src/lib/nomus/nomusSalesOrderSourceReconciliation.server.ts";
import {
  mapLegacySalesOrderStrategy,
  type NomusCanonicalSyncExecution,
} from "../src/lib/nomus/nomusCanonicalSyncContract.ts";
import {
  resolveSourceTriggerFromEnv,
  runNomusSalesOrdersSync,
  type NomusCanonicalSyncDelegateResult,
} from "../src/lib/nomus/nomusCanonicalSync.server.ts";

const prisma = new PrismaClient();

const SOURCE_SYSTEM = NOMUS_SALES_ORDER_SOURCE;
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_RETRY_BASE_MS = 700;

const syncHttpStats = { http429Count: 0 };

type JsonObject = Record<string, unknown>;

type BlockReason =
  | "CUSTOMER_NOT_RESOLVED"
  | "MISSING_PRODUCT_SKU"
  | "INACTIVE_PRODUCT_NOMUS"
  | "INVALID_NOMUS_ORDER"
  | "ORDER_WITHOUT_ITEMS";

type BlockedSalesOrder = {
  externalSalesOrderId: number;
  codigoPedido: string | null;
  reasons: BlockReason[];
  missingCustomerExternalId: number | null;
  missingSkus: string[];
  inactiveNomusProductIds: number[];
  proposalItemDetail: string | null;
};

type EligibleSalesOrderLine = {
  item: JsonObject;
  externalLineId: number | null;
  proposalItemId: string | null;
  proposalId: string | null;
  productId: string;
  externalProductId: number;
  skuSnapshot: string;
  productNameSnapshot: string;
  unit: string | null;
  quantity: number;
  negotiatedPrice: number;
  totalNetValue: number;
  notes: string | null;
  itemSequence: string | null;
  nomusItemStatusRaw: string | null;
  nomusItemStatusNormalized: string | null;
  nomusQuantityFulfilled: number | null;
  nomusQuantityPending: number | null;
  nomusIsCanceled: boolean;
  nomusIsCut: boolean;
};

type EligibleSalesOrderPlan = {
  pedido: JsonObject;
  externalSalesOrderId: number;
  codigoPedido: string;
  proposalId: string | null;
  customerId: string;
  externalCustomerId: number | null;
  externalSellerId: number | null;
  nomusSellerName: string | null;
  lineCount: number;
  lines: EligibleSalesOrderLine[];
};

type DryRunResult = {
  totalRead: number;
  eligibleCount: number;
  blockedCount: number;
  blockedReasons: Record<string, number>;
  nomusItemStatusDistribution: Record<string, number>;
  createsPreview: Array<{ externalSalesOrderId: number; codigoPedido: string; proposalId: string | null }>;
  updatesPreview: Array<NomusSyncUpdatePreview>;
  changedOrders: NomusSyncUpdatePreview[];
  changedHeaderTotals: NomusSyncUpdatePreview[];
  changedItems: NomusSyncUpdatePreview[];
  blockedPreview: BlockedSalesOrder[];
  criticalSchemaNote: string;
};

function timeLog(label: string): void {
  console.warn(`[nomus-sales-orders-v1][timing] ${new Date().toISOString()} ${label}`);
}

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function getEnvOrDefault(name: string, fallback: string): string {
  const value = (process.env[name] ?? "").trim();
  return value || fallback;
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

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseNomusDateTime(input: unknown): Date | null {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input;
  if (typeof input !== "string") return null;

  const raw = input.trim();
  if (!raw) return null;

  // Nomus retorna datas brasileiras em vários pontos: DD/MM/YY ou DD/MM/YYYY.
  // Precisamos interpretar isso antes de chamar new Date(raw), pois JavaScript
  // pode tratar strings ambíguas como MM/DD/YYYY e inverter dia/mês.
  const br = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );

  if (br) {
    const dd = Number.parseInt(br[1], 10);
    const mm = Number.parseInt(br[2], 10);
    const yearRaw = Number.parseInt(br[3], 10);
    const yyyy = br[3].length === 2 ? 2000 + yearRaw : yearRaw;
    const hh = Number.parseInt(br[4] ?? "0", 10);
    const mi = Number.parseInt(br[5] ?? "0", 10);
    const ss = Number.parseInt(br[6] ?? "0", 10);

    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

    const parsed = new Date(yyyy, mm - 1, dd, hh, mi, ss);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const iso = new Date(raw);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function moneyNumber(value: unknown): number {
  try {
    const parsed = parseNomusPtBrNumber(value);
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function decimalString(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "0.000000";
}

function jsonInput(value: JsonObject): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function calculateItemNetValue(item: JsonObject): number {
  const quantity = moneyNumber(item.quantidade);
  const unitPrice = moneyNumber(item.valorUnitario);
  const discount = moneyNumber(item.valorDesconto);
  const addition = moneyNumber(item.valorAcrescimo);
  const computed = quantity * unitPrice - discount + addition;

  const explicit =
    moneyNumber(item.valorTotal) ||
    moneyNumber(item.valorTotalItem) ||
    moneyNumber(item.valorLiquido);

  if (explicit > 0) return explicit;
  return computed > 0 ? computed : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildNomusHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = (process.env.NOMUS_TOKEN ?? "").trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const customHeaderName = (process.env.NOMUS_AUTH_HEADER_NAME ?? "").trim();
  const customHeaderValue = (process.env.NOMUS_AUTH_HEADER_VALUE ?? "").trim();
  if (customHeaderName && customHeaderValue) {
    headers[customHeaderName] = customHeaderValue;
  }
  return headers;
}

function buildNomusUrl(baseUrl: string, resource: string): URL {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedResource = resource.replace(/^\/+/, "");
  return new URL(normalizedResource, normalizedBase);
}

async function fetchJsonWithRetry(url: URL, maxRetries: number, retryBaseMs: number): Promise<unknown> {
  const headers = buildNomusHeaders();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, { method: "GET", headers });
    if (res.ok) return res.json();

    const body = await res.text().catch(() => "");
    const isRetryable = res.status === 429 || res.status >= 500;
    if (res.status === 429) syncHttpStats.http429Count += 1;
    if (!isRetryable || attempt === maxRetries) {
      throw new Error(`Falha HTTP ${res.status} em ${url.toString()}: ${body.slice(0, 300)}`);
    }

    const retryAfterSec = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    let tempoAteLiberarSec: number | null = null;

    if (res.status === 429 && body) {
      try {
        const parsed = JSON.parse(body) as { tempoAteLiberar?: unknown };
        const parsedTempo = toInt(parsed.tempoAteLiberar);
        if (parsedTempo != null && parsedTempo > 0) tempoAteLiberarSec = parsedTempo;
      } catch {
        tempoAteLiberarSec = null;
      }
    }

    const waitMs =
      tempoAteLiberarSec != null
        ? (tempoAteLiberarSec + 2) * 1000
        : Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : retryBaseMs * Math.pow(2, attempt);

    await sleep(waitMs);
  }

  throw new Error("Estado inesperado no retry HTTP.");
}

function pickArrayFromUnknown(payload: unknown): unknown[] {
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

function hasNextPage(payload: unknown, page: number, pageSize: number, currentLen: number): boolean {
  if (!payload || typeof payload !== "object") return currentLen > 0;

  if (Array.isArray(payload)) {
    return currentLen > 0;
  }

  const data = payload as Record<string, unknown>;
  const totalPages = toInt(data.totalPaginas) ?? toInt(data.totalPages) ?? toInt(data.paginas);
  if (totalPages != null) return page < totalPages;
  if (typeof data.hasMore === "boolean") return data.hasMore;

  return currentLen > 0;
}

function parseCliArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim();
  }
  return undefined;
}

function parseCliStrategy(): NomusSalesOrdersSyncStrategy {
  return parseNomusSalesOrdersSyncStrategy(parseCliArg("strategy"));
}

function readSalesOrdersPaginationWindow(strategy: NomusSalesOrdersSyncStrategy): SalesOrdersPaginationWindow & {
  cursorNote: string;
} {
  const maxPages = Math.max(
    1,
    toInt(process.env.NOMUS_SALES_ORDERS_MAX_PAGES) ?? toInt(process.env.NOMUS_MAX_PAGES) ?? 200
  );
  if (strategy === "recent-window") {
    const recentMaxPages = Math.max(
      1,
      toInt(process.env.NOMUS_SALES_ORDERS_RECENT_MAX_PAGES) ?? maxPages
    );
    const window: SalesOrdersPaginationWindow = {
      startPage: 1,
      maxPages: recentMaxPages,
      cursorFile: null,
    };
    return {
      ...window,
      cursorNote: `recent-window: páginas 1..${recentMaxPages} (sem cursor)`,
    };
  }

  const cursorFile = (process.env.NOMUS_SALES_ORDERS_PAGE_CURSOR_FILE ?? "").trim() || null;
  const defaultStartPage = Math.max(1, toInt(process.env.NOMUS_SALES_ORDERS_START_PAGE) ?? 1);

  let cursorContent: string | null = null;
  if (cursorFile) {
    try {
      cursorContent = readFileSync(cursorFile, "utf8");
    } catch {
      // primeira execução — usa startPage padrão
    }
  }

  const startPage = readSalesOrdersPageCursor({
    cursorFile,
    defaultStartPage,
    cursorContent,
  });

  const window: SalesOrdersPaginationWindow = { startPage, maxPages, cursorFile };
  return {
    ...window,
    cursorNote: formatSalesOrdersPaginationNote(window),
  };
}

function commitSalesOrdersPaginationCursor(
  window: SalesOrdersPaginationWindow,
  meta: SalesOrdersFetchWindowMeta
): void {
  if (!window.cursorFile) return;

  const { nextStart, reason } = resolveNextSalesOrdersPageCursor(meta);
  try {
    writeFileSync(window.cursorFile, String(nextStart), "utf8");
    console.warn(
      `[nomus-sales-orders-v1] cursor atualizado (${reason}): próximo startPage=${nextStart}`
    );
  } catch (err) {
    console.warn(
      `[nomus-sales-orders-v1] não foi possível gravar cursor em ${window.cursorFile}:`,
      err
    );
  }
}

type SalesOrdersFetchResultMeta = SalesOrdersFetchWindowMeta & {
  strategy: NomusSalesOrdersSyncStrategy;
  emissaoWindow: NomusSalesOrdersEmissaoWindow | null;
  stoppedBecauseWindowExceeded: boolean;
  stoppedBecauseNoNext: boolean;
  excludedOlderThanWindow: number;
  dataEmissaoFilterApplied: boolean;
};

async function fetchNomusPedidoPages(
  baseUrl: string,
  options: SalesOrdersPaginationWindow,
  fetchOpts: {
    strategy: NomusSalesOrdersSyncStrategy;
    emissaoWindow: NomusSalesOrdersEmissaoWindow | null;
    referenceNow: Date;
  }
): Promise<{ pedidos: JsonObject[]; meta: SalesOrdersFetchResultMeta }> {
  const pageSize = Math.max(1, toInt(process.env.NOMUS_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE);
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);
  const startPage = options.startPage;
  const maxPages = options.maxPages;
  const lastPage = startPage + maxPages - 1;

  const dataEmissaoInicial =
    fetchOpts.emissaoWindow != null
      ? formatNomusPedidoDateBr(fetchOpts.emissaoWindow.startDate)
      : getEnvOrDefault("NOMUS_PEDIDO_DATA_EMISSAO_INICIAL", "01/01/2023");
  const dataEmissaoFinal =
    fetchOpts.emissaoWindow != null
      ? formatNomusPedidoDateBr(fetchOpts.emissaoWindow.endDate)
      : getEnvOrDefault("NOMUS_PEDIDO_DATA_EMISSAO_FINAL", "31/12/2030");
  const dataVencimentoInicial = getEnvOrDefault("NOMUS_PEDIDO_DATA_VENCIMENTO_INICIAL", "01/01/2023");
  const dataVencimentoFinal = getEnvOrDefault("NOMUS_PEDIDO_DATA_VENCIMENTO_FINAL", "31/12/2030");

  const pedidos: JsonObject[] = [];
  let page = startPage;
  let stoppedBecauseEmpty = false;
  let completedWindow = false;
  let stoppedBecauseNoNext = false;
  let stoppedBecauseWindowExceeded = false;
  let excludedOlderThanWindow = 0;
  let lastPageFetched = startPage - 1;

  while (true) {
    lastPageFetched = page;
    const url = buildNomusUrl(baseUrl, "pedidos");
    url.searchParams.set("pagina", String(page));
    url.searchParams.set("tamanhoPagina", String(pageSize));
    url.searchParams.set("dataEmissaoInicial", dataEmissaoInicial);
    url.searchParams.set("dataEmissaoFinal", dataEmissaoFinal);
    url.searchParams.set("dataVencimentoInicial", dataVencimentoInicial);
    url.searchParams.set("dataVencimentoFinal", dataVencimentoFinal);

    const payload = await fetchJsonWithRetry(url, maxRetries, retryBaseMs);
    const arr = pickArrayFromUnknown(payload).filter(
      (entry): entry is JsonObject => !!entry && typeof entry === "object"
    );

    if (arr.length === 0) {
      stoppedBecauseEmpty = true;
      break;
    }

    let pageRows = arr;
    if (fetchOpts.emissaoWindow) {
      const filtered = filterPedidosByEmissaoWindow(arr, fetchOpts.emissaoWindow.startDate);
      excludedOlderThanWindow += filtered.excludedOlder;
      pageRows = filtered.kept;

      const hasOlderOnPage = arr.some(
        (row) =>
          extractPedidoDataEmissao(row) != null &&
          extractPedidoDataEmissao(row)!.getTime() < fetchOpts.emissaoWindow!.startDate.getTime()
      );
      if (hasOlderOnPage) {
        stoppedBecauseWindowExceeded = true;
      }
    }

    pedidos.push(...pageRows);

    console.warn(
      `[nomus-sales-orders-v1] página ${page} lida com ${arr.length} pedidos; ` +
        `na janela=${pageRows.length}; acumulado=${pedidos.length}.`
    );

    if (stoppedBecauseWindowExceeded) {
      console.warn(
        `[nomus-sales-orders-v1] parada: pedidos mais antigos que ${dataEmissaoInicial} detectados na página ${page}.`
      );
      break;
    }

    if (page >= lastPage) {
      completedWindow = true;
      console.warn(
        `[nomus-sales-orders-v1] limite de bloco atingido: startPage=${startPage}, maxPages=${maxPages}, lastPage=${lastPage}.`
      );
      break;
    }

    if (!hasNextPage(payload, page, pageSize, arr.length)) {
      stoppedBecauseNoNext = true;
      break;
    }
    page += 1;
  }

  return {
    pedidos,
    meta: {
      startPage,
      maxPages,
      lastPageFetched,
      totalPedidos: pedidos.length,
      stoppedBecauseEmpty,
      completedWindow,
      strategy: fetchOpts.strategy,
      emissaoWindow: fetchOpts.emissaoWindow,
      stoppedBecauseWindowExceeded,
      stoppedBecauseNoNext,
      excludedOlderThanWindow,
      dataEmissaoFilterApplied: fetchOpts.emissaoWindow != null,
    },
  };
}

async function fetchAllNomusPedidos(
  baseUrl: string,
  strategy: NomusSalesOrdersSyncStrategy,
  referenceNow: Date
): Promise<{ pedidos: JsonObject[]; meta: SalesOrdersFetchResultMeta }> {
  const window = readSalesOrdersPaginationWindow(strategy);
  const emissaoWindow =
    strategy === "recent-window" ? resolveNomusSalesOrdersEmissaoWindow(referenceNow) : null;

  console.warn(`[nomus-sales-orders-v1] modo=${describeNomusSalesOrdersSyncMode(strategy)}`);
  console.warn(`[nomus-sales-orders-v1] paginação: ${window.cursorNote}`);
  if (emissaoWindow) {
    console.warn(
      `[nomus-sales-orders-v1] janela dataEmissao: ${emissaoWindow.label}; ` +
        `início=${formatNomusPedidoDateBr(emissaoWindow.startDate)}; ` +
        `fim=${formatNomusPedidoDateBr(emissaoWindow.endDate)}`
    );
  }

  const result = await fetchNomusPedidoPages(baseUrl, window, {
    strategy,
    emissaoWindow,
    referenceNow,
  });

  if (strategy === "full-reconciliation") {
    commitSalesOrdersPaginationCursor(window, result.meta);
  }

  if (result.meta.totalPedidos === 0) {
    console.warn(
      `[nomus-sales-orders-v1] AVISO: nenhum pedido retornado pelo Nomus na janela ` +
        `${window.startPage}..${window.startPage + window.maxPages - 1}. ` +
        `Verifique cursor, dataEmissao e disponibilidade da API.`
    );
  }

  return result;
}

async function fetchNomusPedidoByOrderCode(
  baseUrl: string,
  orderCodeArg: string
): Promise<JsonObject | null> {
  const targetKey = canonicalNomusOrderCodeKey(orderCodeArg);
  if (!targetKey) return null;

  const maxPages = Math.max(1, toInt(process.env.NOMUS_SALES_ORDERS_TARGET_MAX_PAGES) ?? 100);
  const pageSize = Math.max(1, toInt(process.env.NOMUS_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE);
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);

  const dataEmissaoInicial = getEnvOrDefault("NOMUS_PEDIDO_DATA_EMISSAO_INICIAL", "01/01/2023");
  const dataEmissaoFinal = getEnvOrDefault("NOMUS_PEDIDO_DATA_EMISSAO_FINAL", "31/12/2030");
  const dataVencimentoInicial = getEnvOrDefault("NOMUS_PEDIDO_DATA_VENCIMENTO_INICIAL", "01/01/2023");
  const dataVencimentoFinal = getEnvOrDefault("NOMUS_PEDIDO_DATA_VENCIMENTO_FINAL", "31/12/2030");

  for (let page = 1; page <= maxPages; page += 1) {
    const url = buildNomusUrl(baseUrl, "pedidos");
    url.searchParams.set("pagina", String(page));
    url.searchParams.set("tamanhoPagina", String(pageSize));
    url.searchParams.set("dataEmissaoInicial", dataEmissaoInicial);
    url.searchParams.set("dataEmissaoFinal", dataEmissaoFinal);
    url.searchParams.set("dataVencimentoInicial", dataVencimentoInicial);
    url.searchParams.set("dataVencimentoFinal", dataVencimentoFinal);

    const payload = await fetchJsonWithRetry(url, maxRetries, retryBaseMs);
    const arr = pickArrayFromUnknown(payload).filter(
      (entry): entry is JsonObject => !!entry && typeof entry === "object"
    );

    for (const pedido of arr) {
      const codeKey = canonicalNomusOrderCodeKey(String(pedido.codigoPedido ?? ""));
      if (codeKey === targetKey) return pedido;
    }

    if (arr.length < pageSize) break;
  }

  return null;
}

function pedidoAlreadyInList(pedidos: JsonObject[], pedido: JsonObject): boolean {
  const id = toInt(pedido.id);
  const key = canonicalNomusOrderCodeKey(String(pedido.codigoPedido ?? ""));
  return pedidos.some((row) => {
    if (id != null && toInt(row.id) === id) return true;
    const rowKey = canonicalNomusOrderCodeKey(String(row.codigoPedido ?? ""));
    return key != null && rowKey === key;
  });
}

function nomusProductSku(product: JsonObject): string | null {
  return asString(product.codigo) ?? asString(product.codigoProduto) ?? asString(product.nome);
}

function nomusProductIsActive(product: JsonObject): boolean {
  const ativo = product.ativo;
  if (typeof ativo === "boolean") return ativo;
  if (typeof ativo === "string") return ativo.trim().toLowerCase() !== "false";
  return true;
}

async function mapPessoaBridgeByExternalCustomerId(
  baseUrl: string,
  externalCustomerIds: number[]
): Promise<Map<number, { taxId: string | null; customerId: string | null }>> {
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);

  const bridge = new Map<number, { taxId: string | null; customerId: string | null }>();
  const uniqueIds = [...new Set(externalCustomerIds)].filter((id) => id > 0);

  const cachedSalesOrderCustomers =
    uniqueIds.length === 0
      ? []
      : await prisma.salesOrder.findMany({
          where: {
            sourceSystem: SOURCE_SYSTEM,
            externalCustomerId: { in: uniqueIds },
          },
          select: {
            externalCustomerId: true,
            Customer: {
              select: {
                id: true,
                taxId: true,
              },
            },
          },
        });

  for (const row of cachedSalesOrderCustomers) {
    const externalCustomerId = row.externalCustomerId;
    if (externalCustomerId == null || !row.Customer?.id) continue;
    if (!bridge.has(externalCustomerId)) {
      bridge.set(externalCustomerId, {
        taxId: normalizeTaxId(row.Customer.taxId),
        customerId: row.Customer.id,
      });
    }
  }

  timeLog(
    `mapPessoaBridgeByExternalCustomerId cacheSalesOrder resolved=${bridge.size}/${uniqueIds.length}`
  );

  const missingIds = uniqueIds.filter((id) => !bridge.has(id));

  const localCustomers = await prisma.customer.findMany({
    select: { id: true, taxId: true },
  });
  const localByTaxId = new Map<string, string>();
  for (const customer of localCustomers) {
    const taxId = normalizeTaxId(customer.taxId);
    if (taxId) localByTaxId.set(taxId, customer.id);
  }

  let pessoaFetchCount = 0;
  for (const idCliente of missingIds) {
    pessoaFetchCount += 1;
    if (
      pessoaFetchCount === 1 ||
      pessoaFetchCount % 25 === 0 ||
      pessoaFetchCount === missingIds.length
    ) {
      timeLog(`fetchPessoa progresso=${pessoaFetchCount}/${missingIds.length}`);
    }

    const url = buildNomusUrl(baseUrl, "pessoas");
    url.searchParams.set("query", `id==${idCliente}`);

    const payload = await fetchJsonWithRetry(url, maxRetries, retryBaseMs);
    const arr = pickArrayFromUnknown(payload);
    const pessoa =
      (arr.find((x): x is JsonObject => !!x && typeof x === "object") as JsonObject | undefined) ??
      ((payload && typeof payload === "object" ? (payload as JsonObject) : undefined) as JsonObject | undefined);

    const taxId = normalizeTaxId((pessoa?.cnpj as unknown) ?? (pessoa?.cpf as unknown));
    const customerId = taxId ? (localByTaxId.get(taxId) ?? null) : null;
    bridge.set(idCliente, { taxId, customerId });
  }

  timeLog(
    `mapPessoaBridgeByExternalCustomerId fetchPessoa missing=${missingIds.length} totalResolved=${bridge.size}`
  );

  return bridge;
}

async function fetchNomusProductById(
  baseUrl: string,
  productId: number,
  maxRetries: number,
  retryBaseMs: number
): Promise<JsonObject | null> {
  const url = buildNomusUrl(baseUrl, "produtos");
  url.searchParams.set("query", `id==${productId}`);

  const payload = await fetchJsonWithRetry(url, maxRetries, retryBaseMs);
  const arr = pickArrayFromUnknown(payload);
  const fromArr = arr.find((x): x is JsonObject => !!x && typeof x === "object") as JsonObject | undefined;
  if (fromArr) return fromArr;
  if (payload && typeof payload === "object" && (payload as JsonObject).id != null) {
    return payload as JsonObject;
  }
  return null;
}

type ProposalItemJoin = {
  id: string;
  proposalId: string;
  productId: string;
  externalProductId: number;
  customerId: string;
};

async function loadProposalItemIndex(): Promise<Map<string, ProposalItemJoin[]>> {
  const rows = await prisma.proposalItem.findMany({
    where: { externalProductId: { not: null } },
    select: {
      id: true,
      proposalId: true,
      productId: true,
      externalProductId: true,
      Proposal: { select: { customerId: true } },
    },
  });

  const index = new Map<string, ProposalItemJoin[]>();
  for (const r of rows) {
    const ext = r.externalProductId;
    if (ext == null) continue;
    const entry: ProposalItemJoin = {
      id: r.id,
      proposalId: r.proposalId,
      productId: r.productId,
      externalProductId: ext,
      customerId: r.Proposal.customerId,
    };
    const k = `${r.Proposal.customerId}|${ext}`;
    const arr = index.get(k) ?? [];
    arr.push(entry);
    index.set(k, arr);
  }
  return index;
}

async function loadProductMapFromProposalItems(
  externalProductIds: number[]
): Promise<Map<number, { id: string; sku: string; name: string }>> {
  const uniqueIds = [...new Set(externalProductIds)].filter((id) => id > 0);

  if (uniqueIds.length === 0) return new Map();

  const rows = await prisma.proposalItem.findMany({
    where: {
      externalProductId: { in: uniqueIds },
    },
    select: {
      externalProductId: true,
      Product: {
        select: {
          id: true,
          sku: true,
          name: true,
        },
      },
    },
  });

  const map = new Map<number, { id: string; sku: string; name: string }>();

  for (const row of rows) {
    const externalProductId = row.externalProductId;
    if (externalProductId == null) continue;
    if (!row.Product?.sku) continue;

    if (!map.has(externalProductId)) {
      map.set(externalProductId, {
        id: row.Product.id,
        sku: row.Product.sku,
        name: row.Product.name,
      });
    }
  }

  return map;
}

function mergeReasons(set: Set<BlockReason>, reasons: BlockReason[]): void {
  for (const r of reasons) set.add(r);
}

function analyzeOrder(
  pedido: JsonObject,
  customerBridge: Map<number, { taxId: string | null; customerId: string | null }>,
  proposalIndex: Map<string, ProposalItemJoin[]>,
  nomusProductById: Map<number, JsonObject>,
  productBySku: Map<string, { id: string; sku: string; name: string }>,
  productById: Map<string, { id: string; sku: string; name: string }>
): { eligible: EligibleSalesOrderPlan | null; blocked: BlockedSalesOrder | null; lineReasons: BlockReason[][] } {
  const externalSalesOrderId = toInt(pedido.id);
  const codigoPedido = asString(pedido.codigoPedido);

  if (externalSalesOrderId == null) {
    return {
      eligible: null,
      blocked: {
        externalSalesOrderId: 0,
        codigoPedido,
        reasons: ["INVALID_NOMUS_ORDER"],
        missingCustomerExternalId: null,
        missingSkus: [],
        inactiveNomusProductIds: [],
        proposalItemDetail: "Pedido sem id numérico válido no payload Nomus.",
      },
      lineReasons: [],
    };
  }

  const idPessoaCliente = toInt(pedido.idPessoaCliente);
  const { externalSellerId, nomusSellerName } = extractNomusSellerFromPedido(pedido);
  const bridge = idPessoaCliente != null ? customerBridge.get(idPessoaCliente) : undefined;
  const customerId = bridge?.customerId ?? null;

  const reasons = new Set<BlockReason>();
  const missingSkus = new Set<string>();
  const inactiveNomusProductIds = new Set<number>();
  let proposalItemDetail: string | null = null;

  if (idPessoaCliente == null || !customerId) {
    reasons.add("CUSTOMER_NOT_RESOLVED");
  }

  const itemsRaw = Array.isArray(pedido.itensPedido)
    ? (pedido.itensPedido.filter((x): x is JsonObject => !!x && typeof x === "object") as JsonObject[])
    : [];

  if (itemsRaw.length === 0) {
    mergeReasons(reasons, ["ORDER_WITHOUT_ITEMS"]);
    proposalItemDetail = "Pedido sem itensPedido no payload Nomus.";
  }

  const lineReasons: BlockReason[][] = [];
  const resolvedLines: EligibleSalesOrderLine[] = [];
  let itemSequenceIndex = 0;

  for (const item of itemsRaw) {
    itemSequenceIndex += 1;
    const parsedStatus = parseNomusSalesOrderItemStatus(item);
    const statusFields = {
      itemSequence:
        asString(item.item) ??
        asString(item.sequencia) ??
        String(itemSequenceIndex),
      nomusItemStatusRaw: parsedStatus.statusRaw,
      nomusItemStatusNormalized: parsedStatus.statusNormalized,
      nomusQuantityFulfilled: parsedStatus.quantityFulfilled,
      nomusQuantityPending: parsedStatus.quantityPending,
      nomusIsCanceled: parsedStatus.isCanceled,
      nomusIsCut: parsedStatus.isCut,
    };
    const lineR = new Set<BlockReason>();
    const idProduto = toInt(item.idProduto);

    if (!customerId) {
      lineR.add("CUSTOMER_NOT_RESOLVED");
      lineReasons.push([...lineR]);
      continue;
    }

    if (idProduto == null) {
      lineR.add("MISSING_PRODUCT_SKU");
      mergeReasons(reasons, ["MISSING_PRODUCT_SKU"]);
      lineReasons.push([...lineR]);
      continue;
    }

    const key = `${customerId}|${idProduto}`;
    let candidates = proposalIndex.get(key) ?? [];

    const nomusProduct = nomusProductById.get(idProduto) ?? null;
    let localSku: string | null = null;
    let localProduct: { id: string; sku: string; name: string } | null = null;

    if (nomusProduct) {
      localSku = nomusProductSku(nomusProduct);
      if (localSku) {
        const p = productBySku.get(localSku);
        if (p) localProduct = p;
      }
      if (!nomusProductIsActive(nomusProduct)) {
        // Pedido vindo do Nomus é espelho histórico/comercial.
        // Produto inativo no Nomus não invalida pedido já existente,
        // desde que seja possível resolver o produto local por SKU.
        inactiveNomusProductIds.add(idProduto);
      }
    }

    if (candidates.length > 1 && localProduct) {
      const filtered = candidates.filter((c) => c.productId === localProduct.id);
      if (filtered.length === 1) candidates = filtered;
      else if (filtered.length === 0) {
        candidates = [];
      } else {
        candidates = filtered;
      }
    }

    if (candidates.length === 1) {
      const resolvedProduct = localProduct ?? productById.get(candidates[0].productId) ?? null;
      if (!resolvedProduct) {
        lineR.add("MISSING_PRODUCT_SKU");
        missingSkus.add(localSku ?? `idProduto=${idProduto}`);
        mergeReasons(reasons, ["MISSING_PRODUCT_SKU"]);
        lineReasons.push([...lineR]);
        continue;
      }

      resolvedLines.push({
        item,
        externalLineId: extractNomusLineExternalId(item),
        proposalItemId: candidates[0].id,
        proposalId: candidates[0].proposalId,
        productId: candidates[0].productId,
        externalProductId: idProduto,
        skuSnapshot: resolvedProduct.sku,
        productNameSnapshot: resolvedProduct.name,
        unit: asString(item.unidadeMedida) ?? asString(item.nomeUnidadeMedida) ?? (toInt(item.idUnidadeMedida) != null ? String(toInt(item.idUnidadeMedida)) : null),
        quantity: moneyNumber(item.quantidade),
        negotiatedPrice: moneyNumber(item.valorUnitario),
        totalNetValue: calculateItemNetValue(item),
        notes: asString(item.observacoes) ?? asString(item.informacoesAdicionaisProduto),
        ...statusFields,
      });
      lineReasons.push([]);
      continue;
    }

    if (candidates.length === 0) {
      if (!nomusProduct) {
        lineR.add("MISSING_PRODUCT_SKU");
        missingSkus.add(`idProduto=${idProduto}`);
        mergeReasons(reasons, ["MISSING_PRODUCT_SKU"]);
        lineReasons.push([...lineR]);
        continue;
      }

      if (!localSku || !localProduct) {
        lineR.add("MISSING_PRODUCT_SKU");
        if (localSku) missingSkus.add(localSku);
        else missingSkus.add(`idProduto=${idProduto}`);
        mergeReasons(reasons, ["MISSING_PRODUCT_SKU"]);
        lineReasons.push([...lineR]);
        continue;
      }

      resolvedLines.push({
        item,
        externalLineId: extractNomusLineExternalId(item),
        proposalItemId: null,
        proposalId: null,
        productId: localProduct.id,
        externalProductId: idProduto,
        skuSnapshot: localProduct.sku,
        productNameSnapshot: localProduct.name,
        unit: asString(item.unidadeMedida) ?? asString(item.nomeUnidadeMedida) ?? (toInt(item.idUnidadeMedida) != null ? String(toInt(item.idUnidadeMedida)) : null),
        quantity: moneyNumber(item.quantidade),
        negotiatedPrice: moneyNumber(item.valorUnitario),
        totalNetValue: calculateItemNetValue(item),
        notes: asString(item.observacoes) ?? asString(item.informacoesAdicionaisProduto),
        ...statusFields,
      });
      lineReasons.push([]);
      continue;
    }

    if (localProduct) {
      resolvedLines.push({
        item,
        externalLineId: extractNomusLineExternalId(item),
        proposalItemId: null,
        proposalId: null,
        productId: localProduct.id,
        externalProductId: idProduto,
        skuSnapshot: localProduct.sku,
        productNameSnapshot: localProduct.name,
        unit: asString(item.unidadeMedida) ?? asString(item.nomeUnidadeMedida) ?? (toInt(item.idUnidadeMedida) != null ? String(toInt(item.idUnidadeMedida)) : null),
        quantity: moneyNumber(item.quantidade),
        negotiatedPrice: moneyNumber(item.valorUnitario),
        totalNetValue: calculateItemNetValue(item),
        notes: asString(item.observacoes) ?? asString(item.informacoesAdicionaisProduto),
        ...statusFields,
      });
      lineReasons.push([]);
      continue;
    }

    lineR.add("MISSING_PRODUCT_SKU");
    missingSkus.add(`idProduto=${idProduto}`);
    mergeReasons(reasons, ["MISSING_PRODUCT_SKU"]);
    lineReasons.push([...lineR]);
  }

  const proposalIds = new Set(
    resolvedLines
      .map((l) => l.proposalId)
      .filter((x): x is string => typeof x === "string" && x.length > 0)
  );

  if (reasons.size > 0) {
    return {
      eligible: null,
      blocked: {
        externalSalesOrderId,
        codigoPedido,
        reasons: [...reasons],
        missingCustomerExternalId: reasons.has("CUSTOMER_NOT_RESOLVED") ? idPessoaCliente : null,
        missingSkus: [...missingSkus].sort(),
        inactiveNomusProductIds: [...inactiveNomusProductIds].sort((a, b) => a - b),
        proposalItemDetail,
      },
      lineReasons,
    };
  }

  const singleProposalId = proposalIds.size === 1 ? [...proposalIds][0]! : null;

  return {
    eligible: {
      pedido,
      externalSalesOrderId,
      codigoPedido: codigoPedido
        ? normalizeNomusOrderCodeForStorage(codigoPedido)
        : `NOMUS-ORDER-${externalSalesOrderId}`,
      proposalId: singleProposalId,
      customerId: customerId!,
      externalCustomerId: idPessoaCliente,
      externalSellerId,
      nomusSellerName,
      lineCount: resolvedLines.length,
      lines: resolvedLines,
    },
    blocked: null,
    lineReasons,
  };
}

function collectNomusItemStatuses(pedidos: JsonObject[]): Record<string, number> {
  const dist: Record<string, number> = {};
  timeLog("INICIO analyzeOrder loop");
  for (const pedido of pedidos) {
    const items = Array.isArray(pedido.itensPedido) ? pedido.itensPedido : [];
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const st = asString((raw as JsonObject).status) ?? "(sem status)";
      dist[st] = (dist[st] ?? 0) + 1;
    }
  }
  return dist;
}

async function loadExistingSalesOrdersForNomusSync(
  eligible: EligibleSalesOrderPlan[]
): Promise<NomusSyncExistingSalesOrder[]> {
  const extIds = [...new Set(eligible.map((e) => e.externalSalesOrderId))];
  const codeVariants = [
    ...new Set(eligible.flatMap((e) => expandNomusOrderCodeLookupVariants(e.codigoPedido))),
  ];

  if (extIds.length === 0 && codeVariants.length === 0) return [];

  const orClauses: Prisma.SalesOrderWhereInput[] = [];
  if (extIds.length > 0) {
    orClauses.push({ externalSalesOrderId: { in: extIds } });
  }
  for (const code of codeVariants) {
    orClauses.push({ orderCode: code });
    orClauses.push({ externalSalesOrderCode: code });
  }

  const rows = await prisma.salesOrder.findMany({
    where: { OR: orClauses },
    select: {
      id: true,
      orderCode: true,
      externalSalesOrderId: true,
      externalSalesOrderCode: true,
      sourceSystem: true,
      totalNetValue: true,
      totalGrossValue: true,
      totalItems: true,
      totalCost: true,
      totalMarginValue: true,
      totalMarginPerc: true,
      updatedAt: true,
    },
  });

  return rows;
}

async function runDry(
  eligible: EligibleSalesOrderPlan[]
): Promise<
  Pick<
    DryRunResult,
    "createsPreview" | "updatesPreview" | "changedOrders" | "changedHeaderTotals" | "changedItems"
  >
> {
  const existingRows = await loadExistingSalesOrdersForNomusSync(eligible);
  const indexes = indexExistingSalesOrdersByNomusKey(existingRows);

  const createsPreview: DryRunResult["createsPreview"] = [];
  const updatesPreview: NomusSyncUpdatePreview[] = [];

  for (const plan of eligible) {
    const pedido = plan.pedido;
    const totalNetValue = moneyNumber(pedido.valorTotal);
    const existing = findExistingSalesOrderForNomusSync(indexes, plan);
    if (!existing) {
      createsPreview.push({
        externalSalesOrderId: plan.externalSalesOrderId,
        codigoPedido: plan.codigoPedido,
        proposalId: plan.proposalId,
      });
    } else {
      updatesPreview.push(
        buildNomusSyncUpdatePreview(existing, {
          externalSalesOrderId: plan.externalSalesOrderId,
          codigoPedido: plan.codigoPedido,
          totalNetValue,
          totalGrossValue: totalNetValue,
          lineCount: plan.lines.length,
          plannedLines: plan.lines.map((line) => ({
            negotiatedPrice: line.negotiatedPrice,
            quantity: line.quantity,
          })),
        })
      );
    }
  }

  const changedOrders = updatesPreview.filter(
    (row) => row.changedHeaderTotals || row.changedItems || row.changedCommercialPrices
  );
  const changedHeaderTotals = updatesPreview.filter((row) => row.changedHeaderTotals);
  const changedItems = updatesPreview.filter((row) => row.changedItems);

  return {
    createsPreview: createsPreview.slice(0, 50),
    updatesPreview: updatesPreview.slice(0, 50),
    changedOrders: changedOrders.slice(0, 50),
    changedHeaderTotals: changedHeaderTotals.slice(0, 50),
    changedItems: changedItems.slice(0, 50),
  };
}

function mapItemWriteRowToCreateData(row: NomusSyncItemWriteRow): Prisma.SalesOrderItemCreateManyInput {
  return {
    salesOrderId: row.salesOrderId,
    proposalItemId: row.proposalItemId,
    productId: row.productId,
    externalProductId: row.externalProductId,
    skuSnapshot: row.skuSnapshot,
    productNameSnapshot: row.productNameSnapshot,
    quantity: row.quantity,
    unit: row.unit,
    unitCost: row.unitCost,
    negotiatedPrice: row.negotiatedPrice,
    totalNetValue: row.totalNetValue,
    totalCost: row.totalCost,
    marginValue: row.marginValue,
    marginPerc: row.marginPerc,
    notes: row.notes,
    nomusItemExternalId: row.nomusItemExternalId ?? null,
    nomusItemSequence: row.nomusItemSequence ?? null,
    nomusItemStatusRaw: row.nomusItemStatusRaw ?? null,
    nomusItemStatusNormalized: row.nomusItemStatusNormalized ?? null,
    nomusQuantityFulfilled: row.nomusQuantityFulfilled ?? null,
    nomusQuantityPending: row.nomusQuantityPending ?? null,
    nomusIsCanceled: row.nomusIsCanceled ?? false,
    nomusIsCut: row.nomusIsCut ?? false,
    nomusIsStale: row.nomusIsStale ?? false,
    nomusMatchConfidence: row.nomusMatchConfidence ?? null,
    nomusMatchReason: row.nomusMatchReason ?? null,
    nomusLastSeenAt: row.nomusLastSeenAt ?? null,
    nomusRawItem:
      row.nomusRawItem != null
        ? (row.nomusRawItem as Prisma.InputJsonValue)
        : Prisma.JsonNull,
  };
}

async function applyNomusSyncItemWritePlan(
  tx: Prisma.TransactionClient,
  plan: ReturnType<typeof buildNomusSyncItemWritePlan>
): Promise<number> {
  let touched = 0;
  for (const row of [...plan.upserts, ...plan.staleUpdates]) {
    if (!row.id) continue;
    await tx.salesOrderItem.update({
      where: { id: row.id },
      data: mapItemWriteRowToCreateData(row),
    });
    touched += 1;
  }
  if (plan.creates.length > 0) {
    await tx.salesOrderItem.createMany({
      data: plan.creates.map(mapItemWriteRowToCreateData),
    });
    touched += plan.creates.length;
  }
  return touched;
}


async function runApply(
  eligible: EligibleSalesOrderPlan[],
  existingIndexes: ReturnType<typeof indexExistingSalesOrdersByNomusKey>,
  lifecycleCtx: { runId: string | null; executedAt: Date }
): Promise<{
  created: number;
  updated: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsStale: number;
  affectedSalesOrderIds: string[];
  reactivatedSalesOrderIds: string[];
}> {
  let created = 0;
  let updated = 0;
  let itemsCreated = 0;
  let itemsUpdated = 0;
  let itemsStale = 0;
  const affectedSalesOrderIds: string[] = [];
  const reactivatedSalesOrderIds: string[] = [];

  for (const plan of eligible) {
    await prisma.$transaction(async (tx) => {
      const pedido = plan.pedido;
      const issueDate =
        parseNomusDateTime(pedido.dataEmissao) ??
        parseNomusDateTime(pedido.dataCriacao) ??
        new Date();

      const expectedDeliveryDate = parseNomusDateTime(pedido.dataEntregaPadrao);
      const totalNetValue = moneyNumber(pedido.valorTotal);
      const totalFreight = moneyNumber(pedido.valorTotalFrete);
      const externalSellerId = plan.externalSellerId ?? toInt(pedido.idPessoaVendedor);
      const nomusSellerName = plan.nomusSellerName;
      const externalCompanyId = toInt(pedido.idEmpresa);
      const payloadHash = stableNomusSalesOrderPayloadHash(pedido);

      const existingMatch = findExistingSalesOrderForNomusSync(existingIndexes, plan);

      let safeProposalId = plan.proposalId;

      if (safeProposalId) {
        const salesOrderUsingProposal = await tx.salesOrder.findUnique({
          where: { proposalId: safeProposalId },
          select: { id: true, externalSalesOrderId: true, orderCode: true },
        });

        if (salesOrderUsingProposal && (!existingMatch || salesOrderUsingProposal.id !== existingMatch.id)) {
          console.warn(
            `[nomus-sales-orders-v1] proposalId ${safeProposalId} já está vinculado ao pedido ${salesOrderUsingProposal.orderCode ?? salesOrderUsingProposal.externalSalesOrderId}; ` +
              `pedido ${plan.codigoPedido} será espelhado sem vínculo direto com proposalId.`,
          );
          safeProposalId = null;
        }
      }

      const lifecycleWrite = buildPresentLifecycleWriteData({
        payloadHash,
        executedAt: lifecycleCtx.executedAt,
        runId: lifecycleCtx.runId,
        isCreate: !existingMatch,
      });

      const nomusHeader = {
        proposalId: safeProposalId,
        sourceSystem: SOURCE_SYSTEM,
        externalSalesOrderId: plan.externalSalesOrderId,
        externalSalesOrderCode: plan.codigoPedido,
        orderCode: plan.codigoPedido,
        customerId: plan.customerId,
        externalCustomerId: plan.externalCustomerId,
        responsible: null,
        externalSellerId,
        nomusSellerName,
        companyIssuer: externalCompanyId != null ? String(externalCompanyId) : null,
        externalCompanyId,
        status: "SENT_TO_NOMUS" as const,
        issueDate,
        expectedDeliveryDate,
        paymentTerms: asString(pedido.condicaoPagamentoTexto),
        paymentMethod: toInt(pedido.idFormaPagamento) != null ? String(toInt(pedido.idFormaPagamento)) : null,
        freightCondition:
          asString(pedido.modalidadeTransporte) ??
          (toInt(pedido.modalidadeTransporte) != null ? String(toInt(pedido.modalidadeTransporte)) : null),
        deliveryLocation: null,
        notes: asString(pedido.observacoes),
        internalNotes: asString(pedido.observacoesInternas),
        totalItems: plan.lines.length,
        totalGrossValue: decimalString(totalNetValue),
        totalDiscount: decimalString(0),
        totalNetValue: decimalString(totalNetValue),
        totalCost: decimalString(0),
        totalMarginValue: decimalString(totalNetValue),
        totalMarginPerc: decimalString(totalNetValue > 0 ? 100 : 0),
        totalTaxes: decimalString(0),
        totalFreight: decimalString(totalFreight),
        sentToNomusAt: parseNomusDateTime(pedido.dataCriacao),
        nomusRawResponse: jsonInput(pedido),
        ...lifecycleWrite,
      };

      const plannedLines = plan.lines.map((line) => ({
        externalLineId: line.externalLineId,
        productId: line.productId,
        externalProductId: line.externalProductId,
        proposalItemId: line.proposalItemId,
        skuSnapshot: line.skuSnapshot,
        productNameSnapshot: line.productNameSnapshot,
        unit: line.unit,
        quantity: line.quantity,
        negotiatedPrice: line.negotiatedPrice,
        totalNetValue: line.totalNetValue,
        notes: line.notes,
        itemSequence: line.itemSequence,
        nomusItemStatusRaw: line.nomusItemStatusRaw,
        nomusItemStatusNormalized: line.nomusItemStatusNormalized,
        nomusQuantityFulfilled: line.nomusQuantityFulfilled,
        nomusQuantityPending: line.nomusQuantityPending,
        nomusIsCanceled: line.nomusIsCanceled,
        nomusIsCut: line.nomusIsCut,
        nomusRawItem: line.item,
      }));

      let salesOrderId: string;
      let existingForHeader: NomusSyncExistingSalesOrder | null = existingMatch;

      if (existingMatch) {
        const existingFull = await tx.salesOrder.findUnique({
          where: { id: existingMatch.id },
          select: {
            id: true,
            orderCode: true,
            externalSalesOrderId: true,
            externalSalesOrderCode: true,
            sourceSystem: true,
            totalNetValue: true,
            totalItems: true,
            totalCost: true,
            totalMarginValue: true,
            totalMarginPerc: true,
            sourcePresenceStatus: true,
          },
        });
        existingForHeader = existingFull;

        if (
          existingFull?.sourcePresenceStatus === "MISSING_CANDIDATE" ||
          existingFull?.sourcePresenceStatus === "MISSING_CONFIRMED"
        ) {
          reactivatedSalesOrderIds.push(existingMatch.id);
        }

        const existingItems = await tx.salesOrderItem.findMany({
          where: { salesOrderId: existingMatch.id },
          select: {
            id: true,
            productId: true,
            externalProductId: true,
            proposalItemId: true,
            skuSnapshot: true,
            productNameSnapshot: true,
            unit: true,
            unitCost: true,
            totalCost: true,
            marginValue: true,
            marginPerc: true,
            quantity: true,
            negotiatedPrice: true,
            totalNetValue: true,
            notes: true,
            nomusItemExternalId: true,
            nomusItemStatusNormalized: true,
            nomusIsCanceled: true,
            nomusIsStale: true,
            nomusIsCut: true,
            nomusMatchConfidence: true,
          },
        });

        const headerData = mergeNomusSyncHeaderPreservingHistoricalCosts(
          nomusHeader,
          existingFull ?? existingMatch,
          true
        );

        const updatedOrder = await tx.salesOrder.update({
          where: { id: existingMatch.id },
          data: headerData,
          select: { id: true },
        });
        salesOrderId = updatedOrder.id;
        updated += 1;

        const itemPlan = buildNomusSyncItemWritePlan({
          salesOrderId,
          plannedLines,
          existingItems,
        });

        await applyNomusSyncItemWritePlan(tx, itemPlan);
        itemsUpdated += itemPlan.upserts.length + itemPlan.staleUpdates.length;
        itemsCreated += itemPlan.creates.length;
        itemsStale += itemPlan.staleUpdates.length;
      } else {
        const createdOrder = await tx.salesOrder.create({
          data: nomusHeader,
          select: { id: true },
        });
        salesOrderId = createdOrder.id;
        created += 1;

        if (plan.lines.length > 0) {
          const itemPlan = buildNomusSyncItemWritePlan({
            salesOrderId,
            plannedLines,
            existingItems: [],
          });
          await applyNomusSyncItemWritePlan(tx, itemPlan);
          itemsCreated += itemPlan.creates.length;
        }
      }

      if (existingForHeader) {
        existingIndexes.byExternalId.set(plan.externalSalesOrderId, {
          ...existingForHeader,
          orderCode: plan.codigoPedido,
          externalSalesOrderId: plan.externalSalesOrderId,
          externalSalesOrderCode: plan.codigoPedido,
          sourceSystem: SOURCE_SYSTEM,
          totalNetValue: decimalString(totalNetValue),
          totalItems: plan.lines.length,
        });
      }

      await upsertSalesOrderNfeLinksForOrder(
        {
          id: salesOrderId,
          externalSalesOrderId: plan.externalSalesOrderId,
          externalSalesOrderCode: plan.codigoPedido,
          orderCode: plan.codigoPedido,
          nomusRawResponse: pedido,
        },
        tx
      );

      affectedSalesOrderIds.push(salesOrderId);
    });
  }

  return {
    created,
    updated,
    itemsCreated,
    itemsUpdated,
    itemsStale,
    affectedSalesOrderIds: [...new Set(affectedSalesOrderIds)],
    reactivatedSalesOrderIds: [...new Set(reactivatedSalesOrderIds)],
  };
}

function parseIsoDateBound(value: string, endOfDay: boolean): Date {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    if (endOfDay) return new Date(Date.UTC(yyyy, mm - 1, dd, 23, 59, 59, 999));
    return new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0, 0));
  }
  const iso = new Date(value);
  return Number.isNaN(iso.getTime()) ? new Date() : iso;
}

function resolveSyncCoverageBounds(
  strategy: NomusSalesOrdersSyncStrategy,
  emissaoWindow: NomusSalesOrdersEmissaoWindow | null
): { from: Date; to: Date; fromIso: string; toIso: string } {
  if (strategy === "recent-window" && emissaoWindow) {
    return {
      from: emissaoWindow.startDate,
      to: emissaoWindow.endDate,
      fromIso: formatNomusPedidoDateBr(emissaoWindow.startDate),
      toIso: formatNomusPedidoDateBr(emissaoWindow.endDate),
    };
  }
  const fromRaw = getEnvOrDefault("NOMUS_PEDIDO_DATA_EMISSAO_INICIAL", "01/01/2023");
  const toRaw = getEnvOrDefault("NOMUS_PEDIDO_DATA_EMISSAO_FINAL", "31/12/2030");
  return {
    from: parseIsoDateBound(fromRaw, false),
    to: parseIsoDateBound(toRaw, true),
    fromIso: fromRaw,
    toIso: toRaw,
  };
}

/**
 * Implementação canônica de Pedidos (SYNC-07).
 * Chamada apenas via runNomusSalesOrdersSync — não invocar regras paralelas.
 */
export async function executeNomusSalesOrdersSync(
  execution?: NomusCanonicalSyncExecution
): Promise<NomusCanonicalSyncDelegateResult> {
  const startedAt = Date.now();
  syncHttpStats.http429Count = 0;
  const isApply =
    execution?.mode === "apply" ||
    (execution == null && process.argv.includes("--apply"));
  const targetOrderCode =
    execution?.targetOrderCode ?? parseCliArg("orderCode");
  const strategy: NomusSalesOrdersSyncStrategy =
    execution != null
      ? (execution.legacyStrategyLabel as NomusSalesOrdersSyncStrategy)
      : parseCliStrategy();
  const referenceNow = new Date();
  const hooksAlreadyRan: string[] = [];

  const nomusBaseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);

  timeLog("INICIO fetchAllNomusPedidos");
  const fetchResult = await fetchAllNomusPedidos(nomusBaseUrl, strategy, referenceNow);
  let pedidos = fetchResult.pedidos;

  if (targetOrderCode) {
    const targetKey = canonicalNomusOrderCodeKey(targetOrderCode);
    const alreadyInBatch = targetKey
      ? pedidos.some(
          (row) => canonicalNomusOrderCodeKey(String(row.codigoPedido ?? "")) === targetKey
        )
      : false;

    if (!alreadyInBatch) {
      const targeted = await fetchNomusPedidoByOrderCode(nomusBaseUrl, targetOrderCode);
      if (targeted) {
        pedidos = [targeted, ...pedidos.filter((row) => !pedidoAlreadyInList([targeted], row))];
        console.warn(
          `[nomus-sales-orders-v1] --orderCode=${targetOrderCode}: pedido incluído via busca direcionada.`
        );
      } else {
        console.warn(
          `[nomus-sales-orders-v1] --orderCode=${targetOrderCode}: pedido não encontrado no Nomus.`
        );
      }
    }

    if (targetKey) {
      pedidos = pedidos.filter(
        (row) => canonicalNomusOrderCodeKey(String(row.codigoPedido ?? "")) === targetKey
      );
    }
  }

  timeLog(`FIM fetchAllNomusPedidos total=${pedidos.length}`);
  const itemStatusDistribution = collectNomusItemStatuses(pedidos);

  const externalCustomerIds = pedidos
    .map((p) => toInt(p.idPessoaCliente))
    .filter((id): id is number => id != null);
  timeLog(`INICIO mapPessoaBridgeByExternalCustomerId totalIds=${externalCustomerIds.length}`);
  const customerBridge = await mapPessoaBridgeByExternalCustomerId(nomusBaseUrl, externalCustomerIds);
  timeLog(`FIM mapPessoaBridgeByExternalCustomerId resolved=${customerBridge.size}`);

  const idProdutos = new Set<number>();
  for (const pedido of pedidos) {
    const items = Array.isArray(pedido.itensPedido) ? pedido.itensPedido : [];
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const idp = toInt((raw as JsonObject).idProduto);
      if (idp != null) idProdutos.add(idp);
    }
  }

  const externalProductIds = [...idProdutos];

  timeLog(`INICIO loadProductMapFromProposalItems totalIds=${externalProductIds.length}`);
  const proposalProductMap = await loadProductMapFromProposalItems(externalProductIds);
  timeLog(`FIM loadProductMapFromProposalItems resolved=${proposalProductMap.size}`);

  const idsMissingLocalProduct = externalProductIds.filter((id) => !proposalProductMap.has(id));

  timeLog(
    `INICIO fetchNomusProductById sequencial missingLocal=${idsMissingLocalProduct.length}/${externalProductIds.length}`
  );
  const nomusProductById = new Map<number, JsonObject>();
  let productFetchCount = 0;
  for (const id of idsMissingLocalProduct) {
    productFetchCount += 1;
    if (
      productFetchCount === 1 ||
      productFetchCount % 25 === 0 ||
      productFetchCount === idsMissingLocalProduct.length
    ) {
      timeLog(`fetchNomusProductById progresso=${productFetchCount}/${idsMissingLocalProduct.length}`);
    }
    const prod = await fetchNomusProductById(nomusBaseUrl, id, maxRetries, retryBaseMs);
    if (prod) nomusProductById.set(id, prod);
  }
  timeLog(`FIM fetchNomusProductById sequencial resolved=${nomusProductById.size}`);

  const skus = new Set<string>();
  for (const prod of nomusProductById.values()) {
    const sku = nomusProductSku(prod);
    if (sku) skus.add(sku);
  }

  timeLog(`INICIO prisma.product.findMany skus=${skus.size}`);
  const products = await prisma.product.findMany({
    where: { sku: { in: [...skus] } },
    select: { id: true, sku: true, name: true },
  });
  const productBySku = new Map(products.map((p) => [p.sku, { id: p.id, sku: p.sku, name: p.name }]));

  for (const [externalProductId, localProduct] of proposalProductMap.entries()) {
    productBySku.set(localProduct.sku, localProduct);
    nomusProductById.set(externalProductId, {
      id: externalProductId,
      codigo: localProduct.sku,
      nome: localProduct.name,
      ativo: true,
    });
  }

  const productById = new Map([...productBySku.values()].map((p) => [p.id, { id: p.id, sku: p.sku, name: p.name }]));

  timeLog(`FIM prisma.product.findMany total=${productBySku.size} localCache=${proposalProductMap.size}`);

  timeLog("INICIO loadProposalItemIndex");
  const proposalIndex = await loadProposalItemIndex();
  timeLog(`FIM loadProposalItemIndex keys=${proposalIndex.size}`);

  const eligible: EligibleSalesOrderPlan[] = [];
  const blocked: BlockedSalesOrder[] = [];

  for (const pedido of pedidos) {
    const { eligible: el, blocked: bl } = analyzeOrder(
      pedido,
      customerBridge,
      proposalIndex,
      nomusProductById,
      productBySku,
      productById
    );
    if (el) eligible.push(el);
    if (bl) blocked.push(bl);
  }

  timeLog(`FIM analyzeOrder loop eligible=${eligible.length} blocked=${blocked.length}`);

  const proposalIdsForSo = [
    ...new Set(
      eligible
        .map((e) => e.proposalId)
        .filter((x): x is string => typeof x === "string" && x.length > 0)
    ),
  ];
  const salesOrdersForProposals =
    proposalIdsForSo.length === 0
      ? []
      : await prisma.salesOrder.findMany({
          where: { proposalId: { in: proposalIdsForSo } },
          select: { id: true, proposalId: true, externalSalesOrderId: true, sourceSystem: true },
        });
  const salesOrderByProposalId = new Map(salesOrdersForProposals.map((s) => [s.proposalId, s]));

  const eligibleAfterProposalSlot: EligibleSalesOrderPlan[] = [];
  for (const plan of eligible) {
    if (!plan.proposalId) {
      eligibleAfterProposalSlot.push(plan);
      continue;
    }

    const existingSo = salesOrderByProposalId.get(plan.proposalId);
    if (!existingSo) {
      eligibleAfterProposalSlot.push(plan);
      continue;
    }

    const sameNomusKey =
      existingSo.sourceSystem === SOURCE_SYSTEM &&
      existingSo.externalSalesOrderId === plan.externalSalesOrderId;

    if (sameNomusKey) {
      eligibleAfterProposalSlot.push(plan);
      continue;
    }

    // Como proposalId agora é opcional, não bloqueia o pedido por colisão de proposta.
    // Mantém o pedido como espelho do Nomus e remove apenas o vínculo ambíguo com a proposta.
    eligibleAfterProposalSlot.push({
      ...plan,
      proposalId: null,
    });
  }
  eligible.length = 0;
  eligible.push(...eligibleAfterProposalSlot);

  const blockedReasons: Record<string, number> = {};
  for (const b of blocked) {
    for (const r of b.reasons) {
      blockedReasons[r] = (blockedReasons[r] ?? 0) + 1;
    }
  }

  timeLog("INICIO runDry");
  const preview = await runDry(eligible);
  timeLog("FIM runDry");

  const criticalSchemaNote =
    "SalesOrder.proposalId e SalesOrderItem.proposalItemId são opcionais. Pedidos criados diretamente no Nomus podem ser espelhados sem vínculo com proposta; quando o vínculo com Proposal/ProposalItem for único e seguro, ele será preenchido. Produto inativo no Nomus não bloqueia pedido histórico se o SKU for resolvido localmente. Vendedor comissionável: apenas idPessoaVendedor/nomeVendedor do pedido Nomus (SalesOrder.externalSellerId + nomusSellerName). Responsável comercial CRM não é usado para comissão.";

  const result: DryRunResult = {
    totalRead: pedidos.length,
    eligibleCount: eligible.length,
    blockedCount: blocked.length,
    blockedReasons,
    nomusItemStatusDistribution: itemStatusDistribution,
    createsPreview: preview.createsPreview,
    updatesPreview: preview.updatesPreview,
    changedOrders: preview.changedOrders,
    changedHeaderTotals: preview.changedHeaderTotals,
    changedItems: preview.changedItems,
    blockedPreview: blocked.slice(0, 50),
    criticalSchemaNote,
  };

  const coverage = resolveSyncCoverageBounds(strategy, fetchResult.meta.emissaoWindow);
  const completeness = assessSalesOrderSyncPayloadCompleteness({
    strategy,
    startPage: fetchResult.meta.startPage,
    completedWindow: fetchResult.meta.completedWindow,
    stoppedBecauseEmpty: fetchResult.meta.stoppedBecauseEmpty,
    stoppedBecauseNoNext: fetchResult.meta.stoppedBecauseNoNext,
    stoppedBecauseWindowExceeded: fetchResult.meta.stoppedBecauseWindowExceeded,
    http429Count: syncHttpStats.http429Count,
  });
  const canonicalAllowsMissing =
    (process.env.NOMUS_CANONICAL_ALLOW_MISSING_DETECTION ?? "").trim() === "1";
  const reconcileEnabled =
    isSalesOrderAbsenceReconcileEnabled() &&
    (execution != null
      ? execution.allowMissingDetection
      : canonicalAllowsMissing || strategy === "full-reconciliation");
  // RECENT_WINDOW: nunca ausência (contrato SYNC-07 / SYNC-04).
  const reconcileEnabledFinal =
    strategy === "recent-window" ? false : reconcileEnabled;
  const scope = buildSalesOrderSyncReconciliationScope({
    strategy,
    fromIso: coverage.fromIso,
    toIso: coverage.toIso,
  });

  const lock = acquireSalesOrderReconcileLock({
    mode: isApply ? "apply" : "preview",
  });
  if (!lock.ok) {
    if (lock.code === "LOCK_HELD") {
      return {
        status: "SKIPPED_LOCKED",
        message: lock.message,
        payloadComplete: null,
        hooksAlreadyRan: [],
      };
    }
    throw new Error("Não foi possível adquirir lock de reconciliação de Pedidos.");
  }

  let sourceSyncRunId: string | null = null;
  let lifecycleApplied = 0;
  let directedConfirmPreview: ReturnType<
    typeof planDirectedSalesOrderAbsenceConfirmation
  > = null;
  let reconciliationPlan = buildSalesOrderSourceReconciliationPlan({
    strategy,
    scope,
    completeness,
    reconciliationEnabled: false,
    foundPedidos: [],
    localRecords: [],
    executedAt: new Date(),
    mode: isApply ? "apply" : "preview",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let applied: any = null;

  try {
    if (isApply) {
      const run = await createSalesOrderSourceSyncRun({
        prisma,
        strategy,
        scope: scope as unknown as Record<string, unknown>,
        startedAt: new Date(startedAt),
        coveredFrom: coverage.from,
        coveredTo: coverage.to,
      });
      sourceSyncRunId = run.id;
    }

    const lifecycleLocals: SalesOrderLifecycleLocalSnapshot[] =
      await loadSalesOrderLifecycleLocals({
        prisma,
        issueDateFrom: coverage.from,
        issueDateTo: coverage.to,
        orderCode: targetOrderCode,
      });

    const foundPedidos = pedidos
      .map((p) => {
        const id = toInt(p.id);
        if (id == null) return null;
        return {
          externalSalesOrderId: id,
          payloadHash: stableNomusSalesOrderPayloadHash(p),
        };
      })
      .filter((row): row is { externalSalesOrderId: number; payloadHash: string } => row != null);

    // Direcionado: --orderCode ausente no Nomus → confirma só esse candidato.
    if (targetOrderCode && foundPedidos.length === 0 && lifecycleLocals.length === 1) {
      directedConfirmPreview = planDirectedSalesOrderAbsenceConfirmation({
        local: lifecycleLocals[0]!,
        scope,
        directedFound: false,
        executedAt: new Date(),
        runId: sourceSyncRunId,
        mode: isApply ? "apply" : "preview",
      });
    }

    reconciliationPlan = buildSalesOrderSourceReconciliationPlan({
      strategy,
      scope,
      completeness,
      reconciliationEnabled: reconcileEnabledFinal,
      foundPedidos,
      localRecords: lifecycleLocals,
      directedLookups:
        directedConfirmPreview != null
          ? [
              {
                externalSalesOrderId: Number(directedConfirmPreview.externalId),
                found: false,
              },
            ]
          : undefined,
      executedAt: new Date(),
      runId: sourceSyncRunId,
      runStatus:
        completeness.status === "COMPLETE" || strategy === "recent-window"
          ? "SUCCESS"
          : syncHttpStats.http429Count > 0
            ? "INCONCLUSIVE"
            : "INCONCLUSIVE",
      mode: isApply ? "apply" : "preview",
    });

    const orderCodeByExternalId = new Map(
      lifecycleLocals.map((l) => [String(l.externalSalesOrderId), l.orderCode] as const)
    );
    for (const p of pedidos) {
      const id = toInt(p.id);
      const code = asString(p.codigoPedido);
      if (id != null && code) orderCodeByExternalId.set(String(id), code);
    }

    const reconciliationPreview = summarizeSalesOrderReconciliationPreview(
      reconciliationPlan,
      completeness,
      orderCodeByExternalId
    );

    // Garante PD 02739 visível no preview quando presente no plano.
    const pilotInPreview =
      reconciliationPreview.missingCandidates.some(
        (r) =>
          r.externalId === String(SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId) ||
          r.orderCode === SALES_ORDER_PILOT_ABSENCE.orderCode
      ) ||
      reconciliationPreview.missingConfirmed.some(
        (r) =>
          r.externalId === String(SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId) ||
          r.orderCode === SALES_ORDER_PILOT_ABSENCE.orderCode
      );

    timeLog(isApply ? "INICIO runApply" : "SKIP runApply dry-run");
    const existingRowsForApply = await loadExistingSalesOrdersForNomusSync(eligible);
    const existingIndexes = indexExistingSalesOrdersByNomusKey(existingRowsForApply);
    applied = isApply
      ? await runApply(eligible, existingIndexes, {
          runId: sourceSyncRunId,
          executedAt: new Date(),
        })
      : null;
    timeLog(isApply ? "FIM runApply" : "FIM dry-run sem apply");

    // Ausências só em full-reconciliation (+ flag). recent-window nunca grava missing*.
    if (isApply && reconcileEnabledFinal && strategy === "full-reconciliation") {
      const absencePatches = [
        ...reconciliationPlan.missingCandidates,
        ...reconciliationPlan.missingConfirmed,
      ]
        .filter((item) => item.localId && item.lifecyclePatch)
        .map((item) => ({
          localId: item.localId as string,
          patch: item.lifecyclePatch!,
        }));

      if (
        directedConfirmPreview?.localId &&
        directedConfirmPreview.lifecyclePatch &&
        !absencePatches.some((p) => p.localId === directedConfirmPreview!.localId)
      ) {
        absencePatches.push({
          localId: directedConfirmPreview.localId,
          patch: directedConfirmPreview.lifecyclePatch,
        });
      }

      if (absencePatches.length > 0) {
        const { applied: n } = await applySalesOrderLifecyclePatches({
          prisma,
          patches: absencePatches,
        });
        lifecycleApplied = n;
      }
    }

    if (isApply && sourceSyncRunId) {
      await finishSalesOrderSourceSyncRun({
        prisma,
        runId: sourceSyncRunId,
        status:
          completeness.status === "COMPLETE" || strategy === "recent-window"
            ? "SUCCESS"
            : "INCONCLUSIVE",
        payloadComplete: completeness.payloadComplete,
        finishedAt: new Date(),
        counters: {
          pagesRead:
            fetchResult.meta.lastPageFetched - fetchResult.meta.startPage + 1,
          rowsRead: pedidos.length,
          createdCount: applied?.created ?? 0,
          updatedCount: applied?.updated ?? 0,
          unchangedCount: reconciliationPlan.counters.unchanged,
          missingCandidateCount: reconciliationPlan.counters.missingCandidates,
          missingConfirmedCount: reconciliationPlan.counters.missingConfirmed,
          reactivatedCount:
            (applied?.reactivatedSalesOrderIds.length ?? 0) ||
            reconciliationPlan.counters.reactivated,
          http429Count: syncHttpStats.http429Count,
          errors: 0,
        },
        summaryJson: {
          reconciliation: reconciliationPreview,
          pilotPd02739InPreview: pilotInPreview,
          lifecycleApplied,
        },
      });
    }

  console.log(
    JSON.stringify(
      {
        mode: isApply ? "apply" : "dry-run",
        syncStrategy: strategy,
        syncModeLabel: describeNomusSalesOrdersSyncMode(strategy),
        targetOrderCode: targetOrderCode ?? null,
        fetch: {
          emissaoWindow: fetchResult.meta.emissaoWindow
            ? {
                label: fetchResult.meta.emissaoWindow.label,
                startDate: formatNomusPedidoDateBr(fetchResult.meta.emissaoWindow.startDate),
                endDate: formatNomusPedidoDateBr(fetchResult.meta.emissaoWindow.endDate),
                windowMonths: fetchResult.meta.emissaoWindow.windowMonths,
                windowDays: fetchResult.meta.emissaoWindow.windowDays,
                dataEmissaoFilterApplied: fetchResult.meta.dataEmissaoFilterApplied,
                excludedOlderThanWindow: fetchResult.meta.excludedOlderThanWindow,
                stoppedBecauseWindowExceeded: fetchResult.meta.stoppedBecauseWindowExceeded,
              }
            : null,
          pagination: {
            startPage: fetchResult.meta.startPage,
            maxPages: fetchResult.meta.maxPages,
            lastPageFetched: fetchResult.meta.lastPageFetched,
            stoppedBecauseEmpty: fetchResult.meta.stoppedBecauseEmpty,
            stoppedBecauseNoNext: fetchResult.meta.stoppedBecauseNoNext,
            completedWindow: fetchResult.meta.completedWindow,
          },
        },
        summary: result,
        applied,
        sourceLifecycle: {
          runId: sourceSyncRunId,
          reconciliationEnabled: reconcileEnabledFinal,
          correlationId: execution?.correlationId ?? process.env.NOMUS_CANONICAL_CORRELATION_ID ?? null,
          sourceTrigger: execution?.sourceTrigger ?? process.env.NOMUS_CANONICAL_SOURCE_TRIGGER ?? null,
          fetchCompleteness: completeness,
          creates: reconciliationPreview.creates,
          updates: reconciliationPreview.updates,
          unchanged: reconciliationPreview.unchanged,
          missingCandidates: reconciliationPreview.missingCandidates,
          missingConfirmed: reconciliationPreview.missingConfirmed,
          reactivated: reconciliationPreview.reactivated,
          ignoredOutsideScope: reconciliationPreview.ignoredOutsideScope,
          counters: reconciliationPreview.counters,
          reasons: reconciliationPreview.reasons,
          absencesEvaluated: reconciliationPreview.absencesEvaluated,
          lifecycleApplied,
          dryRunWrites: false,
          pilot: {
            orderCode: SALES_ORDER_PILOT_ABSENCE.orderCode,
            externalSalesOrderId: SALES_ORDER_PILOT_ABSENCE.externalSalesOrderId,
            inPreview: pilotInPreview,
          },
          directedConfirm: directedConfirmPreview
            ? {
                externalId: directedConfirmPreview.externalId,
                action: directedConfirmPreview.action,
                reason: directedConfirmPreview.reason,
              }
            : null,
        },
        http429Count: syncHttpStats.http429Count,
        durationMs: Date.now() - startedAt,
        commercialNote:
          "SalesOrderItem.unitCost recebe preço unitário comercial Nomus — custo de produção é calculado apenas pelo motor de margem IndusCost.",
      },
      null,
      2
    )
  );

  if (isApply && applied?.affectedSalesOrderIds?.length) {
    // Hooks: uma vez por run (correlationId no env). Preview não chega aqui.
    hooksAlreadyRan.push("commissionMaterialization");
    await runCommissionMaterializationAfterNomusSync(
      prisma,
      buildNomusSyncMaterializationTrigger({
        source: "sales-orders",
        syncMode: "apply",
        salesOrderIds: applied.affectedSalesOrderIds,
      })
    );

    // Carteira vazia: preenche Responsável Comercial a partir do vendedor do pedido (não substitui).
    try {
      hooksAlreadyRan.push("crmCommercialOwnerAutoAssign");
      const ownerAssign = await autoAssignCommercialOwnersAfterNomusSync(
        prisma,
        applied.affectedSalesOrderIds
      );
      console.log(
        `[nomusSalesOrdersSyncV1] auto-assign comercial: assigned=${ownerAssign.assigned} skippedOwned=${ownerAssign.skippedAlreadyOwned} unmapped=${ownerAssign.skippedUnmapped} errors=${ownerAssign.errors}`
      );
    } catch (err) {
      console.error(
        "[nomusSalesOrdersSyncV1] auto-assign comercial falhou (sync segue):",
        err instanceof Error ? err.message : err
      );
    }
  }

  // OP-13: após apply de pedidos bem-sucedido → incremental de OP (uma vez; soft-fail).
  // Pedidos já sincronizados permanecem válidos se OP falhar / lock bloquear.
  // Não roda em dry-run. Nunca dispara backfill.
  if (isApply) {
    try {
      const affectedIds = applied?.affectedSalesOrderIds ?? [];
      const linked =
        affectedIds.length > 0
          ? await prisma.salesOrder.findMany({
              where: { id: { in: affectedIds } },
              select: { externalSalesOrderId: true },
            })
          : [];
      const salesOrderExternalIds = linked
        .map((row) => row.externalSalesOrderId)
        .filter((id): id is number => id != null && Number.isFinite(id) && id > 0);
      hooksAlreadyRan.push("productionOrdersAfterSalesOrders");
      const opResult = await runNomusProductionOrdersAfterSalesOrdersSync({
        prisma,
        salesOrderExternalIds,
      });
      console.log(
        `[nomusSalesOrdersSyncV1] ${formatProductionOrdersAfterSalesOrdersLogLine(opResult)}`
      );
      if (
        opResult.summary &&
        !opResult.skipped &&
        !opResult.summary.lockBlocked &&
        (opResult.summary.errors > 0 || (opResult.summary.exitCode ?? 0) !== 0)
      ) {
        console.error(
          `[nomusSalesOrdersSyncV1] production-orders incremental falhou (sync de pedidos permanece válido): errors=${opResult.summary.errors} exitCode=${opResult.summary.exitCode ?? 0}`
        );
      }
    } catch (err) {
      console.error(
        "[nomusSalesOrdersSyncV1] production-orders sync falhou (sync de pedidos segue):",
        err instanceof Error ? err.message : err
      );
    }

    // DS por idNfe dos vínculos SalesOrderNfeLink — antes do recompute do Kanban.
    // Soft-fail: pedidos/OP já gravados permanecem válidos.
    try {
      hooksAlreadyRan.push("stockDocumentsAfterSalesOrders");
      const dsResult = await runNomusStockDocumentsAfterSalesOrdersSync({
        prisma,
        salesOrderIds: applied?.affectedSalesOrderIds ?? [],
      });
      console.log(
        `[nomusSalesOrdersSyncV1] ${formatStockDocumentsAfterSalesOrdersLogLine(dsResult)}`
      );
      if (
        dsResult.sync &&
        !dsResult.skipped &&
        !dsResult.sync.lockBlocked &&
        dsResult.sync.errors > 0
      ) {
        console.error(
          `[nomusSalesOrdersSyncV1] stock-documents by-idNfe com falhas (sync de pedidos permanece válido): errors=${dsResult.sync.errors}`
        );
      }

      // Snapshot da DRE: Documento de Saída é fallback de itens do CMV — se o
      // sync pós-pedidos criou/alterou documentos, invalida (soft-fail).
      if (dsResult.sync && !dsResult.skipped && !dsResult.sync.lockBlocked) {
        const { markFinanceDreSnapshotsDirtyForStockDocumentChanges } = await import(
          "../src/lib/financeDreSnapshot.server.ts"
        );
        await markFinanceDreSnapshotsDirtyForStockDocumentChanges(prisma, {
          changedCount:
            (dsResult.sync.counters.documentsCreated ?? 0) +
            (dsResult.sync.counters.documentsUpdated ?? 0),
          reason: "stock-documents-after-sales-orders",
        });
      }
    } catch (err) {
      console.error(
        "[nomusSalesOrdersSyncV1] stock-documents sync falhou (sync de pedidos segue):",
        err instanceof Error ? err.message : err
      );
    }

    // OP-57: recomputa fluxo após persistência de pedidos (+ OP/DS pós-sync). Soft-fail.
    // Cobre também corte/atendimento/cancelamento gravados no apply de itens.
    try {
      hooksAlreadyRan.push("salesOrderFlowRecompute");
      await runSalesOrderFlowRecomputeAfterNomusSync(
        prisma,
        buildSalesOrderFlowRecomputeAfterSyncTrigger({
          source: "sales-orders",
          syncMode: "apply",
          salesOrderIds: applied?.affectedSalesOrderIds ?? [],
        })
      );
    } catch (err) {
      console.error(
        "[nomusSalesOrdersSyncV1] sales-order-flow recompute falhou (sync de pedidos segue):",
        err instanceof Error ? err.message : err
      );
    }

    // Cache dos gráficos da listagem Comercial > Pedidos (YoY + margem %):
    // recomputa os anos tocados pelos pedidos afetados. Soft-fail.
    try {
      hooksAlreadyRan.push("salesOrderResultChartsCache");
      const chartsCacheResult =
        await refreshSalesOrderResultChartsCacheAfterNomusSync(prisma, {
          salesOrderIds: applied?.affectedSalesOrderIds ?? [],
        });
      console.log(
        `[nomusSalesOrdersSyncV1] ${formatSalesOrderResultChartsCacheAfterSyncLog(chartsCacheResult)}`
      );
    } catch (err) {
      console.error(
        "[nomusSalesOrdersSyncV1] charts-cache pós-sync falhou (sync de pedidos segue):",
        err instanceof Error ? err.message : err
      );
    }
  }
  } finally {
    lock.release();
  }

  return {
    status: completeness.payloadComplete || strategy === "recent-window" ? "SUCCESS" : "INCONCLUSIVE",
    runId: sourceSyncRunId,
    payloadComplete: completeness.payloadComplete,
    hasRelevantChanges: Boolean(
      (applied?.created ?? 0) +
        (applied?.updated ?? 0) +
        (applied?.reactivatedSalesOrderIds?.length ?? 0)
    ),
    counters: {
      pagesRead: Math.max(
        0,
        fetchResult.meta.lastPageFetched - fetchResult.meta.startPage + 1
      ),
      rowsRead: pedidos.length,
      created: applied?.created ?? 0,
      updated: applied?.updated ?? 0,
      unchanged: reconciliationPlan.counters.unchanged,
      reactivated:
        (applied?.reactivatedSalesOrderIds.length ?? 0) ||
        reconciliationPlan.counters.reactivated,
      missingCandidates: reconciliationPlan.counters.missingCandidates,
      missingConfirmed: reconciliationPlan.counters.missingConfirmed,
      errors: 0,
      http429: syncHttpStats.http429Count,
    },
    hooksAlreadyRan,
  };
}

async function mainCli(): Promise<void> {
  const isApply = process.argv.includes("--apply");
  const targetOrderCode = parseCliArg("orderCode");
  const legacyStrategy = parseCliStrategy();
  const strategy = mapLegacySalesOrderStrategy(
    targetOrderCode ? "targeted_lookup" : legacyStrategy
  );
  const result = await runNomusSalesOrdersSync(
    {
      strategy,
      mode: isApply ? "apply" : "preview",
      sourceTrigger: resolveSourceTriggerFromEnv(),
      scope: { kind: "sales_orders_cli", strategy: legacyStrategy },
      targetOrderCode,
      allowMissingDetection: strategy !== "RECENT_WINDOW",
      allowMissingConfirmation:
        strategy === "TARGETED_LOOKUP" || strategy === "FULL_RECONCILIATION",
      requestedBy: "cli:nomusSalesOrdersSyncV1",
    },
    (execution) => executeNomusSalesOrdersSync(execution)
  );
  if (result.status === "SKIPPED_LOCKED") {
    console.warn(`[nomus-sales-orders-v1] ${result.message ?? "SKIPPED_LOCKED"}`);
    process.exitCode = 0;
    return;
  }
  if (!result.ok && result.status === "FAILED") {
    process.exitCode = 1;
  }
}

mainCli()
  .catch((err) => {
    console.error("[nomus-sales-orders-v1] erro:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
