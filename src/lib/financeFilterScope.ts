/** Rótulos de escopo de filtros — regra transversal do módulo Financeiro. */

/** Indicadores derivados do payload com filtros aplicados na query. */
export const FINANCE_FILTER_APPLIED_SCOPE =
  "Indicadores abaixo refletem os filtros aplicados." as const;

export const FINANCE_FILTER_APPLIED_KPI_SUFFIX = "· filtros aplicados" as const;

/** Exceções documentadas (Faturamento e contexto histórico). */
export const FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE =
  "Painel executivo — filtrado pelo ano selecionado (SalesOrder)." as const;

export const FINANCE_BILLING_NFE_LIST_SCOPE =
  "Listagem NF-e — respeita ano, mês, cliente/CNPJ, NF, classificação e status aplicados." as const;

export const FINANCE_BILLING_YTD_SCOPE =
  "YTD — respeita o ano selecionado, mas não o mês nem filtros de NF-e." as const;

export const FINANCE_BILLING_MULTI_YEAR_SCOPE =
  "Comparativo histórico multi-ano — não limitado ao mês nem a filtros de cliente/NF-e." as const;

export const FINANCE_BILLING_PROJECTION_SCOPE =
  "Projeção anual — baseada no ano selecionado; não aplica filtros de NF-e diagnóstica." as const;

export const FINANCE_BILLING_COMPARISON_SCOPE =
  "Comparativo diagnóstico — apenas o ano selecionado; ignora filtros de NF-e (mês, CNPJ, classificação)." as const;

export const FINANCE_SYNC_GLOBAL_SCOPE =
  "Status de sincronização — indicador global, não afetado pelos filtros financeiros." as const;

export const FINANCE_BILLING_RECENT_ORDERS_SCOPE =
  "Faturamentos recentes — últimos pedidos globalmente, não limitado ao ano selecionado." as const;

export const FINANCE_AR_PORTFOLIO_IMMEDIATE_SCOPE =
  "Portfolio NF — aplica filtro de NF emitida imediatamente (sem aguardar Aplicar)." as const;

/** Recebido no mês usa calendário atual — exceção explícita na UI AR. */
export const FINANCE_AR_RECEIVED_THIS_MONTH_SCOPE =
  "Recebido no mês — calendário atual (mês/ano de hoje), não o filtro de vencimento. Dentre títulos filtrados." as const;

export const FINANCE_AR_LAST_SYNC_FILTERED_SCOPE =
  "Última sync — MAX(syncedAt) entre os registros filtrados, não a sync global Nomus." as const;

/** Contas a Pagar — exceções e defaults explícitos na UI. */
export const FINANCE_AP_PAID_THIS_MONTH_SCOPE =
  "Pago no mês — calendário atual (mês/ano de hoje), não o filtro de vencimento. Dentre títulos filtrados." as const;

export const FINANCE_AP_DEFAULT_YEAR_SCOPE =
  "Ano corrente aplicado por padrão quando nenhum período é informado — limpe filtros para ver todos os anos (period=all)." as const;

export const FINANCE_AP_LAST_SYNC_FILTERED_SCOPE =
  "Última sync — MAX(syncedAt) entre os registros filtrados, não a sync global Nomus." as const;

export const FINANCE_BILLING_NFE_EXPORT_SCOPE =
  "Export CSV — listagem NF-e com filtros NF-e aplicados (ano, mês, CNPJ, NF, classificação, status)." as const;

/** Fluxo de Caixa — exceções e fontes. */
export const FINANCE_CASH_FLOW_PROJECTED_BALANCE_SCOPE =
  "Saldo projetado — não considera saldo bancário inicial." as const;

export const FINANCE_CASH_FLOW_SYNC_SCOPE =
  "Última sync — MAX(syncedAt) entre registros AR/AP carregados, não sync global Nomus." as const;

export const FINANCE_CASH_FLOW_NOT_BILLING_SCOPE =
  "Fluxo de caixa ≠ faturamento — entradas/saídas de AR/AP, não SalesOrder." as const;

export const FINANCE_CASH_FLOW_COMBINED_SCOPE =
  "Modo combinado — soma previsto (aberto) e realizado (baixado) no período." as const;

export function withAppliedFilterSub(
  sub: string | undefined,
  filtersActive: boolean
): string | undefined {
  if (!filtersActive) return sub;
  if (!sub) return FINANCE_FILTER_APPLIED_KPI_SUFFIX;
  return `${sub} ${FINANCE_FILTER_APPLIED_KPI_SUFFIX}`;
}
