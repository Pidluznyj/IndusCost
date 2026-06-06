/** Regras puras do dashboard gerencial de pedidos/faturamento — testáveis sem banco. */

export const SALES_ORDER_CANCELLED_STATUS = "CANCELLED" as const;
export const TARGET_GROWTH_FACTOR = 1.3;

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
  "Pedidos emitidos no ano selecionado, não cancelados, com entrega prevista vencida e sem NF processada.";

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
  "Média calculada com pedidos não cancelados do ano selecionado até hoje, divididos pelos dias úteis decorridos no ano.";

export const EXECUTIVE_BILLING_YTD_DAILY_AVERAGE_HINT =
  "Média calculada com faturamento de mercado do ano selecionado até hoje, divididos pelos dias úteis decorridos no ano.";

export function isOpenPortfolioOrder(input: {
  status: string;
  hasNfeDataProcessamento: boolean;
}): boolean {
  if (isCancelledSalesOrderStatus(input.status)) return false;
  return !isSalesOrderInvoiced(input.hasNfeDataProcessamento);
}
