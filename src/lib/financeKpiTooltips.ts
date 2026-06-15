/** Textos negociais dos tooltips dos KPIs executivos financeiros. */

export const FINANCE_KPI_BILLING_NET_REVENUE =
  "Total líquido de NF-e autorizadas dentro do período filtrado. Usa a fonte fiscal NF-e e respeita os filtros aplicados de ano, mês, cliente, empresa e status, quando disponíveis." as const;

export const FINANCE_KPI_BILLING_GROSS_FOUND =
  "Valor bruto total encontrado na auditoria fiscal. Pode incluir documentos analisados para conferência e não necessariamente representa o faturamento líquido gerencial." as const;

export const FINANCE_KPI_BILLING_NFE_COUNT =
  "Quantidade de notas fiscais eletrônicas autorizadas no período filtrado, conforme a fonte fiscal NF-e." as const;

export const FINANCE_KPI_BILLING_TICKET_AVG =
  "Faturamento líquido dividido pela quantidade de NF-e autorizadas no período filtrado." as const;

export const FINANCE_KPI_BILLING_FORECAST =
  "Estimativa de faturamento para o mês com base em carteira e projeção. Complementa o realizado NF-e; não substitui o valor fiscal autorizado." as const;

export const FINANCE_KPI_BILLING_SAME_MONTH_PREV_YEAR =
  "Faturamento do mesmo mês filtrado, porém no ano anterior. Exemplo: se o filtro é Junho/2026, este card mostra Junho/2025." as const;

export const FINANCE_KPI_BILLING_DELTA_VS_PREV_YEAR =
  "Diferença entre o faturamento do período selecionado e o mesmo período do ano anterior." as const;

export const FINANCE_KPI_BILLING_VARIATION_VS_PREV_YEAR =
  "Percentual de crescimento ou queda em relação ao mesmo período do ano anterior. Se não houver base comparativa, a variação fica sem base." as const;

export const FINANCE_KPI_BILLING_YTD_CURRENT =
  "Faturamento acumulado do ano selecionado até o período considerado. YTD significa Year to Date, ou acumulado do ano. Respeita o ano selecionado, mas não o mês nem filtros avançados de NF-e." as const;

export const FINANCE_KPI_BILLING_YTD_PREVIOUS =
  "Faturamento acumulado do ano anterior usado como base comparativa para o YTD do ano selecionado." as const;

export const FINANCE_KPI_BILLING_YTD_DELTA =
  "Diferença entre o acumulado do ano selecionado e o acumulado do ano anterior no mesmo recorte YTD." as const;

export const FINANCE_KPI_BILLING_YTD_VARIATION =
  "Percentual de crescimento ou queda do YTD em relação ao acumulado do ano anterior. Se não houver base comparativa, a variação fica sem base." as const;

export const FINANCE_KPI_AP_TOTAL_PAYABLE =
  "Soma do valor original dos títulos no universo filtrado. Respeita filtros de ano, mês, fornecedor, empresa e status aplicados na tela." as const;

export const FINANCE_KPI_AP_PAID_THIS_MONTH =
  "Pagamentos registrados no mês calendário atual (mês/ano de hoje), dentre os títulos que passam pelo filtro. Não usa o filtro de vencimento como referência temporal." as const;

export const FINANCE_KPI_AP_OPEN =
  "Saldo em aberto na visão gerencial: títulos com saldo positivo após filtros. Exclui agendas de pedido de compra da visão gerencial." as const;

export const FINANCE_KPI_AP_OVERDUE =
  "Títulos em aberto cuja data operacional é menor que hoje. A data operacional usa a maior data entre vencimento original e agendamento. Agendas de pedido de compra são excluídas da visão gerencial." as const;

export const FINANCE_KPI_AP_DUE_TODAY =
  "Títulos em aberto cuja data operacional é hoje. Usa a maior data entre vencimento original e agendamento, excluindo pedidos de compra da visão gerencial." as const;

export const FINANCE_KPI_AP_DUE_7_DAYS =
  "Saldo em aberto com data operacional entre hoje e os próximos 7 dias. Respeita filtros aplicados e a regra operacional gerencial." as const;

export const FINANCE_KPI_AP_DUE_30_DAYS =
  "Saldo em aberto com data operacional entre hoje e os próximos 30 dias. Respeita filtros aplicados e a regra operacional gerencial." as const;

export const FINANCE_KPI_AP_SCHEDULED =
  "Títulos com data de agendamento diferente do vencimento original. Eles ajudam a explicar valores remarcados e obrigações que não devem ser tratadas apenas pelo vencimento original." as const;

export const FINANCE_KPI_AP_TOP_SUPPLIER =
  "Fornecedor com maior concentração de saldo em aberto na carteira filtrada. Respeita os filtros aplicados na tela." as const;

export const FINANCE_KPI_AR_TOTAL_RECEIVABLE =
  "Soma do valor original dos títulos no universo filtrado. Respeita filtros de ano, mês, cliente, empresa e status aplicados na carteira." as const;

export const FINANCE_KPI_AR_RECEIVED =
  "Total de valores já recebidos (baixas) dentre os títulos que passam pelo filtro aplicado." as const;

export const FINANCE_KPI_AR_OPEN =
  "Saldo em aberto na carteira: soma dos saldos positivos após os filtros aplicados." as const;

export const FINANCE_KPI_AR_OVERDUE =
  "Títulos em aberto cujo vencimento é anterior a hoje, respeitando os filtros aplicados na carteira de recebíveis." as const;

export const FINANCE_KPI_AR_DUE_TODAY =
  "Saldo em aberto com vencimento no dia atual, dentro dos filtros aplicados." as const;

export const FINANCE_KPI_AR_DUE_7_DAYS =
  "Saldo em aberto com vencimento entre hoje e os próximos 7 dias, respeitando os filtros da carteira." as const;

export const FINANCE_KPI_AR_DUE_30_DAYS =
  "Saldo em aberto com vencimento entre hoje e os próximos 30 dias, respeitando os filtros da carteira." as const;

export const FINANCE_KPI_AR_DELINQUENCY =
  "Taxa de inadimplência: percentual do vencido sobre a carteira em aberto. Quanto maior, maior a exposição a recebíveis em atraso." as const;

const HORIZON_AP_BASE =
  "Soma dos títulos em aberto com data operacional nesta janela. A data operacional usa a maior data entre vencimento original e agendamento. Pedidos de compra são excluídos da visão gerencial." as const;

const HORIZON_AR_BASE =
  "Soma dos títulos a receber em aberto com vencimento dentro desta janela futura. Ajuda a projetar entrada de caixa nos próximos 60 dias." as const;

const HORIZON_BILLING_BASE =
  "Pedidos em carteira com previsão de faturamento nesta janela, usando SalesOrder.expectedDeliveryDate. Não representa NF-e já emitida." as const;

function horizonBucketTooltip(base: string, rangeLabel: string): string {
  return `${base} Faixa: ${rangeLabel}.`;
}

export const FINANCE_HORIZON_TOTAL_TOOLTIP =
  "Soma das janelas de 0 a 60 dias. As faixas individuais são não acumulativas." as const;

export const FINANCE_HORIZON_AP_BUCKET_TOOLTIPS = {
  "0_7": horizonBucketTooltip(
    "Títulos a pagar em aberto com data operacional entre hoje e os próximos 7 dias. A data operacional considera a maior data entre vencimento e agendamento.",
    "0–7 dias"
  ),
  "8_15": horizonBucketTooltip(HORIZON_AP_BASE, "8–15 dias"),
  "16_30": horizonBucketTooltip(HORIZON_AP_BASE, "16–30 dias"),
  "31_45": horizonBucketTooltip(HORIZON_AP_BASE, "31–45 dias"),
  "46_60": horizonBucketTooltip(HORIZON_AP_BASE, "46–60 dias"),
} as const;

export const FINANCE_HORIZON_AR_BUCKET_TOOLTIPS = {
  "0_7": horizonBucketTooltip(
    "Títulos a receber em aberto com vencimento entre hoje e os próximos 7 dias.",
    "0–7 dias"
  ),
  "8_15": horizonBucketTooltip(HORIZON_AR_BASE, "8–15 dias"),
  "16_30": horizonBucketTooltip(HORIZON_AR_BASE, "16–30 dias"),
  "31_45": horizonBucketTooltip(HORIZON_AR_BASE, "31–45 dias"),
  "46_60": horizonBucketTooltip(HORIZON_AR_BASE, "46–60 dias"),
} as const;

export const FINANCE_KPI_CF_RECEIVED_YTD =
  "Soma dos valores recebidos em Contas a Receber no ano selecionado, usando a data de liquidação (settlementDate). Fórmula: SUM(amountReceived) de 01/01 até a data de corte. Não usa vencimento nem valor nominal. Respeita filtros de empresa, cliente, origem Com NF/Sem NF e demais filtros de AR." as const;

export const FINANCE_KPI_CF_OPEN_AR_TO_YEAR_END =
  "Soma dos saldos em aberto (balanceReceivable) com vencimento entre hoje e 31/12 do ano selecionado. Fórmula: SUM(balanceReceivable) por dueDate. Não inclui títulos liquidados. Respeita origem Com NF/Sem NF e filtros de AR." as const;

export const FINANCE_KPI_CF_ESTIMATED_AR_YEAR =
  "Estimativa total de entradas do ano: Recebido YTD + saldo em aberto a receber até 31/12. Fórmula: Recebido YTD + A receber até fim do ano." as const;

export const FINANCE_KPI_CF_PAID_YTD =
  "Soma dos valores realizados em Contas a Pagar no ano selecionado, usando a data efetiva saneada (pagamento/liquidação; baixas sem numerário ou forçadas usam vencimento). Fórmula: SUM(realizedAmount) de 01/01 até a data de corte. Respeita filtros de empresa, fornecedor e demais filtros de AP." as const;

export const FINANCE_KPI_CF_OPEN_AP_TO_YEAR_END =
  "Soma dos saldos em aberto saneados (openAmount) com vencimento entre hoje e 31/12 do ano selecionado. Fórmula: SUM(openAmount) por dueDate. Não inclui títulos baixados nem baixas especiais." as const;

export const FINANCE_KPI_CF_PERIOD_OUTFLOW =
  "Saídas do período filtrado, conforme modo e filtros aplicados. Fonte: Contas a Pagar com regra saneada (baixas sem numerário/forçadas posicionadas pelo vencimento)." as const;

export const FINANCE_KPI_CF_ESTIMATED_AP_YEAR =
  "Estimativa total de saídas do ano: Pago YTD + saldo em aberto a pagar até 31/12. Fórmula: Pago YTD + A pagar até fim do ano." as const;

export const FINANCE_KPI_CF_REALIZED_YTD =
  "Saldo de caixa realizado no ano: Recebido YTD − Pago YTD. Reflete liquidações efetivas, não faturamento." as const;

export const FINANCE_KPI_CF_PROJECTED_REMAINING =
  "Saldo projetado do restante do ano: A receber até 31/12 − A pagar até 31/12. Mede o fluxo futuro esperado dentro do ano." as const;

export const FINANCE_KPI_CF_ESTIMATED_YEAR_NET =
  "Estimativa líquida anual: Estimativa AR do ano − Estimativa AP do ano. Principal indicador de caixa previsto para o ano." as const;

export const FINANCE_KPI_CF_PERIOD_INFLOW =
  "Entradas do período filtrado (mês ou ano), conforme modo Previsto/Realizado/Combinado e filtros aplicados. Fonte: Contas a Receber." as const;

export const FINANCE_KPI_CF_PERIOD_NET =
  "Saldo líquido do período filtrado: Entradas − Saídas. Independente da visão anual/YTD acima." as const;

export const FINANCE_HORIZON_BILLING_BUCKET_TOOLTIPS = {
  "0_7": horizonBucketTooltip(
    "Pedidos em carteira com previsão de faturamento entre hoje e os próximos 7 dias, usando a melhor data operacional disponível.",
    "0–7 dias"
  ),
  "8_15": horizonBucketTooltip(HORIZON_BILLING_BASE, "8–15 dias"),
  "16_30": horizonBucketTooltip(HORIZON_BILLING_BASE, "16–30 dias"),
  "31_45": horizonBucketTooltip(HORIZON_BILLING_BASE, "31–45 dias"),
  "46_60": horizonBucketTooltip(HORIZON_BILLING_BASE, "46–60 dias"),
} as const;
