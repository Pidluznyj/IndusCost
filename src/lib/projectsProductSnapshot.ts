import { prisma } from "@/src/lib/prisma.js";
import {
  buildStructureLineTotal,
  dec,
  recalculateAndPersistVersionCosts,
  requireProjectAndVersion,
  resolveStructureLineSnapshots,
} from "@/src/lib/projectsService.js";
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
      unitCost: snapshots.unitCost,
      notes: row.notes,
    };
  });

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
  const ctx = await requireProjectAndVersion(projectId);
  if ("error" in ctx) throw new Error(ctx.error);

  const snapshot = await loadOfficialProductSnapshot(productId);
  if (!snapshot) throw new Error("Produto não encontrado.");

  if (options.replaceExisting) {
    await prisma.projectStructureLine.deleteMany({
      where: {
        projectId,
        versionId: ctx.version.id,
        OR: [{ existingProductId: productId }, { notes: { contains: `snapshot:${productId}` } }],
      },
    });
  }

  const created: string[] = [];
  const lastSort = await prisma.projectStructureLine.findFirst({
    where: { projectId, versionId: ctx.version.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  let sortCursor = (lastSort?.sortOrder ?? 0) + 1;

  if (options.includeBom !== false) {
    for (let i = 0; i < snapshot.bomRows.length; i++) {
      const row = snapshot.bomRows[i];
      const totalCost = buildStructureLineTotal(row.quantity, row.unitCost, row.lossPercent);
      const line = await prisma.projectStructureLine.create({
        data: {
          projectId,
          versionId: ctx.version.id,
          lineType: row.lineType,
          sourceType: row.sourceType,
          existingProductId: row.existingProductId,
          existingMaterialId: row.existingMaterialId,
          descriptionSnapshot: row.description,
          unitSnapshot: row.unit,
          quantity: row.quantity,
          lossPercent: row.lossPercent,
          unitCostSnapshot: row.unitCost,
          totalCost,
          notes: row.notes
            ? `${row.notes} | snapshot:${productId}`
            : `snapshot:${productId}`,
          sortOrder: sortCursor++,
        },
      });
      created.push(line.id);
    }
  }

  if (options.includeRouting) {
    for (let i = 0; i < snapshot.routingRows.length; i++) {
      const row = snapshot.routingRows[i];
      if (row.hours <= 0) continue;
      const totalCost = buildStructureLineTotal(row.hours, row.hourlyRate, 0);
      const line = await prisma.projectStructureLine.create({
        data: {
          projectId,
          versionId: ctx.version.id,
          lineType: "PROCESS",
          sourceType: "MANUAL",
          descriptionSnapshot: row.description,
          unitSnapshot: "HH",
          quantity: row.hours,
          lossPercent: 0,
          unitCostSnapshot: row.hourlyRate,
          totalCost,
          notes: [
            row.machineName ? `Máquina: ${row.machineName}` : null,
            row.roleName ? `Função: ${row.roleName}` : null,
            row.cycleTimeSeconds != null ? `Ciclo: ${row.cycleTimeSeconds}s` : null,
            row.cavities != null ? `Cavidades: ${row.cavities}` : null,
            `routing-snapshot:${productId}`,
          ]
            .filter(Boolean)
            .join(" · "),
          sortOrder: sortCursor++,
        },
      });
      created.push(line.id);
    }
  }

  await recalculateAndPersistVersionCosts(ctx.version.id);
  return { createdCount: created.length, lineIds: created, snapshot };
}
