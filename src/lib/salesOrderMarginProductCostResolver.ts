/** Ponte para getProductCostAnalysis registrado no server (motor oficial de custo). */
export type SalesOrderMarginProductCostAnalysisResolver = (
  productId: string
) => Promise<unknown>;

let resolver: SalesOrderMarginProductCostAnalysisResolver | null = null;

export function setSalesOrderMarginProductCostResolver(
  fn: SalesOrderMarginProductCostAnalysisResolver | null
): void {
  resolver = fn;
}

export function getSalesOrderMarginProductCostResolver(): SalesOrderMarginProductCostAnalysisResolver {
  if (!resolver) {
    throw new Error(
      "SalesOrderMarginProductCostResolver não registrado — configure no server antes das rotas."
    );
  }
  return resolver;
}
