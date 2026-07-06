import { buildProjectStructureSnapshotGroups } from "@/src/lib/projectsStructureSnapshotGroups";
import type {
  ProjectDetail,
  ProjectSimulatedItemRow,
  ProjectSimulatedProductRow,
  ProjectStatus,
  ProjectStructureLineRow,
} from "@/src/types/projects";

export type ProjectEngineeringItemOrigin =
  | "NEW_IN_PROJECT"
  | "CLONED_FROM_OFFICIAL"
  | "OFFICIAL_REFERENCE"
  | "OFFICIAL_MATERIAL";

export type ProjectEngineeringItemKind =
  | "simulated_product"
  | "simulated_item"
  | "cloned_snapshot"
  | "structure_reference";

export type ProjectEngineeringItemStatus =
  | "SIMULATED"
  | "PENDING"
  | "APPROVED"
  | "PROMOTED";

export type ProjectEngineeringItemRow = {
  id: string;
  kind: ProjectEngineeringItemKind;
  provisionalCode: string | null;
  name: string;
  itemType: string;
  origin: ProjectEngineeringItemOrigin;
  originLabel: string;
  status: ProjectEngineeringItemStatus;
  simulatedCost: number | null;
  officialOriginCode: string | null;
  officialOriginName: string | null;
  updatedAt: string | null;
  /** ID de produto oficial para abrir simulação ou clonar variação */
  snapshotRootProductId?: string | null;
  simulatedProductId?: string | null;
  simulatedItemId?: string | null;
  hasMissingCost?: boolean;
  isEditableLocally: boolean;
};

export type ProjectEngineeringStats = {
  localItemsCount: number;
  clonedItemsCount: number;
  officialItemsUsedCount: number;
  itemsWithoutCostCount: number;
  totalSimulatedCost: number;
  officialMaterialsCount: number;
  officialComponentsCount: number;
  pendingRegistrationCount: number;
};

export type ProjectEngineeringBadge = {
  key: string;
  label: string;
  className: string;
  title?: string;
};

const ORIGIN_LABEL: Record<ProjectEngineeringItemOrigin, string> = {
  NEW_IN_PROJECT: "Novo no projeto",
  CLONED_FROM_OFFICIAL: "Clone de item oficial",
  OFFICIAL_REFERENCE: "Item oficial reutilizado",
  OFFICIAL_MATERIAL: "Material oficial reutilizado",
};

const STATUS_LABEL: Record<ProjectEngineeringItemStatus, string> = {
  SIMULATED: "Simulado",
  PENDING: "Pendente",
  APPROVED: "Aprovado",
  PROMOTED: "Promovido",
};

export function projectEngineeringOriginLabel(origin: ProjectEngineeringItemOrigin): string {
  return ORIGIN_LABEL[origin];
}

export function projectEngineeringStatusLabel(status: ProjectEngineeringItemStatus): string {
  return STATUS_LABEL[status];
}

function resolveItemStatus(
  projectStatus: ProjectStatus,
  hasMissingCost: boolean,
  canBecomeOfficial?: boolean
): ProjectEngineeringItemStatus {
  if (projectStatus === "CONVERTED") return "PROMOTED";
  if (projectStatus === "APPROVED") return "APPROVED";
  if (hasMissingCost || canBecomeOfficial === false) return "PENDING";
  return "SIMULATED";
}

function productRow(
  p: ProjectSimulatedProductRow,
  projectStatus: ProjectStatus,
  updatedAt: string
): ProjectEngineeringItemRow {
  return {
    id: p.id,
    kind: "simulated_product",
    provisionalCode: p.provisionalCode,
    name: p.description,
    itemType: "Produto / componente local",
    origin: "NEW_IN_PROJECT",
    originLabel: ORIGIN_LABEL.NEW_IN_PROJECT,
    status: resolveItemStatus(projectStatus, false),
    simulatedCost: null,
    officialOriginCode: null,
    officialOriginName: null,
    updatedAt,
    simulatedProductId: p.id,
    isEditableLocally: true,
  };
}

function simulatedItemRow(
  item: ProjectSimulatedItemRow,
  projectStatus: ProjectStatus
): ProjectEngineeringItemRow {
  const cost = item.quotedUnitCost ?? item.estimatedUnitCost;
  const hasMissingCost = cost == null || cost <= 0;
  return {
    id: item.id,
    kind: "simulated_item",
    provisionalCode: item.provisionalCode,
    name: item.description,
    itemType: item.itemType,
    origin: "NEW_IN_PROJECT",
    originLabel: ORIGIN_LABEL.NEW_IN_PROJECT,
    status: resolveItemStatus(projectStatus, hasMissingCost, item.canBecomeOfficial),
    simulatedCost: cost,
    officialOriginCode: null,
    officialOriginName: null,
    updatedAt: null,
    simulatedItemId: item.id,
    hasMissingCost,
    isEditableLocally: true,
  };
}

function isOfficialReferenceLine(line: ProjectStructureLineRow): boolean {
  if (line.snapshotRootProductId) return false;
  if (line.notes?.includes("snapshot:")) return false;
  if (line.sourceType === "EXISTING_MATERIAL") return true;
  if (line.sourceType === "EXISTING_PRODUCT" && line.parentLineId == null) return true;
  return false;
}

export function buildProjectEngineeringItems(detail: ProjectDetail): ProjectEngineeringItemRow[] {
  const rows: ProjectEngineeringItemRow[] = [];
  const { snapshotGroups, simulatedProductGroups } = buildProjectStructureSnapshotGroups(
    detail.structureLines,
    { simulatedProducts: detail.simulatedProducts }
  );

  const productIdsWithStructure = new Set(
    detail.structureLines
      .filter((l) => l.simulatedProductId && !l.snapshotRootProductId)
      .map((l) => l.simulatedProductId as string)
  );

  for (const p of detail.simulatedProducts) {
    if (!productIdsWithStructure.has(p.id)) {
      rows.push(productRow(p, detail.status, detail.updatedAt));
    }
  }

  for (const group of snapshotGroups) {
    const hasMissingCost = group.hasMissingCost;
    rows.push({
      id: group.groupKey,
      kind: "cloned_snapshot",
      provisionalCode: group.rootCode,
      name: group.rootDescription,
      itemType: "Clone local",
      origin: "CLONED_FROM_OFFICIAL",
      originLabel: ORIGIN_LABEL.CLONED_FROM_OFFICIAL,
      status: resolveItemStatus(detail.status, hasMissingCost),
      simulatedCost: group.simulatedCost,
      officialOriginCode: group.rootCode,
      officialOriginName: group.rootDescription,
      updatedAt: detail.updatedAt,
      snapshotRootProductId: group.snapshotRootProductId,
      hasMissingCost,
      isEditableLocally: true,
    });
  }

  for (const group of simulatedProductGroups) {
    if (group.itemCount === 0) continue;
    rows.push({
      id: group.groupKey,
      kind: "simulated_product",
      provisionalCode: group.rootCode,
      name: group.rootDescription,
      itemType: "Produto local com estrutura",
      origin: "NEW_IN_PROJECT",
      originLabel: ORIGIN_LABEL.NEW_IN_PROJECT,
      status: resolveItemStatus(detail.status, group.hasMissingCost),
      simulatedCost: group.totalCost,
      officialOriginCode: null,
      officialOriginName: null,
      updatedAt: detail.updatedAt,
      simulatedProductId: group.simulatedProductId,
      hasMissingCost: group.hasMissingCost,
      isEditableLocally: true,
    });
  }

  for (const item of detail.simulatedItems) {
    rows.push(simulatedItemRow(item, detail.status));
  }

  const seenReference = new Set<string>();
  for (const line of detail.structureLines) {
    if (!isOfficialReferenceLine(line)) continue;
    const key =
      line.sourceType === "EXISTING_MATERIAL"
        ? `mat:${line.existingMaterialId}:${line.id}`
        : `prod:${line.existingProductId}:${line.id}`;
    if (seenReference.has(key)) continue;
    seenReference.add(key);

    const parts = line.descriptionSnapshot.split(" — ");
    const code = parts[0]?.trim() ?? line.descriptionSnapshot;
    const name = parts.slice(1).join(" — ").trim() || line.descriptionSnapshot;
    const origin: ProjectEngineeringItemOrigin =
      line.sourceType === "EXISTING_MATERIAL" ? "OFFICIAL_MATERIAL" : "OFFICIAL_REFERENCE";

    rows.push({
      id: line.id,
      kind: "structure_reference",
      provisionalCode: code,
      name,
      itemType: line.lineType,
      origin,
      originLabel: ORIGIN_LABEL[origin],
      status: resolveItemStatus(detail.status, line.isMissingCost || line.unitCostSnapshot <= 0),
      simulatedCost: line.totalCost,
      officialOriginCode: code,
      officialOriginName: name,
      updatedAt: detail.updatedAt,
      snapshotRootProductId: line.existingProductId,
      hasMissingCost: line.isMissingCost,
      isEditableLocally: false,
    });
  }

  return rows;
}

export function computeProjectEngineeringStats(detail: ProjectDetail): ProjectEngineeringStats {
  const items = buildProjectEngineeringItems(detail);
  const localItemsCount = items.filter(
    (i) => i.origin === "NEW_IN_PROJECT" && i.kind !== "structure_reference"
  ).length;
  const clonedItemsCount = items.filter((i) => i.origin === "CLONED_FROM_OFFICIAL").length;
  const officialItemsUsedCount = items.filter(
    (i) => i.origin === "OFFICIAL_REFERENCE" || i.origin === "OFFICIAL_MATERIAL"
  ).length;
  const itemsWithoutCostCount = items.filter(
    (i) => i.hasMissingCost || i.simulatedCost == null || i.simulatedCost <= 0
  ).length;

  const officialMaterialsCount = detail.structureLines.filter(
    (l) => l.sourceType === "EXISTING_MATERIAL" && !l.snapshotRootProductId
  ).length;
  const officialComponentsCount = detail.structureLines.filter(
    (l) =>
      l.sourceType === "EXISTING_PRODUCT" &&
      !l.snapshotRootProductId &&
      !l.notes?.includes("snapshot:")
  ).length;

  const pendingRegistrationCount = detail.simulatedItems.filter(
    (i) => i.canBecomeOfficial && (i.requiresQuotation || i.requiresEngineeringReview)
  ).length;

  return {
    localItemsCount,
    clonedItemsCount,
    officialItemsUsedCount,
    itemsWithoutCostCount,
    totalSimulatedCost: detail.costBreakdown.unitCost ?? 0,
    officialMaterialsCount,
    officialComponentsCount,
    pendingRegistrationCount,
  };
}

export function resolveProjectEngineeringItemBadges(
  item: ProjectEngineeringItemRow
): ProjectEngineeringBadge[] {
  const badges: ProjectEngineeringBadge[] = [];

  badges.push({
    key: "project-item",
    label: "Item do projeto",
    className: "bg-indigo-100 text-indigo-900",
    title: "Somente neste projeto — não altera cadastro mestre",
  });

  if (item.origin === "CLONED_FROM_OFFICIAL") {
    badges.push({
      key: "clone",
      label: "Clone",
      className: "bg-violet-100 text-violet-900",
      title: "Cópia local para simulação",
    });
  }

  if (item.origin === "OFFICIAL_REFERENCE" || item.origin === "OFFICIAL_MATERIAL") {
    badges.push({
      key: "official",
      label: "Oficial",
      className: "bg-blue-100 text-blue-800",
      title: "Referência ao cadastro mestre",
    });
  }

  if (item.origin === "NEW_IN_PROJECT") {
    badges.push({
      key: "new",
      label: "Novo",
      className: "bg-emerald-100 text-emerald-900",
    });
  }

  badges.push({
    key: "status",
    label: STATUS_LABEL[item.status],
    className:
      item.status === "PROMOTED"
        ? "bg-purple-100 text-purple-900"
        : item.status === "APPROVED"
          ? "bg-green-100 text-green-800"
          : item.status === "PENDING"
            ? "bg-amber-100 text-amber-900"
            : "bg-slate-100 text-slate-800",
  });

  if (item.hasMissingCost) {
    badges.push({
      key: "missing-cost",
      label: "Sem custo",
      className: "bg-red-100 text-red-800",
    });
  }

  return badges;
}

export const PROJECT_ENGINEERING_MASTER_DATA_NOTICE =
  "Cadastro mestre: não será alterado. Itens locais permanecem apenas neste projeto.";

export const PROJECT_ENGINEERING_TAB_SUBTITLE =
  "Crie, clone e simule itens dentro deste projeto sem alterar o cadastro mestre.";

export const PROJECT_ENGINEERING_CLONE_NOTICE =
  "Este item é uma cópia local para simulação. Alterações não afetam o cadastro mestre.";
