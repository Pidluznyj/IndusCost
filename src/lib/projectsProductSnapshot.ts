import { prisma } from "@/src/lib/prisma.js";
import { isCostAnalysisFailure } from "@/src/lib/productCostSnapshot.js";
import {
  computeOfficialBomLineTotal,
  projectUnitCostFromOfficialLineTotal,
  resolveOfficialMaterialEffectiveUnitCost,
} from "@/src/lib/projectsOfficialBomCost.js";
import { getProjectsProductCostResolver } from "@/src/lib/projectsProductCostResolver.js";
import { dec, resolveStructureLineSnapshots } from "@/src/lib/projectsService.js";
import { toFiniteNumber } from "@/src/lib/projectsCalculations.js";

export type ProjectProductSnapshotBomRow = {
  officialBomId: string;
  sourceType: "EXISTING_MATERIAL" | "EXISTING_PRODUCT";
  lineType: "RAW_MATERIAL" | "COMPONENT";
  existingMaterialId: string | null;
  existingProductId: string | null;
  description: string;
  unit: string;
  quantity: number;
  lossPercent: number;
  unitCost: number;
  notes: string | null;
};

export type ProjectProductSnapshotRoutingRow = {
  officialRoutingId: string;
  sequence: number;
  description: string;
  machineName: string | null;
  roleName: string | null;
  hours: number;
  hourlyRate: number;
  cycleTimeSeconds: number | null;
  cavities: number | null;
  notes: string | null;
};

export type ProjectOfficialProductSnapshot = {
  productId: string;
  sku: string;
  name: string;
  type: string;
  description: string | null;
  cycleTimeSeconds: number | null;
  cavities: number | null;
  setupTimeMin: number | null;
  efficiencyExpected: number | null;
  bomRows: ProjectProductSnapshotBomRow[];
  routingRows: ProjectProductSnapshotRoutingRow[];
};

function roleHourlyRate(baseSalary: unknown, monthlyHours: unknown): number {
  const salary = toFiniteNumber(baseSalary);
  const hours = toFiniteNumber(monthlyHours, 220);
  if (hours <= 0) return 0;
  return salary / hours;
}

function resolveFallbackBomUnitCost(
  row: {
    materialId: string | null;
    childProductId: string | null;
    quantity: import("@prisma/client").Prisma.Decimal | number | null;
    lossPercentage: import("@prisma/client").Prisma.Decimal | number | null;
    Material: {
      currentCost: unknown;
      freight?: unknown;
      standardLoss?: unknown;
    } | null;
  },
  snapshots: { unitCost: number }
): number {
  const quantity = dec(row.quantity) ?? 0;
  const lossPercent = dec(row.lossPercentage) ?? 0;
  if (row.Material) {
    const unitEffective = resolveOfficialMaterialEffectiveUnitCost(row.Material);
    const lineTotal = computeOfficialBomLineTotal(quantity, lossPercent, unitEffective);
    return projectUnitCostFromOfficialLineTotal(lineTotal, quantity, lossPercent);
  }
  return snapshots.unitCost;
}

/** Aplica custos do motor oficial cost-analysis (paridade com cadastro de produto). */
export async function enrichBomRowsWithOfficialCosts(
  productId: string,
  bomRows: ProjectProductSnapshotBomRow[]
): Promise<void> {
  const resolver = getProjectsProductCostResolver();
  if (!resolver) return;

  let analysis: Awaited<ReturnType<typeof resolver>>;
  try {
    analysis = await resolver(productId);
  } catch {
    return;
  }
  if (!analysis || isCostAnalysisFailure(analysis)) return;
  if (!("details" in analysis)) return;

  const materials = analysis.details?.materials;
  if (!Array.isArray(materials)) return;

  const lineTotalByBomId = new Map<string, number>();
  for (const line of materials) {
    if (!line.bomLineId || line.excludedFromCost) continue;
    if (typeof line.unitCost !== "number" || !Number.isFinite(line.unitCost)) continue;
    lineTotalByBomId.set(line.bomLineId, line.unitCost);
  }

  for (const row of bomRows) {
    const lineTotal = lineTotalByBomId.get(row.officialBomId);
    if (lineTotal == null) continue;
    row.unitCost = projectUnitCostFromOfficialLineTotal(
      lineTotal,
      row.quantity,
      row.lossPercent
    );
  }
}

export async function loadOfficialProductSnapshot(
  productId: string
): Promise<ProjectOfficialProductSnapshot | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      ProductBOM: {
        include: { Material: true, ChildProduct: true },
        orderBy: { id: "asc" },
      },
      ProductRouting: {
        include: { Machine: true, Role: true },
        orderBy: { sequence: "asc" },
      },
    },
  });
  if (!product) return null;

  const bomRows: ProjectProductSnapshotBomRow[] = product.ProductBOM.map((row) => {
    const sourceType = row.materialId ? "EXISTING_MATERIAL" : "EXISTING_PRODUCT";
    const snapshots = resolveStructureLineSnapshots({
      sourceType,
      existingMaterial: row.Material,
      existingProduct: row.ChildProduct,
    });
    return {
      officialBomId: row.id,
      sourceType,
      lineType: row.childProductId ? "COMPONENT" : "RAW_MATERIAL",
      existingMaterialId: row.materialId,
      existingProductId: row.childProductId,
      description: snapshots.description,
      unit: snapshots.unit,
      quantity: dec(row.quantity) ?? 0,
      lossPercent: dec(row.lossPercentage) ?? 0,
      unitCost: resolveFallbackBomUnitCost(row, snapshots),
      notes: row.notes,
    };
  });

  await enrichBomRowsWithOfficialCosts(product.id, bomRows);

  const routingRows: ProjectProductSnapshotRoutingRow[] = product.ProductRouting.map((row) => {
    const setup = dec(row.setupTimeMin) ?? 0;
    const op = dec(row.operationTimeMin) ?? 0;
    const hours = (setup + op) / 60;
    const hourlyRate = row.Role
      ? roleHourlyRate(row.Role.baseSalary, row.Role.monthlyHours)
      : 0;
    return {
      officialRoutingId: row.id,
      sequence: row.sequence,
      description: row.description?.trim() || `Processo ${row.sequence}`,
      machineName: row.Machine?.name ?? null,
      roleName: row.Role?.name ?? null,
      hours,
      hourlyRate,
      cycleTimeSeconds: dec(row.cycleTimeSeconds),
      cavities: row.cavities,
      notes: row.notes,
    };
  });

  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    type: product.type,
    description: product.description,
    cycleTimeSeconds: dec(product.cycleTimeSeconds),
    cavities: product.cavities,
    setupTimeMin: dec(product.setupTimeMin),
    efficiencyExpected: dec(product.efficiencyExpected),
    bomRows,
    routingRows,
  };
}

export async function importProductSnapshotToProject(
  projectId: string,
  productId: string,
  options: { includeBom?: boolean; includeRouting?: boolean; replaceExisting?: boolean } = {}
) {
  const { importProductEngineeringSnapshotToProject } = await import(
    "./projectsProductEngineeringSnapshot.js"
  );
  const result = await importProductEngineeringSnapshotToProject(projectId, productId, {
    ...options,
    replaceExisting: options.replaceExisting !== false,
    includeRouting: options.includeRouting !== false,
  });
  const flat = await loadOfficialProductSnapshot(productId);
  return {
    createdCount: result.createdCount,
    lineIds: result.lineIds,
    snapshot: flat,
    engineering: result.snapshot,
    nodeCount: result.nodeCount,
    officialIndustrialCost: result.officialIndustrialCost,
  };
}
