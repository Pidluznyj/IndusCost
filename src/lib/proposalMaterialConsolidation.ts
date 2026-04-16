import type { ProposalItem } from "@/src/types/commercial";

export type ConsolidatedMaterialLite = {
  materialId?: unknown;
  code?: unknown;
  description?: unknown;
  unit?: unknown;
  quantity?: unknown;
  totalCost?: unknown;
  unitCostEffective?: unknown;
  pctOfMp?: unknown;
};

export type ProposalMaterialOrigin = {
  itemIndex: number;
  productId: string;
  productName: string;
  productSku: string | null;
  proposalQty: number;
  materialQty: number | null;
  quantityTotal: number | null;
  totalCost: number | null;
};

export type ProposalConsolidatedMaterialRow = {
  materialId: string;
  code: string | null;
  description: string;
  unit: string | null;
  quantityTotal: number | null;
  unitCostEffective: number | null;
  totalCost: number | null;
  coveredOccurrences: number;
  missingPrice: boolean;
  pctOfMp: number | null;
  origins: ProposalMaterialOrigin[];
};

function safeNum(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatAdaptiveNumber(value: unknown): string {
  const n = safeNum(value);
  if (n === null) return "—";
  const abs = Math.abs(n);
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: abs >= 1 ? 2 : 6,
  });
}

export function formatAdaptiveCurrency(value: unknown): string {
  const n = safeNum(value);
  if (n === null) return "—";
  const abs = Math.abs(n);
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: abs >= 1 ? 2 : 6,
  });
}

export function buildProposalMaterialConsolidation(
  items: ProposalItem[],
  lineMetrics: Array<{ productId: string; openBook: { consolidatedMaterials?: unknown } | null }>
): {
  totalMp: number;
  rows: ProposalConsolidatedMaterialRow[];
} {
  const byMaterial = new Map<string, Omit<ProposalConsolidatedMaterialRow, "pctOfMp">>();

  lineMetrics.forEach((metric, itemIndex) => {
    const item = items[itemIndex];
    const qtyProposal = safeNum(item?.quantity) ?? 0;
    const rows = Array.isArray(metric.openBook?.consolidatedMaterials)
      ? (metric.openBook?.consolidatedMaterials as ConsolidatedMaterialLite[])
      : [];

    for (const row of rows) {
      const materialId =
        typeof row.materialId === "string" && row.materialId.trim() ? row.materialId : null;
      if (!materialId) continue;

      const description =
        typeof row.description === "string" && row.description.trim()
          ? row.description.trim()
          : "Matéria-prima";
      const code = typeof row.code === "string" && row.code.trim() ? row.code.trim() : null;
      const unit = typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : null;
      const baseQty = safeNum(row.quantity);
      const baseTotalCost = safeNum(row.totalCost);
      const unitCostEffective = safeNum(row.unitCostEffective);

      const quantityTotal = baseQty != null ? baseQty * qtyProposal : null;
      const totalCost = baseTotalCost != null ? baseTotalCost * qtyProposal : null;

      const current = byMaterial.get(materialId) ?? {
        materialId,
        code,
        description,
        unit,
        quantityTotal: 0,
        unitCostEffective,
        totalCost: 0,
        coveredOccurrences: 0,
        missingPrice: unitCostEffective == null,
        origins: [] as ProposalMaterialOrigin[],
      };

      current.code = current.code ?? code;
      current.unit = current.unit ?? unit;
      if (quantityTotal != null) current.quantityTotal = (current.quantityTotal ?? 0) + quantityTotal;
      else current.quantityTotal = null;
      if (totalCost != null) current.totalCost = (current.totalCost ?? 0) + totalCost;
      else current.totalCost = null;
      if (current.unitCostEffective == null && unitCostEffective != null) {
        current.unitCostEffective = unitCostEffective;
      }
      current.coveredOccurrences += 1;
      current.missingPrice = current.missingPrice || unitCostEffective == null;
      current.origins.push({
        itemIndex,
        productId: metric.productId,
        productName: item?.Product?.name?.trim() || "Produto da proposta",
        productSku: item?.Product?.sku?.trim() || null,
        proposalQty: qtyProposal,
        materialQty: baseQty,
        quantityTotal,
        totalCost,
      });

      byMaterial.set(materialId, current);
    }
  });

  const rows = [...byMaterial.values()].sort((a, b) => (b.totalCost ?? 0) - (a.totalCost ?? 0));
  const totalMp = rows.reduce((acc, row) => acc + (row.totalCost ?? 0), 0);

  return {
    totalMp,
    rows: rows.map((row) => ({
      ...row,
      pctOfMp: totalMp > 0 && row.totalCost != null ? (row.totalCost / totalMp) * 100 : null,
    })),
  };
}
