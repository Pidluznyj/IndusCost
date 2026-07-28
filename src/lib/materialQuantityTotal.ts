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
