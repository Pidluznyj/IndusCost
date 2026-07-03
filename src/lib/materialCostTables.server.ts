/**
 * Serviço server-only: tabela oficial versionada de custo de matéria-prima.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ProductionCostTableVersionStatus } from "@prisma/client";
import { startOfCivilDate } from "./financeCivilDate.js";
import {
  assertMaterialCostTableVersionEditable,
  assertNonNegativeMaterialCost,
  assertPositiveMaterialLandedCost,
  effectiveMaterialCostLookupKey,
  nextMaterialCostTableRevision,
  resolveEffectiveMaterialCostFromCatalog,
  type EffectiveMaterialCostResult,
  type MaterialCostTableDraftItemInput,
  type MaterialCostTableItemSnapshot,
  type MaterialCostTableVersionSnapshot,
  type MaterialCostTableVersionWithItems,
} from "./materialCostVersioning.js";

export type {
  EffectiveMaterialCostResult,
  MaterialCostTableDraftItemInput,
} from "./materialCostVersioning.js";

export {
  MATERIAL_COST_TABLE_EDITABLE_STATUS,
  MATERIAL_COST_TABLE_IMMUTABLE_STATUSES,
  MATERIAL_COST_TABLE_RESOLVER_STATUSES,
} from "./materialCostVersioning.js";

function decimalToNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapItemRow(row: {
  id: string;
  materialCostTableVersionId: string;
  materialId: string;
  materialCodeSnapshot: string;
  materialDescriptionSnapshot: string;
  unitSnapshot: string;
  currentCostSnapshot: unknown;
  freightSnapshot: unknown;
  landedCostSnapshot: unknown;
  averageCostSnapshot: unknown | null;
  standardCostSnapshot: unknown | null;
  standardLossSnapshot: unknown | null;
  costSource: string;
  warningsJson: unknown;
  calculationHash: string | null;
  calculationSnapshot: unknown;
  createdAt: Date;
}): MaterialCostTableItemSnapshot {
  return {
    id: row.id,
    materialCostTableVersionId: row.materialCostTableVersionId,
    materialId: row.materialId,
    materialCodeSnapshot: row.materialCodeSnapshot,
    materialDescriptionSnapshot: row.materialDescriptionSnapshot,
    unitSnapshot: row.unitSnapshot,
    currentCostSnapshot: decimalToNumber(row.currentCostSnapshot),
    freightSnapshot: decimalToNumber(row.freightSnapshot),
    landedCostSnapshot: decimalToNumber(row.landedCostSnapshot),
    averageCostSnapshot:
      row.averageCostSnapshot == null ? null : decimalToNumber(row.averageCostSnapshot),
    standardCostSnapshot:
      row.standardCostSnapshot == null ? null : decimalToNumber(row.standardCostSnapshot),
    standardLossSnapshot:
      row.standardLossSnapshot == null ? null : decimalToNumber(row.standardLossSnapshot),
    costSource: row.costSource,
    warningsJson: row.warningsJson ?? null,
    calculationHash: row.calculationHash,
    calculationSnapshot: row.calculationSnapshot,
    createdAt: row.createdAt,
  };
}

function mapVersionRow(row: {
  id: string;
  code: string;
  name: string;
  effectiveDate: Date;
  status: ProductionCostTableVersionStatus;
  revision: number;
  publishedAt: Date | null;
  createdAt: Date;
  items?: Array<Parameters<typeof mapItemRow>[0]>;
}): MaterialCostTableVersionWithItems {
  const snapshot: MaterialCostTableVersionSnapshot = {
    id: row.id,
    code: row.code,
    name: row.name,
    effectiveDate: row.effectiveDate,
    status: row.status as MaterialCostTableVersionSnapshot["status"],
    revision: row.revision,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
  return {
    ...snapshot,
    items: (row.items ?? []).map(mapItemRow),
  };
}

export type CreateMaterialCostTableDraftInput = {
  code: string;
  name: string;
  effectiveDate: Date;
  description?: string | null;
  revision?: number;
  source?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  supersedesVersionId?: string | null;
  summaryJson?: unknown;
};

export async function createMaterialCostTableDraft(
  db: PrismaClient,
  input: CreateMaterialCostTableDraftInput
) {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code) throw new Error("code é obrigatório.");
  if (!name) throw new Error("name é obrigatório.");

  const effectiveDate = startOfCivilDate(input.effectiveDate);
  if (Number.isNaN(effectiveDate.getTime())) {
    throw new Error("effectiveDate inválida.");
  }

  let revision = input.revision;
  if (revision == null) {
    const maxRow = await db.materialCostTableVersion.findFirst({
      where: { code },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    revision = nextMaterialCostTableRevision(maxRow?.revision);
  }

  if (input.supersedesVersionId) {
    const prior = await db.materialCostTableVersion.findUnique({
      where: { id: input.supersedesVersionId },
      select: { id: true, code: true, status: true },
    });
    if (!prior) throw new Error("supersedesVersionId não encontrado.");
    if (prior.code !== code) {
      throw new Error("supersedesVersionId deve pertencer ao mesmo code da nova versão.");
    }
  }

  return db.materialCostTableVersion.create({
    data: {
      code,
      name,
      description: input.description?.trim() || null,
      effectiveDate,
      revision,
      status: "DRAFT",
      source: input.source?.trim() || null,
      notes: input.notes?.trim() || null,
      createdBy: input.createdBy?.trim() || null,
      supersedesVersionId: input.supersedesVersionId ?? null,
      summaryJson:
        input.summaryJson != null ? (input.summaryJson as Prisma.InputJsonValue) : undefined,
    },
  });
}

export async function addOrUpdateMaterialCostTableDraftItem(
  db: PrismaClient,
  materialCostTableVersionId: string,
  item: MaterialCostTableDraftItemInput
) {
  const version = await db.materialCostTableVersion.findUnique({
    where: { id: materialCostTableVersionId },
    select: { id: true, status: true },
  });
  if (!version) throw new Error("Versão de tabela de custo de matéria-prima não encontrada.");
  assertMaterialCostTableVersionEditable(version.status as never, "editar itens");

  assertNonNegativeMaterialCost(item.currentCostSnapshot, "currentCostSnapshot");
  assertNonNegativeMaterialCost(item.freightSnapshot ?? 0, "freightSnapshot");
  assertNonNegativeMaterialCost(item.landedCostSnapshot, "landedCostSnapshot");

  const material = await db.material.findUnique({
    where: { id: item.materialId },
    select: { id: true },
  });
  if (!material) throw new Error("Matéria-prima não encontrada.");

  const data = {
    materialCodeSnapshot: item.materialCodeSnapshot.trim(),
    materialDescriptionSnapshot: item.materialDescriptionSnapshot.trim(),
    unitSnapshot: item.unitSnapshot.trim(),
    currentCostSnapshot: item.currentCostSnapshot,
    freightSnapshot: item.freightSnapshot ?? 0,
    landedCostSnapshot: item.landedCostSnapshot,
    averageCostSnapshot: item.averageCostSnapshot ?? null,
    standardCostSnapshot: item.standardCostSnapshot ?? null,
    standardLossSnapshot: item.standardLossSnapshot ?? null,
    costSource: item.costSource?.trim() || "CURRENT_MATERIAL",
    warningsJson:
      item.warningsJson != null ? (item.warningsJson as Prisma.InputJsonValue) : undefined,
    calculationHash: item.calculationHash?.trim() || null,
    calculationSnapshot:
      item.calculationSnapshot != null
        ? (item.calculationSnapshot as Prisma.InputJsonValue)
        : undefined,
  };

  return db.materialCostTableItem.upsert({
    where: {
      materialCostTableVersionId_materialId: {
        materialCostTableVersionId,
        materialId: item.materialId,
      },
    },
    create: {
      materialCostTableVersionId,
      materialId: item.materialId,
      ...data,
    },
    update: data,
  });
}

export type PublishMaterialCostTableVersionInput = {
  versionId: string;
  publishedBy?: string | null;
  supersedeVersionId?: string | null;
};

export async function publishMaterialCostTableVersion(
  db: PrismaClient,
  input: PublishMaterialCostTableVersionInput
) {
  const version = await db.materialCostTableVersion.findUnique({
    where: { id: input.versionId },
    include: { items: true },
  });
  if (!version) throw new Error("Versão não encontrada.");
  assertMaterialCostTableVersionEditable(version.status as never, "publicar");

  if (version.items.length === 0) {
    throw new Error("Não é possível publicar versão sem itens.");
  }

  for (const row of version.items) {
    assertPositiveMaterialLandedCost(
      decimalToNumber(row.landedCostSnapshot),
      row.materialCodeSnapshot
    );
  }

  const publishedAt = new Date();

  return db.$transaction(async (tx) => {
    const published = await tx.materialCostTableVersion.update({
      where: { id: input.versionId },
      data: {
        status: "PUBLISHED",
        publishedAt,
        publishedBy: input.publishedBy?.trim() || null,
      },
      include: { items: true },
    });

    const supersedeId = input.supersedeVersionId ?? version.supersedesVersionId;
    if (supersedeId) {
      const prior = await tx.materialCostTableVersion.findUnique({
        where: { id: supersedeId },
        select: { id: true, status: true, code: true },
      });
      if (!prior) throw new Error("Versão a substituir não encontrada.");
      if (prior.code !== version.code) {
        throw new Error("Versão a substituir deve ter o mesmo code.");
      }
      if (prior.status === "PUBLISHED") {
        await tx.materialCostTableVersion.update({
          where: { id: supersedeId },
          data: { status: "SUPERSEDED" },
        });
      }
    }

    return published;
  });
}

async function loadResolverCatalog(
  db: PrismaClient,
  materialIds: string[],
  referenceDate: Date
): Promise<MaterialCostTableVersionWithItems[]> {
  const ref = startOfCivilDate(referenceDate);

  const versions = await db.materialCostTableVersion.findMany({
    where: {
      status: { in: ["PUBLISHED", "SUPERSEDED"] },
      effectiveDate: { lte: ref },
    },
    include: {
      items: {
        where: materialIds.length > 0 ? { materialId: { in: materialIds } } : undefined,
      },
    },
    orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }, { createdAt: "desc" }],
  });

  return versions.map(mapVersionRow);
}

export async function getEffectiveMaterialCost(
  db: PrismaClient,
  materialId: string,
  referenceDate: Date
): Promise<EffectiveMaterialCostResult> {
  const catalog = await loadResolverCatalog(db, [materialId], referenceDate);
  return resolveEffectiveMaterialCostFromCatalog(catalog, materialId, referenceDate);
}

export async function assertMaterialCostTableVersionMutable(
  db: PrismaClient,
  versionId: string,
  action = "alterar"
): Promise<void> {
  const version = await db.materialCostTableVersion.findUnique({
    where: { id: versionId },
    select: { status: true },
  });
  if (!version) throw new Error("Versão não encontrada.");
  assertMaterialCostTableVersionEditable(version.status as never, action);
}

export async function getMaterialCostTableVersionById(db: PrismaClient, versionId: string) {
  return db.materialCostTableVersion.findUnique({
    where: { id: versionId },
    include: {
      items: {
        orderBy: { materialCodeSnapshot: "asc" },
        take: 500,
      },
      supersedesVersion: {
        select: { id: true, code: true, revision: true, status: true },
      },
    },
  });
}

export async function listMaterialCostTableVersionItems(
  db: PrismaClient,
  versionId: string,
  options?: { limit?: number; offset?: number }
) {
  const limit = Math.min(Math.max(options?.limit ?? 500, 1), 1000);
  const offset = Math.max(options?.offset ?? 0, 0);
  return db.materialCostTableItem.findMany({
    where: { materialCostTableVersionId: versionId },
    orderBy: { materialCodeSnapshot: "asc" },
    take: limit,
    skip: offset,
  });
}

export { effectiveMaterialCostLookupKey };
