import "dotenv/config";
import { ItemType, PrismaClient } from "@prisma/client";
import { upsertNomusProductCatalogFromApiRows } from "../src/lib/nomusProductCatalog.ts";
import {
  asString,
  mapNomusProductsFromApiRows,
  nomusProductSkuFromRow,
  type NomusBlockedProduct as BlockedProduct,
  type NomusEligibleProduct as EligibleProduct,
  type NomusProductsMapDiagnostics as ProductsDiagnostics,
} from "../src/lib/nomusProductsSyncMap.ts";
import {
  loadCatalogEntityLookupMaps,
  materialBlocksProductMutation,
  resolveCatalogEntityByCode,
} from "../src/lib/nomusCatalogEntityResolve.ts";
import { normalizeSku } from "../src/lib/nomusBomComparison.ts";

const prisma = new PrismaClient();

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_RETRY_BASE_MS = 700;

type JsonObject = Record<string, unknown>;

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

export async function fetchAllNomusProducts(baseUrl: string): Promise<JsonObject[]> {
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

async function runDry(eligible: EligibleProduct[]) {
  const existing = await prisma.product.findMany({
    where: { sku: { in: eligible.map((p) => p.sku) } },
    select: { id: true, sku: true, name: true, description: true, type: true },
  });
  const bySku = new Map(existing.map((p) => [p.sku, p]));
  const catalogMaps = await loadCatalogEntityLookupMaps(
    prisma,
    eligible.map((p) => p.sku)
  );
  let recognizedAsMaterial = 0;
  let inactiveMaterialsBlocked = 0;
  let historicalClassificationConflicts = 0;
  const materialPrecedencePreview: Array<{
    sku: string;
    materialId: string | null;
    decision: string;
    message: string;
  }> = [];
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
    const resolution = resolveCatalogEntityByCode(p.sku, catalogMaps);
    if (materialBlocksProductMutation(resolution)) {
      if (resolution.status === "material_inactive") inactiveMaterialsBlocked += 1;
      else recognizedAsMaterial += 1;
      if (resolution.hasHistoricalConflict) historicalClassificationConflicts += 1;
      materialPrecedencePreview.push({
        sku: p.sku,
        materialId: resolution.materialId,
        decision: resolution.importDecision,
        message: resolution.message,
      });
      continue;
    }
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
    recognizedAsMaterial,
    inactiveMaterialsBlocked,
    historicalClassificationConflicts,
    materialPrecedencePreview: materialPrecedencePreview.slice(0, 50),
    createsUsingSkuAsNamePreview,
    nameChangesPreview,
    createsPreview: createsPreview.slice(0, 50),
    updatesPreview: updatesPreview.slice(0, 50),
  };
}

async function runApply(eligible: EligibleProduct[]): Promise<{
  created: number;
  updated: number;
  recognizedAsMaterial: number;
  inactiveMaterialsBlocked: number;
  historicalClassificationConflicts: number;
  materialPrecedenceSkipped: Array<{
    sku: string;
    materialId: string | null;
    decision: string;
    message: string;
  }>;
}> {
  let created = 0;
  let updated = 0;
  let recognizedAsMaterial = 0;
  let inactiveMaterialsBlocked = 0;
  let historicalClassificationConflicts = 0;
  const materialPrecedenceSkipped: Array<{
    sku: string;
    materialId: string | null;
    decision: string;
    message: string;
  }> = [];

  const maps = await loadCatalogEntityLookupMaps(
    prisma,
    eligible.map((p) => p.sku)
  );

  for (const p of eligible) {
    const resolution = resolveCatalogEntityByCode(p.sku, maps);
    if (materialBlocksProductMutation(resolution)) {
      if (resolution.status === "material_inactive") inactiveMaterialsBlocked += 1;
      else recognizedAsMaterial += 1;
      if (resolution.hasHistoricalConflict) historicalClassificationConflicts += 1;
      materialPrecedenceSkipped.push({
        sku: p.sku,
        materialId: resolution.materialId,
        decision: resolution.importDecision,
        message: resolution.message,
      });
      continue;
    }

    const current = await prisma.product.findFirst({
      where: { sku: { in: [p.sku, normalizeSku(p.sku)] } },
      select: { id: true, type: true, name: true },
    });
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
      // Gate final: Material pode ter sido criado entre preview/lote e create.
      const again = resolveCatalogEntityByCode(
        p.sku,
        await loadCatalogEntityLookupMaps(prisma, [p.sku])
      );
      if (materialBlocksProductMutation(again)) {
        if (again.status === "material_inactive") inactiveMaterialsBlocked += 1;
        else recognizedAsMaterial += 1;
        if (again.hasHistoricalConflict) historicalClassificationConflicts += 1;
        materialPrecedenceSkipped.push({
          sku: p.sku,
          materialId: again.materialId,
          decision: again.importDecision,
          message: again.message,
        });
        continue;
      }
      try {
        await prisma.product.create({
          data: {
            ...baseData,
            sku: p.sku,
            name: p.chosenName,
            type: p.type,
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/unique|Unique constraint/i.test(msg)) {
          materialPrecedenceSkipped.push({
            sku: p.sku,
            materialId: null,
            decision: "UNIQUE_CONFLICT",
            message: `Create ignorado por unique constraint: ${msg}`,
          });
          continue;
        }
        throw err;
      }
    }
  }

  return {
    created,
    updated,
    recognizedAsMaterial,
    inactiveMaterialsBlocked,
    historicalClassificationConflicts,
    materialPrecedenceSkipped,
  };
}

async function main(): Promise<void> {
  const isApply = process.argv.includes("--apply");
  const baseUrl = getRequiredEnv("NOMUS_BASE_URL");
  const raw = await fetchAllNomusProducts(baseUrl);
  const candidateSkus = raw
    .map((p) => nomusProductSkuFromRow(p))
    .filter((x): x is string => Boolean(x));
  const existingProducts = candidateSkus.length
    ? await prisma.product.findMany({ where: { sku: { in: candidateSkus } }, select: { sku: true } })
    : [];
  const existingSkuSet = new Set(existingProducts.map((p) => p.sku));

  const { eligible, blocked, diagnostics } = mapNomusProductsFromApiRows(raw, existingSkuSet);

  const blockedBySku = new Map<string, string[]>();
  for (const b of blocked) {
    if (b.sku) blockedBySku.set(b.sku, b.reasons);
  }
  const catalogSync = await upsertNomusProductCatalogFromApiRows(prisma, raw, blockedBySku);

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
          catalogUpserted: catalogSync.upserted,
          catalogSkipped: catalogSync.skipped,
          eligibleCount: eligible.length,
          blockedCount: blocked.length,
          blockedReasons,
          createCount: dry.createCount,
          updateCount: dry.updateCount,
          noChangeCount: dry.noChangeCount,
          recognizedAsMaterial: dry.recognizedAsMaterial,
          inactiveMaterialsBlocked: dry.inactiveMaterialsBlocked,
          historicalClassificationConflicts: dry.historicalClassificationConflicts,
          materialPrecedencePreview: dry.materialPrecedencePreview,
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

