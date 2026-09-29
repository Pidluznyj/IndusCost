/** Textos negociais dos tooltips dos KPIs executivos financeiros. */

export const FINANCE_KPI_BILLING_NET_REVENUE =
  "Total líquido de NF-e autorizadas dentro do período filtrado. Usa a fonte fiscal NF-e e respeita os filtros aplicados de ano, mês, cliente, empresa e status, quando disponíveis." as const;

export const FINANCE_KPI_BILLING_GROSS_FOUND =
  "Faturamento líquido acumulado do ano selecionado com NF-e autorizadas de mercado. O detalhe de auditoria (bruto encontrado, exclusões e lacunas) fica na aba Auditoria e no drawer de conferência." as const;

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
  "Pagamentos realizados no mês calendário atual, dentre os títulos da carteira filtrada por vencimento. Distinto do KPI Pago, que usa a data efetiva de pagamento no período aplicado." as const;

export const FINANCE_KPI_AP_PAID =
  "Dinheiro efetivamente pago no recorte temporal aplicado, pela data efetiva canônica de pagamento. Ano sem mês usa YTD (01/01 até a data-base no ano corrente). Não usa vencimento para decidir em qual período o pagamento ocorreu." as const;

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
  "Dinheiro efetivamente recebido no recorte temporal aplicado, pela data de baixa (settlementDate). Ano sem mês usa YTD (01/01 até a data-base no ano corrente). Não usa vencimento para decidir em qual período o recebimento ocorreu." as const;

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
  "Soma dos valores recebidos em Contas a Receber no ano selecionado, alocados pela data de baixa (settlementDate). Fórmula: SUM(amountReceived) de 01/01 até a data de corte, após saneamento gerencial." as const;

export const FINANCE_KPI_CF_OPEN_AR_TO_YEAR_END =
  "Saldo AR aberto com vencimento de hoje até 31/12 do ano selecionado. Ignora filtro de mês. Fórmula: SUM(balanceReceivable) por dueDate no intervalo futuro. Não inclui vencidos anteriores à data-base nem títulos liquidados." as const;

export const FINANCE_KPI_CF_ESTIMATED_AR_YEAR =
  "Estimativa gerencial do ano: Recebido YTD (baixa/settlementDate) + saldo aberto a vencer até 31/12 (dueDate). Fórmula oficial: receivedYtd + openUntilYearEnd." as const;

export const FINANCE_KPI_CF_PAID_YTD =
  "Saída de caixa de Contas a Pagar no ano selecionado: soma do valor pago informado (amountPaid) pela data efetiva canônica de pagamento, de 01/01 até a data de corte. Baixas sem numerário, baixas forçadas e quitações sem valor pago informado não entram (encerram o título, mas não são caixa). Eixo por data de pagamento — por isso pode diferir da soma mensal da Linha do tempo, que é por vencimento. Respeita filtros gerenciais de AP." as const;

export const FINANCE_KPI_CF_AP_OVERDUE_OPEN =
  "Títulos de Contas a Pagar ainda em aberto com vencimento operacional anterior à data-base, dentro do ano selecionado. Continuam alocados na dueDate original (eixo oficial AP) — não são deslocados para o mês atual, mas seguem sendo obrigação de caixa." as const;

export const FINANCE_KPI_CF_OPEN_AP_TO_YEAR_END =
  "Títulos de Contas a Pagar ainda em aberto com vencimento entre a data-base (inclusive) e 31/12 do ano selecionado. Não inclui valores vencidos antes da data-base. Ignora filtro de mês — distinto de Saídas do período. Fórmula: SUM(openAmount) por vencimento operacional no intervalo data-base → 31/12." as const;

export const FINANCE_KPI_CF_AP_OPEN_REMAINING =
  "Obrigações de Contas a Pagar ainda em aberto no ano: vencidos antes da data-base + vencendo na data-base + a vencer até 31/12. Fórmula: Vencido em aberto + A vencer até 31/12. Reconcilia com o Em aberto de Contas a Pagar no mesmo ano." as const;

export const FINANCE_KPI_CF_OPEN_AP_FORWARD_BREAKDOWN =
  "Composição do total ainda a pagar: vencido antes da data-base (alocado na dueDate original) + saldo a vencer mês a mês da data-base até 31/12. A soma dos meses iguala o card A vencer até 31/12; vencido + a vencer iguala Total ainda a pagar." as const;

export const FINANCE_KPI_CF_PERIOD_OUTFLOW =
  "Saídas do mês ou ano filtrado, conforme modo Previsto/Realizado/Combinado (realizado = caixa pago informado, sem baixas sem numerário; previsto = saldo aberto), alocadas por vencimento. Respeita filtro de mês. Distinto dos cards anuais A vencer até 31/12 e Total ainda a pagar (que ignoram o mês filtrado)." as const;

export const FINANCE_KPI_CF_ESTIMATED_AP_YEAR =
  "Estimativa total de saídas do ano: Pago YTD (caixa realizado) + total de obrigações ainda em aberto consideradas para o ano (vencidos + vencendo hoje + a vencer até 31/12). Fórmula: Pago YTD + Total ainda a pagar." as const;

export const FINANCE_KPI_CF_REALIZED_YTD =
  "Saldo de caixa realizado no ano: Recebido YTD − Pago YTD (caixa realizado, sem baixas sem numerário). Reflete liquidações efetivas, não faturamento." as const;

export const FINANCE_KPI_CF_PROJECTED_REMAINING =
  "Saldo projetado do restante do ano: A receber até 31/12 − Total ainda a pagar (inclui AP vencido em aberto). Mede o fluxo futuro esperado dentro do ano; Saldo realizado YTD + Saldo projetado restante = Estimativa líquida anual." as const;

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

/* Financeiro > Recuperação do Dinheiro Investido — decomposição econômica do PV. */

export const FINANCE_KPI_ICR_SOLD =
  "Soma do valor líquido comercial dos Pedidos de Venda da população filtrada. Não é NF-e, CR, valor recebido nem faturamento fiscal." as const;

export const FINANCE_KPI_ICR_INVESTED_CAPITAL =
  "Custo industrial oficial + imposto usado no cálculo da margem comercial do pedido, só nos pedidos com custo resolvido. É o dinheiro desembolsado antes de receber." as const;

export const FINANCE_KPI_ICR_INDUSTRIAL_COST =
  "Componente de custo industrial oficial do capital investido (sem o imposto). Custo industrial + imposto = capital investido, centavo a centavo." as const;

export const FINANCE_KPI_ICR_TAXES =
  "Imposto usado no cálculo da margem comercial do Pedido de Venda — já incluído no capital investido." as const;

export const FINANCE_KPI_ICR_COMPARABLE_SALE =
  "Venda só dos pedidos com capital válido — a mesma população do capital investido. Fecha: venda comparável = capital investido + margem econômica." as const;

export const FINANCE_KPI_ICR_SALE_UNRESOLVED_COST =
  "Venda dos pedidos sem custo industrial resolvido. Entra na venda total, mas nunca é classificada como capital ou margem. Fecha: venda total = venda comparável + venda sem custo resolvido." as const;

export const FINANCE_KPI_ICR_RECEIVED_TOTAL =
  "CR real baixado de todos os pedidos do filtro, inclusive os sem custo resolvido. Fecha: recebido total = recebido comparável + recebido não classificável." as const;

export const FINANCE_KPI_ICR_RECEIVED_UNCLASSIFIED =
  "Recebido dos pedidos sem custo resolvido: sem capital válido não há como dizer o que é retorno de capital e o que é ganho, então esta parcela fica fora de capital recuperado e ganho realizado." as const;

export const FINANCE_KPI_ICR_ECONOMIC_MARGIN =
  "Venda − capital investido, pedido a pedido, só nos pedidos com capital válido. Margem negativa continua visível. Não é lucro: não considera despesas estruturais, administrativas nem financeiras." as const;

export const FINANCE_KPI_ICR_INSUFFICIENT_DATA =
  "Pedidos sem custo industrial resolvido. Compõem a venda total, mas ficam fora da margem econômica, do capital e das decomposições — o problema não é escondido." as const;

export const FINANCE_KPI_ICR_CAPITAL_RECOVERED =
  "Parte do dinheiro efetivamente recebido (CR real baixado) que devolveu o capital, pedido a pedido: MIN(recebido, capital investido)." as const;

export const FINANCE_KPI_ICR_REALIZED_GAIN =
  "Parte do recebido que já excede o capital do pedido: MAX(recebido − capital investido, 0), pedido a pedido. Não é recebido total − capital total." as const;

export const FINANCE_KPI_ICR_RECEIVED_COMPARABLE =
  "Dinheiro efetivamente recebido (CR real baixado) dos pedidos com capital válido. Fecha: recebido = capital recuperado + ganho realizado." as const;

export const FINANCE_KPI_ICR_MONEY_ON_STREET =
  "Capital investido que ainda não voltou: MAX(capital investido − recebido, 0), pedido a pedido. Não é saldo a receber." as const;

export const FINANCE_KPI_ICR_OUTSTANDING =
  "Saldo dos CR reais em aberto vinculados aos pedidos da população filtrada — todos os pedidos, inclusive os sem custo resolvido." as const;

export const FINANCE_KPI_ICR_CAPITAL_RECEIVABLE_COVERED =
  "Parte do CR real em aberto que ainda é recuperação do capital investido: MIN(CR aberto, capital na rua), pedido a pedido." as const;

export const FINANCE_KPI_ICR_GAIN_RECEIVABLE =
  "Parte do CR real em aberto que excede o capital ainda exposto: MAX(CR aberto − capital na rua, 0), pedido a pedido. Pedido sem custo resolvido não entra — ausência de custo nunca vira ganho." as const;

export const FINANCE_KPI_ICR_CAPITAL_WITHOUT_OPEN_RECEIVABLE =
  "Capital na rua que ainda não está representado por CR real em aberto: MAX(capital na rua − CR aberto, 0), pedido a pedido." as const;

export const FINANCE_KPI_ICR_OUTSTANDING_UNCLASSIFIED =
  "CR real em aberto de pedidos sem custo resolvido — não pode ser separado em capital a recuperar e ganho a receber." as const;

export const FINANCE_KPI_ICR_AVERAGE_DAYS =
  "Prazo médio entre a saída do pedido e a recuperação do capital. Sem evidência canônica de data de saída/faturamento, fica indisponível — não é estimado." as const;
