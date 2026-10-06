/**
 * Planejamento puro do snapshot completo de custo de produção.
 * Sem Prisma / sem motor LIVE — só merge OFFICIAL + APPROVED PATCH.
 */
import type { ProductionCostTableDraftItemInput } from "./productionCostVersioning.js";
import { isPublishableProductionUnitCost } from "./productionCostVersioning.js";

export const PRODUCTION_COST_COMPLETE_SNAPSHOT_POPULATION_SOURCE =
  "FULL_ACTIVE_PRODUCT_AND_COMPONENT" as const;

export type ProductionCostCompleteSnapshotPopulationSource =
  typeof PRODUCTION_COST_COMPLETE_SNAPSHOT_POPULATION_SOURCE;

/** Marcador em notes — identifica snapshot completo moderno (sem migration). */
export const PRODUCTION_COST_COMPLETE_SNAPSHOT_KIND =
  "COMPLETE_SNAPSHOT_MATERIALIZATION" as const;

export const PRODUCTION_COST_COMPLETE_SNAPSHOT_COMPLETENESS_MODERN =
  "COMPLETE_MODERN" as const;

/** Catálogo de carry-forward: resolver histórico por produto/data — nunca latestPublished.items. */
export const PRODUCTION_COST_COMPLETE_SNAPSHOT_CATALOG_MODE =
  "HISTORICAL_RESOLVER_PER_PRODUCT" as const;

export type ProductionCostCompleteSnapshotMeta = {
  kind: typeof PRODUCTION_COST_COMPLETE_SNAPSHOT_KIND;
  completeness: typeof PRODUCTION_COST_COMPLETE_SNAPSHOT_COMPLETENESS_MODERN;
  catalogMode: typeof PRODUCTION_COST_COMPLETE_SNAPSHOT_CATALOG_MODE;
  at?: string;
  populationSource?: ProductionCostCompleteSnapshotPopulationSource;
  totalItems?: number;
  changedCount?: number;
  carriedForwardCount?: number;
  missingCount?: number;
  changedProductIds?: string[];
  patchDraftVersionIds?: string[];
  baseResolver?: string;
};

/**
 * Extrai o JSON de materialização completa das notes (se presente).
 * Legado parcial (sem este marcador) retorna null.
 */
export function parseCompleteProductionCostSnapshotMeta(
  notes: string | null | undefined
): ProductionCostCompleteSnapshotMeta | null {
  if (!notes?.trim()) return null;
  const re = new RegExp(
    `\\{[^{}]*"kind"\\s*:\\s*"${PRODUCTION_COST_COMPLETE_SNAPSHOT_KIND}"[^{}]*\\}`
  );
  const match = notes.match(re);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]!) as Partial<ProductionCostCompleteSnapshotMeta>;
    if (parsed.kind !== PRODUCTION_COST_COMPLETE_SNAPSHOT_KIND) return null;
    if (parsed.completeness !== PRODUCTION_COST_COMPLETE_SNAPSHOT_COMPLETENESS_MODERN) {
      // Aceita marcadores antigos da TAREFA 3 (só kind) como modernos se catalogMode/baseResolver bater.
      if (
        parsed.baseResolver === "getEffectiveProductProductionCosts" ||
        parsed.catalogMode === PRODUCTION_COST_COMPLETE_SNAPSHOT_CATALOG_MODE
      ) {
        return {
          kind: PRODUCTION_COST_COMPLETE_SNAPSHOT_KIND,
          completeness: PRODUCTION_COST_COMPLETE_SNAPSHOT_COMPLETENESS_MODERN,
          catalogMode: PRODUCTION_COST_COMPLETE_SNAPSHOT_CATALOG_MODE,
          ...parsed,
        };
      }
      return null;
    }
    return {
      kind: PRODUCTION_COST_COMPLETE_SNAPSHOT_KIND,
      completeness: PRODUCTION_COST_COMPLETE_SNAPSHOT_COMPLETENESS_MODERN,
      catalogMode:
        parsed.catalogMode ?? PRODUCTION_COST_COMPLETE_SNAPSHOT_CATALOG_MODE,
      ...parsed,
    };
  } catch {
    return null;
  }
}

export function isModernCompleteProductionCostSnapshotNotes(
  notes: string | null | undefined
): boolean {
  return parseCompleteProductionCostSnapshotMeta(notes) != null;
}

/**
 * Heurística read-only: PUBLISHED/SUPERSEDED sem marcador moderno e com poucos itens
 * sugere legado parcial. Não muta histórico.
 */
export function suggestsLegacyPartialProductionCostVersion(input: {
  notes: string | null | undefined;
  itemCount: number;
  populationSize?: number | null;
}): boolean {
  if (isModernCompleteProductionCostSnapshotNotes(input.notes)) return false;
  if (input.itemCount <= 0) return true;
  if (
    input.populationSize != null &&
    input.populationSize > 0 &&
    input.itemCount < input.populationSize
  ) {
    return true;
  }
  return false;
}

export function buildCompleteProductionCostSnapshotMaterializationMeta(input: {
  plan: Pick<
    ProductionCostCompleteSnapshotPlan,
    | "populationSource"
    | "totalItems"
    | "changedCount"
    | "carriedForwardCount"
    | "missingCount"
    | "changedProductIds"
  >;
  patchDraftVersionIds: string[];
  at?: string;
}): ProductionCostCompleteSnapshotMeta {
  return {
    kind: PRODUCTION_COST_COMPLETE_SNAPSHOT_KIND,
    completeness: PRODUCTION_COST_COMPLETE_SNAPSHOT_COMPLETENESS_MODERN,
    catalogMode: PRODUCTION_COST_COMPLETE_SNAPSHOT_CATALOG_MODE,
    at: input.at ?? new Date().toISOString(),
    populationSource: input.plan.populationSource,
    totalItems: input.plan.totalItems,
    changedCount: input.plan.changedCount,
    carriedForwardCount: input.plan.carriedForwardCount,
    missingCount: input.plan.missingCount,
    changedProductIds: input.plan.changedProductIds,
    patchDraftVersionIds: input.patchDraftVersionIds,
    baseResolver: "getEffectiveProductProductionCosts",
  };
}

export type ProductionCostSnapshotPopulationProduct = {
  id: string;
  sku: string;
  name: string;
  type: string;
};

export type ProductionCostSnapshotOfficialItem = ProductionCostTableDraftItemInput & {
  /** Item id da versão oficial de origem (carry-forward). */
  sourceCostTableItemId?: string;
  sourceCostTableVersionId?: string;
};

export type ProductionCostCompleteSnapshotPlanItem = ProductionCostTableDraftItemInput & {
  origin: "CHANGED" | "CARRIED_FORWARD";
};

export type ProductionCostCompleteSnapshotPlan = {
  items: ProductionCostCompleteSnapshotPlanItem[];
  changedProductIds: string[];
  carriedForwardProductIds: string[];
  missingProductIds: string[];
  totalItems: number;
  changedCount: number;
  carriedForwardCount: number;
  missingCount: number;
  populationSource: ProductionCostCompleteSnapshotPopulationSource;
};

export type BuildCompleteProductionCostSnapshotPlanInput = {
  population: ProductionCostSnapshotPopulationProduct[];
  /** Itens oficiais vigentes por productId (já resolvidos / carry-ready). */
  officialByProductId: Map<string, ProductionCostSnapshotOfficialItem>;
  /** Itens do patch aprovado por productId. */
  patchByProductId: Map<string, ProductionCostTableDraftItemInput>;
  changedProductIds: string[];
  populationSource?: ProductionCostCompleteSnapshotPopulationSource;
};

export type ProductionCostCompleteSnapshotPlanError = {
  code:
    | "EMPTY_PATCH"
    | "DUPLICATE_PATCH_PRODUCT"
    | "PATCH_PRODUCT_MISSING"
    | "PATCH_PRODUCT_OUT_OF_POPULATION"
    | "PATCH_INVALID_COST"
    | "SNAPSHOT_EMPTY";
  message: string;
  productId?: string;
};

function cloneDraftItem(
  item: ProductionCostTableDraftItemInput,
  origin: "CHANGED" | "CARRIED_FORWARD"
): ProductionCostCompleteSnapshotPlanItem {
  return {
    productId: item.productId,
    productCodeSnapshot: item.productCodeSnapshot,
    productNameSnapshot: item.productNameSnapshot,
    unitProductionCost: item.unitProductionCost,
    materialCost: item.materialCost ?? 0,
    processCost: item.processCost ?? 0,
    laborCost: item.laborCost ?? 0,
    machineCost: item.machineCost ?? 0,
    overheadCost: item.overheadCost ?? 0,
    otherCost: item.otherCost ?? 0,
    currency: item.currency?.trim() || "BRL",
    calculationHash: item.calculationHash ?? null,
    calculationSnapshot: item.calculationSnapshot ?? null,
    origin,
  };
}

/**
 * Monta o plano do snapshot completo:
 * OFFICIAL CURRENT + APPROVED PATCH → items (sem LIVE).
 */
export function buildCompleteProductionCostSnapshotPlan(
  input: BuildCompleteProductionCostSnapshotPlanInput
):
  | { ok: true; plan: ProductionCostCompleteSnapshotPlan }
  | { ok: false; error: ProductionCostCompleteSnapshotPlanError } {
  const populationSource =
    input.populationSource ?? PRODUCTION_COST_COMPLETE_SNAPSHOT_POPULATION_SOURCE;

  const changedIds = [...new Set(input.changedProductIds.map((id) => id?.trim()).filter(Boolean))];
  if (changedIds.length === 0) {
    return {
      ok: false,
      error: { code: "EMPTY_PATCH", message: "changedProductIds não pode ser vazio." },
    };
  }
  if (changedIds.length !== input.changedProductIds.filter(Boolean).length) {
    return {
      ok: false,
      error: {
        code: "DUPLICATE_PATCH_PRODUCT",
        message: "changedProductIds contém productId duplicado.",
      },
    };
  }

  const populationIds = new Set(input.population.map((p) => p.id));

  for (const productId of changedIds) {
    if (!populationIds.has(productId)) {
      return {
        ok: false,
        error: {
          code: "PATCH_PRODUCT_OUT_OF_POPULATION",
          message: `Produto ${productId} do patch não está na população oficial ACTIVE.`,
          productId,
        },
      };
    }
    const patch = input.patchByProductId.get(productId);
    if (!patch) {
      return {
        ok: false,
        error: {
          code: "PATCH_PRODUCT_MISSING",
          message: `Produto ${productId} marcado como alterado não possui item no DRAFT/patch aprovado.`,
          productId,
        },
      };
    }
    if (!isPublishableProductionUnitCost(patch.unitProductionCost)) {
      return {
        ok: false,
        error: {
          code: "PATCH_INVALID_COST",
          message: `Produto ${productId} do patch tem unitProductionCost inválido (deve ser finito > 0).`,
          productId,
        },
      };
    }
  }

  const changedSet = new Set(changedIds);
  const items: ProductionCostCompleteSnapshotPlanItem[] = [];
  const carriedForwardProductIds: string[] = [];
  const missingProductIds: string[] = [];

  for (const product of input.population) {
    if (changedSet.has(product.id)) {
      items.push(cloneDraftItem(input.patchByProductId.get(product.id)!, "CHANGED"));
      continue;
    }
    const official = input.officialByProductId.get(product.id);
    if (official && isPublishableProductionUnitCost(official.unitProductionCost)) {
      items.push(cloneDraftItem(official, "CARRIED_FORWARD"));
      carriedForwardProductIds.push(product.id);
      continue;
    }
    missingProductIds.push(product.id);
  }

  if (items.length === 0) {
    return {
      ok: false,
      error: {
        code: "SNAPSHOT_EMPTY",
        message: "Snapshot completo resultou em zero itens publicáveis.",
      },
    };
  }

  return {
    ok: true,
    plan: {
      items,
      changedProductIds: changedIds,
      carriedForwardProductIds,
      missingProductIds,
      totalItems: items.length,
      changedCount: changedIds.length,
      carriedForwardCount: carriedForwardProductIds.length,
      missingCount: missingProductIds.length,
      populationSource,
    },
  };
}

export function normalizeProductionCostDraftItemInput(
  item: ProductionCostTableDraftItemInput
): ProductionCostTableDraftItemInput {
  return {
    productId: item.productId,
    productCodeSnapshot: item.productCodeSnapshot,
    productNameSnapshot: item.productNameSnapshot,
    unitProductionCost: item.unitProductionCost,
    materialCost: item.materialCost ?? 0,
    processCost: item.processCost ?? 0,
    laborCost: item.laborCost ?? 0,
    machineCost: item.machineCost ?? 0,
    overheadCost: item.overheadCost ?? 0,
    otherCost: item.otherCost ?? 0,
    currency: item.currency?.trim() || "BRL",
    calculationHash: item.calculationHash ?? null,
    calculationSnapshot: item.calculationSnapshot ?? null,
  };
}

/** Prefixo estável — detectável em catch sem depender de Prisma error codes. */
export const PRODUCTION_COST_PUBLISH_STALE_BASE_PREFIX = "STALE_BASE:" as const;

/**
 * Optimistic check: draft completo só pode publicar se a base que ele carrega
 * ainda for a PUBLISHED vigente. Evita sobrescrever snapshot mais novo e dual-PUBLISHED.
 */
export function evaluateProductionCostPublishBase(input: {
  draftSupersedesVersionId: string | null | undefined;
  currentPublishedVersionId: string | null | undefined;
}): { ok: true } | { ok: false; code: "STALE_BASE"; message: string } {
  const current = input.currentPublishedVersionId?.trim() || null;
  const expected = input.draftSupersedesVersionId?.trim() || null;
  if (!current) return { ok: true };
  if (expected !== current) {
    return {
      ok: false,
      code: "STALE_BASE",
      message: `${PRODUCTION_COST_PUBLISH_STALE_BASE_PREFIX} base oficial mudou (esperado ${expected ?? "null"}, vigente ${current}). Rematerialize e republicar.`,
    };
  }
  return { ok: true };
}

export function isProductionCostPublishStaleBaseError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return msg.includes(PRODUCTION_COST_PUBLISH_STALE_BASE_PREFIX);
}

/** Unique (code, revision) — Prisma P2002 ou mensagem de constraint. */
export function isProductionCostRevisionUniqueConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    const msg = String(err ?? "");
    return /code_revision|Unique constraint/i.test(msg);
  }
  const e = err as { code?: string; message?: string; meta?: { target?: string[] } };
  if (e.code === "P2002") {
    const target = e.meta?.target;
    if (!target || target.some((t) => /code|revision/i.test(t))) return true;
  }
  return /code_revision|Unique constraint.*revision/i.test(e.message ?? "");
}
