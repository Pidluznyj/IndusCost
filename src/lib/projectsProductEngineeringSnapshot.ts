import { prisma } from "@/src/lib/prisma.js";
import { isCostAnalysisFailure } from "@/src/lib/productCostSnapshot.js";
import {
  computeOfficialBomLineTotal,
  projectUnitCostFromOfficialLineTotal,
  resolveOfficialMaterialEffectiveUnitCost,
} from "@/src/lib/projectsOfficialBomCost.js";
import { getProjectsProductCostResolver } from "@/src/lib/projectsProductCostResolver.js";
import { rollupEngineeringSnapshotNode } from "@/src/lib/projectsEngineeringCostRollup.js";
import {
  buildStructureLineTotal,
  dec,
  establishEngineeringCostBaselineForSnapshot,
  recalculateAndPersistVersionCosts,
  requireProjectAndVersion,
} from "@/src/lib/projectsService.js";
import { toFiniteNumber } from "@/src/lib/projectsCalculations.js";

export const MAX_ENGINEERING_TREE_DEPTH = 20;

export type ProjectEngineeringNodeType =
  | "ROOT_PRODUCT"
  | "PRODUCT"
  | "MATERIAL"
  | "PROCESS"
  | "SERVICE"
  | "MANUAL";

export type ProjectEngineeringCostSource =
  | "OFFICIAL_COST_ANALYSIS"
  | "OFFICIAL_MATERIAL_COST"
  | "OFFICIAL_ROUTING"
  | "MANUAL"
  | "MISSING";

export type ProjectEngineeringSnapshotNode = {
  nodeKey: string;
  parentNodeKey: string | null;
  level: number;
  path: string;
  nodeType: ProjectEngineeringNodeType;
  officialProductId: string | null;
  officialMaterialId: string | null;
  officialBomId: string | null;
  officialRoutingId: string | null;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  lossPercent: number;
  officialUnitCost: number;
  simulatedUnitCost: number;
  totalCost: number;
  costSource: ProjectEngineeringCostSource;
  isInherited: boolean;
  isChanged: boolean;
  isMissingCost: boolean;
  countsInSimulatedProductCost: boolean;
  children: ProjectEngineeringSnapshotNode[];
};

export type ProjectEngineeringSnapshot = {
  rootProductId: string;
  sku: string;
  name: string;
  type: string;
  officialIndustrialCost: number | null;
  costAnalysisPartial: boolean;
  alerts: string[];
  tree: ProjectEngineeringSnapshotNode;
};

type BomTreeProduct = {
  id: string;
  sku: string;
  name: string;
  type: string;
  description: string | null;
  cycleTimeSeconds: number | null;
  cavities: number | null;
  setupTimeMin: number | null;
  efficiencyExpected: number | null;
  ProductRouting: Array<{
    id: string;
    sequence: number;
    description: string | null;
    setupTimeMin: unknown;
    operationTimeMin: unknown;
    cycleTimeSeconds: unknown;
    cavities: number | null;
    notes: string | null;
    Machine: { name: string } | null;
    Role: { name: string; baseSalary: unknown; monthlyHours: unknown } | null;
  }>;
  children: BomTreeChild[];
};

type BomTreeChild =
  | {
      id: string;
      type: "COMPONENT";
      quantity: unknown;
      lossPercentage: unknown;
      notes: string | null;
      item: BomTreeProduct;
    }
  | {
      id: string;
      type: "MATERIAL";
      quantity: unknown;
      lossPercentage: unknown;
      notes: string | null;
      item: {
        id: string;
        code: string;
        description: string;
        unit: string;
        currentCost: unknown;
        freight?: unknown;
        standardLoss?: unknown;
      };
    };

function roleHourlyRate(baseSalary: unknown, monthlyHours: unknown): number {
  const salary = toFiniteNumber(baseSalary);
  const hours = toFiniteNumber(monthlyHours, 220);
  if (hours <= 0) return 0;
  return salary / hours;
}

async function loadBomLineCostMap(
  productId: string
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const resolver = getProjectsProductCostResolver();
  if (!resolver) return map;
  try {
    const analysis = await resolver(productId);
    if (!analysis || isCostAnalysisFailure(analysis) || !("details" in analysis)) return map;
    for (const line of analysis.details?.materials ?? []) {
      if (!line.bomLineId || line.excludedFromCost) continue;
      if (typeof line.unitCost !== "number" || !Number.isFinite(line.unitCost)) continue;
      map.set(line.bomLineId, line.unitCost);
    }
  } catch {
    /* fallback abaixo */
  }
  return map;
}

function resolveMaterialUnitCost(
  material: BomTreeChild & { type: "MATERIAL" },
  quantity: number,
  lossPercent: number,
  bomLineCostMap: Map<string, number>
): { unitCost: number; costSource: ProjectEngineeringCostSource; isMissing: boolean } {
  const lineTotal = bomLineCostMap.get(material.id);
  if (lineTotal != null) {
    return {
      unitCost: projectUnitCostFromOfficialLineTotal(lineTotal, quantity, lossPercent),
      costSource: "OFFICIAL_COST_ANALYSIS",
      isMissing: lineTotal <= 0,
    };
  }
  const unitEffective = resolveOfficialMaterialEffectiveUnitCost(material.item);
  const total = computeOfficialBomLineTotal(quantity, lossPercent, unitEffective);
  return {
    unitCost: projectUnitCostFromOfficialLineTotal(total, quantity, lossPercent),
    costSource: unitEffective > 0 ? "OFFICIAL_MATERIAL_COST" : "MISSING",
    isMissing: unitEffective <= 0,
  };
}

function resolveComponentUnitCost(
  bomLineId: string,
  quantity: number,
  lossPercent: number,
  bomLineCostMap: Map<string, number>
): { unitCost: number; costSource: ProjectEngineeringCostSource; isMissing: boolean } {
  const lineTotal = bomLineCostMap.get(bomLineId);
  if (lineTotal == null) {
    return { unitCost: 0, costSource: "MISSING", isMissing: true };
  }
  return {
    unitCost: projectUnitCostFromOfficialLineTotal(lineTotal, quantity, lossPercent),
    costSource: "OFFICIAL_COST_ANALYSIS",
    isMissing: lineTotal <= 0,
  };
}

async function buildBomTreeProduct(
  productId: string,
  visited: Set<string>,
  depth: number,
  alerts: string[]
): Promise<BomTreeProduct | null> {
  if (depth > MAX_ENGINEERING_TREE_DEPTH) {
    alerts.push(`Profundidade máxima (${MAX_ENGINEERING_TREE_DEPTH}) atingida.`);
    return null;
  }
  if (visited.has(productId)) {
    alerts.push(`Ciclo detectado na BOM do produto ${productId}.`);
    return null;
  }
  visited.add(productId);

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
  if (!product) {
    visited.delete(productId);
    return null;
  }

  const children: BomTreeChild[] = [];
  for (const item of product.ProductBOM) {
    if (item.childProductId && item.ChildProduct) {
      const sub = await buildBomTreeProduct(item.childProductId, visited, depth + 1, alerts);
      if (sub) {
        children.push({
          id: item.id,
          type: "COMPONENT",
          quantity: item.quantity,
          lossPercentage: item.lossPercentage,
          notes: item.notes,
          item: sub,
        });
      }
    } else if (item.Material) {
      children.push({
        id: item.id,
        type: "MATERIAL",
        quantity: item.quantity,
        lossPercentage: item.lossPercentage,
        notes: item.notes,
        item: item.Material,
      });
    }
  }

  visited.delete(productId);

  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    type: product.type,
    description: product.description,
    cycleTimeSeconds: dec(product.cycleTimeSeconds),
    cavities: product.cavities,
    setupTimeMin: dec(product.setupTimeMin),
    efficiencyExpected: dec(product.efficiencyExpected),
    ProductRouting: product.ProductRouting,
    children,
  };
}

async function mapProductToEngineeringNode(
  product: BomTreeProduct,
  parentNodeKey: string | null,
  level: number,
  pathPrefix: string,
  countsInSimulatedProductCost: boolean,
  alerts: string[]
): Promise<ProjectEngineeringSnapshotNode> {
  const nodeKey = pathPrefix || product.id;
  const bomLineCostMap = await loadBomLineCostMap(product.id);
  const children: ProjectEngineeringSnapshotNode[] = [];

  for (let i = 0; i < product.children.length; i++) {
    const child = product.children[i];
    const quantity = dec(child.quantity as import("@prisma/client").Prisma.Decimal | number) ?? 0;
    const lossPercent = dec(child.lossPercentage as import("@prisma/client").Prisma.Decimal | number) ?? 0;
    const childPath = `${pathPrefix}/${child.id}`;

    if (child.type === "MATERIAL") {
      const { unitCost, costSource, isMissing } = resolveMaterialUnitCost(
        child,
        quantity,
        lossPercent,
        bomLineCostMap
      );
      const totalCost = buildStructureLineTotal(quantity, unitCost, lossPercent);
      children.push({
        nodeKey: childPath,
        parentNodeKey: nodeKey,
        level: level + 1,
        path: childPath,
        nodeType: "MATERIAL",
        officialProductId: null,
        officialMaterialId: child.item.id,
        officialBomId: child.id,
        officialRoutingId: null,
        code: child.item.code,
        description: `${child.item.code} — ${child.item.description}`,
        unit: child.item.unit,
        quantity,
        lossPercent,
        officialUnitCost: unitCost,
        simulatedUnitCost: unitCost,
        totalCost,
        costSource,
        isInherited: true,
        isChanged: false,
        isMissingCost: isMissing,
        countsInSimulatedProductCost: false,
        children: [],
      });
    } else {
      const subTree = await mapProductToEngineeringNode(
        child.item,
        nodeKey,
        level + 1,
        childPath,
        false,
        alerts
      );
      subTree.nodeType = "PRODUCT";
      subTree.officialProductId = child.item.id;
      subTree.officialBomId = child.id;
      subTree.code = child.item.sku;
      subTree.description = `${child.item.sku} — ${child.item.name}`;
      subTree.unit = "UN";
      subTree.quantity = quantity;
      subTree.lossPercent = lossPercent;

      const { unitCost, costSource, isMissing } = resolveComponentUnitCost(
        child.id,
        quantity,
        lossPercent,
        bomLineCostMap
      );
      subTree.officialUnitCost = unitCost;
      subTree.simulatedUnitCost = unitCost;
      subTree.totalCost = buildStructureLineTotal(quantity, unitCost, lossPercent);
      subTree.costSource = costSource;
      subTree.isMissingCost = isMissing;
      if (subTree.children.length > 0) {
        rollupEngineeringSnapshotNode(subTree);
      }

      subTree.countsInSimulatedProductCost = level === 0;
      children.push(subTree);
    }
  }

  for (const row of product.ProductRouting) {
    const setup = dec(row.setupTimeMin as import("@prisma/client").Prisma.Decimal | number) ?? 0;
    const op = dec(row.operationTimeMin as import("@prisma/client").Prisma.Decimal | number) ?? 0;
    const hours = (setup + op) / 60;
    if (hours <= 0) continue;
    const hourlyRate = row.Role
      ? roleHourlyRate(row.Role.baseSalary, row.Role.monthlyHours)
      : 0;
    const routingPath = `${pathPrefix}/routing/${row.id}`;
    const totalCost = buildStructureLineTotal(hours, hourlyRate, 0);
    children.push({
      nodeKey: routingPath,
      parentNodeKey: nodeKey,
      level: level + 1,
      path: routingPath,
      nodeType: "PROCESS",
      officialProductId: product.id,
      officialMaterialId: null,
      officialBomId: null,
      officialRoutingId: row.id,
      code: `OP-${row.sequence}`,
      description: row.description?.trim() || `Processo ${row.sequence}`,
      unit: "HH",
      quantity: hours,
      lossPercent: 0,
      officialUnitCost: hourlyRate,
      simulatedUnitCost: hourlyRate,
      totalCost,
      costSource: hourlyRate > 0 ? "OFFICIAL_ROUTING" : "MISSING",
      isInherited: true,
      isChanged: false,
      isMissingCost: hourlyRate <= 0,
      countsInSimulatedProductCost: countsInSimulatedProductCost && level === 0,
      children: [],
    });
  }

  return {
    nodeKey,
    parentNodeKey,
    level,
    path: pathPrefix,
    nodeType: level === 0 ? "ROOT_PRODUCT" : "PRODUCT",
    officialProductId: product.id,
    officialMaterialId: null,
    officialBomId: null,
    officialRoutingId: null,
    code: product.sku,
    description: `${product.sku} — ${product.name}`,
    unit: "UN",
    quantity: 1,
    lossPercent: 0,
    officialUnitCost: 0,
    simulatedUnitCost: 0,
    totalCost: 0,
    costSource: "OFFICIAL_COST_ANALYSIS",
    isInherited: true,
    isChanged: false,
    isMissingCost: false,
    countsInSimulatedProductCost: false,
    children,
  };
}

export async function loadOfficialProductEngineeringSnapshot(
  productId: string
): Promise<ProjectEngineeringSnapshot | null> {
  const alerts: string[] = [];
  const treeProduct = await buildBomTreeProduct(productId, new Set(), 0, alerts);
  if (!treeProduct) return null;

  let officialIndustrialCost: number | null = null;
  let costAnalysisPartial = false;
  const resolver = getProjectsProductCostResolver();
  if (resolver) {
    try {
      const analysis = await resolver(productId);
      if (analysis && !isCostAnalysisFailure(analysis) && "totalIndustrialCost" in analysis) {
        officialIndustrialCost = toFiniteNumber(analysis.totalIndustrialCost);
        costAnalysisPartial = Boolean(analysis.costAnalysisPartial);
      }
    } catch {
      alerts.push("Não foi possível carregar custo industrial oficial.");
    }
  }

  const tree = await mapProductToEngineeringNode(treeProduct, null, 0, treeProduct.id, true, alerts);

  return {
    rootProductId: treeProduct.id,
    sku: treeProduct.sku,
    name: treeProduct.name,
    type: treeProduct.type,
    officialIndustrialCost,
    costAnalysisPartial,
    alerts,
    tree,
  };
}

export function countEngineeringSnapshotLines(tree: ProjectEngineeringSnapshotNode): number {
  let count = 0;
  const walk = (node: ProjectEngineeringSnapshotNode) => {
    if (node.nodeType !== "ROOT_PRODUCT") count += 1;
    for (const child of node.children) walk(child);
  };
  walk(tree);
  return count;
}

type PersistCtx = {
  projectId: string;
  versionId: string;
  rootProductId: string;
  sortCursor: { value: number };
  nodeKeyToLineId: Map<string, string>;
};

async function persistEngineeringNode(
  node: ProjectEngineeringSnapshotNode,
  parentLineId: string | null,
  ctx: PersistCtx
): Promise<void> {
  if (node.nodeType === "ROOT_PRODUCT") {
    for (const child of node.children) {
      await persistEngineeringNode(child, null, ctx);
    }
    return;
  }

  const lineType =
    node.nodeType === "MATERIAL"
      ? "RAW_MATERIAL"
      : node.nodeType === "PROCESS"
        ? "PROCESS"
        : "COMPONENT";

  const sourceType =
    node.nodeType === "MATERIAL"
      ? "EXISTING_MATERIAL"
      : node.nodeType === "PROCESS"
        ? "MANUAL"
        : node.officialProductId
          ? "EXISTING_PRODUCT"
          : "MANUAL";

  const row = await prisma.projectStructureLine.create({
    data: {
      projectId: ctx.projectId,
      versionId: ctx.versionId,
      parentLineId,
      level: node.level,
      treePath: node.path,
      snapshotRootProductId: ctx.rootProductId,
      lineType,
      sourceType,
      existingProductId: node.officialProductId,
      existingMaterialId: node.officialMaterialId,
      sourceOfficialBomId: node.officialBomId,
      sourceOfficialRoutingId: node.officialRoutingId,
      descriptionSnapshot: node.description,
      unitSnapshot: node.unit,
      quantity: node.quantity,
      lossPercent: node.lossPercent,
      officialQuantitySnapshot: node.quantity,
      officialLossPercentSnapshot: node.lossPercent,
      officialUnitCostSnapshot: node.officialUnitCost,
      unitCostSnapshot: node.simulatedUnitCost,
      totalCost: node.totalCost,
      costSource: node.costSource,
      isChangedFromOfficial: false,
      isMissingCost: node.isMissingCost,
      countsInSimulatedProductCost: node.countsInSimulatedProductCost,
      notes: `snapshot:${ctx.rootProductId}`,
      sortOrder: ctx.sortCursor.value++,
    },
  });

  ctx.nodeKeyToLineId.set(node.nodeKey, row.id);

  for (const child of node.children) {
    await persistEngineeringNode(child, row.id, ctx);
  }
}

export async function importProductEngineeringSnapshotToProject(
  projectId: string,
  productId: string,
  options: { includeBom?: boolean; includeRouting?: boolean; replaceExisting?: boolean } = {}
) {
  const ctx = await requireProjectAndVersion(projectId);
  if ("error" in ctx) throw new Error(ctx.error);

  const snapshot = await loadOfficialProductEngineeringSnapshot(productId);
  if (!snapshot) throw new Error("Produto não encontrado.");

  if (options.replaceExisting !== false) {
    await prisma.projectStructureLine.deleteMany({
      where: {
        projectId,
        versionId: ctx.version.id,
        OR: [
          { snapshotRootProductId: productId },
          { notes: { contains: `snapshot:${productId}` } },
        ],
      },
    });
  }

  const lastSort = await prisma.projectStructureLine.findFirst({
    where: { projectId, versionId: ctx.version.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const persistCtx: PersistCtx = {
    projectId,
    versionId: ctx.version.id,
    rootProductId: productId,
    sortCursor: { value: (lastSort?.sortOrder ?? 0) + 1 },
    nodeKeyToLineId: new Map(),
  };

  let createdCount = 0;
  if (options.includeBom !== false || options.includeRouting) {
    const tree = { ...snapshot.tree };
    if (options.includeBom === false) {
      tree.children = tree.children.filter((c) => c.nodeType === "PROCESS");
    }
    if (options.includeRouting === false) {
      tree.children = tree.children.filter((c) => c.nodeType !== "PROCESS");
    }
    await persistEngineeringNode(tree, null, persistCtx);
    createdCount = persistCtx.sortCursor.value - ((lastSort?.sortOrder ?? 0) + 1);
  }

  await recalculateAndPersistVersionCosts(ctx.version.id);
  await establishEngineeringCostBaselineForSnapshot(ctx.version.id, productId);

  return {
    createdCount,
    lineIds: [...persistCtx.nodeKeyToLineId.values()],
    snapshot,
    nodeCount: countEngineeringSnapshotLines(snapshot.tree),
    officialIndustrialCost: snapshot.officialIndustrialCost,
  };
}
