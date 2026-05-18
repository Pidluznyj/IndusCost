/**
 * NOMUS-BOM-A — Discovery somente leitura da estrutura/BOM/pesos no Nomus.
 * Não grava no banco. Não altera sync existente.
 *
 * Uso:
 *   tsx scripts/nomusProductStructureDiscovery.ts --sku=610.73BA
 *   tsx scripts/nomusProductStructureDiscovery.ts --externalId=1234 --try-candidates
 *   tsx scripts/nomusProductStructureDiscovery.ts --sku=610.73BA --limit=5 --out=./tmp/nomus_structure_discovery.json
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_RETRY_BASE_MS = 700;
const DEFAULT_SEARCH_PAGE_LIMIT = 20;
const SAMPLE_BLOCK_MAX_CHARS = 5000;
const SAMPLE_INLINE_MAX_CHARS = 2000;
const CANDIDATE_REQUEST_DELAY_MS = 400;

type JsonObject = Record<string, unknown>;
type JsonValue = unknown;

type CliOptions = {
  sku: string | null;
  externalId: number | null;
  limit: number;
  tryCandidates: boolean;
  outPath: string;
};

type NestedArrayInfo = {
  path: string;
  length: number;
  itemKeysSample: string[];
};

type NestedObjectInfo = {
  path: string;
  keys: string[];
};

type CandidateEndpointResult = {
  urlPath: string;
  httpStatus: number | null;
  ok: boolean;
  payloadType: string;
  topKeys: string[];
  arrayLength: number | null;
  sampleKeys: string[];
  errorSnippet: string | null;
};

type DiscoveryOutput = {
  generatedAt: string;
  requestedSku: string | null;
  requestedExternalId: number | null;
  resolvedExternalId: number | null;
  resolvedSku: string | null;
  productFound: boolean;
  searchMeta: {
    pagesScanned: number;
    productsScanned: number;
    searchPageLimit: number;
  };
  productRawKeys: string[];
  productRawSampleSanitized: string;
  detectedWeightFields: Array<{ path: string; valueType: string; sample: string }>;
  detectedUnitFields: Array<{ path: string; valueType: string; sample: string }>;
  detectedBomLikeFields: Array<{ path: string; valueType: string; sample: string }>;
  nestedArraysDetected: NestedArrayInfo[];
  nestedObjectsDetected: NestedObjectInfo[];
  candidateEndpointResults: CandidateEndpointResult[] | null;
};

const WEIGHT_KEY_RE =
  /peso|weight/i;
const UNIT_KEY_RE =
  /(siglaUnidadeMedida|idUnidadeMedida|unidade|unidadeMedida|unit)/i;
const BOM_KEY_RE =
  /component|componente|estrutura|compos|lista|materiais|materia|insumo|filho|item|quantidade|produtoPai|produtoFilho/i;

const SENSITIVE_KEY_RE =
  /^(authorization|token|senha|password|secret|api[_-]?key|cookie)$/i;

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

function parseCliOptions(argv: string[]): CliOptions {
  let sku: string | null = null;
  let externalId: number | null = null;
  let limit = DEFAULT_SEARCH_PAGE_LIMIT;
  let tryCandidates = false;
  let outPath = process.env.NOMUS_STRUCTURE_DISCOVERY_OUT?.trim() || "/tmp/nomus_structure_discovery.json";

  for (const arg of argv) {
    if (arg === "--try-candidates") {
      tryCandidates = true;
      continue;
    }
    const skuMatch = arg.match(/^--sku=(.+)$/);
    if (skuMatch) {
      sku = skuMatch[1].trim() || null;
      continue;
    }
    const externalMatch = arg.match(/^--externalId=(.+)$/);
    if (externalMatch) {
      externalId = toInt(externalMatch[1]);
      continue;
    }
    const limitMatch = arg.match(/^--limit=(\d+)$/);
    if (limitMatch) {
      limit = Math.max(1, Number.parseInt(limitMatch[1], 10));
      continue;
    }
    const outMatch = arg.match(/^--out=(.+)$/);
    if (outMatch) {
      outPath = outMatch[1].trim();
      continue;
    }
  }

  if (process.env.NOMUS_DISCOVERY_SKU?.trim()) sku = process.env.NOMUS_DISCOVERY_SKU.trim();
  if (process.env.NOMUS_DISCOVERY_EXTERNAL_ID?.trim()) {
    externalId = toInt(process.env.NOMUS_DISCOVERY_EXTERNAL_ID.trim());
  }
  if (process.env.NOMUS_DISCOVERY_TRY_CANDIDATES === "1") tryCandidates = true;
  if (process.env.NOMUS_DISCOVERY_LIMIT?.trim()) {
    const envLimit = toInt(process.env.NOMUS_DISCOVERY_LIMIT.trim());
    if (envLimit != null && envLimit > 0) limit = envLimit;
  }

  return { sku, externalId, limit, tryCandidates, outPath };
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

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}…[truncated ${value.length - maxChars} chars]`;
}

function sanitizeValue(value: JsonValue, depth = 0): JsonValue {
  if (depth > 6) return "[max-depth]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return truncateText(value, SAMPLE_INLINE_MAX_CHARS);
  if (Array.isArray(value)) {
    const maxItems = 8;
    const sliced = value.slice(0, maxItems).map((item) => sanitizeValue(item, depth + 1));
    if (value.length > maxItems) sliced.push(`…[+${value.length - maxItems} items]`);
    return sliced;
  }
  if (typeof value === "object") {
    const out: JsonObject = {};
    for (const [key, child] of Object.entries(value as JsonObject)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = sanitizeValue(child, depth + 1);
    }
    return out;
  }
  return String(value);
}

function sanitizeJsonBlock(value: JsonValue): string {
  const raw = JSON.stringify(sanitizeValue(value), null, 2);
  return truncateText(raw, SAMPLE_BLOCK_MAX_CHARS);
}

function pickArrayFromUnknown(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const candidates = [
    data.produtos,
    data.data,
    data.results,
    data.items,
    (data.data as Record<string, unknown> | undefined)?.produtos,
  ];
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

type FetchResult = {
  ok: boolean;
  status: number;
  payload: unknown;
  errorSnippet: string | null;
};

async function fetchNomusGet(
  url: URL,
  opts: { maxRetries: number; retryBaseMs: number; softFail?: boolean }
): Promise<FetchResult> {
  const headers = buildNomusHeaders();
  const { maxRetries, retryBaseMs, softFail = false } = opts;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await fetch(url, { method: "GET", headers });
    const bodyText = await res.text().catch(() => "");

    if (res.ok) {
      let payload: unknown = null;
      try {
        payload = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        payload = { _nonJsonBody: truncateText(bodyText, SAMPLE_INLINE_MAX_CHARS) };
      }
      return { ok: true, status: res.status, payload, errorSnippet: null };
    }

    if (res.status === 429 && attempt < maxRetries) {
      let waitMs: number | null = null;
      try {
        const parsed = JSON.parse(bodyText) as { tempoAteLiberar?: unknown };
        const tempoAteLiberar = toInt(parsed?.tempoAteLiberar);
        if (tempoAteLiberar != null && tempoAteLiberar > 0) {
          waitMs = tempoAteLiberar * 1000 + 1000;
        }
      } catch {
        waitMs = null;
      }
      if (waitMs == null) {
        const retryAfterSec = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
        waitMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? retryAfterSec * 1000 + 1000
            : retryBaseMs * Math.pow(2, attempt);
      }
      console.warn(
        `[nomus-structure-discovery] rate limit 429 em ${url.pathname}; aguardando ${(waitMs / 1000).toFixed(0)}s.`
      );
      await sleep(waitMs);
      continue;
    }

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === maxRetries) {
      const snippet = truncateText(bodyText, 300);
      if (softFail) {
        return { ok: false, status: res.status, payload: null, errorSnippet: snippet || null };
      }
      throw new Error(`Falha HTTP ${res.status} em ${url.pathname}: ${snippet}`);
    }
    await sleep(retryBaseMs * Math.pow(2, attempt));
  }

  throw new Error("Estado inesperado no retry HTTP.");
}

function productSkuFromRow(row: JsonObject): string | null {
  return asString(row.codigo) ?? asString(row.codigoProduto);
}

function normalizeSku(value: string): string {
  return value.trim().toUpperCase();
}

async function findProductBySku(
  baseUrl: string,
  sku: string,
  pageLimit: number
): Promise<{ product: JsonObject | null; pagesScanned: number; productsScanned: number }> {
  const pageSize = Math.max(1, toInt(process.env.NOMUS_PAGE_SIZE) ?? DEFAULT_PAGE_SIZE);
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);
  const targetSku = normalizeSku(sku);

  let pagesScanned = 0;
  let productsScanned = 0;
  let page = 1;

  while (pagesScanned < pageLimit) {
    const url = buildNomusUrl(baseUrl, "produtos");
    url.searchParams.set("pagina", String(page));
    url.searchParams.set("tamanhoPagina", String(pageSize));
    const result = await fetchNomusGet(url, { maxRetries, retryBaseMs });
    const arr = pickArrayFromUnknown(result.payload).filter(
      (x): x is JsonObject => !!x && typeof x === "object"
    );
    pagesScanned += 1;
    productsScanned += arr.length;

    for (const row of arr) {
      const rowSku = productSkuFromRow(row);
      if (rowSku && normalizeSku(rowSku) === targetSku) {
        return { product: row, pagesScanned, productsScanned };
      }
    }

    if (arr.length === 0) break;
    if (!hasNextPage(result.payload, page, arr.length)) break;
    page += 1;
  }

  return { product: null, pagesScanned, productsScanned };
}

function describeValueType(value: unknown): string {
  if (value == null) return "null";
  if (Array.isArray(value)) return `array[${value.length}]`;
  return typeof value;
}

function sampleValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return truncateText(value, 120);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[array len=${value.length}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as JsonObject).slice(0, 8);
    return `{${keys.join(", ")}}`;
  }
  return String(value);
}

function walkPayload(
  value: JsonValue,
  path: string,
  ctx: {
    weightFields: DiscoveryOutput["detectedWeightFields"];
    unitFields: DiscoveryOutput["detectedUnitFields"];
    bomFields: DiscoveryOutput["detectedBomLikeFields"];
    nestedArrays: NestedArrayInfo[];
    nestedObjects: NestedObjectInfo[];
  },
  depth = 0
): void {
  if (depth > 8 || value == null) return;

  if (Array.isArray(value)) {
    if (path) {
      const first = value[0];
      const itemKeysSample =
        first && typeof first === "object" && !Array.isArray(first)
          ? Object.keys(first as JsonObject).slice(0, 20)
          : [];
      ctx.nestedArrays.push({ path, length: value.length, itemKeysSample });
    }
    for (let i = 0; i < Math.min(value.length, 3); i += 1) {
      walkPayload(value[i], path ? `${path}[${i}]` : `[${i}]`, ctx, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") return;

  const obj = value as JsonObject;
  if (path) {
    ctx.nestedObjects.push({ path, keys: Object.keys(obj).slice(0, 40) });
  }

  for (const [key, child] of Object.entries(obj)) {
    const childPath = path ? `${path}.${key}` : key;
    const keyHit = key;
    if (WEIGHT_KEY_RE.test(keyHit)) {
      ctx.weightFields.push({
        path: childPath,
        valueType: describeValueType(child),
        sample: sampleValue(child),
      });
    }
    if (UNIT_KEY_RE.test(keyHit)) {
      ctx.unitFields.push({
        path: childPath,
        valueType: describeValueType(child),
        sample: sampleValue(child),
      });
    }
    if (BOM_KEY_RE.test(keyHit)) {
      ctx.bomFields.push({
        path: childPath,
        valueType: describeValueType(child),
        sample: sampleValue(child),
      });
    }
    walkPayload(child, childPath, ctx, depth + 1);
  }
}

function inspectProduct(product: JsonObject): Pick<
  DiscoveryOutput,
  | "productRawKeys"
  | "productRawSampleSanitized"
  | "detectedWeightFields"
  | "detectedUnitFields"
  | "detectedBomLikeFields"
  | "nestedArraysDetected"
  | "nestedObjectsDetected"
> {
  const ctx = {
    weightFields: [] as DiscoveryOutput["detectedWeightFields"],
    unitFields: [] as DiscoveryOutput["detectedUnitFields"],
    bomFields: [] as DiscoveryOutput["detectedBomLikeFields"],
    nestedArrays: [] as NestedArrayInfo[],
    nestedObjects: [] as NestedObjectInfo[],
  };
  walkPayload(product, "", ctx);

  const dedupeByPath = <T extends { path: string }>(rows: T[]): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const row of rows) {
      if (seen.has(row.path)) continue;
      seen.add(row.path);
      out.push(row);
    }
    return out;
  };

  return {
    productRawKeys: Object.keys(product).sort(),
    productRawSampleSanitized: sanitizeJsonBlock(product),
    detectedWeightFields: dedupeByPath(ctx.weightFields),
    detectedUnitFields: dedupeByPath(ctx.unitFields),
    detectedBomLikeFields: dedupeByPath(ctx.bomFields),
    nestedArraysDetected: dedupeByPath(ctx.nestedArrays),
    nestedObjectsDetected: dedupeByPath(ctx.nestedObjects),
  };
}

function payloadTypeOf(payload: unknown): string {
  if (payload == null) return "null";
  if (Array.isArray(payload)) return "array";
  return typeof payload;
}

function topKeysOf(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload)) {
    const first = payload[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      return Object.keys(first as JsonObject).slice(0, 30);
    }
    return [];
  }
  return Object.keys(payload as JsonObject).slice(0, 30);
}

function buildCandidatePaths(externalId: number): string[] {
  const id = String(externalId);
  return [
    `produtos/${id}`,
    `produtos/${id}/estrutura`,
    `produtos/${id}/composicao`,
    `produtos/${id}/componentes`,
    `produtos/${id}/lista-materiais`,
    `produtos/${id}/materiais`,
    `estrutura-produto?idProduto=${id}`,
    `produto-estrutura?idProduto=${id}`,
    `lista-materiais?idProduto=${id}`,
    `composicao-produto?idProduto=${id}`,
    `componentes-produto?idProduto=${id}`,
    `fichas-tecnicas?idProduto=${id}`,
    `ficha-tecnica?idProduto=${id}`,
  ];
}

async function probeCandidateEndpoints(
  baseUrl: string,
  externalId: number
): Promise<CandidateEndpointResult[]> {
  const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);
  const paths = buildCandidatePaths(externalId);
  const results: CandidateEndpointResult[] = [];

  for (let i = 0; i < paths.length; i += 1) {
    const urlPath = paths[i];
    const url = buildNomusUrl(baseUrl, urlPath);
    const res = await fetchNomusGet(url, { maxRetries, retryBaseMs, softFail: true });
    const payload = res.payload;
    const arrayLength = Array.isArray(payload) ? payload.length : null;

    results.push({
      urlPath,
      httpStatus: res.status,
      ok: res.ok,
      payloadType: payloadTypeOf(payload),
      topKeys: topKeysOf(payload),
      arrayLength,
      sampleKeys: topKeysOf(payload),
      errorSnippet: res.errorSnippet,
    });

    if (i < paths.length - 1) {
      await sleep(CANDIDATE_REQUEST_DELAY_MS);
    }
  }

  return results;
}

async function resolveProduct(
  baseUrl: string,
  opts: CliOptions
): Promise<{
  product: JsonObject | null;
  resolvedExternalId: number | null;
  resolvedSku: string | null;
  pagesScanned: number;
  productsScanned: number;
}> {
  if (opts.externalId != null) {
    if (opts.sku) {
      const found = await findProductBySku(baseUrl, opts.sku, opts.limit);
      if (found.product) {
        const id = toInt(found.product.id);
        return {
          product: found.product,
          resolvedExternalId: id ?? opts.externalId,
          resolvedSku: productSkuFromRow(found.product) ?? opts.sku,
          pagesScanned: found.pagesScanned,
          productsScanned: found.productsScanned,
        };
      }
    }
    return {
      product: null,
      resolvedExternalId: opts.externalId,
      resolvedSku: opts.sku,
      pagesScanned: 0,
      productsScanned: 0,
    };
  }

  if (opts.sku) {
    const found = await findProductBySku(baseUrl, opts.sku, opts.limit);
    return {
      product: found.product,
      resolvedExternalId: found.product ? toInt(found.product.id) : null,
      resolvedSku: found.product ? productSkuFromRow(found.product) : opts.sku,
      pagesScanned: found.pagesScanned,
      productsScanned: found.productsScanned,
    };
  }

  throw new Error("Informe --sku=... e/ou --externalId=... para o discovery.");
}

async function main(): Promise<void> {
  const cli = parseCliOptions(process.argv.slice(2));
  if (!cli.sku && cli.externalId == null) {
    throw new Error("Informe --sku=... e/ou --externalId=... para o discovery.");
  }

  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");
  console.warn(
    `[nomus-structure-discovery] início sku=${cli.sku ?? "-"} externalId=${cli.externalId ?? "-"} limit=${cli.limit} tryCandidates=${cli.tryCandidates}`
  );

  const resolved = await resolveProduct(baseUrl, cli);
  let product = resolved.product;

  if (!product && resolved.resolvedExternalId != null) {
    const detailUrl = buildNomusUrl(baseUrl, `produtos/${resolved.resolvedExternalId}`);
    const maxRetries = Math.max(0, toInt(process.env.NOMUS_MAX_RETRIES) ?? DEFAULT_MAX_RETRIES);
    const retryBaseMs = Math.max(100, toInt(process.env.NOMUS_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS);
    const detail = await fetchNomusGet(detailUrl, { maxRetries, retryBaseMs, softFail: true });
    if (detail.ok && detail.payload && typeof detail.payload === "object" && !Array.isArray(detail.payload)) {
      product = detail.payload as JsonObject;
    } else if (detail.ok && Array.isArray(detail.payload)) {
      const first = detail.payload[0];
      if (first && typeof first === "object") product = first as JsonObject;
    }
  }

  const inspection = product
    ? inspectProduct(product)
    : {
        productRawKeys: [],
        productRawSampleSanitized: "",
        detectedWeightFields: [],
        detectedUnitFields: [],
        detectedBomLikeFields: [],
        nestedArraysDetected: [],
        nestedObjectsDetected: [],
      };

  let candidateEndpointResults: CandidateEndpointResult[] | null = null;
  const probeId = resolved.resolvedExternalId ?? toInt(product?.id);
  if (cli.tryCandidates && probeId != null) {
    console.warn(
      `[nomus-structure-discovery] testando ${buildCandidatePaths(probeId).length} endpoints candidatos para id=${probeId}.`
    );
    candidateEndpointResults = await probeCandidateEndpoints(baseUrl, probeId);
  }

  const output: DiscoveryOutput = {
    generatedAt: new Date().toISOString(),
    requestedSku: cli.sku,
    requestedExternalId: cli.externalId,
    resolvedExternalId: resolved.resolvedExternalId ?? toInt(product?.id),
    resolvedSku: resolved.resolvedSku ?? (product ? productSkuFromRow(product) : null),
    productFound: product != null,
    searchMeta: {
      pagesScanned: resolved.pagesScanned,
      productsScanned: resolved.productsScanned,
      searchPageLimit: cli.limit,
    },
    ...inspection,
    candidateEndpointResults,
  };

  await mkdir(dirname(cli.outPath), { recursive: true });
  await writeFile(cli.outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({ ok: true, outPath: cli.outPath, productFound: output.productFound }, null, 2));
}

main().catch((err) => {
  console.error("[nomus-structure-discovery] erro:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
