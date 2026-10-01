/**
 * Carga do Relatório de Estoque – Composição de Custo. Somente leitura.
 *
 * Reusa a população/saldo da posição de estoque e a mesma vigência do Varejo 1
 * e da tabela oficial de matéria-prima. Lê a decomposição congelada
 * (frozenMaterialCost / frozenHhCost / frozenHmCost) do MESMO PriceTableItem
 * que fornece o frozenTotalCost — nunca chama o motor vivo.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { resolveServerAppBuildInfo } from "@/src/lib/appVersion.js";
import { startOfCivilDate, toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { resolvePublishedPriceTableVersionForDate } from "@/src/lib/priceTablePublication.server.js";
import {
  buildInventoryCostCompositionReport,
  type InventoryCostCompositionReport,
  type InventoryCostCompositionSource,
  type InventoryFrozenCostComposition,
} from "./inventoryCostCompositionReport.js";
import {
  INVENTORY_INDUSTRIAL_COST_UNAVAILABLE,
  INVENTORY_MATERIAL_COST_UNAVAILABLE,
  INVENTORY_VAREJO_1_TABLE_CODE,
} from "./inventoryManagerialValuation.js";
import { loadInventoryMaterialFrozenCosts } from "./inventoryManagerialValuation.server.js";
import { loadInventoryPositionSourceLines } from "./inventoryPositionReport.server.js";

function toDecimal(value: unknown): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  if (value == null || value === "") return new Prisma.Decimal(0);
  return new Prisma.Decimal(String(value));
}

/** costAnalysisPartial congelado em costSnapshotJson.calculationSnapshot (quando a publicação registrou). */
export function readFrozenCostAnalysisPartial(costSnapshotJson: unknown): boolean | null {
  if (!costSnapshotJson || typeof costSnapshotJson !== "object") return null;
  const snapshot = (costSnapshotJson as { calculationSnapshot?: unknown }).calculationSnapshot;
  if (!snapshot || typeof snapshot !== "object") return null;
  const flag = (snapshot as { costAnalysisPartial?: unknown }).costAnalysisPartial;
  return typeof flag === "boolean" ? flag : null;
}

/**
 * Mesma regra de indexUnitAmountByProductId: produto duplicado na mesma versão
 * publicada fica sem dado (null), em vez de escolher uma linha.
 */
export function indexFrozenCostComposition(
  rows: readonly {
    productId: string;
    frozenTotalCost: unknown;
    frozenMaterialCost: unknown;
    frozenHhCost: unknown;
    frozenHmCost: unknown;
    costSnapshotJson?: unknown;
  }[]
): Map<string, InventoryFrozenCostComposition | null> {
  const map = new Map<string, InventoryFrozenCostComposition | null>();
  for (const row of rows) {
    if (map.has(row.productId)) {
      map.set(row.productId, null);
      continue;
    }
    if (row.frozenTotalCost == null || row.frozenTotalCost === "") {
      map.set(row.productId, null);
      continue;
    }
    map.set(row.productId, {
      total: toDecimal(row.frozenTotalCost),
      material: toDecimal(row.frozenMaterialCost),
      hh: toDecimal(row.frozenHhCost),
      hm: toDecimal(row.frozenHmCost),
      costAnalysisPartial: readFrozenCostAnalysisPartial(row.costSnapshotJson),
    });
  }
  return map;
}

export type InventoryFrozenCostCompositions = {
  compositionByProductId: Map<string, InventoryFrozenCostComposition | null> | null;
  unavailableReason: string | null;
  version: {
    id: string;
    versionNumber: number;
    publishedAt: string | null;
    effectiveFrom: string | null;
    productionCostTableVersionId: string | null;
  } | null;
};

export async function loadInventoryFrozenCostCompositions(
  db: PrismaClient,
  productIds: readonly string[],
  referenceDate: Date
): Promise<InventoryFrozenCostCompositions> {
  const uniqueProductIds = [...new Set(productIds.filter((id) => id.trim().length > 0))];
  const table = await db.priceTable.findUnique({
    where: { code: INVENTORY_VAREJO_1_TABLE_CODE },
    select: { id: true, status: true },
  });
  if (!table || table.status !== "ACTIVE") {
    return { compositionByProductId: null, unavailableReason: INVENTORY_INDUSTRIAL_COST_UNAVAILABLE, version: null };
  }
  const version = await resolvePublishedPriceTableVersionForDate(db, table.id, referenceDate);
  if (!version) {
    return { compositionByProductId: null, unavailableReason: INVENTORY_INDUSTRIAL_COST_UNAVAILABLE, version: null };
  }
  const rows =
    uniqueProductIds.length === 0
      ? []
      : await db.priceTableItem.findMany({
          where: { priceTableVersionId: version.id, productId: { in: uniqueProductIds } },
          select: {
            productId: true,
            frozenTotalCost: true,
            frozenMaterialCost: true,
            frozenHhCost: true,
            frozenHmCost: true,
            costSnapshotJson: true,
          },
        });
  return {
    compositionByProductId: indexFrozenCostComposition(rows),
    unavailableReason: null,
    version: {
      id: version.id,
      versionNumber: version.versionNumber,
      publishedAt: version.publishedAt?.toISOString() ?? null,
      effectiveFrom: version.effectiveFrom?.toISOString() ?? null,
      productionCostTableVersionId: version.productionCostTableVersionId ?? null,
    },
  };
}

async function loadMaterialCostTableVersionLabel(db: PrismaClient, referenceDate: Date): Promise<string | null> {
  const version = await db.materialCostTableVersion.findFirst({
    where: { status: "PUBLISHED", effectiveDate: { lte: startOfCivilDate(referenceDate) } },
    orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }, { publishedAt: "desc" }],
    select: { code: true, revision: true, effectiveDate: true, publishedAt: true },
  });
  if (!version) return null;
  return `${version.code} rev. ${version.revision} · vigência ${toCivilDateKey(version.effectiveDate) ?? "—"} · publicada em ${version.publishedAt?.toISOString() ?? "—"}`;
}

async function loadProductionCostTableVersionLabel(db: PrismaClient, id: string | null): Promise<string | null> {
  if (!id) return null;
  const version = await db.productionCostTableVersion.findUnique({
    where: { id },
    select: { code: true, revision: true, effectiveDate: true, publishedAt: true },
  });
  if (!version) return null;
  return `${version.code} rev. ${version.revision} · vigência ${toCivilDateKey(version.effectiveDate) ?? "—"} · publicada em ${version.publishedAt?.toISOString() ?? "—"}`;
}

export async function loadInventoryCostCompositionReport(
  db: PrismaClient,
  referenceDate = new Date()
): Promise<InventoryCostCompositionReport> {
  const lines = await loadInventoryPositionSourceLines(db);

  const productIds = lines
    .filter(
      (line) =>
        line.physicalQuantity.gt(0) &&
        (line.itemType === "FINISHED_PRODUCT" || line.itemType === "COMPONENT") &&
        Boolean(line.productId)
    )
    .map((line) => line.productId as string);
  const materialIds = lines
    .filter((line) => line.physicalQuantity.gt(0) && line.itemType === "RAW_MATERIAL" && Boolean(line.materialId))
    .map((line) => line.materialId as string);

  const [compositions, materialCosts, materialVersionLabel] = await Promise.all([
    loadInventoryFrozenCostCompositions(db, productIds, referenceDate),
    loadInventoryMaterialFrozenCosts(db, materialIds, referenceDate),
    loadMaterialCostTableVersionLabel(db, referenceDate),
  ]);
  const productionVersionLabel = await loadProductionCostTableVersionLabel(
    db,
    compositions.version?.productionCostTableVersionId ?? null
  );

  const build = resolveServerAppBuildInfo();
  const sources: InventoryCostCompositionSource[] = [
    { label: "Data/hora da geração", value: referenceDate.toISOString() },
    { label: "Versão da aplicação (commit)", value: build.commit },
    {
      label: "Fonte do custo (PA e componente)",
      value:
        "Custo fabril congelado na Tabela Comercial Varejo 1 vigente (PriceTableItem: frozenTotalCost, frozenMaterialCost, frozenHhCost, frozenHmCost)",
    },
    {
      label: "Versão da Tabela Comercial Varejo 1",
      value: compositions.version
        ? `versão ${compositions.version.versionNumber} · vigência desde ${compositions.version.effectiveFrom ?? "—"} · publicada em ${compositions.version.publishedAt ?? "—"}`
        : compositions.unavailableReason ?? INVENTORY_INDUSTRIAL_COST_UNAVAILABLE,
    },
    {
      label: "Tabela oficial de custo de produção que originou o custo congelado",
      value: productionVersionLabel ?? "Não registrada na versão do Varejo 1",
    },
    {
      label: "Fonte do custo (matéria-prima)",
      value: "Custo posto congelado da tabela oficial de matéria-prima vigente (MaterialCostTableItem.landedCostSnapshot)",
    },
    {
      label: "Versão da tabela oficial de matéria-prima",
      value: materialVersionLabel ?? materialCosts.supplyCostUnavailableReason ?? INVENTORY_MATERIAL_COST_UNAVAILABLE,
    },
    { label: "Posição", value: "Saldo físico atual. Este relatório não reconstrói estoque de uma data passada." },
  ];

  return buildInventoryCostCompositionReport({
    lines,
    generatedAt: referenceDate,
    compositionByProductId: compositions.compositionByProductId,
    materialCostByMaterialId: materialCosts.supplyCostByMaterialId,
    factoryCostUnavailableReason: compositions.unavailableReason,
    materialCostUnavailableReason: materialCosts.supplyCostUnavailableReason,
    sources,
  });
}
