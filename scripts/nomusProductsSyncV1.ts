import "dotenv/config";
import { ItemType, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_RETRY_BASE_MS = 700;

type JsonObject = Record<string, unknown>;

type EligibleProduct = {
  externalId: number;
  sku: string;
  name: string;
  description: string | null;
  type: ItemType;
  typeInferenceConfidence: "HIGH" | "LOW";
  flags: {
    optional: boolean;
    phantom: boolean;
    service: boolean;
    inactive: boolean;
    hasBomLikeData: boolean;
  };
  nomusTypeName: string | null;
  nomusGroupName: string | null;
  nomusFamilyName: string | null;
  unitFromNomus: string | null;
  netWeightFromNomus: number | null;
  grossWeightFromNomus: number | null;
  nomusRawName: string | null;
  nomusDescription: string | null;
  chosenName: string;
  nameSource: "nome" | "descricao" | "codigo" | "none";
  nameLooksLikeSku: boolean;
  raw: JsonObject;
};

type BlockedProduct = {
  externalId: number | null;
  sku: string | null;
  name: string | null;
  reasons: string[];
  ativo: boolean | null;
  template: boolean | null;
  nomeTipoProduto: string | null;
  nomeGrupoProduto: string | null;
  nomeFamiliaProduto: string | null;
  servicoIndustrializacaoTerceiros: boolean | null;
  typeInferenceConfidence: "HIGH" | "LOW";
  inferredType: ItemType;
};

type ProductsDiagnostics = {
  detectedProductKeys: string[];
  weightFieldsDetected: string[];
  unitFieldsDetected: string[];
  typeFieldsDetected: string[];
  optionalLikeFieldsDetected: string[];
  phantomLikeFieldsDetected: string[];
  serviceLikeFieldsDetected: string[];
  inactiveLikeFieldsDetected: string[];
  bomLikeFieldsDetected: string[];
  typeInferenceSummary: {
    highConfidenceProduct: number;
    highConfidenceComponent: number;
    lowConfidence: number;
    blockedUnsafeType: number;
  };
  safeUpdateFields: string[];
  blockedBusinessRules: string[];
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

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "sim", "yes"].includes(v)) return true;
    if (["false", "0", "nao", "não", "no"].includes(v)) return false;
  }
  return null;
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
    if (res.status === 429 && attempt < maxRetries) {
      let waitMs: number | null = null;
      try {
        const parsed = JSON.parse(body) as { tempoAteLiberar?: unknown };
        const tempoAteLiberar = toInt(parsed?.tempoAteLiberar);
        if (tempoAteLiberar != null && tempoAteLiberar > 0) {
          waitMs = tempoAteLiberar * 1000 + 1000;
        }
      } catch {
        waitMs = null;
      }
      if (waitMs == null) {
        const retryAfterSec = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
        waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 + 1000 : retryBaseMs * Math.pow(2, attempt);
      }
      console.warn(
        `[nomus-products-v1] rate limit 429; aguardando ${(waitMs / 1000).toFixed(0)}s antes de tentar novamente.`
      );
      await sleep(waitMs);
      continue;
    }
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

function matchAny(values: Array<string | null>, regex: RegExp): boolean {
  return values.some((v) => Boolean(v && regex.test(v)));
}

/** Normaliza para comparar nome vindo do Nomus com o SKU (trim, maiúsculas, sem espaços internos). */
function normalizeForSkuCompare(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Indica se o texto parece código/SKU técnico (e não um nome descritivo).
 * true: vazio, igual ao SKU normalizado, ou padrão curto alfanumérico sem palavras longas.
 */
function isSkuLikeName(value: string | null, sku: string): boolean {
  if (value == null) return true;
  const t = value.trim();
  if (t.length === 0) return true;
  if (normalizeForSkuCompare(t) === normalizeForSkuCompare(sku)) return true;
  // Texto descritivo típico: espaços, pontuação, acentos.
  if (/[\s,;()[\]{}'"“”]/.test(t)) return false;
  if (/[àáâãäåèéêëìíîïòóôõöùúûüýÿçñ]/i.test(t)) return false;
  if (/[\u00C0-\u024F\u1E00-\u1EFF]/.test(t)) return false;
  if (t.length > 48) return false;
  const letterCount = (t.match(/[A-Za-z]/g) ?? []).length;
  const digitCount = (t.match(/\d/g) ?? []).length;
  if (t.length >= 18 && letterCount >= 12 && digitCount <= 2) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(t)) return false;
  if (/[aeiouAEIOU]{4,}/.test(t)) return false;
  if (!/\d/.test(t) && t.length > 10) return false;
  return true;
}

function chooseSafeProductName(
  raw: JsonObject,
  sku: string
): {
  name: string | null;
  source: "nome" | "descricao" | "codigo" | "none";
  nameLooksLikeSku: boolean;
} {
  const nome = asString(raw.nome);
  const descricao = asString(raw.descricao);
  const codigo = asString(raw.codigo) ?? asString(raw.codigoProduto) ?? sku;

  if (nome && !isSkuLikeName(nome, sku)) {
    return { name: nome, source: "nome", nameLooksLikeSku: false };
  }
  if (descricao && !isSkuLikeName(descricao, sku)) {
    return { name: descricao, source: "descricao", nameLooksLikeSku: false };
  }
  if (codigo) {
    return { name: codigo, source: "codigo", nameLooksLikeSku: true };
  }
  return { name: null, source: "none", nameLooksLikeSku: true };
}

function toNumberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractNomusMeta(raw: JsonObject): {
  nomeTipoProduto: string | null;
  nomeGrupoProduto: string | null;
  nomeFamiliaProduto: string | null;
  unitFromNomus: string | null;
  netWeightFromNomus: number | null;
  grossWeightFromNomus: number | null;
  ativo: boolean | null;
  template: boolean | null;
  servicoIndustrializacaoTerceiros: boolean | null;
} {
  return {
    nomeTipoProduto: asString(raw.nomeTipoProduto),
    nomeGrupoProduto: asString(raw.nomeGrupoProduto),
    nomeFamiliaProduto: asString(raw.nomeFamiliaProduto),
    unitFromNomus: asString(raw.siglaUnidadeMedida) ?? asString(raw.unidade) ?? asString(raw.unidadeMedida),
    netWeightFromNomus: toNumberOrNull(raw.pesoLiquidoUnitario),
    grossWeightFromNomus: toNumberOrNull(raw.pesoBrutoUnitario),
    ativo: asBoolean(raw.ativo),
    template: asBoolean(raw.template),
    servicoIndustrializacaoTerceiros: asBoolean(raw.servicoIndustrializacaoTerceiros),
  };
}

function inferProductTypeWithConfidence(raw: JsonObject): { type: ItemType; confidence: "HIGH" | "LOW" } {
  const typeName = (asString(raw.nomeTipoProduto) ?? "").toUpperCase();
  const groupName = (asString(raw.nomeGrupoProduto) ?? "").toUpperCase();

  if (
    typeName.includes("SEMI-ACABADO") ||
    typeName.includes("SEMI ACABADO") ||
    typeName.includes("SEMIACABADO") ||
    typeName.includes("SEMI-ELABORADO") ||
    typeName.includes("SEMI ELABORADO") ||
    typeName.includes("SEMIELABORADO")
  ) {
    return { type: "COMPONENT", confidence: "HIGH" };
  }
  if (typeName.includes("COMPONENTE") || typeName.includes("COMPONENT") || groupName.includes("COMPONENTE")) {
    return { type: "COMPONENT", confidence: "HIGH" };
  }
  if (typeName.includes("PRODUTO ACABADO") || typeName.includes("ACABADO") || groupName.includes("PRODUTO ACABADO")) {
    return { type: "PRODUCT", confidence: "HIGH" };
  }
  return { type: "PRODUCT", confidence: "LOW" };
}

function collectDiagnostics(raw: JsonObject[]): ProductsDiagnostics {
  const keySet = new Set<string>();
  const weightFields = new Set<string>();
  const unitFields = new Set<string>();
  const typeFields = new Set<string>();
  const optionalLikeFields = new Set<string>();
  const phantomLikeFields = new Set<string>();
  const serviceLikeFields = new Set<string>();
  const inactiveLikeFields = new Set<string>();
  const bomLikeFields = new Set<string>();

  const weightRegex = /peso|weight/i;
  const unitRegex = /(siglaUnidadeMedida|idUnidadeMedida|unidade|unidadeMedida)$/i;
  const typeRegex = /tipo|categoria|classificacao/i;
  const optionalRegex = /opcional|optional|produtoOpcional|itemOpcional/i;
  const phantomRegex = /fantasma|phantom|produtoFantasma|itemFantasma/i;
  const serviceRegex = /servic|serviço|servico|apoio|gen[eé]rico|generico|n[aã]o.?produtivo|tempor[aá]rio|temporario/i;
  const inactiveRegex = /inativ|cancel|exclu|delet|desativ|ativo|status/i;
  const bomRegex = /component|estrutura|insumo|materia|filho|compos|produtoPai|produtoFilho|quantidade/i;

  for (const row of raw) {
    for (const [key, value] of Object.entries(row)) {
      keySet.add(key);
      if (weightRegex.test(key)) weightFields.add(key);
      if (unitRegex.test(key)) unitFields.add(key);
      if (typeRegex.test(key)) typeFields.add(key);
      if (optionalRegex.test(key)) optionalLikeFields.add(key);
      if (phantomRegex.test(key)) phantomLikeFields.add(key);
      if (serviceRegex.test(key)) serviceLikeFields.add(key);
      if (inactiveRegex.test(key)) inactiveLikeFields.add(key);
      if (bomRegex.test(key)) bomLikeFields.add(key);
      if (typeof value === "string") {
        if (optionalRegex.test(value)) optionalLikeFields.add(key);
        if (phantomRegex.test(value)) phantomLikeFields.add(key);
        if (serviceRegex.test(value)) serviceLikeFields.add(key);
        if (inactiveRegex.test(value)) inactiveLikeFields.add(key);
      }
      if (Array.isArray(value) || (value && typeof value === "object")) {
        if (bomRegex.test(key)) bomLikeFields.add(key);
      }
    }
  }

  return {
    detectedProductKeys: [...keySet].sort(),
    weightFieldsDetected: [...weightFields].sort(),
    unitFieldsDetected: [...unitFields].sort(),
    typeFieldsDetected: [...typeFields].sort(),
    optionalLikeFieldsDetected: [...optionalLikeFields].sort(),
    phantomLikeFieldsDetected: [...phantomLikeFields].sort(),
    serviceLikeFieldsDetected: [...serviceLikeFields].sort(),
    inactiveLikeFieldsDetected: [...inactiveLikeFields].sort(),
    bomLikeFieldsDetected: [...bomLikeFields].sort(),
    typeInferenceSummary: {
      highConfidenceProduct: 0,
      highConfidenceComponent: 0,
      lowConfidence: 0,
      blockedUnsafeType: 0,
    },
    safeUpdateFields: ["name", "description"],
    blockedBusinessRules: [
      "OPTIONAL_PRODUCT",
      "PHANTOM_PRODUCT",
      "SERVICE_ITEM",
      "INACTIVE_PRODUCT_NOMUS",
      "TEMPLATE_PRODUCT",
      "RAW_MATERIAL_NOT_PRODUCT",
      "PACKAGING_NOT_PRODUCT",
      "MRO_OR_FIXED_ASSET_NOT_PRODUCT",
      "MERCHANDISE_RESALE_UNMAPPED",
      "UNSAFE_PRODUCT_TYPE",
    ],
  };
}

function mapProducts(
  raw: JsonObject[],
  existingSkuSet: Set<string>
): { eligible: EligibleProduct[]; blocked: BlockedProduct[]; diagnostics: ProductsDiagnostics } {
  const eligible: EligibleProduct[] = [];
  const blocked: BlockedProduct[] = [];
  const diagnostics = collectDiagnostics(raw);

  for (const p of raw) {
    const externalId = toInt(p.id);
    const sku = asString(p.codigo) ?? asString(p.codigoProduto);
    const reasons: string[] = [];
    if (externalId == null) reasons.push("MISSING_EXTERNAL_ID");
    if (!sku) reasons.push("MISSING_SKU");
    const chosenNamePack = sku ? chooseSafeProductName(p, sku) : { name: null as string | null, source: "none" as const, nameLooksLikeSku: true };
    if (!chosenNamePack.name) reasons.push("MISSING_NAME");
    const name = chosenNamePack.name ?? asString(p.nome) ?? asString(p.descricao);
    if (reasons.length > 0) {
      blocked.push({
        externalId,
        sku,
        name,
        reasons,
        ativo: null,
        template: null,
        nomeTipoProduto: null,
        nomeGrupoProduto: null,
        nomeFamiliaProduto: null,
        servicoIndustrializacaoTerceiros: null,
        typeInferenceConfidence: "LOW",
        inferredType: "PRODUCT",
      });
      continue;
    }

    const meta = extractNomusMeta(p);
    const textScope = [meta.nomeTipoProduto, meta.nomeGrupoProduto, meta.nomeFamiliaProduto];
    const optional = matchAny(textScope, /\b(opcional|optional)\b/i);
    const phantom = matchAny(textScope, /\b(fantasma|phantom)\b/i);
    const service =
      meta.servicoIndustrializacaoTerceiros === true ||
      matchAny(textScope, /\b(servi[cç]o|service)\b/i);
    const inactive = meta.ativo === false;
    const template = meta.template === true;
    const resale = matchAny(textScope, /mercadoria\s+para\s+revenda/i);
    const rawMaterial = matchAny(textScope, /mat[ée]ria[\s-]*prima|materia[\s-]*prima/i);
    const packaging = matchAny(textScope, /\bembalagem\b/i);
    const mroOrFixedAsset = matchAny(
      textScope,
      /\bmro\b|ativo\s+imobilizado|manuten[cç][aã]o,\s*reparo\s*e\s*opera[cç][aã]o|manuten[cç][aã]o|reparo|opera[cç][aã]o/i
    );
    const hasBomLikeData = Object.keys(p).some((k) =>
      /component|estrutura|insumo|materia|filho|compos|produtoPai|produtoFilho|quantidade/i.test(k)
    );

    if (optional) reasons.push("OPTIONAL_PRODUCT");
    if (phantom) reasons.push("PHANTOM_PRODUCT");
    if (service) reasons.push("SERVICE_ITEM");
    if (inactive) reasons.push("INACTIVE_PRODUCT_NOMUS");
    if (template) reasons.push("TEMPLATE_PRODUCT");
    if (rawMaterial) reasons.push("RAW_MATERIAL_NOT_PRODUCT");
    if (packaging) reasons.push("PACKAGING_NOT_PRODUCT");
    if (mroOrFixedAsset) reasons.push("MRO_OR_FIXED_ASSET_NOT_PRODUCT");
    if (resale) reasons.push("MERCHANDISE_RESALE_UNMAPPED");

    const inferred = inferProductTypeWithConfidence(p);
    const isNewSku = !existingSkuSet.has(sku!);
    if (isNewSku && inferred.confidence === "LOW") {
      reasons.push("UNSAFE_PRODUCT_TYPE");
      diagnostics.typeInferenceSummary.blockedUnsafeType += 1;
    }

    if (reasons.length > 0) {
      blocked.push({
        externalId,
        sku,
        name,
        reasons,
        ativo: meta.ativo,
        template: meta.template,
        nomeTipoProduto: meta.nomeTipoProduto,
        nomeGrupoProduto: meta.nomeGrupoProduto,
        nomeFamiliaProduto: meta.nomeFamiliaProduto,
        servicoIndustrializacaoTerceiros: meta.servicoIndustrializacaoTerceiros,
        typeInferenceConfidence: inferred.confidence,
        inferredType: inferred.type,
      });
      continue;
    }

    if (inferred.confidence === "HIGH" && inferred.type === "PRODUCT") diagnostics.typeInferenceSummary.highConfidenceProduct += 1;
    else if (inferred.confidence === "HIGH" && inferred.type === "COMPONENT") diagnostics.typeInferenceSummary.highConfidenceComponent += 1;
    else diagnostics.typeInferenceSummary.lowConfidence += 1;

    eligible.push({
      externalId: externalId!,
      sku: sku!,
      name: chosenNamePack.name!,
      description: asString(p.descricao),
      type: inferred.type,
      typeInferenceConfidence: inferred.confidence,
      flags: { optional, phantom, service, inactive, hasBomLikeData },
      nomusTypeName: meta.nomeTipoProduto,
      nomusGroupName: meta.nomeGrupoProduto,
      nomusFamilyName: meta.nomeFamiliaProduto,
      unitFromNomus: meta.unitFromNomus,
      netWeightFromNomus: meta.netWeightFromNomus,
      grossWeightFromNomus: meta.grossWeightFromNomus,
      nomusRawName: asString(p.nome),
      nomusDescription: asString(p.descricao),
      chosenName: chosenNamePack.name!,
      nameSource: chosenNamePack.source,
      nameLooksLikeSku: chosenNamePack.nameLooksLikeSku,
      raw: p,
    });
  }
  return { eligible, blocked, diagnostics };
}

async function runDry(eligible: EligibleProduct[]) {
  const existing = await prisma.product.findMany({
    where: { sku: { in: eligible.map((p) => p.sku) } },
    select: { id: true, sku: true, name: true, description: true, type: true },
  });
  const bySku = new Map(existing.map((p) => [p.sku, p]));
  const createsPreview: Array<{
    externalId: number;
    sku: string;
    name: string;
    nomusRawName: string | null;
    nomusDescription: string | null;
    chosenName: string;
    nameSource: "nome" | "descricao" | "codigo" | "none";
    nameLooksLikeSku: boolean;
    nameAction: "create-use-descriptive-nomus-name" | "create-use-sku-as-name-fallback";
    nomusTypeName: string | null;
    nomusGroupName: string | null;
    unitFromNomus: string | null;
    netWeightFromNomus: number | null;
    grossWeightFromNomus: number | null;
    typeAction: "create-from-nomus-inference";
    inferredType: ItemType;
    typeInferenceConfidence: "HIGH" | "LOW";
  }> = [];
  const updatesPreview: Array<{
    id: string;
    externalId: number;
    sku: string;
    name: string;
    currentName: string;
    nextName: string;
    nomusRawName: string | null;
    nomusDescription: string | null;
    chosenName: string;
    nameSource: "nome" | "descricao" | "codigo" | "none";
    nameLooksLikeSku: boolean;
    nameAction:
      | "preserve-existing-name-nomus-name-is-sku-like"
      | "no-name-change"
      | "update-name-from-nomus";
    fieldsToUpdate: string[];
    typeAction: "preserve-existing";
    weightAction: "not-mapped-no-schema-field";
    unitAction: "not-mapped-no-schema-field";
    nomusTypeName: string | null;
    nomusGroupName: string | null;
    unitFromNomus: string | null;
    netWeightFromNomus: number | null;
    grossWeightFromNomus: number | null;
    inferredType: ItemType;
    typeInferenceConfidence: "HIGH" | "LOW";
  }> = [];
  let createCount = 0;
  let updateCount = 0;
  let noChangeCount = 0;
  let nameChangeCount = 0;
  let descriptionChangeCount = 0;
  let createProductCount = 0;
  let createComponentCount = 0;
  let updateExistingProductCount = 0;
  let updateExistingComponentCount = 0;
  let createsUsingSkuAsNameCount = 0;
  let createsUsingDescriptionAsNameCount = 0;
  let updatesPreservingExistingNameCount = 0;
  let updatesChangingNameCount = 0;
  const createsUsingSkuAsNamePreview: Array<{
    sku: string;
    name: string;
    nomusRawName: string | null;
    nomusDescription: string | null;
    inferredType: ItemType;
    nomusTypeName: string | null;
  }> = [];
  const nameChangesPreview: Array<{
    sku: string;
    currentName: string;
    nextName: string;
    nameAction: "update-name-from-nomus";
    inferredType: ItemType;
    nomusTypeName: string | null;
  }> = [];
  for (const p of eligible) {
    const current = bySku.get(p.sku);
    if (!current) {
      createCount += 1;
      if (p.type === "PRODUCT") createProductCount += 1;
      if (p.type === "COMPONENT") createComponentCount += 1;
      if (p.nameLooksLikeSku) {
        createsUsingSkuAsNameCount += 1;
        if (createsUsingSkuAsNamePreview.length < 30) {
          createsUsingSkuAsNamePreview.push({
            sku: p.sku,
            name: p.chosenName,
            nomusRawName: p.nomusRawName,
            nomusDescription: p.nomusDescription,
            inferredType: p.type,
            nomusTypeName: p.nomusTypeName,
          });
        }
      }
      if (p.nameSource === "descricao") createsUsingDescriptionAsNameCount += 1;
      createsPreview.push({
        externalId: p.externalId,
        sku: p.sku,
        name: p.chosenName,
        nomusRawName: p.nomusRawName,
        nomusDescription: p.nomusDescription,
        chosenName: p.chosenName,
        nameSource: p.nameSource,
        nameLooksLikeSku: p.nameLooksLikeSku,
        nameAction: p.nameLooksLikeSku ? "create-use-sku-as-name-fallback" : "create-use-descriptive-nomus-name",
        nomusTypeName: p.nomusTypeName,
        nomusGroupName: p.nomusGroupName,
        unitFromNomus: p.unitFromNomus,
        netWeightFromNomus: p.netWeightFromNomus,
        grossWeightFromNomus: p.grossWeightFromNomus,
        typeAction: "create-from-nomus-inference",
        inferredType: p.type,
        typeInferenceConfidence: p.typeInferenceConfidence,
      });
    } else {
      if (current.type === "PRODUCT") updateExistingProductCount += 1;
      if (current.type === "COMPONENT") updateExistingComponentCount += 1;
      const fieldsToUpdate: string[] = [];
      const willUpdateName =
        !p.nameLooksLikeSku && p.chosenName.length > 0 && (current.name ?? "") !== p.chosenName;
      const currentDescription = current.description ?? null;
      const nextDescription = p.description ?? null;
      const willUpdateDescription = currentDescription !== nextDescription;
      if (willUpdateName) fieldsToUpdate.push("name");
      if (willUpdateDescription) fieldsToUpdate.push("description");
      const nextName = willUpdateName ? p.chosenName : current.name;
      let nameAction: (typeof updatesPreview)[number]["nameAction"];
      if (p.nameLooksLikeSku) {
        nameAction = "preserve-existing-name-nomus-name-is-sku-like";
      } else if (!willUpdateName) {
        nameAction = "no-name-change";
      } else {
        nameAction = "update-name-from-nomus";
      }
      if (willUpdateName) {
        nameChangeCount += 1;
        updatesChangingNameCount += 1;
        if (nameChangesPreview.length < 30) {
          nameChangesPreview.push({
            sku: p.sku,
            currentName: current.name,
            nextName: p.chosenName,
            nameAction: "update-name-from-nomus",
            inferredType: p.type,
            nomusTypeName: p.nomusTypeName,
          });
        }
      } else {
        updatesPreservingExistingNameCount += 1;
      }
      if (willUpdateDescription) descriptionChangeCount += 1;
      if (fieldsToUpdate.length > 0) updateCount += 1;
      else noChangeCount += 1;
      updatesPreview.push({
        id: current.id,
        externalId: p.externalId,
        sku: p.sku,
        name: p.chosenName,
        currentName: current.name,
        nextName,
        nomusRawName: p.nomusRawName,
        nomusDescription: p.nomusDescription,
        chosenName: p.chosenName,
        nameSource: p.nameSource,
        nameLooksLikeSku: p.nameLooksLikeSku,
        nameAction,
        fieldsToUpdate,
        typeAction: "preserve-existing",
        weightAction: "not-mapped-no-schema-field",
        unitAction: "not-mapped-no-schema-field",
        nomusTypeName: p.nomusTypeName,
        nomusGroupName: p.nomusGroupName,
        unitFromNomus: p.unitFromNomus,
        netWeightFromNomus: p.netWeightFromNomus,
        grossWeightFromNomus: p.grossWeightFromNomus,
        inferredType: p.type,
        typeInferenceConfidence: p.typeInferenceConfidence,
      });
    }
  }
  return {
    createCount,
    updateCount,
    noChangeCount,
    nameChangeCount,
    descriptionChangeCount,
    createProductCount,
    createComponentCount,
    updateExistingProductCount,
    updateExistingComponentCount,
    createsUsingSkuAsNameCount,
    createsUsingDescriptionAsNameCount,
    updatesPreservingExistingNameCount,
    updatesChangingNameCount,
    createsUsingSkuAsNamePreview,
    nameChangesPreview,
    createsPreview: createsPreview.slice(0, 50),
    updatesPreview: updatesPreview.slice(0, 50),
  };
}

async function runApply(eligible: EligibleProduct[]): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const p of eligible) {
    const current = await prisma.product.findUnique({ where: { sku: p.sku }, select: { id: true, type: true, name: true } });
    const baseData = {
      description: p.description,
      status: "ACTIVE" as const,
    };
    if (current) {
      const willUpdateName =
        !p.nameLooksLikeSku && p.chosenName.length > 0 && (current.name ?? "") !== p.chosenName;
      const data = {
        ...baseData,
        ...(willUpdateName ? { name: p.chosenName } : {}),
      };
      await prisma.product.update({ where: { id: current.id }, data });
      updated += 1;
    } else {
      await prisma.product.create({
        data: {
          ...baseData,
          sku: p.sku,
          name: p.chosenName,
          type: p.type,
        },
      });
      created += 1;
    }
  }
  return { created, updated };
}

async function main(): Promise<void> {
  const isApply = process.argv.includes("--apply");
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const raw = await fetchAllNomusProducts(baseUrl);
  const candidateSkus = raw
    .map((p) => asString(p.codigo) ?? asString(p.codigoProduto))
    .filter((x): x is string => Boolean(x));
  const existingProducts = candidateSkus.length
    ? await prisma.product.findMany({ where: { sku: { in: candidateSkus } }, select: { sku: true } })
    : [];
  const existingSkuSet = new Set(existingProducts.map((p) => p.sku));

  const { eligible, blocked, diagnostics } = mapProducts(raw, existingSkuSet);
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
          createCount: dry.createCount,
          updateCount: dry.updateCount,
          noChangeCount: dry.noChangeCount,
          nameChangeCount: dry.nameChangeCount,
          descriptionChangeCount: dry.descriptionChangeCount,
          createProductCount: dry.createProductCount,
          createComponentCount: dry.createComponentCount,
          updateExistingProductCount: dry.updateExistingProductCount,
          updateExistingComponentCount: dry.updateExistingComponentCount,
          createsUsingSkuAsNameCount: dry.createsUsingSkuAsNameCount,
          createsUsingDescriptionAsNameCount: dry.createsUsingDescriptionAsNameCount,
          updatesPreservingExistingNameCount: dry.updatesPreservingExistingNameCount,
          updatesChangingNameCount: dry.updatesChangingNameCount,
          createsUsingSkuAsNamePreview: dry.createsUsingSkuAsNamePreview,
          nameChangesPreview: dry.nameChangesPreview,
          createsPreview: dry.createsPreview,
          updatesPreview: dry.updatesPreview,
          blockedPreview: blocked.slice(0, 50),
          detectedProductKeys: diagnostics.detectedProductKeys,
          weightFieldsDetected: diagnostics.weightFieldsDetected,
          unitFieldsDetected: diagnostics.unitFieldsDetected,
          typeFieldsDetected: diagnostics.typeFieldsDetected,
          optionalLikeFieldsDetected: diagnostics.optionalLikeFieldsDetected,
          phantomLikeFieldsDetected: diagnostics.phantomLikeFieldsDetected,
          serviceLikeFieldsDetected: diagnostics.serviceLikeFieldsDetected,
          inactiveLikeFieldsDetected: diagnostics.inactiveLikeFieldsDetected,
          bomLikeFieldsDetected: diagnostics.bomLikeFieldsDetected,
          typeInferenceSummary: diagnostics.typeInferenceSummary,
          safeUpdateFields: diagnostics.safeUpdateFields,
          blockedBusinessRules: diagnostics.blockedBusinessRules,
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

