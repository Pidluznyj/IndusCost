/**
 * Extração de breakdown de custo a partir do snapshot da proposta (sem inventar valores).
 * Fonte preferida: pricingSnapshotJson.item.frozen* da tabela publicada.
 */

export type ProposalItemCostBreakdown = {
  materialUnitCost: number | null;
  fabricationUnitCost: number | null;
  materialTotal: number | null;
  fabricationTotal: number | null;
  source: "SNAPSHOT" | "UNAVAILABLE";
  pendingReason: string | null;
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

/**
 * Tenta ler MP / HH / HM congelados do snapshot da tabela de preço.
 * Se não houver, retorna unavailable (não inventa rateio do unitCost).
 */
export function extractProposalItemCostBreakdown(
  pricingSnapshotJson: unknown,
  quantity: number
): ProposalItemCostBreakdown {
  const root = asRecord(pricingSnapshotJson);
  const item = asRecord(root?.item) ?? asRecord(root?.publishedItem) ?? root;
  const material = n(item?.frozenMaterialCost) ?? n(item?.materialCost);
  const hh = n(item?.frozenHhCost) ?? n(item?.laborCost) ?? n(item?.hhCost);
  const hm = n(item?.frozenHmCost) ?? n(item?.machineCost) ?? n(item?.hmCost);

  if (material == null && hh == null && hm == null) {
    return {
      materialUnitCost: null,
      fabricationUnitCost: null,
      materialTotal: null,
      fabricationTotal: null,
      source: "UNAVAILABLE",
      pendingReason: "Breakdown MP/fabricação não disponível no snapshot da proposta.",
    };
  }

  const fabrication =
    hh != null || hm != null ? (hh ?? 0) + (hm ?? 0) : null;
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;

  return {
    materialUnitCost: material,
    fabricationUnitCost: fabrication,
    materialTotal: material != null ? material * qty : null,
    fabricationTotal: fabrication != null ? fabrication * qty : null,
    source: "SNAPSHOT",
    pendingReason: null,
  };
}
