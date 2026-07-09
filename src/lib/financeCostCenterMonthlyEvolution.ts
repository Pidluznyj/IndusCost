/**
 * Evolução mensal do centro de custo — motor server.
 *
 * Fonte de dados: reutiliza EXATAMENTE resolveCostCenterDetailFilteredRowsForCenters
 * (a mesma função/filtro-base da tabela de títulos do drilldown). Assim, a soma
 * anual do gráfico bate com o total da tabela no mesmo escopo. O único ajuste é
 * remover o filtro de mês para montar os 12 meses do ano, destacando o mês
 * filtrado, conforme especificação. Agrupamento sempre por data de vencimento.
 *
 * Helpers puros (client-safe): financeCostCenterMonthlyEvolution.shared.ts
 */
import {
  parseCostCenterDetailListQuery,
  resolveCostCenterDetailFilteredRowsForCenters,
} from "./financeCostCenterDetail.js";
import {
  buildCostCenterMonthlyEvolutionEmptyPayload,
  buildCostCenterMonthlyEvolutionPayload,
  type CostCenterMonthlyEvolutionPayload,
} from "./financeCostCenterMonthlyEvolution.shared.js";

export {
  buildCostCenterMonthlyEvolutionEmptyPayload,
  buildCostCenterMonthlyEvolutionPayload,
  buildCostCenterMonthlyEvolutionSummary,
  computeCostCenterMonthlyTrend,
  groupCostCenterAllocationByDueMonth,
  type CostCenterMonthlyEvolutionPayload,
  type CostCenterMonthlyEvolutionPoint,
  type CostCenterMonthlyEvolutionSummary,
} from "./financeCostCenterMonthlyEvolution.shared.js";

export async function loadCostCenterMonthlyEvolutionForCenters(
  costCenterIds: string[],
  query: ReturnType<typeof parseCostCenterDetailListQuery>,
  referenceDate: Date = new Date()
): Promise<CostCenterMonthlyEvolutionPayload> {
  const uniqueIds = [...new Set(costCenterIds.map((id) => id.trim()).filter(Boolean))];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { page, limit, sortBy, sortDirection, ...filters } = query;

  // Regra: não montar gráfico mensal sem contexto de ano (filtro "Todos").
  if (filters.year == null) {
    return buildCostCenterMonthlyEvolutionEmptyPayload(uniqueIds);
  }

  if (uniqueIds.length === 0) {
    return buildCostCenterMonthlyEvolutionPayload({
      rows: [],
      costCenterIds: uniqueIds,
      year: filters.year,
      highlightMonth: filters.month ?? null,
    });
  }

  // Mesma query-base da tabela; apenas remove o mês para gerar os 12 meses do ano.
  const monthlyFilters = { ...filters, month: undefined };
  const { rows } = await resolveCostCenterDetailFilteredRowsForCenters(
    uniqueIds,
    monthlyFilters,
    referenceDate
  );

  return buildCostCenterMonthlyEvolutionPayload({
    rows: rows.map((row) => ({ dueDate: row.dueDate, allocatedAmount: row.allocatedAmount })),
    costCenterIds: uniqueIds,
    year: filters.year,
    highlightMonth: filters.month ?? null,
  });
}

export async function loadCostCenterMonthlyEvolutionDefault(
  costCenterId: string,
  query: ReturnType<typeof parseCostCenterDetailListQuery>,
  referenceDate: Date = new Date()
): Promise<CostCenterMonthlyEvolutionPayload> {
  return loadCostCenterMonthlyEvolutionForCenters([costCenterId], query, referenceDate);
}
