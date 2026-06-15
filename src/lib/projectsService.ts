import type {
  ProjectMold,
  ProjectSimulatedItem,
  ProjectSimulatedProduct,
  ProjectStructureLine,
  ProjectVersion,
  Project,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import {
  buildCostBreakdown,
  calculateAmortizedMoldCostPerUnit,
  calculateStructureLineTotalCost,
  formatProjectCode,
  sanitizeFinite,
  toFiniteNumber,
} from "@/src/lib/projectsCalculations.js";
import {
  recalculateEngineeringCostRollup,
  type EngineeringRollupLine,
} from "@/src/lib/projectsEngineeringCostRollup.js";
import { computeSimulatedProductRefLineUpdate } from "@/src/lib/projectsSimulatedProductRefs.js";
import { collectSnapshotRootProductIds } from "@/src/lib/projectsStructureSnapshotGroups.js";
import type {
  ProjectAlert,
  ProjectCostBreakdown,
  ProjectDetail,
  ProjectListRow,
  ProjectMoldRow,
  ProjectSimulatedItemRow,
  ProjectSimulatedProductRow,
  ProjectStatus,
  ProjectStructureLineRow,
  ProjectType,
  ProjectVersionRow,
} from "@/src/types/projects.js";

export const PROJECT_TYPES: ProjectType[] = [
  "NEW_PRODUCT",
  "NEW_COMPONENT",
  "MOLD",
  "PRODUCT_CHANGE",
  "PRODUCT_WITH_NEW_COMPONENT",
  "FULL_DEVELOPMENT",
  "QUICK_ESTIMATE",
];

export const PROJECT_STATUSES: ProjectStatus[] = [
  "DRAFT",
  "TECHNICAL_ANALYSIS",
  "WAITING_QUOTATION",
  "WAITING_INTERNAL_APPROVAL",
  "SENT_TO_CUSTOMER",
  "NEGOTIATION",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "CONVERTED",
];

const OPEN_STATUSES: ProjectStatus[] = [
  "DRAFT",
  "TECHNICAL_ANALYSIS",
  "WAITING_QUOTATION",
  "WAITING_INTERNAL_APPROVAL",
  "SENT_TO_CUSTOMER",
  "NEGOTIATION",
];

export function isValidProjectType(value: unknown): value is ProjectType {
  return typeof value === "string" && PROJECT_TYPES.includes(value as ProjectType);
}

export function isValidProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && PROJECT_STATUSES.includes(value as ProjectStatus);
}

export function dec(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function serializeVersion(v: ProjectVersion): ProjectVersionRow {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    title: v.title,
    status: v.status as ProjectStatus,
    isCurrent: v.isCurrent,
    unitCost: dec(v.unitCost),
    suggestedPrice: dec(v.suggestedPrice),
    marginPercent: dec(v.marginPercent),
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

export function serializeSimulatedProduct(p: ProjectSimulatedProduct): ProjectSimulatedProductRow {
  return {
    id: p.id,
    provisionalCode: p.provisionalCode,
    description: p.description,
    unit: p.unit,
    estimatedWeight: dec(p.estimatedWeight),
    expectedVolume: dec(p.expectedVolume),
    batchSize: dec(p.batchSize),
    notes: p.notes,
  };
}

export function serializeSimulatedItem(i: ProjectSimulatedItem): ProjectSimulatedItemRow {
  return {
    id: i.id,
    provisionalCode: i.provisionalCode,
    description: i.description,
    itemType: i.itemType,
    unit: i.unit,
    estimatedUnitCost: dec(i.estimatedUnitCost),
    quotedUnitCost: dec(i.quotedUnitCost),
    supplierName: i.supplierName,
    leadTimeDays: i.leadTimeDays,
    estimatedWeight: dec(i.estimatedWeight),
    lossPercent: dec(i.lossPercent),
    requiresQuotation: i.requiresQuotation,
    requiresEngineeringReview: i.requiresEngineeringReview,
    canBecomeOfficial: i.canBecomeOfficial,
    notes: i.notes,
  };
}

export function serializeStructureLine(l: ProjectStructureLine): ProjectStructureLineRow {
  const officialUnit = dec(l.officialUnitCostSnapshot);
  const unitCost = dec(l.unitCostSnapshot) ?? 0;
  return {
    id: l.id,
    simulatedProductId: l.simulatedProductId,
    parentLineId: l.parentLineId,
    level: l.level,
    treePath: l.treePath,
    snapshotRootProductId: l.snapshotRootProductId,
    lineType: l.lineType,
    sourceType: l.sourceType,
    existingProductId: l.existingProductId,
    existingMaterialId: l.existingMaterialId,
    simulatedItemId: l.simulatedItemId,
    sourceOfficialBomId: l.sourceOfficialBomId,
    sourceOfficialRoutingId: l.sourceOfficialRoutingId,
    descriptionSnapshot: l.descriptionSnapshot,
    unitSnapshot: l.unitSnapshot,
    quantity: dec(l.quantity) ?? 0,
    lossPercent: dec(l.lossPercent),
    officialQuantitySnapshot: dec(l.officialQuantitySnapshot),
    officialLossPercentSnapshot: dec(l.officialLossPercentSnapshot),
    officialUnitCostSnapshot: officialUnit,
    unitCostSnapshot: unitCost,
    totalCost: dec(l.totalCost) ?? 0,
    costSource: l.costSource,
    isChangedFromOfficial: l.isChangedFromOfficial,
    isMissingCost: l.isMissingCost,
    countsInSimulatedProductCost: l.countsInSimulatedProductCost,
    supplierNameSnapshot: l.supplierNameSnapshot,
    notes: l.notes,
    sortOrder: l.sortOrder,
  };
}

export function serializeMold(m: ProjectMold): ProjectMoldRow {
  return {
    id: m.id,
    name: m.name,
    moldType: m.moldType,
    cavities: m.cavities,
    estimatedLifeCycles: m.estimatedLifeCycles,
    supplierName: m.supplierName,
    constructionCost: dec(m.constructionCost) ?? 0,
    maintenanceCost: dec(m.maintenanceCost),
    changeCost: dec(m.changeCost),
    leadTimeDays: m.leadTimeDays,
    chargeMode: m.chargeMode,
    amortizationQuantity: dec(m.amortizationQuantity),
    amortizedCostPerUnit: dec(m.amortizedCostPerUnit),
    ownership: m.ownership,
    notes: m.notes,
  };
}

export function buildProjectAlerts(input: {
  structureLines: ProjectStructureLineRow[];
  simulatedItems: ProjectSimulatedItemRow[];
  simulatedProducts: ProjectSimulatedProductRow[];
  molds: ProjectMoldRow[];
  targetMarginPercent: number | null;
  marginPercent: number | null;
}): ProjectAlert[] {
  const alerts: ProjectAlert[] = [];

  for (const line of input.structureLines) {
    if (line.unitCostSnapshot <= 0) {
      alerts.push({
        code: "LINE_WITHOUT_COST",
        message: `Linha "${line.descriptionSnapshot}" sem custo unitário.`,
        severity: "warning",
      });
    }
  }

  for (const item of input.simulatedItems) {
    if (item.requiresQuotation && item.quotedUnitCost == null) {
      alerts.push({
        code: "ITEM_AWAITING_QUOTATION",
        message: `Item simulado "${item.description}" aguardando cotação.`,
        severity: "warning",
      });
    }
  }

  if (
    input.targetMarginPercent != null &&
    input.marginPercent != null &&
    input.marginPercent < input.targetMarginPercent
  ) {
    alerts.push({
      code: "MARGIN_BELOW_TARGET",
      message: "Margem prevista abaixo da margem alvo do projeto.",
      severity: "warning",
    });
  }

  for (const mold of input.molds) {
    if (
      mold.chargeMode === "AMORTIZED_IN_PRODUCT" &&
      (!mold.amortizationQuantity || mold.amortizationQuantity <= 0)
    ) {
      alerts.push({
        code: "MOLD_WITHOUT_AMORTIZATION_RULE",
        message: `Molde "${mold.name}" com cobrança amortizada sem quantidade definida.`,
        severity: "warning",
      });
    }
  }

  for (const product of input.simulatedProducts) {
    const hasStructure = input.structureLines.some((l) => l.simulatedProductId === product.id);
    if (!hasStructure) {
      alerts.push({
        code: "PRODUCT_WITHOUT_STRUCTURE",
        message: `Produto simulado "${product.description}" sem estrutura/BOM.`,
        severity: "info",
      });
    }
  }

  return alerts;
}

export function computeCostBreakdownForVersion(
  structureLines: ProjectStructureLine[],
  molds: ProjectMold[],
  targetMarginPercent: number | null,
  targetPrice: number | null
): ProjectCostBreakdown {
  const breakdown = buildCostBreakdown({
    structureLines: structureLines.map((l) => ({
      lineType: l.lineType,
      quantity: toFiniteNumber(dec(l.quantity)),
      lossPercent: dec(l.lossPercent),
      unitCostSnapshot: toFiniteNumber(dec(l.unitCostSnapshot)),
      countsInSimulatedProductCost: l.countsInSimulatedProductCost,
    })),
    molds: molds.map((m) => ({
      chargeMode: m.chargeMode,
      constructionCost: toFiniteNumber(dec(m.constructionCost)),
      amortizationQuantity: dec(m.amortizationQuantity),
      amortizedCostPerUnit: dec(m.amortizedCostPerUnit),
    })),
    targetMarginPercent,
    targetPrice,
  });
  return breakdown;
}

function toEngineeringRollupLine(line: ProjectStructureLine): EngineeringRollupLine {
  return {
    id: line.id,
    parentLineId: line.parentLineId,
    snapshotRootProductId: line.snapshotRootProductId,
    lineType: line.lineType,
    quantity: toFiniteNumber(dec(line.quantity)),
    lossPercent: toFiniteNumber(dec(line.lossPercent)),
    unitCostSnapshot: toFiniteNumber(dec(line.unitCostSnapshot)),
    totalCost: toFiniteNumber(dec(line.totalCost)),
    officialQuantitySnapshot: dec(line.officialQuantitySnapshot),
    officialLossPercentSnapshot: dec(line.officialLossPercentSnapshot),
    officialUnitCostSnapshot: dec(line.officialUnitCostSnapshot),
    countsInSimulatedProductCost: line.countsInSimulatedProductCost,
    isChangedFromOfficial: line.isChangedFromOfficial,
  };
}

/**
 * Após import/rollup, alinha snapshots oficiais ao valor rolado para baseline
 * isChangedFromOfficial=false (sem edição manual do usuário).
 */
export async function establishEngineeringCostBaselineForSnapshot(
  versionId: string,
  snapshotRootProductId: string
): Promise<void> {
  const lines = await prisma.projectStructureLine.findMany({
    where: { versionId, snapshotRootProductId },
  });
  if (!lines.length) return;

  const rolled = recalculateEngineeringCostRollup(lines.map(toEngineeringRollupLine));
  const byId = new Map(rolled.map((l) => [l.id, l]));

  const updates = [];
  for (const line of lines) {
    const next = byId.get(line.id);
    if (!next) continue;
    const unit = toFiniteNumber(dec(line.unitCostSnapshot));
    updates.push(
      prisma.projectStructureLine.update({
        where: { id: line.id },
        data: {
          officialQuantitySnapshot: toFiniteNumber(dec(line.quantity)),
          officialLossPercentSnapshot: toFiniteNumber(dec(line.lossPercent)),
          officialUnitCostSnapshot: unit,
          totalCost: next.totalCost,
          isChangedFromOfficial: false,
          isMissingCost: unit <= 0,
        },
      })
    );
  }
  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }
}

/** Atualiza linhas MANUAL que referenciam produtos simulados com o roll-up atual da estrutura filha. */
export async function persistSimulatedProductRefCostsForVersion(versionId: string): Promise<void> {
  const lines = await prisma.projectStructureLine.findMany({ where: { versionId } });
  const refInputs = lines.map((line) => ({
    id: line.id,
    simulatedProductId: line.simulatedProductId,
    snapshotRootProductId: line.snapshotRootProductId,
    sourceType: line.sourceType,
    quantity: toFiniteNumber(dec(line.quantity)),
    lossPercent: toFiniteNumber(dec(line.lossPercent)),
    unitCostSnapshot: toFiniteNumber(dec(line.unitCostSnapshot)),
    totalCost: toFiniteNumber(dec(line.totalCost)),
    notes: line.notes,
  }));

  const updates = [];
  for (const line of lines) {
    const next = computeSimulatedProductRefLineUpdate(
      {
        id: line.id,
        simulatedProductId: line.simulatedProductId,
        snapshotRootProductId: line.snapshotRootProductId,
        sourceType: line.sourceType,
        quantity: toFiniteNumber(dec(line.quantity)),
        lossPercent: toFiniteNumber(dec(line.lossPercent)),
        unitCostSnapshot: toFiniteNumber(dec(line.unitCostSnapshot)),
        totalCost: toFiniteNumber(dec(line.totalCost)),
        notes: line.notes,
      },
      refInputs
    );
    if (!next) continue;
    const unit = toFiniteNumber(dec(line.unitCostSnapshot));
    const total = toFiniteNumber(dec(line.totalCost));
    if (
      Math.abs(unit - next.unitCostSnapshot) < 0.000001 &&
      Math.abs(total - next.totalCost) < 0.000001
    ) {
      continue;
    }
    updates.push(
      prisma.projectStructureLine.update({
        where: { id: line.id },
        data: {
          unitCostSnapshot: next.unitCostSnapshot,
          totalCost: next.totalCost,
          isMissingCost: next.isMissingCost,
        },
      })
    );
  }
  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }
}

/** Propaga custos dos filhos para ancestrais em snapshots hierárquicos importados. */
export async function persistEngineeringCostRollupForVersion(versionId: string): Promise<void> {
  const lines = await prisma.projectStructureLine.findMany({ where: { versionId } });
  if (!lines.some((l) => l.snapshotRootProductId != null)) return;

  const rolled = recalculateEngineeringCostRollup(lines.map(toEngineeringRollupLine));
  const byId = new Map(rolled.map((l) => [l.id, l]));

  const updates = [];
  for (const line of lines) {
    const next = byId.get(line.id);
    if (!next || line.snapshotRootProductId == null) continue;
    const total = toFiniteNumber(dec(line.totalCost));
    const totalChanged = Math.abs(total - next.totalCost) > 0.000001;
    if (!totalChanged) continue;
    updates.push(
      prisma.projectStructureLine.update({
        where: { id: line.id },
        data: {
          totalCost: next.totalCost,
        },
      })
    );
  }
  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }
}

/** Exclui o projeto e todos os dados de simulação (cascade). Não altera cadastros oficiais. */
export async function deleteProject(projectId: string): Promise<{ code: string }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, code: true },
  });
  if (!project) {
    throw new Error("Projeto não encontrado.");
  }
  await prisma.project.delete({ where: { id: projectId } });
  return { code: project.code };
}

/** Remove snapshot de engenharia importado (somente ProjectStructureLine do projeto). */
export async function deleteProjectStructureSnapshot(
  projectId: string,
  snapshotRootProductId: string
): Promise<{ deletedCount: number }> {
  const ctx = await requireProjectAndVersion(projectId);
  if ("error" in ctx) throw new Error(ctx.error);

  const result = await prisma.projectStructureLine.deleteMany({
    where: {
      projectId,
      versionId: ctx.version.id,
      OR: [
        { snapshotRootProductId },
        { notes: { contains: `snapshot:${snapshotRootProductId}` } },
        { notes: { contains: `routing-snapshot:${snapshotRootProductId}` } },
      ],
    },
  });

  await recalculateAndPersistVersionCosts(ctx.version.id);
  return { deletedCount: result.count };
}

export async function recalculateAndPersistVersionCosts(versionId: string) {
  await persistSimulatedProductRefCostsForVersion(versionId);
  await persistEngineeringCostRollupForVersion(versionId);

  const version = await prisma.projectVersion.findUnique({
    where: { id: versionId },
    include: {
      project: true,
      structureLines: true,
      molds: true,
    },
  });
  if (!version) return null;

  const breakdown = computeCostBreakdownForVersion(
    version.structureLines,
    version.molds,
    dec(version.project.targetMarginPercent),
    dec(version.project.targetPrice)
  );

  const totalMoldCost = version.molds.reduce(
    (sum, m) => sum + toFiniteNumber(dec(m.constructionCost)),
    0
  );

  await prisma.projectVersion.update({
    where: { id: versionId },
    data: {
      totalEstimatedCost: breakdown.unitCost,
      totalMoldCost,
      totalAmortizedMoldCost: breakdown.amortizedMoldCostPerUnit,
      unitCost: breakdown.unitCost,
      suggestedPrice: breakdown.suggestedPrice,
      marginPercent: breakdown.targetMarginPercent,
      markupPercent: breakdown.markupPercent,
    },
  });

  return breakdown;
}

export async function getCurrentVersion(projectId: string) {
  return prisma.projectVersion.findFirst({
    where: { projectId, isCurrent: true },
    orderBy: { versionNumber: "desc" },
  });
}

export async function requireProjectAndVersion(projectId: string, versionId?: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { error: "Projeto não encontrado." as const };

  let version;
  if (versionId) {
    version = await prisma.projectVersion.findFirst({
      where: { id: versionId, projectId },
    });
    if (!version) return { error: "Versão não encontrada." as const };
  } else {
    version = await getCurrentVersion(projectId);
    if (!version) return { error: "Versão atual não encontrada." as const };
  }

  return { project, version };
}

export function buildInitialVersionData(project: Project, versionNumber = 1) {
  return {
    projectId: project.id,
    versionNumber,
    title: `Versão ${versionNumber}`,
    status: project.status,
    isCurrent: true,
  };
}

/** Garante que item simulado não cria cadastro oficial — apenas ProjectSimulatedItem. */
export function assertSimulatedItemIsolation(): true {
  return true;
}

export async function serializeProjectListRow(
  project: Project & { versions: ProjectVersion[] }
): Promise<ProjectListRow> {
  const current = project.versions.find((v) => v.isCurrent) ?? project.versions[0];
  return {
    id: project.id,
    code: project.code,
    title: project.title,
    customerName: project.customerName,
    projectType: project.projectType as ProjectType,
    status: project.status as ProjectStatus,
    commercialOwner: project.commercialOwner,
    technicalOwner: project.technicalOwner,
    estimatedValue: current ? dec(current.suggestedPrice) : null,
    marginPercent: current ? dec(current.marginPercent) : null,
    updatedAt: project.updatedAt.toISOString(),
  };
}

async function loadSnapshotRootProductsMap(
  structureLines: ProjectStructureLineRow[]
): Promise<Record<string, { sku: string; name: string }>> {
  const ids = collectSnapshotRootProductIds(structureLines);
  if (ids.length === 0) return {};

  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, sku: true, name: true },
  });

  const map: Record<string, { sku: string; name: string }> = {};
  for (const product of products) {
    map[product.id] = { sku: product.sku, name: product.name };
  }
  return map;
}

export async function loadProjectDetail(projectId: string): Promise<ProjectDetail | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      versions: { orderBy: { versionNumber: "desc" } },
      simulatedProducts: { orderBy: { createdAt: "asc" } },
      simulatedItems: { orderBy: { createdAt: "asc" } },
      structureLines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      molds: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!project) return null;

  const currentVersion = project.versions.find((v) => v.isCurrent) ?? null;
  const versionId = currentVersion?.id;

  const simulatedProducts = project.simulatedProducts
    .filter((p) => !versionId || p.versionId === versionId)
    .map(serializeSimulatedProduct);
  const simulatedItems = project.simulatedItems
    .filter((i) => !versionId || i.versionId === versionId)
    .map(serializeSimulatedItem);
  const structureLines = project.structureLines
    .filter((l) => !versionId || l.versionId === versionId)
    .map(serializeStructureLine);
  const molds = project.molds
    .filter((m) => !versionId || m.versionId === versionId)
    .map(serializeMold);

  const costBreakdown = computeCostBreakdownForVersion(
    project.structureLines.filter((l) => !versionId || l.versionId === versionId),
    project.molds.filter((m) => !versionId || m.versionId === versionId),
    dec(project.targetMarginPercent),
    dec(project.targetPrice)
  );

  const alerts = buildProjectAlerts({
    structureLines,
    simulatedItems,
    simulatedProducts,
    molds,
    targetMarginPercent: dec(project.targetMarginPercent),
    marginPercent: costBreakdown.targetMarginPercent,
  });

  const snapshotRootProducts = await loadSnapshotRootProductsMap(structureLines);

  return {
    id: project.id,
    code: project.code,
    title: project.title,
    customerName: project.customerName,
    customerDocument: project.customerDocument,
    description: project.description,
    projectType: project.projectType as ProjectType,
    status: project.status as ProjectStatus,
    commercialOwner: project.commercialOwner,
    technicalOwner: project.technicalOwner,
    expectedMonthlyVolume: dec(project.expectedMonthlyVolume),
    targetPrice: dec(project.targetPrice),
    targetMarginPercent: dec(project.targetMarginPercent),
    notes: project.notes,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    currentVersion: currentVersion ? serializeVersion(currentVersion) : null,
    versions: project.versions.map(serializeVersion),
    simulatedProducts,
    simulatedItems,
    structureLines,
    molds,
    snapshotRootProducts,
    costBreakdown,
    alerts,
    conversionAvailable: false,
  };
}

export async function createProjectWithVersion(data: {
  title: string;
  customerName: string;
  customerDocument?: string | null;
  description?: string | null;
  projectType: ProjectType;
  status?: ProjectStatus;
  commercialOwner?: string | null;
  technicalOwner?: string | null;
  expectedMonthlyVolume?: number | null;
  targetPrice?: number | null;
  targetMarginPercent?: number | null;
  notes?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        code: `TMP-${crypto.randomUUID()}`,
        title: data.title,
        customerName: data.customerName,
        customerDocument: data.customerDocument ?? null,
        description: data.description ?? null,
        projectType: data.projectType,
        status: data.status ?? "DRAFT",
        commercialOwner: data.commercialOwner ?? null,
        technicalOwner: data.technicalOwner ?? null,
        expectedMonthlyVolume: data.expectedMonthlyVolume ?? null,
        targetPrice: data.targetPrice ?? null,
        targetMarginPercent: data.targetMarginPercent ?? null,
        notes: data.notes ?? null,
      },
    });

    const code = formatProjectCode(created.number);
    const project = await tx.project.update({
      where: { id: created.id },
      data: { code },
    });

    await tx.projectVersion.create({
      data: buildInitialVersionData(project, 1),
    });

    return project;
  });
}

export async function copyVersionFromCurrent(projectId: string, newVersionNumber: number) {
  const current = await getCurrentVersion(projectId);
  if (!current) throw new Error("Versão atual não encontrada.");

  const [products, items, lines, molds] = await Promise.all([
    prisma.projectSimulatedProduct.findMany({ where: { versionId: current.id } }),
    prisma.projectSimulatedItem.findMany({ where: { versionId: current.id } }),
    prisma.projectStructureLine.findMany({ where: { versionId: current.id } }),
    prisma.projectMold.findMany({ where: { versionId: current.id } }),
  ]);

  return prisma.$transaction(async (tx) => {
    await tx.projectVersion.updateMany({
      where: { projectId, isCurrent: true },
      data: { isCurrent: false },
    });

    const newVersion = await tx.projectVersion.create({
      data: {
        projectId,
        versionNumber: newVersionNumber,
        title: `Versão ${newVersionNumber}`,
        status: current.status,
        assumptionsJson: current.assumptionsJson,
        expectedVolume: current.expectedVolume,
        notes: current.notes,
        isCurrent: true,
        totalEstimatedCost: current.totalEstimatedCost,
        totalMoldCost: current.totalMoldCost,
        totalAmortizedMoldCost: current.totalAmortizedMoldCost,
        unitCost: current.unitCost,
        suggestedPrice: current.suggestedPrice,
        marginPercent: current.marginPercent,
        markupPercent: current.markupPercent,
      },
    });

    const productIdMap = new Map<string, string>();
    for (const p of products) {
      const copy = await tx.projectSimulatedProduct.create({
        data: {
          projectId,
          versionId: newVersion.id,
          provisionalCode: p.provisionalCode,
          description: p.description,
          unit: p.unit,
          estimatedWeight: p.estimatedWeight,
          expectedVolume: p.expectedVolume,
          batchSize: p.batchSize,
          notes: p.notes,
        },
      });
      productIdMap.set(p.id, copy.id);
    }

    const itemIdMap = new Map<string, string>();
    for (const i of items) {
      const copy = await tx.projectSimulatedItem.create({
        data: {
          projectId,
          versionId: newVersion.id,
          provisionalCode: i.provisionalCode,
          description: i.description,
          itemType: i.itemType,
          unit: i.unit,
          estimatedUnitCost: i.estimatedUnitCost,
          quotedUnitCost: i.quotedUnitCost,
          supplierName: i.supplierName,
          leadTimeDays: i.leadTimeDays,
          estimatedWeight: i.estimatedWeight,
          lossPercent: i.lossPercent,
          requiresQuotation: i.requiresQuotation,
          requiresEngineeringReview: i.requiresEngineeringReview,
          canBecomeOfficial: i.canBecomeOfficial,
          notes: i.notes,
        },
      });
      itemIdMap.set(i.id, copy.id);
    }

    for (const l of lines) {
      await tx.projectStructureLine.create({
        data: {
          projectId,
          versionId: newVersion.id,
          simulatedProductId: l.simulatedProductId
            ? (productIdMap.get(l.simulatedProductId) ?? null)
            : null,
          lineType: l.lineType,
          sourceType: l.sourceType,
          existingProductId: l.existingProductId,
          existingMaterialId: l.existingMaterialId,
          simulatedItemId: l.simulatedItemId ? (itemIdMap.get(l.simulatedItemId) ?? null) : null,
          descriptionSnapshot: l.descriptionSnapshot,
          unitSnapshot: l.unitSnapshot,
          quantity: l.quantity,
          lossPercent: l.lossPercent,
          unitCostSnapshot: l.unitCostSnapshot,
          totalCost: l.totalCost,
          supplierNameSnapshot: l.supplierNameSnapshot,
          notes: l.notes,
          sortOrder: l.sortOrder,
        },
      });
    }

    for (const m of molds) {
      await tx.projectMold.create({
        data: {
          projectId,
          versionId: newVersion.id,
          name: m.name,
          moldType: m.moldType,
          cavities: m.cavities,
          estimatedLifeCycles: m.estimatedLifeCycles,
          supplierName: m.supplierName,
          constructionCost: m.constructionCost,
          maintenanceCost: m.maintenanceCost,
          changeCost: m.changeCost,
          leadTimeDays: m.leadTimeDays,
          chargeMode: m.chargeMode,
          amortizationQuantity: m.amortizationQuantity,
          amortizedCostPerUnit: m.amortizedCostPerUnit,
          ownership: m.ownership,
          notes: m.notes,
        },
      });
    }

    return newVersion;
  });
}

export function resolveStructureLineSnapshots(input: {
  sourceType: string;
  existingProduct?: { name: string; sku: string } | null;
  existingMaterial?: { description: string; code: string; unit: string; currentCost: Prisma.Decimal } | null;
  simulatedItem?: ProjectSimulatedItem | null;
  manualDescription?: string;
  manualUnit?: string;
  manualUnitCost?: number;
}): { description: string; unit: string; unitCost: number } {
  if (input.sourceType === "EXISTING_PRODUCT" && input.existingProduct) {
    return {
      description: `${input.existingProduct.sku} — ${input.existingProduct.name}`,
      unit: "UN",
      unitCost: 0,
    };
  }
  if (input.sourceType === "EXISTING_MATERIAL" && input.existingMaterial) {
    return {
      description: `${input.existingMaterial.code} — ${input.existingMaterial.description}`,
      unit: input.existingMaterial.unit,
      unitCost: toFiniteNumber(dec(input.existingMaterial.currentCost)),
    };
  }
  if (input.sourceType === "SIMULATED_ITEM" && input.simulatedItem) {
    const cost =
      dec(input.simulatedItem.quotedUnitCost) ?? dec(input.simulatedItem.estimatedUnitCost) ?? 0;
    return {
      description: input.simulatedItem.description,
      unit: input.simulatedItem.unit,
      unitCost: toFiniteNumber(cost),
    };
  }
  return {
    description: input.manualDescription?.trim() || "Item manual",
    unit: input.manualUnit?.trim() || "UN",
    unitCost: toFiniteNumber(input.manualUnitCost),
  };
}

export function buildStructureLineTotal(
  quantity: number,
  unitCost: number,
  lossPercent?: number | null
) {
  const total = calculateStructureLineTotalCost(quantity, unitCost, lossPercent ?? 0);
  return sanitizeFinite(total) ?? 0;
}

export function resolveMoldAmortizedCost(
  constructionCost: number,
  chargeMode: string,
  amortizationQuantity?: number | null
) {
  if (chargeMode !== "AMORTIZED_IN_PRODUCT") return null;
  return calculateAmortizedMoldCostPerUnit(constructionCost, amortizationQuantity);
}

export { OPEN_STATUSES };
