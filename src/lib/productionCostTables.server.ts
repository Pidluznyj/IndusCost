/**
 * Serviço server-only: tabela oficial versionada de custo de produção industrial.
 * Não altera motor de custo industrial — persiste fotos publicadas por produto/versão.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { ProductionCostTableVersionStatus } from "@prisma/client";
import {
  assertNonNegativeProductionUnitCost,
  assertPositiveProductionUnitCost,
  assertProductionCostTableVersionEditable,
  nextProductionCostTableRevision,
  resolveEffectiveProductProductionCostFromCatalog,
  resolveEffectiveProductProductionCostsFromCatalog,
  type EffectiveProductProductionCostResult,
  type ProductionCostTableDraftItemInput,
  type ProductionCostTableItemSnapshot,
  type ProductionCostTableVersionSnapshot,
  type ProductionCostTableVersionWithItems,
} from "./productionCostVersioning.js";
import { startOfCivilDate } from "./financeCivilDate.js";

export type {
  EffectiveProductProductionCostResult,
  ProductionCostTableDraftItemInput,
} from "./productionCostVersioning.js";

export {
  PRODUCTION_COST_TABLE_EDITABLE_STATUS,
  PRODUCTION_COST_TABLE_IMMUTABLE_STATUSES,
  PRODUCTION_COST_TABLE_RESOLVER_STATUSES,
} from "./productionCostVersioning.js";

function decimalToNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapItemRow(row: {
  id: string;
  costTableVersionId: string;
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
  createdAt: Date;
}): ProductionCostTableItemSnapshot {
  return {
    id: row.id,
    costTableVersionId: row.costTableVersionId,
    productId: row.productId,
    productCodeSnapshot: row.productCodeSnapshot,
    productNameSnapshot: row.productNameSnapshot,
    unitProductionCost: decimalToNumber(row.unitProductionCost),
    currency: row.currency,
    calculationHash: row.calculationHash,
    calculationSnapshot: row.calculationSnapshot,
    createdAt: row.createdAt,
    breakdown: {
      materialCost: decimalToNumber(row.materialCost),
      processCost: decimalToNumber(row.processCost),
      laborCost: decimalToNumber(row.laborCost),
      machineCost: decimalToNumber(row.machineCost),
      overheadCost: decimalToNumber(row.overheadCost),
      otherCost: decimalToNumber(row.otherCost),
    },
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
}): ProductionCostTableVersionWithItems {
  const snapshot: ProductionCostTableVersionSnapshot = {
    id: row.id,
    code: row.code,
    name: row.name,
    effectiveDate: row.effectiveDate,
    status: row.status,
    revision: row.revision,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
  return {
    ...snapshot,
    items: (row.items ?? []).map(mapItemRow),
  };
}

export type CreateProductionCostTableDraftInput = {
  code: string;
  name: string;
  effectiveDate: Date;
  revision?: number;
  source?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  supersedesVersionId?: string | null;
};

export async function createProductionCostTableDraft(
  db: PrismaClient,
  input: CreateProductionCostTableDraftInput
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
    const maxRow = await db.productionCostTableVersion.findFirst({
      where: { code },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    revision = nextProductionCostTableRevision(maxRow?.revision);
  }

  if (input.supersedesVersionId) {
    const prior = await db.productionCostTableVersion.findUnique({
      where: { id: input.supersedesVersionId },
      select: { id: true, code: true, status: true },
    });
    if (!prior) throw new Error("supersedesVersionId não encontrado.");
    if (prior.code !== code) {
      throw new Error("supersedesVersionId deve pertencer ao mesmo code da nova versão.");
    }
  }

  return db.productionCostTableVersion.create({
    data: {
      code,
      name,
      effectiveDate,
      revision,
      status: "DRAFT",
      source: input.source?.trim() || null,
      notes: input.notes?.trim() || null,
      createdBy: input.createdBy?.trim() || null,
      supersedesVersionId: input.supersedesVersionId ?? null,
    },
  });
}

export async function addOrUpdateProductionCostTableDraftItem(
  db: PrismaClient,
  costTableVersionId: string,
  item: ProductionCostTableDraftItemInput
) {
  const version = await db.productionCostTableVersion.findUnique({
    where: { id: costTableVersionId },
    select: { id: true, status: true },
  });
  if (!version) throw new Error("Versão de tabela de custo não encontrada.");
  assertProductionCostTableVersionEditable(version.status, "editar itens");

  assertNonNegativeProductionUnitCost(item.unitProductionCost);
  const materialCost = item.materialCost ?? 0;
  const processCost = item.processCost ?? 0;
  const laborCost = item.laborCost ?? 0;
  const machineCost = item.machineCost ?? 0;
  const overheadCost = item.overheadCost ?? 0;
  const otherCost = item.otherCost ?? 0;
  for (const [label, value] of [
    ["materialCost", materialCost],
    ["processCost", processCost],
    ["laborCost", laborCost],
    ["machineCost", machineCost],
    ["overheadCost", overheadCost],
    ["otherCost", otherCost],
  ] as const) {
    assertNonNegativeProductionUnitCost(value, label);
  }

  const product = await db.product.findUnique({
    where: { id: item.productId },
    select: { id: true },
  });
  if (!product) throw new Error("Produto não encontrado.");

  const data = {
    productCodeSnapshot: item.productCodeSnapshot.trim(),
    productNameSnapshot: item.productNameSnapshot.trim(),
    unitProductionCost: item.unitProductionCost,
    materialCost,
    processCost,
    laborCost,
    machineCost,
    overheadCost,
    otherCost,
    currency: item.currency?.trim() || "BRL",
    calculationHash: item.calculationHash?.trim() || null,
    calculationSnapshot:
      item.calculationSnapshot != null
        ? (item.calculationSnapshot as Prisma.InputJsonValue)
        : undefined,
  };

  return db.productionCostTableItem.upsert({
    where: {
      costTableVersionId_productId: {
        costTableVersionId,
        productId: item.productId,
      },
    },
    create: {
      costTableVersionId,
      productId: item.productId,
      ...data,
    },
    update: data,
  });
}

export async function supersedeProductionCostTableVersion(
  db: PrismaClient,
  versionId: string
) {
  const version = await db.productionCostTableVersion.findUnique({
    where: { id: versionId },
    select: { id: true, status: true },
  });
  if (!version) throw new Error("Versão não encontrada.");
  if (version.status !== "PUBLISHED") {
    throw new Error("Apenas versões PUBLISHED podem ser marcadas como SUPERSEDED.");
  }

  return db.productionCostTableVersion.update({
    where: { id: versionId },
    data: { status: "SUPERSEDED" },
  });
}

export type PublishProductionCostTableVersionInput = {
  versionId: string;
  publishedBy?: string | null;
  /** Se informado, marca a versão anterior como SUPERSEDED após publicação. */
  supersedeVersionId?: string | null;
};

export async function publishProductionCostTableVersion(
  db: PrismaClient,
  input: PublishProductionCostTableVersionInput
) {
  const version = await db.productionCostTableVersion.findUnique({
    where: { id: input.versionId },
    include: { items: true },
  });
  if (!version) throw new Error("Versão não encontrada.");
  assertProductionCostTableVersionEditable(version.status, "publicar");

  if (version.items.length === 0) {
    throw new Error("Não é possível publicar versão sem itens.");
  }

  for (const row of version.items) {
    assertPositiveProductionUnitCost(decimalToNumber(row.unitProductionCost), row.productCodeSnapshot);
  }

  const publishedAt = new Date();

  return db.$transaction(async (tx) => {
    const published = await tx.productionCostTableVersion.update({
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
      const prior = await tx.productionCostTableVersion.findUnique({
        where: { id: supersedeId },
        select: { id: true, status: true, code: true },
      });
      if (!prior) throw new Error("Versão a substituir não encontrada.");
      if (prior.code !== version.code) {
        throw new Error("Versão a substituir deve ter o mesmo code.");
      }
      if (prior.status === "PUBLISHED") {
        await tx.productionCostTableVersion.update({
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
  productIds: string[],
  referenceDate: Date
): Promise<ProductionCostTableVersionWithItems[]> {
  const ref = startOfCivilDate(referenceDate);

  const versions = await db.productionCostTableVersion.findMany({
    where: {
      status: { in: ["PUBLISHED", "SUPERSEDED"] },
      effectiveDate: { lte: ref },
    },
    include: {
      items: {
        where: productIds.length > 0 ? { productId: { in: productIds } } : undefined,
      },
    },
    orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }, { createdAt: "desc" }],
  });

  return versions.map(mapVersionRow);
}

export async function getEffectiveProductProductionCost(
  db: PrismaClient,
  productId: string,
  referenceDate: Date
): Promise<EffectiveProductProductionCostResult> {
  const catalog = await loadResolverCatalog(db, [productId], referenceDate);
  return resolveEffectiveProductProductionCostFromCatalog(catalog, productId, referenceDate);
}

export async function getEffectiveProductProductionCosts(
  db: PrismaClient,
  productIds: string[],
  referenceDate: Date
): Promise<Map<string, EffectiveProductProductionCostResult>> {
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const catalog = await loadResolverCatalog(db, uniqueIds, referenceDate);
  return resolveEffectiveProductProductionCostsFromCatalog(catalog, uniqueIds, referenceDate);
}

/** Impede update/delete acidental em versões imutáveis via serviço. */
export async function assertProductionCostTableVersionMutable(
  db: PrismaClient,
  versionId: string,
  action = "alterar"
): Promise<void> {
  const version = await db.productionCostTableVersion.findUnique({
    where: { id: versionId },
    select: { status: true },
  });
  if (!version) throw new Error("Versão não encontrada.");
  assertProductionCostTableVersionEditable(version.status, action);
}
