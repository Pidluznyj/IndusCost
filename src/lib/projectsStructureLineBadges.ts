import { officialLineTotal } from "@/src/lib/projectsEngineeringCostRollup.js";
import type { ProjectStructureLineRow } from "@/src/types/projects.js";

const EPSILON = 0.000001;

/** Total simulado divergiu do oficial por delta propagado, sem edição manual direta. */
export function isLineRecalculatedFromRollup(
  line: Pick<
    ProjectStructureLineRow,
    | "quantity"
    | "lossPercent"
    | "unitCostSnapshot"
    | "totalCost"
    | "officialQuantitySnapshot"
    | "officialLossPercentSnapshot"
    | "officialUnitCostSnapshot"
    | "isChangedFromOfficial"
  >
): boolean {
  if (line.isChangedFromOfficial) return false;
  const officialTotal = officialLineTotal({
    id: "",
    parentLineId: null,
    snapshotRootProductId: null,
    lineType: "",
    quantity: line.quantity,
    lossPercent: line.lossPercent ?? 0,
    unitCostSnapshot: line.unitCostSnapshot,
    totalCost: line.totalCost,
    officialQuantitySnapshot: line.officialQuantitySnapshot,
    officialLossPercentSnapshot: line.officialLossPercentSnapshot,
    officialUnitCostSnapshot: line.officialUnitCostSnapshot,
    countsInSimulatedProductCost: false,
    isChangedFromOfficial: false,
  });
  return Math.abs(line.totalCost - officialTotal) > EPSILON;
}

export function resolveMissingCostReason(line: ProjectStructureLineRow): string | null {
  const zeroCost = line.isMissingCost || line.unitCostSnapshot <= 0;
  if (!zeroCost) return null;

  const src = line.costSource ?? "";
  if (line.lineType === "RAW_MATERIAL") {
    if (src === "MATERIAL_CURRENT_COST" || src === "OFFICIAL_MATERIAL_COST" || src === "MISSING") {
      return "Material sem custo";
    }
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

export function resolveStructureLineBadges(line: ProjectStructureLineRow): StructureLineBadge[] {
  const badges: StructureLineBadge[] = [];

  if (line.sourceType === "EXISTING_PRODUCT") {
    badges.push({
      key: "official-product",
      label: "Produto oficial",
      className: "bg-blue-100 text-blue-800",
    });
  } else if (line.sourceType === "EXISTING_MATERIAL") {
    badges.push({
      key: "official-material",
      label: "Material da base",
      className: "bg-sky-100 text-sky-900",
    });
  }

  if (line.isChangedFromOfficial) {
    badges.push({
      key: "changed",
      label: "Alterado",
      className: "bg-amber-100 text-amber-900",
      title: "Editado manualmente no projeto",
    });
  } else if (isLineRecalculatedFromRollup(line)) {
    badges.push({
      key: "recalculated",
      label: "Recalculado",
      className: "bg-sky-100 text-sky-900",
      title: "Custo atualizado por rollup da estrutura",
    });
  }

  if (line.sourceType === "SIMULATED_ITEM") {
    badges.push({
      key: "project-component",
      label: "Componente do projeto",
      className: "bg-violet-100 text-violet-900",
      title: "Somente projeto — não altera cadastro oficial",
    });
  } else if (line.sourceType === "MANUAL") {
    badges.push({
      key: "manual",
      label: "Item orçado",
      className: "bg-violet-100 text-violet-900",
      title: "Somente projeto",
    });
  }

  if (line.simulatedProductId && !line.snapshotRootProductId) {
    badges.push({
      key: "project-only",
      label: "Somente projeto",
      className: "bg-indigo-100 text-indigo-900",
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
