/**
 * Catálogo de MP versionada para o motor industrial getProductCostAnalysis.
 * Puramente leitura — não altera cadastro Material.
 */
import type { PrismaClient } from "@prisma/client";
import { startOfCivilDate, toCivilDateKey } from "./financeCivilDate.js";

export const MATERIAL_COST_SOURCE_VERSIONED_TABLE = "VERSIONED_MATERIAL_COST_TABLE" as const;
export const MATERIAL_COST_SOURCE_LIVE_MATERIAL = "LIVE_MATERIAL" as const;

export type MaterialCostCatalogItem = {
  materialId: string;
  materialCode: string;
  currentCostSnapshot: number;
  freightSnapshot: number;
  landedCostSnapshot: number;
  standardLossSnapshot: number | null;
  unitSnapshot: string;
  costSource: string;
};

export type MaterialCostEngineCatalog = {
  materialCostTableVersionId: string;
  materialCostTableVersionCode: string;
  revision: number;
  effectiveDate: string;
  /** Quando true, ausência no catálogo é erro — nunca usa Material.currentCost vivo. */
  officialProductionDraft: boolean;
  itemsByMaterialId: Map<string, MaterialCostCatalogItem>;
};

export type ResolvedMaterialLineCost =
  | {
      ok: true;
      landedCost: number;
      standardLossPct: number;
      currentCost: number;
      freight: number;
      costSource: typeof MATERIAL_COST_SOURCE_VERSIONED_TABLE | typeof MATERIAL_COST_SOURCE_LIVE_MATERIAL;
      materialCostTableVersionId?: string;
      materialCostTableVersionCode?: string;
      revision?: number;
    }
  | {
      ok: false;
      error: string;
      message: string;
      materialId: string;
      materialCode: string;
    };

export const NO_PUBLISHED_MATERIAL_COST_TABLE_MESSAGE =
  "Não existe tabela oficial de matéria-prima publicada vigente para esta data.";

export function buildMaterialCostEngineCatalogFromVersion(
  version: {
    id: string;
    code: string;
    revision: number;
    effectiveDate: Date;
    items: Array<{
      materialId: string;
      materialCodeSnapshot: string;
      currentCostSnapshot: unknown;
      freightSnapshot: unknown;
      landedCostSnapshot: unknown;
      standardLossSnapshot: unknown | null;
      unitSnapshot: string;
      costSource: string;
    }>;
  },
  options?: { officialProductionDraft?: boolean }
): MaterialCostEngineCatalog {
  const itemsByMaterialId = new Map<string, MaterialCostCatalogItem>();
  for (const row of version.items) {
    itemsByMaterialId.set(row.materialId, {
      materialId: row.materialId,
      materialCode: row.materialCodeSnapshot,
      currentCostSnapshot: Number(row.currentCostSnapshot),
      freightSnapshot: Number(row.freightSnapshot ?? 0),
      landedCostSnapshot: Number(row.landedCostSnapshot),
      standardLossSnapshot:
        row.standardLossSnapshot == null ? null : Number(row.standardLossSnapshot),
      unitSnapshot: row.unitSnapshot,
      costSource: row.costSource,
    });
  }
  return {
    materialCostTableVersionId: version.id,
    materialCostTableVersionCode: version.code,
    revision: version.revision,
    effectiveDate: toCivilDateKey(version.effectiveDate) ?? version.effectiveDate.toISOString().slice(0, 10),
    officialProductionDraft: options?.officialProductionDraft ?? false,
    itemsByMaterialId,
  };
}

export function resolveMaterialLineCostForEngine(
  mat: {
    id: string;
    code: string;
    description: string;
    currentCost: unknown;
    freight: unknown;
    standardLoss: unknown;
  },
  catalog?: MaterialCostEngineCatalog | null
): ResolvedMaterialLineCost {
  if (catalog) {
    const entry = catalog.itemsByMaterialId.get(mat.id);
    if (!entry) {
      if (catalog.officialProductionDraft) {
        return {
          ok: false,
          error: "MATERIAL_NOT_IN_VERSIONED_TABLE",
          message: `Matéria-prima [${mat.code}] não consta na tabela oficial de MP ${catalog.materialCostTableVersionCode} (rev. ${catalog.revision}).`,
          materialId: mat.id,
          materialCode: mat.code,
        };
      }
    } else {
      const landed = entry.landedCostSnapshot;
      if (!Number.isFinite(landed) || landed <= 0) {
        return {
          ok: false,
          error: "MATERIAL_INVALID_VERSIONED_COST",
          message: `Matéria-prima [${mat.code}] com custo landed inválido na tabela oficial de MP.`,
          materialId: mat.id,
          materialCode: mat.code,
        };
      }
      const lossFromItem = entry.standardLossSnapshot;
      const standardLossPct =
        lossFromItem != null && Number.isFinite(lossFromItem)
          ? lossFromItem
          : Number(mat.standardLoss ?? 0);
      return {
        ok: true,
        landedCost: landed,
        standardLossPct,
        currentCost: entry.currentCostSnapshot,
        freight: entry.freightSnapshot,
        costSource: MATERIAL_COST_SOURCE_VERSIONED_TABLE,
        materialCostTableVersionId: catalog.materialCostTableVersionId,
        materialCostTableVersionCode: catalog.materialCostTableVersionCode,
        revision: catalog.revision,
      };
    }
  }

  const currentCost = Number(mat.currentCost);
  const freight = Number(mat.freight ?? 0);
  const landedCost = currentCost + freight;
  return {
    ok: true,
    landedCost,
    standardLossPct: Number(mat.standardLoss ?? 0),
    currentCost,
    freight,
    costSource: MATERIAL_COST_SOURCE_LIVE_MATERIAL,
  };
}

export async function resolvePublishedMaterialCostTableVersionForDate(
  db: PrismaClient,
  referenceDate: Date
) {
  const ref = startOfCivilDate(referenceDate);
  return db.materialCostTableVersion.findFirst({
    where: {
      status: "PUBLISHED",
      effectiveDate: { lte: ref },
    },
    orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }, { publishedAt: "desc" }],
    include: {
      items: {
        orderBy: { materialCodeSnapshot: "asc" },
      },
    },
  });
}

export async function loadMaterialCostEngineCatalogForProductionDraft(
  db: PrismaClient,
  referenceDate: Date
): Promise<MaterialCostEngineCatalog> {
  const version = await resolvePublishedMaterialCostTableVersionForDate(db, referenceDate);
  if (!version || version.items.length === 0) {
    throw new Error(NO_PUBLISHED_MATERIAL_COST_TABLE_MESSAGE);
  }
  return buildMaterialCostEngineCatalogFromVersion(version, { officialProductionDraft: true });
}

export type MaterialCostTableSourcePreview = {
  available: boolean;
  message: string | null;
  materialCostTableVersionId: string | null;
  materialCostTableVersionCode: string | null;
  revision: number | null;
  effectiveDate: string | null;
  itemsCount: number;
  name: string | null;
};

export async function previewMaterialCostTableSourceForProductionDraft(
  db: PrismaClient,
  referenceDate: Date
): Promise<MaterialCostTableSourcePreview> {
  const version = await resolvePublishedMaterialCostTableVersionForDate(db, referenceDate);
  if (!version) {
    return {
      available: false,
      message: NO_PUBLISHED_MATERIAL_COST_TABLE_MESSAGE,
      materialCostTableVersionId: null,
      materialCostTableVersionCode: null,
      revision: null,
      effectiveDate: null,
      itemsCount: 0,
      name: null,
    };
  }
  return {
    available: version.items.length > 0,
    message:
      version.items.length > 0
        ? null
        : "Tabela de matéria-prima publicada existe, mas não possui itens.",
    materialCostTableVersionId: version.id,
    materialCostTableVersionCode: version.code,
    revision: version.revision,
    effectiveDate: toCivilDateKey(version.effectiveDate),
    itemsCount: version.items.length,
    name: version.name,
  };
}
