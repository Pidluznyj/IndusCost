/**
 * Congelamento oficial: CIU da Engenharia → ProductionCostTableVersion / Item.
 * Reutiliza getProductCostAnalysis — não duplica fórmula industrial.
 */
import type { PrismaClient } from "@prisma/client";
import { startOfCivilDate, toCivilDateKey } from "./financeCivilDate.js";
import type { ProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";
import {
  resolveOfficialProductFinalCostFromAnalysis,
  firstOfficialProductFinalCostDiagnostic,
} from "./productOfficialFinalCost.js";
import {
  buildProductionCostCalculationHash,
  buildProductionCostCalculationSnapshot,
  buildProductionCostDraftItemFromAnalysis,
} from "./productionCostPublication.js";
import {
  publishProductionCostVersionFromDraft,
} from "./productionCostPublication.server.js";
import {
  addOrUpdateProductionCostTableDraftItem,
  createProductionCostTableDraft,
  getEffectiveProductProductionCost,
} from "./productionCostTables.server.js";
import {
  incrementalProductionCostVersionCode,
  incrementalProductionCostVersionName,
  isCalculableProductionUnitCost,
  PRODUCTION_COST_ENGINEERING_SNAPSHOT_SOURCE,
  readProductEngineeringCostSnapshotConfig,
  resolveFrozenCostTraceStatus,
  type FrozenCostTraceStatus,
} from "./productEngineeringCostSnapshot.js";

export type ProductEngineeringCostSnapshotInput = {
  productId: string;
  productCode?: string | null;
  reason: string;
  changedBy?: string | null;
  effectiveDate?: Date;
  sourceEntity?: string | null;
  sourceAction?: string | null;
  /** Sobrescreve config de ambiente para esta chamada. */
  autoPublish?: boolean;
};

export type ProductEngineeringCostSnapshotResult = {
  status:
    | "OK"
    | "UNCHANGED"
    | "SEM_CUSTO"
    | "SKIPPED"
    | "ERROR"
    | "DRAFT_CREATED"
    | "PUBLISHED";
  productId: string;
  productCode: string | null;
  unitProductionCost: number | null;
  breakdown: Record<string, number> | null;
  calculationHash: string | null;
  calculationSnapshot: unknown;
  costTableVersionId: string | null;
  costTableItemId: string | null;
  published: boolean;
  warnings: string[];
  errors: string[];
};

export type BootstrapProductionCostPreviewRow = {
  productId: string;
  sku: string;
  productName: string;
  unitProductionCost: number | null;
  calculable: boolean;
  calculationHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  warning: string | null;
};

export type BootstrapProductionCostPreview = {
  productsEvaluated: number;
  calculableCount: number;
  semCustoCount: number;
  topByCost: BootstrapProductionCostPreviewRow[];
  sampleProduct: BootstrapProductionCostPreviewRow | null;
  errors: Array<{ sku: string; code: string; message: string }>;
  warnings: Array<{ sku: string; code: string; message: string }>;
};

export type BootstrapProductionCostApplyInput = {
  effectiveDate: Date;
  code: string;
  name: string;
  onlyProductCode?: string | null;
  createdBy?: string | null;
  publish?: boolean;
  publishedBy?: string | null;
  notes?: string | null;
};

function decimalToNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function findLatestCostItemForProduct(db: PrismaClient, productId: string) {
  return db.productionCostTableItem.findFirst({
    where: { productId },
    orderBy: [{ createdAt: "desc" }],
    include: {
      costTableVersion: {
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          revision: true,
          effectiveDate: true,
          publishedAt: true,
        },
      },
    },
  });
}

async function findLatestDraftItemForProduct(db: PrismaClient, productId: string) {
  return db.productionCostTableItem.findFirst({
    where: { productId, costTableVersion: { status: "DRAFT" } },
    orderBy: [{ createdAt: "desc" }],
    include: {
      costTableVersion: {
        select: {
          id: true,
          code: true,
          status: true,
          revision: true,
          effectiveDate: true,
        },
      },
    },
  });
}

export async function evaluateProductEngineeringCost(
  db: PrismaClient,
  engine: ProductCostAnalysisEngine,
  productId: string
): Promise<{
  product: { id: string; sku: string; name: string; type: string; status: string } | null;
  analysis: unknown;
  resolved: ReturnType<typeof resolveOfficialProductFinalCostFromAnalysis>;
  calculable: boolean;
  calculationHash: string | null;
  calculationSnapshot: unknown;
  errorMessage: string | null;
  errorCode: string | null;
  warning: string | null;
}> {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, name: true, type: true, status: true },
  });
  if (!product) {
    return {
      product: null,
      analysis: null,
      resolved: {
        ok: false,
        productId,
        sku: null,
        diagnostics: [{ code: "CUSTO_OFICIAL_NAO_CALCULADO", message: "Produto não encontrado." }],
      },
      calculable: false,
      calculationHash: null,
      calculationSnapshot: null,
      errorMessage: "Produto não encontrado.",
      errorCode: "PRODUCT_NOT_FOUND",
      warning: null,
    };
  }

  if (product.type !== "PRODUCT") {
    return {
      product,
      analysis: null,
      resolved: {
        ok: false,
        productId,
        sku: product.sku,
        diagnostics: [
          { code: "CUSTO_OFICIAL_NAO_CALCULADO", message: "Apenas produtos finais geram custo congelado." },
        ],
      },
      calculable: false,
      calculationHash: null,
      calculationSnapshot: null,
      errorMessage: "Componentes não geram item de tabela de produção.",
      errorCode: "NOT_PRODUCT",
      warning: null,
    };
  }

  const cache = await engine.initAnalysisCache();
  const analysis = await engine.getProductCostAnalysis(product.id, cache, true);

  if (engine.isCostAnalysisFailure(analysis)) {
    return {
      product,
      analysis,
      resolved: {
        ok: false,
        productId: product.id,
        sku: product.sku,
        diagnostics: [
          {
            code: "MOTOR_ERROR",
            message: engine.describeCostAnalysisFailure(analysis),
            motorError: String((analysis as { error?: string }).error ?? "MOTOR_ERROR"),
          },
        ],
      },
      calculable: false,
      calculationHash: null,
      calculationSnapshot: null,
      errorMessage: engine.describeCostAnalysisFailure(analysis),
      errorCode: String((analysis as { error?: string }).error ?? "MOTOR_ERROR"),
      warning: null,
    };
  }

  const resolved = resolveOfficialProductFinalCostFromAnalysis(analysis);
  if (!resolved.ok) {
    const diag = firstOfficialProductFinalCostDiagnostic(resolved);
    return {
      product,
      analysis,
      resolved,
      calculable: false,
      calculationHash: null,
      calculationSnapshot: null,
      errorMessage: diag?.message ?? "Custo não calculável.",
      errorCode: diag?.code ?? "CUSTO_OFICIAL_NAO_CALCULADO",
      warning: null,
    };
  }

  const calculable = isCalculableProductionUnitCost(resolved, analysis);
  if (!calculable) {
    return {
      product,
      analysis,
      resolved,
      calculable: false,
      calculationHash: null,
      calculationSnapshot: null,
      errorMessage:
        resolved.finalUnitCost === 0
          ? "Custo zero não explícito — tratado como SEM_CUSTO."
          : "Custo não calculável.",
      errorCode: "SEM_CUSTO",
      warning: null,
    };
  }

  const snapshot = buildProductionCostCalculationSnapshot(resolved, analysis);
  const calculationHash = buildProductionCostCalculationHash(snapshot);
  const warning = resolved.costAnalysisPartial
    ? "Análise de custo parcial — revise antes de publicar."
    : null;

  return {
    product,
    analysis,
    resolved,
    calculable: true,
    calculationHash,
    calculationSnapshot: snapshot,
    errorMessage: null,
    errorCode: null,
    warning,
  };
}

export async function refreshProductProductionCostSnapshot(
  db: PrismaClient,
  engine: ProductCostAnalysisEngine,
  input: ProductEngineeringCostSnapshotInput
): Promise<ProductEngineeringCostSnapshotResult> {
  const config = readProductEngineeringCostSnapshotConfig();
  const autoPublish = input.autoPublish ?? config.autoPublishEngineeringCostSnapshots;

  const base: ProductEngineeringCostSnapshotResult = {
    status: "ERROR",
    productId: input.productId,
    productCode: input.productCode ?? null,
    unitProductionCost: null,
    breakdown: null,
    calculationHash: null,
    calculationSnapshot: null,
    costTableVersionId: null,
    costTableItemId: null,
    published: false,
    warnings: [],
    errors: [],
  };

  if (!config.autoGenerateDraft && input.autoPublish !== true) {
    return { ...base, status: "SKIPPED", warnings: ["autoGenerateDraft desabilitado."] };
  }

  try {
    const evaluated = await evaluateProductEngineeringCost(db, engine, input.productId);
    if (!evaluated.product) {
      return {
        ...base,
        status: "ERROR",
        errors: [evaluated.errorMessage ?? "Produto não encontrado."],
      };
    }

    base.productCode = evaluated.product.sku;

    if (!evaluated.calculable || !evaluated.resolved.ok) {
      return {
        ...base,
        status: "SEM_CUSTO",
        errors: [evaluated.errorMessage ?? "SEM_CUSTO"],
      };
    }

    if (evaluated.warning) base.warnings.push(evaluated.warning);

    const latestItem = await findLatestCostItemForProduct(db, input.productId);
    if (latestItem?.calculationHash && latestItem.calculationHash === evaluated.calculationHash) {
      return {
        ...base,
        status: "UNCHANGED",
        unitProductionCost: evaluated.resolved.finalUnitCost,
        calculationHash: evaluated.calculationHash,
        calculationSnapshot: evaluated.calculationSnapshot,
        costTableVersionId: latestItem.costTableVersionId,
        costTableItemId: latestItem.id,
        breakdown: {
          materialCost: decimalToNumber(latestItem.materialCost),
          laborCost: decimalToNumber(latestItem.laborCost),
          machineCost: decimalToNumber(latestItem.machineCost),
        },
      };
    }

    const effectiveDate = startOfCivilDate(input.effectiveDate ?? new Date());
    const code = incrementalProductionCostVersionCode(effectiveDate, evaluated.product.sku);
    const name = incrementalProductionCostVersionName(evaluated.product.sku);

    const maxRevisionRow = await db.productionCostTableVersion.findFirst({
      where: { code },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    const nextRevision = (maxRevisionRow?.revision ?? 0) + 1;

    const notes = [
      input.reason,
      input.sourceEntity ? `entity=${input.sourceEntity}` : null,
      input.sourceAction ? `action=${input.sourceAction}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    const draft = await createProductionCostTableDraft(db, {
      code,
      name,
      effectiveDate,
      revision: nextRevision,
      source: PRODUCTION_COST_ENGINEERING_SNAPSHOT_SOURCE,
      notes: notes || null,
      createdBy: input.changedBy?.trim() || null,
    });

    const itemInput = buildProductionCostDraftItemFromAnalysis(
      evaluated.product,
      evaluated.resolved,
      evaluated.analysis
    );
    const item = await addOrUpdateProductionCostTableDraftItem(db, draft.id, itemInput);

    const result: ProductEngineeringCostSnapshotResult = {
      ...base,
      status: "DRAFT_CREATED",
      unitProductionCost: evaluated.resolved.finalUnitCost,
      breakdown: itemInput.materialCost != null
        ? {
            materialCost: itemInput.materialCost,
            laborCost: itemInput.laborCost ?? 0,
            machineCost: itemInput.machineCost ?? 0,
          }
        : null,
      calculationHash: evaluated.calculationHash,
      calculationSnapshot: evaluated.calculationSnapshot,
      costTableVersionId: draft.id,
      costTableItemId: item.id,
      published: false,
    };

    if (autoPublish) {
      if (!input.changedBy?.trim()) {
        result.warnings.push("autoPublish exige changedBy — permanece DRAFT.");
        return result;
      }
      const published = await publishProductionCostVersionFromDraft(db, {
        versionId: draft.id,
        publishedBy: input.changedBy.trim(),
        supersedeVersionId: null,
      });
      result.status = "PUBLISHED";
      result.published = true;
      result.costTableVersionId = published.id;
      return result;
    }

    return result;
  } catch (error) {
    return {
      ...base,
      status: "ERROR",
      errors: [error instanceof Error ? error.message : "Erro inesperado."],
    };
  }
}

/** Alias recomendado para hooks de alteração de engenharia. */
export const markProductProductionCostDirtyAndSnapshot = refreshProductProductionCostSnapshot;

export type ProductFrozenCostTrace = {
  productId: string;
  productCode: string;
  liveCiu: number | null;
  liveHash: string | null;
  frozenCost: number | null;
  frozenHash: string | null;
  frozenVersionCode: string | null;
  frozenVersionRevision: number | null;
  frozenVersionStatus: string | null;
  frozenEffectiveDate: string | null;
  frozenVersionId: string | null;
  frozenItemId: string | null;
  draftVersionId: string | null;
  draftHash: string | null;
  traceStatus: FrozenCostTraceStatus;
};

export async function getProductFrozenCostTracesBatch(
  db: PrismaClient,
  productIds: string[],
  referenceDate: Date = new Date()
): Promise<Map<string, Omit<ProductFrozenCostTrace, "liveCiu" | "liveHash">>> {
  const ref = startOfCivilDate(referenceDate);
  const out = new Map<string, Omit<ProductFrozenCostTrace, "liveCiu" | "liveHash">>();

  if (productIds.length === 0) return out;

  const pairs = productIds.map((productId) => ({ productId, referenceDate: ref }));
  const { getEffectiveProductProductionCostsForPairs } = await import(
    "./productionCostTables.server.js"
  );
  const effectiveMap = await getEffectiveProductProductionCostsForPairs(db, pairs);

  const draftItems = await db.productionCostTableItem.findMany({
    where: {
      productId: { in: productIds },
      costTableVersion: { status: "DRAFT" },
    },
    orderBy: { createdAt: "desc" },
    include: {
      costTableVersion: {
        select: { id: true, status: true },
      },
    },
  });
  const draftByProduct = new Map<string, (typeof draftItems)[0]>();
  for (const row of draftItems) {
    if (!draftByProduct.has(row.productId)) draftByProduct.set(row.productId, row);
  }

  const publishedItemIds = [...effectiveMap.values()]
    .filter((r) => r.status === "OK")
    .map((r) => r.costTableItemId);
  const publishedItems =
    publishedItemIds.length > 0
      ? await db.productionCostTableItem.findMany({
          where: { id: { in: publishedItemIds } },
          select: { id: true, calculationHash: true },
        })
      : [];
  const hashByItemId = new Map(publishedItems.map((r) => [r.id, r.calculationHash]));

  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true },
  });
  const skuById = new Map(products.map((p) => [p.id, p.sku]));

  for (const productId of productIds) {
    const key = `${productId}|${toCivilDateKey(ref)}`;
    const effective = effectiveMap.get(key);
    const draftItem = draftByProduct.get(productId);
    const publishedHash =
      effective?.status === "OK"
        ? (hashByItemId.get(effective.costTableItemId) ?? null)
        : null;
    out.set(productId, {
      productId,
      productCode: skuById.get(productId) ?? "",
      frozenCost: effective?.status === "OK" ? effective.unitProductionCost : null,
      frozenHash: publishedHash,
      frozenVersionCode: effective?.status === "OK" ? effective.versionCode : null,
      frozenVersionRevision: effective?.status === "OK" ? effective.revision : null,
      frozenVersionStatus: effective?.status === "OK" ? "PUBLISHED" : null,
      frozenEffectiveDate:
        effective?.status === "OK" ? toCivilDateKey(effective.effectiveDate) : null,
      frozenVersionId: effective?.status === "OK" ? effective.costTableVersionId : null,
      frozenItemId: effective?.status === "OK" ? effective.costTableItemId : null,
      draftVersionId: draftItem?.costTableVersionId ?? null,
      draftHash: draftItem?.calculationHash ?? null,
      traceStatus: "SEM_CUSTO_CONGELADO",
    });
  }

  return out;
}

export async function getProductFrozenCostTrace(
  db: PrismaClient,
  engine: ProductCostAnalysisEngine,
  productId: string,
  referenceDate: Date = new Date()
): Promise<ProductFrozenCostTrace | null> {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, sku: true, type: true },
  });
  if (!product) return null;

  const evaluated = await evaluateProductEngineeringCost(db, engine, productId);
  const liveCiu =
    evaluated.calculable && evaluated.resolved.ok ? evaluated.resolved.finalUnitCost : null;
  const liveHash = evaluated.calculationHash;

  const effective = await getEffectiveProductProductionCost(db, productId, referenceDate);
  const draftItem = await findLatestDraftItemForProduct(db, productId);

  const traceStatus = resolveFrozenCostTraceStatus({
    liveCiu,
    liveHash,
    publishedCost: effective.status === "OK" ? effective.unitProductionCost : null,
    publishedHash:
      effective.status === "OK"
        ? ((effective.calculationSnapshot as { hash?: string } | null)?.hash ??
          null)
        : null,
    publishedVersionStatus: effective.status === "OK" ? "PUBLISHED" : null,
    draftHash: draftItem?.calculationHash ?? null,
    draftVersionStatus: draftItem?.costTableVersion.status ?? null,
  });

  // published hash from item row when available
  let publishedHash: string | null = null;
  if (effective.status === "OK") {
    const pubItem = await db.productionCostTableItem.findUnique({
      where: { id: effective.costTableItemId },
      select: { calculationHash: true },
    });
    publishedHash = pubItem?.calculationHash ?? null;
    const refinedStatus = resolveFrozenCostTraceStatus({
      liveCiu,
      liveHash,
      publishedCost: effective.unitProductionCost,
      publishedHash,
      publishedVersionStatus: "PUBLISHED",
      draftHash: draftItem?.calculationHash ?? null,
      draftVersionStatus: draftItem?.costTableVersion.status ?? null,
    });
    return {
      productId: product.id,
      productCode: product.sku,
      liveCiu,
      liveHash,
      frozenCost: effective.status === "OK" ? effective.unitProductionCost : null,
      frozenHash: publishedHash,
      frozenVersionCode: effective.status === "OK" ? effective.versionCode : null,
      frozenVersionRevision: effective.status === "OK" ? effective.revision : null,
      frozenVersionStatus: effective.status === "OK" ? "PUBLISHED" : null,
      frozenEffectiveDate:
        effective.status === "OK" ? toCivilDateKey(effective.effectiveDate) : null,
      frozenVersionId: effective.status === "OK" ? effective.costTableVersionId : null,
      frozenItemId: effective.status === "OK" ? effective.costTableItemId : null,
      draftVersionId: draftItem?.costTableVersionId ?? null,
      draftHash: draftItem?.calculationHash ?? null,
      traceStatus: refinedStatus,
    };
  }

  return {
    productId: product.id,
    productCode: product.sku,
    liveCiu,
    liveHash,
    frozenCost: null,
    frozenHash: null,
    frozenVersionCode: null,
    frozenVersionRevision: null,
    frozenVersionStatus: null,
    frozenEffectiveDate: null,
    frozenVersionId: null,
    frozenItemId: null,
    draftVersionId: draftItem?.costTableVersionId ?? null,
    draftHash: draftItem?.calculationHash ?? null,
    traceStatus,
  };
}

export async function previewBootstrapProductionCostTableFromEngineering(
  db: PrismaClient,
  engine: ProductCostAnalysisEngine,
  options?: { onlyProductCode?: string | null }
): Promise<BootstrapProductionCostPreview> {
  const where = {
    status: "ACTIVE" as const,
    type: "PRODUCT" as const,
    ...(options?.onlyProductCode?.trim() ? { sku: options.onlyProductCode.trim() } : {}),
  };

  const products = await db.product.findMany({
    where,
    select: { id: true, sku: true, name: true },
    orderBy: { sku: "asc" },
  });

  const rows: BootstrapProductionCostPreviewRow[] = [];
  const errors: BootstrapProductionCostPreview["errors"] = [];
  const warnings: BootstrapProductionCostPreview["warnings"] = [];

  for (const product of products) {
    const evaluated = await evaluateProductEngineeringCost(db, engine, product.id);
    const row: BootstrapProductionCostPreviewRow = {
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      unitProductionCost:
        evaluated.calculable && evaluated.resolved.ok ? evaluated.resolved.finalUnitCost : null,
      calculable: evaluated.calculable,
      calculationHash: evaluated.calculationHash,
      errorCode: evaluated.errorCode,
      errorMessage: evaluated.errorMessage,
      warning: evaluated.warning,
    };
    rows.push(row);
    if (evaluated.errorCode && evaluated.errorMessage) {
      errors.push({ sku: product.sku, code: evaluated.errorCode, message: evaluated.errorMessage });
    }
    if (evaluated.warning) {
      warnings.push({ sku: product.sku, code: "COST_ANALYSIS_PARTIAL", message: evaluated.warning });
    }
  }

  const calculableRows = rows.filter((r) => r.calculable && r.unitProductionCost != null);
  const topByCost = [...calculableRows]
    .sort((a, b) => (b.unitProductionCost ?? 0) - (a.unitProductionCost ?? 0))
    .slice(0, 10);

  const sampleSku = options?.onlyProductCode?.trim() ?? "619.24AA";
  const sampleProduct = rows.find((r) => r.sku === sampleSku) ?? null;

  return {
    productsEvaluated: rows.length,
    calculableCount: calculableRows.length,
    semCustoCount: rows.length - calculableRows.length,
    topByCost,
    sampleProduct,
    errors,
    warnings,
  };
}

export async function applyBootstrapProductionCostTableFromEngineering(
  db: PrismaClient,
  engine: ProductCostAnalysisEngine,
  input: BootstrapProductionCostApplyInput
) {
  const effectiveDate = startOfCivilDate(input.effectiveDate);
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code || !name) throw new Error("code e name são obrigatórios.");

  const where = {
    status: "ACTIVE" as const,
    type: "PRODUCT" as const,
    ...(input.onlyProductCode?.trim() ? { sku: input.onlyProductCode.trim() } : {}),
  };

  const products = await db.product.findMany({
    where,
    select: { id: true, sku: true, name: true },
    orderBy: { sku: "asc" },
  });

  const maxRevisionRow = await db.productionCostTableVersion.findFirst({
    where: { code },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  const nextRevision = (maxRevisionRow?.revision ?? 0) + 1;

  const draft = await createProductionCostTableDraft(db, {
    code,
    name,
    effectiveDate,
    revision: nextRevision,
    source: PRODUCTION_COST_ENGINEERING_SNAPSHOT_SOURCE,
    notes: input.notes?.trim() || "Bootstrap inicial a partir da Engenharia de Produto.",
    createdBy: input.createdBy?.trim() || null,
  });

  let itemsCreated = 0;
  let itemsSkipped = 0;
  const errors: Array<{ sku: string; code: string; message: string }> = [];
  const warnings: Array<{ sku: string; code: string; message: string }> = [];

  for (const product of products) {
    const evaluated = await evaluateProductEngineeringCost(db, engine, product.id);
    if (!evaluated.calculable || !evaluated.resolved.ok) {
      itemsSkipped += 1;
      errors.push({
        sku: product.sku,
        code: evaluated.errorCode ?? "SEM_CUSTO",
        message: evaluated.errorMessage ?? "SEM_CUSTO",
      });
      continue;
    }
    if (evaluated.warning) {
      warnings.push({ sku: product.sku, code: "COST_ANALYSIS_PARTIAL", message: evaluated.warning });
    }
    const itemInput = buildProductionCostDraftItemFromAnalysis(
      product,
      evaluated.resolved,
      evaluated.analysis
    );
    await addOrUpdateProductionCostTableDraftItem(db, draft.id, itemInput);
    itemsCreated += 1;
  }

  let published = false;
  if (input.publish) {
    if (!input.publishedBy?.trim()) {
      throw new Error("--publish exige --publishedBy.");
    }
    await publishProductionCostVersionFromDraft(db, {
      versionId: draft.id,
      publishedBy: input.publishedBy.trim(),
    });
    published = true;
  }

  return {
    versionId: draft.id,
    code,
    revision: nextRevision,
    status: published ? "PUBLISHED" : "DRAFT",
    productsRead: products.length,
    itemsCreated,
    itemsSkipped,
    errors,
    warnings,
    published,
  };
}
