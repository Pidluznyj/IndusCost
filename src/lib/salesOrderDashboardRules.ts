/** Regras puras do dashboard gerencial de pedidos/faturamento — testáveis sem banco. */

export const SALES_ORDER_CANCELLED_STATUS = "CANCELLED" as const;
/** Meta default = ano/mês anterior × 1,20 (+20%). */
export const TARGET_GROWTH_FACTOR = 1.2;

/** Rótulo curto do fator (ex.: "+20%"). */
export function formatTargetGrowthRateLabel(
  factor: number = TARGET_GROWTH_FACTOR
): string {
  if (!Number.isFinite(factor)) return "+0%";
  return `+${Math.round((factor - 1) * 100)}%`;
}

/** Fator em pt-BR com 2 casas (ex.: "1,20"). */
export function formatTargetGrowthFactorPtBr(
  factor: number = TARGET_GROWTH_FACTOR
): string {
  if (!Number.isFinite(factor)) return "0,00";
  return factor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function isCancelledSalesOrderStatus(status: string): boolean {
  return status === SALES_ORDER_CANCELLED_STATUS;
}

/** Carteira aberta e atrasados: pedido faturado quando existe nfes.dataProcessamento. */
export function isSalesOrderInvoiced(hasNfeDataProcessamento: boolean): boolean {
  return hasNfeDataProcessamento;
}

/** Pedido atrasado = entrega prevista vencida, não cancelado, sem NF processada. */
export function isOverdueSalesOrder(input: {
  status: string;
  expectedDeliveryDate: Date | null;
  today: Date;
  hasNfeDataProcessamento: boolean;
}): boolean {
  if (isCancelledSalesOrderStatus(input.status)) return false;
  if (isSalesOrderInvoiced(input.hasNfeDataProcessamento)) return false;
  if (!input.expectedDeliveryDate) return false;
  const deliveryDay = new Date(
    input.expectedDeliveryDate.getFullYear(),
    input.expectedDeliveryDate.getMonth(),
    input.expectedDeliveryDate.getDate()
  );
  const todayDay = new Date(input.today.getFullYear(), input.today.getMonth(), input.today.getDate());
  return deliveryDay < todayDay;
}

export const EXECUTIVE_OVERDUE_ORDERS_HINT =
  "Pedidos de mercado emitidos no ano selecionado (3 empresas, sem intercompany), não cancelados, com entrega prevista vencida e sem NF processada.";

/** Pedido atrasado no dashboard = critério base + issueDate no ano selecionado. */
export function isOverdueSalesOrderInSelectedYear(input: {
  status: string;
  issueDate: Date;
  selectedYear: number;
  expectedDeliveryDate: Date | null;
  today: Date;
  hasNfeDataProcessamento: boolean;
}): boolean {
  if (input.issueDate.getFullYear() !== input.selectedYear) return false;
  return isOverdueSalesOrder({
    status: input.status,
    expectedDeliveryDate: input.expectedDeliveryDate,
    today: input.today,
    hasNfeDataProcessamento: input.hasNfeDataProcessamento,
  });
}

export function computeDaysOverdue(expectedDeliveryDate: Date, today: Date): number {
  const deliveryDay = new Date(
    expectedDeliveryDate.getFullYear(),
    expectedDeliveryDate.getMonth(),
    expectedDeliveryDate.getDate()
  );
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffMs = todayDay.getTime() - deliveryDay.getTime();
  return diffMs > 0 ? Math.floor(diffMs / (24 * 60 * 60 * 1000)) : 0;
}

export function computeGrowthTarget(previousValue: number | null): number | null {
  if (previousValue == null || !Number.isFinite(previousValue)) return null;
  return previousValue * TARGET_GROWTH_FACTOR;
}

export function computeAchievementPercent(actual: number | null, target: number | null): number | null {
  if (actual == null || target == null || !Number.isFinite(actual) || !Number.isFinite(target)) return null;
  if (target <= 0) return actual > 0 ? 100 : 0;
  return (actual / target) * 100;
}

export function computeTargetGap(actual: number | null, target: number | null): number | null {
  if (actual == null || target == null || !Number.isFinite(actual) || !Number.isFinite(target)) return null;
  return target - actual;
}

export function computeRealizedMinusTarget(
  actual: number | null,
  target: number | null
): number | null {
  if (actual == null || target == null || !Number.isFinite(actual) || !Number.isFinite(target)) return null;
  return actual - target;
}

export function computeTicketAverage(totalValue: number | null, orderCount: number | null): number | null {
  if (orderCount == null || totalValue == null) return null;
  if (orderCount <= 0) return 0;
  if (!Number.isFinite(totalValue)) return null;
  return totalValue / orderCount;
}

export function computeDailyAverageByWorkday(
  totalValue: number | null,
  workdaysElapsed: number
): number | null {
  if (totalValue == null || !Number.isFinite(totalValue)) return null;
  if (workdaysElapsed <= 0) return null;
  return totalValue / workdaysElapsed;
}

/** Projeção linear do mês = média diária YTD × dias úteis totais do mês. */
export function computeMonthProjection(
  dailyAverageYtd: number | null,
  workdaysInMonth: number
): number | null {
  if (dailyAverageYtd == null || !Number.isFinite(dailyAverageYtd)) return null;
  if (workdaysInMonth <= 0) return null;
  return dailyAverageYtd * workdaysInMonth;
}

/** Projeção anual = média diária YTD × total de dias úteis do ano selecionado. */
export function computeYearProjection(
  dailyAverageYtd: number | null,
  workdaysInYear: number
): number | null {
  return computeMonthProjection(dailyAverageYtd, workdaysInYear);
}

/** Média diária YTD = total YTD ÷ dias úteis decorridos no ano (seg–sex). */
export function computeYtdDailyAverageByWorkday(
  totalYtdValue: number | null,
  workdaysElapsedInYear: number
): number | null {
  return computeDailyAverageByWorkday(totalYtdValue, workdaysElapsedInYear);
}

export const EXECUTIVE_SALES_YTD_DAILY_AVERAGE_HINT =
  "Média dos pedidos de mercado das 3 empresas (sem intercompany) no ano selecionado até hoje, divididos pelos dias úteis decorridos.";

export const EXECUTIVE_BILLING_YTD_DAILY_AVERAGE_HINT =
  "Média calculada com faturamento de mercado do ano selecionado até hoje, divididos pelos dias úteis decorridos no ano.";

export const EXECUTIVE_ANNUAL_TARGET_HINT =
  "Meta anual = total de pedidos de mercado (3 empresas do grupo, sem intercompany) do ano anterior completo × 1,20.";

export const EXECUTIVE_MONTHLY_TARGET_HINT =
  "Meta mensal = mesmo mês do ano anterior (pedidos de mercado das 3 empresas, sem intercompany), acrescida de 20%.";

export const EXECUTIVE_REALIZED_HINT =
  "Valor real de pedidos de venda emitidos no período pelas 3 empresas do grupo, excluindo cancelados e movimentações intercompany.";

export const EXECUTIVE_PROJECTION_HINT =
  "Projeção calculada usando a média diária YTD por dia útil, aplicada aos dias úteis do período projetado.";

export const EXECUTIVE_TARGET_GAP_HINT =
  "Diferença entre o realizado e a meta do período. Valor positivo indica superação da meta; negativo indica distância para atingir a meta.";

export const EXECUTIVE_ACHIEVEMENT_HINT =
  "Percentual do realizado em relação à meta definida para o período.";

export function isOpenPortfolioOrder(input: {
  status: string;
  hasNfeDataProcessamento: boolean;
}): boolean {
  if (isCancelledSalesOrderStatus(input.status)) return false;
  return !isSalesOrderInvoiced(input.hasNfeDataProcessamento);
}
