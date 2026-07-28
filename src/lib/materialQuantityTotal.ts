/**
 * Valor total de matéria-prima no cadastro de Suprimentos.
 * total = quantidade × custo unitário (unidade de medida adotada).
 * Não altera custo posto fábrica / custo efetivo / BOM.
 */

export function normalizeMaterialQuantity(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function computeMaterialTotalValue(
  quantity: unknown,
  unitCost: unknown
): number {
  const qty = normalizeMaterialQuantity(quantity);
  const unit = typeof unitCost === "number" ? unitCost : Number(unitCost);
  if (!Number.isFinite(unit) || unit < 0) return 0;
  // Mesma escala monetária usada no cadastro (até 6 casas).
  return Math.round(qty * unit * 1_000_000) / 1_000_000;
}

export type MaterialStockValueInput = {
  quantity?: unknown;
  currentCost?: unknown;
  calculations?: { totalMaterialValue?: unknown } | null;
};

/** Soma cadastro: Σ (quantidade × custo atual) de todos os materiais. */
export function sumMaterialCatalogStockValue(
  materials: readonly MaterialStockValueInput[]
): number {
  let total = 0;
  for (const material of materials) {
    const fromCalc = material.calculations?.totalMaterialValue;
    if (fromCalc != null && fromCalc !== "") {
      const n = typeof fromCalc === "number" ? fromCalc : Number(fromCalc);
      if (Number.isFinite(n)) {
        total += Math.max(0, n);
        continue;
      }
    }
    total += computeMaterialTotalValue(material.quantity, material.currentCost);
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}

export function countMaterialsWithStockQuantity(
  materials: readonly MaterialStockValueInput[]
): number {
  return materials.reduce(
    (count, material) =>
      count + (normalizeMaterialQuantity(material.quantity) > 0 ? 1 : 0),
    0
  );
}
