import "dotenv/config";
import { PrismaClient } from "@prisma/client";
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
  | "PROPOSAL_ITEM_REQUIRED_BY_SCHEMA";

type BlockedSalesOrder = {
  externalSalesOrderId: number;
  codigoPedido: string | null;
  reasons: BlockReason[];
  missingCustomerExternalId: number | null;
  missingSkus: string[];
  inactiveNomusProductIds: number[];
  proposalItemDetail: string | null;
};

type EligibleSalesOrderPlan = {
  externalSalesOrderId: number;
  codigoPedido: string;
  proposalId: string;
  customerId: string;
  lineCount: number;
};

type DryRunResult = {
  totalRead: number;
  eligibleCount: number;
  blockedCount: number;
  blockedReasons: Record<string, number>;
  nomusItemStatusDistribution: Record<string, number>;
  createsPreview: Array<{ externalSalesOrderId: number; codigoPedido: string; proposalId: string }>;
  updatesPreview: Array<{ externalSalesOrderId: number; codigoPedido: string; id: string }>;
  blockedPreview: BlockedSalesOrder[];
  criticalSchemaNote: string;
};

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

  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso;

  const m = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!m) return null;
  const dd = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  const yyyy = Number.parseInt(m[3], 10);
  const hh = Number.parseInt(m[4] ?? "0", 10);
  const mi = Number.parseInt(m[5] ?? "0", 10);
  const ss = Number.parseInt(m[6] ?? "0", 10);
  const parsed = new Date(Date.UTC(yyyy, mm - 1, dd, hh, mi, ss));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
  const maxPages = Math.max(1, toInt(process.env.NOMUS_MAX_PAGES) ?? 200);

  const dataEmissaoInicial = getEnvOrDefault("NOMUS_PEDIDO_DATA_EMISSAO_INICIAL", "01/01/2023");
  const dataEmissaoFinal = getEnvOrDefault("NOMUS_PEDIDO_DATA_EMISSAO_FINAL", "31/12/2030");
  const dataVencimentoInicial = getEnvOrDefault("NOMUS_PEDIDO_DATA_VENCIMENTO_INICIAL", "01/01/2023");
  const dataVencimentoFinal = getEnvOrDefault("NOMUS_PEDIDO_DATA_VENCIMENTO_FINAL", "31/12/2030");

  const pedidos: JsonObject[] = [];
  let page = 1;

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

    if (page >= maxPages) {
      console.warn(`[nomus-sales-orders-v1] limite NOMUS_MAX_PAGES=${maxPages} atingido em pedidos.`);
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

  const localCustomers = await prisma.customer.findMany({
    select: { id: true, taxId: true },
  });
  const localByTaxId = new Map<string, string>();
  for (const customer of localCustomers) {
    const taxId = normalizeTaxId(customer.taxId);
    if (taxId) localByTaxId.set(taxId, customer.id);
  }

  const bridge = new Map<number, { taxId: string | null; customerId: string | null }>();
  const uniqueIds = [...new Set(externalCustomerIds)].filter((id) => id > 0);

  for (const idCliente of uniqueIds) {
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

function mergeReasons(set: Set<BlockReason>, reasons: BlockReason[]): void {
  for (const r of reasons) set.add(r);
}

function analyzeOrder(
  pedido: JsonObject,
  customerBridge: Map<number, { taxId: string | null; customerId: string | null }>,
  proposalIndex: Map<string, ProposalItemJoin[]>,
  nomusProductById: Map<number, JsonObject>,
  productBySku: Map<string, { id: string; sku: string; name: string }>
): { eligible: EligibleSalesOrderPlan | null; blocked: BlockedSalesOrder | null; lineReasons: BlockReason[][] } {
  const externalSalesOrderId = toInt(pedido.id);
  const codigoPedido = asString(pedido.codigoPedido);

  if (externalSalesOrderId == null) {
    return {
      eligible: null,
      blocked: {
        externalSalesOrderId: 0,
        codigoPedido,
        reasons: ["PROPOSAL_ITEM_REQUIRED_BY_SCHEMA"],
        missingCustomerExternalId: null,
        missingSkus: [],
        inactiveNomusProductIds: [],
        proposalItemDetail: "Pedido sem id numérico válido no payload Nomus.",
      },
      lineReasons: [],
    };
  }

  const idPessoaCliente = toInt(pedido.idPessoaCliente);
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
    mergeReasons(reasons, ["PROPOSAL_ITEM_REQUIRED_BY_SCHEMA"]);
    proposalItemDetail = "Pedido sem itensPedido: não há ProposalItem para satisfazer SalesOrderItem.proposalItemId (schema atual).";
  }

  const lineReasons: BlockReason[][] = [];
  const resolvedLines: Array<{ proposalItemId: string; proposalId: string; productId: string }> = [];

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
        lineR.add("INACTIVE_PRODUCT_NOMUS");
        inactiveNomusProductIds.add(idProduto);
        mergeReasons(reasons, ["INACTIVE_PRODUCT_NOMUS"]);
        lineReasons.push([...lineR]);
        continue;
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
      resolvedLines.push({
        proposalItemId: candidates[0].id,
        proposalId: candidates[0].proposalId,
        productId: candidates[0].productId,
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

      lineR.add("PROPOSAL_ITEM_REQUIRED_BY_SCHEMA");
      mergeReasons(reasons, ["PROPOSAL_ITEM_REQUIRED_BY_SCHEMA"]);
      proposalItemDetail =
        "Produto resolvido por SKU, porém não existe ProposalItem com externalProductId igual a idProduto para este cliente (SalesOrderItem.proposalItemId obrigatório).";
      lineReasons.push([...lineR]);
      continue;
    }

    lineR.add("PROPOSAL_ITEM_REQUIRED_BY_SCHEMA");
    mergeReasons(reasons, ["PROPOSAL_ITEM_REQUIRED_BY_SCHEMA"]);
    proposalItemDetail =
      "Múltiplos ProposalItem candidatos para o mesmo cliente e idProduto; não é possível escolher um vínculo único com segurança.";
    lineReasons.push([...lineR]);
  }

  const proposalIds = new Set(resolvedLines.map((l) => l.proposalId));
  if (itemsRaw.length > 0 && resolvedLines.length === itemsRaw.length && proposalIds.size > 1) {
    mergeReasons(reasons, ["PROPOSAL_ITEM_REQUIRED_BY_SCHEMA"]);
    proposalItemDetail =
      "Linhas do pedido mapeiam ProposalItems de propostas diferentes; SalesOrder exige um único proposalId.";
  }

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

  const singleProposalId = [...proposalIds][0]!;

  return {
    eligible: {
      externalSalesOrderId,
      codigoPedido: codigoPedido ?? `NOMUS-ORDER-${externalSalesOrderId}`,
      proposalId: singleProposalId,
      customerId: customerId!,
      lineCount: itemsRaw.length,
    },
    blocked: null,
    lineReasons,
  };
}

function collectNomusItemStatuses(pedidos: JsonObject[]): Record<string, number> {
  const dist: Record<string, number> = {};
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

async function main(): Promise<void> {
  const isApply = process.argv.includes("--apply");
  if (isApply) {
    console.error(
      "[nomus-sales-orders-v1] --apply está desabilitado: SalesOrder.proposalId é obrigatório e SalesOrderItem.proposalItemId é NOT NULL com FK para ProposalItem. Defina evolução de schema ou regra de vínculo antes do apply."
    );
    process.exitCode = 1;
    return;
  }

  const nomusBaseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);

  const pedidos = await fetchAllNomusPedidos(nomusBaseUrl);
  const itemStatusDistribution = collectNomusItemStatuses(pedidos);

  const externalCustomerIds = pedidos
    .map((p) => toInt(p.idPessoaCliente))
    .filter((id): id is number => id != null);
  const customerBridge = await mapPessoaBridgeByExternalCustomerId(nomusBaseUrl, externalCustomerIds);

  const idProdutos = new Set<number>();
  for (const pedido of pedidos) {
    const items = Array.isArray(pedido.itensPedido) ? pedido.itensPedido : [];
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const idp = toInt((raw as JsonObject).idProduto);
      if (idp != null) idProdutos.add(idp);
    }
  }

  const nomusProductById = new Map<number, JsonObject>();
  for (const id of idProdutos) {
    const prod = await fetchNomusProductById(nomusBaseUrl, id, maxRetries, retryBaseMs);
    if (prod) nomusProductById.set(id, prod);
  }

  const skus = new Set<string>();
  for (const prod of nomusProductById.values()) {
    const sku = nomusProductSku(prod);
    if (sku) skus.add(sku);
  }

  const products = await prisma.product.findMany({
    where: { sku: { in: [...skus] } },
    select: { id: true, sku: true, name: true },
  });
  const productBySku = new Map(products.map((p) => [p.sku, { id: p.id, sku: p.sku, name: p.name }]));

  const proposalIndex = await loadProposalItemIndex();

  const eligible: EligibleSalesOrderPlan[] = [];
  const blocked: BlockedSalesOrder[] = [];

  for (const pedido of pedidos) {
    const { eligible: el, blocked: bl } = analyzeOrder(
      pedido,
      customerBridge,
      proposalIndex,
      nomusProductById,
      productBySku
    );
    if (el) eligible.push(el);
    if (bl) blocked.push(bl);
  }

  const proposalIdsForSo = [...new Set(eligible.map((e) => e.proposalId))];
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

    blocked.push({
      externalSalesOrderId: plan.externalSalesOrderId,
      codigoPedido: plan.codigoPedido,
      reasons: ["PROPOSAL_ITEM_REQUIRED_BY_SCHEMA"],
      missingCustomerExternalId: null,
      missingSkus: [],
      inactiveNomusProductIds: [],
      proposalItemDetail: `A proposta ${plan.proposalId} já possui SalesOrder (${existingSo.id}); SalesOrder.proposalId é único no schema.`,
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

  const preview = await runDry(eligible);

  const criticalSchemaNote =
    "SalesOrder exige proposalId (@unique) ligado a Proposal; SalesOrderItem exige proposalItemId NOT NULL → importação direta de pedidos Nomus só é viável quando cada linha resolve exatamente um ProposalItem do mesmo cliente (externalProductId + cliente) e todas as linhas compartilham a mesma Proposal. Caso contrário o dry-run bloqueia com PROPOSAL_ITEM_REQUIRED_BY_SCHEMA.";

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

  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        summary: result,
        applied: null,
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
