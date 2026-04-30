import "dotenv/config";
import { ItemType, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_RETRY_BASE_MS = 700;

type JsonObject = Record<string, unknown>;

type EligibleProduct = {
  externalId: number;
  sku: string;
  name: string;
  description: string | null;
  type: ItemType;
  raw: JsonObject;
};

type BlockedProduct = {
  externalId: number | null;
  sku: string | null;
  name: string | null;
  reasons: string[];
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

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getRequiredEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
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
  if (customHeaderName && customHeaderValue) headers[customHeaderName] = customHeaderValue;
  return headers;
}

function buildNomusUrl(baseUrl: string, resource: string): URL {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedResource = resource.replace(/^\/+/, "");
  return new URL(normalizedResource, normalizedBase);
}

async function fetchJsonWithRetry(url: URL, maxRetries: number, retryBaseMs: number): Promise<unknown> {
  const headers = buildNomusHeaders();
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await fetch(url, { method: "GET", headers });
    if (res.ok) return res.json();
    const body = await res.text().catch(() => "");
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === maxRetries) {
      throw new Error(`Falha HTTP ${res.status} em ${url.toString()}: ${body.slice(0, 300)}`);
    }
    await sleep(retryBaseMs * Math.pow(2, attempt));
  }
  throw new Error("Estado inesperado no retry HTTP.");
}

function pickArrayFromUnknown(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const candidates = [data.produtos, data.data, data.results, data.items, (data.data as Record<string, unknown> | undefined)?.produtos];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function hasNextPage(payload: unknown, page: number, currentLen: number): boolean {
  if (!payload || typeof payload !== "object") return currentLen > 0;
  if (Array.isArray(payload)) return currentLen > 0;
  const data = payload as Record<string, unknown>;
  const totalPages = toInt(data.totalPaginas) ?? toInt(data.totalPages) ?? toInt(data.paginas);
  if (totalPages != null) return page < totalPages;
  if (typeof data.hasMore === "boolean") return data.hasMore;
  return currentLen > 0;
}

async function fetchAllNomusProducts(baseUrl: string): Promise<JsonObject[]> {
  const pageSize = Math.max(1, toInt(process.env.NOMUS_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE);
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);
  const startPage = Math.max(1, toInt(process.env.NOMUS_PRODUCTS_START_PAGE) ?? 1);
  const maxPages = Math.max(1, toInt(process.env.NOMUS_PRODUCTS_MAX_PAGES) ?? toInt(process.env.NOMUS_MAX_PAGES) ?? 200);
  const lastPage = startPage + maxPages - 1;

  const rows: JsonObject[] = [];
  let page = startPage;

  while (true) {
    const url = buildNomusUrl(baseUrl, "produtos");
    url.searchParams.set("pagina", String(page));
    url.searchParams.set("tamanhoPagina", String(pageSize));
    const payload = await fetchJsonWithRetry(url, maxRetries, retryBaseMs);
    const arr = pickArrayFromUnknown(payload).filter((x): x is JsonObject => !!x && typeof x === "object");
    if (arr.length === 0) break;
    rows.push(...arr);
    console.warn(`[nomus-products-v1] página ${page} lida com ${arr.length} produtos; acumulado=${rows.length}.`);
    if (page >= lastPage) {
      console.warn(
        `[nomus-products-v1] limite de bloco atingido: startPage=${startPage}, maxPages=${maxPages}, lastPage=${lastPage}.`
      );
      break;
    }
    if (!hasNextPage(payload, page, arr.length)) break;
    page += 1;
  }
  return rows;
}

function inferProductType(raw: JsonObject): ItemType {
  const typeText =
    (asString(raw.tipo) ?? asString(raw.tipoProduto) ?? asString(raw.classificacao) ?? asString(raw.categoria) ?? "").toUpperCase();
  if (typeText.includes("COMPONENT")) return "COMPONENT";
  return "PRODUCT";
}

function mapProducts(raw: JsonObject[]): { eligible: EligibleProduct[]; blocked: BlockedProduct[] } {
  const eligible: EligibleProduct[] = [];
  const blocked: BlockedProduct[] = [];

  for (const p of raw) {
    const externalId = toInt(p.id);
    const sku = asString(p.codigo) ?? asString(p.codigoProduto);
    const name = asString(p.nome) ?? asString(p.descricao);
    const reasons: string[] = [];
    if (externalId == null) reasons.push("MISSING_EXTERNAL_ID");
    if (!sku) reasons.push("MISSING_SKU");
    if (!name) reasons.push("MISSING_NAME");
    if (reasons.length > 0) {
      blocked.push({ externalId, sku, name, reasons });
      continue;
    }
    eligible.push({
      externalId: externalId!,
      sku: sku!,
      name: name!,
      description: asString(p.descricao),
      type: inferProductType(p),
      raw: p,
    });
  }
  return { eligible, blocked };
}

async function runDry(eligible: EligibleProduct[]) {
  const existing = await prisma.product.findMany({
    where: { sku: { in: eligible.map((p) => p.sku) } },
    select: { id: true, sku: true, name: true },
  });
  const bySku = new Map(existing.map((p) => [p.sku, p]));
  const createsPreview: Array<{ externalId: number; sku: string; name: string }> = [];
  const updatesPreview: Array<{ id: string; externalId: number; sku: string; name: string }> = [];
  for (const p of eligible) {
    const current = bySku.get(p.sku);
    if (!current) createsPreview.push({ externalId: p.externalId, sku: p.sku, name: p.name });
    else updatesPreview.push({ id: current.id, externalId: p.externalId, sku: p.sku, name: p.name });
  }
  return { createsPreview: createsPreview.slice(0, 50), updatesPreview: updatesPreview.slice(0, 50) };
}

async function runApply(eligible: EligibleProduct[]): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const p of eligible) {
    const current = await prisma.product.findUnique({ where: { sku: p.sku }, select: { id: true } });
    const data = {
      name: p.name,
      description: p.description,
      status: "ACTIVE",
      type: p.type,
    };
    if (current) {
      await prisma.product.update({ where: { id: current.id }, data });
      updated += 1;
    } else {
      await prisma.product.create({ data: { ...data, sku: p.sku } });
      created += 1;
    }
  }
  return { created, updated };
}

async function main(): Promise<void> {
  const isApply = process.argv.includes("--apply");
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const raw = await fetchAllNomusProducts(baseUrl);
  const { eligible, blocked } = mapProducts(raw);
  const dry = await runDry(eligible);
  const blockedReasons: Record<string, number> = {};
  for (const b of blocked) for (const r of b.reasons) blockedReasons[r] = (blockedReasons[r] ?? 0) + 1;

  const applied = isApply ? await runApply(eligible) : null;
  console.log(
    JSON.stringify(
      {
        mode: isApply ? "apply" : "dry-run",
        summary: {
          totalRead: raw.length,
          eligibleCount: eligible.length,
          blockedCount: blocked.length,
          blockedReasons,
          createsPreview: dry.createsPreview,
          updatesPreview: dry.updatesPreview,
          blockedPreview: blocked.slice(0, 50),
        },
        applied,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error("[nomus-products-v1] erro:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

