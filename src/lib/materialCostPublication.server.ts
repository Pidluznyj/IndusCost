/**
 * Orquestração: gera DRAFT/publicação de custo de matéria-prima a partir do cadastro Material.
 */
import type { PrismaClient } from "@prisma/client";
import { startOfCivilDate } from "./financeCivilDate.js";
import {
  MATERIAL_COST_PUBLICATION_SOURCE,
  buildMaterialCostDraftItemFromMaterial,
  isValidMaterialLandedCostForDraft,
  materialCostTableCodeFromEffectiveDateKey,
  type MaterialRowForCostSnapshot,
} from "./materialCostPublication.js";
import {
  materialCostTableNameFromCode,
  nextMaterialCostTableRevision,
} from "./materialCostVersioning.js";
import {
  addOrUpdateMaterialCostTableDraftItem,
  createMaterialCostTableDraft,
  publishMaterialCostTableVersion,
} from "./materialCostTables.server.js";

export type GenerateMaterialCostDraftIssue = {
  code: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  message: string;
};

export type GenerateMaterialCostDraftSummary = {
  materialsEvaluated: number;
  materialsWithValidCost: number;
  itemsCreated: number;
  itemsSkipped: number;
  errors: GenerateMaterialCostDraftIssue[];
  warnings: GenerateMaterialCostDraftIssue[];
};

export type GenerateMaterialCostTableDraftInput = {
  effectiveDate: Date;
  materialIds?: string[];
  includeAllActiveMaterials?: boolean;
  notes?: string | null;
  description?: string | null;
  createdBy?: string | null;
};

export async function findLatestPublishedMaterialCostVersionByCode(
  db: PrismaClient,
  code: string
) {
  return db.materialCostTableVersion.findFirst({
    where: { code, status: "PUBLISHED" },
    orderBy: [{ revision: "desc" }, { publishedAt: "desc" }],
    select: { id: true, code: true, revision: true, status: true },
  });
}

export async function generateMaterialCostTableDraftFromMaterials(
  db: PrismaClient,
  input: GenerateMaterialCostTableDraftInput
) {
  const effectiveDate = startOfCivilDate(input.effectiveDate);
  if (Number.isNaN(effectiveDate.getTime())) {
    throw new Error("effectiveDate inválida.");
  }

  const materialIds = [...new Set((input.materialIds ?? []).filter(Boolean))];
  const materials = await db.material.findMany({
    where: {
      status: "ACTIVE",
      ...(materialIds.length > 0
        ? { id: { in: materialIds } }
        : input.includeAllActiveMaterials
          ? {}
          : { id: { in: [] } }),
    },
    select: {
      id: true,
      code: true,
      description: true,
      unit: true,
      currentCost: true,
      averageCost: true,
      standardCost: true,
      freight: true,
      standardLoss: true,
      status: true,
    },
    orderBy: { code: "asc" },
  });

  if (materials.length === 0) {
    throw new Error(
      "Nenhuma matéria-prima ativa selecionada para geração de custo versionado."
    );
  }

  const code = materialCostTableCodeFromEffectiveDateKey(effectiveDate);
  const latestPublished = await findLatestPublishedMaterialCostVersionByCode(db, code);

  const maxRevisionRow = await db.materialCostTableVersion.findFirst({
    where: { code },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  const nextRevision = nextMaterialCostTableRevision(maxRevisionRow?.revision);

  const summary: GenerateMaterialCostDraftSummary = {
    materialsEvaluated: materials.length,
    materialsWithValidCost: 0,
    itemsCreated: 0,
    itemsSkipped: 0,
    errors: [],
    warnings: [],
  };

  const draft = await createMaterialCostTableDraft(db, {
    code,
    name: materialCostTableNameFromCode(code, nextRevision),
    description: input.description?.trim() || null,
    effectiveDate,
    revision: nextRevision,
    supersedesVersionId: latestPublished?.id ?? null,
    source: MATERIAL_COST_PUBLICATION_SOURCE,
    notes: input.notes?.trim() || null,
    createdBy: input.createdBy?.trim() || null,
    summaryJson: summary,
  });

  const calculatedAt = new Date();

  for (const material of materials) {
    const row: MaterialRowForCostSnapshot = {
      id: material.id,
      code: material.code,
      description: material.description,
      unit: material.unit,
      currentCost: material.currentCost,
      averageCost: material.averageCost,
      standardCost: material.standardCost,
      freight: material.freight,
      standardLoss: material.standardLoss,
      status: material.status,
    };

    const itemDraft = buildMaterialCostDraftItemFromMaterial(row, calculatedAt);

    if (!isValidMaterialLandedCostForDraft(itemDraft.landedCostSnapshot)) {
      summary.itemsSkipped += 1;
      summary.errors.push({
        code: "SEM_CUSTO",
        materialId: material.id,
        materialCode: material.code,
        materialName: material.description,
        message: "Matéria-prima sem custo landed válido (> 0) — não incluída no DRAFT.",
      });
      continue;
    }

    summary.materialsWithValidCost += 1;

    if (itemDraft.warningsJson && Array.isArray(itemDraft.warningsJson)) {
      for (const warning of itemDraft.warningsJson) {
        summary.warnings.push({
          code: "MATERIAL_COST_WARNING",
          materialId: material.id,
          materialCode: material.code,
          materialName: material.description,
          message: String(warning),
        });
      }
    }

    await addOrUpdateMaterialCostTableDraftItem(db, draft.id, itemDraft);
    summary.itemsCreated += 1;
  }

  await db.materialCostTableVersion.update({
    where: { id: draft.id },
    data: { summaryJson: summary as never },
  });

  const version = await db.materialCostTableVersion.findUnique({
    where: { id: draft.id },
    include: { _count: { select: { items: true } } },
  });

  return { version, summary, supersedesVersionId: latestPublished?.id ?? null };
}

export async function listMaterialCostTableVersions(
  db: PrismaClient,
  options?: { limit?: number; status?: string | null; code?: string | null }
) {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
  const status =
    typeof options?.status === "string" && options.status.trim()
      ? options.status.trim().toUpperCase()
      : null;
  const code =
    typeof options?.code === "string" && options.code.trim() ? options.code.trim() : null;

  return db.materialCostTableVersion.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(code ? { code } : {}),
    },
    orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }, { createdAt: "desc" }],
    take: limit,
    include: {
      _count: { select: { items: true } },
      supersedesVersion: {
        select: { id: true, code: true, revision: true, status: true },
      },
    },
  });
}

export type PublishMaterialCostVersionInput = {
  versionId: string;
  publishedBy?: string | null;
  supersedeVersionId?: string | null;
};

export async function publishMaterialCostVersionFromDraft(
  db: PrismaClient,
  input: PublishMaterialCostVersionInput
) {
  const version = await db.materialCostTableVersion.findUnique({
    where: { id: input.versionId },
    select: { id: true, code: true, supersedesVersionId: true, status: true },
  });
  if (!version) throw new Error("Versão não encontrada.");

  let supersedeId = input.supersedeVersionId ?? version.supersedesVersionId;
  if (!supersedeId) {
    const latestPublished = await findLatestPublishedMaterialCostVersionByCode(db, version.code);
    if (latestPublished && latestPublished.id !== version.id) {
      supersedeId = latestPublished.id;
    }
  }

  return publishMaterialCostTableVersion(db, {
    versionId: input.versionId,
    publishedBy: input.publishedBy,
    supersedeVersionId: supersedeId,
  });
}
