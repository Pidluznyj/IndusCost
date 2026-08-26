/**
 * Cache dos gráficos da listagem Comercial > Pedidos de Venda — parte PURA.
 *
 * Os dois gráficos do topo da tela (valor vendido YoY + margem % mensal)
 * dependem só do ANO: todos os demais filtros da listagem são ignorados por
 * regra de negócio documentada no próprio componente. Por isso o cache tem
 * uma linha por ano civil.
 *
 * Invalidação: o gráfico do ano N inclui a série do ano N-1 (comparativo
 * YoY). Logo, um pedido emitido no ano A invalida o cache de A E o de A+1.
 */

import type {
  SalesOrderResultMonthlyRow,
  SalesOrderResultMonthlySalesComparisonRow,
} from "@/src/lib/salesOrderResultTypes.js";

export type SalesOrderResultChartsCachePayload = {
  year: number;
  monthlySalesComparison: SalesOrderResultMonthlySalesComparisonRow[];
  monthlyCommercialMargin: SalesOrderResultMonthlyRow[];
  computedAt: string;
  computeDurationMs: number | null;
};

/**
 * Anos de cache invalidados por pedidos com estes anos de emissão.
 * Cada ano afetado invalida a si mesmo e ao ano seguinte (YoY).
 * `maxYear` limita o horizonte (não faz sentido invalidar além do próximo ano
 * visível na tela — hoje a UI oferece até o ano corrente).
 */
export function resolveSalesOrderResultChartsCacheTargetYears(
  issueYears: readonly number[],
  maxYear: number
): number[] {
  const targets = new Set<number>();
  for (const year of issueYears) {
    if (!Number.isInteger(year) || year < 2000 || year > maxYear) continue;
    targets.add(year);
    if (year + 1 <= maxYear) targets.add(year + 1);
  }
  return [...targets].sort((a, b) => a - b);
}
