/**
 * Carga Mestre Nomus → IndusCost.
 *
 * Fase: NOMUS-MASTER-DATA-IMPORT-A.
 *
 * Esta lib é server-side. Faz dois trabalhos:
 *  1. Diagnóstico read-only — varre NomusBomComponentStage e compara contra
 *     Product/Material existentes; classifica cada código distinto.
 *  2. Importação segura — cria apenas Product/Material classificados como
 *     SAFE_*, idempotente, sob confirmação textual explícita.
 *
 * NÃO cria ProductBOM, NÃO altera preço, proposta, pedido, tabela de preço,
 * custo histórico, costingMode ou propriedades de itens já existentes.
 */

import { prisma } from "@/src/lib/prisma";
import { normalizeSku } from "@/src/lib/nomusBomComparison";
import {
  loadCatalogEntityLookupMaps,
  materialBlocksProductMutation,
  resolveCatalogEntityByCode,
} from "@/src/lib/nomusCatalogEntityResolve";
import {
  cleanNomusDescription,
  classificationLabelFor,
  isAssemblyLocalCode,
  isBlockedClassification,
  isResolvedAmbiguityClassification,
  isSafeClassification,
  isValidCode,
} from "@/src/lib/nomusMasterDataImportShared";
import { loadProductMaterialRegistrySnapshots } from "@/src/lib/nomusProductMaterialAmbiguityEvidence";
import {
  classifyProductMaterialAmbiguity,
  masterDataClassificationFromAmbiguityStatus,
} from "@/src/lib/nomusProductMaterialAmbiguityClassify";
import type { ProductMaterialRegistrySnapshot } from "@/src/lib/nomusProductMaterialAmbiguityClassify";
import type {
  MasterDataClassification,
  MasterDataConfidence,
  MasterDataCreatePayloadPreview,
  MasterDataImportApplyReportItem,
  MasterDataImportApplyResult,
  MasterDataImportDiagnosticResult,
  MasterDataImportPreviewItem,
  MasterDataImportPreviewResult,
  MasterDataRecommendedTarget,
  MasterDataRow,
  MasterDataTotals,
} from "@/src/lib/nomusMasterDataImportTypes";
import { MASTER_DATA_CONFIRMATION_TEXT } from "@/src/lib/nomusMasterDataImportTypes";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MAX_APPLY_BATCH = 200;
const DEFAULT_MATERIAL_UNIT = "UN";
const DEFAULT_MATERIAL_CATEGORY = "NOMUS_IMPORT";
const SOURCE_SYSTEM = "NOMUS";

function clampLimit(limit?: number): number {
  const raw = Number.isFinite(limit ?? NaN) ? Number(limit) : DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(raw), 1), MAX_LIMIT);
}

function clampOffset(offset?: number): number {
  const raw = Number.isFinite(offset ?? NaN) ? Number(offset) : 0;
  return Math.max(0, Math.floor(raw));
}

type CodeAggregate = {
  code: string;
  normalized: string;
  /** Descrição preferida (prioriza componentDescription quando disponível). */
  description: string | null;
  appearsAsParent: boolean;
  appearsAsComponent: boolean;
  parentCount: number;
  componentCount: number;
  isOptional: boolean;
  isAlternative: boolean;
  examples: Set<string>;
};

async function loadCodeAggregates(): Promise<Map<string, CodeAggregate>> {
  const agg = new Map<string, CodeAggregate>();

  const ensure = (rawCode: string): CodeAggregate => {
    const trimmed = rawCode.trim();
    const key = normalizeSku(trimmed);
    const found = agg.get(key);
    if (found) return found;
    const created: CodeAggregate = {
      code: trimmed,
      normalized: key,
      description: null,
      appearsAsParent: false,
      appearsAsComponent: false,
      parentCount: 0,
      componentCount: 0,
      isOptional: false,
      isAlternative: false,
      examples: new Set<string>(),
    };
    agg.set(key, created);
    return created;
  };

  // Streaming via batches para evitar carregar tudo na memória.
  const BATCH = 2000;
  let cursorId: string | undefined = undefined;

  // Loop com cursor estável por id (string).
  // Cada iteração busca um lote pequeno.
  // Não escreve nada.
  while (true) {
    const rows = await prisma.nomusBomComponentStage.findMany({
      select: {
        id: true,
        parentCode: true,
        parentDescription: true,
        componentCode: true,
        componentDescription: true,
        opcional: true,
        alternativo: true,
      },
      take: BATCH,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      const parent = ensure(row.parentCode);
      parent.appearsAsParent = true;
      parent.parentCount += 1;
      if (!parent.description && row.parentDescription) {
        parent.description = row.parentDescription;
      }

      const child = ensure(row.componentCode);
      child.appearsAsComponent = true;
      child.componentCount += 1;
      if (!child.description && row.componentDescription) {
        child.description = row.componentDescription;
      }
      if (row.opcional === true) child.isOptional = true;
      if (row.alternativo === true) child.isAlternative = true;
      if (child.examples.size < 5) {
        child.examples.add(row.parentCode);
      }
    }

    cursorId = rows[rows.length - 1]?.id;
    if (rows.length < BATCH) break;
  }

  return agg;
}

async function resolveExistingByCodes(
  codes: string[]
): Promise<{
  productByKey: Map<string, { id: string; sku: string }>;
  materialByKey: Map<string, { id: string; code: string }>;
}> {
  const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { productByKey: new Map(), materialByKey: new Map() };
  }
  const normalizedSet = new Set(unique.map((c) => normalizeSku(c)));
  const lookupValues = [...new Set([...unique, ...normalizedSet])];

  const [products, materials] = await Promise.all([
    prisma.product.findMany({
      where: { sku: { in: lookupValues } },
      select: { id: true, sku: true },
    }),
    prisma.material.findMany({
      where: { code: { in: lookupValues } },
      select: { id: true, code: true },
    }),
  ]);

  const productByKey = new Map<string, { id: string; sku: string }>();
  for (const p of products) productByKey.set(normalizeSku(p.sku), p);
  const materialByKey = new Map<string, { id: string; code: string }>();
  for (const m of materials) materialByKey.set(normalizeSku(m.code), m);

  return { productByKey, materialByKey };
}

function classifyAggregate(
  aggCode: CodeAggregate,
  existing: { productId: string | null; materialId: string | null },
  registrySnapshot: ProductMaterialRegistrySnapshot | null
): {
  classification: MasterDataClassification;
  recommendedTarget: MasterDataRecommendedTarget;
  confidence: MasterDataConfidence;
  reason: string;
  blockers: string[];
  warnings: string[];
  payload: MasterDataCreatePayloadPreview;
} {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const cleanDescription = cleanNomusDescription(aggCode.description);

  if (existing.productId && existing.materialId && registrySnapshot) {
    const amb = classifyProductMaterialAmbiguity(registrySnapshot);
    const mapped = masterDataClassificationFromAmbiguityStatus(amb.status);
    if (mapped === "RESOLVED_AS_MATERIAL" || mapped === "RESOLVED_AS_PRODUCT") {
      return {
        classification: mapped,
        recommendedTarget: mapped === "RESOLVED_AS_MATERIAL" ? "MATERIAL" : "PRODUCT",
        confidence: "HIGH",
        reason: amb.reason,
        blockers: [],
        warnings: amb.risks,
        payload: null,
      };
    }
    return {
      classification: "EXISTING_BOTH_AMBIGUOUS",
      recommendedTarget: "NONE",
      confidence: "LOW",
      reason: amb.reason,
      blockers: ["Duplicidade Product/Material — decisão humana ou resolução controlada."],
      warnings: amb.risks,
      payload: null,
    };
  }
  if (existing.productId) {
    return {
      classification: "EXISTING_PRODUCT",
      recommendedTarget: "PRODUCT",
      confidence: "HIGH",
      reason: "Já cadastrado como Product — nada a importar.",
      blockers: [],
      warnings: [],
      payload: null,
    };
  }
  if (existing.materialId) {
    return {
      classification: "EXISTING_MATERIAL",
      recommendedTarget: "MATERIAL",
      confidence: "HIGH",
      reason: "Já cadastrado como Material — nada a importar.",
      blockers: [],
      warnings: [],
      payload: null,
    };
  }

  if (!isValidCode(aggCode.code)) {
    blockers.push("Código inválido ou vazio.");
    return {
      classification: "BLOCKED_INVALID_CODE",
      recommendedTarget: "NONE",
      confidence: "HIGH",
      reason: "Código não pode ser usado como sku/code (vazio ou inválido).",
      blockers,
      warnings,
      payload: null,
    };
  }

  if (isAssemblyLocalCode(aggCode.code)) {
    blockers.push("Código 800.xx é montagem local — não é importado automaticamente.");
    return {
      classification: "BLOCKED_LOCAL_PROCESS_CODE",
      recommendedTarget: "NONE",
      confidence: "HIGH",
      reason:
        "Códigos 800.xx representam montagem local do IndusCost e não devem ser importados automaticamente como Product/Material.",
      blockers,
      warnings,
      payload: null,
    };
  }

  if (!cleanDescription) {
    blockers.push("Descrição Nomus está vazia — não é possível cadastrar com segurança.");
    return {
      classification: "BLOCKED_MISSING_DESCRIPTION",
      recommendedTarget: "NONE",
      confidence: "HIGH",
      reason: "Sem descrição utilizável para o cadastro base.",
      blockers,
      warnings,
      payload: null,
    };
  }

  if (aggCode.isOptional) {
    warnings.push(
      "Aparece como componente opcional no Nomus — cadastro base pode ser feito, BOM/preço NÃO entram automaticamente."
    );
  }
  if (aggCode.isAlternative) {
    warnings.push(
      "Aparece como componente alternativo no Nomus — cadastro base pode ser feito, BOM/preço NÃO entram automaticamente."
    );
  }

  // Caso 1: aparece como parentCode (tem ou poderia ter BOM própria) → Product.
  if (aggCode.appearsAsParent) {
    const type: "PRODUCT" | "COMPONENT" = aggCode.appearsAsComponent ? "COMPONENT" : "PRODUCT";
    const payload: MasterDataCreatePayloadPreview = {
      kind: "PRODUCT",
      sku: aggCode.code,
      name: cleanDescription || aggCode.code,
      description: cleanDescription || null,
      type,
      sourceSystem: SOURCE_SYSTEM,
      isNomusControlled: false,
      status: "ACTIVE",
      defaultLotSize: 1,
    };
    return {
      classification: "SAFE_PRODUCT_CANDIDATE",
      recommendedTarget: "PRODUCT",
      confidence: aggCode.appearsAsComponent ? "MEDIUM" : "HIGH",
      reason: aggCode.appearsAsComponent
        ? "Aparece como pai E como componente — provável Product tipo COMPONENT."
        : "Aparece como pai com BOM Nomus — Product oficial.",
      blockers: [],
      warnings,
      payload,
    };
  }

  // Caso 2: aparece somente como componentCode → candidato a Material.
  if (aggCode.appearsAsComponent && !aggCode.appearsAsParent) {
    const payload: MasterDataCreatePayloadPreview = {
      kind: "MATERIAL",
      code: aggCode.code,
      description: cleanDescription,
      unit: DEFAULT_MATERIAL_UNIT,
      category: DEFAULT_MATERIAL_CATEGORY,
      currentCost: 0,
      averageCost: 0,
      standardCost: 0,
      freight: 0,
      standardLoss: 0,
      conversionFactor: 1,
      status: "ACTIVE",
    };
    warnings.push(
      `Unidade padrão "${DEFAULT_MATERIAL_UNIT}" e categoria "${DEFAULT_MATERIAL_CATEGORY}" usadas no cadastro base — ajustar depois conforme natureza do item.`
    );
    return {
      classification: "SAFE_MATERIAL_CANDIDATE",
      recommendedTarget: "MATERIAL",
      confidence: "HIGH",
      reason:
        "Aparece apenas como componente em BOMs Nomus, sem estrutura própria — matéria-prima/insumo seguro como Material.",
      blockers: [],
      warnings,
      payload,
    };
  }

  // Fallback (nunca deveria cair aqui, mas seguro).
  return {
    classification: "AMBIGUOUS_REVIEW",
    recommendedTarget: "NONE",
    confidence: "LOW",
    reason: "Não foi possível classificar com segurança — revisão manual.",
    blockers: [],
    warnings,
    payload: null,
  };
}

function buildRow(
  aggCode: CodeAggregate,
  existing: { productId: string | null; materialId: string | null },
  registrySnapshot: ProductMaterialRegistrySnapshot | null
): MasterDataRow {
  const cleanDescription = cleanNomusDescription(aggCode.description);
  const result = classifyAggregate(aggCode, existing, registrySnapshot);

  const canImportSafely = isSafeClassification(result.classification) && result.payload != null;

  return {
    code: aggCode.code,
    description: cleanDescription || null,
    appearsAsParent: aggCode.appearsAsParent,
    appearsAsComponent: aggCode.appearsAsComponent,
    hasOwnBom: aggCode.appearsAsParent,
    isOptional: aggCode.isOptional,
    isAlternative: aggCode.isAlternative,
    parentCount: aggCode.parentCount,
    componentCount: aggCode.componentCount,
    nomusExamples: [...aggCode.examples],
    existingProductId: existing.productId,
    existingMaterialId: existing.materialId,
    classification: result.classification,
    classificationLabel: classificationLabelFor(result.classification),
    recommendedTarget: result.recommendedTarget,
    confidence: result.confidence,
    reason: result.reason,
    blockers: result.blockers,
    warnings: result.warnings,
    canImportSafely,
    proposedCreatePayloadPreview: result.payload,
  };
}

function aggregateTotals(rowsAll: MasterDataRow[]): MasterDataTotals {
  let existingProducts = 0;
  let existingMaterials = 0;
  let existingBothAmbiguous = 0;
  let resolvedAsMaterial = 0;
  let resolvedAsProduct = 0;
  let safeProductCandidates = 0;
  let safeMaterialCandidates = 0;
  let ambiguousReview = 0;
  let blocked = 0;

  for (const r of rowsAll) {
    switch (r.classification) {
      case "EXISTING_PRODUCT":
        existingProducts += 1;
        break;
      case "EXISTING_MATERIAL":
        existingMaterials += 1;
        break;
      case "EXISTING_BOTH_AMBIGUOUS":
        existingBothAmbiguous += 1;
        break;
      case "RESOLVED_AS_MATERIAL":
        resolvedAsMaterial += 1;
        break;
      case "RESOLVED_AS_PRODUCT":
        resolvedAsProduct += 1;
        break;
      case "SAFE_PRODUCT_CANDIDATE":
        safeProductCandidates += 1;
        break;
      case "SAFE_MATERIAL_CANDIDATE":
        safeMaterialCandidates += 1;
        break;
      case "AMBIGUOUS_REVIEW":
        ambiguousReview += 1;
        break;
      case "BLOCKED_INVALID_CODE":
      case "BLOCKED_LOCAL_PROCESS_CODE":
      case "BLOCKED_MISSING_DESCRIPTION":
      case "BLOCKED_UNSUPPORTED_REQUIRED_FIELDS":
        blocked += 1;
        break;
      case "SKIPPED_OPTIONAL_MASTER_ALREADY_EXISTS":
        // não conta em nenhum dos buckets principais
        break;
    }
  }

  const missingTotal = safeProductCandidates + safeMaterialCandidates + ambiguousReview + blocked;
  return {
    distinctNomusCodes: rowsAll.length,
    existingProducts,
    existingMaterials,
    existingBothAmbiguous,
    resolvedAsMaterial,
    resolvedAsProduct,
    missingTotal,
    safeProductCandidates,
    safeMaterialCandidates,
    ambiguousReview,
    blocked,
  };
}

export type BuildMasterDataDiagnosticInput = {
  limit?: number;
  offset?: number;
  search?: string;
  classification?: string;
  includeExisting?: boolean;
};

async function buildAllRows(): Promise<MasterDataRow[]> {
  const agg = await loadCodeAggregates();
  const allCodes = [...agg.values()].map((c) => c.code);
  const { productByKey, materialByKey } = await resolveExistingByCodes(allCodes);

  const bothCodes = allCodes.filter(
    (c) =>
      productByKey.has(normalizeSku(c)) && materialByKey.has(normalizeSku(c))
  );
  const registrySnapshots = await loadProductMaterialRegistrySnapshots(bothCodes);

  const rows: MasterDataRow[] = [];
  for (const aggCode of agg.values()) {
    const existing = {
      productId: productByKey.get(aggCode.normalized)?.id ?? null,
      materialId: materialByKey.get(aggCode.normalized)?.id ?? null,
    };
    const registrySnapshot =
      existing.productId && existing.materialId
        ? (registrySnapshots.get(aggCode.normalized) ?? null)
        : null;
    rows.push(buildRow(aggCode, existing, registrySnapshot));
  }

  // Ordena: bloqueios e ambíguos primeiro, depois seguros, depois existentes.
  const orderWeight: Record<MasterDataRow["classification"], number> = {
    BLOCKED_INVALID_CODE: 0,
    BLOCKED_LOCAL_PROCESS_CODE: 0,
    BLOCKED_MISSING_DESCRIPTION: 0,
    BLOCKED_UNSUPPORTED_REQUIRED_FIELDS: 0,
    AMBIGUOUS_REVIEW: 1,
    EXISTING_BOTH_AMBIGUOUS: 1,
    RESOLVED_AS_MATERIAL: 4,
    RESOLVED_AS_PRODUCT: 4,
    SAFE_PRODUCT_CANDIDATE: 2,
    SAFE_MATERIAL_CANDIDATE: 2,
    EXISTING_PRODUCT: 3,
    EXISTING_MATERIAL: 3,
    SKIPPED_OPTIONAL_MASTER_ALREADY_EXISTS: 3,
  };
  rows.sort((a, b) => {
    const wa = orderWeight[a.classification];
    const wb = orderWeight[b.classification];
    if (wa !== wb) return wa - wb;
    return a.code.localeCompare(b.code, "pt-BR", { numeric: true });
  });
  return rows;
}

function filterRows(
  rows: MasterDataRow[],
  filters: { search?: string; classification?: string; includeExisting?: boolean }
): MasterDataRow[] {
  const search = filters.search?.trim().toLowerCase() ?? "";
  const wantedClass = filters.classification?.trim() ?? "";
  const includeExisting = filters.includeExisting === true;

  return rows.filter((r) => {
    if (!includeExisting) {
      if (
        r.classification === "EXISTING_PRODUCT" ||
        r.classification === "EXISTING_MATERIAL" ||
        isResolvedAmbiguityClassification(r.classification)
      ) {
        return false;
      }
    }
    if (wantedClass) {
      if (wantedClass === "MISSING") {
        if (
          r.classification === "EXISTING_PRODUCT" ||
          r.classification === "EXISTING_MATERIAL" ||
          isResolvedAmbiguityClassification(r.classification)
        ) {
          return false;
        }
      } else if (wantedClass === "ALL_SAFE") {
        if (!isSafeClassification(r.classification)) return false;
      } else if (wantedClass === "ALL_BLOCKED") {
        if (
          !isBlockedClassification(r.classification) &&
          r.classification !== "EXISTING_BOTH_AMBIGUOUS" &&
          r.classification !== "AMBIGUOUS_REVIEW"
        ) {
          return false;
        }
      } else if (wantedClass === "RESOLVED_ALL") {
        if (!isResolvedAmbiguityClassification(r.classification)) return false;
      } else if (r.classification !== wantedClass) {
        return false;
      }
    }
    if (search) {
      const hay = `${r.code} ${r.description ?? ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

export async function buildNomusMasterDataImportDiagnostic(
  input: BuildMasterDataDiagnosticInput = {}
): Promise<MasterDataImportDiagnosticResult> {
  const generatedAt = new Date().toISOString();
  const limit = clampLimit(input.limit);
  const offset = clampOffset(input.offset);

  const allRows = await buildAllRows();
  const totals = aggregateTotals(allRows);
  const filtered = filterRows(allRows, {
    search: input.search,
    classification: input.classification,
    includeExisting: input.includeExisting,
  });

  const page = filtered.slice(offset, offset + limit);
  const hasMore = offset + page.length < filtered.length;
  const nextOffset = hasMore ? offset + limit : null;

  return {
    mode: "READ_ONLY",
    generatedAt,
    totals,
    rows: page,
    pagination: {
      limit,
      offset,
      hasMore,
      nextOffset,
      totalRowsMatched: filtered.length,
    },
    warnings: [],
  };
}

export type BuildMasterDataPreviewInput = {
  classification?: "SAFE_PRODUCT_CANDIDATE" | "SAFE_MATERIAL_CANDIDATE" | "ALL_SAFE";
  codes?: string[];
};

function toPreviewItem(row: MasterDataRow): MasterDataImportPreviewItem {
  return {
    code: row.code,
    description: row.description,
    classification: row.classification,
    recommendedTarget: row.recommendedTarget,
    payload: row.proposedCreatePayloadPreview,
    reason: row.reason,
  };
}

export async function buildNomusMasterDataImportPreview(
  input: BuildMasterDataPreviewInput = {}
): Promise<MasterDataImportPreviewResult> {
  const generatedAt = new Date().toISOString();
  const allRows = await buildAllRows();

  const wantedClassification = input.classification ?? "ALL_SAFE";
  const codesSet = input.codes && input.codes.length > 0
    ? new Set(input.codes.map((c) => normalizeSku(c)))
    : null;

  const candidates = allRows.filter((r) => {
    if (codesSet && !codesSet.has(normalizeSku(r.code))) return false;
    if (wantedClassification === "ALL_SAFE") return isSafeClassification(r.classification);
    return r.classification === wantedClassification;
  });

  const toCreate: MasterDataImportPreviewItem[] = [];
  const skippedExisting: MasterDataImportPreviewItem[] = [];
  const blocked: MasterDataImportPreviewItem[] = [];

  for (const row of candidates) {
    if (isSafeClassification(row.classification) && row.proposedCreatePayloadPreview) {
      toCreate.push(toPreviewItem(row));
    } else if (
      row.classification === "EXISTING_PRODUCT" ||
      row.classification === "EXISTING_MATERIAL" ||
      row.classification === "EXISTING_BOTH_AMBIGUOUS" ||
      row.classification === "RESOLVED_AS_MATERIAL" ||
      row.classification === "RESOLVED_AS_PRODUCT" ||
      row.classification === "SKIPPED_OPTIONAL_MASTER_ALREADY_EXISTS"
    ) {
      skippedExisting.push(toPreviewItem(row));
    } else {
      blocked.push(toPreviewItem(row));
    }
  }

  const productsPlanned = toCreate.filter((i) => i.payload?.kind === "PRODUCT").length;
  const materialsPlanned = toCreate.filter((i) => i.payload?.kind === "MATERIAL").length;

  return {
    mode: "READ_ONLY",
    generatedAt,
    totals: {
      candidatesPlanned: toCreate.length,
      productsPlanned,
      materialsPlanned,
      skippedExistingPlanned: skippedExisting.length,
      blockedPlanned: blocked.length,
    },
    toCreate,
    skippedExisting,
    blocked,
  };
}

export type ApplyMasterDataImportInput = {
  mode: "SAFE_ONLY";
  codes?: string[];
  confirmationText: string;
  requestedBy?: string;
};

export async function applyNomusMasterDataImport(
  input: ApplyMasterDataImportInput
): Promise<MasterDataImportApplyResult> {
  const generatedAt = new Date().toISOString();

  if (input.mode !== "SAFE_ONLY") {
    return {
      mode: "APPLY_SAFE",
      generatedAt,
      status: "BLOCKED",
      message: "Apenas mode=SAFE_ONLY é aceito nesta fase.",
      createdProducts: 0,
      createdMaterials: 0,
      skippedExisting: 0,
      blocked: 0,
      errors: 0,
      totalRequested: 0,
      report: [],
    };
  }

  if (input.confirmationText !== MASTER_DATA_CONFIRMATION_TEXT) {
    return {
      mode: "APPLY_SAFE",
      generatedAt,
      status: "BLOCKED",
      message: `Confirmação inválida — envie confirmationText exatamente igual a: "${MASTER_DATA_CONFIRMATION_TEXT}".`,
      createdProducts: 0,
      createdMaterials: 0,
      skippedExisting: 0,
      blocked: 0,
      errors: 0,
      totalRequested: 0,
      report: [],
    };
  }

  const preview = await buildNomusMasterDataImportPreview({
    classification: "ALL_SAFE",
    codes: input.codes,
  });

  const totalRequested = preview.toCreate.length;
  if (totalRequested === 0) {
    return {
      mode: "APPLY_SAFE",
      generatedAt,
      status: "NO_CHANGES",
      message: "Nenhum item seguro para importar com os filtros atuais.",
      createdProducts: 0,
      createdMaterials: 0,
      skippedExisting: 0,
      blocked: 0,
      errors: 0,
      totalRequested: 0,
      report: [],
    };
  }

  if (totalRequested > MAX_APPLY_BATCH) {
    return {
      mode: "APPLY_SAFE",
      generatedAt,
      status: "BLOCKED",
      message: `Lote acima do limite seguro (${MAX_APPLY_BATCH}). Filtre por códigos ou rode em batches menores.`,
      createdProducts: 0,
      createdMaterials: 0,
      skippedExisting: 0,
      blocked: 0,
      errors: 0,
      totalRequested,
      report: [],
    };
  }

  const report: MasterDataImportApplyReportItem[] = [];
  let createdProducts = 0;
  let createdMaterials = 0;
  let skippedExisting = 0;
  let blocked = 0;
  let errors = 0;

  for (const item of preview.toCreate) {
    const payload = item.payload;
    if (!payload) {
      blocked += 1;
      report.push({
        code: item.code,
        description: item.description,
        kind: "MATERIAL",
        outcome: "BLOCKED",
        message: "Payload de criação ausente — não foi possível importar.",
        createdId: null,
      });
      continue;
    }

    try {
      if (payload.kind === "PRODUCT") {
        // Precedência Material: nunca criar Product se Material.code já existe.
        const catalog = resolveCatalogEntityByCode(
          payload.sku,
          await loadCatalogEntityLookupMaps(prisma, [payload.sku])
        );
        if (materialBlocksProductMutation(catalog)) {
          skippedExisting += 1;
          report.push({
            code: item.code,
            description: item.description,
            kind: "PRODUCT",
            outcome: "SKIPPED_EXISTING",
            message: catalog.message,
            createdId: catalog.materialId,
          });
          continue;
        }
        // Idempotência: verifica novamente antes de criar.
        const existing = await prisma.product.findFirst({
          where: { sku: { in: [payload.sku, normalizeSku(payload.sku)] } },
          select: { id: true, sku: true },
        });
        if (existing) {
          skippedExisting += 1;
          report.push({
            code: item.code,
            description: item.description,
            kind: "PRODUCT",
            outcome: "SKIPPED_EXISTING",
            message: `Product já existia no momento da escrita (sku=${existing.sku}).`,
            createdId: existing.id,
          });
          continue;
        }
        const created = await prisma.product.create({
          data: {
            sku: payload.sku,
            name: payload.name,
            description: payload.description,
            type: payload.type,
            sourceSystem: payload.sourceSystem,
            isNomusControlled: payload.isNomusControlled,
            status: payload.status,
            defaultLotSize: payload.defaultLotSize,
            version: "1.0.0",
          },
          select: { id: true, sku: true },
        });
        createdProducts += 1;
        report.push({
          code: item.code,
          description: item.description,
          kind: "PRODUCT",
          outcome: "CREATED",
          message: `Product criado (sku=${created.sku}).`,
          createdId: created.id,
        });
      } else {
        const existing = await prisma.material.findFirst({
          where: { code: { in: [payload.code, normalizeSku(payload.code)] } },
          select: { id: true, code: true },
        });
        if (existing) {
          skippedExisting += 1;
          report.push({
            code: item.code,
            description: item.description,
            kind: "MATERIAL",
            outcome: "SKIPPED_EXISTING",
            message: `Material já existia no momento da escrita (code=${existing.code}).`,
            createdId: existing.id,
          });
          continue;
        }
        const created = await prisma.material.create({
          data: {
            code: payload.code,
            description: payload.description,
            unit: payload.unit,
            category: payload.category,
            currentCost: payload.currentCost,
            averageCost: payload.averageCost,
            standardCost: payload.standardCost,
            freight: payload.freight,
            standardLoss: payload.standardLoss,
            conversionFactor: payload.conversionFactor,
            status: payload.status,
          },
          select: { id: true, code: true },
        });
        createdMaterials += 1;
        report.push({
          code: item.code,
          description: item.description,
          kind: "MATERIAL",
          outcome: "CREATED",
          message: `Material criado (code=${created.code}).`,
          createdId: created.id,
        });
      }
    } catch (err) {
      errors += 1;
      report.push({
        code: item.code,
        description: item.description,
        kind: payload.kind,
        outcome: "FAILED",
        message: err instanceof Error ? err.message : String(err),
        createdId: null,
      });
    }
  }

  const created = createdProducts + createdMaterials;
  let status: MasterDataImportApplyResult["status"];
  if (errors > 0 && created === 0) status = "FAILED";
  else if (created === 0) status = "NO_CHANGES";
  else status = "APPLIED";

  const message =
    status === "APPLIED"
      ? `Importação concluída: ${createdProducts} produto(s) e ${createdMaterials} material(is) criados.`
      : status === "NO_CHANGES"
        ? "Nenhum item foi criado (todos já existiam ou foram bloqueados)."
        : "Importação falhou — ver relatório.";

  return {
    mode: "APPLY_SAFE",
    generatedAt,
    status,
    message,
    createdProducts,
    createdMaterials,
    skippedExisting,
    blocked,
    errors,
    totalRequested,
    report,
  };
}
