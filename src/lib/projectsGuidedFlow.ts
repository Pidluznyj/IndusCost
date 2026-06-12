import { buildProjectStructureSnapshotGroups } from "@/src/lib/projectsStructureSnapshotGroups";
import { parseMoldNotes, sumMoldCostLines } from "@/src/lib/projectsMoldCostLines";
import {
  isGuidedOtherCostItem,
  OTHER_COST_GROUP_LABEL,
  parseOtherCostMeta,
} from "@/src/lib/projectsOtherCostGroups";
import type {
  ProjectDetail,
  ProjectMoldRow,
  ProjectSimulatedItemRow,
  ProjectSimulatedProductRow,
  ProjectStatus,
} from "@/src/types/projects";

export const PROJECT_GUIDED_HOME_TITLE = "Montagem do Projeto";
export const PROJECT_GUIDED_HOME_SUBTITLE =
  "Crie os produtos, moldes e custos adicionais que compõem este projeto.";
export const PROJECT_GUIDED_HOME_INTRO =
  "Monte os itens do projeto para simular produto, molde e custos adicionais antes de transformar isso em cadastro oficial.";
export const PROJECT_GUIDED_MASTER_NOTICE =
  "Este item será salvo somente no projeto e não altera o cadastro mestre.";

export const GUIDED_ORIGIN_REFERENCE_MARKER = "guided-origin:REFERENCE";
export const GUIDED_ITEM_KIND_COMPONENT_MARKER = "guided-item-kind:COMPONENT";
export const GUIDED_REF_SIMULATED_PRODUCT_PREFIX = "guided-ref-sim-product:";

export function buildSimulatedProductRefNotes(
  refProductId: string,
  existingNotes?: string | null
): string {
  const marker = `${GUIDED_REF_SIMULATED_PRODUCT_PREFIX}${refProductId}`;
  const base = existingNotes?.trim();
  if (base?.includes(marker)) return base;
  return base ? `${base}\n${marker}` : marker;
}

export function parseSimulatedProductRefFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const idx = notes.indexOf(GUIDED_REF_SIMULATED_PRODUCT_PREFIX);
  if (idx < 0) return null;
  const id = notes.slice(idx + GUIDED_REF_SIMULATED_PRODUCT_PREFIX.length, idx + GUIDED_REF_SIMULATED_PRODUCT_PREFIX.length + 36);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export function isGuidedComponentProduct(notes: string | null | undefined): boolean {
  return notes?.includes(GUIDED_ITEM_KIND_COMPONENT_MARKER) === true;
}

export function appendGuidedComponentKind(notes: string | null | undefined): string {
  const base = notes?.trim();
  if (base?.includes(GUIDED_ITEM_KIND_COMPONENT_MARKER)) return base;
  return base ? `${base}\n${GUIDED_ITEM_KIND_COMPONENT_MARKER}` : GUIDED_ITEM_KIND_COMPONENT_MARKER;
}

export function sumSimulatedProductStructureCost(
  lines: ProjectDetail["structureLines"],
  simulatedProductId: string
): number {
  return lines
    .filter((l) => l.simulatedProductId === simulatedProductId && l.snapshotRootProductId == null)
    .reduce((acc, l) => acc + (Number.isFinite(l.totalCost) ? l.totalCost : 0), 0);
}

export function isGuidedReferenceProduct(notes: string | null | undefined): boolean {
  return notes?.includes(GUIDED_ORIGIN_REFERENCE_MARKER) === true;
}

export function appendGuidedReferenceOrigin(notes: string | null | undefined): string {
  const base = notes?.trim();
  if (base?.includes(GUIDED_ORIGIN_REFERENCE_MARKER)) return base;
  return base ? `${base}\n${GUIDED_ORIGIN_REFERENCE_MARKER}` : GUIDED_ORIGIN_REFERENCE_MARKER;
}

function simulatedProductHasCost(
  productId: string,
  structureLines: ProjectDetail["structureLines"]
): boolean {
  const lines = structureLines.filter((line) => line.simulatedProductId === productId);
  if (lines.length === 0) return false;
  return lines.some((line) => {
    const unit = line.unitCostSnapshot ?? 0;
    return Number.isFinite(unit) && unit > 0;
  });
}

export type ProjectGuidedItemType =
  | "PRODUCT"
  | "COMPONENT"
  | "RAW_MATERIAL"
  | "MOLD"
  | "OTHER_COST";

export type ProjectGuidedOrigin =
  | "CREATED_IN_PROJECT"
  | "CLONED_FROM_OFFICIAL"
  | "OFFICIAL_REFERENCE"
  | "MANUAL_ENTRY";

export type ProjectGuidedStatus =
  | "DRAFT"
  | "IN_SIMULATION"
  | "CALCULATED"
  | "PENDING_COST"
  | "APPROVED_IN_PROJECT"
  | "PROMOTED";

export type ProjectGuidedItemRow = {
  id: string;
  entityKind: "product" | "mold" | "other_cost" | "engineering_clone";
  itemType: ProjectGuidedItemType;
  itemTypeLabel: string;
  code: string | null;
  name: string;
  description: string;
  origin: ProjectGuidedOrigin;
  originLabel: string;
  status: ProjectGuidedStatus;
  statusLabel: string;
  estimatedCost: number | null;
  costKind: "unit" | "investment" | "project";
  updatedAt: string | null;
  productId?: string;
  moldId?: string;
  simulatedItemId?: string;
  snapshotRootProductId?: string;
  batchId?: string | null;
};

export type ProjectGuidedCostSummary = {
  itemCount: number;
  productCount: number;
  moldCount: number;
  otherCostCount: number;
  pendingCount: number;
  estimatedUnitCost: number;
  initialInvestment: number;
  otherProjectCosts: number;
  totalProjectCost: number;
};

const ORIGIN_LABEL: Record<ProjectGuidedOrigin, string> = {
  CREATED_IN_PROJECT: "Criado no projeto",
  CLONED_FROM_OFFICIAL: "Clonado de item oficial",
  OFFICIAL_REFERENCE: "Item oficial reutilizado",
  MANUAL_ENTRY: "Lançamento manual",
};

const STATUS_LABEL: Record<ProjectGuidedStatus, string> = {
  DRAFT: "Rascunho",
  IN_SIMULATION: "Em simulação",
  CALCULATED: "Calculado",
  PENDING_COST: "Pendente de custo",
  APPROVED_IN_PROJECT: "Aprovado no projeto",
  PROMOTED: "Promovido",
};

function resolveStatus(
  projectStatus: ProjectStatus,
  hasCost: boolean
): ProjectGuidedStatus {
  if (projectStatus === "CONVERTED") return "PROMOTED";
  if (projectStatus === "APPROVED") return "APPROVED_IN_PROJECT";
  if (!hasCost) return "PENDING_COST";
  return "IN_SIMULATION";
}

function productRows(detail: ProjectDetail): ProjectGuidedItemRow[] {
  const { snapshotGroups } = buildProjectStructureSnapshotGroups(detail.structureLines, {
    simulatedProducts: detail.simulatedProducts,
  });

  const rows: ProjectGuidedItemRow[] = [];

  for (const p of detail.simulatedProducts) {
    const structureCost = sumSimulatedProductStructureCost(detail.structureLines, p.id);
    const hasCost = structureCost > 0 || simulatedProductHasCost(p.id, detail.structureLines);
    const isComponent = isGuidedComponentProduct(p.notes);
    const origin: ProjectGuidedOrigin = isGuidedReferenceProduct(p.notes)
      ? "OFFICIAL_REFERENCE"
      : "CREATED_IN_PROJECT";
    const status = resolveStatus(detail.status, hasCost);
    rows.push({
      id: p.id,
      entityKind: "product",
      itemType: isComponent ? "COMPONENT" : "PRODUCT",
      itemTypeLabel: isComponent ? "Componente" : "Produto",
      code: p.provisionalCode,
      name: p.description,
      description: p.description,
      origin,
      originLabel: ORIGIN_LABEL[origin],
      status,
      statusLabel: STATUS_LABEL[status],
      estimatedCost: hasCost ? structureCost || detail.costBreakdown.unitCost : null,
      costKind: "unit",
      updatedAt: detail.updatedAt,
      productId: p.id,
    });
  }

  for (const group of snapshotGroups) {
    rows.push({
      id: group.groupKey,
      entityKind: "engineering_clone",
      itemType: "COMPONENT",
      itemTypeLabel: "Clone de engenharia",
      code: group.rootCode,
      name: group.rootDescription,
      description: group.rootDescription,
      origin: "CLONED_FROM_OFFICIAL",
      originLabel: ORIGIN_LABEL.CLONED_FROM_OFFICIAL,
      status: resolveStatus(detail.status, !group.hasMissingCost),
      statusLabel: STATUS_LABEL[resolveStatus(detail.status, !group.hasMissingCost)],
      estimatedCost: group.simulatedCost,
      costKind: "unit",
      updatedAt: detail.updatedAt,
      snapshotRootProductId: group.snapshotRootProductId,
    });
  }

  for (const item of detail.simulatedItems) {
    if (isGuidedOtherCostItem(item.notes)) continue;
    const cost = item.quotedUnitCost ?? item.estimatedUnitCost;
    const itemType: ProjectGuidedItemType =
      item.itemType === "RAW_MATERIAL"
        ? "RAW_MATERIAL"
        : item.itemType === "COMPONENT"
          ? "COMPONENT"
          : "COMPONENT";
    rows.push({
      id: item.id,
      entityKind: "product",
      itemType,
      itemTypeLabel:
        itemType === "RAW_MATERIAL" ? "Matéria-prima" : "Componente",
      code: item.provisionalCode,
      name: item.description,
      description: item.description,
      origin: "CREATED_IN_PROJECT",
      originLabel: ORIGIN_LABEL.CREATED_IN_PROJECT,
      status: resolveStatus(detail.status, cost != null && cost > 0),
      statusLabel: STATUS_LABEL[resolveStatus(detail.status, cost != null && cost > 0)],
      estimatedCost: cost,
      costKind: "unit",
      updatedAt: detail.updatedAt,
      simulatedItemId: item.id,
    });
  }

  return rows;
}

function moldRows(detail: ProjectDetail): ProjectGuidedItemRow[] {
  return detail.molds.map((m: ProjectMoldRow) => {
    const { lines } = parseMoldNotes(m.notes);
    const lineTotal = lines.length > 0 ? sumMoldCostLines(lines) : m.constructionCost;
    const hasCost = lineTotal > 0;
    const status = resolveStatus(detail.status, hasCost);
    return {
      id: m.id,
      entityKind: "mold",
      itemType: "MOLD",
      itemTypeLabel: "Molde",
      code: null,
      name: m.name,
      description: m.moldType ? `${m.name} (${m.moldType})` : m.name,
      origin: "CREATED_IN_PROJECT",
      originLabel: ORIGIN_LABEL.CREATED_IN_PROJECT,
      status,
      statusLabel: STATUS_LABEL[status],
      estimatedCost: lineTotal,
      costKind: "investment",
      updatedAt: detail.updatedAt,
      moldId: m.id,
    };
  });
}

function otherCostRows(detail: ProjectDetail): ProjectGuidedItemRow[] {
  const batches = new Map<string, ProjectSimulatedItemRow[]>();
  for (const item of detail.simulatedItems) {
    if (!isGuidedOtherCostItem(item.notes)) continue;
    const { batchId } = parseOtherCostMeta(item.notes);
    const key = batchId ?? item.id;
    const list = batches.get(key) ?? [];
    list.push(item);
    batches.set(key, list);
  }

  const rows: ProjectGuidedItemRow[] = [];
  for (const [batchId, items] of batches) {
    const total = items.reduce(
      (acc, i) => acc + (i.quotedUnitCost ?? i.estimatedUnitCost ?? 0),
      0
    );
    const meta = parseOtherCostMeta(items[0]?.notes);
    const groupLabel = OTHER_COST_GROUP_LABEL[meta.group];
    const status = resolveStatus(detail.status, total > 0);
    rows.push({
      id: batchId,
      entityKind: "other_cost",
      itemType: "OTHER_COST",
      itemTypeLabel: "Outro custo",
      code: null,
      name: groupLabel,
      description: items.map((i) => i.description).join("; "),
      origin: "MANUAL_ENTRY",
      originLabel: ORIGIN_LABEL.MANUAL_ENTRY,
      status,
      statusLabel: STATUS_LABEL[status],
      estimatedCost: total,
      costKind: "project",
      updatedAt: detail.updatedAt,
      batchId,
      simulatedItemId: items[0]?.id,
    });
  }
  return rows;
}

export function buildProjectGuidedItems(detail: ProjectDetail): ProjectGuidedItemRow[] {
  return [...productRows(detail), ...moldRows(detail), ...otherCostRows(detail)];
}

export function computeProjectGuidedCosts(detail: ProjectDetail): ProjectGuidedCostSummary {
  const items = buildProjectGuidedItems(detail);
  const productCount = items.filter(
    (i) => i.entityKind === "product" || i.entityKind === "engineering_clone"
  ).length;
  const moldCount = items.filter((i) => i.entityKind === "mold").length;
  const otherCostCount = items.filter((i) => i.entityKind === "other_cost").length;
  const pendingCount = items.filter((i) => i.status === "PENDING_COST").length;

  const estimatedUnitCost = detail.costBreakdown.unitCost ?? 0;
  const initialInvestment = detail.costBreakdown.separateMoldCost ?? 0;
  const otherProjectCosts = detail.simulatedItems
    .filter((i) => isGuidedOtherCostItem(i.notes))
    .reduce((acc, i) => acc + (i.quotedUnitCost ?? i.estimatedUnitCost ?? 0), 0);

  return {
    itemCount: items.length,
    productCount,
    moldCount,
    otherCostCount,
    pendingCount,
    estimatedUnitCost,
    initialInvestment,
    otherProjectCosts,
    totalProjectCost: estimatedUnitCost + initialInvestment + otherProjectCosts,
  };
}

export function projectGuidedOriginLabel(origin: ProjectGuidedOrigin): string {
  return ORIGIN_LABEL[origin];
}
