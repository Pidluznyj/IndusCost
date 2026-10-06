/**
 * Materializa ProductionCostTableVersion DRAFT COMPLETA a partir de:
 * OFFICIAL CURRENT STATE (resolver histórico batch) + APPROVED PATCH (DRAFT parcial).
 *
 * Não publica. Carry-forward usa apenas custo oficial versionado (sem motor LIVE).
 */
import type { PrismaClient } from "@prisma/client";
import { startOfCivilDate } from "./financeCivilDate.js";
import {
  PRODUCTION_COST_COMPLETE_SNAPSHOT_POPULATION_SOURCE,
  buildCompleteProductionCostSnapshotMaterializationMeta,
  buildCompleteProductionCostSnapshotPlan,
  isProductionCostRevisionUniqueConflict,
  normalizeProductionCostDraftItemInput,
  type ProductionCostCompleteSnapshotPlan,
  type ProductionCostCompleteSnapshotPlanError,
  type ProductionCostCompleteSnapshotPopulationSource,
  type ProductionCostSnapshotOfficialItem,
} from "./productionCostCompleteSnapshot.js";
import {
  DEFAULT_PRODUCTION_COST_DRAFT_ITEM_SCOPE,
  parseProductionCostDraftItemScope,
  type ProductionCostDraftItemScope,
} from "./productionCostDraftItemScope.js";
import {
  PRODUCTION_COST_PUBLICATION_SOURCE,
  productionCostTableCodeFromEffectiveDate,
  productionCostTableNameFromCode,
} from "./productionCostPublication.js";
import {
  findLatestPublishedProductionCostVersionByCode,
  resolveProductsForProductionCostDraft,
} from "./productionCostPublication.server.js";
import {
  addOrUpdateProductionCostTableDraftItem,
  createProductionCostTableDraft,
  getEffectiveProductProductionCosts,
} from "./productionCostTables.server.js";
import {
  productionCostDecimalToNumber,
  type ProductionCostTableDraftItemInput,
} from "./productionCostVersioning.js";

export type MaterializeCompleteProductionCostSnapshotInput = {
  effectiveDate: Date;
  /** Produtos aprovados no patch (devem existir nos DRAFTs informados). */
  changedProductIds: string[];
  /** Versões DRAFT (parciais) de onde ler os itens aprovados. */
  patchDraftVersionIds: string[];
  createdBy?: string | null;
  notes?: string | null;
  itemScope?: ProductionCostDraftItemScope | string | null;
  populationSource?: ProductionCostCompleteSnapshotPopulationSource;
  code?: string | null;
};

export type MaterializeCompleteProductionCostSnapshotDeps = {
  /** Injetável para testes — default: getEffectiveProductProductionCosts (sem LIVE). */
  loadOfficialCosts?: typeof getEffectiveProductProductionCosts;
  /** Spy opcional: contagem de chamadas ao resolvedor oficial. */
  onOfficialCostsLoaded?: (productIds: string[]) => void;
};

export type MaterializeCompleteProductionCostSnapshotResult = {
  version: {
    id: string;
    code: string;
    name: string;
    revision: number;
    status: "DRAFT";
    effectiveDate: Date;
    supersedesVersionId: string | null;
  };
  plan: ProductionCostCompleteSnapshotPlan;
  summary: {
    populationSource: ProductionCostCompleteSnapshotPopulationSource;
    populationSize: number;
    totalItems: number;
    changedCount: number;
    carriedForwardCount: number;
    missingCount: number;
    changedProductIds: string[];
    carriedForwardProductIds: string[];
    missingProductIds: string[];
    patchDraftVersionIds: string[];
    materializationMs: number;
  };
};

export type MaterializeCompleteProductionCostSnapshotFailure = {
  code: ProductionCostCompleteSnapshotPlanError["code"] | "PATCH_DRAFT_NOT_FOUND" | "UNEXPECTED";
  message: string;
  productId?: string;
};

function draftItemFromDbRow(row: {
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  unitProductionCost: unknown;
  materialCost: unknown;
  processCost: unknown;
  laborCost: unknown;
  machineCost: unknown;
  overheadCost: unknown;
  otherCost: unknown;
  currency: string;
  calculationHash: string | null;
  calculationSnapshot: unknown;
}): ProductionCostTableDraftItemInput {
  return normalizeProductionCostDraftItemInput({
    productId: row.productId,
    productCodeSnapshot: row.productCodeSnapshot,
    productNameSnapshot: row.productNameSnapshot,
    unitProductionCost: productionCostDecimalToNumber(row.unitProductionCost),
    materialCost: productionCostDecimalToNumber(row.materialCost),
    processCost: productionCostDecimalToNumber(row.processCost),
    laborCost: productionCostDecimalToNumber(row.laborCost),
    machineCost: productionCostDecimalToNumber(row.machineCost),
    overheadCost: productionCostDecimalToNumber(row.overheadCost),
    otherCost: productionCostDecimalToNumber(row.otherCost),
    currency: row.currency,
    calculationHash: row.calculationHash,
    calculationSnapshot: row.calculationSnapshot,
  });
}

async function loadPatchItemsFromDrafts(
  db: PrismaClient,
  patchDraftVersionIds: string[],
  changedProductIds: string[]
): Promise<
  | { ok: true; patchByProductId: Map<string, ProductionCostTableDraftItemInput> }
  | { ok: false; error: MaterializeCompleteProductionCostSnapshotFailure }
> {
  const versionIds = [...new Set(patchDraftVersionIds.map((id) => id?.trim()).filter(Boolean))];
  if (versionIds.length === 0) {
    return {
      ok: false,
      error: {
        code: "PATCH_DRAFT_NOT_FOUND",
        message: "patchDraftVersionIds é obrigatório.",
      },
    };
  }

  const versions = await db.productionCostTableVersion.findMany({
    where: { id: { in: versionIds } },
    select: { id: true, status: true },
  });
  if (versions.length !== versionIds.length) {
    return {
      ok: false,
      error: {
        code: "PATCH_DRAFT_NOT_FOUND",
        message: "Uma ou mais versões DRAFT do patch não foram encontradas.",
      },
    };
  }
  for (const v of versions) {
    if (v.status !== "DRAFT") {
      return {
        ok: false,
        error: {
          code: "PATCH_DRAFT_NOT_FOUND",
          message: `Versão ${v.id} do patch não está em status DRAFT (atual: ${v.status}).`,
        },
      };
    }
  }

  const rows = await db.productionCostTableItem.findMany({
    where: {
      costTableVersionId: { in: versionIds },
      productId: { in: changedProductIds },
    },
    select: {
      productId: true,
      productCodeSnapshot: true,
      productNameSnapshot: true,
      unitProductionCost: true,
      materialCost: true,
      processCost: true,
      laborCost: true,
      machineCost: true,
      overheadCost: true,
      otherCost: true,
      currency: true,
      calculationHash: true,
      calculationSnapshot: true,
    },
  });

  const patchByProductId = new Map<string, ProductionCostTableDraftItemInput>();
  for (const row of rows) {
    if (patchByProductId.has(row.productId)) {
      return {
        ok: false,
        error: {
          code: "DUPLICATE_PATCH_PRODUCT",
          message: `Produto ${row.productId} aparece em mais de um DRAFT do patch.`,
          productId: row.productId,
        },
      };
    }
    patchByProductId.set(row.productId, draftItemFromDbRow(row));
  }

  return { ok: true, patchByProductId };
}

async function loadOfficialCarryForwardItems(
  db: PrismaClient,
  productIds: string[],
  referenceDate: Date,
  deps?: MaterializeCompleteProductionCostSnapshotDeps
): Promise<Map<string, ProductionCostSnapshotOfficialItem>> {
  const loadOfficial = deps?.loadOfficialCosts ?? getEffectiveProductProductionCosts;
  deps?.onOfficialCostsLoaded?.(productIds);

  const effectiveMap = await loadOfficial(db, productIds, referenceDate);
  const itemIds: string[] = [];
  const productByItemId = new Map<string, string>();

  for (const productId of productIds) {
    const effective = effectiveMap.get(productId);
    if (effective?.status === "OK") {
      itemIds.push(effective.costTableItemId);
      productByItemId.set(effective.costTableItemId, productId);
    }
  }

  const out = new Map<string, ProductionCostSnapshotOfficialItem>();
  if (itemIds.length === 0) return out;

  const rows = await db.productionCostTableItem.findMany({
    where: { id: { in: itemIds } },
    select: {
      id: true,
      costTableVersionId: true,
      productId: true,
      productCodeSnapshot: true,
      productNameSnapshot: true,
      unitProductionCost: true,
      materialCost: true,
      processCost: true,
      laborCost: true,
      machineCost: true,
      overheadCost: true,
      otherCost: true,
      currency: true,
      calculationHash: true,
      calculationSnapshot: true,
    },
  });

  for (const row of rows) {
    const item = draftItemFromDbRow(row);
    out.set(row.productId, {
      ...item,
      sourceCostTableItemId: row.id,
      sourceCostTableVersionId: row.costTableVersionId,
    });
  }

  return out;
}

function buildMaterializationNotes(
  baseNotes: string | null | undefined,
  plan: ProductionCostCompleteSnapshotPlan,
  patchDraftVersionIds: string[]
): string {
  const stamp = new Date().toISOString();
  const meta = buildCompleteProductionCostSnapshotMaterializationMeta({
    plan,
    patchDraftVersionIds,
    at: stamp,
  });
  const line = `[${stamp}] ${JSON.stringify(meta)}`;
  const trimmed = baseNotes?.trim();
  return trimmed ? `${trimmed}\n${line}` : line;
}

/**
 * Cria nova ProductionCostTableVersion DRAFT completa (não publica).
 */
export async function materializeCompleteProductionCostSnapshot(
  db: PrismaClient,
  input: MaterializeCompleteProductionCostSnapshotInput,
  deps?: MaterializeCompleteProductionCostSnapshotDeps
): Promise<
  | { ok: true; data: MaterializeCompleteProductionCostSnapshotResult }
  | { ok: false; error: MaterializeCompleteProductionCostSnapshotFailure }
> {
  const started = Date.now();
  const effectiveDate = startOfCivilDate(input.effectiveDate);
  if (Number.isNaN(effectiveDate.getTime())) {
    return {
      ok: false,
      error: { code: "UNEXPECTED", message: "effectiveDate inválida." },
    };
  }

  const changedProductIds = [
    ...new Set(input.changedProductIds.map((id) => id?.trim()).filter(Boolean)),
  ];
  if (changedProductIds.length === 0) {
    return {
      ok: false,
      error: { code: "EMPTY_PATCH", message: "changedProductIds não pode ser vazio." },
    };
  }

  const patchDraftVersionIds = [
    ...new Set(input.patchDraftVersionIds.map((id) => id?.trim()).filter(Boolean)),
  ];

  const patchLoaded = await loadPatchItemsFromDrafts(db, patchDraftVersionIds, changedProductIds);
  if (patchLoaded.ok === false) {
    return { ok: false, error: patchLoaded.error };
  }

  const itemScope = parseProductionCostDraftItemScope(
    input.itemScope ?? DEFAULT_PRODUCTION_COST_DRAFT_ITEM_SCOPE
  );
  const populationSource =
    input.populationSource ?? PRODUCTION_COST_COMPLETE_SNAPSHOT_POPULATION_SOURCE;

  const population = await resolveProductsForProductionCostDraft(db, {
    productIds: [],
    includeAllActiveProducts: true,
    itemScope,
  });

  const officialByProductId = await loadOfficialCarryForwardItems(
    db,
    population.map((p) => p.id),
    effectiveDate,
    deps
  );

  const planned = buildCompleteProductionCostSnapshotPlan({
    population,
    officialByProductId,
    patchByProductId: patchLoaded.patchByProductId,
    changedProductIds,
    populationSource,
  });
  if (planned.ok === false) {
    return {
      ok: false,
      error: {
        code: planned.error.code,
        message: planned.error.message,
        productId: planned.error.productId,
      },
    };
  }
  const { plan } = planned;

  const code =
    (typeof input.code === "string" && input.code.trim()) ||
    productionCostTableCodeFromEffectiveDate(effectiveDate);
  // latestPublished: APENAS para supersedesVersionId / revision.
  // NÃO usar latestPublished.items como catálogo — carry-forward vem do
  // resolver histórico (getEffectiveProductProductionCosts) acima.

  const createDraftOnce = async () => {
    const latestPublished = await findLatestPublishedProductionCostVersionByCode(db, code);
    const maxRevisionRow = await db.productionCostTableVersion.findFirst({
      where: { code },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    const nextRevision = (maxRevisionRow?.revision ?? 0) + 1;
    return createProductionCostTableDraft(db, {
      code,
      name: productionCostTableNameFromCode(code, nextRevision),
      effectiveDate,
      revision: nextRevision,
      supersedesVersionId: latestPublished?.id ?? null,
      source: PRODUCTION_COST_PUBLICATION_SOURCE,
      notes: buildMaterializationNotes(input.notes, plan, patchDraftVersionIds),
      createdBy: input.createdBy?.trim() || null,
    });
  };

  let draft;
  try {
    draft = await createDraftOnce();
  } catch (err) {
    if (!isProductionCostRevisionUniqueConflict(err)) {
      return {
        ok: false,
        error: {
          code: "UNEXPECTED",
          message: err instanceof Error ? err.message : "Falha ao criar DRAFT do snapshot.",
        },
      };
    }
    // Colisão (code, revision) sob concorrência — um retry controlado.
    try {
      draft = await createDraftOnce();
    } catch (retryErr) {
      return {
        ok: false,
        error: {
          code: "UNEXPECTED",
          message:
            retryErr instanceof Error
              ? retryErr.message
              : "Falha ao criar DRAFT do snapshot após colisão de revisão.",
        },
      };
    }
  }

  try {
    const createMany = (
      db.productionCostTableItem as unknown as {
        createMany?: (args: { data: unknown[] }) => Promise<unknown>;
      }
    ).createMany;

    if (typeof createMany === "function") {
      await createMany.call(db.productionCostTableItem, {
        data: plan.items.map((item) => ({
          costTableVersionId: draft.id,
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
          currency: item.currency ?? "BRL",
          calculationHash: item.calculationHash ?? null,
          calculationSnapshot: item.calculationSnapshot ?? undefined,
        })),
      });
    } else {
      for (const item of plan.items) {
        await addOrUpdateProductionCostTableDraftItem(db, draft.id, item);
      }
    }
  } catch (err) {
    try {
      await db.productionCostTableVersion.delete({ where: { id: draft.id } });
    } catch {
      // best-effort cleanup
    }
    return {
      ok: false,
      error: {
        code: "UNEXPECTED",
        message: err instanceof Error ? err.message : "Falha ao persistir itens do snapshot.",
      },
    };
  }

  const persistedCount = await db.productionCostTableItem.count({
    where: { costTableVersionId: draft.id },
  });
  if (persistedCount !== plan.totalItems) {
    try {
      await db.productionCostTableVersion.delete({ where: { id: draft.id } });
    } catch {
      // best-effort
    }
    return {
      ok: false,
      error: {
        code: "UNEXPECTED",
        message: `Snapshot incompleto após persistência (${persistedCount}/${plan.totalItems}).`,
      },
    };
  }

  return {
    ok: true,
    data: {
      version: {
        id: draft.id,
        code: draft.code,
        name: draft.name,
        revision: draft.revision,
        status: "DRAFT",
        effectiveDate: draft.effectiveDate,
        supersedesVersionId: draft.supersedesVersionId ?? null,
      },
      plan,
      summary: {
        populationSource: plan.populationSource,
        populationSize: population.length,
        totalItems: plan.totalItems,
        changedCount: plan.changedCount,
        carriedForwardCount: plan.carriedForwardCount,
        missingCount: plan.missingCount,
        changedProductIds: plan.changedProductIds,
        carriedForwardProductIds: plan.carriedForwardProductIds,
        missingProductIds: plan.missingProductIds,
        patchDraftVersionIds,
        materializationMs: Date.now() - started,
      },
    },
  };
}
