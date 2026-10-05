/**
 * Resolver central de fonte de custo de produto existente (server-side).
 *
 *   PUBLISHED → exclusivamente a arquitetura versionada oficial (getEffectiveProductProductionCost).
 *   LIVE      → exclusivamente o motor oficial (getProductCostAnalysis).
 *
 * Não duplica motor, não transforma LIVE em PUBLISHED e não faz fallback entre as fontes.
 */
import type { PrismaClient } from "@prisma/client";
import type { ProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";
import { resolveOfficialProductFinalCostFromAnalysis } from "./productOfficialFinalCost.js";
import { getEffectiveProductProductionCost } from "./productionCostTables.server.js";
import type { EffectiveProductProductionCostResult } from "./productionCostVersioning.js";
import {
  extractOwnProcessDecompositionFromAnalysis,
  NO_PUBLISHED_COST_MESSAGE,
  type OwnProcessDecomposition,
  type ProductCostBaselineContext,
  type ProductCostBaselineOk,
  type ProductCostBaselineResult,
  type ProductCostBaselineSource,
  type ProductCostBaselineWarning,
} from "./productCostBaseline.js";

export type ProductCostBaselineEngine = Pick<
  ProductCostAnalysisEngine,
  "initAnalysisCache" | "getProductCostAnalysis" | "isCostAnalysisFailure"
>;

export type ResolveProductCostBaselineInput = {
  productId: string;
  source: ProductCostBaselineSource;
  /** Data de vigência para PUBLISHED (default: agora). */
  referenceDate?: Date;
  context: ProductCostBaselineContext;
  /**
   * Em PUBLISHED, tenta anexar a decomposição do processo próprio vinda do motor LIVE
   * SOMENTE quando HH/HM vivos coincidem com os publicados (mesma estrutura de processo).
   */
  includeOwnProcess?: boolean;
};

export type ProductCostBaselineDeps = {
  /** Injetável em testes; default = leitor oficial de custo publicado. */
  getEffectiveCost?: (
    db: PrismaClient,
    productId: string,
    referenceDate: Date
  ) => Promise<EffectiveProductProductionCostResult>;
  now?: () => Date;
};

const OWN_PROCESS_MATCH_TOLERANCE = 1e-6;

function isoDate(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 10);
}

function finiteOrZero(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

type LiveEvaluation =
  | {
      ok: true;
      sku: string | null;
      name: string | null;
      mp: number;
      hh: number;
      hm: number;
      total: number;
      partial: boolean;
      ownProcess: OwnProcessDecomposition | null;
    }
  | { ok: false; notFound: boolean; message: string };

async function evaluateLive(engine: ProductCostBaselineEngine, productId: string): Promise<LiveEvaluation> {
  const cache = await engine.initAnalysisCache();
  const analysis = await engine.getProductCostAnalysis(productId, cache, true);
  if (analysis == null) {
    return { ok: false, notFound: true, message: "Produto não encontrado." };
  }
  if (engine.isCostAnalysisFailure(analysis)) {
    return {
      ok: false,
      notFound: false,
      message: analysis.message ?? `Custo de engenharia indisponível (${analysis.error}).`,
    };
  }
  const resolved = resolveOfficialProductFinalCostFromAnalysis(analysis);
  if (resolved.ok === false) {
    return {
      ok: false,
      notFound: false,
      message: resolved.diagnostics[0]?.message ?? "Custo de engenharia indisponível.",
    };
  }
  const raw = analysis as Record<string, unknown>;
  return {
    ok: true,
    sku: typeof raw.sku === "string" ? raw.sku : resolved.sku,
    name: typeof raw.name === "string" ? raw.name : null,
    mp: finiteOrZero(resolved.breakdown.totalMaterialCost),
    hh: finiteOrZero(resolved.breakdown.totalHH_Unit),
    hm: finiteOrZero(resolved.breakdown.totalHM_Unit),
    total: resolved.finalUnitCost,
    partial: resolved.costAnalysisPartial,
    ownProcess: extractOwnProcessDecompositionFromAnalysis(analysis),
  };
}

export async function resolveProductCostBaseline(
  db: PrismaClient,
  engine: ProductCostBaselineEngine,
  input: ResolveProductCostBaselineInput,
  deps: ProductCostBaselineDeps = {}
): Promise<ProductCostBaselineResult> {
  const now = deps.now ? deps.now() : new Date();
  const warnings: ProductCostBaselineWarning[] = [];

  if (input.source === "LIVE") {
    const live = await evaluateLive(engine, input.productId);
    if (live.ok === false) {
      return {
        status: live.notFound ? "PRODUCT_NOT_FOUND" : "LIVE_COST_UNAVAILABLE",
        source: "LIVE",
        productId: input.productId,
        message: live.message,
      };
    }
    if (live.partial) {
      warnings.push({
        code: "COST_ANALYSIS_PARTIAL",
        message: "Custo de engenharia parcial: há linhas de BOM excluídas do cálculo.",
      });
    }
    const result: ProductCostBaselineOk = {
      status: "OK",
      source: "LIVE",
      productId: input.productId,
      sku: live.sku,
      name: live.name,
      totalMaterialCost: live.mp,
      totalHHUnit: live.hh,
      totalHMUnit: live.hm,
      totalIndustrialCost: live.total,
      productionCostVersionId: null,
      productionCostVersionCode: null,
      productionCostRevision: null,
      effectiveDate: null,
      publishedAt: null,
      calculatedAt: now.toISOString(),
      referenceDate: null,
      ownProcess: live.ownProcess,
      warnings,
      metadata: { context: input.context, costAnalysisPartial: live.partial },
    };
    return result;
  }

  const referenceDate = input.referenceDate ?? now;
  const product = await db.product.findUnique({
    where: { id: input.productId },
    select: { id: true, sku: true, name: true },
  });
  if (!product) {
    return {
      status: "PRODUCT_NOT_FOUND",
      source: "PUBLISHED",
      productId: input.productId,
      message: "Produto não encontrado.",
    };
  }

  const getEffectiveCost = deps.getEffectiveCost ?? getEffectiveProductProductionCost;
  const effective = await getEffectiveCost(db, input.productId, referenceDate);
  if (effective.status !== "OK") {
    return {
      status: "NO_PUBLISHED_COST",
      source: "PUBLISHED",
      productId: input.productId,
      message: NO_PUBLISHED_COST_MESSAGE,
    };
  }

  const mp = finiteOrZero(effective.breakdown.materialCost);
  const hh = finiteOrZero(effective.breakdown.laborCost);
  const hm = finiteOrZero(effective.breakdown.machineCost);
  if (Math.abs(effective.unitProductionCost - (mp + hh + hm)) > 1e-4) {
    warnings.push({
      code: "PUBLISHED_BREAKDOWN_DIFFERS_FROM_TOTAL",
      message: "O custo publicado difere da soma MP + HH + HM gravada na versão (parcela 'outros').",
    });
  }

  let ownProcess: OwnProcessDecomposition | null = null;
  if (input.includeOwnProcess) {
    // A versão publicada não congela transformação × setup. A decomposição do motor vivo só é
    // válida para a base publicada quando HH/HM coincidem (processo inalterado desde a publicação).
    try {
      const live = await evaluateLive(engine, input.productId);
      if (
        live.ok === true &&
        live.ownProcess &&
        Math.abs(live.hh - hh) <= OWN_PROCESS_MATCH_TOLERANCE &&
        Math.abs(live.hm - hm) <= OWN_PROCESS_MATCH_TOLERANCE
      ) {
        ownProcess = live.ownProcess;
      } else {
        warnings.push({
          code: "OWN_PROCESS_DECOMPOSITION_UNAVAILABLE",
          message:
            "Decomposição transformação × setup indisponível para a versão publicada (processo atual difere do publicado).",
        });
      }
    } catch {
      warnings.push({
        code: "OWN_PROCESS_DECOMPOSITION_UNAVAILABLE",
        message: "Decomposição transformação × setup indisponível para a versão publicada.",
      });
    }
  }

  return {
    status: "OK",
    source: "PUBLISHED",
    productId: input.productId,
    sku: product.sku,
    name: product.name,
    totalMaterialCost: mp,
    totalHHUnit: hh,
    totalHMUnit: hm,
    totalIndustrialCost: effective.unitProductionCost,
    productionCostVersionId: effective.costTableVersionId,
    productionCostVersionCode: effective.versionCode,
    productionCostRevision: effective.revision,
    effectiveDate: isoDate(effective.effectiveDate),
    publishedAt: effective.publishedAt ? effective.publishedAt.toISOString() : null,
    calculatedAt: null,
    referenceDate: isoDate(referenceDate),
    ownProcess,
    warnings,
    metadata: { context: input.context, costAnalysisPartial: false },
  };
}
