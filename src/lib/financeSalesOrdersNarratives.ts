import type { FinanceSalesOrdersDashboardPayload } from "./financeSalesOrdersDashboardTypes.js";

export function buildFinanceSalesOrdersMonthlyComparisonNarrative(
  payload: FinanceSalesOrdersDashboardPayload
): string {
  const ytdGrowth = payload.summary.ytdGrowthPercent;
  if (ytdGrowth != null && ytdGrowth > 5) {
    return "Os pedidos de venda estão acima do mesmo período do ano anterior, indicando crescimento da carteira comercial.";
  }
  if (ytdGrowth != null && ytdGrowth < -5) {
    return "Os pedidos de venda estão abaixo do mesmo período do ano anterior; vale acompanhar a conversão comercial até o fechamento.";
  }
  return "O gráfico compara o valor vendido em pedidos mês a mês entre o ano atual e o anterior.";
}

export function buildFinanceSalesOrdersProjectionNarrative(
  payload: FinanceSalesOrdersDashboardPayload
): string {
  const projected = payload.summary.monthProjectedAmount;
  const target = payload.summary.monthTargetAmount;
  if (projected != null && target != null && projected < target * 0.95) {
    return "A projeção do mês está abaixo da meta, exigindo atenção à conversão de pedidos até o fechamento.";
  }
  if (projected != null && target != null && projected >= target) {
    return "A projeção indica que o ritmo atual é suficiente para atingir ou superar a meta do mês.";
  }
  return "A projeção mostra se o ritmo atual de pedidos é suficiente para atingir o resultado esperado até o fim do mês.";
}

export function buildFinanceSalesOrdersPortfolioNarrative(
  payload: FinanceSalesOrdersDashboardPayload
): string {
  const { openPortfolioCount, overdueOpenOrdersCount } = payload.summary;
  if (overdueOpenOrdersCount > 0) {
    return `Há ${overdueOpenOrdersCount} pedido(s) em atraso na carteira aberta; priorize faturamento e entrega dos compromissos vencidos.`;
  }
  if (openPortfolioCount > 0) {
    return "A carteira aberta mostra pedidos válidos ainda sem NF processada — volume que ainda pode entrar no faturamento.";
  }
  return "Não há carteira aberta relevante no filtro atual.";
}

export function buildFinanceSalesOrdersTopCustomersNarrative(
  payload: FinanceSalesOrdersDashboardPayload
): string {
  if (payload.topCustomers.length === 0) {
    return "Sem clientes com pedidos no período filtrado.";
  }
  const top = payload.topCustomers[0];
  if ((top?.sharePercent ?? 0) > 40) {
    return `A concentração em ${top?.customerName} é relevante; acompanhe dependência comercial do principal cliente.`;
  }
  return "Os principais clientes por valor de pedidos ajudam a identificar concentração e oportunidades na carteira.";
}

export function assertFinanceSalesOrdersNarrativeFinite(text: string): boolean {
  return !text.includes("NaN") && !text.includes("Infinity");
}
