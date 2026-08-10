/**
 * FIN-11b — Snapshot por Pedido de Venda da Recuperação do Dinheiro
 * Investido. Função PURA: recebe dados já carregados em lote (custo
 * industrial oficial, títulos AR reais já vinculados ao Pedido) e monta o
 * snapshot analítico — nenhuma leitura de banco, nenhuma regra de negócio
 * nova além da matemática de `salesOrderInvestedCapitalRecoveryMath.ts`.
 *
 * Autoridade do custo: `investedCapital` = custo industrial oficial do
 * Pedido (`SalesOrderIndustrialResultReportRow.totalIndustrialCost`),
 * decisão de negócio confirmada — NUNCA o custo comercial
 * (`pricingMargin.totalCost`), que continua sendo autoridade só do
 * contexto de formação de preço/margem. Ver
 * docs/finance/invested-capital-recovery.md.
 *
 * Escopo desta versão (documentado, não escondido): `forecastCapitalRecoveryDate`
 * e a distribuição de aging usam APENAS a agenda de CR real em aberto
 * vinculado ao Pedido — a hierarquia completa do FIN-05 (CR real > Documento
 * comprovado > previsão residual do Pedido ainda não faturado) não está
 * wireada nesta primeira entrega; um Pedido 100% pré-fatura (sem nenhum CR
 * real ainda) aparece com `forecastSource: "NONE"` em vez de "FORECAST_ONLY".
 */

import {
  computeCapitalRecovered,
  computeInvestedCapitalRecoveryStatus,
  computeMoneyOnStreet,
  computeRecoveryPercent,
  resolveCapitalRecoveryDate,
  resolveForecastCapitalRecoveryDate,
  resolveInvestedCapitalRecoveryForecastSource,
  type InvestedCapitalRecoveryEvent,
  type InvestedCapitalRecoveryForecastSource,
  type InvestedCapitalRecoveryStatus,
} from "./salesOrderInvestedCapitalRecoveryMath.js";

export type InvestedCapitalRecoveryRealReceivableInput = {
  externalId: number;
  dueDate: string | null;
  settlementDate: string | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
};

export type SalesOrderInvestedCapitalRecoveryOrderInput = {
  salesOrderId: string;
  orderCode: string;
  customerName: string | null;
  sellerName: string | null;
  saleValue: number;
  /** null quando o custo industrial não pôde ser resolvido para este Pedido (SEM_CUSTO/dados incompletos). */
  investedCapital: number | null;
  investedCapitalUnavailableReason: string | null;
  orderStatus: string;
  orderStatusLabel: string;
  /** Todos os CR reais (não previsão) já vinculados a este Pedido. */
  realReceivables: readonly InvestedCapitalRecoveryRealReceivableInput[];
  /**
   * Imposto total do Pedido — mesmo motor do Resultado Industrial (real via
   * NF vinculada, estimado via TaxRule, ou combinação). Puramente
   * informativo: NUNCA entra no cálculo de investedCapital/capitalRecovered/
   * moneyOnStreet — decisão de negócio já fechada (capital = custo de
   * FABRICAR o pedido). Exibido lado a lado para responder "como estão,
   * com base em custo E imposto".
   */
  totalTaxes: number | null;
  taxSourceLabel: string | null;
};

export type SalesOrderInvestedCapitalRecoverySnapshot = {
  salesOrderId: string;
  orderCode: string;
  customerName: string | null;
  sellerName: string | null;
  saleValue: number;
  investedCapital: number | null;
  investedCapitalSource: "INDUSTRIAL_RESULT";
  investedCapitalUnavailableReason: string | null;
  actualReceived: number;
  outstandingReceivable: number;
  capitalRecovered: number | null;
  moneyOnStreet: number | null;
  recoveryPercent: number | null;
  status: InvestedCapitalRecoveryStatus;
  capitalRecoveryDate: string | null;
  forecastCapitalRecoveryDate: string | null;
  forecastSource: InvestedCapitalRecoveryForecastSource;
  orderStatus: string;
  orderStatusLabel: string;
  /** Agenda de CR real em aberto vinculada a este Pedido — usada para aging. */
  openRealReceivableEvents: InvestedCapitalRecoveryEvent[];
  /** Imposto total do Pedido — só informativo, ver comentário no input. */
  totalTaxes: number | null;
  taxSourceLabel: string | null;
};

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildSalesOrderInvestedCapitalRecoverySnapshot(
  input: SalesOrderInvestedCapitalRecoveryOrderInput,
  todayCivilDate: string
): SalesOrderInvestedCapitalRecoverySnapshot {
  const settledEvents: InvestedCapitalRecoveryEvent[] = [];
  const openEvents: InvestedCapitalRecoveryEvent[] = [];
  let actualReceived = 0;
  let outstandingReceivable = 0;

  for (const r of input.realReceivables) {
    const received = Number.isFinite(r.amountReceived) ? r.amountReceived : 0;
    const balance = Number.isFinite(r.balanceReceivable) ? r.balanceReceivable : 0;
    actualReceived = roundMoney(actualReceived + Math.max(received, 0));
    outstandingReceivable = roundMoney(outstandingReceivable + Math.max(balance, 0));
    if (received > 0) {
      settledEvents.push({ civilDate: r.settlementDate, amount: roundMoney(received) });
    }
    if (balance > 0) {
      openEvents.push({ civilDate: r.dueDate, amount: roundMoney(balance) });
    }
  }

  const capitalRecovered = computeCapitalRecovered(input.investedCapital, actualReceived);
  const moneyOnStreet = computeMoneyOnStreet(input.investedCapital, actualReceived);
  const recoveryPercent = computeRecoveryPercent(input.investedCapital, actualReceived);
  const status = computeInvestedCapitalRecoveryStatus(input.investedCapital, capitalRecovered);
  const capitalRecoveryDate = resolveCapitalRecoveryDate(input.investedCapital, settledEvents);
  const forecastCapitalRecoveryDate = resolveForecastCapitalRecoveryDate(
    input.investedCapital,
    actualReceived,
    openEvents
  );
  const forecastSource = resolveInvestedCapitalRecoveryForecastSource({
    hasOpenRealReceivables: openEvents.length > 0,
    // FIN-05 completo (previsão residual ainda não faturada) não está
    // wireado nesta versão — ver cabeçalho do arquivo.
    hasResidualForecast: false,
  });

  return {
    salesOrderId: input.salesOrderId,
    orderCode: input.orderCode,
    customerName: input.customerName,
    sellerName: input.sellerName,
    saleValue: roundMoney(input.saleValue),
    investedCapital: input.investedCapital == null ? null : roundMoney(input.investedCapital),
    investedCapitalSource: "INDUSTRIAL_RESULT",
    investedCapitalUnavailableReason: input.investedCapital == null ? input.investedCapitalUnavailableReason : null,
    actualReceived,
    outstandingReceivable,
    capitalRecovered,
    moneyOnStreet,
    recoveryPercent,
    status,
    capitalRecoveryDate,
    forecastCapitalRecoveryDate,
    forecastSource,
    orderStatus: input.orderStatus,
    orderStatusLabel: input.orderStatusLabel,
    openRealReceivableEvents: openEvents,
    totalTaxes: input.totalTaxes == null ? null : roundMoney(input.totalTaxes),
    taxSourceLabel: input.taxSourceLabel,
  };
}
