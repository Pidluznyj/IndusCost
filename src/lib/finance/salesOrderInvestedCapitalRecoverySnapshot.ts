/**
 * FIN-11b — Snapshot por Pedido de Venda da Recuperação do Dinheiro
 * Investido. Função PURA: recebe dados já carregados em lote (custo
 * industrial oficial, imposto da margem comercial, títulos AR reais já
 * vinculados ao Pedido) e monta o snapshot analítico — nenhuma leitura de
 * banco, nenhuma regra de negócio nova além da matemática de
 * `salesOrderInvestedCapitalRecoveryMath.ts`.
 *
 * Autoridade do capital investido: `investedCapital` = custo industrial
 * oficial do Pedido (`SalesOrderIndustrialResultReportRow.totalIndustrialCost`)
 * + imposto usado no cálculo da margem comercial do Pedido de Venda (mesmo
 * motor da listagem de Pedidos de Venda). Decisão de negócio: o imposto
 * também foi desembolsado antecipadamente, como o custo, e só é recuperado
 * com prazo junto do recebimento — por isso entra no capital investido. A
 * soma é feita pelo chamador (`salesOrderInvestedCapitalRecoveryService.server.ts`)
 * ANTES de chegar aqui — esta função recebe `investedCapital` já pronto e só
 * ecoa `totalTaxes`/`taxSourceLabel` para exibição (não os soma de novo).
 * NUNCA o custo comercial (`pricingMargin.totalCost`), que continua sendo
 * autoridade só do contexto de formação de preço/margem. Ver
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
  computeCapitalReceivableCovered,
  computeCapitalWithoutOpenReceivable,
  computeEconomicMargin,
  computeGainReceivable,
  computeInvestedCapitalRecoveryStatus,
  computeMoneyOnStreet,
  computePotentialResult,
  computeRealizedGain,
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
  /** `SalesOrder.customerId`. Null agrupa em "Cliente não identificado". */
  customerId?: string | null;
  issueDate?: string | null;
  customerName: string | null;
  sellerName: string | null;
  saleValue: number;
  /**
   * Valor fiscal comparável do pedido (`nfeTotalValue` do contexto oficial de
   * NF-e). 0 = pedido sem faturamento resolvido. Não é recalculado aqui.
   */
  invoicedValue?: number | null;
  /**
   * null quando o custo industrial não pôde ser resolvido para este Pedido
   * (SEM_CUSTO/dados incompletos). JÁ INCLUI o imposto da margem comercial
   * (custo industrial + imposto) — somado pelo chamador antes de chegar
   * aqui, ver cabeçalho do arquivo.
   */
  investedCapital: number | null;
  investedCapitalUnavailableReason: string | null;
  orderStatus: string;
  orderStatusLabel: string;
  /** Todos os CR reais (não previsão) já vinculados a este Pedido. */
  realReceivables: readonly InvestedCapitalRecoveryRealReceivableInput[];
  /**
   * Componente de custo puro de `investedCapital` (sem o imposto) — o
   * chamador já garante `industrialCost + totalTaxes === investedCapital`
   * por construção (`resolveInvestedCapitalComponents`: imposto levado a
   * centavos ANTES da subtração sobre o capital já arredondado, nunca dois
   * arredondamentos independentes), para os KPIs de totais reconciliarem
   * exatamente na tela.
   */
  industrialCost: number | null;
  /**
   * Imposto usado no cálculo da margem comercial do Pedido de Venda (mesmo
   * motor da listagem de Pedidos de Venda) — já somado a `investedCapital`
   * pelo chamador; aqui é só ecoado para exibição lado a lado ("como estão,
   * com base em custo + imposto").
   */
  totalTaxes: number | null;
  taxSourceLabel: string | null;
};

export type SalesOrderInvestedCapitalRecoverySnapshot = {
  salesOrderId: string;
  orderCode: string;
  customerId: string | null;
  issueDate: string | null;
  customerName: string | null;
  sellerName: string | null;
  saleValue: number;
  /** Faturado fiscal comparável do pedido. Não é join com CR nem com item. */
  invoicedValue: number;
  investedCapital: number | null;
  investedCapitalSource: "INDUSTRIAL_RESULT";
  investedCapitalUnavailableReason: string | null;
  actualReceived: number;
  outstandingReceivable: number;
  capitalRecovered: number | null;
  moneyOnStreet: number | null;
  /** MAX(recebido − capital, 0) deste pedido. Null sem capital válido. */
  realizedGain: number | null;
  /** Faturado − capital integral deste pedido. Null sem capital válido. */
  potentialResult: number | null;
  /** saleValue − investedCapital (pode ser negativa). Null sem capital válido. */
  economicMargin: number | null;
  /** MIN(CR real aberto, capital na rua): parte do CR aberto que ainda é retorno de capital. Null sem capital válido. */
  capitalReceivableCovered: number | null;
  /** MAX(CR real aberto − capital na rua, 0): parte do CR aberto que já é ganho. Null sem capital válido. */
  gainReceivable: number | null;
  /** MAX(capital na rua − CR real aberto, 0): capital exposto sem CR aberto que o cubra. Null sem capital válido. */
  capitalWithoutOpenReceivable: number | null;
  recoveryPercent: number | null;
  status: InvestedCapitalRecoveryStatus;
  capitalRecoveryDate: string | null;
  forecastCapitalRecoveryDate: string | null;
  forecastSource: InvestedCapitalRecoveryForecastSource;
  orderStatus: string;
  orderStatusLabel: string;
  /** Agenda de CR real em aberto vinculada a este Pedido — usada para aging. */
  openRealReceivableEvents: InvestedCapitalRecoveryEvent[];
  /** Componente de custo puro — ver comentário no input; industrialCost + totalTaxes === investedCapital. */
  industrialCost: number | null;
  /** Imposto usado na margem comercial — já somado a `investedCapital`, ver comentário no input. */
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

  // Capital e venda já em centavos ANTES de qualquer conta — assim todas as
  // identidades (capital = recuperado + na rua, venda = capital + margem, …)
  // fecham exatamente com os valores ecoados no snapshot.
  const investedCapital = input.investedCapital == null ? null : roundMoney(input.investedCapital);
  const saleValue = roundMoney(input.saleValue);
  const capitalRecovered = computeCapitalRecovered(investedCapital, actualReceived);
  const moneyOnStreet = computeMoneyOnStreet(investedCapital, actualReceived);
  const realizedGain = computeRealizedGain(investedCapital, actualReceived);
  const invoicedValue = roundMoney(
    input.invoicedValue != null && Number.isFinite(input.invoicedValue) ? input.invoicedValue : 0
  );
  const potentialResult = computePotentialResult(investedCapital, invoicedValue);
  const economicMargin = computeEconomicMargin(saleValue, investedCapital);
  const capitalReceivableCovered = computeCapitalReceivableCovered(
    investedCapital,
    moneyOnStreet,
    outstandingReceivable
  );
  const gainReceivable = computeGainReceivable(investedCapital, moneyOnStreet, outstandingReceivable);
  const capitalWithoutOpenReceivable = computeCapitalWithoutOpenReceivable(
    investedCapital,
    moneyOnStreet,
    outstandingReceivable
  );
  const recoveryPercent = computeRecoveryPercent(investedCapital, actualReceived);
  const status = computeInvestedCapitalRecoveryStatus(investedCapital, capitalRecovered);
  const capitalRecoveryDate = resolveCapitalRecoveryDate(investedCapital, settledEvents);
  const forecastCapitalRecoveryDate = resolveForecastCapitalRecoveryDate(
    investedCapital,
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
    customerId: input.customerId?.trim() ? input.customerId.trim() : null,
    issueDate: input.issueDate ?? null,
    customerName: input.customerName,
    sellerName: input.sellerName,
    saleValue,
    invoicedValue,
    investedCapital,
    investedCapitalSource: "INDUSTRIAL_RESULT",
    investedCapitalUnavailableReason: investedCapital == null ? input.investedCapitalUnavailableReason : null,
    actualReceived,
    outstandingReceivable,
    capitalRecovered,
    moneyOnStreet,
    realizedGain,
    potentialResult,
    economicMargin,
    capitalReceivableCovered,
    gainReceivable,
    capitalWithoutOpenReceivable,
    recoveryPercent,
    status,
    capitalRecoveryDate,
    forecastCapitalRecoveryDate,
    forecastSource,
    orderStatus: input.orderStatus,
    orderStatusLabel: input.orderStatusLabel,
    openRealReceivableEvents: openEvents,
    industrialCost: input.industrialCost == null ? null : roundMoney(input.industrialCost),
    totalTaxes: input.totalTaxes == null ? null : roundMoney(input.totalTaxes),
    taxSourceLabel: input.taxSourceLabel,
  };
}
