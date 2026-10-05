/**
 * Detalhe read-only da Formação de Preço Unitária.
 * Lê Product + motor LIVE + custo publicado vigente. Sem writes.
 */
import type { PrismaClient } from "@prisma/client";
import type { ProductCostAnalysisEngine } from "../productCostAnalysisEngine.server.js";
import { getEffectiveProductProductionCost } from "../productionCostTables.server.js";
import {
  buildUnitaryFormationProductDetailResponse,
  mapUnitaryFormationPublishedCostError,
  resolveUnitaryFormationComparison,
  type UnitaryFormationProductDetailResponse,
  type UnitaryFormationProductRow,
} from "./unitaryFormationDetail.js";

export type UnitaryFormationProductDetailError = {
  httpStatus: 400 | 404;
  code: "INVALID_PRODUCT_ID" | "INVALID_REFERENCE_DATE" | "PRODUCT_NOT_FOUND";
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

  const cache = await engine.initAnalysisCache();
  const analysis = await engine.getProductCostAnalysis(product.id, cache, true);

  let publishedVersionStatus: string | null = null;
  let effective;
  try {
    effective = await getEffectiveProductProductionCost(db, product.id, input.referenceDate);
    if (effective.status === "OK") {
      const version = await db.productionCostTableVersion.findUnique({
        where: { id: effective.costTableVersionId },
        select: { status: true },
      });
      publishedVersionStatus = version?.status ?? null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao consultar custo publicado.";
    const liveCostOnly = buildUnitaryFormationProductDetailResponse({
      product,
      referenceDate: input.referenceDateKey,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      analysis,
      effective: { status: "SEM_CUSTO", productId: product.id, referenceDate: input.referenceDate },
      publishedVersionStatus: null,
    });
    liveCostOnly.publishedCost = mapUnitaryFormationPublishedCostError(message);
    liveCostOnly.comparison = resolveUnitaryFormationComparison(
      liveCostOnly.liveCost,
      liveCostOnly.publishedCost
    );
    return { ok: true, data: liveCostOnly };
  }

  const data = buildUnitaryFormationProductDetailResponse({
    product,
    referenceDate: input.referenceDateKey,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    analysis,
    effective,
    publishedVersionStatus,
  });

  return { ok: true, data };
}
