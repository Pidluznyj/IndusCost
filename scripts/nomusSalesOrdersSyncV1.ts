import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { normalizeTaxId, parseNomusPtBrNumber } from "./nomusNumberParser.ts";

const prisma = new PrismaClient();

const SOURCE_SYSTEM = "NOMUS";
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_RETRY_BASE_MS = 700;

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
};

type EligibleSalesOrderPlan = {
  pedido: JsonObject;
  externalSalesOrderId: number;
  codigoPedido: string;
  proposalId: string | null;
  customerId: string;
  externalCustomerId: number | null;
  externalSellerId: number | null;
  responsible: string | null;
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
  updatesPreview: Array<{ externalSalesOrderId: number; codigoPedido: string; id: string }>;
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

async function fetchAllNomusPedidos(baseUrl: string): Promise<JsonObject[]> {
  const pageSize = Math.max(1, toInt(process.env.NOMUS_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE);
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);
  const startPage = Math.max(1, toInt(process.env.NOMUS_SALES_ORDERS_START_PAGE) ?? 1);
  const maxPages = Math.max(
    1,
    toInt(process.env.NOMUS_SALES_ORDERS_MAX_PAGES) ?? toInt(process.env.NOMUS_MAX_PAGES) ?? 200
  );
  const lastPage = startPage + maxPages - 1;

  const dataEmissaoInicial = getEnvOrDefault("NOMUS_PEDIDO_DATA_EMISSAO_INICIAL", "01/01/2023");
  const dataEmissaoFinal = getEnvOrDefault("NOMUS_PEDIDO_DATA_EMISSAO_FINAL", "31/12/2030");
  const dataVencimentoInicial = getEnvOrDefault("NOMUS_PEDIDO_DATA_VENCIMENTO_INICIAL", "01/01/2023");
  const dataVencimentoFinal = getEnvOrDefault("NOMUS_PEDIDO_DATA_VENCIMENTO_FINAL", "31/12/2030");

  const pedidos: JsonObject[] = [];
  let page = startPage;

  while (true) {
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

    if (arr.length === 0) break;

    pedidos.push(...arr);

    console.warn(
      `[nomus-sales-orders-v1] página ${page} lida com ${arr.length} pedidos; acumulado=${pedidos.length}.`
    );

    if (page >= lastPage) {
      console.warn(
        `[nomus-sales-orders-v1] limite de bloco atingido: startPage=${startPage}, maxPages=${maxPages}, lastPage=${lastPage}.`
      );
      break;
    }

    if (!hasNextPage(payload, page, pageSize, arr.length)) break;
    page += 1;
  }

  return pedidos;
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
  proposalResponsible: string | null;
};

type SellerResponsibleMap = Map<number, string>;

async function loadProposalItemIndex(): Promise<Map<string, ProposalItemJoin[]>> {
  const rows = await prisma.proposalItem.findMany({
    where: { externalProductId: { not: null } },
    select: {
      id: true,
      proposalId: true,
      productId: true,
      externalProductId: true,
      Proposal: { select: { customerId: true, responsible: true } },
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
      proposalResponsible:
        typeof r.Proposal.responsible === "string" && r.Proposal.responsible.trim()
          ? r.Proposal.responsible.trim()
          : null,
    };
    const k = `${r.Proposal.customerId}|${ext}`;
    const arr = index.get(k) ?? [];
    arr.push(entry);
    index.set(k, arr);
  }
  return index;
}

async function loadSellerResponsibleMap(): Promise<SellerResponsibleMap> {
  const rows = await prisma.proposal.findMany({
    where: {
      sourceSystem: SOURCE_SYSTEM,
      externalSellerId: { not: null },
      responsible: { not: null },
    },
    select: {
      externalSellerId: true,
      responsible: true,
      updatedAt: true,
    },
    orderBy: [{ externalSellerId: "asc" }, { updatedAt: "desc" }],
  });

  const map: SellerResponsibleMap = new Map();

  for (const row of rows) {
    const sellerId = row.externalSellerId;
    const responsible =
      typeof row.responsible === "string" && row.responsible.trim()
        ? row.responsible.trim()
        : null;

    if (sellerId == null || !responsible) continue;
    if (!map.has(sellerId)) map.set(sellerId, responsible);
  }

  return map;
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
  productById: Map<string, { id: string; sku: string; name: string }>,
  sellerResponsibleMap: SellerResponsibleMap
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
  const externalSellerId = toInt(pedido.idPessoaVendedor);
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
  let fallbackProposalResponsible: string | null = null;

  for (const item of itemsRaw) {
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

      if (!fallbackProposalResponsible && candidates[0].proposalResponsible) {
        fallbackProposalResponsible = candidates[0].proposalResponsible;
      }

      resolvedLines.push({
        item,
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
      });
      lineReasons.push([]);
      continue;
    }

    if (localProduct) {
      resolvedLines.push({
        item,
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
      codigoPedido: codigoPedido ?? `NOMUS-ORDER-${externalSalesOrderId}`,
      proposalId: singleProposalId,
      customerId: customerId!,
      externalCustomerId: idPessoaCliente,
      externalSellerId,
      responsible:
        (externalSellerId != null ? sellerResponsibleMap.get(externalSellerId) ?? null : null) ??
        fallbackProposalResponsible,
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

async function runDry(eligible: EligibleSalesOrderPlan[]): Promise<Pick<DryRunResult, "createsPreview" | "updatesPreview">> {
  const extIds = eligible.map((e) => e.externalSalesOrderId);
  const existing =
    extIds.length === 0
      ? []
      : await prisma.salesOrder.findMany({
          where: {
            sourceSystem: SOURCE_SYSTEM,
            externalSalesOrderId: { in: extIds },
          },
          select: { id: true, externalSalesOrderId: true, orderCode: true },
        });

  const byExt = new Map<number, { id: string; orderCode: string }>();
  for (const row of existing) {
    if (row.externalSalesOrderId == null) continue;
    byExt.set(row.externalSalesOrderId, { id: row.id, orderCode: row.orderCode });
  }

  const createsPreview: DryRunResult["createsPreview"] = [];
  const updatesPreview: DryRunResult["updatesPreview"] = [];

  for (const plan of eligible) {
    const cur = byExt.get(plan.externalSalesOrderId);
    if (!cur) {
      createsPreview.push({
        externalSalesOrderId: plan.externalSalesOrderId,
        codigoPedido: plan.codigoPedido,
        proposalId: plan.proposalId,
      });
    } else {
      updatesPreview.push({
        externalSalesOrderId: plan.externalSalesOrderId,
        codigoPedido: plan.codigoPedido,
        id: cur.id,
      });
    }
  }

  return {
    createsPreview: createsPreview.slice(0, 50),
    updatesPreview: updatesPreview.slice(0, 50),
  };
}


async function runApply(eligible: EligibleSalesOrderPlan[]): Promise<{ created: number; updated: number; itemsCreated: number }> {
  let created = 0;
  let updated = 0;
  let itemsCreated = 0;

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
      const externalCompanyId = toInt(pedido.idEmpresa);

      const existing = await tx.salesOrder.findFirst({
        where: {
          OR: [
            { sourceSystem: SOURCE_SYSTEM, externalSalesOrderId: plan.externalSalesOrderId },
            { orderCode: plan.codigoPedido },
          ],
        },
        select: { id: true },
      });

      const baseData = {
        proposalId: plan.proposalId,
        sourceSystem: SOURCE_SYSTEM,
        externalSalesOrderId: plan.externalSalesOrderId,
        externalSalesOrderCode: plan.codigoPedido,
        orderCode: plan.codigoPedido,
        customerId: plan.customerId,
        externalCustomerId: plan.externalCustomerId,
        responsible: plan.responsible,
        externalSellerId,
        companyIssuer: externalCompanyId != null ? String(externalCompanyId) : null,
        externalCompanyId,
        status: "SENT_TO_NOMUS" as any,
        issueDate,
        expectedDeliveryDate,
        paymentTerms: asString(pedido.condicaoPagamentoTexto),
        paymentMethod: toInt(pedido.idFormaPagamento) != null ? String(toInt(pedido.idFormaPagamento)) : null,
        freightCondition: asString(pedido.modalidadeTransporte) ?? (toInt(pedido.modalidadeTransporte) != null ? String(toInt(pedido.modalidadeTransporte)) : null),
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
      };

      let salesOrderId: string;

      if (existing) {
        const updatedOrder = await tx.salesOrder.update({
          where: { id: existing.id },
          data: baseData,
          select: { id: true },
        });
        salesOrderId = updatedOrder.id;
        await tx.salesOrderItem.deleteMany({ where: { salesOrderId } });
        updated += 1;
      } else {
        const createdOrder = await tx.salesOrder.create({
          data: baseData,
          select: { id: true },
        });
        salesOrderId = createdOrder.id;
        created += 1;
      }

      if (plan.lines.length > 0) {
        await tx.salesOrderItem.createMany({
          data: plan.lines.map((line) => ({
            salesOrderId,
            proposalItemId: line.proposalItemId,
            productId: line.productId,
            externalProductId: line.externalProductId,
            skuSnapshot: line.skuSnapshot,
            productNameSnapshot: line.productNameSnapshot,
            quantity: decimalString(line.quantity),
            unit: line.unit,
            unitCost: decimalString(0),
            negotiatedPrice: decimalString(line.negotiatedPrice),
            totalNetValue: decimalString(line.totalNetValue),
            totalCost: decimalString(0),
            marginValue: decimalString(line.totalNetValue),
            marginPerc: decimalString(line.totalNetValue > 0 ? 100 : 0),
            notes: line.notes,
          })),
        });
        itemsCreated += plan.lines.length;
      }
    });
  }

  return { created, updated, itemsCreated };
}

async function main(): Promise<void> {
  const isApply = process.argv.includes("--apply");

  const nomusBaseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);

  timeLog("INICIO fetchAllNomusPedidos");
  const pedidos = await fetchAllNomusPedidos(nomusBaseUrl);
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

  timeLog("INICIO loadSellerResponsibleMap");
  const sellerResponsibleMap = await loadSellerResponsibleMap();
  timeLog(`FIM loadSellerResponsibleMap sellers=${sellerResponsibleMap.size}`);

  const eligible: EligibleSalesOrderPlan[] = [];
  const blocked: BlockedSalesOrder[] = [];

  for (const pedido of pedidos) {
    const { eligible: el, blocked: bl } = analyzeOrder(
      pedido,
      customerBridge,
      proposalIndex,
      nomusProductById,
      productBySku,
      productById,
      sellerResponsibleMap
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
    "SalesOrder.proposalId e SalesOrderItem.proposalItemId são opcionais. Pedidos criados diretamente no Nomus podem ser espelhados sem vínculo com proposta; quando o vínculo com Proposal/ProposalItem for único e seguro, ele será preenchido. Produto inativo no Nomus não bloqueia pedido histórico se o SKU for resolvido localmente. SalesOrder.responsible é resolvido por Proposal.externalSellerId -> Proposal.responsible e, como fallback, por Proposal.responsible vinculada ao item.";

  const result: DryRunResult = {
    totalRead: pedidos.length,
    eligibleCount: eligible.length,
    blockedCount: blocked.length,
    blockedReasons,
    nomusItemStatusDistribution: itemStatusDistribution,
    createsPreview: preview.createsPreview,
    updatesPreview: preview.updatesPreview,
    blockedPreview: blocked.slice(0, 50),
    criticalSchemaNote,
  };

  timeLog(isApply ? "INICIO runApply" : "SKIP runApply dry-run");
  const applied = isApply ? await runApply(eligible) : null;
  timeLog(isApply ? "FIM runApply" : "FIM dry-run sem apply");

  console.log(
    JSON.stringify(
      {
        mode: isApply ? "apply" : "dry-run",
        summary: result,
        applied,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error("[nomus-sales-orders-v1] erro:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
