import type { ProjectStructureLineRow } from "@/src/types/projects.js";

const EPSILON = 0.000001;

/** Custo derivado por rollup sem edição manual do usuário. */
export function isLineRecalculatedFromRollup(
  line: Pick<
    ProjectStructureLineRow,
    "unitCostSnapshot" | "officialUnitCostSnapshot" | "isChangedFromOfficial"
  >,
  hasChildren: boolean
): boolean {
  if (line.isChangedFromOfficial || !hasChildren) return false;
  const official = line.officialUnitCostSnapshot;
  if (official == null) return false;
  return Math.abs(official - line.unitCostSnapshot) > EPSILON;
}

export function resolveMissingCostReason(line: ProjectStructureLineRow): string | null {
  const zeroCost = line.isMissingCost || line.unitCostSnapshot <= 0;
  if (!zeroCost) return null;

  const src = line.costSource ?? "";
  if (line.lineType === "RAW_MATERIAL") {
    if (src === "OFFICIAL_MATERIAL_COST" || src === "MISSING") return "Material sem custo";
    return "Material sem custo";
  }
  if (line.lineType === "PROCESS" || line.unitSnapshot === "HH") {
    if (src === "OFFICIAL_ROUTING" || src === "MISSING") return "Processo sem custo";
    return "Processo sem custo";
  }
  if (line.lineType === "COMPONENT") {
    if (src === "MISSING") return "Sem análise de custo";
    if (line.existingProductId && line.unitCostSnapshot <= 0) return "Sem BOM / custo oficial";
    return "Sem custo oficial";
  }
  if (src === "MISSING") return "Sem custo oficial";
  return "Sem custo";
}

export type StructureLineBadge = {
  key: string;
  label: string;
  className: string;
  title?: string;
};

export function resolveStructureLineBadges(
  line: ProjectStructureLineRow,
  options?: { hasChildren?: boolean }
): StructureLineBadge[] {
  const badges: StructureLineBadge[] = [];
  const hasChildren = options?.hasChildren ?? false;

  if (line.sourceType === "EXISTING_MATERIAL" || line.sourceType === "EXISTING_PRODUCT") {
    badges.push({
      key: "inherited",
      label: "Herdado",
      className: "bg-blue-100 text-blue-800",
    });
  }

  if (line.isChangedFromOfficial) {
    badges.push({
      key: "changed",
      label: "Alterado",
      className: "bg-amber-100 text-amber-900",
      title: "Editado manualmente no projeto",
    });
  } else if (isLineRecalculatedFromRollup(line, hasChildren)) {
    badges.push({
      key: "recalculated",
      label: "Recalculado",
      className: "bg-sky-100 text-sky-900",
      title: "Custo atualizado por rollup da estrutura",
    });
  }

  if (line.sourceType === "SIMULATED_ITEM" || line.sourceType === "MANUAL") {
    badges.push({
      key: "manual",
      label: line.sourceType === "SIMULATED_ITEM" ? "Fictício" : "Manual",
      className: "bg-violet-100 text-violet-900",
    });
  }

  const missingReason = resolveMissingCostReason(line);
  if (missingReason) {
    badges.push({
      key: "missing",
      label: "Sem custo",
      className: "bg-red-100 text-red-800",
      title: missingReason,
    });
  }

  return badges;
}
