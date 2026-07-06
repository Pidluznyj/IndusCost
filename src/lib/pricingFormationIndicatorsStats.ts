/** Linhas de GET /api/pricing — shape mínimo para agregação. */
export type PricingRow = {
  id: string;
  productId: string;
  taxRuleId: string;
  desiredMargin?: unknown;
};

export function pricingFormationRollup(rows: PricingRow[]) {
  const productIds = new Set<string>();
  const taxRuleIds = new Set<string>();
  for (const r of rows) {
    productIds.add(r.productId);
    taxRuleIds.add(r.taxRuleId);
  }
  return {
    premissas: rows.length,
    produtosDistintos: productIds.size,
    regrasFiscaisDistintas: taxRuleIds.size,
  };
}
