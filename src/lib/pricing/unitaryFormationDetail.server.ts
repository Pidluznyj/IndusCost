/**
 * Detalhe read-only da Formação de Preço Unitária.
 * Lê Product + motor LIVE + DRAFT mais recente + custo publicado vigente. Sem writes.
 */
import type { PrismaClient } from "@prisma/client";
import type { ProductCostAnalysisEngine } from "../productCostAnalysisEngine.server.js";
import { getEffectiveProductProductionCost } from "../productionCostTables.server.js";
import { resolveFrozenCostTraceStatus, type FrozenCostTraceStatus } from "../productEngineeringCostSnapshot.js";
import { evaluateProductEngineeringCost } from "../productEngineeringCostSnapshot.server.js";
import { productionCostDecimalToNumber } from "../productionCostVersioning.js";
import {
  buildUnitaryFormationProductDetailResponse,
  buildUnitaryFormationWorkflow,
  mapUnitaryFormationDraftCost,
  mapUnitaryFormationLiveCost,
  mapUnitaryFormationPublishedCostError,
  resolveUnitaryFormationComparison,
  resolveUnitaryFormationComparisons,
  type UnitaryFormationDraftVersionRow,
  type UnitaryFormationProductDetailResponse,
  type UnitaryFormationProductRow,
} from "./unitaryFormationDetail.js";

export type UnitaryFormationProductDetailError = {
  httpStatus: 400 | 403 | 404;
  code: "INVALID_PRODUCT_ID" | "INVALID_REFERENCE_DATE" | "PRODUCT_NOT_FOUND" | "PERMISSION";
  message: string;
};

async function loadEligibleProduct(
  db: PrismaClient,
  productId: string
): Promise<UnitaryFormationProductRow | null> {
  const product = await db.product.findFirst({
    where: {
      id: productId,
      type: { in: ["PRODUCT", "COMPONENT"] },
      OR: [{ status: "ACTIVE" }, { status: null }],
    },
    select: {
      id: true,
      sku: true,
      name: true,
      type: true,
      status: true,
      costingMode: true,
      cycleTimeSeconds: true,
      cavities: true,
      efficiencyExpected: true,
      setupTimeMin: true,
      defaultLotSize: true,
      _count: { select: { ProductRouting: true } },
    },
  });
  if (!product) return null;
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    type: product.type === "COMPONENT" ? "COMPONENT" : "PRODUCT",
    status: product.status ?? null,
    costingMode: String(product.costingMode),
    cycleTimeSeconds: product.cycleTimeSeconds,
    cavities: product.cavities,
    efficiencyExpected: product.efficiencyExpected,
    setupTimeMin: product.setupTimeMin,
    defaultLotSize: product.defaultLotSize,
    routingStepCount: product._count.ProductRouting,
  };
}

/** DRAFT mais recente do produto (por createdAt do item).
 * Considera apenas status DRAFT — ARCHIVED/SUPERSEDED/PUBLISHED não são candidatos.
 * Lifecycle: após publicação unitária, DRAFTs anteriores do produto são arquivados no domínio.
 */
export async function loadLatestUnitaryFormationDraft(
  db: PrismaClient,
  productId: string
): Promise<UnitaryFormationDraftVersionRow | null> {
  const item = await db.productionCostTableItem.findFirst({
    where: { productId, costTableVersion: { status: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    select: {
      unitProductionCost: true,
      materialCost: true,
      laborCost: true,
      machineCost: true,
      processCost: true,
      overheadCost: true,
      otherCost: true,
      calculationHash: true,
      costTableVersion: {
        select: {
          id: true,
          code: true,
          revision: true,
          status: true,
          createdAt: true,
          createdBy: true,
          source: true,
        },
      },
    },
  });
  if (!item) return null;
  const v = item.costTableVersion;
  const num = (value: unknown): number | null => {
    const n = productionCostDecimalToNumber(value);
    return Number.isFinite(n) ? n : null;
  };
  return {
    versionId: v.id,
    code: v.code,
    revision: v.revision,
    status: v.status,
    createdAt: v.createdAt,
    createdBy: v.createdBy,
    source: v.source,
    materialCost: num(item.materialCost),
    laborCost: num(item.laborCost),
    machineCost: num(item.machineCost),
    processCost: num(item.processCost),
    overheadCost: num(item.overheadCost),
    otherCost: num(item.otherCost),
    unitProductionCost: num(item.unitProductionCost),
    calculationHash: item.calculationHash,
  };
}

function resolveTraceStatusForDetail(input: {
  liveCiu: number | null;
  liveHash: string | null;
  publishedCost: number | null;
  publishedHash: string | null;
  hasPublished: boolean;
  draft: UnitaryFormationDraftVersionRow | null;
}): FrozenCostTraceStatus {
  return resolveFrozenCostTraceStatus({
    liveCiu: input.liveCiu,
    liveHash: input.liveHash,
    publishedCost: input.publishedCost,
    publishedHash: input.publishedHash,
    publishedVersionStatus: input.hasPublished ? "PUBLISHED" : null,
    draftHash: input.draft?.calculationHash ?? null,
    draftVersionStatus: input.draft?.status ?? null,
    draftUnitCost: input.draft?.unitProductionCost ?? null,
  });
}

export async function buildUnitaryFormationProductDetail(
  db: PrismaClient,
  engine: ProductCostAnalysisEngine,
  input: {
    productId: string;
    referenceDate: Date;
    referenceDateKey: string;
    generatedAt?: string;
  }
): Promise<
  | { ok: true; data: UnitaryFormationProductDetailResponse }
  | { ok: false; error: UnitaryFormationProductDetailError }
> {
  const product = await loadEligibleProduct(db, input.productId);
  if (!product) {
    return {
      ok: false,
      error: {
        httpStatus: 404,
        code: "PRODUCT_NOT_FOUND",
        message: "Produto ou componente não encontrado.",
      },
    };
  }

  const evaluated = await evaluateProductEngineeringCost(db, engine, product.id);
  const analysis = evaluated.analysis;
  const liveHash = evaluated.calculationHash;
  const liveCiu =
    evaluated.calculable && evaluated.resolved.ok ? evaluated.resolved.finalUnitCost : null;

  const draft = await loadLatestUnitaryFormationDraft(db, product.id);
  const draftCount = await db.productionCostTableItem.count({
    where: { productId: product.id, costTableVersion: { status: "DRAFT" } },
  });

  let publishedVersionStatus: string | null = null;
  let publishedBy: string | null = null;
  let publishedCalculationHash: string | null = null;
  let effective;
  try {
    effective = await getEffectiveProductProductionCost(db, product.id, input.referenceDate);
    if (effective.status === "OK") {
      const version = await db.productionCostTableVersion.findUnique({
        where: { id: effective.costTableVersionId },
        select: { status: true, publishedBy: true },
      });
      publishedVersionStatus = version?.status ?? null;
      publishedBy = version?.publishedBy ?? null;
      const pubItem = await db.productionCostTableItem.findUnique({
        where: { id: effective.costTableItemId },
        select: { calculationHash: true },
      });
      publishedCalculationHash = pubItem?.calculationHash ?? null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao consultar custo publicado.";
    const liveCost = mapUnitaryFormationLiveCost(analysis, liveHash);
    const publishedCost = mapUnitaryFormationPublishedCostError(message);
    const draftCost = mapUnitaryFormationDraftCost(draft, liveCost, draftCount);
    const comparisons = resolveUnitaryFormationComparisons({
      live: liveCost,
      draft: draftCost,
      published: publishedCost,
    });
    const traceStatus = resolveTraceStatusForDetail({
      liveCiu,
      liveHash,
      publishedCost: null,
      publishedHash: null,
      hasPublished: false,
      draft,
    });
    const workflow = buildUnitaryFormationWorkflow({
      live: liveCost,
      draft: draftCost,
      published: publishedCost,
      traceStatus,
    });
    const base = buildUnitaryFormationProductDetailResponse({
      product,
      referenceDate: input.referenceDateKey,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      analysis,
      effective: { status: "SEM_CUSTO", productId: product.id, referenceDate: input.referenceDate },
      publishedVersionStatus: null,
      liveCalculationHash: liveHash,
      draft,
      draftCount,
      traceStatus,
    });
    base.publishedCost = publishedCost;
    base.draftCost = draftCost;
    base.comparison = resolveUnitaryFormationComparison(liveCost, publishedCost);
    base.comparisons = comparisons;
    base.workflow = workflow;
    return { ok: true, data: base };
  }

  const traceStatus = resolveTraceStatusForDetail({
    liveCiu,
    liveHash,
    publishedCost: effective.status === "OK" ? effective.unitProductionCost : null,
    publishedHash: publishedCalculationHash,
    hasPublished: effective.status === "OK",
    draft,
  });

  const data = buildUnitaryFormationProductDetailResponse({
    product,
    referenceDate: input.referenceDateKey,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    analysis,
    effective,
    publishedVersionStatus,
    liveCalculationHash: liveHash,
    publishedBy,
    publishedCalculationHash,
    draft,
    draftCount,
    traceStatus,
  });

  return { ok: true, data };
}
