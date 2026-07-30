/**
 * Extração de breakdown de custo a partir do snapshot da proposta (sem inventar valores).
 * Fonte preferida: pricingSnapshotJson.item.frozen* da tabela publicada.
 * Fallback: breakdown oficial de custo de produção vigente (MP / HH / HM).
 */

export type ProposalItemCostBreakdown = {
  materialUnitCost: number | null;
  fabricationUnitCost: number | null;
  materialTotal: number | null;
  fabricationTotal: number | null;
  source: "SNAPSHOT" | "PRODUCTION" | "UNAVAILABLE";
  pendingReason: string | null;
};

export type ProposalItemProductionCostBreakdownInput = {
  materialCost?: number | null;
  laborCost?: number | null;
  machineCost?: number | null;
  processCost?: number | null;
};

function n(value: unknown): number | null {
  if (value == null || value === "") return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fromUnitCosts(
  material: number | null,
  fabrication: number | null,
  quantity: number,
  source: "SNAPSHOT" | "PRODUCTION"
): ProposalItemCostBreakdown {
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  return {
    materialUnitCost: material,
    fabricationUnitCost: fabrication,
    materialTotal: material != null ? material * qty : null,
    fabricationTotal: fabrication != null ? fabrication * qty : null,
    source,
    pendingReason: null,
  };
}

/**
 * Tenta ler MP / HH / HM congelados do snapshot da tabela de preço.
 * Se não houver, usa breakdown de produção vigente (quando fornecido).
 * Não inventa rateio do unitCost.
 */
export function extractProposalItemCostBreakdown(
  pricingSnapshotJson: unknown,
  quantity: number,
  options?: {
    productionBreakdown?: ProposalItemProductionCostBreakdownInput | null;
  }
): ProposalItemCostBreakdown {
  const root = asRecord(pricingSnapshotJson);
  const item = asRecord(root?.item) ?? asRecord(root?.publishedItem) ?? root;
  const material = n(item?.frozenMaterialCost) ?? n(item?.materialCost);
  const hh = n(item?.frozenHhCost) ?? n(item?.laborCost) ?? n(item?.hhCost);
  const hm = n(item?.frozenHmCost) ?? n(item?.machineCost) ?? n(item?.hmCost);

  if (material != null || hh != null || hm != null) {
    const fabrication =
      hh != null || hm != null ? (hh ?? 0) + (hm ?? 0) : null;
    return fromUnitCosts(material, fabrication, quantity, "SNAPSHOT");
  }

  const prod = options?.productionBreakdown ?? null;
  if (prod) {
    const prodMaterial = n(prod.materialCost);
    const labor = n(prod.laborCost);
    const machine = n(prod.machineCost);
    const process = n(prod.processCost);
    if (prodMaterial != null || labor != null || machine != null || process != null) {
      const fabrication =
        labor != null || machine != null || process != null
          ? (labor ?? 0) + (machine ?? 0) + (process ?? 0)
          : null;
      return fromUnitCosts(prodMaterial, fabrication, quantity, "PRODUCTION");
    }
  }

  return {
    materialUnitCost: null,
    fabricationUnitCost: null,
    materialTotal: null,
    fabricationTotal: null,
    source: "UNAVAILABLE",
    pendingReason: "Breakdown MP/fabricação não disponível no snapshot nem no custo de produção vigente.",
  };
}
