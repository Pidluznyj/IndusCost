import "dotenv/config";
import { Prisma, PrismaClient, ProposalStatus } from "@prisma/client";
import { normalizeTaxId, parseNomusPtBrNumber } from "./nomusNumberParser.ts";
import { runProposalCommercialMarginRecalcAfterNomusSync } from "../src/lib/proposalCommercialMarginRecalcAfterNomusSync.server.ts";

const prisma = new PrismaClient();

const SOURCE_SYSTEM = "NOMUS";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_RETRY_BASE_MS = 700;
const KNOWN_MISSING_SKU = "660.01AA";

type JsonObject = Record<string, unknown>;

type ProposalPlan = {
  externalProposalId: number;
  externalProposalCode: string;
  title: string;
  customerId: string;
  customerExternalId: number;
  sellerExternalId: number | null;
  companyExternalId: number | null;
  movementTypeExternalId: number | null;
  openedAt: Date | null;
  status: ProposalStatus;
  header: JsonObject;
  totalItems: number;
  totalGrossValue: number;
  totalNetValue: number;
  totalTaxes: number;
  totalCost: number;
  totalMarginValue: number;
  totalMarginPerc: number;
  items: Array<{
    externalItemId: number | null;
    externalProductId: number | null;
    externalItemStatus: string | null;
    externalRawPayload: JsonObject;
    productId: string;
    quantity: number;
    unit: string | null;
    unitCost: number;
    suggestedPrice: number;
    negotiatedPrice: number;
    discountPerc: number;
    discountValue: number;
    marginValue: number;
    marginPerc: number;
    taxesPerc: number;
    taxesValue: number;
    commissionPerc: number;
    commissionValue: number;
    freightValue: number;
    notes: string | null;
  }>;
};

type ExistingProposalRef = {
  id: string;
  externalProposalId: number | null;
  externalProposalCode: string | null;
};

type BlockedProposal = {
  externalProposalId: number;
  externalProposalCode: string;
  reasons: string[];
  missingSkus: string[];
  missingCustomerExternalId: number | null;
};

type IgnoredProposal = {
  externalProposalId: number;
  externalProposalCode: string;
  reasons: string[];
  inactiveSkus: string[];
  /** Linhas brutas em itensProposta no Nomus (para métricas de dry-run). */
  rawLineItemCount?: number;
};

type DryRunResult = {
  totalRead: number;
  /** Soma de linhas em `itensProposta` no payload Nomus (após filtro de data). */
  totalItemsRead: number;
  eligibleCount: number;
  blockedCount: number;
  ignoredCount: number;
  ignoredInactiveSkuCount: number;
  /**
   * Soma de linhas brutas em `itensProposta` nas propostas ignoradas (só preenchido para ignoradas com `rawLineItemCount`;
   * hoje: SKU inativo no Nomus).
   */
  ignoredItemsCount: number;
  unresolvedCustomers: number;
  unresolvedProducts: number;
  missingSkus: string[];
  missingCustomers: number[];
  blockedProposalCodes: string[];
  ignoredProposalCodes: string[];
  inactiveSkus: string[];
  /** Propostas novas que seriam criadas no apply (total real). */
  createCount: number;
  /** Propostas existentes que seriam atualizadas no apply (total real). */
  updateCount: number;
  /**
   * Sempre null: o apply reescreve cabeçalho e substitui todos os ProposalItem (deleteMany + createMany).
   * Não há detecção de “sem mudança” sem diff profundo — fora do escopo deste dry-run.
   */
  noChangeCount: null;
  /** Soma de `plan.items.length` nas propostas elegíveis (linhas planejadas localmente). */
  totalItemsPlanned: number;
  /** Itens que seriam gravados em propostas novas (uma linha ProposalItem por item planejado). */
  createItemsCount: number;
  /**
   * Mesmo valor que `replaceItemsCount`: no apply, cada atualização apaga todos os itens e recria a partir do plano.
   */
  updateItemsCount: number;
  /** Itens que seriam recriados após deleteMany em propostas já existentes. */
  replaceItemsCount: number;
  preservedProposalsDueToSalesOrderLinkCount: number;
  preservedProposalItemsCount: number;
  preservedItemsDueToSalesOrderLinkCount: number;
  preservedDueToSalesOrderLinkPreview: Array<{
    externalProposalId: number;
    externalProposalCode: string;
    proposalId: string;
    linkedSalesOrderItemCount: number;
    existingItemsCount: number;
    plannedItemsCount: number;
  }>;
  itemsImpactNote: string;
  createsPreview: Array<{ externalProposalId: number; externalProposalCode: string }>;
  updatesPreview: Array<{ externalProposalId: number; externalProposalCode: string; id: string }>;
  firstCreatesPreview: Array<{ externalProposalId: number; externalProposalCode: string }>;
  firstUpdatesPreview: Array<{ externalProposalId: number; externalProposalCode: string; id: string }>;
  blockedPreview: BlockedProposal[];
  ignoredPreview: IgnoredProposal[];
  ignoredInactiveSkuPreview: Array<{
    externalProposalId: number;
    externalProposalCode: string;
    inactiveSkus: string[];
    reasons: string[];
    rawLineItemCount?: number;
  }>;
};

type ExistingProposalLinkStats = {
  existingItemsCount: number;
  linkedSalesOrderItemCount: number;
};

type ExistingProposalStatsRow = ExistingProposalRef & ExistingProposalLinkStats;

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
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

function parseDateOnlyUtc(input: string): Date | null {
  const raw = input.trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;

  const yyyy = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  const dd = Number.parseInt(m[3], 10);
  const parsed = new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0));

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getProposalStartDate(): Date | null {
  const raw = (process.env.NOMUS_PROPOSAL_START_DATE ?? "").trim();
  if (!raw) return null;

  const parsed = parseDateOnlyUtc(raw);
  if (!parsed) throw new Error(`NOMUS_PROPOSAL_START_DATE inválida: ${raw}. Use YYYY-MM-DD.`);

  return parsed;
}

function isProposalOnOrAfterStartDate(proposal: JsonObject, startDate: Date | null): boolean {
  if (!startDate) return true;

  const openedAt = parseNomusDateTime(proposal.dataHoraAbertura);
  if (!openedAt) return false;

  return openedAt.getTime() >= startDate.getTime();
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
    data.propostas,
    data.data,
    (data.data as Record<string, unknown> | undefined)?.propostas,
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

async function fetchAllNomusProposals(baseUrl: string): Promise<JsonObject[]> {
  const pageSize = Math.max(1, toInt(process.env.NOMUS_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE);
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);

  const proposals: JsonObject[] = [];
  let page = 1;

  const maxPages = Math.max(1, toInt(process.env.NOMUS_MAX_PAGES) ?? 200);

  while (true) {
    const url = buildNomusUrl(baseUrl, "propostas");
    url.searchParams.set("pagina", String(page));
    url.searchParams.set("tamanhoPagina", String(pageSize));

    const payload = await fetchJsonWithRetry(url, maxRetries, retryBaseMs);
    const arr = pickArrayFromUnknown(payload).filter(
      (entry): entry is JsonObject => !!entry && typeof entry === "object"
    );

    if (arr.length === 0) break;

    proposals.push(...arr);

    if (page >= maxPages) {
      console.warn(`[sync-v1] limite de segurança NOMUS_MAX_PAGES=${maxPages} atingido em propostas.`);
      break;
    }

    if (!hasNextPage(payload, page, pageSize, arr.length)) break;
    page += 1;
  }

  return proposals;
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

async function fetchAllNomusProducts(baseUrl: string): Promise<JsonObject[]> {
  const pageSize = Math.max(1, toInt(process.env.NOMUS_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE);
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);
  const maxPages = Math.max(1, toInt(process.env.NOMUS_PRODUCTS_MAX_PAGES) ?? 200);

  const products: JsonObject[] = [];
  let page = 1;

  while (true) {
    const url = buildNomusUrl(baseUrl, "produtos");
    url.searchParams.set("pagina", String(page));
    url.searchParams.set("tamanhoPagina", String(pageSize));

    const payload = await fetchJsonWithRetry(url, maxRetries, retryBaseMs);
    const arr = pickArrayFromUnknown(payload).filter(
      (entry): entry is JsonObject => !!entry && typeof entry === "object"
    );

    if (arr.length === 0) break;

    products.push(...arr);

    if (page >= maxPages) {
      console.warn(`[sync-v1] limite de segurança NOMUS_PRODUCTS_MAX_PAGES=${maxPages} atingido em produtos.`);
      break;
    }

    if (!hasNextPage(payload, page, pageSize, arr.length)) break;
    page += 1;
  }

  return products;
}

async function mapNomusProductActiveBySku(baseUrl: string): Promise<Map<string, boolean>> {
  const products = await fetchAllNomusProducts(baseUrl);
  const map = new Map<string, boolean>();

  for (const product of products) {
    const sku = nomusProductSku(product);
    if (!sku) continue;

    const active = nomusProductIsActive(product);
    const current = map.get(sku);

    // Se houver duplicidade, produto ativo prevalece sobre inativo.
    if (current === true) continue;
    map.set(sku, active);
  }

  return map;
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

async function fetchPricingSnapshotUnitCost(productId: string): Promise<number> {
  const baseUrl = (process.env.INDUSCOST_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
  const url = `${baseUrl}/api/products/${encodeURIComponent(productId)}/pricing-snapshot`;

  try {
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    if (!res.ok) return 0;

    const payload = (await res.json()) as JsonObject;
    const unitCost = Number(payload.unitCost);
    return Number.isFinite(unitCost) && unitCost > 0 ? unitCost : 0;
  } catch {
    return 0;
  }
}

async function mapLatestUnitCostByProductId(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map<string, number>();

  const logs = await prisma.costCalculationLog.findMany({
    where: { productId: { in: productIds } },
    select: {
      productId: true,
      totalCiu: true,
      totalCfc: true,
      totalCgt: true,
      calculatedAt: true,
    },
    orderBy: [{ productId: "asc" }, { calculatedAt: "desc" }],
  });

  const map = new Map<string, number>();
  for (const log of logs) {
    if (map.has(log.productId)) continue;
    const unitCost = Number(log.totalCiu) + Number(log.totalCfc) + Number(log.totalCgt);
    map.set(log.productId, Number.isFinite(unitCost) && unitCost > 0 ? unitCost : 0);
  }

  for (const productId of productIds) {
    const currentCost = map.get(productId) ?? 0;
    if (currentCost > 0) continue;

    const snapshotUnitCost = await fetchPricingSnapshotUnitCost(productId);
    if (snapshotUnitCost > 0) map.set(productId, snapshotUnitCost);
    else if (!map.has(productId)) map.set(productId, 0);
  }

  return map;
}

function toPrismaDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(Number.isFinite(value) ? value : 0);
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function buildPlans(): Promise<{
  plans: ProposalPlan[];
  blocked: BlockedProposal[];
  ignored: IgnoredProposal[];
  missingSkus: Set<string>;
  missingCustomers: Set<number>;
  inactiveSkus: Set<string>;
  rawProposalsCount: number;
  totalItemsRead: number;
}> {
  const nomusBaseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const proposalStartDate = getProposalStartDate();
  const rawProposalsAll = await fetchAllNomusProposals(nomusBaseUrl);
  const rawProposals = rawProposalsAll.filter((proposal) => isProposalOnOrAfterStartDate(proposal, proposalStartDate));
  const nomusProductActiveBySku = await mapNomusProductActiveBySku(nomusBaseUrl);

  const externalCustomerIds = rawProposals
    .map((proposal) => toInt(proposal.idCliente))
    .filter((id): id is number => id != null);
  const customerBridge = await mapPessoaBridgeByExternalCustomerId(nomusBaseUrl, externalCustomerIds);

  const allSkus = new Set<string>();
  for (const proposal of rawProposals) {
    const items = Array.isArray(proposal.itensProposta) ? proposal.itensProposta : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const sku = asString((item as JsonObject).codigoProduto);
      if (sku) allSkus.add(sku);
    }
  }

  const products = await prisma.product.findMany({
    where: { sku: { in: [...allSkus] } },
    select: { id: true, sku: true },
  });
  const productBySku = new Map(products.map((p) => [p.sku, p.id]));
  const unitCostByProductId = await mapLatestUnitCostByProductId(products.map((p) => p.id));

  const plans: ProposalPlan[] = [];
  const blocked: BlockedProposal[] = [];
  const ignored: IgnoredProposal[] = [];
  const missingSkus = new Set<string>();
  const missingCustomers = new Set<number>();
  const inactiveSkus = new Set<string>();
  let totalItemsRead = 0;

  for (const proposal of rawProposals) {
    const externalProposalId = toInt(proposal.id);
    if (externalProposalId == null) continue;

    const externalProposalCode =
      asString(proposal.proposta) ?? `NOMUS-${externalProposalId.toString().padStart(6, "0")}`;

    const externalCustomerId = toInt(proposal.idCliente);
    const bridge = externalCustomerId != null ? customerBridge.get(externalCustomerId) : undefined;
    const customerId = bridge?.customerId ?? null;

    const proposalItemsRaw = Array.isArray(proposal.itensProposta)
      ? (proposal.itensProposta.filter((x): x is JsonObject => !!x && typeof x === "object") as JsonObject[])
      : [];
    totalItemsRead += proposalItemsRaw.length;

    const unresolvedSkus = new Set<string>();
    const inactiveSkusInProposal = new Set<string>();
    const mappedItems: ProposalPlan["items"] = [];
    let totalCost = 0;

    for (const item of proposalItemsRaw) {
      const sku = asString(item.codigoProduto);

      if (sku && nomusProductActiveBySku.get(sku) === false) {
        inactiveSkusInProposal.add(sku);
        continue;
      }

      const productId = sku ? (productBySku.get(sku) ?? null) : null;
      if (!productId) {
        if (sku) unresolvedSkus.add(sku);
        continue;
      }

      const quantity = parseNomusPtBrNumber(item.qtde);
      const negotiatedPrice = parseNomusPtBrNumber(item.valorUnitario);
      const unitCost = unitCostByProductId.get(productId) ?? 0;
      const lineRevenue = negotiatedPrice * quantity;
      const lineCost = unitCost * quantity;
      const marginValue = lineRevenue - lineCost;
      const marginPerc = lineRevenue > 0 ? (marginValue / lineRevenue) * 100 : 0;
      totalCost += lineCost;

      mappedItems.push({
        externalItemId: toInt(item.id),
        externalProductId: toInt(item.idProduto),
        externalItemStatus: asString(item.status),
        externalRawPayload: item,
        productId,
        quantity,
        unit: asString(item.nomeUnidadeMedida),
        unitCost,
        suggestedPrice: negotiatedPrice,
        negotiatedPrice,
        discountPerc: 0,
        discountValue: 0,
        marginValue,
        marginPerc,
        taxesPerc: 0,
        taxesValue: 0,
        commissionPerc: 0,
        commissionValue: 0,
        freightValue: 0,
        notes: null,
      });
    }

    if (inactiveSkusInProposal.size > 0) {
      for (const sku of inactiveSkusInProposal) inactiveSkus.add(sku);

      ignored.push({
        externalProposalId,
        externalProposalCode,
        reasons: ["INACTIVE_PRODUCT_SKU_NOMUS"],
        inactiveSkus: [...inactiveSkusInProposal].sort(),
        rawLineItemCount: proposalItemsRaw.length,
      });
      continue;
    }

    const reasons: string[] = [];
    if (externalCustomerId == null || !customerId) {
      reasons.push("CUSTOMER_NOT_RESOLVED");
      if (externalCustomerId != null) missingCustomers.add(externalCustomerId);
    }
    if (unresolvedSkus.size > 0) reasons.push("MISSING_PRODUCT_SKU");

    for (const sku of unresolvedSkus) missingSkus.add(sku);

    if (reasons.length > 0) {
      blocked.push({
        externalProposalId,
        externalProposalCode,
        reasons,
        missingSkus: [...unresolvedSkus].sort(),
        missingCustomerExternalId: externalCustomerId,
      });
      continue;
    }

    const totalNetValue = parseNomusPtBrNumber(proposal.valorTotal);
    const totalGrossValueRaw = parseNomusPtBrNumber(proposal.valorTotalNfe);
    const totalGrossValue = totalGrossValueRaw > 0 ? totalGrossValueRaw : totalNetValue;
    const totalTaxes = parseNomusPtBrNumber(proposal.totalTributacao);
    const totalMarginValue = totalNetValue - totalCost;
    const totalMarginPerc = totalNetValue > 0 ? (totalMarginValue / totalNetValue) * 100 : 0;

    plans.push({
      externalProposalId,
      externalProposalCode,
      title: externalProposalCode,
      customerId,
      customerExternalId: externalCustomerId!,
      sellerExternalId: toInt(proposal.idVendedor),
      companyExternalId: toInt(proposal.idEmpresa),
      movementTypeExternalId: toInt(proposal.idTipoMovimentacao),
      openedAt: parseNomusDateTime(proposal.dataHoraAbertura),
      status: "SENT",
      header: proposal,
      totalItems: mappedItems.length,
      totalGrossValue,
      totalNetValue,
      totalTaxes,
      totalCost,
      totalMarginValue,
      totalMarginPerc,
      items: mappedItems,
    });
  }

  return {
    plans,
    blocked,
    ignored,
    missingSkus,
    missingCustomers,
    inactiveSkus,
    rawProposalsCount: rawProposals.length,
    totalItemsRead,
  };
}

async function runDry(
  plans: ProposalPlan[],
  blocked: BlockedProposal[],
  ignored: IgnoredProposal[],
  rawProposalsCount: number,
  totalItemsRead: number
): Promise<DryRunResult> {
  const existing = await prisma.proposal.findMany({
    where: {
      sourceSystem: SOURCE_SYSTEM,
      externalProposalId: { in: plans.map((p) => p.externalProposalId) },
    },
    select: { id: true, externalProposalId: true, externalProposalCode: true, items: { select: { id: true } } },
  });

  const proposalItemIdToProposalId = new Map<string, string>();
  for (const row of existing) {
    for (const item of row.items) proposalItemIdToProposalId.set(item.id, row.id);
  }
  const linkedCountByProposalId = new Map<string, number>();
  const proposalItemIds = [...proposalItemIdToProposalId.keys()];
  if (proposalItemIds.length > 0) {
    const linkedByItem = await prisma.salesOrderItem.groupBy({
      by: ["proposalItemId"],
      where: { proposalItemId: { in: proposalItemIds } },
      _count: { _all: true },
    });
    for (const row of linkedByItem) {
      const proposalItemId = row.proposalItemId;
      if (!proposalItemId) continue;
      const proposalId = proposalItemIdToProposalId.get(proposalItemId);
      if (!proposalId) continue;
      linkedCountByProposalId.set(proposalId, (linkedCountByProposalId.get(proposalId) ?? 0) + row._count._all);
    }
  }

  const existingByExternalId = new Map<number, ExistingProposalStatsRow>();
  for (const row of existing) {
    if (row.externalProposalId == null) continue;
    existingByExternalId.set(row.externalProposalId, {
      id: row.id,
      externalProposalId: row.externalProposalId,
      externalProposalCode: row.externalProposalCode,
      existingItemsCount: row.items.length,
      linkedSalesOrderItemCount: linkedCountByProposalId.get(row.id) ?? 0,
    });
  }

  const createsFull: DryRunResult["createsPreview"] = [];
  const updatesFull: DryRunResult["updatesPreview"] = [];
  let totalItemsPlanned = 0;
  let createItemsCount = 0;
  let replaceItemsCount = 0;
  let preservedProposalsDueToSalesOrderLinkCount = 0;
  let preservedProposalItemsCount = 0;
  let preservedItemsDueToSalesOrderLinkCount = 0;
  const preservedDueToSalesOrderLinkPreview: DryRunResult["preservedDueToSalesOrderLinkPreview"] = [];

  for (const plan of plans) {
    totalItemsPlanned += plan.items.length;
    const current = existingByExternalId.get(plan.externalProposalId);
    if (!current) {
      createItemsCount += plan.items.length;
      createsFull.push({
        externalProposalId: plan.externalProposalId,
        externalProposalCode: plan.externalProposalCode,
      });
      continue;
    }
    updatesFull.push({
      externalProposalId: plan.externalProposalId,
      externalProposalCode: plan.externalProposalCode,
      id: current.id,
    });
    if (current.linkedSalesOrderItemCount > 0) {
      preservedProposalsDueToSalesOrderLinkCount += 1;
      preservedProposalItemsCount += current.existingItemsCount;
      preservedItemsDueToSalesOrderLinkCount += current.linkedSalesOrderItemCount;
      if (preservedDueToSalesOrderLinkPreview.length < 30) {
        preservedDueToSalesOrderLinkPreview.push({
          externalProposalId: plan.externalProposalId,
          externalProposalCode: plan.externalProposalCode,
          proposalId: current.id,
          linkedSalesOrderItemCount: current.linkedSalesOrderItemCount,
          existingItemsCount: current.existingItemsCount,
          plannedItemsCount: plan.items.length,
        });
      }
      continue;
    }
    replaceItemsCount += plan.items.length;
  }

  const createCount = createsFull.length;
  const updateCount = updatesFull.length;
  const ignoredItemsCount = ignored.reduce((sum, row) => sum + (row.rawLineItemCount ?? 0), 0);
  const ignoredInactiveSkuRows = ignored.filter((b) => b.reasons.includes("INACTIVE_PRODUCT_SKU_NOMUS"));
  const ignoredInactiveSkuPreview = ignoredInactiveSkuRows.slice(0, 30).map((row) => ({
    externalProposalId: row.externalProposalId,
    externalProposalCode: row.externalProposalCode,
    inactiveSkus: row.inactiveSkus,
    reasons: row.reasons,
    rawLineItemCount: row.rawLineItemCount,
  }));

  const itemsImpactNote =
    "Propostas com itens vinculados a pedidos de venda não terão ProposalItem apagados/recriados para preservar integridade com SalesOrderItem.proposalItemId. Apenas propostas sem vínculos seguem deleteMany + createMany dos itens.";

  return {
    totalRead: rawProposalsCount,
    totalItemsRead,
    eligibleCount: plans.length,
    blockedCount: blocked.length,
    ignoredCount: ignored.length,
    ignoredInactiveSkuCount: ignoredInactiveSkuRows.length,
    ignoredItemsCount,
    unresolvedCustomers: blocked.filter((b) => b.reasons.includes("CUSTOMER_NOT_RESOLVED")).length,
    unresolvedProducts: blocked.filter((b) => b.reasons.includes("MISSING_PRODUCT_SKU")).length,
    missingSkus: [...new Set(blocked.flatMap((b) => b.missingSkus))].sort(),
    missingCustomers: [...new Set(blocked.map((b) => b.missingCustomerExternalId).filter((x): x is number => x != null))],
    blockedProposalCodes: blocked.map((b) => b.externalProposalCode),
    ignoredProposalCodes: ignored.map((b) => b.externalProposalCode),
    inactiveSkus: [...new Set(ignored.flatMap((b) => b.inactiveSkus))].sort(),
    createCount,
    updateCount,
    noChangeCount: null,
    totalItemsPlanned,
    createItemsCount,
    updateItemsCount: replaceItemsCount,
    replaceItemsCount,
    preservedProposalsDueToSalesOrderLinkCount,
    preservedProposalItemsCount,
    preservedItemsDueToSalesOrderLinkCount,
    preservedDueToSalesOrderLinkPreview,
    itemsImpactNote,
    createsPreview: createsFull.slice(0, 50),
    updatesPreview: updatesFull.slice(0, 50),
    firstCreatesPreview: createsFull.slice(0, 30),
    firstUpdatesPreview: updatesFull.slice(0, 30),
    blockedPreview: blocked.slice(0, 50),
    ignoredPreview: ignored.slice(0, 50),
    ignoredInactiveSkuPreview,
  };
}

async function applyPlans(plans: ProposalPlan[]): Promise<{
  created: number;
  updated: number;
  replacedItemsCount: number;
  preservedProposalsDueToSalesOrderLinkCount: number;
  preservedProposalItemsCount: number;
  preservedItemsDueToSalesOrderLinkCount: number;
}> {
  const existing = await prisma.proposal.findMany({
    where: {
      sourceSystem: SOURCE_SYSTEM,
      externalProposalId: { in: plans.map((p) => p.externalProposalId) },
    },
    select: { id: true, externalProposalId: true },
  });
  const existingByExternalId = new Map<number, ExistingProposalRef>();
  for (const row of existing) {
    if (row.externalProposalId == null) continue;
    existingByExternalId.set(row.externalProposalId, { id: row.id, externalProposalId: row.externalProposalId, externalProposalCode: null });
  }

  let created = 0;
  let updated = 0;
  let replacedItemsCount = 0;
  let preservedProposalsDueToSalesOrderLinkCount = 0;
  let preservedProposalItemsCount = 0;
  let preservedItemsDueToSalesOrderLinkCount = 0;

  for (const plan of plans) {
    const current = existingByExternalId.get(plan.externalProposalId);
    await prisma.$transaction(async (tx) => {
      const proposalCreateData: Prisma.ProposalUncheckedCreateInput = {
        sourceSystem: SOURCE_SYSTEM,
        externalProposalId: plan.externalProposalId,
        externalProposalCode: plan.externalProposalCode,
        externalCustomerId: plan.customerExternalId,
        externalSellerId: plan.sellerExternalId,
        externalCompanyId: plan.companyExternalId,
        externalMovementTypeId: plan.movementTypeExternalId,
        externalOpenedAt: plan.openedAt,
        externalRawPayload: toInputJsonValue(plan.header),
        title: plan.title,
        customerId: plan.customerId,
        status: plan.status,
        responsible: asString(plan.header.nomeVendedor),
        totalItems: plan.totalItems,
        totalGrossValue: toPrismaDecimal(plan.totalGrossValue),
        totalDiscount: new Prisma.Decimal(0),
        totalNetValue: toPrismaDecimal(plan.totalNetValue),
        totalCost: toPrismaDecimal(plan.totalCost),
        totalMarginValue: toPrismaDecimal(plan.totalMarginValue),
        totalMarginPerc: toPrismaDecimal(plan.totalMarginPerc),
        totalTaxes: toPrismaDecimal(plan.totalTaxes),
        totalCommission: new Prisma.Decimal(0),
        totalFreight: new Prisma.Decimal(0),
      };

      let proposalId: string;
      if (!current) {
        const createdProposal = await tx.proposal.create({ data: proposalCreateData, select: { id: true } });
        proposalId = createdProposal.id;
      } else {
        const proposalUpdateData: Prisma.ProposalUncheckedUpdateInput = proposalCreateData;
        const updatedProposal = await tx.proposal.update({
          where: { id: current.id },
          data: proposalUpdateData,
          select: { id: true },
        });
        proposalId = updatedProposal.id;
      }

      let canReplaceItems = true;
      if (current) {
        const existingItems = await tx.proposalItem.findMany({
          where: { proposalId },
          select: { id: true },
        });
        if (existingItems.length > 0) {
          const linkedSalesOrderItemCount = await tx.salesOrderItem.count({
            where: { proposalItemId: { in: existingItems.map((x) => x.id) } },
          });
          if (linkedSalesOrderItemCount > 0) {
            canReplaceItems = false;
            preservedProposalsDueToSalesOrderLinkCount += 1;
            preservedProposalItemsCount += existingItems.length;
            preservedItemsDueToSalesOrderLinkCount += linkedSalesOrderItemCount;
          }
        }
      }

      if (canReplaceItems) {
        await tx.proposalItem.deleteMany({ where: { proposalId } });
        if (plan.items.length > 0) {
          await tx.proposalItem.createMany({
            data: plan.items.map((item) => ({
              proposalId,
              externalItemId: item.externalItemId,
              externalProductId: item.externalProductId,
              externalItemStatus: item.externalItemStatus,
              externalRawPayload: toInputJsonValue(item.externalRawPayload),
              productId: item.productId,
              quantity: toPrismaDecimal(item.quantity),
              unit: item.unit,
              unitCost: toPrismaDecimal(item.unitCost),
              suggestedPrice: toPrismaDecimal(item.suggestedPrice),
              negotiatedPrice: toPrismaDecimal(item.negotiatedPrice),
              discountPerc: toPrismaDecimal(item.discountPerc),
              discountValue: toPrismaDecimal(item.discountValue),
              marginValue: toPrismaDecimal(item.marginValue),
              marginPerc: toPrismaDecimal(item.marginPerc),
              taxesPerc: toPrismaDecimal(item.taxesPerc),
              taxesValue: toPrismaDecimal(item.taxesValue),
              commissionPerc: toPrismaDecimal(item.commissionPerc),
              commissionValue: toPrismaDecimal(item.commissionValue),
              freightValue: toPrismaDecimal(item.freightValue),
              notes: item.notes,
            })),
          });
          replacedItemsCount += plan.items.length;
        }
      }
    });

    if (current) updated += 1;
    else created += 1;
  }

  return {
    created,
    updated,
    replacedItemsCount,
    preservedProposalsDueToSalesOrderLinkCount,
    preservedProposalItemsCount,
    preservedItemsDueToSalesOrderLinkCount,
  };
}

async function main(): Promise<void> {
  const isApply = process.argv.includes("--apply");
  const { plans, blocked, ignored, missingSkus, missingCustomers, inactiveSkus, rawProposalsCount, totalItemsRead } =
    await buildPlans();
  const dry = await runDry(plans, blocked, ignored, rawProposalsCount, totalItemsRead);

  if (missingSkus.has(KNOWN_MISSING_SKU)) {
    console.warn(`[sync-v1] SKU conhecido ainda sem cadastro local: ${KNOWN_MISSING_SKU}`);
  }

  console.log(
    JSON.stringify(
      {
        mode: isApply ? "apply" : "dry-run",
        summary: dry,
        applied: null,
      },
      null,
      2
    )
  );

  if (!isApply) return;

  const result = await applyPlans(plans);

  // Pós-sync: recalcula margem comercial (tabela vigente na data da proposta).
  // Default = dry-run; apply só com confirmação (env/flags). Falha do hook não aborta o sync.
  let marginRecalc: Awaited<
    ReturnType<typeof runProposalCommercialMarginRecalcAfterNomusSync>
  > | null = null;
  try {
    marginRecalc = await runProposalCommercialMarginRecalcAfterNomusSync(prisma, {
      syncMode: "apply",
      argv: process.argv.slice(2),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[proposal-margin-recalc-after-sync] falhou (sync oficial preservado): ${message}`
    );
    marginRecalc = {
      enabled: true,
      skipped: false,
      mode: "dry-run",
      applyDowngradedToDryRun: false,
      error: message,
    };
  }

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        summary: dry,
        applied: result,
        marginRecalc: marginRecalc
          ? {
              mode: marginRecalc.mode,
              skipped: marginRecalc.skipped,
              skipReason: marginRecalc.skipReason ?? null,
              applyDowngradedToDryRun: marginRecalc.applyDowngradedToDryRun,
              error: marginRecalc.error ?? null,
              preview: marginRecalc.preview
                ? {
                    pagesProcessed: marginRecalc.preview.pagesProcessed ?? null,
                    proposalsAnalyzed: marginRecalc.preview.proposalsAnalyzed,
                    itemsAnalyzed: marginRecalc.preview.itemsAnalyzed,
                    itemsComplete: marginRecalc.preview.itemsComplete,
                    itemsChanged: marginRecalc.preview.itemsChanged,
                    itemsUnavailable: marginRecalc.preview.itemsUnavailable,
                    coveragePercent: marginRecalc.preview.coveragePercent,
                    bySource: marginRecalc.preview.bySource,
                  }
                : null,
            }
          : null,
        skippedBlockedProposals: blocked.map((b) => ({
          externalProposalId: b.externalProposalId,
          externalProposalCode: b.externalProposalCode,
          reasons: b.reasons,
        })),
        missingSkus: [...missingSkus].sort(),
        missingCustomers: [...missingCustomers].sort((a, b) => a - b),
        ignoredInactiveSkus: [...inactiveSkus].sort(),
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error("[sync-v1] erro:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

